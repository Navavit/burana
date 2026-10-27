# ให้ระบบรันทุกชั่วโมงอย่างสม่ำเสมอ

GitHub Actions ข้ามรอบตามตาราง (`schedule`) บ่อยเมื่อเครื่องของ GitHub แน่น — ช่วง 27–30 ก.ย. 2026 รันจริงห่างกัน 4–7 ชม. ทั้งที่ตั้งไว้ทุกชั่วโมง
จึงใช้ 2 ทางพร้อมกัน

1. **ตารางของ GitHub 2 เวลาต่อชั่วโมง** (นาทีที่ 7 และ 37) — ตั้งไว้ใน `.github/workflows/collect.yml` แล้ว
2. **บริการภายนอกสั่งรันผ่าน GitHub API ทุก 30 นาที (นาทีที่ 5 และ 35)** (cron-job.org ฟรี) — ตั้งตามขั้นตอนด้านล่าง · เป็นตัวสั่งรันหลัก (ต.ค. 2026: ตารางของ GitHub รันจริงเพียง ~8 จาก 48 รอบต่อวัน)

รอบที่ห่างจากรอบที่สำเร็จก่อนหน้าไม่ถึง 50 นาทีจะข้ามเอง (ขั้น "ข้ามถ้าเพิ่งรันไป" ใช้เวลา ~20 วินาที)
จึงไม่ดึงข้อมูลซ้ำและไม่เปลืองโควตา Open-Meteo / Google Weather (Google มีเพดานรายเดือนอีกชั้นใน `google_usage.json`)
ถ้าต้องการรันทันทีโดยไม่สนช่วง 50 นาที: แท็บ Actions → Run workflow → ติ๊ก `force` หรือ `gh workflow run collect.yml -f force=true`

## ขั้นที่ 1: สร้าง token ที่สั่งรัน workflow ได้อย่างเดียว

1. GitHub → รูปโปรไฟล์ → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. ตั้งค่า
   - Token name: `cron-job.org burana`
   - Expiration: ไม่มีวันหมดอายุ (ใช้อยู่ตั้งแต่ 27 ต.ค. 2026) — สิทธิ์จำกัดเฉพาะ Actions ของ repo นี้ · ถ้าตั้งวันหมดอายุ ให้ใส่ปฏิทินเตือนต่ออายุ
   - Repository access: **Only select repositories** → `burana`
   - Permissions → Repository permissions → **Actions: Read and write** (ที่เหลือปล่อย No access)
3. กด Generate แล้วคัดลอก token ไว้ (แสดงครั้งเดียว) — **อย่าวางในแชต อย่าใส่ใน repo**

token นี้ทำได้แค่สั่งรัน/ยกเลิก workflow ของ repo นี้ ถ้าหลุดก็ลบทิ้งและสร้างใหม่ได้ทันที ไม่กระทบโค้ดหรือข้อมูล

## ขั้นที่ 2: ตั้งงานที่ cron-job.org

1. สมัครที่ https://cron-job.org (ฟรี) → **Create cronjob**
2. แท็บ Common
   - Title: `burana hourly`
   - URL: `https://api.github.com/repos/Navavit/burana/actions/workflows/collect.yml/dispatches`
   - Execution schedule: crontab expression **`5,35 * * * *`** (ค่าที่ใช้อยู่ตั้งแต่ 27 ต.ค. 2026)
     รอบนาทีที่ 5 รันเต็ม (~25–35 นาที) รอบนาทีที่ 35 ห่างไม่ถึง 50 นาทีจึงข้าม และเป็นรอบสำรองเมื่อรอบนาทีที่ 5 ล้มเหลว
     → รอบเต็มชั่วโมงละครั้ง · ไม่ใช้นาทีที่ 0/30 ซึ่งเป็นช่วงที่ GitHub มีงานเข้าพร้อมกันมาก
3. แท็บ Advanced
   - Request method: **POST**
   - Headers (กด Add ทีละบรรทัด)
     | Key | Value |
     |---|---|
     | `Accept` | `application/vnd.github+json` |
     | `Authorization` | `Bearer <token จากขั้นที่ 1>` |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |
   - Request body: `{"ref":"main"}`
   - Timeout: 30 วินาที
4. แท็บ Notifications: เปิด "Notify me when execution fails" (เช่น token หมดอายุ)
5. Save แล้วกด **Test run** → ต้องได้ **HTTP 204** และมีรอบใหม่ขึ้นในแท็บ Actions ของ GitHub

| ผลที่ได้ | สาเหตุ |
|---|---|
| 204 | สำเร็จ |
| 401 | token ผิดหรือหมดอายุ |
| 403 / 404 | token ไม่ได้เลือก repo นี้ หรือไม่ได้ให้สิทธิ์ Actions: Read and write |
| 422 | body ผิด (ต้องเป็น `{"ref":"main"}`) |

## ตรวจว่าทำงานสม่ำเสมอ

```bash
gh run list --workflow=collect.yml -L 24 --json createdAt,event,conclusion
```
`event` = `workflow_dispatch` คือรอบจาก cron-job.org, `schedule` คือรอบจาก GitHub · รอบที่ข้ามเพราะเพิ่งรันไปจะจบเร็วและไม่มีขั้น deploy
