"""ค่าตรวจวัดรายชั่วโมงจากรายงาน METAR ของสนามบินในประเทศไทย ผ่าน Iowa Environmental Mesonet (IEM) → ตาราง observation

IEM เก็บรายงาน METAR/SPECI ของเครือข่าย TH__ASOS (39 สนามบิน) ย้อนหลังหลายสิบปี และปรับปรุงต่อเนื่อง ไม่ต้องลงทะเบียน
  https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py
สนามบินส่วนใหญ่รายงานทุก 30 นาที — เก็บเฉพาะรายงานตรงชั่วโมง (นาที :00) เพื่อให้เทียบกับพยากรณ์รายชั่วโมง
ไม่มีใน GHCNh สำหรับบางสนามบิน (เช่น สุวรรณภูมิ VTBS ซึ่ง GHCNh มีเฉพาะรายงาน synop ราย 3 ชม.)

จุด: site_id = metar:<ICAO> (แยกจากสถานี synop ของกรมอุตุนิยมวิทยาแม้อยู่สนามบินเดียวกัน เพราะเป็นรายงานคนละชุด)
พิกัด: ใช้ของ IEM ยกเว้นที่ทราบว่าผิด (FIX)
การควบคุมคุณภาพ: อุณหภูมิ −10 ถึง 50 °C, จุดน้ำค้างไม่เกินอุณหภูมิ + 0.5 °C, ความชื้น 1–100 %
ผลลัพธ์: release "db-history" ไฟล์ observation__metar_<ปี>.parquet (source_id = iem_metar)
"""
import io
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from .history import RELEASE, _get  # noqa: F401 — ใช้ release และการลองใหม่ร่วมกับ GHCNh

NET_URL = "https://mesonet.agron.iastate.edu/geojson/network/TH__ASOS.geojson"
ASOS_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
FIX = {"VTBS": (13.6900, 100.7501)}                     # IEM ระบุพิกัดสุวรรณภูมิผิด (13.36, 100.98)
KT, MI = 0.514444, 1.609344
VARS = {"tmpc": ("t2m", None), "dwpc": ("td2m", None), "relh": ("rh2m", None), "sknt": ("wind_speed", KT),
        "drct": ("wind_dir", None), "gust": ("wind_gust", KT), "mslp": ("mslp", None), "vsby": ("visibility", MI)}


def stations():
    """สนามบินในเครือข่าย TH__ASOS → DataFrame(icao, lat, lon, begin, end, site_id)"""
    j = pd.read_json(io.BytesIO(_get(NET_URL)))
    rows = []
    for f in j["features"]:
        p, (lon, lat) = f["properties"], f["geometry"]["coordinates"]
        lat, lon = FIX.get(p["sid"], (lat, lon))
        rows.append({"icao": p["sid"], "lat": lat, "lon": lon, "begin": p.get("archive_begin"), "end": p.get("archive_end")})
    st = pd.DataFrame(rows)
    st["site_id"] = "metar:" + st.icao
    return st


def station_year(icao, year):
    """รายงาน METAR ของสนามบินหนึ่งในปีหนึ่ง (เวลา UTC) → observation แบบยาว"""
    params = [("station", icao), *[("data", v) for v in VARS], ("year1", year), ("month1", 1), ("day1", 1),
              ("year2", year + 1), ("month2", 1), ("day2", 1), ("tz", "Etc/UTC"), ("format", "onlycomma"),
              ("latlon", "no"), ("missing", "empty"), ("trace", "empty"), ("report_type", 3), ("report_type", 4)]
    url = ASOS_URL + "?" + "&".join(f"{k}={v}" for k, v in params)
    raw = _get(url)
    if not raw:
        return None
    d = pd.read_csv(io.BytesIO(raw))
    if d.empty:
        return None
    t = pd.to_datetime(d.valid, errors="coerce")
    d = d[t.dt.minute == 0].assign(time=t[t.dt.minute == 0]).drop_duplicates("time", keep="last")
    for c in VARS:
        d[c] = pd.to_numeric(d.get(c), errors="coerce")
    d.loc[~d.tmpc.between(-10, 50), "tmpc"] = None
    d.loc[d.dwpc > d.tmpc + 0.5, "dwpc"] = None
    d.loc[~d.relh.between(1, 100), "relh"] = None
    out = []
    for c, (var, k) in VARS.items():
        v = d[c].dropna()
        if len(v):
            out.append(pd.DataFrame({"site_id": f"metar:{icao}", "time": d.time[v.index], "var_id": var, "period_h": 0,
                                     "value": (v * k if k else v).astype("float32"), "source_id": "iem_metar"}))
    return pd.concat(out, ignore_index=True) if out else None


def year(st, yr, workers=2):
    """ทุกสนามบินของปีหนึ่ง (ใช้ 2 เธรดเพื่อไม่ให้เป็นภาระกับ IEM)"""
    with ThreadPoolExecutor(workers) as ex:
        parts = list(ex.map(lambda r: station_year(r.icao, yr), st.itertuples()))
    parts = [p for p in parts if p is not None and len(p)]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def site_rows(st):
    return pd.DataFrame({"site_id": st.site_id, "network": "metar", "native_id": st.icao, "name": st.icao + " (METAR)",
                         "lat": st.lat, "lon": st.lon, "source_id": "iem_metar"})
