# Consolidated Weather — แนวทางการทำงานใน workspace นี้

## บทบาท
- ระบบกลางรวบรวมข้อมูลอากาศและแบบจำลองพยากรณ์ของประเทศไทย (ค่าตรวจวัด พยากรณ์ ข้อมูลย้อนหลัง การตรวจสอบความถูกต้อง) → ฐานข้อมูล wxdb บน GitHub Releases และหน้าเว็บ GitHub Pages
- งานประยุกต์ (เช่น HEAT-SAFE Bangkok) อยู่ใน workspace/repository ของตนเอง และ**อ่าน**ข้อมูลจากที่นี่ — การวิเคราะห์เฉพาะโครงการให้ทำในฝั่งงานประยุกต์
- ข้อยกเว้นชั่วคราว: `weather_heatsafe.py`, `resources/heatsafe_calibration.json`, แท็บ 🌡️ (#heat) และ `analysis/heat_forecast_backtest.ipynb` (ทดสอบย้อนหลังที่สร้างค่าปรับแก้ — ย้ายมาจาก NB10 ของ HEAT-SAFE) เป็นส่วนของ HEAT-SAFE ที่ฝากรันไว้ที่นี่ · notebook นี้เขียนค่าปรับแก้ลง `resources/heatsafe_calibration.json` โดยตรง (ค่าที่ใช้งานจริง — ตรวจผลก่อน commit) · ผลใน `analysis/heat_backtest/` ถูกงานประยุกต์ดาวน์โหลดไปใช้ (อย่าเปลี่ยนชื่อไฟล์โดยไม่แก้ฝั่งนั้น)

## ข้อกำหนด
- Repository สาธารณะ: ห้ามใส่ข้อมูลเฉพาะของงานประยุกต์ (เช่น HVI, พื้นที่เป้าหมาย, ชื่อ repository ส่วนตัว) และห้าม commit `.env`, `config.local.json`, token หรือ GEE project ID (อ่านจาก `.env` เท่านั้น)
- ไม่มีค่าใช้จ่าย: ใช้เฉพาะบริการฟรี (GitHub Actions/Releases/Pages ของ repo สาธารณะ, Open-Meteo ภายในโควตา, ECMWF Open Data, NOAA) — ไม่ใช้ Git LFS, S3/R2 หรือ API แบบเสียเงิน
- เวลาในฐานข้อมูลเป็น UTC · โครงสร้างตารางกำหนดใน `wxdb/schema.py` แล้วสร้างเอกสารด้วย `python scripts/build_db_docs.py`
- งานที่เขียน manifest ร่วมกัน (`python -m wxdb ...`) รันทีละงาน · การดึงผ่าน GEE ทำในเครื่องด้วย `.venv` ของ repository นี้
- ภาษาในเอกสารและหน้าเว็บ: ภาษาไทยเชิงวิชาการ
