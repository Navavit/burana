/* หน้าข้อมูลและแหล่งที่มา — อ่าน data/catalog.json (weather_catalog.py) และ data/stations.json · ภาษา: i18n.js */
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
const num = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString(LOCALE, { maximumFractionDigits: d }));
const size = (b) => (b == null ? "–" : b >= 1e9 ? `${num(b / 1e9, 2)} GB` : b >= 1e6 ? `${num(b / 1e6, 1)} MB` : `${num(b / 1e3, 0)} KB`);
const dt = (s) => (s ? new Date(s.length === 10 ? s : s.replace(" ", "T")).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "–");
const GROUPS = EN ? { obs: "Measurements", hist: "Historical data", fc: "Forecasts", derived: "Derived results", ref: "Reference data" }
  : { obs: "ค่าที่วัดได้", hist: "ข้อมูลย้อนหลัง", fc: "พยากรณ์", derived: "ผลที่ระบบคำนวณ", ref: "ข้อมูลอ้างอิง" };
const H = T("ชม.", "h");
// ข้อความของชุดข้อมูลตามภาษา (catalog.json มี en ต่อชุดข้อมูล)
const f = (d, k) => (EN && d.en?.[k]) || d[k];

// จำนวน/ขอบเขต และช่วงเวลา ของแต่ละชุดข้อมูล (จากสถิติจริง)
let ST = () => ({});                                    // สถิติของชุดอื่น (กำหนดใน main)
function coverage(d) {
  const s = d.stats || {};
  const tmd = ST("tmd3h").count, tw = ST("twday").count, loc = ST("om_locations"), chk = ST("tw_check");
  const stn = T("สถานี", "stations"), cells = T("957 เซลล์ (0.25°)", "957 cells (0.25°)"), mdl = T("โมเดล", "models"), pts = T("จุด", "points");
  const gauges = T("เครื่องวัดฝน", "rain gauges");
  const c = {
    tmd3h: s.count && `${num(s.count)} ${stn}`, tmdday: s.count && `${num(s.count)} ${stn}`, twday: s.count && `${num(s.count)} ${T("เครื่อง", "gauges")}`,
    tw_check: s.count && T(`${num(s.active)} เครื่องที่ยังส่งข้อมูล (จาก ${num(s.count)})`, `${num(s.active)} gauges reporting (of ${num(s.count)})`),
    air4thai: s.count && `${num(s.count)} ${stn}`,
    user: T(`${num(s.count)} รายงาน`, `${num(s.count)} reports`), sensor_pfal: T("1 จุด (มก. บางเขน)", "1 point (KU Bang Khen)"),
    metar: T("39 สนามบิน", "39 airports"), ghcnh: s.count && `${num(s.count)} ${stn}`, gsod: T("66–133 สถานี (ตามปี)", "66–133 stations (by year)"),
    era5land: cells, chirps: cells, imerg: cells, gsmap: cells,
    om_locations: s.count && `${num(s.count)} ${pts} · ${num(s.models)} ${mdl} + ${num(s.ensembles)} ensemble`,
    om_stations: s.count && `${num(s.count)} ${stn} · ${num(s.provinces)} ${T("จังหวัด", "provinces")} · ${num(s.models)} ${mdl}`,
    province_fc: T("77 จังหวัด · 4 โมเดล", "77 provinces · 4 models"), heatsafe: `${T("50 เขต", "50 districts")}${s.models ? ` · ${s.models} ${mdl}` : ""}`,
    grid: T("957 เซลล์ · 3 โมเดล", "957 cells · 3 models"),
    prevruns: tmd && `${num(tmd)} ${stn} + ${num(tw)} ${gauges}`,
    tmdwrf: loc.count && `${num(loc.count)} ${pts}`, google: T("3 จุด (กรุงเทพมหานคร)", "3 points (Bangkok)"),
    hii: chk.active != null && `${num((chk.active || 0) + 2)} ${pts}`,
    pairs: tmd && `${num(tmd)} ${stn} + ${num(tw)} ${gauges} + ${num(chk.active)} ${T("จุดตรวจ", "check points")}`,
    refs: T("77 จังหวัด · 6 ภาค · 50 เขต · 957 เซลล์", "77 provinces · 6 regions · 50 districts · 957 cells"),
  }[d.id];
  return c || "–";
}
function period(d) {
  const s = d.stats || {};
  const norm = (x) => { x = String(x); return /^\d{8}/.test(x) ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : x.slice(0, 10); };
  const from = s.from || s.first, to = s.to || s.latest;
  if (d.id === "refs") return T("ข้อมูลคงที่", "Fixed");
  if (!from && !to) return "–";
  if (!from) return `${T("ล่าสุด", "Latest")} ${dt(norm(to))}`;
  return `${dt(norm(from))} → ${to ? dt(norm(to)) : T("ปัจจุบัน", "now")}`;
}

async function main() {
  const C = await fetch("data/catalog.json", { cache: "no-cache" }).then((r) => r.json());
  const repo = (await fetch("data/index.json").then((r) => r.json()).catch(() => ({}))).repo || "Navavit/burana";
  if ($("db-doc")) $("db-doc").href = `https://github.com/${repo}/blob/main/docs/DATABASE.md`;
  $("repo-link").href = `https://github.com/${repo}`;
  $("updated").textContent = `${T("อัปเดต", "Updated")} ${new Date(C.generated).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" })}`;
  const ds = C.datasets;
  const st = (id) => (ds.find((d) => d.id === id) || {}).stats || {};
  ST = st;
  const DB = C.database || {};
  // การ์ดสรุป
  const nStations = (st("tmd3h").count || 0) + (st("twday").count || 0) + (st("air4thai").count || 0);
  $("cards").replaceChildren(...[
    [T("ชุดข้อมูล", "Datasets"), ds.length, T("รายการ", "in total")],
    [T("สถานีวัดตอนนี้", "Stations now"), num(nStations), `TMD ${num(st("tmd3h").count)} · ThaiWater ${num(st("twday").count)} · Air4Thai ${num(st("air4thai").count)}`],
    [T("สถานีย้อนหลัง (GHCNh)", "Historical stations (GHCNh)"), num(st("ghcnh").count), T("2543–ปัจจุบัน รายชั่วโมง", "2000–now, hourly")],
    [T("โมเดลพยากรณ์", "Forecast models"), C.models.length, `+ ensemble ${C.ensembles.length} ${T("ระบบ", "systems")}`],
    [T("ฐานข้อมูล", "Database"), size(DB.total_bytes), `${num(DB.total_rows)} ${T("แถว", "rows")}`],
  ].map(([k, v, s]) => el("div", { class: "d-card" }, el("div", { class: "k" }, k), el("div", { class: "v" }, v), el("div", { class: "s" }, s))));
  // ① รายการชุดข้อมูล: ตารางเดียว สลับมุมมองคอลัมน์ (ไม่แสดงข้อมูลเดียวกันซ้ำหลายที่)
  // storage = "branch data: <ที่เก็บ> · ฐานข้อมูล: <ตาราง>" (บางชุดมีเฉพาะฐานข้อมูล)
  const split = (s) => {
    s = String(s || "");
    if (s.startsWith("ฐานข้อมูล:")) return ["", s.replace(/^ฐานข้อมูล:\s*/, "")];
    const [a, b] = s.split(" · ฐานข้อมูล: ");
    return [a.replace(/^branch data:\s*/, ""), b || ""];
  };
  const code = (s) => (EN ? s.replace(/<ปี>/g, "<year>").replace(/<รหัส>/g, "<code>").replace(/\(ฝนและอุณหภูมิ\)/, "(rain and temperature)")
    .replace(/ย้อนหลัง ก\.ค\. 2567 – ก\.ย\. 2569 ณ สถานีกรมอุตุฯ:/, "history Jul 2024 – Sep 2026 at TMD stations:") : s);
  const VIEWS = {
    source: { label: T("มาจากไหน", "Source"),
      note: T("หน่วยงานที่ผลิตข้อมูล ตัวแปร พื้นที่ที่ครอบคลุม (จำนวนปัจจุบันคิดจากข้อมูลจริง) และสัญญาอนุญาต",
        "Producing agency, variables, spatial coverage (current counts from the real data) and licence"),
      cols: [[T("หน่วยงาน", "Agency"), (d) => d.url ? el("a", { href: d.url, target: "_blank", rel: "noopener" }, f(d, "provider")) : f(d, "provider")],
        [T("ตัวแปรและหน่วย", "Variables and units"), (d) => f(d, "variables")], [T("พื้นที่ที่ครอบคลุม", "Spatial coverage"), (d) => f(d, "spatial")],
        [T("สัญญาอนุญาต", "Licence"), (d) => f(d, "license")]] },
    time: { label: T("ช่วงเวลา", "Timing"),
      note: T("ต้นทางอัปเดต = หน่วยงานต้นทางออกข้อมูลใหม่บ่อยแค่ไหน · ต้นทางช้า = ข้อมูลออกช้ากว่าเวลาจริงเท่าไร · ความละเอียดเชิงเวลา = แต่ละค่าครอบคลุมช่วงเวลาเท่าไร",
        "Source updates = how often the source agency publishes new data · source delay = how far behind real time it is published · time resolution = the period each value covers"),
      cols: [[T("ต้นทางอัปเดต", "Source updates"), (d) => el("b", {}, f(d, "source_update"))], [T("ต้นทางช้า", "Source delay"), (d) => f(d, "latency")],
        [T("ความละเอียดเชิงเวลา", "Time resolution"), (d) => f(d, "native")]] },
    store: { label: T("วิธีเก็บ", "Storage"),
      note: T(`ระบบดึง = ระบบนี้ดึงข้อมูลบ่อยแค่ไหน · คลังระยะสั้น = branch data (เก็บไม่เกิน ~35 วัน) · ฐานข้อมูล = ไฟล์ Parquet บน GitHub Releases (รวม ${num(DB.total_rows)} แถว · ${size(DB.total_bytes)})`,
        `System fetch = how often this system collects it · short-term store = branch data (up to ~35 days) · database = Parquet files on GitHub Releases (${num(DB.total_rows)} rows · ${size(DB.total_bytes)} in total)`),
      cols: [[T("ระบบดึง", "System fetch"), (d) => f(d, "update")], [T("คลังระยะสั้น", "Short-term store"), (d) => el("code", {}, code(split(d.storage)[0]) || "–")],
        [T("ฐานข้อมูล", "Database"), (d) => code(split(d.storage)[1]) || "–"],
        [T("ขนาดในฐานข้อมูล", "Size in database"), (d) => d.stats?.rows ? `${num(d.stats.rows)} ${T("แถว", "rows")} · ${size(d.stats.bytes)}` : "–"]] },
    use: { label: T("ใช้ทำอะไรและข้อจำกัด", "Use and limits"), note: "",
      cols: [[T("ใช้ในระบบ", "Used for"), (d) => f(d, "use")], [T("ข้อจำกัด", "Limits"), (d) => f(d, "limits") || "–"]] },
  };
  let view = "source";
  const renderTable = () => {
    const V = VIEWS[view];
    $("views").replaceChildren(...Object.entries(VIEWS).map(([k, v]) => el("button", { class: "chip", role: "tab", type: "button",
      "aria-selected": String(k === view), onclick: () => { view = k; renderTable(); } }, v.label)));
    $("view-note").textContent = V.note;
    $("ds-table").replaceChildren(el("table", { class: "d-table d-overview" },
      el("thead", {}, el("tr", {}, el("th", {}, T("ชุดข้อมูล", "Dataset")), el("th", {}, T("จำนวนสถานี / จุด", "Stations / points")),
        el("th", {}, T("มีข้อมูลในระบบ", "Data in the system")), ...V.cols.map(([h]) => el("th", {}, h)))),
      ...Object.entries(GROUPS).map(([g, gname]) => el("tbody", {},
        el("tr", { class: "grp" }, el("th", { colspan: String(V.cols.length + 3) }, gname)),
        ds.filter((d) => d.group === g).map((d) => el("tr", {}, el("td", {}, el("b", {}, f(d, "name"))),
          el("td", { class: "cnt" }, coverage(d)), el("td", { class: "cnt" }, period(d)), ...V.cols.map(([, fn]) => el("td", {}, fn(d)))))))));
  };
  renderTable();
  // ③ แบบจำลอง
  const M = C.model_runs || [];
  $("models-table").replaceChildren(el("table", { class: "d-table" },
    el("thead", {}, el("tr", {}, ...(EN ? ["Model", "Type", "Grid", "Runs/day", "Every", "Time resolution", "Delay", "Latest run (UTC)", "Status"]
      : ["โมเดล", "ประเภท", "ขนาดกริด", "รอบ/วัน", "ทุก", "ความละเอียดเชิงเวลา", "ช้า", "รอบล่าสุด (UTC)", "สถานะ"]).map((h) => el("th", {}, h)))),
    el("tbody", {}, M.map((m) => el("tr", { class: m.stale ? "stale" : null },
      el("td", {}, el("b", {}, m.name), m.agency ? el("div", { class: "muted" }, tx(m.agency)) : null),
      el("td", {}, { deterministic: "deterministic", ensemble: "ensemble", regional: T("ภูมิภาค", "regional") }[m.kind] || m.kind),
      el("td", {}, m.grid_km ? `~${m.grid_km} ${T("กม.", "km")}` : "–"),
      el("td", { class: "num" }, m.per_day ?? "–"), el("td", { class: "num" }, m.interval_h ? `${num(m.interval_h)} ${H}` : "–"),
      el("td", { class: "num" }, m.resolution_h ? `${num(m.resolution_h)} ${H}` : "–"),
      el("td", { class: "num" }, m.latency_h != null && !m.stale ? `${num(m.latency_h, 1)} ${H}` : "–"),
      el("td", { class: "num" }, m.last_init || "–"),
      el("td", {}, m.stale ? T("⚠️ หยุดอัปเดต", "⚠️ stopped updating") : m.source === "metadata" ? T("✓ ปกติ", "✓ normal")
        : EN && String(m.source || "").startsWith("ประมาณ") ? "estimated (no metadata)" : m.source || "–"))))));
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
    ["thaiwater", T("เครื่องวัดฝน ThaiWater", "ThaiWater rain gauges"), "#4f9fe3", S.tw.map((g) => dot(g[ci("lat")], g[ci("lon")], "#4f9fe3", 2.5, `${g[ci("name")]} · ${tx(g[ci("agency")])}`)), true],
    ["tmd", T("สถานีอุตุนิยมวิทยา (TMD)", "Weather stations (TMD)"), "#d7301f", (Lyr.tmd || []).map((s) => dot(s[2], s[3], "#d7301f", 5, T(`สถานี${s[1]} (${s[0]})`, `${s[1]} (${s[0]})`))), true],
    ["air", T("สถานีคุณภาพอากาศ (Air4Thai)", "Air quality stations (Air4Thai)"), "#7b3294", (Lyr.air4thai || []).map((s) => dot(s[2], s[3], "#7b3294", 4, `${s[1]} (${s[0]})`)), false],
    ["sensor", T("เซนเซอร์ PFAL SIS KU", "PFAL SIS KU sensor"), "#c51b7d", (Lyr.sensor || []).map((s) => L.circleMarker([s[2], s[3]], { radius: 7, color: "#c51b7d", weight: 3, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip(T(s[1], "Outdoor sensor, PFAL SIS KU (Kasetsart University, Bang Khen)"), { className: "map-label" })), true],
    ["ghcnh", T("สถานี NOAA GHCNh", "NOAA GHCNh stations"), "#1a9850", (Lyr.ghcnh || []).map((s) => dot(s[2], s[3], "#1a9850", 4, `${s[1]} (${s[0]})`)), false],
    ["check", T("จุดที่ใช้ตรวจโมเดล", "Model check points"), "#111", (Lyr.check || []).map((s) => L.circleMarker([s[2], s[3]], { radius: 7, color: "#111", weight: 2, fill: false })
      .bindTooltip(`${s[1]} · ${s[5] ? T("จุดตรวจทั่วประเทศ", "nationwide check point") : T("จุดตรวจของ" + s[4], "check point of " + tx(s[4]))}`, { className: "map-label" })), false],
  ].map(([k, label, color, markers, on]) => ({ k, label, color, group: L.layerGroup(markers), on, n: markers.length }));
  const render = () => $("layers").replaceChildren(...layers.map((l) => el("button", { class: "chip", type: "button", "aria-pressed": String(l.on),
    onclick: () => { l.on = !l.on; l.on ? l.group.addTo(map) : l.group.remove(); render(); } },
  el("i", { class: "sw", style: `background:${l.color}` }), ` ${l.label} (${num(l.n)})`)));
  layers.forEach((l) => l.on && l.group.addTo(map));
  render();
  $("map-note").textContent = T("แตะชื่อชั้นข้อมูลเพื่อเปิด/ปิด · ตำแหน่งเครื่องวัดฝนจากรายงานล่าสุดของ ThaiWater · วงกลมโปร่ง = จุดที่ใช้ตรวจว่าโมเดลแม่นไหม",
    "Tap a layer name to show/hide it · gauge positions from ThaiWater's latest report · hollow circles = points used to check model accuracy");
}

main().catch((e) => { $("updated").textContent = `${T("โหลดข้อมูลไม่สำเร็จ", "Could not load data")}: ${e.message}`; });
