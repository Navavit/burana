"""สภาพอากาศปัจจุบันที่ "วัดได้จริง" จากสถานีใกล้ที่สุด

- กรมอุตุนิยมวิทยา (TMD) Weather3Hours: สถานีอุตุฯ ~125 แห่ง ทุก 3 ชม. (01, 04, 07, 10, 13, 16, 19, 22 น.)
  อุณหภูมิ ความชื้น ฝน 3 ชม./24 ชม. ลม ความกดอากาศ ทัศนวิสัย
- Air4Thai (กรมควบคุมมลพิษ): PM2.5 รายชั่วโมงจากสถานีตรวจวัดคุณภาพอากาศ

ค่าจากโมเดลปัจจุบัน (Open-Meteo current) และเรดาร์ (RainViewer) หน้าเว็บดึงเองในเบราว์เซอร์เพื่อให้สดที่สุด
"""
import json
import math
import time
import xml.etree.ElementTree as ET

import pandas as pd
import requests
import urllib3

import weather_core as core

TMD_OBS_URL = "https://data.tmd.go.th/api/Weather3Hours/V2/"
TMD_TODAY_URL = "https://data.tmd.go.th/api/WeatherToday/V2/"
THAIWATER_RAIN24_URL = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h"
AIR4THAI_URL = "http://air4thai.pcd.go.th/services/getNewAQI_JSON.php"
MAX_STATION_KM = 60                    # ไกลกว่านี้ถือว่าไม่เป็นตัวแทนของตำแหน่ง
AQI_LEVELS = {"1": "🔵 ดีมาก", "2": "🟢 ดี", "3": "🟡 ปานกลาง", "4": "🟠 เริ่มมีผลต่อสุขภาพ", "5": "🔴 มีผลต่อสุขภาพ"}


def distance_km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(a))


def _f(text):
    try:
        v = float(text)
    except (TypeError, ValueError):
        return None
    return None if v <= -99 else v


def _tmd_xml(url, cfg=None):
    """XML ของ TMD Data API (uid/ukey เริ่มต้นเป็นคีย์สาธิตที่ TMD เผยแพร่ ตั้งเองได้ใน config)"""
    cfg = cfg or core.CFG
    # ช่วงที่ TMD กำลังปรับข้อมูลรอบใหม่ (เช่น ~10 น.) API ตอบสำเร็จแต่ไม่มีสถานีเลย → รอแล้วลองใหม่
    for attempt in range(3):
        if attempt:
            time.sleep(30)
        r = core.SESSION.get(url, params={"uid": cfg.get("tmd_obs_uid", "api"),
                                          "ukey": cfg.get("tmd_obs_ukey", "api12345")}, timeout=60)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        if root.find(".//Station") is not None:
            return root
    raise RuntimeError(f"TMD ตอบกลับโดยไม่มีสถานี ({url})")


# TMD ล้างรายการทั้งหมดตอนต้นรอบรายงาน แล้วทยอยเติมทีละสถานี (เช่น 19:05 ไม่มีเลย, 19:23 มี 74 สถานี)
# จึงจำรายงานล่าสุดของแต่ละสถานีไว้ใน branch data แล้วรวมกับที่ดึงได้ทุกรอบ (ตัดรายงานที่เก่ากว่า LATEST_MAX_H)
LATEST_DIR = core.ROOT / "archive" / "obs"
LATEST_MAX_H = {"tmd3h": 12, "tmdday": 36}           # สรุปรายวัน 07:00 น. ใช้ได้ถึงสรุปของวันถัดไป


def _archived(kind):
    """รายงานล่าสุดของแต่ละสถานีจากคลังรายวัน (ใช้ครั้งแรกที่ยังไม่มีไฟล์ latest)"""
    files = sorted((LATEST_DIR / kind).glob("*.csv"))[-2:]
    if not files:
        return []
    df = pd.concat([pd.read_csv(f, dtype={"id": str}) for f in files], ignore_index=True)
    df = df.sort_values("time").drop_duplicates("id", keep="last").astype(object)
    return df.where(df.notna(), None).to_dict("records")


def _with_latest(kind, fetch):
    path = LATEST_DIR / f"latest_{kind}.json"
    err = None
    try:
        rows = fetch()
    except Exception as e:                       # ดึงไม่ได้/ว่างทั้งรอบ ก็ยังใช้รายงานล่าสุดที่จำไว้
        rows, err = [], e
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = _archived(kind)
    by = {str(r["id"]): r for r in old}
    for r in rows:
        o = by.get(str(r["id"]))
        if o is None or (r.get("time") or "") >= (o.get("time") or ""):
            by[str(r["id"])] = r
    cut = (pd.Timestamp.now(tz="Asia/Bangkok").tz_localize(None) - pd.Timedelta(hours=LATEST_MAX_H[kind])).isoformat()
    out = [r for r in by.values() if (r.get("time") or "") >= cut]
    if not out:
        raise err or RuntimeError(f"ไม่มีรายงาน {kind}")
    if rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    if err or len(rows) < len(out):
        print(f"ℹ️ {kind}: รอบนี้ได้ {len(rows)} สถานี · ใช้รายงานล่าสุดที่จำไว้รวมเป็น {len(out)} สถานี")
    return out


def fetch_tmd_stations(cfg=None):
    """ค่าตรวจวัดราย 3 ชม. ล่าสุดของสถานีอุตุฯ (รวมรายงานล่าสุดที่จำไว้ของสถานีที่รอบนี้ยังไม่ส่ง)"""
    return _with_latest("tmd3h", lambda: _fetch_tmd_stations(cfg))


def _fetch_tmd_stations(cfg=None):
    root = _tmd_xml(TMD_OBS_URL, cfg)
    out = []
    for s in root.iter("Station"):
        g = lambda tag: (s.findtext(f".//{tag}") or "").strip()     # ค่าวัดอยู่ใต้ element ย่อย
        lat, lon = _f(g("Latitude")), _f(g("Longitude"))
        if lat is None or lon is None:
            continue
        try:
            t = pd.to_datetime(g("DateTime"), format="%m/%d/%Y %H:%M:%S").isoformat()
        except ValueError:
            t = None
        out.append({
            "id": g("WmoStationNumber"),
            "name": g("StationNameThai"), "province": g("Province"), "lat": lat, "lon": lon, "time": t,
            "temp": _f(g("AirTemperature")), "rh": _f(g("RelativeHumidity")), "dew": _f(g("DewPoint")),
            "rain_3h": _f(g("Rainfall")), "rain_24h": _f(g("Rainfall24Hr")),
            "wind_kmh": _f(g("WindSpeed")), "wind_dir": _f(g("WindDirection")),
            "pressure": _f(g("MeanSeaLevelPressure")), "visibility_km": _f(g("LandVisibility")),
        })
    return out


def fetch_tmd_today(cfg=None):
    """สรุปรายวันเวลา 07.00 น.: ฝน 24 ชม., อุณหภูมิสูงสุด/ต่ำสุด ของ 24 ชม. ที่ผ่านมา"""
    return _with_latest("tmdday", lambda: _fetch_tmd_today(cfg))


def _fetch_tmd_today(cfg=None):
    out = []
    for s in _tmd_xml(TMD_TODAY_URL, cfg).iter("Station"):
        g = lambda tag: (s.findtext(f".//{tag}") or "").strip()
        lat, lon = _f(g("Latitude")), _f(g("Longitude"))
        if lat is None or lon is None:
            continue
        t = pd.to_datetime(g("DateTime")[:19], errors="coerce")
        out.append({"id": g("WmoStationNumber"), "name": g("StationNameThai"), "lat": lat, "lon": lon,
                    "time": None if pd.isna(t) else t.isoformat(),
                    "rain_24h": _f(g("Rainfall")), "tmax": _f(g("MaxTemperature")), "tmin": _f(g("MinTemperature"))})
    return out


def fetch_thaiwater_rain24():
    """ฝนสะสม 24 ชม. ล่าสุดจากสถานีโทรมาตรทั่วประเทศ (สสน., กรมอุตุฯ, กรมชลประทาน ฯลฯ ~4,000 จุด)"""
    r = core.SESSION.get(THAIWATER_RAIN24_URL, timeout=90, headers={"User-Agent": "burana"})
    r.raise_for_status()
    j = r.json()
    rows = j.get("data", j)
    rows = rows.get("data", rows) if isinstance(rows, dict) else rows
    out = []
    for x in rows:
        st, geo = x.get("station") or {}, x.get("geocode") or {}
        lat, lon = _f(st.get("tele_station_lat")), _f(st.get("tele_station_long"))
        v = _f(x.get("rain_24h"))
        if lat is None or lon is None or v is None:
            continue
        name = (st.get("tele_station_name") or {}).get("th") or ""
        amphoe = (geo.get("amphoe_name") or {}).get("th") or ""
        tumbon = (geo.get("tumbon_name") or {}).get("th") or ""
        province = (geo.get("province_name") or {}).get("th") or ""
        out.append({"id": str(st.get("id")), "name": name.strip(), "area": f"ต.{tumbon} อ.{amphoe}".strip(),
                    "agency": ((x.get("agency") or {}).get("agency_shortname") or {}).get("th", "").strip(), "province": province.strip(),
                    "lat": lat, "lon": lon, "time": pd.Timestamp(x.get("rainfall_datetime")).isoformat(),
                    "rain_24h": v})
    return out


THAIWATER_HOURLY_URL = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h_graph"


def fetch_thaiwater_hourly(station_id):
    """ฝนรายชั่วโมงของเครื่องวัดโทรมาตร 1 สถานี (ย้อนหลัง ~36 ชม. · ThaiWater ไม่มีประวัติรายชั่วโมงเก่ากว่านี้)
    rain_1h ที่เวลา t = ฝนใน (t-1h, t] (เวลาไทย)"""
    r = core.SESSION.get(THAIWATER_HOURLY_URL, params={"station_type": "tele_station", "station_id": station_id},
                         timeout=60, headers={"User-Agent": "burana"})
    r.raise_for_status()
    return [{"id": str(station_id), "time": pd.Timestamp(x["rainfall_datetime"]).isoformat(), "rain_1h": _f(x["rainfall_value"])}
            for x in r.json().get("data", []) if _f(x.get("rainfall_value")) is not None]


def fetch_air4thai():
    """PM2.5 ล่าสุดของสถานีตรวจวัดคุณภาพอากาศ (กรมควบคุมมลพิษ)"""
    try:
        r = core.SESSION.get(AIR4THAI_URL, timeout=60)
    except requests.exceptions.SSLError:
        # เว็บ Air4Thai ส่ง certificate chain ไม่ครบ (ขาด intermediate) บาง OS จึงตรวจไม่ผ่าน
        # ข้อมูลเป็นค่าสาธารณะแบบอ่านอย่างเดียว ไม่มีการส่งข้อมูลลับ จึงยอมดึงแบบไม่ตรวจ cert เฉพาะแหล่งนี้
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        r = core.SESSION.get(AIR4THAI_URL, timeout=60, verify=False)
    r.raise_for_status()
    out = []
    for s in r.json().get("stations", []):
        last = s.get("AQILast") or {}
        pm = last.get("PM25") or {}
        v = _f(pm.get("value"))
        if v is None:
            continue
        out.append({
            "name": s.get("nameTH"), "area": s.get("areaTH"), "lat": _f(s.get("lat")), "lon": _f(s.get("long")),
            "time": f"{last.get('date')}T{last.get('time')}", "pm25": v,
            "level": AQI_LEVELS.get(str(pm.get("color_id")), "–"),
        })
    return [s for s in out if s["lat"] is not None and s["lon"] is not None]


def fetch_air4thai_all():
    """ค่าล่าสุดของทุกสถานี Air4Thai ทุกพารามิเตอร์ (เก็บเข้าคลังรายชั่วโมง obs/air4thai)
    ช่วงเฉลี่ยตามนิยามดัชนีคุณภาพอากาศของกรมควบคุมมลพิษ: PM2.5/PM10 24 ชม., O3/CO 8 ชม., NO2/SO2 1 ชม."""
    try:
        r = core.SESSION.get(AIR4THAI_URL, timeout=60)
    except requests.exceptions.SSLError:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        r = core.SESSION.get(AIR4THAI_URL, timeout=60, verify=False)
    r.raise_for_status()
    out = []
    for s in r.json().get("stations", []):
        last = s.get("AQILast") or {}
        val = lambda k, f="value": (lambda v: v if v is not None and v >= 0 else None)(_f((last.get(k) or {}).get(f)))
        lat, lon = _f(s.get("lat")), _f(s.get("long"))
        if lat is None or lon is None or not last.get("date"):
            continue
        out.append({"id": s.get("stationID"), "name": s.get("nameTH"), "area": s.get("areaTH"), "type": s.get("stationType"),
                    "lat": lat, "lon": lon, "time": f"{last.get('date')}T{last.get('time')}",
                    "pm25": val("PM25"), "pm10": val("PM10"), "o3": val("O3"), "co": val("CO"), "no2": val("NO2"), "so2": val("SO2"),
                    "aqi": val("AQI", "aqi")})
    return out


def nearest(lat, lon, stations, max_km=MAX_STATION_KM):
    best = min(stations, key=lambda s: distance_km(lat, lon, s["lat"], s["lon"]), default=None)
    if best is None:
        return None
    d = distance_km(lat, lon, best["lat"], best["lon"])
    return {**best, "dist_km": round(d, 1)} if d <= max_km else None


def fetch_sensors(hours=3):
    """ค่าล่าสุดของเซนเซอร์ของผู้ใช้ (wxdb.sensor เช่น PFAL SIS KU) สำหรับแผนที่ · ไม่มี publicId = ข้าม"""
    from wxdb import sensor
    end = pd.Timestamp.now(tz="UTC").tz_localize(None).ceil("min")
    out = []
    for sid, s in sensor.SENSORS.items():
        d = sensor.fetch(sid, end - pd.Timedelta(hours=hours), end + pd.Timedelta(minutes=1))
        if d is None or d.empty:
            continue
        last = d.sort_values("time").groupby("var_id").last()
        t = last["time"].max() + pd.Timedelta(hours=7)                 # UTC → เวลาไทย (แบบเดียวกับสถานีอื่น)
        val = lambda v: round(float(last.loc[v, "value"]), 1) if v in last.index else None  # noqa: E731
        out.append({"id": sid, "name": s["name"], "lat": s["lat"], "lon": s["lon"], "time": t.isoformat(timespec="minutes"),
                    "temp": val("t2m"), "rh": val("rh2m")})
    return out


def fetch_all(cfg=None):
    """ดึงทุกแหล่งครั้งเดียว ใช้กับทุกตำแหน่งและแผนที่สถานี (ล้มเหลวแหล่งไหนก็ข้ามแหล่งนั้น)"""
    out = {"tmd": [], "air": [], "tw": [], "sensor": []}
    for key, fn in (("tmd", lambda: fetch_tmd_stations(cfg)), ("air", fetch_air4thai), ("tw", fetch_thaiwater_rain24),
                    ("sensor", fetch_sensors)):
        try:
            out[key] = fn()
        except Exception as e:
            print(f"⚠️ ข้อมูลปัจจุบัน {key}: {e}")
    return out


def for_location(lat, lon, obs):
    return {"station": nearest(lat, lon, obs["tmd"]), "air": nearest(lat, lon, obs["air"])}
