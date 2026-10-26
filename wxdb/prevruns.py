"""พยากรณ์ย้อนหลัง ณ สถานีของกรมอุตุนิยมวิทยา จาก Open-Meteo Previous Runs API → ตาราง forecast_prevrun

ใช้ศึกษาความถูกต้องย้อนหลังในช่วงที่ระบบยังไม่ได้เก็บรอบพยากรณ์จริง (ก่อน ก.ย. 2569) โดยเทียบกับค่าตรวจวัดของ
NOAA GHCNh / GSOD ที่สถานีเดียวกัน (site_id = tmd:<WMO>)

previous_dayN = แต่ละชั่วโมงใช้ค่าที่แบบจำลองทายไว้ล่วงหน้า 24N–24N+23 ชม. โดยประมาณ (ต่อกันจากหลายรอบ)
ไม่ใช่ Day N จากรอบเดียวแบบ WMO — ระบุใน lead_day
ตัวแปร: ฝนรายชั่วโมง (ช่วงสิ้นสุดที่ valid_time) และอุณหภูมิ 2 ม. ระยะ N = 1, 2, 3, 5, 7 วัน (10 ตัวแปร = 1 หน่วยโควตา)

โควตา Open-Meteo (ใช้งานฟรี ≤ 10,000 หน่วย/วัน): หน่วย ≈ จำนวนจุด × ⌈ตัวแปร/10⌉ × ⌈จำนวนวัน/14⌉
งานหนึ่งชิ้น = (แบบจำลอง, เดือน) ทุกสถานี ≈ 120 × 1 × 3 = 360 หน่วย · ทำต่อจากที่ค้างไว้ได้ (ดูจาก manifest)
ไฟล์: release "db-prevruns" → forecast_prevrun__<model>_<YYYY-MM>.parquet
"""
import math
import time

import pandas as pd

import weather_core as core

from . import history

RELEASE = "db-prevruns"
START, END = "2024-07", "2026-09"                       # หลัง ก.ย. 2569 ใช้รอบพยากรณ์จริงที่ระบบเก็บไว้
LEADS = [1, 2, 3, 5, 7]
VARS = {"precipitation": "precip", "temperature_2m": "t2m"}
# Open-Meteo key ใน Previous Runs (ECMWF IFS ใช้ชุด 0.25° ซึ่งมีย้อนหลังถึง 2567) — ไม่รวม AIGFS (ไม่มีใน Previous Runs)
# และ KMA GDPS / BOM ACCESS-G (หยุดปรับปรุง)
MODELS = ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_global", "icon_global", "jma_gsm", "gem_global",
          "ukmo_global_deterministic_10km", "cma_grapes_global", "meteofrance_arpege_world"]
BATCH = 10                                              # จุดต่อคำขอ


def sites():
    """สถานีของกรมอุตุนิยมวิทยาที่มีใน GHCNh (มีค่าตรวจวัดย้อนหลังให้เทียบ)"""
    st = history.stations()
    return st[st.site_id.str.startswith("tmd:")].reset_index(drop=True)


def cost(n_sites, days):
    return n_sites * math.ceil(len(VARS) * len(LEADS) / 10) * math.ceil(days / 14)


def _request(model, lat, lon, start, end, tries=4):
    hv = [f"{v}_previous_day{d}" for v in VARS for d in LEADS]
    for i in range(tries):
        r = core.SESSION.get(core.PREVIOUS_RUNS_URL, params={
            "latitude": ",".join(f"{x:.4f}" for x in lat), "longitude": ",".join(f"{x:.4f}" for x in lon),
            "hourly": ",".join(hv), "models": model, "start_date": start, "end_date": end, "timezone": "GMT"}, timeout=180)
        if r.status_code == 429 or r.status_code >= 500:
            if i == tries - 1:
                r.raise_for_status()
            time.sleep(60 * (i + 1))                    # เกินโควตารายนาที/ชั่วโมง: รอแล้วลองใหม่
            continue
        r.raise_for_status()
        js = r.json()
        return js if isinstance(js, list) else [js]


def available(model, month):
    """มีข้อมูลของแบบจำลองในเดือนนั้นหรือไม่ (ทดสอบที่กรุงเทพมหานคร วันที่ 15 · 1 หน่วยโควตา)"""
    d = f"{month}-15"
    h = _request(model, [13.75], [100.5], d, d)[0]["hourly"]
    return any(v is not None for v in h.get("temperature_2m_previous_day1", []))


def model_month(model, month, st):
    """ทุกสถานีของแบบจำลองหนึ่งในเดือนหนึ่ง → DataFrame แบบยาว (ตัดค่าว่าง)"""
    p = pd.Period(month, "M")
    start, end = str(p.start_time.date()), str(p.end_time.date())
    out = []
    for i in range(0, len(st), BATCH):
        part = st.iloc[i:i + BATCH]
        for (_, s), j in zip(part.iterrows(), _request(model, part.lat, part.lon, start, end)):
            h = j["hourly"]
            t = pd.to_datetime(h["time"])
            for v, var in VARS.items():
                for d in LEADS:
                    x = pd.Series(h.get(f"{v}_previous_day{d}"), index=t, dtype="float32").dropna()
                    if len(x):
                        out.append(pd.DataFrame({"model_id": model, "site_id": s.site_id, "valid_time": x.index,
                                                 "lead_day": d, "var_id": var, "value": x.values}))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def todo(man):
    """งาน (model, month) ที่ยังไม่มีไฟล์ใน manifest เรียงจากเดือนล่าสุดก่อน"""
    have = {f["name"] for f in man.get("files", []) if f["release"] == RELEASE}
    skip = set(man.get("prevrun_unavailable", []))
    months = [str(p) for p in pd.period_range(START, END, freq="M")][::-1]
    return [(m, mo) for mo in months for m in MODELS
            if f"forecast_prevrun__{m}_{mo}.parquet" not in have and f"{m}_{mo}" not in skip]
