# Heat forecast back test at Bangkok stations (24/72/168 h)
Generated: 2026-10-26 10:07

## What was done
- Open-Meteo Previous Runs 9 โมเดล (ล่วงหน้า ≥ 24/72/168 ชม.) รายชั่วโมง 2024-01-01 – 2026-10-25 ที่ 7 สถานีใน กทม./รอบเขต
- จับคู่กับค่าวัดรายชั่วโมง (wxdb: METAR + synop กรมอุตุฯ) → MAE, RMSE, bias ของอุณหภูมิ ความชื้น HI แยกระยะ: ทุกช่วง / ฤดูร้อน / วันร้อนจัด (HI ≥ 42)
- ทายวันระดับส้มรายวัน: POD/FAR/CSI และความน่าจะเป็นจากหลายโมเดล (Brier, reliability)

## Headline metrics
| Metric | Value |
|---|---|
| คู่พยากรณ์–ค่าวัด (ชั่วโมง) | 2,480,379 |
| อุณหภูมิ ค่าเฉลี่ยหลายโมเดล 24 ชม.: MAE / RMSE | 1.18 / 1.48 °C |
| อุณหภูมิ ค่าเฉลี่ยหลายโมเดล 72 ชม.: MAE / RMSE | 1.21 / 1.53 °C |
| อุณหภูมิ ค่าเฉลี่ยหลายโมเดล 168 ชม.: MAE / RMSE | 1.51 / 1.89 °C |
| HI วันร้อนจัด ค่าเฉลี่ยหลายโมเดล 24 ชม.: MAE / RMSE / bias | 2.62 / 3.23 / -1.74 °C |
| HI วันร้อนจัด ค่าเฉลี่ยหลายโมเดล 72 ชม.: MAE / RMSE / bias | 2.63 / 3.25 / -1.65 °C |
| HI วันร้อนจัด ค่าเฉลี่ยหลายโมเดล 168 ชม.: MAE / RMSE / bias | 3.17 / 3.82 / -2.38 °C |
| ทายวันส้ม 24 ชม.: POD / FAR / CSI | 0.24 / 0.11 / 0.23 |
| ทายวันส้ม 72 ชม.: POD / FAR / CSI | 0.24 / 0.17 / 0.23 |
| ทายวันส้ม 168 ชม.: POD / FAR / CSI | 0.20 / 0.25 / 0.19 |
| Brier skill (ความน่าจะเป็นหลายโมเดล) 24 ชม. | 0.02 |
| Brier skill (ความน่าจะเป็นหลายโมเดล) 72 ชม. | 0.03 |
| Brier skill (ความน่าจะเป็นหลายโมเดล) 168 ชม. | -0.10 |
| เกณฑ์พยากรณ์ใหม่ 24 ชม. (ทดสอบ 2026): POD / FAR / CSI | ≥ 39.5 °C → 0.73 / 0.40 / 0.49 (เทียบ @42: 0.11 / 0.06 / 0.11) |
| เกณฑ์พยากรณ์ใหม่ 72 ชม. (ทดสอบ 2026): POD / FAR / CSI | ≥ 39.5 °C → 0.86 / 0.41 / 0.54 (เทียบ @42: 0.07 / 0.17 / 0.07) |
| เกณฑ์พยากรณ์ใหม่ 168 ชม. (ทดสอบ 2026): POD / FAR / CSI | ≥ 39.0 °C → 0.90 / 0.43 / 0.53 (เทียบ @42: 0.13 / 0.27 / 0.12) |

## Notable observations
- ตัดค่าพยากรณ์ผิดปกติ 9,527 ค่า (ห่างจากมัธยฐานโมเดลอื่น > 6 °C) ส่วนใหญ่ CMA GRAPES เม.ย.–มิ.ย. 2024
- ค่าเว็บ consolidated-weather (~1.3 °C) = MAE อุณหภูมิราย 3 ชม. สถานีทั่วประเทศ 30 วันล่าสุด แยกระยะ — ตารางนี้เป็นเฉพาะ กทม. ย้อนหลังตั้งแต่ 2024
- MAE = ผิดเฉลี่ย · RMSE ≥ MAE เสมอ ยิ่งห่างกันมาก = มีบางครั้งที่พลาดมาก
- ค่าเฉลี่ยหลายโมเดลที่ 168 ชม. มีโมเดลน้อยกว่า (ICON, ARPEGE, UKMO ไม่มีระยะนี้ในคลังย้อนหลัง)
- โมเดลโลกกริด 9–28 กม. → สถานีใน กทม. หลายแห่งตกกริดเดียวกัน ความต่างระหว่างเขตมาจากค่าวัด ไม่ใช่จากพยากรณ์

## Outputs produced
- resources/heatsafe_calibration.json
- outputs/heat_backtest/fc_backtest_hourly.parquet
- analysis/heat_backtest/fc_backtest_scores.csv
- analysis/heat_backtest/fc_alert_scores.csv
- analysis/heat_backtest/fc_reliability.csv
- analysis/heat_backtest/fc_alert_threshold.csv
- analysis/heat_backtest/backtest_errors.png
- analysis/heat_backtest/alert_skill.png

## Recommended next steps
- ปรับแก้ bias ของพยากรณ์ด้วยค่าวัดย้อนหลัง (bias correction) ก่อนใช้กับเกณฑ์ 42 °C
- ทดสอบ TMD WRF 2 กม. เมื่อมีคลังย้อนหลังพอ (ตาราง forecast_point)
