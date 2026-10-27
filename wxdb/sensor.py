"""ค่าตรวจวัดจากเซนเซอร์ของผู้ใช้ (ThingsBoard) → ตาราง observation

เซนเซอร์ภายนอกอาคาร PFAL SIS KU (มหาวิทยาลัยเกษตรศาสตร์ บางเขน): อุณหภูมิและความชื้นสัมพัทธ์ทุก ~5 นาที ตั้งแต่ 24 มิ.ย. 2569
อ่านผ่าน public dashboard ของ ThingsBoard: เข้าสู่ระบบแบบ public customer ด้วย publicId แล้วอ่าน timeseries ของอุปกรณ์
publicId เป็นความลับ (dashboard สาธารณะมีส่วนควบคุมอุปกรณ์ด้วย) → อ่านจากตัวแปรแวดล้อม PFAL_PUBLIC_ID
(GitHub Secrets หรือไฟล์ .env ของ repository นี้) ไม่เขียนไว้ในโค้ด · อ่านเฉพาะคีย์ค่าภายนอกอาคาร

จุด: site_id = sensor:pfal_sis_ku · พิกัดโดยประมาณจาก Google Maps (ปัดเป็น 0.001°)
การควบคุมคุณภาพ: อุณหภูมิ 10–45 °C, ความชื้น 1–100 % · เวลาเก็บตามที่อุปกรณ์รายงาน (ปัดเป็นนาที, UTC)
"""
import os
from pathlib import Path

import pandas as pd

import weather_core as core

TB_URL = "https://cat-smartgrow.com"
SENSORS = {
    "pfal_sis_ku": {
        "name": "เซนเซอร์ภายนอกอาคาร PFAL SIS KU (มก. บางเขน)",
        "agency": "PFAL SIS KU (เซนเซอร์ของผู้ใช้)",
        "lat": 13.847, "lon": 100.570, "province": "กรุงเทพมหานคร",
        "device": "0f6e9810-6f7c-11f1-ba97-e955dcdab604",
        "keys": {"xy_md_24_t": ("t2m", 10, 45), "xy_md_24_h": ("rh2m", 1, 100)},
        "secret": "PFAL_PUBLIC_ID",
        "since": "2026-06-24",
    },
}


def _secret(name):
    if os.environ.get(name):
        return os.environ[name]
    env = Path(__file__).resolve().parents[1] / ".env"
    for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        k, _, v = line.partition("=")
        if k.strip() == name:
            return v.strip().strip('"')
    return None


def _token(public_id):
    r = core.SESSION.post(f"{TB_URL}/api/auth/login/public", json={"publicId": public_id}, timeout=60)
    r.raise_for_status()
    return r.json()["token"]


def fetch(sid, start, end, chunk_days=7):
    """ค่าของเซนเซอร์ในช่วง [start, end) (UTC) → observation แบบยาว · None ถ้าไม่มี publicId"""
    s = SENSORS[sid]
    public_id = _secret(s["secret"])
    if not public_id:
        print(f"ข้ามเซนเซอร์ {sid}: ไม่มี {s['secret']}")
        return None
    head = {"X-Authorization": f"Bearer {_token(public_id)}"}
    out = []
    for t0 in pd.date_range(start, end, freq=f"{chunk_days}D", inclusive="left"):
        t1 = min(t0 + pd.Timedelta(days=chunk_days), pd.Timestamp(end))
        r = core.SESSION.get(f"{TB_URL}/api/plugins/telemetry/DEVICE/{s['device']}/values/timeseries", headers=head, timeout=180,
                             params={"keys": ",".join(s["keys"]), "startTs": int(t0.timestamp() * 1000),
                                     "endTs": int(t1.timestamp() * 1000), "limit": 100000, "agg": "NONE", "orderBy": "ASC"})
        r.raise_for_status()
        for key, vals in r.json().items():
            if not vals:
                continue
            var, lo, hi = s["keys"][key]
            d = pd.DataFrame(vals)
            d["value"] = pd.to_numeric(d.value, errors="coerce")
            d = d[d.value.between(lo, hi)]
            out.append(pd.DataFrame({"site_id": f"sensor:{sid}", "time": pd.to_datetime(d.ts, unit="ms").dt.floor("min"),
                                     "var_id": var, "period_h": 0, "value": d.value.astype("float32"), "source_id": sid}))
    if not out:
        return pd.DataFrame()
    return pd.concat(out, ignore_index=True).drop_duplicates(["site_id", "time", "var_id"], keep="last")


def site_rows():
    return pd.DataFrame([{"site_id": f"sensor:{k}", "network": "sensor", "native_id": k, "name": s["name"], "province": s["province"],
                          "agency": s["agency"], "lat": s["lat"], "lon": s["lon"], "source_id": k} for k, s in SENSORS.items()])
