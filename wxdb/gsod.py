"""ค่าตรวจวัดรายวันย้อนหลังของสถานีในประเทศไทยจาก NOAA GSOD (Global Surface Summary of the Day)

GSOD เป็นค่าสรุปรายวันที่ NOAA คำนวณจาก ISD ครอบคลุมสถานี synoptic ของกรมอุตุนิยมวิทยาย้อนหลังได้มากกว่า GHCNh
(ปี 2543: 66 สถานี เทียบกับ 46 สถานีใน GHCNh) แต่หยุดปรับปรุงตั้งแต่ ส.ค. 2568 พร้อมกับ ISD
  https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/<ปี>/<USAF><WBAN>.csv

การรวมกับข้อมูลของกรมอุตุนิยมวิทยา: รหัส USAF 48xxx0 + WBAN 99999 คือรหัส WMO 48xxx ของกรมอุตุนิยมวิทยา
จึงใช้ site_id = tmd:<WMO> (จุดเดียวกับค่าตรวจวัดรายวันจาก API ของกรมและ GHCNh) มิฉะนั้น gsod:<รหัสสถานี>
วันของ GSOD คือ 00–24 UTC = 07:00–07:00 น. ตรงกับวันอุตุนิยมวิทยาของไทย → time = ปลายช่วง (00 UTC ของวันถัดไป)
เช่นเดียวกับสรุปรายวันของกรมอุตุนิยมวิทยา (tmdday)

การควบคุมคุณภาพ: ตัดค่าที่หายไป (9999.9/999.9/99.99) · ค่าเฉลี่ยรายวันต้องมาจากการตรวจวัด ≥ 4 ครั้ง ·
ฝนรายวันใช้ flag D, F, G (ยอดสะสมครบ 24 ชม.) และ I (ไม่มีรายงานฝน = 0 มม.) — สถานีไทยไม่ส่งกลุ่มฝนในวันที่ฝนไม่ตก
  (ตรวจกับ CHIRPS ปี 2567, 40 สถานี: วัน flag I มี CHIRPS > 5 มม. เพียง 5.6% เทียบกับ 45% ของวัน flag G)
  flag A, B, C, E (ไม่ครบวัน), H และค่าว่าง (ไม่ทราบ) ถูกตัดออก
ผลลัพธ์: release "db-history" ไฟล์ observation__gsod_<ปี>.parquet (source_id = noaa_gsod)
"""
import io
import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from .history import RELEASE, _get  # noqa: F401 — ใช้ release และการลองใหม่ร่วมกับ GHCNh

BASE = "https://www.ncei.noaa.gov/data/global-summary-of-the-day/access"
TH_PREFIX = r"48[3-5]\d{8}"                             # บล็อก WMO 483xx–485xx = ประเทศไทย
LAST_YEAR = 2025                                        # GSOD หยุดปรับปรุง ส.ค. 2568
F2C = lambda f: (f - 32) * 5 / 9                        # noqa: E731
KT = 0.514444                                           # นอต → ม./วินาที
MI = 1.609344                                           # ไมล์ → กม.
# คอลัมน์ GSOD → (var_id, ค่าที่หายไป, แปลงหน่วย, คอลัมน์จำนวนครั้งที่ตรวจวัด)
VARS = {"TEMP": ("t2m", 9999.9, F2C, "TEMP_ATTRIBUTES"), "DEWP": ("td2m", 9999.9, F2C, "DEWP_ATTRIBUTES"),
        "SLP": ("mslp", 9999.9, None, "SLP_ATTRIBUTES"), "WDSP": ("wind_speed", 999.9, lambda v: v * KT, "WDSP_ATTRIBUTES"),
        "VISIB": ("visibility", 999.9, lambda v: v * MI, "VISIB_ATTRIBUTES"),
        "GUST": ("wind_gust", 999.9, lambda v: v * KT, None),
        "MAX": ("tmax", 9999.9, F2C, None), "MIN": ("tmin", 9999.9, F2C, None)}
PRCP_OK = {"D", "F", "G", "I"}


def stations(year):
    """รหัสสถานีไทยที่มีไฟล์ในปีนั้น"""
    html = _get(f"{BASE}/{year}/")
    return sorted(set(re.findall(rf'href="({TH_PREFIX})\.csv"', html.decode()))) if html else []


def site_id(station):
    usaf, wban = station[:6], station[6:]
    return f"tmd:{usaf[:5]}" if usaf.endswith("0") and wban == "99999" else f"gsod:{station}"


def station_year(station, year):
    """ไฟล์รายปีของสถานีเดียว → (observation แบบยาว, แถว site)"""
    raw = _get(f"{BASE}/{year}/{station}.csv")
    if raw is None:
        return None, None
    d = pd.read_csv(io.BytesIO(raw), dtype={"STATION": str})
    if d.empty:
        return None, None
    sid = site_id(station)
    t = pd.to_datetime(d.DATE, errors="coerce") + pd.Timedelta(days=1)          # ปลายช่วง 00 UTC ของวันถัดไป
    out = []
    for col, (var, miss, conv, ncol) in VARS.items():
        if col not in d:
            continue
        v = pd.to_numeric(d[col], errors="coerce")
        ok = v.notna() & (v != miss) & t.notna()
        if ncol and ncol in d:
            ok &= pd.to_numeric(d[ncol], errors="coerce").fillna(0) >= 4
        if ok.any():
            v = v[ok] if conv is None else conv(v[ok])
            out.append(pd.DataFrame({"site_id": sid, "time": t[ok], "var_id": var, "period_h": 24,
                                     "value": v.astype("float32"), "source_id": "noaa_gsod"}))
    if "PRCP" in d:
        v = pd.to_numeric(d.PRCP, errors="coerce")
        ok = v.notna() & (v != 99.99) & d.get("PRCP_ATTRIBUTES", pd.Series("", index=d.index)).astype(str).str.strip().isin(PRCP_OK) & t.notna()
        if ok.any():
            out.append(pd.DataFrame({"site_id": sid, "time": t[ok], "var_id": "precip", "period_h": 24,
                                     "value": (v[ok] * 25.4).astype("float32"), "source_id": "noaa_gsod"}))
    r = d.iloc[-1]
    site = {"site_id": sid, "network": "tmd" if sid.startswith("tmd:") else "gsod", "native_id": sid.split(":", 1)[1],
            "name": str(r.get("NAME", "")).split(",")[0].title(), "lat": r.get("LATITUDE"), "lon": r.get("LONGITUDE"),
            "elev_m": r.get("ELEVATION"), "source_id": "noaa_gsod"}
    if not out:
        return None, site
    o = pd.concat(out, ignore_index=True)
    return o.drop_duplicates(["site_id", "time", "var_id", "period_h"], keep="first"), site


def year(yr, workers=8):
    """ทุกสถานีของปีหนึ่ง → (DataFrame observation, DataFrame site)"""
    with ThreadPoolExecutor(workers) as ex:
        res = list(ex.map(lambda s: station_year(s, yr), stations(yr)))
    obs = [o for o, _ in res if o is not None and len(o)]
    sites = pd.DataFrame([s for _, s in res if s])
    return (pd.concat(obs, ignore_index=True) if obs else pd.DataFrame()), sites
