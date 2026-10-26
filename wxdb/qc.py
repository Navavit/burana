"""การควบคุมคุณภาพฝนรายวันของโทรมาตร ThaiWater (07:00–07:00 น.) ด้วยการเทียบสถานีข้างเคียง (spatial buddy check)

ธง (บันทึกเฉพาะค่าที่ถูกตั้งธงในตาราง observation_qc)
  range          ค่าน้อยกว่า 0 หรือมากกว่า 400 มม./วัน
  stuck          ค่าเดิมที่ไม่ใช่ 0 ซ้ำกัน 3 วันติดต่อกัน (เครื่องค้าง)
  isolated_high  ≥ 50 มม. ขณะที่สถานีข้างเคียง (รัศมี 25 กม., ≥ 3 สถานี) มีมัธยฐาน < 2 มม. และไม่มีสถานีใดเกิน 10 มม.
  false_zero     0 มม. ขณะที่สถานีข้างเคียงทุกแห่งมีฝน ≥ 5 มม. และมัธยฐาน ≥ 20 มม. (เครื่องไม่บันทึก)
เกณฑ์อ้างอิงแนวทาง buddy check ของ WMO-No. 488 และ Durre et al. (2010, J. Appl. Meteor. Climatol.) ปรับให้เหมาะกับฝนเขตร้อน
ฝนพาความร้อนเฉพาะจุดอาจถูกตั้งธง isolated_high ได้ จึงเก็บเป็นธง ไม่ลบค่า — ผู้ใช้ตัดสินใจคัดออกเอง
"""
import numpy as np
import pandas as pd

R_KM = 25
MIN_REF = 3


def _neighbours(lat, lon, r_km=R_KM):
    """ดัชนีสถานีข้างเคียงในรัศมี r_km (ไม่รวมตัวเอง)"""
    la, lo = np.radians(lat), np.radians(lon)
    out = []
    for i in range(len(la)):
        d = 2 * 6371 * np.arcsin(np.sqrt(np.sin((la - la[i]) / 2) ** 2 + np.cos(la[i]) * np.cos(la) * np.sin((lo - lo[i]) / 2) ** 2))
        out.append(np.where((d <= r_km) & (d > 0))[0])
    return out


def rain_daily(con, start, end):
    """ฝน 24 ชม. ของ ThaiWater ที่สิ้นสุด 07:00 น. ในช่วง [start, end) → DataFrame ธง (schema observation_qc)"""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    obs = con.sql(f"""
        SELECT o.site_id, o.time, o.value, s.lat, s.lon FROM observation o JOIN site s USING (site_id)
        WHERE o.source_id = 'thaiwater' AND o.var_id = 'precip' AND o.period_h = 24 AND hour(o.time) = 0
          AND o.time >= TIMESTAMP '{start - pd.Timedelta(days=2):%Y-%m-%d %H:%M}' AND o.time < TIMESTAMP '{end:%Y-%m-%d %H:%M}'
          AND s.lat IS NOT NULL""").df()
    if obs.empty:
        return pd.DataFrame()
    obs = obs.drop_duplicates(["site_id", "time"])
    wide = obs.pivot(index="time", columns="site_id", values="value").sort_index()
    loc = obs.drop_duplicates("site_id").set_index("site_id").loc[wide.columns]
    nb = _neighbours(loc.lat.to_numpy(), loc.lon.to_numpy())
    ids = wide.columns.to_numpy()
    v = wide.to_numpy()
    rows = []
    for ti, t in enumerate(wide.index):
        if t < start:
            continue
        x = v[ti]
        for i, val in enumerate(x):
            if np.isnan(val):
                continue
            ref = x[nb[i]]
            ref = ref[~np.isnan(ref)]
            med = float(np.median(ref)) if len(ref) else np.nan
            flag = None
            if val < 0 or val > 400:
                flag = "range"
            elif val > 0 and ti >= 2 and v[ti - 1, i] == val and v[ti - 2, i] == val:
                flag = "stuck"
            elif len(ref) >= MIN_REF and val >= 50 and med < 2 and ref.max() < 10:
                flag = "isolated_high"
            elif len(ref) >= MIN_REF and val == 0 and med >= 20 and ref.min() >= 5:
                flag = "false_zero"
            if flag:
                rows.append((ids[i], t, flag, val, med, len(ref)))
    df = pd.DataFrame(rows, columns=["site_id", "time", "flag", "value", "ref", "n_ref"])
    df["var_id"], df["period_h"], df["source_id"] = "precip", 24, "thaiwater"
    return df
