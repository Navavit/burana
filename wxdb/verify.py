"""การตรวจสอบความถูกต้องของพยากรณ์ตามแนวทางมาตรฐาน (WMO/WWRP JWGFVR) สำหรับงานวิจัย

คู่ข้อมูล
  daily_pairs()  พยากรณ์ย้อนหลัง (forecast_prevrun) รวมเป็นรายวัน 07:00–07:00 น. (00–00 UTC) เทียบค่าตรวจวัดรายวัน
                 ที่สถานีเดียวกัน: ฝน 24 ชม., อุณหภูมิสูงสุด/ต่ำสุด (observation_best: กรมอุตุฯ > GHCNh > GSOD)
  hourly_pairs() อุณหภูมิรายชั่วโมง ณ เวลาที่สถานีรายงาน (GHCNh/กรมอุตุฯ) — ใช้ศึกษารอบวัน
ดัชนี
  continuous()   bias, MAE, RMSE, สหสัมพันธ์
  categorical()  POD, FAR, CSI, ETS, FBI, SEDI (Ferro & Stephenson 2011) จากตาราง 2×2 ที่เกณฑ์ฝน
  brier() / reliability()  สำหรับความน่าจะเป็นจาก ensemble (verification_pair kind = ens)
  fss()          Fractions Skill Score (Roberts & Lean 2008) สำหรับสนามฝนบนกริด
ความไม่แน่นอน
  bootstrap()    block bootstrap ตามวัน (บล็อก 7 วัน สุ่มทั้งบล็อกพร้อมกันทุกสถาน) เพื่อคงสหสัมพันธ์เชิงเวลาและพื้นที่
                 ใช้ได้ทั้งช่วงความเชื่อมั่นของดัชนี และผลต่างแบบจับคู่ระหว่างแบบจำลอง (paired difference)
"""
import numpy as np
import pandas as pd

OBS_DAILY = {"precip": "precip", "tmax": "tmax", "tmin": "tmin"}


# ---------------------------------------------------------------------------- คู่ข้อมูล
def daily_obs(con, start, end, sources=("tmd", "noaa_gsod", "noaa_ghcnh")):
    """ค่าตรวจวัดรายวันที่สิ้นสุด 07:00 น. (time = 00 UTC) — ฝนของ GHCNh ใช้เฉพาะเมื่อขอ เพราะรายงานเฉพาะวันที่ฝนตก"""
    src = ",".join(f"'{s}'" for s in sources)
    return con.sql(f"""
        SELECT site_id, time, var_id, value, source_id FROM observation_best
        WHERE period_h = 24 AND hour(time) = 0 AND var_id IN ('precip', 'tmax', 'tmin') AND source_id IN ({src})
          AND NOT (var_id = 'precip' AND source_id = 'noaa_ghcnh')
          AND time > TIMESTAMP '{start}' AND time <= TIMESTAMP '{end}'""").df()


def daily_fc(con, start, end, models=None, leads=None):
    """forecast_prevrun รายชั่วโมง → รายวันที่สิ้นสุด 00 UTC: ผลรวมฝน, สูงสุด/ต่ำสุดของอุณหภูมิ (ต้องครบ 24 ชั่วโมง)"""
    w = []
    if models:
        w.append("model_id IN (" + ",".join(f"'{m}'" for m in models) + ")")
    if leads:
        w.append("lead_day IN (" + ",".join(str(x) for x in leads) + ")")
    where = (" AND " + " AND ".join(w)) if w else ""
    return con.sql(f"""
        WITH h AS (SELECT *, date_trunc('day', valid_time - INTERVAL 1 HOUR) + INTERVAL 1 DAY AS day_end FROM forecast_prevrun
                   WHERE valid_time > TIMESTAMP '{start}' AND valid_time <= TIMESTAMP '{end}'{where})
        SELECT model_id, site_id, lead_day, day_end AS time, 'precip' AS var_id, sum(value) AS fc FROM h
          WHERE var_id = 'precip' GROUP BY ALL HAVING count(*) = 24
        UNION ALL
        SELECT model_id, site_id, lead_day, day_end, 'tmax', max(value) FROM h WHERE var_id = 't2m' GROUP BY ALL HAVING count(*) = 24
        UNION ALL
        SELECT model_id, site_id, lead_day, day_end, 'tmin', min(value) FROM h WHERE var_id = 't2m' GROUP BY ALL HAVING count(*) = 24
        """).df()


def daily_pairs(con, start, end, models=None, leads=None):
    fc = daily_fc(con, start, end, models, leads)
    ob = daily_obs(con, start, end).rename(columns={"value": "ob"})
    return fc.merge(ob, on=["site_id", "time", "var_id"])


def hourly_pairs(con, start, end, models=None, leads=None):
    """อุณหภูมิรายชั่วโมงที่เวลาสถานีรายงาน (ไม่ประมาณค่าในช่วง)"""
    w = " AND model_id IN (" + ",".join(f"'{m}'" for m in models) + ")" if models else ""
    w += " AND lead_day IN (" + ",".join(str(x) for x in leads) + ")" if leads else ""
    return con.sql(f"""
        SELECT f.model_id, f.site_id, f.lead_day, f.valid_time AS time, f.value AS fc, o.value AS ob, o.source_id
        FROM forecast_prevrun f JOIN observation_best o
          ON o.site_id = f.site_id AND o.time = f.valid_time AND o.var_id = 't2m' AND o.period_h = 0
        WHERE f.var_id = 't2m' AND f.valid_time > TIMESTAMP '{start}' AND f.valid_time <= TIMESTAMP '{end}'{w}""").df()


# ---------------------------------------------------------------------------- ดัชนี
def continuous(fc, ob):
    fc, ob = np.asarray(fc, float), np.asarray(ob, float)
    e = fc - ob
    return {"n": len(e), "bias": e.mean(), "mae": np.abs(e).mean(), "rmse": np.sqrt((e ** 2).mean()),
            "r": np.corrcoef(fc, ob)[0, 1] if len(e) > 2 else np.nan}


def table2x2(fc, ob, thr):
    f, o = np.asarray(fc) >= thr, np.asarray(ob) >= thr
    return (f & o).sum(), (f & ~o).sum(), (~f & o).sum(), (~f & ~o).sum()      # hits, false alarms, misses, correct negatives


def categorical(fc, ob, thr):
    a, b, c, d = (float(x) for x in table2x2(fc, ob, thr))
    n = a + b + c + d
    ar = (a + b) * (a + c) / n if n else np.nan                                  # hits by chance
    H = a / (a + c) if a + c else np.nan
    F = b / (b + d) if b + d else np.nan
    sedi = np.nan
    if 0 < H < 1 and 0 < F < 1:
        sedi = (np.log(F) - np.log(H) - np.log(1 - F) + np.log(1 - H)) / (np.log(F) + np.log(H) + np.log(1 - F) + np.log(1 - H))
    return {"n": n, "base_rate": (a + c) / n if n else np.nan, "pod": H, "far": b / (a + b) if a + b else np.nan,
            "csi": a / (a + b + c) if a + b + c else np.nan, "ets": (a - ar) / (a + b + c - ar) if a + b + c - ar else np.nan,
            "fbi": (a + b) / (a + c) if a + c else np.nan, "pofd": F, "sedi": sedi}


def brier(p, o):
    p, o = np.asarray(p, float), np.asarray(o, float)
    return float(((p - o) ** 2).mean())


def reliability(p, o, bins=np.linspace(0, 1, 11)):
    """ตารางความน่าเชื่อถือ: ความน่าจะเป็นที่พยากรณ์ (ค่าเฉลี่ยในช่วง) เทียบความถี่ที่เกิดจริง"""
    d = pd.DataFrame({"p": p, "o": o})
    d["bin"] = pd.cut(d.p, bins, include_lowest=True)
    return d.groupby("bin", observed=True).agg(p_mean=("p", "mean"), o_freq=("o", "mean"), n=("o", "size")).reset_index()


def fss(fc, ob, thr, n):
    """Fractions Skill Score ของสนาม 2 มิติ (NaN = นอกพื้นที่) ที่หน้าต่าง n×n ช่อง"""
    from scipy.ndimage import uniform_filter
    m = ~(np.isnan(fc) | np.isnan(ob))
    bf, bo = np.where(m, fc >= thr, 0).astype(float), np.where(m, ob >= thr, 0).astype(float)
    w = uniform_filter(m.astype(float), n, mode="constant")
    with np.errstate(invalid="ignore", divide="ignore"):
        pf = uniform_filter(bf, n, mode="constant") / w
        po = uniform_filter(bo, n, mode="constant") / w
    k = m & (w > 0)
    mse = ((pf[k] - po[k]) ** 2).mean()
    ref = (pf[k] ** 2).mean() + (po[k] ** 2).mean()
    return 1 - mse / ref if ref else np.nan


# ---------------------------------------------------------------------------- ความไม่แน่นอน
def bootstrap(df, stat, by="model_id", n=1000, block_days=7, seed=0, time_col="time"):
    """block bootstrap ตามช่วงวัน: stat(กลุ่มย่อย) → dict ดัชนี
    คืนค่า DataFrame: กลุ่ม, ดัชนี, ค่าจริง, ช่วงความเชื่อมั่น 2.5–97.5%"""
    rng = np.random.default_rng(seed)
    t = pd.to_datetime(df[time_col])
    df = df.assign(_block=((t - t.min()).dt.days // block_days).to_numpy())
    blocks = np.unique(df._block)
    out = []
    for g, sub in (df.groupby(by) if by else [("all", df)]):
        sidx = {b: np.where(sub._block.to_numpy() == b)[0] for b in blocks}
        full = stat(sub)
        samples = []
        for _ in range(n):
            rows = np.concatenate([sidx[b] for b in rng.choice(blocks, len(blocks))])
            samples.append(stat(sub.iloc[rows]))
        for k, v in full.items():
            if k == "n":
                continue
            x = np.array([s_[k] for s_ in samples], float)
            out.append({"group": g, "metric": k, "value": v, "lo": np.nanpercentile(x, 2.5), "hi": np.nanpercentile(x, 97.5)})
    return pd.DataFrame(out)


def paired_diff(df, stat, a, b, metric, by="model_id", n=1000, block_days=7, seed=0, time_col="time"):
    """ผลต่างของดัชนีระหว่างแบบจำลอง a − b บนคู่ (สถานี, วัน) เดียวกัน พร้อมช่วงความเชื่อมั่น block bootstrap
    ถ้าช่วงไม่ครอบ 0 = ต่างกันอย่างมีนัยสำคัญที่ระดับ 5%"""
    key = ["site_id", time_col] + [c for c in ("lead_day", "var_id") if c in df]
    A = df[df[by] == a].set_index(key)
    B = df[df[by] == b].set_index(key)
    common = A.index.intersection(B.index)
    A, B = A.loc[common].reset_index(), B.loc[common].reset_index()
    rng = np.random.default_rng(seed)
    t = pd.to_datetime(A[time_col])
    block = ((t - t.min()).dt.days // block_days).to_numpy()
    blocks = np.unique(block)
    sidx = {k: np.where(block == k)[0] for k in blocks}
    d0 = stat(A)[metric] - stat(B)[metric]
    s = []
    for _ in range(n):
        rows = np.concatenate([sidx[k] for k in rng.choice(blocks, len(blocks))])
        s.append(stat(A.iloc[rows])[metric] - stat(B.iloc[rows])[metric])
    lo, hi = np.nanpercentile(s, [2.5, 97.5])
    return {"a": a, "b": b, "metric": metric, "diff": d0, "lo": lo, "hi": hi, "n_pairs": len(A), "significant": not (lo <= 0 <= hi)}
