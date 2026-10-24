/* หน้าข้อมูลและแหล่งที่มา — อ่าน data/catalog.json (weather_catalog.py) และ data/stations.json */
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style") n.style.cssText = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const num = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString("th-TH", { maximumFractionDigits: d }));
const size = (b) => (b == null ? "–" : b >= 1e9 ? `${num(b / 1e9, 2)} GB` : b >= 1e6 ? `${num(b / 1e6, 1)} MB` : `${num(b / 1e3, 0)} KB`);
const dt = (s) => (s ? new Date(s.length === 10 ? s : s.replace(" ", "T")).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "–");
const GROUPS = { obs: "ค่าตรวจวัด", hist: "ข้อมูลย้อนหลัง", fc: "ผลพยากรณ์", derived: "ผลการประมวลผล", ref: "ข้อมูลอ้างอิง" };

// จำนวน/ขอบเขต และช่วงเวลา ของแต่ละชุดข้อมูล (จากสถิติจริง)
function coverage(d) {
  const s = d.stats || {};
  const c = {
    tmd3h: s.count && `${num(s.count)} สถานี`, tmdday: s.count && `${num(s.count)} สถานี`, twday: s.count && `${num(s.count)} เครื่อง`,
    tw_check: s.count && `${num(s.active)} เครื่องที่รายงานอยู่ (จาก ${num(s.count)})`, air4thai: s.count && `${num(s.count)} สถานี`,
    user: `${num(s.count)} รายงาน`, ghcnh: s.count && `${num(s.count)} สถานี`, era5land: "957 เซลล์ (0.25°)", chirps: "957 เซลล์ (0.25°)",
    om_locations: s.count && `${num(s.count)} จุด · ${num(s.models)} แบบจำลอง + ${num(s.ensembles)} ensemble`,
    om_stations: s.count && `${num(s.count)} สถานี · ${num(s.provinces)} จังหวัด · ${num(s.models)} แบบจำลอง`,
    province_fc: "77 จังหวัด · 4 แบบจำลอง", heatsafe: `50 เขต${s.models ? ` · ${s.models} แบบจำลอง` : ""}`, grid: "957 เซลล์ · 3 แบบจำลอง",
  }[d.id];
  return c || d.spatial;
}
function period(d) {
  const s = d.stats || {};
  const from = s.from || s.first, to = s.to || s.latest;
  if (!from && !to) return "–";
  return `${from ? dt(String(from).length === 8 ? `${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}` : from) : "–"} → ${to ? dt(String(to).slice(0, 10).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")) : "ปัจจุบัน"}`;
}

async function main() {
  const C = await fetch("data/catalog.json", { cache: "no-cache" }).then((r) => r.json());
  const repo = (await fetch("data/index.json").then((r) => r.json()).catch(() => ({}))).repo || "Navavit/consolidated-weather";
  $("db-doc").href = `https://github.com/${repo}/blob/main/docs/DATABASE.md`;
  $("repo-link").href = `https://github.com/${repo}`;
  $("updated").textContent = `ปรับปรุง ${new Date(C.generated).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`;
  const ds = C.datasets;
  const st = (id) => (ds.find((d) => d.id === id) || {}).stats || {};
  const DB = C.database || {};
  // การ์ดสรุป
  const nStations = (st("tmd3h").count || 0) + (st("twday").count || 0) + (st("air4thai").count || 0);
  $("cards").replaceChildren(...[
    ["ชุดข้อมูล", ds.length, "รายการ"],
    ["สถานีตรวจวัดปัจจุบัน", num(nStations), `TMD ${num(st("tmd3h").count)} · ThaiWater ${num(st("twday").count)} · Air4Thai ${num(st("air4thai").count)}`],
    ["สถานีย้อนหลัง (GHCNh)", num(st("ghcnh").count), "2016–ปัจจุบัน รายชั่วโมง"],
    ["แบบจำลองพยากรณ์", C.models.length, `+ ensemble ${C.ensembles.length} ระบบ`],
    ["ฐานข้อมูล", size(DB.total_bytes), `${num(DB.total_rows)} แถว`],
  ].map(([k, v, s]) => el("div", { class: "d-card" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "s" }, s))));
  // ① ภาพรวม
  const head = ["ชุดข้อมูล / ผู้ผลิต", "ต้นทางปรับปรุงข้อมูล", "ต้นทางล่าช้า", "ความละเอียดเชิงเวลา", "จำนวน / ขอบเขต", "ช่วงเวลาที่มีในระบบ", "ระบบดึง"];
  $("overview-table").replaceChildren(el("table", { class: "d-table d-overview" },
    el("thead", {}, el("tr", {}, ...head.map((h) => el("th", {}, h)))),
    ...Object.entries(GROUPS).map(([g, gname]) => el("tbody", {},
      el("tr", { class: "grp" }, el("th", { colspan: String(head.length) }, gname)),
      ds.filter((d) => d.group === g).map((d) => el("tr", {},
        el("td", {}, el("a", { href: `#ds-${d.id}` }, d.name), el("div", { class: "muted" }, d.provider)),
        el("td", { class: "hl" }, d.source_update), el("td", {}, d.latency), el("td", {}, d.native),
        el("td", {}, coverage(d)), el("td", {}, period(d)), el("td", { class: "muted" }, d.update)))))));
  // ② แบบจำลอง
  const M = C.model_runs || [];
  $("models-table").replaceChildren(el("table", { class: "d-table" },
    el("thead", {}, el("tr", {}, ...["แบบจำลอง", "ประเภท", "ขนาดกริด", "รอบ/วัน", "ทุก", "ความละเอียดเชิงเวลา", "ล่าช้า", "รอบล่าสุด (UTC)", "สถานะ"].map((h) => el("th", {}, h)))),
    el("tbody", {}, M.map((m) => el("tr", { class: m.stale ? "stale" : null },
      el("td", {}, el("b", {}, m.name), m.agency ? el("div", { class: "muted" }, m.agency) : null),
      el("td", {}, { deterministic: "deterministic", ensemble: "ensemble", regional: "ภูมิภาค" }[m.kind] || m.kind),
      el("td", {}, m.grid_km ? `~${m.grid_km} กม.` : "–"),
      el("td", { class: "num" }, m.per_day ?? "–"), el("td", { class: "num" }, m.interval_h ? `${num(m.interval_h)} ชม.` : "–"),
      el("td", { class: "num" }, m.resolution_h ? `${num(m.resolution_h)} ชม.` : "–"),
      el("td", { class: "num" }, m.latency_h != null && !m.stale ? `${num(m.latency_h, 1)} ชม.` : "–"),
      el("td", { class: "num" }, m.last_init || "–"),
      el("td", {}, m.stale ? "⚠️ หยุดปรับปรุง" : m.source === "metadata" ? "✓ ปกติ" : m.source || "–"))))));
  // ④ รายละเอียด
  const rows = [["ผู้ผลิต / หน่วยงาน", "provider"], ["ตัวแปรและหน่วย", "variables"], ["ความครอบคลุมเชิงพื้นที่", "spatial"],
    ["ความละเอียดเชิงเวลา", "native"], ["ต้นทางปรับปรุง", "source_update"], ["ต้นทางล่าช้า", "latency"], ["ระบบดึง", "update"],
    ["ที่จัดเก็บ", "storage"], ["การใช้ในระบบ", "use"], ["สัญญาอนุญาต", "license"], ["ข้อจำกัด", "limits"]];
  $("detail-list").replaceChildren(...ds.map((d) => el("article", { class: "d-detail", id: `ds-${d.id}` },
    el("h3", {}, d.name, el("span", { class: "tag" }, GROUPS[d.group])),
    el("dl", {},
      ...rows.filter(([, k]) => d[k]).flatMap(([lab, k]) => [el("dt", {}, lab), el("dd", {}, d[k])]),
      el("dt", {}, "จำนวน / ขอบเขต (ปัจจุบัน)"), el("dd", {}, coverage(d)),
      el("dt", {}, "ช่วงเวลาที่มีในระบบ"), el("dd", {}, period(d)),
      d.stats?.rows ? [el("dt", {}, "ขนาดในฐานข้อมูล"), el("dd", {}, `${num(d.stats.rows)} แถว · ${size(d.stats.bytes)} · ${d.stats.files} ไฟล์`)] : null,
      d.url ? [el("dt", {}, "แหล่งที่มา"), el("dd", {}, el("a", { href: d.url, target: "_blank", rel: "noopener" }, d.url))] : null))));
  // ⑤ ตารางการปรับปรุง
  $("schedule-table").replaceChildren(el("table", { class: "d-table" },
    el("thead", {}, el("tr", {}, ...["รอบ", "workflow", "งาน"].map((h) => el("th", {}, h)))),
    el("tbody", {}, C.schedule.map((s) => el("tr", {}, el("td", {}, s.when), el("td", {}, el("code", {}, s.workflow)), el("td", {}, s.what))))));
  // ⑥ ฐานข้อมูล
  const T = DB.tables || {};
  $("db-note").textContent = `ไฟล์ Parquet บน GitHub Releases · ${num(DB.total_rows)} แถว · ${size(DB.total_bytes)} · manifest ปรับปรุง ${DB.generated || "–"}`;
  $("db-table").replaceChildren(el("table", { class: "d-table" },
    el("thead", {}, el("tr", {}, ...["ตาราง", "ไฟล์", "แถว", "ขนาด", "ช่วงเวลา"].map((h) => el("th", {}, h)))),
    el("tbody", {}, Object.entries(T).sort().map(([t, v]) => el("tr", {}, el("td", {}, el("code", {}, t)), el("td", { class: "num" }, num(v.files)),
      el("td", { class: "num" }, num(v.rows)), el("td", { class: "num" }, size(v.bytes)), el("td", {}, v.from ? `${dt(v.from)} → ${dt(v.to)}` : "ตารางมิติ"))))));
  initMap(C);
}

async function initMap(C) {
  if (typeof L === "undefined") return;
  const map = L.map("dmap", { scrollWheelZoom: false, zoomSnap: 0.25 }).fitBounds([[5.6, 97.3], [20.5, 105.7]]);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 14, opacity: 0.6 }).addTo(map);
  const S = await fetch("data/stations.json").then((r) => r.json()).catch(() => ({ tw: [], tw_cols: [] }));
  const ci = (n) => S.tw_cols.indexOf(n);
  const dot = (lat, lon, color, r, tip) => L.circleMarker([lat, lon], { radius: r, color: "#333", weight: 0.5, fillColor: color, fillOpacity: 0.85 }).bindTooltip(tip, { className: "map-label" });
  const Lyr = C.layers || {};
  const layers = [
    ["thaiwater", "โทรมาตร ThaiWater", "#4f9fe3", S.tw.map((g) => dot(g[ci("lat")], g[ci("lon")], "#4f9fe3", 2.5, `${g[ci("name")]} · ${g[ci("agency")]}`)), true],
    ["tmd", "สถานีอุตุนิยมวิทยา (TMD)", "#d7301f", (Lyr.tmd || []).map((s) => dot(s[2], s[3], "#d7301f", 5, `สถานี${s[1]} (${s[0]})`)), true],
    ["air", "สถานีคุณภาพอากาศ (Air4Thai)", "#7b3294", (Lyr.air4thai || []).map((s) => dot(s[2], s[3], "#7b3294", 4, `${s[1]} (${s[0]})`)), false],
    ["ghcnh", "สถานี NOAA GHCNh", "#1a9850", (Lyr.ghcnh || []).map((s) => dot(s[2], s[3], "#1a9850", 4, `${s[1]} (${s[0]})`)), false],
    ["check", "จุดตรวจที่ใช้เทียบแบบจำลอง", "#111", (Lyr.check || []).map((s) => L.circleMarker([s[2], s[3]], { radius: 7, color: "#111", weight: 2, fill: false })
      .bindTooltip(`${s[1]} · ${s[5] ? "จุดตรวจทั่วประเทศ" : "จุดตรวจของ" + s[4]}`, { className: "map-label" })), false],
  ].map(([k, label, color, markers, on]) => ({ k, label, color, group: L.layerGroup(markers), on, n: markers.length }));
  const render = () => $("layers").replaceChildren(...layers.map((l) => el("button", { class: "chip", type: "button", "aria-pressed": String(l.on),
    onclick: () => { l.on = !l.on; l.on ? l.group.addTo(map) : l.group.remove(); render(); } },
  el("i", { class: "sw", style: `background:${l.color}` }), ` ${l.label} (${num(l.n)})`)));
  layers.forEach((l) => l.on && l.group.addTo(map));
  render();
  $("map-note").textContent = "กดชื่อชั้นข้อมูลเพื่อเปิด/ปิด · ตำแหน่งโทรมาตรจากรายงานล่าสุดของ ThaiWater · วงกลมไม่ทึบ = จุดตรวจที่ใช้ตรวจสอบความถูกต้องของแบบจำลอง";
}

main().catch((e) => { $("updated").textContent = `โหลดข้อมูลไม่สำเร็จ: ${e.message}`; });
