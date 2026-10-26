"""แค็ตตาล็อกข้อมูล (หน้า data.html) → site/data/catalog.json

รายละเอียดของทุกชุดข้อมูลในระบบ: แหล่งที่มา หน่วยงาน สัญญาอนุญาต ตัวแปรและหน่วย ความครอบคลุมเชิงพื้นที่
ความละเอียดเชิงเวลาของต้นทาง รอบการปรับปรุงของระบบ ความล่าช้า ช่วงเวลาที่มีข้อมูล ที่จัดเก็บ และข้อจำกัด
ค่าสถิติ (จำนวนสถานี เวลาล่าสุด ช่วงเวลา ขนาดฐานข้อมูล) คำนวณใหม่ทุกรอบจากคลังรายชั่วโมงและ manifest ของฐานข้อมูล
"""
import json
import os
import time
from pathlib import Path

import pandas as pd

import weather_core as core

RES = core.ROOT / "resources"
GHCNH_CACHE_DAYS = 7

# ---------------------------------------------------------------------------- นิยามชุดข้อมูล
# group: obs = ค่าตรวจวัด · fc = ผลพยากรณ์ · hist = ข้อมูลย้อนหลัง · derived = ผลการประมวลผล · ref = ข้อมูลอ้างอิง
# live: คีย์ของสถิติที่คำนวณจากข้อมูลจริง (ดู live_stats)
DATASETS = [
    {"id": "tmd3h", "group": "obs", "name": "รายงานตรวจอากาศผิวพื้นราย 3 ชั่วโมง (Weather3Hours)",
     "provider": "กรมอุตุนิยมวิทยา", "url": "https://data.tmd.go.th/api/index1.php", "license": "TMD Open Data",
     "variables": "อุณหภูมิอากาศ, ความชื้นสัมพัทธ์, จุดน้ำค้าง (°C, %), ฝนสะสม 3 และ 24 ชม. (มม.), ทิศและความเร็วลม (กม./ชม. → ม./วินาที), ความกดอากาศระดับน้ำทะเล (hPa), ทัศนวิสัย (กม.)",
     "spatial": "สถานีตรวจอากาศผิวพื้น (synoptic) ทั่วประเทศ", "native": "ราย 3 ชม. (01, 04, 07, …, 22 น.)",
     "update": "ดึงทุกชั่วโมง (API ให้เฉพาะรายงานล่าสุด ระบบสะสมเอง)", "latency": "~1–3 ชม.",
     "storage": "branch data: obs/tmd3h/ · ฐานข้อมูล: observation (source_id = tmd)",
     "use": "ค่าอ้างอิงการตรวจสอบอุณหภูมิและฝนราย 3 ชม. ทั่วประเทศ · แผนที่ค่าปัจจุบัน",
     "limits": "รายงานที่ระบบไม่ได้ดึงภายในรอบ 3 ชม. (เช่น GitHub Actions ล่าช้า) ไม่สามารถดึงย้อนหลังได้", "live": "tmd3h"},
    {"id": "tmdday", "group": "obs", "name": "สรุปอากาศรายวันเวลา 07:00 น. (WeatherToday)",
     "provider": "กรมอุตุนิยมวิทยา", "url": "https://data.tmd.go.th/api/index1.php", "license": "TMD Open Data",
     "variables": "ฝนสะสม 24 ชม. 07:00–07:00 น. (มม.), อุณหภูมิสูงสุดและต่ำสุดของ 24 ชม. ที่ผ่านมา (°C)",
     "spatial": "สถานีตรวจอากาศผิวพื้นทั่วประเทศ", "native": "รายวัน (สรุปเวลา 07:00 น.)",
     "update": "ดึงทุกชั่วโมง เก็บค่าใหม่วันละครั้ง", "latency": "~1–2 ชม. หลัง 07:00 น.",
     "storage": "branch data: obs/tmdday/ · ฐานข้อมูล: observation (period_h = 24)",
     "use": "การตรวจสอบฝนรายวันและอุณหภูมิสูงสุด/ต่ำสุดทั่วประเทศ (ร่วมกับ Open-Meteo Previous Runs)", "limits": "", "live": "tmdday"},
    {"id": "twday", "group": "obs", "name": "ฝนรายวันจากโทรมาตรทุกเครื่อง (ThaiWater)",
     "provider": "สถาบันสารสนเทศทรัพยากรน้ำ (สสน.) รวบรวมจากหลายหน่วยงาน", "url": "https://www.thaiwater.net/", "license": "เปิดเผยตามเงื่อนไขของ สสน.",
     "variables": "ฝนสะสม 24 ชม. 07:00–07:00 น. (มม.)",
     "spatial": "สถานีโทรมาตรทั่วประเทศ (สสน., กรมชลประทาน, กรมทรัพยากรน้ำ, กรมอุตุนิยมวิทยา ฯลฯ)", "native": "รายวัน",
     "update": "วันละครั้ง (เก็บค่าของเมื่อวาน)", "latency": "~1 วัน",
     "storage": "branch data: obs/twday/ · ฐานข้อมูล: observation (source_id = thaiwater, period_h = 24)",
     "use": "การตรวจสอบฝนรายวันที่โทรมาตรทุกเครื่อง แยกเขตเมือง/ชานเมือง/ชนบท",
     "limits": "ค่าผิดปกติ (< 0 หรือ ≥ 1,000 มม.) ถูกตัดออก · ตั้งธงคุณภาพรายวันด้วยการเทียบสถานีข้างเคียง (ตาราง observation_qc: range, stuck, isolated_high, false_zero)", "live": "twday"},
    {"id": "tw_check", "group": "obs", "name": "ฝนรายชั่วโมงและสะสม 24 ชม. ณ โทรมาตรจุดตรวจ (ThaiWater)",
     "provider": "สถาบันสารสนเทศทรัพยากรน้ำ (สสน.)", "url": "https://www.thaiwater.net/", "license": "เปิดเผยตามเงื่อนไขของ สสน.",
     "variables": "ฝนรายชั่วโมง (มม.), ฝนสะสม 24 ชม. ล่าสุด (มม.)",
     "spatial": "โทรมาตรที่เลือกเป็นจุดตรวจของตำแหน่งที่กำหนด (เขตเมืองกรุงเทพมหานครและปริมณฑล ความหนาแน่นประชากร ≥ 1,500 คน/ตร.กม., พระนครศรีอยุธยา)",
     "native": "รายชั่วโมง", "update": "ทุกชั่วโมง (ThaiWater เก็บย้อนหลังเพียง ~36 ชม.)", "latency": "< 1 ชม.",
     "storage": "branch data: obs/tw1h/, obs/thaiwater/ · ฐานข้อมูล: observation (period_h = 1, 24)",
     "use": "การตรวจสอบฝนราย 3 ชม. และมุมมองผู้ใช้งานในเขตเมือง", "limits": "เครื่องที่หยุดรายงานเกิน 24 ชม. ถูกแทนด้วยเครื่องใกล้เคียง", "live": "tw_check"},
    {"id": "air4thai", "group": "obs", "name": "คุณภาพอากาศ (Air4Thai)",
     "provider": "กรมควบคุมมลพิษ", "url": "http://air4thai.pcd.go.th/", "license": "เปิดเผย",
     "variables": "PM2.5 และ PM10 (µg/m³, เฉลี่ย 24 ชม.), O₃ (ppb, 8 ชม.), CO (ppm, 8 ชม.), NO₂ และ SO₂ (ppb, 1 ชม.), ดัชนีคุณภาพอากาศ (AQI)",
     "spatial": "สถานีตรวจวัดคุณภาพอากาศทั่วประเทศ (สถานีภาคพื้นและสถานีเคลื่อนที่)", "native": "รายชั่วโมง",
     "update": "ทุกชั่วโมง (API ให้เฉพาะค่าล่าสุด)", "latency": "~1–2 ชม.",
     "storage": "branch data: obs/air4thai/ · ฐานข้อมูล: observation (source_id = air4thai)",
     "use": "ค่าปัจจุบันบนหน้าเว็บ · ฐานข้อมูลระยะยาวด้านคุณภาพอากาศ",
     "limits": "บางสถานีไม่มีครบทุกพารามิเตอร์ · สถานีที่หยุดทำงานยังส่งรายงานล่าสุดเดิม (เก็บตามเวลาที่วัดจริง)", "live": "air4thai"},
    {"id": "user", "group": "obs", "name": "รายงานฝนจากผู้ใช้",
     "provider": "ผู้ใช้ระบบผ่าน GitHub Issues", "url": "", "license": "CC BY 4.0",
     "variables": "มีฝน/ไม่มีฝน, ปริมาณฝนโดยประมาณ (มม., ถ้าระบุ)", "spatial": "ตามตำแหน่งที่ผู้ใช้รายงาน",
     "native": "ตามเหตุการณ์", "update": "ทันทีที่สร้าง issue (observe.yml)", "latency": "< 5 นาที",
     "storage": "branch data: observations/ · ฐานข้อมูล: observation (var_id = rain_flag)",
     "use": "การตรวจสอบพยากรณ์ฝนเชิงเหตุการณ์", "limits": "รับเฉพาะบัญชีเจ้าของ repository · พิกัดในฐานข้อมูลปัดเป็น 0.01°", "live": "user"},
    {"id": "ghcnh", "group": "hist", "name": "ค่าตรวจวัดรายชั่วโมงย้อนหลัง NOAA GHCNh",
     "provider": "NOAA National Centers for Environmental Information", "url": "https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly",
     "license": "สาธารณสมบัติ (U.S. Government)",
     "variables": "อุณหภูมิ, จุดน้ำค้าง, ความชื้นสัมพัทธ์, ความกดอากาศระดับน้ำทะเล, ทิศ/ความเร็ว/ลมกระโชก, ทัศนวิสัย, ฝนสะสม 1/3/6/12/24 ชม.",
     "spatial": "สถานี synoptic และ METAR ในประเทศไทย", "native": "รายชั่วโมง (บางสถานีราย 3 ชม.)",
     "update": "รายเดือน (วันที่ 3) แทนที่ไฟล์ของปีปัจจุบัน", "latency": "~3 วัน",
     "storage": "ฐานข้อมูล: release db-history → observation__ghcnh_<ปี>.parquet (source_id = noaa_ghcnh)",
     "use": "อนุกรมเวลาต่อเนื่อง 2543–ปัจจุบัน สำหรับภูมิอากาศวิทยา การทดสอบย้อนหลัง และการปรับแก้ความเอนเอียง",
     "limits": "ใช้เฉพาะค่าที่ผ่านการควบคุมคุณภาพ · NOAA ใช้ GHCNh แทน ISD/GSOD ซึ่งหยุดปรับปรุง ส.ค. 2568 · ปี 2543 มี 46 สถานี (เพิ่มเป็น ~160 สถานีในปัจจุบัน)", "live": "ghcnh"},
    {"id": "gsod", "group": "hist", "name": "ค่าสรุปรายวันย้อนหลัง NOAA GSOD (สถานีกรมอุตุนิยมวิทยา)",
     "provider": "NOAA National Centers for Environmental Information", "url": "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00516",
     "license": "สาธารณสมบัติ (U.S. Government)",
     "variables": "อุณหภูมิเฉลี่ย/สูงสุด/ต่ำสุด, จุดน้ำค้างเฉลี่ย, ความกดอากาศระดับน้ำทะเล, ความเร็วลมเฉลี่ย, ลมกระโชก, ทัศนวิสัย, ฝน 24 ชม.",
     "spatial": "สถานี synoptic ของกรมอุตุนิยมวิทยา (บันทึกในจุดเดียวกับสถานีของกรม: tmd:<WMO>)", "native": "รายวัน (07:00–07:00 น.)",
     "update": "ไม่ปรับปรุงแล้ว (ดึงครั้งเดียว)", "latency": "หยุดปรับปรุง ส.ค. 2568",
     "storage": "ฐานข้อมูล: release db-history → observation__gsod_<ปี>.parquet (source_id = noaa_gsod)",
     "use": "ต่ออนุกรมรายวันของสถานีกรมอุตุนิยมวิทยาย้อนหลังถึง 2543 (มีสถานีมากกว่า GHCNh ในช่วงแรก)",
     "limits": "ฝนรายวัน: วันที่ไม่มีรายงานฝน (flag I) ถือเป็น 0 มม. ตามการตรวจกับ CHIRPS · ค่าเฉลี่ยต้องมาจาก ≥ 4 การตรวจวัด", "live": "gsod"},
    {"id": "era5land", "group": "hist", "name": "ERA5-Land รายวัน",
     "provider": "ECMWF / Copernicus Climate Change Service", "url": "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land",
     "license": "Copernicus licence (อ้างอิงแหล่งที่มา)",
     "variables": "อุณหภูมิเฉลี่ย/สูงสุด/ต่ำสุด (°C), จุดน้ำค้างเฉลี่ย (°C), ฝนรวม (มม.), รังสีคลื่นสั้นขาลงรวม (MJ/m²)",
     "spatial": "ค่า ณ จุดศูนย์กลางเซลล์กริด th025 (ความละเอียดต้นทาง 0.1°)", "native": "รายวัน (วัน UTC)",
     "update": "รายเดือน: 3 เดือนล่าสุด (Open-Meteo) · ย้อนหลังผ่าน Google Earth Engine", "latency": "~5–7 วัน",
     "storage": "ฐานข้อมูล: release db-history → reanalysis_daily (dataset_id = era5_land)",
     "use": "ภูมิอากาศวิทยาเชิงพื้นที่ ค่าปกติ และข้อมูลเสริมในพื้นที่ที่ไม่มีสถานี",
     "limits": "เซลล์เหนือทะเลไม่มีค่า · ค่ารายเดือนจาก Open-Meteo ใช้ฝนและรังสีของ ERA5", "live": "era5_land"},
    {"id": "chirps", "group": "hist", "name": "CHIRPS v2.0 ฝนรายวัน",
     "provider": "UCSB Climate Hazards Center", "url": "https://www.chc.ucsb.edu/data/chirps", "license": "CC BY 4.0",
     "variables": "ฝนรายวัน (มม.) จากดาวเทียมร่วมกับสถานี", "spatial": "ค่า ณ จุดศูนย์กลางเซลล์กริด th025 (ความละเอียดต้นทาง 0.05°)",
     "native": "รายวัน", "update": "รายเดือน: 3 เดือนล่าสุด (ไฟล์ GeoTIFF ของ CHC) · ย้อนหลังผ่าน Google Earth Engine",
     "latency": "~3 สัปดาห์", "storage": "ฐานข้อมูล: release db-history → reanalysis_daily (dataset_id = chirps)",
     "use": "ฝนเชิงพื้นที่ระยะยาว", "limits": "ประเมินฝนตกหนักระยะสั้นต่ำกว่าความเป็นจริง", "live": "chirps"},
    {"id": "imerg", "group": "hist", "name": "IMERG V07 ฝนรายวันจากดาวเทียม",
     "provider": "NASA Goddard Space Flight Center (GPM)", "url": "https://gpm.nasa.gov/data/imerg", "license": "สาธารณสมบัติ (NASA)",
     "variables": "ฝนรายวัน (มม.) รวมจากราย 30 นาที (ชุด Final ปรับเทียบกับเครื่องวัดฝนรายเดือน)",
     "spatial": "ค่า ณ จุดศูนย์กลางเซลล์กริด th025 (ความละเอียดต้นทาง 0.1°)", "native": "รายวัน (วัน UTC = 07:00–07:00 น.)",
     "update": "ดึงผ่าน Google Earth Engine ในเครื่องผู้ดูแล (ไม่อัตโนมัติ)", "latency": "~3.5 เดือน (ชุด Final)",
     "storage": "ฐานข้อมูล: release db-history → reanalysis_daily (dataset_id = imerg)",
     "use": "ค่าอ้างอิงเชิงกริดสำหรับ Fractions Skill Score และการควบคุมคุณภาพโทรมาตร", "limits": "ประเมินฝนพาความร้อนระยะสั้นคลาดเคลื่อนได้", "live": "imerg"},
    {"id": "gsmap", "group": "hist", "name": "GSMaP ฝนรายวันจากดาวเทียม (ปรับแก้ด้วยเครื่องวัดฝน)",
     "provider": "JAXA Earth Observation Research Center", "url": "https://sharaku.eorc.jaxa.jp/GSMaP/", "license": "ใช้ได้โดยอ้างอิงแหล่งที่มา (JAXA)",
     "variables": "ฝนรายวัน (มม.) รวมจากรายชั่วโมง (hourlyPrecipRateGC)",
     "spatial": "ค่า ณ จุดศูนย์กลางเซลล์กริด th025 (ความละเอียดต้นทาง 0.1°)", "native": "รายวัน (วัน UTC = 07:00–07:00 น.)",
     "update": "ดึงผ่าน Google Earth Engine ในเครื่องผู้ดูแล (ไม่อัตโนมัติ)", "latency": "~3 วัน (v8 operational)",
     "storage": "ฐานข้อมูล: release db-history → reanalysis_daily (dataset_id = gsmap)",
     "use": "ค่าอ้างอิงเชิงกริดช่วงล่าสุด (IMERG Final ยังไม่ออก) สำหรับ FSS และการควบคุมคุณภาพ",
     "limits": "v6 reanalysis (2543–ก.พ. 2557) และ v8 operational (มี.ค. 2557–) ใช้อัลกอริทึมต่างกัน", "live": "gsmap"},
    {"id": "om_locations", "group": "fc", "name": "พยากรณ์รายชั่วโมงหลายแบบจำลอง ณ ตำแหน่งหลัก",
     "provider": "Open-Meteo (รวบรวมจาก ECMWF, NOAA, DWD, ECCC, JMA, Météo-France, UK Met Office, CMA)", "url": "https://open-meteo.com/",
     "license": "CC BY 4.0 (ใช้งานไม่เชิงพาณิชย์)",
     "variables": "ฝน, ความน่าจะเป็นฝน, อุณหภูมิ, อุณหภูมิปรากฏ, ความชื้นสัมพัทธ์, ลมและลมกระโชก, เมฆ, ดัชนี UV + ensemble 6 ระบบ",
     "spatial": "ตำแหน่งที่กำหนดใน config และโทรมาตรจุดตรวจของตำแหน่งนั้น", "native": "รายชั่วโมง ล่วงหน้า 8 วัน",
     "update": "ทุกชั่วโมง", "latency": "ตามรอบของแต่ละแบบจำลอง (โดยทั่วไป 4–8 ชม. หลังเวลาเริ่มรอบ)",
     "storage": "branch data: runs/ (ฝนและอุณหภูมิ) · ฐานข้อมูล: forecast_point",
     "use": "หน้าพยากรณ์ของแต่ละตำแหน่ง · การตรวจสอบความถูกต้องในมุมมองผู้ใช้", "limits": "", "live": "om_locations"},
    {"id": "om_stations", "group": "fc", "name": "พยากรณ์ ณ สถานีอุตุนิยมวิทยาทุกแห่ง (จุดตรวจทั่วประเทศ)",
     "provider": "Open-Meteo", "url": "https://open-meteo.com/", "license": "CC BY 4.0 (ใช้งานไม่เชิงพาณิชย์)",
     "variables": "ฝนและอุณหภูมิรายชั่วโมงของทุกแบบจำลองระดับโลก", "spatial": "สถานีตรวจอากาศผิวพื้นทุกแห่งของกรมอุตุนิยมวิทยา จัดกลุ่มตามจังหวัด",
     "native": "รายชั่วโมง ล่วงหน้า 8 วัน", "update": "ทุก 6 ชม.", "latency": "ตามรอบของแต่ละแบบจำลอง",
     "storage": "branch data: runs/ · ฐานข้อมูล: forecast_point",
     "use": "การตรวจสอบความถูกต้องราย 3 ชม. และมุมมองผู้ใช้งานรายจังหวัด", "limits": "ไม่รวม ensemble เพื่อให้อยู่ในโควตาฟรี", "live": "om_stations"},
    {"id": "prevruns", "group": "fc", "name": "พยากรณ์ย้อนหลัง (Open-Meteo Previous Runs)",
     "provider": "Open-Meteo", "url": "https://open-meteo.com/en/docs/previous-runs-api", "license": "CC BY 4.0 (ใช้งานไม่เชิงพาณิชย์)",
     "variables": "ฝนและอุณหภูมิที่พยากรณ์ไว้ล่วงหน้า 1–7 วัน", "spatial": "สถานีอุตุนิยมวิทยาทุกแห่ง และโทรมาตรทุกเครื่อง",
     "native": "รายชั่วโมง", "update": "วันละครั้ง (หลังกรมอุตุนิยมวิทยาสรุปผล 07:00 น.)", "latency": "1 วัน",
     "storage": "branch data: verification/pairs/ · ฐานข้อมูล: verification_pair (obs_source = national, national3h) · "
                "ย้อนหลัง ก.ค. 2567 – ก.ย. 2569 ณ สถานีกรมอุตุฯ: release db-prevruns → forecast_prevrun",
     "use": "การตรวจสอบความถูกต้องระดับประเทศ ล่วงหน้า 24/72/168 ชม. · ชุดย้อนหลังใช้ศึกษาความถูกต้องหลายฤดูกาล (9 แบบจำลอง, ล่วงหน้า 1/2/3/5/7 วัน)",
     "limits": "previous_dayN ต่อกันจากหลายรอบ (ไม่ใช่ Day N จากรอบเดียว) · ชุดย้อนหลังดึงทีละเดือนภายในโควตาฟรี (~4,000 หน่วย/วัน) จนครบ", "live": "prevruns"},
    {"id": "province_fc", "group": "fc", "name": "พยากรณ์รายจังหวัด 7 วัน",
     "provider": "Open-Meteo (ECMWF IFS, ECMWF AIFS, NOAA GFS, DWD ICON)", "url": "https://open-meteo.com/", "license": "CC BY 4.0 (ใช้งานไม่เชิงพาณิชย์)",
     "variables": "อุณหภูมิสูงสุด/ต่ำสุด, ดัชนีความร้อนสูงสุด, ฝนรวม, ความน่าจะเป็นฝน (สัดส่วนแบบจำลอง)",
     "spatial": "จุดตัวแทนของ 77 จังหวัด", "native": "รายชั่วโมง → สรุปรายวัน", "update": "ทุก ~6 ชม.", "latency": "ตามรอบแบบจำลอง",
     "storage": "branch data: national/ · ฐานข้อมูล: forecast_district (site_id = prov:<รหัส>)",
     "use": "แท็บ 🇹🇭 ทั่วประเทศ", "limits": "ดัชนีความร้อนยังไม่ปรับแก้ความเอนเอียง", "live": "province_fc"},
    {"id": "heatsafe", "group": "fc", "name": "พยากรณ์ภัยความร้อนรายเขต กรุงเทพมหานคร",
     "provider": "Open-Meteo 9 แบบจำลอง + ค่าปรับแก้จากการทดสอบย้อนหลัง (HEAT-SAFE Bangkok)", "url": "", "license": "CC BY 4.0",
     "variables": "ดัชนีความร้อนสูงสุดรายวัน (ปรับแก้ความเอนเอียง), ระดับเตือนภัยตามเกณฑ์กรุงเทพมหานคร, ความน่าจะเป็นเกินเกณฑ์, อุณหภูมิ, ฝน",
     "spatial": "จุดตัวแทนของ 50 เขต", "native": "รายชั่วโมง → สรุปรายวัน 7 วัน", "update": "ทุก ~3 ชม.", "latency": "ตามรอบแบบจำลอง",
     "storage": "branch data: heatsafe/ · ฐานข้อมูล: forecast_district (site_id = bkkdist:<รหัส>)",
     "use": "แท็บ 🌡️ ภัยความร้อนรายเขต", "limits": "แบบจำลองกริด 9–55 กม. จำแนกความต่างระหว่างเขตได้จำกัด", "live": "heatsafe"},
    {"id": "grid", "group": "fc", "name": "พยากรณ์บนกริด th025 (ไฟล์ GRIB ของศูนย์พยากรณ์)",
     "provider": "ECMWF Open Data (IFS, AIFS) · NOAA NOMADS (GFS)", "url": "https://data.ecmwf.int/forecasts/",
     "license": "ECMWF: CC BY 4.0 · NOAA: สาธารณสมบัติ",
     "variables": "อุณหภูมิ, จุดน้ำค้าง, ความชื้นสัมพัทธ์, ฝน, ลม u/v, เมฆ, รังสีคลื่นสั้นขาลง",
     "spatial": "กริด 0.25° ครอบคลุมประเทศไทย 957 เซลล์", "native": "ราย 3–6 ชม. ล่วงหน้า 0–168 ชม. รอบ 00/12 UTC",
     "update": "วันละ 2 รอบ (09:20 และ 21:20 UTC)", "latency": "~8–10 ชม. หลังเวลาเริ่มรอบ",
     "storage": "ฐานข้อมูล: forecast_grid (release db-YYYY-MM)", "use": "แผนที่พยากรณ์ การตรวจสอบเชิงพื้นที่ งานวิจัย",
     "limits": "ไม่ประมาณค่าในช่วง (ใช้จุดกริดเดิมของแบบจำลอง)", "live": "grid"},
    {"id": "tmdwrf", "group": "fc", "name": "TMD WRF 2 กม.", "provider": "กรมอุตุนิยมวิทยา (NWP API)", "url": "https://data.tmd.go.th/nwpapi/",
     "license": "TMD Open Data (ต้องลงทะเบียน)", "variables": "ฝน, อุณหภูมิ และตัวแปรอื่นรายชั่วโมง", "spatial": "ตำแหน่งหลักและจุดตรวจ",
     "native": "รายชั่วโมง ล่วงหน้า 48 ชม.", "update": "ทุกชั่วโมง", "latency": "ตามรอบของกรมอุตุนิยมวิทยา",
     "storage": "branch data: runs/ · ฐานข้อมูล: forecast_point (model_id = tmd_wrf)", "use": "แบบจำลองความละเอียดสูงของประเทศไทย",
     "limits": "ต้องมี token", "live": "tmdwrf"},
    {"id": "google", "group": "fc", "name": "Google Weather", "provider": "Google Maps Platform", "url": "https://developers.google.com/maps/documentation/weather",
     "license": "ตามเงื่อนไขของ Google (ภายในโควตาฟรี)", "variables": "ฝน อุณหภูมิ ความชื้นรายชั่วโมง",
     "spatial": "ตำแหน่งหลัก (กรุงเทพมหานคร) และจุดตรวจ 2 จุด", "native": "รายชั่วโมง ล่วงหน้า 10 วัน", "update": "ทุกชั่วโมง (จุดตรวจทุก 2 ชม.)",
     "latency": "ต่อเนื่อง", "storage": "branch data: runs/ · ฐานข้อมูล: forecast_point", "use": "เปรียบเทียบแบบจำลองเชิงพาณิชย์",
     "limits": "จำกัดจำนวนคำขอให้อยู่ในโควตาฟรี", "live": "google"},
    {"id": "hii", "group": "fc", "name": "HII WRF-ROMS ฝนรายวัน", "provider": "สถาบันสารสนเทศทรัพยากรน้ำ (สสน.)", "url": "https://www.thaiwater.net/weather",
     "license": "เปิดเผย", "variables": "ช่วงฝนรายวัน (มม.) อ่านจากแถบสีของภาพ", "spatial": "ตำแหน่งหลักและโทรมาตรจุดตรวจ",
     "native": "รายวัน 19:00–19:00 น. ล่วงหน้า 7 วัน", "update": "วันละครั้ง (ภาพออก ~19:00 น.)", "latency": "~1–3 ชม.",
     "storage": "branch data: hii/ · ฐานข้อมูล: forecast_hii", "use": "เปรียบเทียบกับแบบจำลองอื่นที่โทรมาตร",
     "limits": "ค่าเป็นช่วงตามแถบสี ไม่ใช่ค่าต่อเนื่อง", "live": "hii"},
    {"id": "pairs", "group": "derived", "name": "คู่พยากรณ์–ค่าตรวจวัดและคะแนนความถูกต้อง", "provider": "ระบบนี้ (weather_verify.py)", "url": "",
     "license": "CC BY 4.0", "variables": "MAE, RMSE, ความเอนเอียง, POD, FAR, CSI, frequency bias, Brier score",
     "spatial": "ทุกจุดตรวจและสถานี", "native": "ตามค่าตรวจวัด", "update": "ทุกชั่วโมง", "latency": "ตามค่าตรวจวัด",
     "storage": "branch data: verification/ · ฐานข้อมูล: verification_pair", "use": "ส่วน 🏆 การตรวจสอบความถูกต้อง และแท็บทั่วประเทศ",
     "limits": "", "live": "pairs"},
    {"id": "refs", "group": "ref", "name": "ข้อมูลอ้างอิงเชิงพื้นที่", "provider": "Natural Earth · WorldPop · กรุงเทพมหานคร", "url": "https://www.naturalearthdata.com/",
     "license": "สาธารณสมบัติ / CC BY 4.0", "variables": "ขอบเขตจังหวัดและภาค (6 ภาคตามกรมอุตุนิยมวิทยา), กริด th025, ความหนาแน่นประชากรที่โทรมาตร, จุดตัวแทน 50 เขต",
     "spatial": "ประเทศไทย", "native": "คงที่", "update": "เมื่อมีการเปลี่ยนแปลง", "latency": "–",
     "storage": "resources/ · web/th_provinces.geojson · ฐานข้อมูล: grid_cell, site", "use": "การจัดกลุ่มและแผนที่", "limits": "", "live": None},
]

# ต้นทางปรับปรุง/เผยแพร่ข้อมูลใหม่บ่อยเพียงใด และเผยแพร่ช้ากว่าเวลาจริงเท่าใด (ไม่ใช่รอบการดึงของระบบนี้)
SOURCE_UPDATE = {
    "tmd3h": ("ทุก 3 ชม. ตามเวลามาตรฐานการตรวจอากาศ synoptic (01, 04, 07, 10, 13, 16, 19, 22 น.) · API แสดงเฉพาะรายงานล่าสุด", "~1 ชม. หลังเวลาตรวจ"),
    "tmdday": ("วันละครั้ง หลังสรุปผลเวลา 07:00 น.", "~1–2 ชม. หลัง 07:00 น."),
    "twday": ("โทรมาตรรายงานทุก 10–60 นาทีแล้วแต่หน่วยงาน · ค่าสะสม 07:00–07:00 น. ปิดยอดวันละครั้ง", "~1 ชม. หลัง 07:00 น."),
    "tw_check": ("ทุก 10–60 นาทีแล้วแต่หน่วยงานเจ้าของเครื่อง · ThaiWater เก็บรายชั่วโมงย้อนหลังเพียง ~36 ชม.", "~10–60 นาที"),
    "air4thai": ("รายชั่วโมง", "~20–60 นาที"),
    "user": ("ตามเหตุการณ์", "ทันที"),
    "ghcnh": ("NCEI ปรับปรุงไฟล์รายปีทุกวัน", "~3 วัน"),
    "gsod": ("หยุดปรับปรุง ส.ค. 2568", "–"),
    "era5land": ("ECMWF/Copernicus ปรับปรุงรายวัน (ERA5T) · ชุด DAILY_AGGR ใน Google Earth Engine ปรับปรุงตามมา", "~5 วัน (ECMWF) · ~1–2 สัปดาห์ (GEE)"),
    "imerg": ("ชุด Final ออกรายเดือน", "~3.5 เดือน"),
    "gsmap": ("รายชั่วโมง (v8 operational)", "~3 วัน"),
    "chirps": ("ชุด final ออกรายเดือน (ประมาณสัปดาห์ที่ 3 ของเดือนถัดไป) · ชุด preliminary ออกทุก 5 วัน (ไม่ได้ใช้)", "~3 สัปดาห์"),
    "om_locations": ("แต่ละแบบจำลองออกรอบใหม่ตามรอบการประมวลผลของศูนย์พยากรณ์ (ดูตารางแบบจำลองด้านล่าง) · Open-Meteo นำเข้าเมื่อศูนย์เผยแพร่", "ดูตารางแบบจำลอง"),
    "om_stations": ("ตามรอบของแต่ละแบบจำลอง (ดูตารางแบบจำลอง)", "ดูตารางแบบจำลอง"),
    "prevruns": ("ตามรอบของแต่ละแบบจำลอง", "ดูตารางแบบจำลอง"),
    "province_fc": ("ตามรอบของแบบจำลองที่ใช้ (ECMWF IFS/AIFS, GFS, ICON วันละ 4 รอบ)", "ดูตารางแบบจำลอง"),
    "heatsafe": ("ตามรอบของแบบจำลองที่ใช้ (ส่วนใหญ่วันละ 4 รอบ)", "ดูตารางแบบจำลอง"),
    "grid": ("ECMWF IFS/AIFS และ NOAA GFS ออกวันละ 4 รอบ (00/06/12/18 UTC) · ระบบเก็บรอบ 00/12 UTC ซึ่งมีระยะพยากรณ์ยาว", "IFS ~7–8 ชม. · AIFS ~6–7 ชม. · GFS ~4–5 ชม."),
    "tmdwrf": ("ตามรอบการประมวลผลของกรมอุตุนิยมวิทยา (ประมาณทุก 12 ชม.)", "~6 ชม."),
    "google": ("ปรับปรุงต่อเนื่อง (nowcast + พยากรณ์ AI)", "ไม่มีรอบชัดเจน"),
    "hii": ("วันละครั้ง (ภาพรอบ 19:00 น.)", "~1–3 ชม."),
    "pairs": ("คำนวณเมื่อมีค่าตรวจวัดใหม่", "ตามค่าตรวจวัด"),
    "refs": ("คงที่", "–"),
}

SCHEDULE = [
    ("ทุกชั่วโมง", "collect.yml", "พยากรณ์ ณ ตำแหน่งหลักและจุดตรวจ, ค่าตรวจวัด TMD/ThaiWater/Air4Thai, การตรวจสอบความถูกต้อง, หน้าเว็บ"),
    ("ทุก ~3 ชม.", "collect.yml", "พยากรณ์ภัยความร้อนรายเขต กรุงเทพมหานคร"),
    ("ทุก ~6 ชม.", "collect.yml", "พยากรณ์รายจังหวัด และพยากรณ์ ณ สถานีอุตุนิยมวิทยาทุกแห่ง"),
    ("วันละครั้ง", "collect.yml", "ฝนรายวันโทรมาตรทุกเครื่อง, Previous Runs ทั่วประเทศ, HII WRF-ROMS"),
    ("วันละ 2 รอบ (09:20, 21:20 UTC)", "database.yml", "พยากรณ์กริด th025 และแปลงคลังรายชั่วโมงเข้าฐานข้อมูล (ล่าช้า 2 วัน)"),
    ("รายเดือน (วันที่ 3)", "database.yml", "GHCNh ปีปัจจุบัน, ERA5-Land/CHIRPS 3 เดือนล่าสุด, รวมไฟล์รายเดือน, ลดขนาดคลังระยะสั้น"),
]


# ---------------------------------------------------------------------------- สถิติจากข้อมูลจริง
def _files(archive, sub, pattern="*.csv*"):
    return sorted((Path(archive) / sub).glob(pattern))


def _obs_stats(archive, kind, id_col="id", time_col="time"):
    files = _files(archive, f"obs/{kind}")
    if not files:
        return {}
    last = pd.concat([pd.read_csv(f, dtype={id_col: str}) for f in files[-2:]], ignore_index=True)
    out = {"count": int(last[id_col].nunique()), "first": files[0].name[:10]}
    if time_col in last:
        out["latest"] = str(pd.to_datetime(last[time_col], errors="coerce").max())[:16]
    return out


def _coords(archive, kind, name_col="name"):
    files = _files(archive, f"obs/{kind}")
    if not files:
        return []
    d = pd.concat([pd.read_csv(f, dtype={"id": str}) for f in files[-2:]], ignore_index=True).drop_duplicates("id", keep="last")
    return [[str(r.id), str(getattr(r, name_col, "")), round(float(r.lat), 4), round(float(r.lon), 4)] for r in d.itertuples()
            if pd.notna(r.lat) and pd.notna(r.lon)]


def _ghcnh_stations(archive):
    cache = Path(archive) / "catalog" / "ghcnh_stations.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < GHCNH_CACHE_DAYS * 86400:
        return json.loads(cache.read_text(encoding="utf-8"))
    try:
        from wxdb import history
        st = history.stations()
        rows = [[r.ghcnh_id, r.name, r.lat, r.lon] for r in st.itertuples()]
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return rows
    except Exception as e:                              # noqa: BLE001 — ใช้แคชเดิมถ้ามี
        print(f"⚠️ แค็ตตาล็อก GHCNh: {e}")
        return json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else []


def _manifest():
    try:
        import requests                                 # อ่าน URL สาธารณะตรง ๆ (collect.yml ไม่ได้ติดตั้ง pyarrow)
        repo = os.environ.get("GITHUB_REPOSITORY", "Navavit/consolidated-weather")
        r = requests.get(f"https://github.com/{repo}/releases/download/db-catalog/manifest.json", timeout=60)
        r.raise_for_status()
        return r.json()
    except Exception as e:                              # noqa: BLE001
        print(f"⚠️ แค็ตตาล็อก manifest: {e}")
        return {"files": []}


def _span(man, table, release_prefix=None, name_part=None):
    fs = [f for f in man.get("files", []) if f["table"] == table and f.get("tmin")
          and (release_prefix is None or f["release"].startswith(release_prefix)) and (name_part is None or name_part in f["name"])]
    if not fs:
        return {}
    return {"from": min(f["tmin"] for f in fs)[:10], "to": max(f["tmax"] for f in fs)[:10],
            "rows": sum(f.get("rows", 0) for f in fs), "bytes": sum(f.get("bytes", 0) for f in fs), "files": len(fs)}


def _first_run(archive, pts, frac=0.0):
    """วันแรกที่จุดชุดนี้มีไฟล์พยากรณ์ใน runs/ (ชื่อไฟล์ <เวลาดึง>_<lat>_<lon>.csv.gz) ครบเกินสัดส่วน frac — None ถ้าไม่พบ
    frac > 0 ใช้กับชุดที่บางจุดเคยเป็นจุดตรวจมาก่อน เพื่อให้ได้วันที่ชุดนั้นเริ่มเก็บจริง"""
    keys = {f"_{p['lat']:.3f}_{p['lon']:.3f}.csv.gz" for p in pts}
    seen = set()
    for d in sorted((Path(archive) / "runs").glob("*/*/*")):
        seen |= {f.name[15:] for f in d.glob("*.csv.gz")} & keys
        if seen and len(seen) > frac * len(keys):
            return "-".join(d.parts[-3:])
    return None


def _first_file(archive, sub, n=10):
    files = sorted((Path(archive) / sub).glob("*.csv*"))
    return files[0].name[:n] if files else None


def live_stats(archive, man):
    a = Path(archive)
    pts = json.loads((a / "verification" / "points.json").read_text(encoding="utf-8")) if (a / "verification" / "points.json").exists() else []
    live = {"tmd3h": _obs_stats(a, "tmd3h"), "tmdday": _obs_stats(a, "tmdday"), "twday": _obs_stats(a, "twday", time_col="_"),
            "air4thai": _obs_stats(a, "air4thai")}
    tw = [p for p in pts if p["kind"] == "tw"]
    live["tw_check"] = {"count": len(tw), "active": sum(p.get("active", True) for p in tw), **{k: v for k, v in _obs_stats(a, "tw1h").items() if k != "count"}}
    obs = sorted((a / "observations").glob("*.json"))
    live["user"] = {"count": len(obs)}
    nat = [p for p in pts if p.get("national")]
    loc = [p for p in pts if not p.get("national")]
    live["om_locations"] = {"count": len(loc) + len(core.resolve_locations()), "models": len(core.active_models()) + 2,
                            "ensembles": len(core.active_ensembles())}
    live["om_stations"] = {"count": len(nat), "provinces": len({p["for"] for p in nat}), "models": len(core.active_models())}
    pf = a / "national" / "forecast.json"
    if pf.exists():
        j = json.loads(pf.read_text(encoding="utf-8"))
        live["province_fc"] = {"count": len(j.get("provinces", [])), "latest": j.get("generated", "")[:16].replace("T", " ")}
    hs = a / "heatsafe" / "latest.json"
    if hs.exists():
        j = json.loads(hs.read_text(encoding="utf-8"))
        live["heatsafe"] = {"count": len(j.get("districts", [])), "latest": j.get("generated", "")[:16].replace("T", " "), "models": len(j.get("models", []))}
    hii = sorted((a / "hii").glob("*.csv"))
    live["hii"] = {"first": hii[0].name[:8], "latest": hii[-1].name[:13]} if hii else {}
    pairs = sorted((a / "verification" / "pairs").glob("*.csv.gz"))
    live["pairs"] = {"first": pairs[0].name[:7] if pairs else None, "files": len(pairs)}
    live["ghcnh"] = {**_span(man, "observation", "db-history", "ghcnh")}
    live["gsod"] = {**_span(man, "observation", "db-history", "gsod")}
    live["era5_land"] = {**_span(man, "reanalysis_daily", "db-history", "era5_land")}
    live["chirps"] = {**_span(man, "reanalysis_daily", "db-history", "chirps")}
    live["imerg"] = {**_span(man, "reanalysis_daily", "db-history", "imerg")}
    live["gsmap"] = {**_span(man, "reanalysis_daily", "db-history", "gsmap")}
    live["prevruns_db"] = {**_span(man, "forecast_prevrun", "db-prevruns")}
    live["grid"] = {**_span(man, "forecast_grid"), "cells": 957}
    # วันแรกที่ระบบมีข้อมูล (ความครอบคลุมเชิงเวลาของแอป) สำหรับชุดที่ไม่มีในสถิติข้างต้น
    runs0 = _first_run(a, [{"lat": la, "lon": lo} for la, lo, *_ in core.resolve_locations()] + loc)
    live["om_locations"]["first"] = runs0
    live["om_stations"]["first"] = _first_run(a, nat, frac=0.5)
    live["tmdwrf"] = live["google"] = {"first": runs0}
    live.setdefault("province_fc", {})["first"] = _first_file(a, "national/daily")
    live.setdefault("heatsafe", {})["first"] = _first_file(a, "heatsafe/daily")
    if obs:
        first = json.loads(obs[0].read_text(encoding="utf-8"))
        live["user"].update({"first": first.get("obs_time", "")[:10],
                             "latest": json.loads(obs[-1].read_text(encoding="utf-8")).get("obs_time", "")[:16]})
    live["prevruns"] = {"first": min(filter(None, [live["tmdday"].get("first"), _first_file(a, "verification/gauges"), live["prevruns_db"].get("from")]), default=None)}
    live["pairs"]["first"] = min(filter(None, [live["tmd3h"].get("first"), live["tmdday"].get("first")]), default=live["pairs"]["first"])
    return live, pts


def model_meta():
    """รอบการประมวลผลจริงของแต่ละแบบจำลองจาก metadata ของ Open-Meteo: ช่วงห่างระหว่างรอบ ความละเอียดเชิงเวลา
    ความล่าช้าของรอบล่าสุด (เวลาเผยแพร่ − เวลาเริ่มรอบ) และสถานะ (หยุดปรับปรุงหากรอบล่าสุดเก่ากว่า 3 เท่าของช่วงห่าง + 1 วัน)"""
    now = time.time()
    rows = []
    for name, ds in core.RUN_META.items():
        m = {**core.DETERMINISTIC_MODELS, **core.ENSEMBLE_MODELS}
        info = next((v for v in m.values() if v["name"] == name), {})
        row = {"name": name, "kind": "ensemble" if name in [v["name"] for v in core.ENSEMBLE_MODELS.values()] else "deterministic",
               "grid_km": info.get("grid_km"), "agency": info.get("agency", "")}
        if ds:
            try:
                j = core.SESSION.get(core.RUN_META_URL.format(ds), timeout=30).json()
                iv, res = j.get("update_interval_seconds"), j.get("temporal_resolution_seconds")
                init, avail = j.get("last_run_initialisation_time"), j.get("last_run_availability_time")
                row.update({"interval_h": iv / 3600 if iv else None, "per_day": round(86400 / iv) if iv else None,
                            "resolution_h": res / 3600 if res else None,
                            "last_init": pd.Timestamp(init, unit="s").strftime("%Y-%m-%d %H:%MZ") if init else None,
                            "latency_h": round((avail - init) / 3600, 1) if init and avail else None,
                            "stale": bool(init and iv and now - init > 3 * iv + 86400), "source": "metadata"})
            except Exception as e:                      # noqa: BLE001
                row["error"] = str(e)[:80]
        elif name in core.RUN_CYCLE:
            cyc, lat = core.RUN_CYCLE[name]
            row.update({"interval_h": cyc, "per_day": round(24 / cyc), "latency_h": lat, "source": "ประมาณ (ไม่มี metadata)"})
        rows.append(row)
    for name, (cyc, lat) in core.RUN_CYCLE.items():
        if name not in core.RUN_META:
            rows.append({"name": name, "kind": "regional", "interval_h": cyc, "per_day": round(24 / cyc), "latency_h": lat,
                         "source": "ประมาณ (ไม่มี metadata)"})
    return rows


def build(archive, site_dir):
    man = _manifest()
    live, pts = live_stats(archive, man)
    tot = man.get("totals", {})
    ghcnh = _ghcnh_stations(archive)
    live["ghcnh"]["count"] = len(ghcnh)
    payload = {
        "generated": pd.Timestamp.now(tz="Asia/Bangkok").isoformat(timespec="minutes"),
        "datasets": [{**d, "source_update": SOURCE_UPDATE.get(d["id"], ("", ""))[0], "latency": SOURCE_UPDATE.get(d["id"], ("", d.get("latency", "")))[1],
                      "stats": live.get(d["live"], {}) if d["live"] else {}} for d in DATASETS],
        "model_runs": model_meta(),
        "schedule": [{"when": w, "workflow": f, "what": x} for w, f, x in SCHEDULE],
        "database": {"generated": man.get("generated"), "base_url": man.get("base_url"),
                     "tables": {t: {**v, **_span(man, t)} for t, v in tot.items()},
                     "total_bytes": sum(v.get("bytes", 0) for v in tot.values()),
                     "total_rows": sum(v.get("rows", 0) for v in tot.values())},
        "models": [{"name": m["name"], "agency": m["agency"], "type": m["type"], "grid_km": m["grid_km"]}
                   for m in list(core.DETERMINISTIC_MODELS.values()) + [core.TMD_MODEL, core.GOOGLE_MODEL]],
        "ensembles": [{"name": m["name"], "members": m["members"], "grid_km": m["grid_km"]} for m in core.ENSEMBLE_MODELS.values()],
        "layers": {"tmd": _coords(archive, "tmd3h"), "air4thai": _coords(archive, "air4thai"), "ghcnh": ghcnh,
                   "check": [[p["key"], p["name"], p["lat"], p["lon"], p.get("for", ""), bool(p.get("national"))] for p in pts]},
    }
    out = Path(site_dir) / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "catalog.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str), encoding="utf-8")
    return payload


if __name__ == "__main__":
    import sys
    build(sys.argv[1] if len(sys.argv) > 1 else core.ROOT / "archive", sys.argv[2] if len(sys.argv) > 2 else "site")
