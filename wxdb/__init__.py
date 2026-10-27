"""wxdb — ฐานข้อมูลอุตุนิยมวิทยาและแบบจำลองพยากรณ์อากาศของประเทศไทย (BURANA)

ใช้งาน (ไม่ต้องดาวน์โหลดทั้งฐานข้อมูล — DuckDB อ่านเฉพาะคอลัมน์และช่วงที่ต้องการผ่าน HTTP):

    import wxdb
    con = wxdb.connect()                      # สร้าง view ของทุกตารางจาก manifest
    con.sql("SELECT * FROM site WHERE network = 'tmd'").df()

โครงสร้างตาราง: wxdb/schema.py และ docs/DATABASE.md
"""


def connect(tables=None, months=None, cache_dir=None):
    """คืน duckdb connection ที่มี view ชื่อเดียวกับตาราง

    tables: จำกัดเฉพาะบางตาราง · months: จำกัดเดือนของตารางข้อเท็จจริง เช่น ["2026-10"]
    cache_dir: ถ้าระบุ จะดาวน์โหลดไฟล์มาเก็บไว้ในเครื่องก่อน (ใช้ซ้ำโดยไม่ต้องดาวน์โหลดใหม่)
    """
    from pathlib import Path

    import duckdb

    from . import store
    man = store.load_manifest(fresh=False)
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs;")
    try:                                                # ใน Jupyter ที่ไม่มี ipywidgets การตั้งค่านี้จะผิดพลาด
        con.sql("SET enable_progress_bar = false;")
    except Exception:                                   # noqa: BLE001
        pass
    by_table = {}
    for f in man["files"]:
        if tables and f["table"] not in tables:
            continue
        if months and f["release"] != store.CATALOG_TAG and f["release"].removeprefix("db-") not in months:
            continue
        url = f"{man['base_url']}/{f['release']}/{f['name']}"
        if cache_dir:
            p = Path(cache_dir) / f["release"] / f["name"]
            if not p.exists():
                store.download(f["release"], f["name"], p)
            url = str(p)
        by_table.setdefault(f["table"], []).append(url)
    for t, urls in by_table.items():
        lst = ", ".join(f"'{u}'" for u in urls)
        con.sql(f"CREATE VIEW {t} AS SELECT * FROM read_parquet([{lst}], union_by_name = true)")
    if "observation" in by_table:
        # สถานีเดียวกันอาจมีค่าจากหลายแหล่งในเวลาเดียวกัน (เช่น API ของกรมอุตุนิยมวิทยา และ NOAA GHCNh ซึ่งตรงกัน ~99%)
        # observation_best เลือกค่าเดียวต่อ (จุด, เวลา, ตัวแปร, ช่วงสะสม) ตามลำดับ: หน่วยงานไทยต้นทาง > NOAA GHCNh > NOAA GSOD > อื่น ๆ
        con.sql("""CREATE VIEW observation_best AS SELECT * EXCLUDE (_rk) FROM (
                     SELECT *, row_number() OVER (PARTITION BY site_id, time, var_id, period_h ORDER BY
                       CASE source_id WHEN 'tmd' THEN 0 WHEN 'thaiwater' THEN 1 WHEN 'air4thai' THEN 2 WHEN 'noaa_ghcnh' THEN 3 WHEN 'noaa_gsod' THEN 4 ELSE 5 END) AS _rk
                     FROM observation) WHERE _rk = 1""")
    return con
