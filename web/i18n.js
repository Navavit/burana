/* ภาษาของหน้าเว็บ: ไทย (ค่าเริ่มต้น) / English — ใช้ร่วมกันทั้ง index.html และ data.html (โหลดก่อนสคริปต์หลัก)
   - ข้อความคงที่ใน HTML: เขียนคู่กัน <span lang="th">…</span><span lang="en">…</span> แล้ว CSS ซ่อนภาษาที่ไม่ได้เลือก
   - attribute (aria-label, title, alt, placeholder): ใส่ค่าภาษาอังกฤษใน data-en-<ชื่อ attribute>
   - ข้อความที่สคริปต์สร้าง: T("ไทย", "English")
   - ข้อความภาษาไทยที่มาจากไฟล์ข้อมูล (ชื่อตัวแปร ระดับเตือน หน่วยงาน ภาค จังหวัด): tx("…")
   เลือกภาษาด้วยปุ่ม #lang (จำไว้ต่อเครื่อง) หรือ ?lang=en ใน URL */
"use strict";

const LANG = (() => {
  let v = null;
  try { v = new URLSearchParams(location.search).get("lang") || localStorage.getItem("lang"); } catch { /* ไม่มี storage */ }
  return v === "en" ? "en" : "th";
})();
const EN = LANG === "en";
const T = (th, en) => (EN ? en : th);
const LOCALE = EN ? "en-GB" : "th-TH";
document.documentElement.lang = LANG;

// ข้อความภาษาไทยในไฟล์ข้อมูล → ภาษาอังกฤษ
const TX = {
  // ตัวแปรและหน่วย (meta.json / loc-*.json)
  "ฝน": "Rain", "โอกาสฝน (ของโมเดล)": "Rain chance (model)", "อุณหภูมิสูงสุด": "Max temperature", "อุณหภูมิต่ำสุด": "Min temperature",
  "อุณหภูมิที่รู้สึก (สูงสุด)": "Feels-like (max)", "ความชื้นสัมพัทธ์ (เฉลี่ย)": "Humidity (mean)", "ความเร็วลม (สูงสุด)": "Wind speed (max)",
  "ลมกระโชก (สูงสุด)": "Wind gust (max)", "เมฆปกคลุม (เฉลี่ย)": "Cloud cover (mean)", "ดัชนี UV (สูงสุด)": "UV index (max)",
  "มม.": "mm", "กม./ชม.": "km/h",
  // ระดับเตือน (ตามหลังไอคอน)
  "ต่ำกว่าเกณฑ์": "Below threshold", "เฝ้าระวัง": "Caution", "เตือนภัย": "Warning", "อันตราย": "Danger", "อันตรายมาก": "Extreme danger",
  "ต่ำ": "Low", "ปานกลาง": "Moderate", "สูง": "High", "สูงมาก": "Very high",
  "ดีมาก": "Very good", "ดี": "Good", "เริ่มมีผลต่อสุขภาพ": "Unhealthy for sensitive groups", "มีผลต่อสุขภาพ": "Unhealthy",
  // แหล่งพยากรณ์ในผลการตรวจสอบ
  "ค่ากลางทุกโมเดล": "All-model median", "โอกาสฝน (ensemble)": "Rain chance (ensemble)", "ทุกตำแหน่ง": "Nationwide",
  // ภาคของกรมอุตุนิยมวิทยา
  "ภาคกลาง": "Central", "ภาคตะวันออก": "East", "ภาคตะวันออกเฉียงเหนือ": "Northeast", "ภาคเหนือ": "North",
  "ภาคใต้ฝั่งตะวันตก": "South (west coast)", "ภาคใต้ฝั่งตะวันออก": "South (east coast)",
  "เมือง": "urban", "ชานเมือง": "suburban", "ชนบท": "rural",
  // หน่วยงานเจ้าของโทรมาตร (ThaiWater)
  "สสน.": "HII", "ทน.": "DWR", "ปภ.": "DDPM", "ชป.": "RID", "อต.": "TMD", "กฟผ.": "EGAT", "สนน กทม.": "BMA DDS", "สนน. กทม.": "BMA DDS",
  "อื่น ๆ": "Other",
  // ขนาดกริดที่เป็นข้อความ
  "2 กม. (hourly, 48 ชม.)": "2 km (hourly, 48 h)",
  "ฝน ~5 กม. (0.05°) · อุณหภูมิ/ความชื้น หยาบกว่า (>13 กม.)": "rain ~5 km (0.05°) · temperature/humidity coarser (>13 km)",
};
// คำในวงเล็บของชื่อหน่วยงาน
const TX_WORDS = [["กรมอุตุนิยมวิทยา (ไทย)", "Thai Meteorological Department"], ["โครงการวิจัย วช. 2570", "NRCT 2027 research project"],
  ["ตำแหน่งของผู้ใช้ (GPS)", "My location (GPS)"], ["ตำแหน่งของผู้ใช้", "My location"], ["ตำแหน่ง GPS", "GPS location"], ["ตรงที่ฉันอยู่ (GPS)", "My location (GPS)"], ["สถาปัตยกรรม GraphCast ของ Google DeepMind", "GraphCast architecture by Google DeepMind"],
  ["ยุโรป", "Europe"], ["อังกฤษ", "UK"], ["เกาหลีใต้", "South Korea"], ["สหรัฐฯ", "USA"], ["เยอรมนี", "Germany"], ["จีน", "China"],
  ["ออสเตรเลีย", "Australia"], ["แคนาดา", "Canada"], ["ฝรั่งเศส", "France"], ["ญี่ปุ่น", "Japan"]];
// ชื่อจังหวัด (เติมจาก meta.json เมื่อโหลดแล้ว)
const PLACE_EN = {};
function setPlaces(list) { for (const p of list || []) if (p.name_en) PLACE_EN[p.name] = p.name_en; }

const THAI = /[฀-๿]/;
function tx(s) {
  if (!EN || s == null) return s;
  s = String(s);
  if (TX[s]) return TX[s];
  if (PLACE_EN[s]) return PLACE_EN[s];
  let o = s;
  for (const [a, b] of TX_WORDS) o = o.split(a).join(b);
  o = o.replace(/\s?ชม\./g, " h").replace(/\s?วัน/g, " days").replace(/^สถานี/, "");
  if (PLACE_EN[o]) return PLACE_EN[o];
  return THAI.test(o) ? s : o;                // แปลได้ไม่หมด = คงข้อความเดิม (ชื่อเฉพาะ)
}

function initLang() {
  if (EN) {
    document.querySelectorAll("*").forEach((n) => {
      for (const a of [...n.attributes]) if (a.name.startsWith("data-en-")) n.setAttribute(a.name.slice(8), a.value);
    });
    const t = document.querySelector("meta[name=title-en]");
    if (t) document.title = t.content;
  }
  const b = document.getElementById("lang");
  if (b) {
    b.textContent = EN ? "ไทย" : "EN";
    b.setAttribute("aria-label", EN ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English");
    b.onclick = () => {
      try { localStorage.setItem("lang", EN ? "th" : "en"); } catch { /* ไม่มี storage ก็ใช้ ?lang= */ }
      const u = new URL(location.href);
      if (EN) u.searchParams.delete("lang"); else u.searchParams.set("lang", "en");
      location.replace(u.toString());
    };
  }
}
initLang();
