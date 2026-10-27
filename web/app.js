/* BURANA (บูรณา) ฐานข้อมูลภูมิอากาศและแบบจำลองพยากรณ์อากาศของประเทศไทย — หน้าเว็บ static อ่าน data/*.json ที่ GitHub Actions สร้างทุกชั่วโมง */
"use strict";

// ---------------------------------------------------------------------------
// ค่าคงที่
// ---------------------------------------------------------------------------
// ramp สีฟ้าแบบลำดับ (sequential) จากอ่อน → เข้ม ใช้กับ heatmap และแผนที่
const BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5",
              "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
const RAIN_STEPS = [0.1, 0.5, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100];      // มม. → ขั้นของ ramp
const PROB_STEPS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];      // %
const STATUS = {
  "ปกติ": "good", "ต่ำกว่าเกณฑ์": "", "เฝ้าระวัง": "good", "เตือนภัย": "warning", "อันตราย": "serious", "อันตรายมาก": "critical",
  "ต่ำ": "good", "ปานกลาง": "warning", "สูง": "serious", "สูงมาก": "critical",
  "ดีมาก": "good", "ดี": "good", "เริ่มมีผลต่อสุขภาพ": "serious", "มีผลต่อสุขภาพ": "critical",
};
const CHARTS = [
  { key: "precipitation", title: T("ฝนรายชั่วโมง", "Hourly rain"), unit: T("มม./ชม.", "mm/h"), bars: true, zero: true, wide: true, height: 220 },
  { key: "temperature_2m", title: T("อุณหภูมิ", "Temperature"), unit: "°C" },
  { key: "apparent_temperature", title: T("อุณหภูมิที่รู้สึก", "Feels-like temperature"), unit: "°C",
    lines: [{ y: 33, label: T("เหลือง 33", "yellow 33"), status: "warning" }, { y: 42, label: T("ส้ม 42", "orange 42"), status: "serious" }, { y: 52, label: T("แดง 52", "red 52"), status: "critical" }] },
  { key: "relative_humidity_2m", title: T("ความชื้น", "Humidity"), unit: "%", max: 100 },
  { key: "wind_gusts_10m", title: T("ลมกระโชก", "Wind gusts"), unit: T("กม./ชม.", "km/h"), zero: true },
  { key: "pm25", title: "PM2.5 (CAMS)", unit: T("มคก./ลบ.ม.", "µg/m³"), zero: true, single: true,
    lines: [{ y: 37.5, label: T("ค่ามาตรฐาน 37.5", "standard 37.5"), status: "serious" }] },
];
const DAYS = EN ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MM = T("มม.", "mm"), KM = T("กม.", "km"), KMH = T("กม./ชม.", "km/h"), H = T("ชม.", "h"), NA = T("ไม่มีข้อมูล", "no data");

const state = { index: null, loc: null, locIdx: 0, highlight: null, param: "tmax", map: null, markers: [], gps: null, prov: null };

// ---------------------------------------------------------------------------
// เครื่องมือ
// ---------------------------------------------------------------------------
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
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  return n;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ไม่มี storage ก็ใช้งานได้ */ } },
};
const fmt = (v, d = 1) => (v == null ? "–" : Number(v).toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d }));
const num = (v) => Number(v).toLocaleString(LOCALE);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function stepColor(v, steps) {
  if (v == null) return null;
  let i = steps.findIndex((s) => v < s);
  if (i === -1) i = steps.length;
  return i === 0 ? null : BLUE[Math.min(i - 1, BLUE.length - 1)];
}
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? "#0b0b0b" : "#ffffff";
}
function statusPill(text) {
  if (!text || text === "–") return null;
  const [icon, ...rest] = text.split(" ");
  const label = rest.join(" ");
  return el("span", { class: "pill", "data-status": STATUS[label] || "" }, icon, " ", tx(label));
}
function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return T("เมื่อสักครู่", "just now");
  if (min < 60) return T(`${min} นาทีที่แล้ว`, `${min} min ago`);
  const h = Math.round(min / 60);
  return h < 48 ? T(`${h} ชั่วโมงที่แล้ว`, `${h} h ago`) : T(`${Math.round(h / 24)} วันที่แล้ว`, `${Math.round(h / 24)} days ago`);
}
const localTime = (iso) => new Date(iso.length <= 19 ? iso + "+07:00" : iso);

// ---------------------------------------------------------------------------
// tooltip เดียวใช้ร่วมกันทั้งหน้า
// ---------------------------------------------------------------------------
const tip = {
  show(x, y, head, rows) {
    const t = $("tooltip");
    t.replaceChildren(el("div", { class: "tt-h" }, head),
      ...rows.map((r) => el("div", { class: "row" },
        el("span", {}, r.color ? el("i", { class: "key-line", style: `background:${r.color}` }) : null, r.label),
        el("b", {}, r.value))));
    t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
    const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  },
  hide() { $("tooltip").hidden = true; },
};

// ---------------------------------------------------------------------------
// โหลดข้อมูล
// ---------------------------------------------------------------------------
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function init() {
  applyTheme(store.get("theme"));
  $("theme").addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.hasAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    applyTheme(dark ? "light" : "dark");
  });
  try {
    state.index = await getJSON("data/index.json");
  } catch (e) {
    $("updated").textContent = T("ยังไม่มีข้อมูล — รอการประมวลผลรอบแรก", "No data yet — waiting for the first run");
    return;
  }
  const repo = state.index.repo;
  if (repo) {
    $("docs-link").href = `https://github.com/${repo}/blob/main/docs/MODELS.md`;
    $("repo-link").href = `https://github.com/${repo}`;
  }
  $("updated").textContent = `${T("อัปเดต", "Updated")} ${timeAgo(state.index.generated)} · ${new Date(state.index.generated).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" })}`;
  const wantAbout = location.hash === "#about";
  const wantHeat = location.hash === "#heat";
  const wantNat = location.hash === "#th";
  initFolds();     // อ่านก่อน เพราะการเลือกตำแหน่งจะล้าง hash
  initRainBar();
  getJSON("data/verification.json").then((v) => {
    state.verify = v; renderVerify(); renderUserMode();
    if (state.loc) { renderNext(); renderBrief(); }
    if (document.body.classList.contains("about-mode")) showAbout(true);
  }).catch(() => {
    $("v-note").textContent = T("ยังไม่มีข้อมูล — ระบบเริ่มเก็บค่าที่วัดได้แล้ว ผลจะแสดงภายในไม่กี่ชั่วโมง", "No data yet — measurements are being collected; results will appear within a few hours");
  });
  state.meta = await getJSON("data/meta.json").catch(() => null);
  setPlaces(state.meta?.provinces);
  // ค่าเริ่มต้น = กรุงเทพมหานคร (ตำแหน่งแรก) · จำแท็บที่เลือกล่าสุดต่อเครื่อง (📍 ตำแหน่งของผู้ใช้ / จังหวัด / ทั่วประเทศ)
  const tab = store.get("tab") || "loc:0";
  const saved = tab.startsWith("loc:") ? parseInt(tab.slice(4), 10) : 0;
  renderChips();
  initMap();
  await selectLocation(saved < state.index.locations.length ? saved : 0, false);
  if (wantAbout) showAbout(true);
  else if (wantHeat || tab === "heat") showHeat(true);
  else if (wantNat || tab === "th") showNat(true);
  else if (tab === "gps") selectGps(false);
  else if (tab.startsWith("prov:")) selectProvince(tab.slice(5), false);
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderCharts, 150); });
}

// ส่วน ③–⑤ พับได้ (ปิดไว้เป็นค่าเริ่มต้น จำสถานะต่อเครื่อง) · กดลำดับเนื้อหาด้านบนแล้วเปิดให้เอง
function initFolds() {
  document.querySelectorAll("details.fold").forEach((d) => {
    if (store.get(`fold:${d.id}`) === "1") d.open = true;
    d.addEventListener("toggle", () => {
      store.set(`fold:${d.id}`, d.open ? "1" : "0");
      if (d.open && d.id === "step-4") renderCharts();
    });
  });
  document.querySelectorAll("#steps a").forEach((a) => a.addEventListener("click", () => {
    const t = document.querySelector(a.getAttribute("href"));
    if (t && t.tagName === "DETAILS") t.open = true;
  }));
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
    store.set("theme", theme);
  }
  if (state.loc) { renderCharts(); updateMapTiles(); }
}

function renderChips() {
  $("locations").replaceChildren(
    el("button", { class: "chip", id: "gps-chip", role: "tab", type: "button", "aria-selected": String(state.locIdx === -1),
      onclick: () => selectGps() }, T("📍 ตำแหน่งของผู้ใช้", "📍 My location")),
    provinceSelect(),
    el("button", { class: "chip", id: "nat-chip", role: "tab", type: "button", "aria-selected": "false",
      onclick: () => showNat(true) }, T("🇹🇭 ทั่วประเทศ", "🇹🇭 Nationwide")),
    el("button", { class: "chip", id: "heat-chip", role: "tab", type: "button", "aria-selected": "false",
      onclick: () => showHeat(true) }, T("🌡️ ความร้อนรายเขต", "🌡️ Heat by district")),
    el("button", { class: "chip", id: "about-chip", role: "tab", type: "button", "aria-selected": "false",
      onclick: () => showAbout(true) }, T("ℹ️ เกี่ยวกับระบบ", "ℹ️ About")));
}
function markChips() {
  const about = document.body.classList.contains("about-mode");
  const heat = document.body.classList.contains("heat-mode");
  const nat = document.body.classList.contains("nat-mode");
  const other = about || heat || nat;
  [...$("locations").children].forEach((c) => c.setAttribute("aria-selected", String(
    c.id === "about-chip" ? about : c.id === "heat-chip" ? heat : c.id === "nat-chip" ? nat
      : !other && (c.id === "gps-chip" ? state.locIdx === -1 : Number(c.dataset.idx) === state.locIdx))));
  const ps = $("prov-select");
  ps.setAttribute("aria-selected", String(!other && state.locIdx !== -1));
  // แท็บอื่น (ทั่วประเทศ ฯลฯ) ล้างค่าไว้ ไม่งั้นเลือกจังหวัดเดิมซ้ำจะไม่เกิด change และกลับมาไม่ได้
  ps.value = other ? "" : state.locIdx === -2 ? state.prov : state.locIdx >= 0 ? state.index.locations[state.locIdx].name : "";
  $("gps-note").hidden = other || state.locIdx !== -1;
  $("prov-note").hidden = other || state.locIdx !== -2;
}

// เลือกจังหวัด: จังหวัดที่ระบบประมวลผลไว้ (มี TMD WRF, Google, HII, จุดตรวจของตัวเอง) ใช้ไฟล์จากเซิร์ฟเวอร์
// จังหวัดอื่นคำนวณในเบราว์เซอร์ ณ จุดตัวแทนของจังหวัด แบบเดียวกับ 📍 ตำแหน่งของผู้ใช้
function provinceSelect() {
  const own = state.index.locations.map((l) => l.name);
  const others = ((state.meta || {}).provinces || []).map((p) => p.name).filter((n) => !own.includes(n))
    .sort((a, b) => tx(a).localeCompare(tx(b), LANG));
  const sel = el("select", { class: "chip prov-select", id: "prov-select", role: "tab", "aria-label": T("เลือกจังหวัด", "Choose a province") },
    el("option", { value: "", hidden: true }, T("🏙️ เลือกจังหวัด", "🏙️ Choose a province")),
    ...own.map((n) => el("option", { value: n }, tx(n))),
    ...others.map((n) => el("option", { value: n }, tx(n))));
  sel.onchange = () => {
    const i = own.indexOf(sel.value);
    if (i >= 0) selectLocation(i); else selectProvince(sel.value);
  };
  return sel;
}

async function selectProvince(name, remember = true) {
  const p = ((state.meta || {}).provinces || []).find((x) => x.name === name);
  if (!p) return;
  document.body.classList.remove("about-mode", "heat-mode", "nat-mode");
  if (["#about", "#heat", "#th"].includes(location.hash)) history.replaceState(null, "", location.pathname);
  if (remember) store.set("tab", `prov:${name}`);
  state.locIdx = -2;
  state.prov = name;
  state.gps = null;
  markChips();
  document.body.style.opacity = "0.6";
  try {
    const loc = await buildLocalPayload(p.lat, p.lon);
    if (state.prov !== name) return;         // ผู้ใช้เปลี่ยนจังหวัดระหว่างโหลด
    state.loc = { ...loc, name };
    showLocation();
  } catch (e) {
    $("prov-note").textContent = T(`โหลดพยากรณ์ของ${name}ไม่ได้ ลองใหม่อีกครั้ง`, `Could not load the forecast for ${tx(name)}. Please try again.`);
  } finally {
    document.body.style.opacity = "";
  }
}

// ---------------------------------------------------------------------------
// ℹ️ เกี่ยวกับโครงการ (แท็บสุดท้าย · ลิงก์ตรงด้วย #about)
// ---------------------------------------------------------------------------
async function showAbout(on) {
  if (on) document.body.classList.remove("heat-mode", "nat-mode");
  document.body.classList.toggle("about-mode", on);
  if (on && location.hash !== "#about") history.replaceState(null, "", "#about");
  if (!on && location.hash === "#about") history.replaceState(null, "", location.pathname);
  markChips();
  if (!on) { renderCharts(); return; }
  window.scrollTo({ top: 0 });
  const repo = state.index.repo;
  if (repo) {
    $("about-docs").href = `https://github.com/${repo}/blob/main/docs/MODELS.md`;
    $("about-repo").href = `https://github.com/${repo}`;
  }
  if (!state.meta) state.meta = await getJSON("data/meta.json").catch(() => null);
  const M = state.meta;
  if (M) {
    const rows = [...M.keyed_models, ...M.models].sort((a, b) => (a.grid_km ?? 99) - (b.grid_km ?? 99));
    // โมเดลที่มีข้อมูลจริงในรอบล่าสุด (ดูจากตำแหน่งแรกในรายการ)
    const first = state.index.locations[0];
    const locData = state.aboutLoc || (state.aboutLoc = await getJSON(`data/${first.file}`).catch(() => null));
    const avail = new Set((locData?.models || []).map((m) => m.name));
    const TYPE_TH = EN ? { "AI/ML": "AI", "Physics": "Physics", "Physics (regional)": "Physics (regional)" }
      : { "AI/ML": "AI", "Physics": "ฟิสิกส์", "Physics (regional)": "ฟิสิกส์ (ภูมิภาค)" };
    $("about-models").replaceChildren(el("table", { class: "about-table" },
      el("thead", {}, el("tr", {}, ...(EN ? ["Model", "Developer", "Type", "Resolution"] : ["โมเดล", "ผู้พัฒนา", "ประเภท", "ความละเอียด"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map((m) => el("tr", {},
        el("td", {}, el("b", {}, m.name), avail.size && !avail.has(m.name) ? el("div", { class: "muted" }, T("ตอนนี้ไม่มีข้อมูล", "no data right now")) : null),
        el("td", {}, tx(m.agency) || ""),
        el("td", {}, TYPE_TH[m.type] || m.type || ""),
        el("td", {}, m.grid_km ? `~${m.grid_km} ${KM} ` : "", el("small", {}, tx(m.grid) || "")))))));
    $("about-ens").textContent = T("ensemble ที่ใช้: ", "Ensembles used: ") + M.ensembles.map((e) => `${e.name} (${e.members})`).join(", ");
  }
  const V = state.verify;
  const n = V ? V.sections.reduce((a, x) => a + (x.n_obs || 0), 0) : 0;
  const nm = state.aboutLoc ? state.aboutLoc.models.length : "–", ne = M ? M.ensembles.length : "–";
  $("about-stats").textContent = T(`อัปเดตอัตโนมัติทุกชั่วโมง · เริ่มเก็บข้อมูล ${V?.since || "–"} · ` +
    `เทียบพยากรณ์กับค่าที่วัดได้แล้ว ${num(n)} คู่ · ใช้ ${nm} โมเดล และ ensemble ${ne} ระบบ`,
    `Updated automatically every hour · collecting since ${V?.since || "–"} · ` +
    `${num(n)} forecast–measurement pairs checked · ${nm} models and ${ne} ensembles in use`);
}

async function selectLocation(i, remember = true) {
  document.body.classList.remove("about-mode", "heat-mode", "nat-mode");
  if (["#about", "#heat", "#th"].includes(location.hash)) history.replaceState(null, "", location.pathname);
  state.locIdx = i;
  state.prov = null;
  state.gps = null;                         // เปลี่ยนแท็บ = กลับมาใช้ตำแหน่งของแท็บนั้น
  if (remember) store.set("tab", `loc:${i}`);
  markChips();
  document.body.style.opacity = "0.6";      // คงหน้าเดิมไว้ระหว่างโหลด ไม่กระพริบ
  try {
    state.loc = await getJSON(`data/${state.index.locations[i].file}`);
  } finally {
    document.body.style.opacity = "";
  }
  showLocation();
}

function showLocation() {
  const i = state.locIdx;
  const models = state.loc.models.map((m) => m.name);
  const want = store.get("highlight");
  state.highlight = models.includes(want) ? want : models[0];
  $("highlight").replaceChildren(...state.loc.models.map((m) =>
    el("option", { value: m.name, selected: m.name === state.highlight },
      `${m.name}${m.grid_km ? ` (${m.grid_km} ${KM})` : ""}`)));
  $("highlight").onchange = (e) => { state.highlight = e.target.value; store.set("highlight", state.highlight); renderCharts(); };
  renderAll();
  if (state.map) showProvinceBoundary();    // ดูฝนรอบตำแหน่งที่เลือก พร้อมขอบเขตจังหวัด
  state.markers.forEach((m, j) => m.setStyle({ weight: j === i ? 3 : 1.5, radius: j === i ? 10 : 8,
    fillColor: j === i ? cssVar("--ink") : cssVar("--surface") }));
  if (state.gpsMarker) state.gpsMarker.remove();
  if (i < 0 && state.map) {
    state.gpsMarker = L.circleMarker([state.loc.lat, state.loc.lon], {
      radius: 10, color: cssVar("--ink"), weight: 3, fillColor: cssVar("--ink"), fillOpacity: 1,
    }).bindTooltip(i === -2 ? tx(state.loc.name) : T("ตำแหน่งของผู้ใช้", "My location"), { direction: "top", className: "map-label" }).addTo(state.map);
  }
  renderNearSkill();
}

// ขอบเขตจังหวัดของตำแหน่งที่เลือก (จังหวัดตามชื่อ หรือจังหวัดที่พิกัดตกอยู่ สำหรับ 📍 ตำแหน่งของผู้ใช้) แล้วซูมให้เห็นทั้งจังหวัด
let provGeo = null;
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(lon, lat, f) {
  const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)));
}
async function showProvinceBoundary() {
  const loc = state.loc;
  if (!provGeo) provGeo = await getJSON("th_provinces.geojson").catch(() => null);
  if (state.loc !== loc) return;                       // เปลี่ยนตำแหน่งระหว่างโหลด
  if (state.provLayer) { state.provLayer.remove(); state.provLayer = null; }
  const fs = (provGeo || {}).features || [];
  const f = fs.find((x) => x.properties.name === loc.name) || fs.find((x) => inFeature(loc.lon, loc.lat, x));
  if (!f) { state.map.setView([loc.lat, loc.lon], Math.max(state.map.getZoom(), 8)); return; }
  state.provLayer = L.geoJSON(f, { interactive: false, style: {
    color: cssVar("--ink"), weight: 2.5, dashArray: "6 4", fillColor: cssVar("--ink"), fillOpacity: 0.05 } }).addTo(state.map);
  state.map.fitBounds(state.provLayer.getBounds(), { padding: [16, 16], maxZoom: 10 });
}

function renderAll() {
  renderTimebase();
  renderRainBar();
  renderNow();
  renderBrief();
  renderNext();
  renderRainTable();
  renderHii();
  renderRuns();
  renderEnsemble();
  renderCharts();
  renderParam();
}

// ---------------------------------------------------------------------------
// 📍 พยากรณ์ตรงที่ฉันอยู่: ดึง Open-Meteo ในเบราว์เซอร์แล้วคำนวณแบบเดียวกับ weather_core.py
// (ไม่มี TMD WRF / Google Weather เพราะต้องใช้ key ลับ)
// ---------------------------------------------------------------------------
const HOUR = 3600e3, DAY = 86400e3;
const naiveMs = (s) => Date.parse(s.length === 16 ? `${s}:00Z` : `${s}Z`);   // เวลาท้องถิ่นแบบไม่มี timezone → ms
const median = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); const n = v.length;
  return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };
const pickLevel = (v, table) => (v == null || Number.isNaN(v) ? "–" : table.find(([lim]) => v < lim)[1]);
// ---------------------------------------------------------------------------
// ป้ายเวลาเดียวกันทั้งหน้า: ทุกตาราง/การ์ดใช้เวลาอ้างอิงเดียวกัน (เวลาที่ดึงพยากรณ์) และวัน 07:00 → 07:00 น.
// ---------------------------------------------------------------------------
const dayStart = () => state.meta?.day_start_hour ?? 7;
const baseMs = (L = state.loc) => (L?.fetched_at ? naiveMs(L.fetched_at.slice(0, 16)) : null);
const pad2 = (n) => String(n).padStart(2, "0");
const hhmmMs = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const dMon = (ms) => new Date(ms).toLocaleDateString(LOCALE, { timeZone: "UTC", day: "numeric", month: "short" });
const dayWord = (ms, base) => {
  const dd = Math.round((Date.UTC(...ymd(ms)) - Date.UTC(...ymd(base))) / DAY);
  return dd === 0 ? TODAY : dd === 1 ? T("พรุ่งนี้", "tomorrow") : dMon(ms);
};
const TODAY = T("วันนี้", "today");
function ymd(ms) { const d = new Date(ms); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; }
/** ช่วงเวลา "+N ชม." / "D+N (dd/mm)" → {top, sub, start, end} (เวลาท้องถิ่นแบบ naive ms) */
function winInfo(w, L = state.loc) {
  const base = baseMs(L);
  let m = /^\+(\d+)/.exec(w);
  if (m && base != null) {
    const end = base + m[1] * HOUR;
    return { top: `+${m[1]} ${H}`, sub: `${T("ถึง", "until")} ${dayWord(end, base) === TODAY ? "" : dayWord(end, base) + " "}${hhmmMs(end)}`, start: base, end };
  }
  m = /^D\+(\d+)/.exec(w);
  if (m && base != null) {
    const h0 = dayStart() * HOUR, today = base - ((base - h0) % DAY + DAY) % DAY, start = today + m[1] * DAY;
    return { top: m[1] === "1" ? T("พรุ่งนี้ (D+1)", "Tomorrow (D+1)") : `D+${m[1]}`, sub: `${dMon(start)} ${pad2(dayStart())}:00 → ${dMon(start + DAY)}`, start, end: start + DAY };
  }
  return { top: tx(w), sub: "" };
}
const winHead = (w) => { const i = winInfo(w); return [i.top, i.sub ? el("span", { class: "wsub" }, i.sub) : null]; };
function renderTimebase() {
  const L = state.loc, base = baseMs(L);
  $("timebase").textContent = base == null ? "" :
    T(`⏱️ พยากรณ์ในหน้านี้ได้มาเมื่อ ${dMon(base)} ${hhmmMs(base)} น. · “+N ชม.” นับจากเวลานี้ · 1 วัน = ${pad2(dayStart())}:00 → ${pad2(dayStart())}:00 น. (ตรงกับค่ารายวันของกรมอุตุนิยมวิทยา) · ` +
      `HII ใช้ช่วง 19:00 → 19:00 น. · ดูที่มาและรอบรันได้ที่ ⑤`,
      `⏱️ Forecasts on this page were fetched ${dMon(base)} ${hhmmMs(base)} · “+N h” counts from this time · 1 day = ${pad2(dayStart())}:00 → ${pad2(dayStart())}:00 (matches the Thai Meteorological Department's daily values) · ` +
      `HII uses 19:00 → 19:00 · sources and model runs are in ⑤`);
}

// ระดับตามเกณฑ์แจ้งเตือนภัยความร้อนของกรุงเทพมหานคร (สอดคล้องกรมอนามัย)
const HEAT_LV = [[27, "⚪ ต่ำกว่าเกณฑ์"], [33, "🟢 เฝ้าระวัง"], [42, "🟡 เตือนภัย"], [52, "🟠 อันตราย"], [Infinity, "🔴 อันตรายมาก"]];
const UV_LV = [[3, "🟢 ต่ำ"], [6, "🟡 ปานกลาง"], [8, "🟠 สูง"], [11, "🔴 สูงมาก"], [Infinity, "🟣 อันตราย"]];
const PM_LV = [[15.01, "🔵 ดีมาก"], [25.01, "🟢 ดี"], [37.51, "🟡 ปานกลาง"], [75.01, "🟠 เริ่มมีผลต่อสุขภาพ"], [Infinity, "🔴 มีผลต่อสุขภาพ"]];
function distKm(a, b, c, d) {
  const p = Math.PI / 180, x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

function makeWindows(times, now, M) {
  const w = M.hour_windows.map((n) => ({ label: `+${n} ชม.`, kind: "hour",
    idx: times.flatMap((t, i) => (t > now && t <= now + n * HOUR ? [i] : [])), at: times.indexOf(now + n * HOUR) }));
  const h0 = (M.day_start_hour || 0) * HOUR;              // วันอุตุนิยมวิทยา 07:00–07:00 น. (= 00–00 UTC)
  const today = now - ((now - h0) % DAY + DAY) % DAY;
  for (const d of M.day_leads) {
    const start = today + d * DAY, dt = new Date(start);
    const dd = String(dt.getUTCDate()).padStart(2, "0"), mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    w.push({ label: `D+${d} (${dd}/${mm})`, kind: "day", idx: times.flatMap((t, i) => (t > start && t <= start + DAY ? [i] : [])) });
  }
  return w;
}
function aggregate(arr, win, how) {
  if (how === "at") return win.at >= 0 ? arr[win.at] ?? null : null;
  const v = win.idx.map((i) => arr[i]);
  if (!v.length || v.some((x) => x == null)) return null;      // ไม่ครบช่วง = ไม่แสดง
  if (how === "sum") return v.reduce((a, b) => a + b, 0);
  if (how === "mean") return v.reduce((a, b) => a + b, 0) / v.length;
  return how === "max" ? Math.max(...v) : Math.min(...v);
}
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

async function buildLocalPayload(lat, lon) {
  if (!state.meta) state.meta = await getJSON("data/meta.json");
  if (!state.nowObs) state.nowObs = await getJSON("data/now_obs.json").catch(() => ({ tmd: [], air: [] }));
  const M = state.meta, thr = M.rain_threshold_mm;
  const q = (base, p) => `${base}?${new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: "auto", ...p })}`;
  const [fc, aq, ...ens] = await Promise.all([
    getJSON(q("https://api.open-meteo.com/v1/forecast", { hourly: M.api_variables.join(","),
      models: M.models.map((m) => m.key).join(","), forecast_days: M.forecast_days })),
    getJSON(q("https://air-quality-api.open-meteo.com/v1/air-quality", { hourly: "pm2_5,uv_index", forecast_days: 7 })).catch(() => null),
    ...M.ensembles.map((e) => getJSON(q("https://ensemble-api.open-meteo.com/v1/ensemble",
      { hourly: "precipitation", models: e.key, forecast_days: M.forecast_days })).catch(() => null)),
  ]);
  const times = fc.hourly.time.map(naiveMs);
  const now = Math.floor((Date.now() + fc.utc_offset_seconds * 1000) / HOUR) * HOUR;
  const wins = makeWindows(times, now, M);

  // ข้อมูลรายชั่วโมง: data[ตัวแปร][ชื่อโมเดล] (ตัดโมเดลที่ไม่มีค่า)
  const data = {};
  for (const v of M.api_variables) {
    data[v] = {};
    for (const m of M.models) {
      const a = fc.hourly[`${v}_${m.key}`];
      if (a && a.some((x) => x != null)) data[v][m.name] = a;
    }
  }
  const tables = {};
  for (const [k, spec] of Object.entries(M.variables)) {
    const use = wins.filter((w) => (w.kind === "hour" ? spec.hour : spec.day));
    const rows = {};
    for (const [model, a] of Object.entries(data[spec.api] || {})) {
      const vals = use.map((w) => r1(aggregate(a, w, w.kind === "hour" ? spec.hour : spec.day)));
      if (vals.some((x) => x != null)) rows[model] = vals;
    }
    if (Object.keys(rows).length) tables[k] = { label: spec.label, unit: spec.unit, columns: use.map((w) => w.label), rows };
  }
  const rainRows = Object.values(tables.rain.rows);
  const col = (j) => rainRows.map((r) => r[j]).filter((x) => x != null);
  const consensus = {
    median: wins.map((_, j) => r1(median(col(j)))),
    min: wins.map((_, j) => (col(j).length ? Math.min(...col(j)) : null)),
    max: wins.map((_, j) => (col(j).length ? Math.max(...col(j)) : null)),
    n_models: wins.map((_, j) => col(j).length),
    agree_pct: wins.map((_, j) => (col(j).length ? Math.round(100 * col(j).filter((x) => x >= thr).length / col(j).length) : null)),
  };

  // ensemble: โอกาส (%) = สัดส่วนสมาชิกที่ฝนรวมในช่วง ≥ threshold
  const ensemble = {};
  ens.forEach((j, n) => {
    if (!j) return;
    const members = Object.keys(j.hourly).filter((k) => k.startsWith("precipitation") && j.hourly[k].some((x) => x != null));
    if (!members.length) return;
    const W = makeWindows(j.hourly.time.map(naiveMs), now, M);
    ensemble[`${M.ensembles[n].name} (${members.length})`] = W.map((w) => {
      const sums = members.map((k) => aggregate(j.hourly[k], w, "sum")).filter((x) => x != null);
      return sums.length >= 0.8 * members.length ? Math.round(100 * sums.filter((x) => x >= thr).length / sums.length) : null;
    });
  });

  // สรุปรายวัน (median ของทุกโมเดล) + PM2.5/UV จาก CAMS
  const aqT = aq ? aq.hourly.time.map(naiveMs) : [];
  const brief = wins.filter((w) => w.kind === "day").map((w) => {
    const med = (k) => { const t = tables[k]; if (!t) return null; const j = t.columns.indexOf(w.label);
      return j < 0 ? null : r1(median(Object.values(t.rows).map((r) => r[j]))); };
    const j = tables.rain.columns.indexOf(w.label);
    const vals = rainRows.map((r) => r[j]).filter((x) => x != null);
    const start = times[w.idx[0]] - HOUR, end = start + DAY;
    const aqIdx = aqT.flatMap((t, i) => (t > start && t <= end ? [i] : []));
    const pmV = aqIdx.map((i) => aq.hourly.pm2_5[i]).filter((x) => x != null);
    const uvA = aqIdx.map((i) => aq.hourly.uv_index[i]).filter((x) => x != null);
    const pm = pmV.length ? r1(pmV.reduce((a, b) => a + b, 0) / pmV.length) : null;
    const uvCand = [med("uv"), uvA.length ? Math.max(...uvA) : null].filter((x) => x != null);
    const uv = uvCand.length ? r1(Math.max(...uvCand)) : null;
    const feels = med("feels");
    return { label: w.label, rain: med("rain"), n_rain: vals.filter((x) => x >= thr).length, n_models: vals.length,
      tmin: med("tmin"), tmax: med("tmax"), feels, heat: pickLevel(feels, HEAT_LV), rh: med("rh"), gust: med("gust"),
      uv, uv_level: pickLevel(uv, UV_LV), pm25: pm, pm25_level: pickLevel(pm, PM_LV) };
  });

  // รายชั่วโมง 7 วันสำหรับกราฟ
  const hIdx = times.flatMap((t, i) => (t > now && t <= now + M.hourly_days * DAY ? [i] : []));
  const series = {};
  for (const v of M.hourly_vars) {
    series[v] = Object.fromEntries(Object.entries(data[v] || {}).map(([m, a]) => [m, hIdx.map((i) => a[i])]));
  }
  const aqByT = new Map(aqT.map((t, i) => [t, aq.hourly.pm2_5[i]]));
  const nearest = (list) => {
    let best = null, bd = Infinity;
    for (const s of list || []) { const d = distKm(lat, lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } }
    return best && bd <= M.max_station_km ? { ...best, dist_km: Math.round(bd * 10) / 10 } : null;
  };
  return {
    name: T("📍 ตำแหน่งของผู้ใช้", "📍 My location"), lat, lon, threshold_mm: thr, fetched_at: new Date(now).toISOString().slice(0, 19),
    windows: wins.map((w) => w.label),
    models: Object.keys(data.precipitation).map((n) => ({ name: n, grid_km: (M.models.find((m) => m.name === n) || {}).grid_km })),
    tables, consensus, ensemble, brief,
    hourly: { time: hIdx.map((i) => fc.hourly.time[i]), series, pm25: aq ? hIdx.map((i) => aqByT.get(times[i]) ?? null) : null },
    now: { station: nearest(state.nowObs.tmd), air: nearest(state.nowObs.air) },
  };
}

async function selectGps(remember = true) {
  document.body.classList.remove("about-mode", "heat-mode", "nat-mode");
  if (["#about", "#heat", "#th"].includes(location.hash)) history.replaceState(null, "", location.pathname);
  if (remember) store.set("tab", "gps");
  markChips();
  const chip = $("gps-chip");
  if (!navigator.geolocation) { chip.textContent = T("📍 เบราว์เซอร์นี้หาตำแหน่งไม่ได้", "📍 This browser cannot find your location"); return; }
  chip.textContent = T("📍 กำลังหาตำแหน่ง…", "📍 Finding your location…");
  const pos = await new Promise((ok) => navigator.geolocation.getCurrentPosition(ok, () => ok(null),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60000 }));
  if (!pos) { chip.textContent = T("📍 หาตำแหน่งไม่ได้ (อนุญาตให้เบราว์เซอร์ใช้ตำแหน่งก่อน)", "📍 Location unavailable (allow location access in your browser)"); return; }
  chip.textContent = T("📍 กำลังคำนวณพยากรณ์…", "📍 Calculating forecast…");
  document.body.style.opacity = "0.6";
  try {
    const { latitude: lat, longitude: lon } = pos.coords;
    state.loc = await buildLocalPayload(lat, lon);
    state.gps = { lat, lon };
    state.locIdx = -1;
    state.prov = null;
    markChips();
    showLocation();
    chip.textContent = `${T("📍 ตำแหน่งของผู้ใช้", "📍 My location")} (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
  } catch (e) {
    chip.textContent = T("📍 โหลดพยากรณ์ไม่ได้ ลองใหม่อีกครั้ง", "📍 Could not load the forecast. Please try again.");
  } finally {
    document.body.style.opacity = "";
  }
}

// ---------------------------------------------------------------------------
// แถบบันทึกฝน: เปิดฟอร์ม GitHub Issue ที่กรอกไว้แล้ว → GitHub Actions เก็บลง branch data
// ---------------------------------------------------------------------------
function bangkokNow() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 16);   // "YYYY-MM-DD HH:MM"
}
function reportTarget() {
  if (state.gps) return { name: state.locIdx === -1 ? "ตำแหน่งของผู้ใช้ (GPS)" : "ตำแหน่ง GPS", lat: state.gps.lat, lon: state.gps.lon };
  const l = state.locIdx === -2 ? state.loc : state.index.locations[state.locIdx];
  return { name: l.name, lat: l.lat, lon: l.lon };
}
function report(rained) {
  const t = reportTarget(), time = bangkokNow();
  const u = new URL(`https://github.com/${state.index.repo}/issues/new`);
  u.searchParams.set("template", "rain.yml");
  u.searchParams.set("labels", "rain-obs");
  u.searchParams.set("title", `${rained ? "🌧️ ฝนตก" : "☀️ ฝนไม่ตก"} · ${t.name} · ${time}`);
  u.searchParams.set("rain", rained ? "ตก" : "ไม่ตก");
  u.searchParams.set("location", t.name);
  u.searchParams.set("coords", `${t.lat.toFixed(5)}, ${t.lon.toFixed(5)}`);
  u.searchParams.set("time", time);
  window.open(u.toString(), "_blank", "noopener");
}
function initRainBar() {
  if (!state.index.repo) return;           // ดูในเครื่อง (ไม่มี repo) ก็ไม่แสดง
  $("rainbar").hidden = false;
  $("rb-rain").onclick = () => report(true);
  $("rb-dry").onclick = () => report(false);
  $("rb-gps").onclick = () => {
    if (!navigator.geolocation) { $("rb-gps").textContent = T("📍 ไม่รองรับ GPS", "📍 No GPS"); return; }
    $("rb-gps").textContent = T("📍 กำลังหา…", "📍 Finding…");
    navigator.geolocation.getCurrentPosition(
      (p) => { state.gps = { lat: p.coords.latitude, lon: p.coords.longitude }; $("rb-gps").textContent = T("📍 ใช้ GPS แล้ว", "📍 Using GPS"); renderRainBar(); },
      () => { $("rb-gps").textContent = T("📍 เปิด GPS ไม่ได้", "📍 GPS unavailable"); },
      { enableHighAccuracy: true, timeout: 15000 });
  };
}
function renderRainBar() {
  if ($("rainbar").hidden) return;
  const t = reportTarget();
  $("rb-loc").textContent = state.gps ? `${T("ตำแหน่ง GPS", "GPS location")} (${t.lat.toFixed(4)}, ${t.lon.toFixed(4)})` : tx(t.name);
  if (!state.gps) $("rb-gps").textContent = T("📍 ใช้ GPS", "📍 Use GPS");
  const o = state.index.observations || { count: 0, recent: [] };
  const last = o.recent[0];
  $("rb-hint").textContent = T("จะเปิดแบบฟอร์มบน GitHub ที่กรอกไว้ให้แล้ว → กด “Create” (หรือ Submit) เพื่อส่งรายงาน",
      "Opens a pre-filled form on GitHub → press “Create” (or Submit) to send your report") +
    (o.count ? T(` · รายงานแล้ว ${o.count} ครั้ง (ฝนตก ${o.rain})`, ` · ${o.count} reports so far (${o.rain} rain)`) +
      ` · ${T("ล่าสุด", "latest")} ${last.rained ? "🌧️" : "☀️"} ${tx(last.location)} ${last.obs_time.slice(5, 16)}` : "");
}

// ---------------------------------------------------------------------------
// ตอนนี้: ค่าวัดจริง (สถานีกรมอุตุฯ, Air4Thai) + ค่าจากโมเดลที่ดึงสดในเบราว์เซอร์
// ---------------------------------------------------------------------------
const WMO = EN ? {
  0: "☀️ Clear sky", 1: "🌤️ Mostly clear", 2: "⛅ Partly cloudy", 3: "☁️ Overcast",
  45: "🌫️ Fog", 48: "🌫️ Freezing fog", 51: "🌦️ Light drizzle", 53: "🌦️ Drizzle", 55: "🌦️ Heavy drizzle",
  61: "🌧️ Light rain", 63: "🌧️ Moderate rain", 65: "🌧️ Heavy rain", 80: "🌦️ Light showers", 81: "🌧️ Showers",
  82: "⛈️ Heavy showers", 95: "⛈️ Thunderstorm", 96: "⛈️ Thunderstorm with hail", 99: "⛈️ Thunderstorm with heavy hail",
} : {
  0: "☀️ ท้องฟ้าแจ่มใส", 1: "🌤️ ส่วนใหญ่แจ่มใส", 2: "⛅ มีเมฆบางส่วน", 3: "☁️ เมฆมาก",
  45: "🌫️ หมอก", 48: "🌫️ หมอกน้ำค้างแข็ง", 51: "🌦️ ฝนละอองเบา", 53: "🌦️ ฝนละออง", 55: "🌦️ ฝนละอองหนาแน่น",
  61: "🌧️ ฝนเล็กน้อย", 63: "🌧️ ฝนปานกลาง", 65: "🌧️ ฝนหนัก", 80: "🌦️ ฝนซู่เล็กน้อย", 81: "🌧️ ฝนซู่ปานกลาง",
  82: "⛈️ ฝนซู่หนัก", 95: "⛈️ พายุฝนฟ้าคะนอง", 96: "⛈️ พายุฝนฟ้าคะนอง ลูกเห็บ", 99: "⛈️ พายุฝนฟ้าคะนอง ลูกเห็บหนัก",
};
const DIRS = EN ? ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
  : ["เหนือ", "ตะวันออกเฉียงเหนือ", "ตะวันออก", "ตะวันออกเฉียงใต้", "ใต้", "ตะวันตกเฉียงใต้", "ตะวันตก", "ตะวันตกเฉียงเหนือ"];
const dirText = (deg) => (deg == null ? "" : T(`จากทิศ${DIRS[Math.round(deg / 45) % 8]}`, `from the ${DIRS[Math.round(deg / 45) % 8]}`));
const hhmm = (iso) => (iso ? localTime(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" }) : "–");
const currentCache = {};

function stationCard(s) {
  if (!s) {
    return el("article", { class: "card" }, el("h3", {}, T("📡 ค่าที่วัดได้ (กรมอุตุนิยมวิทยา)", "📡 Measured (Thai Meteorological Department)")),
      el("p", { class: "warn" }, T("ไม่มีสถานีอุตุนิยมวิทยาในระยะ 60 กม.", "No weather station within 60 km")));
  }
  const age = (Date.now() - localTime(s.time).getTime()) / 3600000;
  return el("article", { class: "card" },
    el("h3", {}, T(`📡 ค่าที่วัดได้ · สถานี${s.name}`, `📡 Measured · ${tx(s.name)} station`)),
    el("div", { class: "src" }, T(`ห่าง ${fmt(s.dist_km)} กม. · เวลา ${hhmm(s.time)} น. (อัปเดตทุก 3 ชม.)`, `${fmt(s.dist_km)} km away · ${hhmm(s.time)} (updated every 3 h)`)),
    el("div", { class: "hero" }, fmt(s.temp), el("small", {}, " °C")),
    el("dl", { class: "kv" },
      el("dt", {}, T("🌧️ ฝน 3 ชม.ล่าสุด", "🌧️ Rain, last 3 h")), el("dd", {}, `${fmt(s.rain_3h)} ${MM}`),
      el("dt", {}, T("🌧️ ฝน 24 ชม.", "🌧️ Rain, 24 h")), el("dd", {}, `${fmt(s.rain_24h)} ${MM}`),
      el("dt", {}, T("💧 ความชื้น", "💧 Humidity")), el("dd", {}, `${fmt(s.rh, 0)} %`),
      el("dt", {}, T("💨 ลม", "💨 Wind")), el("dd", {}, `${fmt(s.wind_kmh, 0)} ${KMH} ${dirText(s.wind_dir)}`),
      el("dt", {}, T("👁️ ทัศนวิสัย", "👁️ Visibility")), el("dd", {}, `${fmt(s.visibility_km, 0)} ${KM}`)),
    s.dist_km > 20 ? el("p", { class: "warn" }, T("ℹ️ สถานีอยู่ไกลจากตำแหน่งนี้ ค่าที่วัดได้อาจไม่ตรงกับที่นี่ โดยเฉพาะฝน", "ℹ️ The station is far from here, so its values may not match this place, especially rain")) : null,
    age > 4 ? el("p", { class: "warn" }, T(`⚠️ ข้อมูลเก่า ${Math.round(age)} ชม.`, `⚠️ Data is ${Math.round(age)} h old`)) : null);
}

function airCard(a) {
  if (!a) {
    return el("article", { class: "card" }, el("h3", {}, T("😷 PM2.5 ที่วัดได้ (Air4Thai)", "😷 Measured PM2.5 (Air4Thai)")),
      el("p", { class: "warn" }, T("ไม่มีสถานีวัดในระยะ 60 กม.", "No station within 60 km")));
  }
  return el("article", { class: "card" },
    el("h3", {}, `${T("😷 PM2.5 ที่วัดได้", "😷 Measured PM2.5")} · ${a.name}`),
    el("div", { class: "src" }, T(`ห่าง ${fmt(a.dist_km)} กม. · เวลา ${hhmm(a.time)} น. (รายชั่วโมง)`, `${fmt(a.dist_km)} km away · ${hhmm(a.time)} (hourly)`)),
    el("div", { class: "hero" }, fmt(a.pm25), el("small", {}, T(" มคก./ลบ.ม.", " µg/m³")), " ", statusPill(a.level)),
    el("div", { class: "hero-sub" }, a.area || ""));
}

function modelCard(c) {
  const card = el("article", { class: "card", id: "now-model" }, el("h3", {}, T("🖥️ ค่าตอนนี้จากโมเดล (Open-Meteo)", "🖥️ Model values now (Open-Meteo)")));
  if (!c) { card.append(el("div", { class: "src" }, T("กำลังโหลด…", "Loading…"))); return card; }
  if (c.error) { card.append(el("p", { class: "warn" }, T("โหลดไม่ได้", "Could not load"))); return card; }
  card.append(
    el("div", { class: "src" }, T(`เวลา ${hhmm(c.time)} น. · ค่าจากโมเดล (ไม่ใช่ค่าที่วัดได้) อัปเดตทุก 15 นาที`, `${hhmm(c.time)} · model value (not a measurement), updated every 15 min`)),
    el("div", { class: "hero" }, fmt(c.temperature_2m), el("small", {}, " °C")),
    el("div", { class: "hero-sub" }, WMO[c.weather_code] || `${T("รหัสอากาศ", "Weather code")} ${c.weather_code}`),
    el("dl", { class: "kv" },
      el("dt", {}, T("🌧️ ฝน 15 นาทีล่าสุด", "🌧️ Rain, last 15 min")), el("dd", {}, `${fmt(c.precipitation)} ${MM}`),
      el("dt", {}, T("🥵 รู้สึกเหมือน", "🥵 Feels like")), el("dd", {}, `${fmt(c.apparent_temperature, 0)} °C`),
      el("dt", {}, T("💧 ความชื้น", "💧 Humidity")), el("dd", {}, `${fmt(c.relative_humidity_2m, 0)} %`),
      el("dt", {}, T("💨 ลมกระโชก", "💨 Wind gusts")), el("dd", {}, `${fmt(c.wind_gusts_10m, 0)} ${KMH}`),
      el("dt", {}, T("☁️ เมฆ", "☁️ Cloud")), el("dd", {}, `${fmt(c.cloud_cover, 0)} %`)));
  return card;
}

async function fetchCurrent(lat, lon) {
  const key = `${lat},${lon}`, hit = currentCache[key];
  if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.search = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "Asia/Bangkok",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_gusts_10m",
  });
  const j = await getJSON(u.toString());
  currentCache[key] = { at: Date.now(), data: j.current };
  return j.current;
}

function renderNow() {
  const L = state.loc, n = L.now || {};
  $("now").replaceChildren(stationCard(n.station), airCard(n.air), modelCard(null));
  const idx = state.locIdx;
  fetchCurrent(L.lat, L.lon)
    .then((c) => { if (state.locIdx === idx) $("now-model").replaceWith(modelCard(c)); })
    .catch(() => { if (state.locIdx === idx) $("now-model").replaceWith(modelCard({ error: true })); });
}

// ---------------------------------------------------------------------------
// โมเดลไหนแม่น: คะแนนจากการเทียบกับค่าวัดจริง (data/verification.json)
// ---------------------------------------------------------------------------
// แหล่งค่าวัดในโหมด WMO (สถานีอุตุฯ ใกล้ตำแหน่ง tmd3h ยังคำนวณอยู่ แต่ซ้ำกับส่วนทั่วประเทศ จึงไม่แสดง)
const V_SOURCES = [
  { key: "national", icon: "🗺️", title: T("สถานีอุตุนิยมวิทยาทั่วประเทศ", "Weather stations nationwide"),
    desc: T("~120 สถานี และเครื่องวัดฝน ~3,200 เครื่อง · เมืองเทียบชนบท", "~120 stations and ~3,200 rain gauges · urban vs rural"),
    vars: [["national_rain", T("ฝนรายวัน", "Daily rain")], ["national3h_rain", T("ฝน 3 ชม.", "3-hour rain")], ["national_tmin", T("อุณหภูมิต่ำสุด", "Min temperature")],
      ["national_tmax", T("อุณหภูมิสูงสุด", "Max temperature")], ["national3h_temp", T("อุณหภูมิ 3 ชม.", "3-hour temperature")],
      ["allgauge_rain", T("ฝนรายวัน · เครื่องวัดฝนทุกเครื่อง", "Daily rain · every rain gauge")]],
    wait: T("คำนวณวันละครั้ง หลังกรมอุตุนิยมวิทยาสรุปค่า 07:00 น.", "Calculated once a day, after the Thai Meteorological Department's 07:00 summary") },
  { key: "tw", icon: "🏙️", title: T("เครื่องวัดฝนในเมือง", "Rain gauges in the city"),
    desc: T("เครื่องวัดฝนทุกเครื่องในเขตเมือง และจุดตรวจ กทม./อยุธยา · โมเดลละเอียดสูง", "Every urban rain gauge, and the Bangkok/Ayutthaya check points · high-resolution models"),
    vars: [["urbangauge_rain", T("ฝนรายวัน · ทุกเครื่องในเขตเมือง", "Daily rain · every urban gauge")], ["thaiwater24h_rain", T("ฝนรายวัน · จุดตรวจ", "Daily rain · check points")],
      ["tw3h_rain", T("ฝน 3 ชม.", "3-hour rain")], ["hii24h_rain", T("ฝน 19–19 น. (เทียบ HII)", "Rain 19–19 (vs HII)")]], kind: "tw",
    wait: T("ใช้รอบรันที่เริ่มก่อนช่วงที่วัด · HII ออกวันละรอบ 19:00 น.", "Uses runs that started before the measured period · HII is published once a day at 19:00") },
  { key: "user", icon: "🙋", title: T("รายงานจากผู้ใช้", "User reports"), desc: T("ฝนตก / ไม่ตก จากปุ่มด้านบน", "Rain / no rain from the buttons above"),
    vars: [["user_rain", T("ฝนตก/ไม่ตก", "Rain/no rain")]], wait: T("ยังไม่มีรายงานจากผู้ใช้", "No user reports yet") },
];
function leadText(l) {
  if (l.includes("|")) { const [b, g] = l.split("|"); return `${leadText(b)} · ${tx(g)}`; }
  if (l.startsWith("T+")) return `T+${l.slice(2).replace("-", "–")} ${H}`;     // นับจากรอบรัน (WMO)
  if (l.startsWith("D+")) return `Day ${l.slice(2)}`;
  if (/^H\d+$/.test(l)) return T(`ล่วงหน้า ≥ ${l.slice(1)} ชม.`, `≥ ${l.slice(1)} h ahead`);
  return T(`ล่วงหน้า ${l}`, `${tx(l)} ahead`);
}
function habit(r) {
  if (r.bias == null) return el("span", { class: "habit" }, "–");
  if (r.bias > 1.25) return el("span", { class: "habit" }, T("↑ ทายว่าฝนตกบ่อยเกิน", "↑ forecasts rain too often"));
  if (r.bias < 0.8) return el("span", { class: "habit" }, T("↓ ทายว่าฝนตกน้อยเกิน", "↓ forecasts rain too rarely"));
  return el("span", { class: "habit ok" }, T("✓ พอดี", "✓ balanced"));
}
function tempHabit(r) {
  if (r.bias == null) return "–";
  if (Math.abs(r.bias) < 0.3) return T("✓ ใกล้เคียง", "✓ close");
  return `${r.bias > 0 ? T("↑ สูงกว่าจริง", "↑ too warm") : T("↓ ต่ำกว่าจริง", "↓ too cold")} ${fmt(Math.abs(r.bias))} °C`;
}

// ---------------------------------------------------------------------------
// 👤 มุมผู้ใช้: ถ้าเว็บบอกว่าฝนจะตก เชื่อได้แค่ไหน (verification.json → user_mode)
// ---------------------------------------------------------------------------
const U_WIN_TEXT = EN ? { "+3": "3 h ahead", "+6": "6 h ahead", "+12": "12 h ahead", "+24": "24 h ahead", "D+1": "Tomorrow", "D+3": "3 days ahead", "D+7": "7 days ahead" }
  : { "+3": "ล่วงหน้า 3 ชม.", "+6": "ล่วงหน้า 6 ชม.", "+12": "ล่วงหน้า 12 ชม.", "+24": "ล่วงหน้า 24 ชม.", "D+1": "พรุ่งนี้", "D+3": "ล่วงหน้า 3 วัน", "D+7": "ล่วงหน้า 7 วัน" };
const winKey = (w) => (/^\+(\d+)/.exec(w) ? `+${/^\+(\d+)/.exec(w)[1]}` : /^D\+(\d+)/.exec(w) ? `D+${/^D\+(\d+)/.exec(w)[1]}` : w);
function userScope() {
  const U = state.verify?.user_mode;
  if (!U) return null;
  // ตำแหน่งที่มีจุดตรวจของตัวเองใช้ชื่อตำแหน่ง มิฉะนั้นใช้จังหวัดของสถานีอุตุนิยมวิทยาที่ใกล้ที่สุด (จุดตรวจทั่วประเทศ)
  const name = state.loc?.name && U.scopes[state.loc.name] ? state.loc.name : state.nearProv && U.scopes[state.nearProv] ? state.nearProv : null;
  return { name: name || "ทุกตำแหน่ง", data: (name && U.scopes[name]) || U.scopes["ทุกตำแหน่ง"] || {} };
}
function medianRow(w) {
  const U = state.verify?.user_mode, sc = userScope();
  return U && sc ? ((sc.data[w] || {}).rows || []).find((r) => r.model === U.median) : null;
}
/** ป้ายสั้น ๆ ใต้การ์ดพยากรณ์: ที่ผ่านมาค่ากลางทุกโมเดลของช่วงนี้แม่นแค่ไหน */
function trustBadge(w) {
  const r = medianRow(winKey(w));
  if (!state.verify?.user_mode) return null;
  if (!r || r.n < 10 || r.n_rain < 3)
    return el("div", { class: "trust wait", title: T("ต้องมีข้อมูลอย่างน้อย 10 ครั้ง และฝนตกอย่างน้อย 3 ครั้ง", "Needs at least 10 cases with at least 3 rain events") },
      T(`📊 กำลังเก็บข้อมูล (${r ? r.n : 0} ครั้ง)`, `📊 Collecting data (${r ? r.n : 0} cases)`));
  return el("div", { class: "trust", title: T(`ค่ากลางของทุกโมเดล · ${r.n} ครั้ง · ${state.verify.user_mode.days} วันล่าสุด`, `All-model median · ${r.n} cases · last ${state.verify.user_mode.days} days`) },
    T(`📊 ที่ผ่านมา: บอกว่าตก → ตกจริง ${fmt(r.sr10 ?? 0, 0)}/10 · ฝนตก → เตือนไว้ ${fmt(r.pod10 ?? 0, 0)}/10`,
      `📊 Track record: said rain → it rained ${fmt(r.sr10 ?? 0, 0)}/10 · it rained → was warned ${fmt(r.pod10 ?? 0, 0)}/10`));
}
function renderUserMode() {
  const V = state.verify, U = V?.user_mode;
  const mode = store.get("v-mode") || "user";
  $("vm-user").setAttribute("aria-selected", String(mode === "user"));
  $("vm-wmo").setAttribute("aria-selected", String(mode === "wmo"));
  $("vm-user").onclick = () => { store.set("v-mode", "user"); renderUserMode(); };
  $("vm-wmo").onclick = () => { store.set("v-mode", "wmo"); renderUserMode(); };
  $("v-user").hidden = mode !== "user";
  $("v-wmo").hidden = mode !== "wmo";
  if (mode !== "user") return;
  const sc = userScope();
  if (!U || !sc) {
    $("u-summary").replaceChildren(el("p", {}, T("⏳ กำลังเก็บข้อมูลสำหรับมุมมองนี้", "⏳ Collecting data for this view")));
    return;
  }
  const wins = U.windows.filter((w) => sc.data[w]);
  const w = wins.includes(state.uWin) ? state.uWin : (wins.includes("+3") ? "+3" : wins[0]);
  state.uWin = w;
  $("u-wins").replaceChildren(...wins.map((x) => el("button", { class: "chip", role: "tab", type: "button",
    "aria-selected": String(x === w), onclick: () => { state.uWin = x; renderUserMode(); } }, U_WIN_TEXT[x] || x)));
  const rows = ((sc.data[w] || {}).rows || []).filter((r) => r.n >= 3);
  const med = rows.find((r) => r.model === U.median);
  const models = rows.filter((r) => r.model !== U.median && r.model !== U.ens && r.n_rain >= 3);
  const best = [...models].sort((a, b) => (b.csi ?? 0) - (a.csi ?? 0))[0];
  const scopeTxt = sc.name === "ทุกตำแหน่ง" ? T("ทุกจุดตรวจ", "all check points")
    : state.loc?.name === sc.name ? T(`จุดตรวจของ${sc.name}`, `check points of ${tx(sc.name)}`)
      : T(`จุดตรวจในจังหวัด${sc.name} (สถานีที่ใกล้ที่สุด)`, `check points in ${tx(sc.name)} (nearest station)`);
  $("u-summary").replaceChildren(el("p", {}, ...(med ? [
    el("b", {}, U_WIN_TEXT[w]), T(`: เมื่อค่ากลางของทุกโมเดลบอกว่าฝนจะตก → `, `: when the all-model median says rain → `),
    el("b", {}, T(`ตกจริง ${fmt(med.sr10 ?? 0, 0)} ใน 10 ครั้ง`, `it rained ${fmt(med.sr10 ?? 0, 0)} times in 10`)),
    T(` · เมื่อฝนตก → `, ` · when it rained → `), el("b", {}, T(`เตือนไว้ก่อน ${fmt(med.pod10 ?? 0, 0)} ใน 10 ครั้ง`, `it was forecast ${fmt(med.pod10 ?? 0, 0)} times in 10`)),
    T(` (${num(med.n)} ครั้ง, ฝนตก ${med.n_rain} ครั้ง, ${scopeTxt})`, ` (${num(med.n)} cases, ${med.n_rain} with rain, ${scopeTxt})`),
    best ? [T(` · แม่นที่สุดในช่วงนี้: `, ` · best in this period: `), el("b", {}, tx(best.model))] : "",
    med.n < 30 ? T(" · ข้อมูลยังน้อย ผลอาจเปลี่ยน", " · few cases so far, results may change") : ""].flat()
    : [T("⏳ ข้อมูลยังไม่พอสำหรับช่วงนี้", "⏳ Not enough data for this period yet")])));
  const bar = (x) => el("td", { class: "barcell" }, el("span", { class: "meter wide", "aria-hidden": "true" },
    el("i", { style: `width:${Math.max(3, (x ?? 0) * 10)}%` })), " ", el("b", {}, x == null ? "–" : `${fmt(x, 0)}/10`));
  const order = [med, rows.find((r) => r.model === U.ens), ...rows.filter((r) => r.model !== U.median && r.model !== U.ens)].filter(Boolean);
  $("u-table").replaceChildren(el("table", { class: "v-simple" },
    el("thead", {}, el("tr", {}, ...(EN ? ["Source", "Said rain → it rained", "It rained → was warned", "Accuracy", `Heavy rain (≥ ${U.heavy_mm[w]} mm) caught`, "Cases"]
      : ["แหล่ง", "บอกว่าตก → ตกจริง", "ฝนตก → เตือนไว้", "ทายถูกรวม", `ฝนหนัก (≥ ${U.heavy_mm[w]} มม.) ที่ทายได้`, "ครั้ง"])
      .map((h, i) => el("th", { style: i === 0 ? "text-align:left" : null }, h)))),
    el("tbody", {}, order.map((r) => el("tr", { class: r.model === U.median ? "accent" : null },
      el("th", { scope: "row" }, tx(r.model), r.model === U.median ? el("span", { class: "km" }, T("ค่าที่แสดงบนหน้าเว็บ", "shown on this page")) : null),
      bar(r.sr10), bar(r.pod10), el("td", { class: "num" }, r.acc == null ? "–" : `${fmt(r.acc, 0)}%`),
      el("td", { class: "num" }, r.heavy_n ? `${Math.round((r.heavy_pod10 ?? 0) * r.heavy_n / 10)}/${r.heavy_n}` : T("ยังไม่มีฝนหนัก", "no heavy rain yet")),
      el("td", { class: "num" }, num(r.n)))))));
  // ช่วงของวัน (ค่ากลางทุกโมเดล)
  const tod = (sc.data[w] || {}).tod || {};
  const TOD_EN = { "เช้า": "Morning", "บ่าย": "Afternoon", "ค่ำ": "Evening", "ดึก": "Night" };
  const TODS = [["เช้า", "07–13"], ["บ่าย", "13–19"], ["ค่ำ", "19–01"], ["ดึก", "01–07"]].filter(([t]) => tod[t]);
  $("u-tod").replaceChildren(...(TODS.length ? [el("h4", {}, T(`ช่วงเวลาของวัน (${U_WIN_TEXT[w]})`, `Time of day (${U_WIN_TEXT[w]})`)),
    el("table", { class: "v-simple" }, el("thead", {}, el("tr", {}, ...(EN ? ["Time", "Said rain → it rained", "It rained → was warned", "Cases"]
      : ["ช่วง", "บอกว่าตก → ตกจริง", "ฝนตก → เตือนไว้", "ครั้ง"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, TODS.map(([t, hh]) => el("tr", {}, el("th", { scope: "row" }, `${T(t, TOD_EN[t])} `, el("span", { class: "km" }, T(`${hh} น.`, hh))),
        el("td", { class: "num" }, tod[t].sr10 == null ? "–" : `${fmt(tod[t].sr10, 0)}/10`),
        el("td", { class: "num" }, tod[t].pod10 == null ? "–" : `${fmt(tod[t].pod10, 0)}/10`),
        el("td", { class: "num" }, tod[t].n)))))] : []));
  // โอกาสฝน % เชื่อได้ไหม
  const rel = (sc.data._reliability || []).filter((b) => b.n);
  $("u-rel").replaceChildren(...(w === "+3" && rel.length ? [el("h4", {}, T("โอกาสฝน % เชื่อได้ไหม (ล่วงหน้า 3 ชม.)", "Can you trust the rain chance %? (3 h ahead)")),
    el("table", { class: "v-simple" }, el("thead", {}, el("tr", {}, ...(EN ? ["Forecast chance", "How often it rained", "Cases"]
      : ["โอกาสที่ทาย", "ตกจริงบ่อยแค่ไหน", "ครั้ง"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, rel.map((b) => el("tr", {}, el("th", { scope: "row" }, `${b.lo}–${b.hi}%`),
        el("td", { class: "num" }, b.freq == null ? "–" : `${b.freq}%`), el("td", { class: "num" }, b.n))))),
    el("p", { class: "note" }, T("ถ้าโอกาสฝน % เชื่อได้ สองคอลัมน์ควรใกล้กัน เช่น ทาย 60–80% → ตกจริงประมาณ 70%",
      "If the rain chance is reliable, the two columns should be close, e.g. forecast 60–80% → it rained about 70% of the time"))] : []));
  $("u-note").textContent = T(`${U.days} วันล่าสุด (เริ่ม ${U.since || "–"}) · ค่าที่วัดได้: เครื่องวัดฝนรายชั่วโมง และสถานีอุตุนิยมวิทยาทุก 3 ชม. ที่จุดตรวจ · ` +
    `Google Weather มีเฉพาะจุดตรวจ กทม. 2 จุด ล่วงหน้า 48 ชม. · ฝนหนัก: +3/+6 ชม. ≥ 10, +12/+24 ชม. ≥ 20, รายวัน ≥ 35 มม.`,
    `Last ${U.days} days (since ${U.since || "–"}) · measurements: hourly rain gauges and 3-hourly weather stations at the check points · ` +
    `Google Weather covers only 2 Bangkok check points, 48 h ahead · heavy rain: +3/+6 h ≥ 10, +12/+24 h ≥ 20, daily ≥ 35 mm`);
}

function renderVerify() {
  const V = state.verify;
  if (!V) return;
  const byId = Object.fromEntries(V.sections.map((x) => [x.id, x]));
  const obsOf = (src) => src.vars.reduce((a, [id]) => a + (byId[id]?.n_obs || 0), 0);
  const saved = store.get("v-source");
  const src = V_SOURCES.find((x) => x.key === (state.vSource || saved)) || V_SOURCES.find((x) => obsOf(x)) || V_SOURCES[0];
  state.vSource = src.key;

  // การ์ดแหล่งค่าวัดจริง
  $("v-sources").replaceChildren(...V_SOURCES.map((x) => {
    const n = obsOf(x);
    const pts = (V.points || []).filter((p) => p.kind === x.kind).length;
    return el("button", { class: "v-card", role: "tab", type: "button", "aria-selected": String(x.key === src.key),
      onclick: () => { state.vSource = x.key; state.vSection = null; state.vLead = null; store.set("v-source", x.key); renderVerify(); } },
      el("span", { class: "v-ico" }, x.icon),
      el("b", {}, x.title),
      el("span", { class: "v-desc" }, x.desc + (pts ? T(` · ${pts} จุดตรวจ`, ` · ${pts} check points`) : "")),
      el("span", { class: n ? "v-badge ok" : "v-badge" }, n ? T(`ตรวจแล้ว ${num(n)} คู่`, `${num(n)} pairs checked`) : T("⏳ กำลังเก็บข้อมูล", "⏳ Collecting data")));
  }));

  // ตัวแปร (ฝน/อุณหภูมิ) และช่วงล่วงหน้า
  const secId = src.vars.some(([id]) => id === state.vSection) ? state.vSection : src.vars[0][0];
  state.vSection = secId;
  $("v-vars").replaceChildren(...(src.vars.length > 1 ? src.vars.map(([id, lab]) =>
    el("button", { class: "chip", role: "tab", type: "button", "aria-selected": String(id === secId),
      onclick: () => { state.vSection = id; state.vLead = null; renderVerify(); } }, lab)) : []));
  const pick = byId[secId] || { leads: [], tables: {}, n_obs: 0 };
  // ค่าเริ่มต้น: ช่วงที่มีโมเดลให้เทียบมากที่สุด (เท่ากันใช้ที่มีจำนวนครั้งมากกว่า)
  const score = (l) => { const t = (pick.tables || {})[l] || []; return t.length * 1e6 + t.reduce((a, r) => a + (r.n || 0), 0); };
  const best = [...pick.leads].sort((a, b) => score(b) - score(a))[0];
  const lead = pick.leads.includes(state.vLead) ? state.vLead : best;
  state.vLead = lead;
  $("v-leads").replaceChildren(...pick.leads.map((l) =>
    el("button", { class: "chip", role: "tab", type: "button", "aria-selected": String(l === lead),
      onclick: () => { state.vLead = l; renderVerify(); } }, leadText(l),
      el("span", { class: "chip-n" }, ` · ${((pick.tables || {})[l] || []).length} ${T("โมเดล", "models")}`))));
  $("v-sub").textContent = T(`${V.days} วันล่าสุด · เริ่มเก็บ ${V.since || "วันนี้"} · อัปเดต ${timeAgo(V.updated)}`,
    `Last ${V.days} days · collecting since ${V.since || "today"} · updated ${timeAgo(V.updated)}`);

  const rows = (pick.tables || {})[lead] || [];
  const rain = pick.variable === "rain";
  if (!rows.length) {
    $("v-summary").replaceChildren(el("p", {}, `${T("⏳ กำลังเก็บข้อมูล", "⏳ Collecting data")} — ${src.wait}`));
    ["v-table", "v-table-full", "v-ens"].forEach((id) => $(id).replaceChildren());
    $("v-note").textContent = "";
  } else {
    // สรุปเป็นประโยคธรรมดา
    const best = rows[0], worst = rows[rows.length - 1];
    const few = best.n < 30 ? T(" (ข้อมูลยังน้อย ผลอาจเปลี่ยน)", " (few cases so far, results may change)") : "";
    const sum = rain
      ? [el("b", {}, leadText(lead)), `: `, el("b", {}, best.model), T(` จับฝนได้ดีที่สุด — CSI ${fmt(best.csi, 0)} จาก 100 · `, ` catches rain best — CSI ${fmt(best.csi, 0)} of 100 · `),
         T(`ทายถูกรวม ${fmt(best.acc, 0)}% จาก ${num(best.n)} ครั้ง`, `accuracy ${fmt(best.acc, 0)}% over ${num(best.n)} cases`), few,
         rows.length > 1 ? T(` · ต่ำสุด ${worst.model} (${fmt(worst.csi, 0)})`, ` · lowest ${worst.model} (${fmt(worst.csi, 0)})`) : ""]
      : [el("b", {}, leadText(lead)), `: `, el("b", {}, best.model), T(` แม่นที่สุด — คลาดเฉลี่ย ${fmt(best.mae)} °C (${tempHabit(best)})`, ` is most accurate — average error ${fmt(best.mae)} °C (${tempHabit(best)})`), few,
         rows.length > 1 ? T(` · คลาดมากที่สุด ${worst.model} (${fmt(worst.mae)} °C)`, ` · largest error ${worst.model} (${fmt(worst.mae)} °C)`) : ""];
    $("v-summary").replaceChildren(el("p", {}, ...sum));

    // ตารางแบบง่าย
    const worstMae = Math.max(...rows.map((r) => r.mae || 0), 0.1);
    const barCell = (pct, text) => el("td", { class: "barcell" },
      el("span", { class: "meter wide", "aria-hidden": "true" }, el("i", { style: `width:${Math.max(3, pct)}%` })), " ", el("b", {}, text));
    const head = rain ? ["#", T("โมเดล", "Model"), "CSI (0–100)", T("ทายถูกรวม", "Accuracy"), T("ทายบ่อยไป/น้อยไป", "Too often / too rarely"), T("ครั้ง", "Cases")]
                      : ["#", T("โมเดล", "Model"), T("คลาดเฉลี่ย MAE (น้อยดีกว่า)", "MAE (lower is better)"), T("สูง/ต่ำกว่าจริง", "Too warm / too cold"), T("ครั้ง", "Cases")];
    $("v-table").replaceChildren(el("table", { class: "v-simple" },
      el("thead", {}, el("tr", {}, ...head.map((h, i) => el("th", { style: i === 1 ? "text-align:left" : null }, h)))),
      el("tbody", {}, rows.map((r, i) => el("tr", { class: r.model === state.highlight ? "accent" : null },
        el("td", { class: "rank" }, i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1),
        el("th", { scope: "row" }, tx(r.model), r.grid_km ? el("span", { class: "km" }, `${r.grid_km} ${KM}`) : null),
        ...(rain
          ? [barCell(r.csi ?? 0, fmt(r.csi, 0)), el("td", { class: "num" }, `${fmt(r.acc, 0)}%`), el("td", {}, habit(r)),
             el("td", { class: "num" }, num(r.n))]
          : [barCell(100 * (r.mae || 0) / worstMae, `${fmt(r.mae)} °C`), el("td", {}, tempHabit(r)),
             el("td", { class: "num" }, num(r.n))]))))));

    // รายละเอียดเชิงเทคนิค
    const cols = rain
      ? [["csi", "CSI %"], ["acc", "Accuracy %"], ["pod", "POD %"], ["far", "FAR %"], ["bias", "Bias"], ["mae", `MAE ${MM}`], ["n", "n"]]
      : [["mae", "MAE °C"], ["bias", "Bias °C"], ["rmse", "RMSE °C"], ["n", "n"]];
    $("v-table-full").replaceChildren(el("table", {},
      el("thead", {}, el("tr", {}, el("th", { style: "text-align:left" }, T("โมเดล", "Model")), ...cols.map(([, h]) => el("th", {}, h)))),
      el("tbody", {}, rows.map((r) => el("tr", {}, el("th", { scope: "row" }, tx(r.model)),
        ...cols.map(([k]) => el("td", { class: "num" }, r[k] == null ? "–" : fmt(r[k], k === "n" ? 0 : k === "bias" && rain ? 2 : 1))))))));
    const ens = (pick.ens_tables || {})[lead] || [];
    $("v-ens").replaceChildren(...(ens.length ? [el("table", {},
      el("thead", {}, el("tr", {}, el("th", { style: "text-align:left" }, T("Ensemble (โอกาสฝน)", "Ensemble (rain chance)")),
        ...[T("Brier (ต่ำดี)", "Brier (lower is better)"), T("ทายถูก %", "Accuracy %"), "POD %", "FAR %", "n"].map((h) => el("th", {}, h)))),
      el("tbody", {}, ens.map((r) => el("tr", {}, el("th", { scope: "row" }, r.model),
        ...["brier", "acc", "pod", "far", "n"].map((k) => el("td", { class: "num" }, r[k] == null ? "–" : fmt(r[k], k === "brier" ? 3 : k === "n" ? 0 : 1)))))))] : []));
    const thr = !rain ? "" : ["tmd3h", "tw3h", "user", "national3h"].includes(pick.source)
      ? T("นับว่า “ฝนตก” เมื่อ ≥ 0.2 มม. ใน 3 ชม.", "“Rain” means ≥ 0.2 mm in 3 h") : T("นับว่า “ฝนตก” เมื่อ ≥ 1 มม. ต่อวัน", "“Rain” means ≥ 1 mm per day");
    $("v-note").textContent = T(`ค่าที่วัดได้ ${num(pick.n_obs)} ครั้ง จาก ${pick.n_points} จุด`, `${num(pick.n_obs)} measurements from ${pick.n_points} points`) + (thr ? " · " + thr : "");
  }
  const pts = (V.points || []).filter((p) => !src.kind || p.kind === src.kind);
  const local = pts.filter((p) => !p.national), nat = pts.filter((p) => p.national);
  const byProv = {};
  nat.forEach((p) => (byProv[p.for] = byProv[p.for] || []).push(p.name.replace(/^สถานี/, "")));
  $("v-points").replaceChildren(...(pts.length ? [
    local.length ? [el("b", {}, T("จุดตรวจของตำแหน่งหลัก (พยากรณ์ทุกชั่วโมง):", "Check points of the main locations (hourly forecasts):")),
      el("ul", {}, local.map((p) => el("li", {}, `${tx(p.for)} → ${tx(p.name)} (${T("ห่าง", "")}${fmt(p.dist_km)} ${KM}${T("", " away")})`)))] : [],
    nat.length ? el("details", { class: "nat-points" },
      el("summary", {}, el("b", {}, T(`จุดตรวจทั่วประเทศ: สถานีอุตุนิยมวิทยา ${nat.length} แห่ง ใน ${Object.keys(byProv).length} จังหวัด`,
        `Nationwide check points: ${nat.length} weather stations in ${Object.keys(byProv).length} provinces`)),
        T(" (พยากรณ์อุณหภูมิและฝนทุก 6 ชม.)", " (temperature and rain forecasts every 6 h)")),
      el("ul", { class: "cols" }, Object.keys(byProv).sort((a, b) => tx(a).localeCompare(tx(b), LANG)).map((pv) =>
        el("li", {}, el("b", {}, tx(pv)), ": ", byProv[pv].map(tx).join(", "))))) : null,
    el("p", { class: "note" }, el("a", { href: "data.html#details" }, T("รายละเอียดของข้อมูลทั้งหมด →", "Details of all data →")))].flat() :   // flat: รายการจุดตรวจของตำแหน่งหลักเป็น array ซ้อน
    src.key === "national" ? [el("div", {}, T("ทั่วประเทศ: สถานีอุตุฯ ~124 แห่ง (สรุป 07:00 น.) เทียบกับค่าที่ทายไว้ล่วงหน้าอย่างน้อย 24, 72, 168 ชม. ทุกชั่วโมง (Open-Meteo Previous Runs)",
      "Nationwide: ~124 weather stations (07:00 summary) compared with values forecast at least 24, 72 and 168 h ahead, every hour (Open-Meteo Previous Runs)"))] : []));
}
// ---------------------------------------------------------------------------
// 🕐 รอบรันของแต่ละโมเดล (init time) ของข้อมูลที่แสดงอยู่
// ---------------------------------------------------------------------------
const thTime = (ms) => new Date(ms).toLocaleString(LOCALE, { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function renderRuns() {
  const L = state.loc, runs = L.runs || {};
  const names = [...L.models.map((m) => m.name), ...Object.keys(L.ensemble || {}).map((k) => k.replace(/ \(\d+\)$/, ""))];
  const rows = [...new Set(names)].filter((n) => runs[n]);
  if (state.hii && L.name in (state.hii.points || {})) rows.push("HII WRF-ROMS");
  const hiiRun = state.hii ? { init: state.hii.init_utc.replace(" ", "T"), source: "hii" } : null;
  const SRC = EN ? { meta: "✓ confirmed", estimated: "≈ estimated", continuous: "continuous", hii: "✓ from HII image" }
    : { meta: "✓ ยืนยันแล้ว", estimated: "≈ ประมาณ", continuous: "ต่อเนื่อง", hii: "✓ จากภาพ สสน." };
  const fetched = L.fetched_at ? naiveMs(L.fetched_at.slice(0, 16)) - 7 * HOUR : Date.now();                     // เวลาที่ดึง (UTC)
  $("runs-sub").textContent = rows.length ? T(`ดึงเมื่อ ${thTime(fetched)} น. (เวลาที่ใช้ทั้งหน้านี้)`, `fetched ${thTime(fetched)} (the time used across this page)`)
    : T("ตำแหน่งนี้คำนวณในเบราว์เซอร์ ใช้รอบล่าสุดของ Open-Meteo", "This location is calculated in your browser from Open-Meteo's latest runs");
  $("runs-table").replaceChildren(...(rows.length ? [el("table", {},
    el("thead", {}, el("tr", {}, ...(EN ? ["Model", "Run (UTC)", "Thai time", "Run age when fetched", "Source"]
      : ["โมเดล", "รอบรัน (UTC)", "เวลาไทย", "รอบนี้เก่าแค่ไหนตอนดึง", "ที่มา"]).map((h, i) =>
      el("th", { style: i === 0 ? "text-align:left" : null }, h)))),
    el("tbody", {}, rows.map((n) => {
      const r = n === "HII WRF-ROMS" ? hiiRun : runs[n];
      const t = naiveMs(r.init.slice(0, 16));
      const age = Math.round((fetched - t) / HOUR);
      const utc = new Date(t).toISOString().slice(5, 16).replace("T", " ").replace("-", "/");
      return el("tr", {}, el("th", { scope: "row" }, n),
        el("td", { class: "num" }, r.source === "continuous" ? "–" : `${utc}Z`),
        el("td", { class: "num" }, r.source === "continuous" ? "–" : thTime(t)),
        el("td", { class: "num" }, r.source === "continuous" ? T("อัปเดตต่อเนื่อง", "continuous") : `${age} ${H}`),
        el("td", {}, SRC[r.source] || r.source));
    })))] : []));
}

// ---------------------------------------------------------------------------
// 🌊 HII WRF-ROMS: ช่วงฝน 7 วันที่อ่านจากภาพของ สสน. (data/hii.json)
// ---------------------------------------------------------------------------
function renderHii() {
  const sec = $("hii-section");
  if (state.hii === undefined) {
    state.hii = null;
    getJSON("data/hii.json").then((j) => { state.hii = j; if (state.loc) { renderHii(); renderRuns(); } }).catch(() => {});
  }
  const H = state.hii, days = H && state.loc && (H.points || {})[state.loc.name];
  sec.hidden = !days;
  if (!days) return;
  const init = naiveMs(H.init_utc.replace(" ", "T").slice(0, 16));
  $("hii-sub").textContent = `${T("รอบรัน", "run")} ${new Date(init).toISOString().slice(0, 16).replace("T", " ")}Z (${thTime(init)}${T(" น.", "")}) · ${T(H.model.agency, "Hydro-Informatics Institute (HII)")}`;
  const ms = (x) => naiveMs(x.replace(" ", "T").slice(0, 16));
  const base = baseMs() ?? Date.now();
  const left = days.filter((d) => ms(d.end) > base);                    // ช่วงที่ยังไม่จบ
  $("hii-tiles").replaceChildren(...left.map((d) => {
    const s0 = ms(d.start), e0 = ms(d.end);
    return el("div", { class: "tile" },
      el("div", { class: "t" }, `${dayWord(s0, base) === TODAY ? T("คืนนี้", "tonight") : dMon(s0)} 19:00 →`,
        el("span", { class: "wsub" }, `${dayWord(e0, base)} 19:00 · ${T("รอบ", "")} Day ${d.day}`)),
      el("div", { class: "v" }, d.high <= 1 ? "< 1" : `${fmt(d.low, 0)}–${fmt(d.high, 0)}`, el("small", {}, ` ${MM}`)),
      el("div", { class: "d" }, d.high <= 1 ? T("☀️ ไม่มีฝน", "☀️ No rain") : d.low >= 35 ? T("⛈️ ฝนหนัก", "⛈️ Heavy rain")
        : d.low >= 10 ? T("🌧️ ปานกลาง", "🌧️ Moderate") : T("🌦️ เล็กน้อย", "🌦️ Light")),
      el("div", { class: "d" }, `${T("กริด", "grid")} ${d.domain_km} ${KM}${s0 < base ? T(" · อยู่ในช่วงนี้", " · in progress") : ""}`));
  }));
  $("hii-note").textContent = T("สสน. เผยแพร่เป็นภาพแผนที่ (ไม่มีตัวเลข) ระบบอ่านสีที่ตำแหน่งนี้เป็นช่วงปริมาณฝน · Day 1–3 จากแผนที่ประเทศไทย 3 กม., Day 4–7 จากแผนที่อาเซียน 9 กม. · " +
    "แต่ละช่อง = ฝนรวม 24 ชม. 19:00 → 19:00 น. (12–12 UTC) ซึ่งต่างจากวัน 07:00 → 07:00 น. ของตารางด้านบน 12 ชม. จึงแสดงแยก (ไม่รวมในค่ากลาง)",
    "HII publishes map images (no numbers); the system reads the colour at this location as a rain range · Day 1–3 from the 3 km Thailand map, Day 4–7 from the 9 km ASEAN map · " +
    "each box = 24-hour rain 19:00 → 19:00 (12–12 UTC), 12 h offset from the 07:00 → 07:00 days above, so it is shown separately (not in the median)");
}

// ---------------------------------------------------------------------------
// การ์ดสรุปรายวัน
// ---------------------------------------------------------------------------
function renderBrief() {
  const L = state.loc;
  $("brief").replaceChildren(...L.brief.map((b, i) => {
    const wi = winInfo(b.label);
    const title = [wi.top, el("span", { class: "wsub" }, wi.sub)];
    return el("article", { class: "card" },
      el("h3", {}, ...title),
      el("div", { class: "hero" }, fmt(b.rain), el("small", {}, ` ${MM}`)),
      el("div", { class: "hero-sub" }, T(`🌧️ ${b.n_rain} จาก ${b.n_models} โมเดลบอกว่าฝนตก (≥ ${L.threshold_mm} มม.)`, `🌧️ ${b.n_rain} of ${b.n_models} models say rain (≥ ${L.threshold_mm} mm)`)),
      trustBadge(b.label),
      el("dl", { class: "kv" },
        el("dt", {}, T("🌡️ อุณหภูมิ", "🌡️ Temperature")), el("dd", {}, `${fmt(b.tmin, 0)}–${fmt(b.tmax, 0)} °C`),
        el("dt", {}, T("🥵 รู้สึกเหมือน", "🥵 Feels like")), el("dd", {}, `${fmt(b.feels, 0)} °C`, statusPill(b.heat)),
        el("dt", {}, T("💧 ความชื้น", "💧 Humidity")), el("dd", {}, `${fmt(b.rh, 0)} %`),
        el("dt", {}, T("💨 ลมกระโชก", "💨 Wind gusts")), el("dd", {}, `${fmt(b.gust, 0)} ${KMH}`),
        el("dt", {}, "☀️ UV"), el("dd", {}, fmt(b.uv, 0), statusPill(b.uv_level)),
        el("dt", {}, "😷 PM2.5"), el("dd", {}, fmt(b.pm25, 0), statusPill(b.pm25_level))));
  }));
}

// ---------------------------------------------------------------------------
// tiles ฝนช่วงสั้น
// ---------------------------------------------------------------------------
function ensembleMean(j) {
  const vals = Object.values(state.loc.ensemble).map((r) => r[j]).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function renderNext() {
  const L = state.loc, C = L.consensus;
  const tiles = L.windows.map((w, j) => ({ w, j })).filter(({ w }) => w.startsWith("+"));
  $("next").replaceChildren(...tiles.map(({ w, j }) => {
    const p = ensembleMean(j);
    return el("div", { class: "tile" },
      el("div", { class: "t" }, T(`อีก ${winInfo(w).top}`, `Next ${winInfo(w).top}`), el("span", { class: "wsub" }, winInfo(w).sub)),
      el("div", { class: "v" }, fmt(C.median[j]), el("small", {}, ` ${MM}`)),
      el("div", { class: "d" }, T(`ช่วง ${fmt(C.min[j])}–${fmt(C.max[j])} มม.`, `range ${fmt(C.min[j])}–${fmt(C.max[j])} mm`)),
      el("div", { class: "d" }, `${T("โอกาสฝน (ensemble)", "Rain chance (ensemble)")} ${p == null ? "–" : Math.round(p) + "%"}`),
      el("div", { class: "bar", role: "img", "aria-label": `${T("โอกาสฝน", "Rain chance")} ${p == null ? NA : Math.round(p) + "%"}` },
        el("i", { style: `width:${p ?? 0}%` })), trustBadge(w));
  }));
}

// ---------------------------------------------------------------------------
// ตาราง heatmap
// ---------------------------------------------------------------------------
function heatTable(columns, rows, { steps, digits = 1, unit = "", meta = {}, accent, summary } = {}) {
  const cell = (v, rowName, col) => {
    const bg = steps ? stepColor(v, steps) : null;
    return el("td", {
      class: v == null ? "na" : null,
      style: bg ? `background:${bg};color:${inkOn(bg)}` : null,
      title: `${tx(rowName)} · ${winInfo(col).top}: ${v == null ? NA : fmt(v, digits) + " " + unit}`,
    }, v == null ? "–" : fmt(v, digits));
  };
  const body = Object.entries(rows).map(([name, vals]) =>
    el("tr", { class: name === accent ? "accent" : null },
      el("th", { scope: "row" }, tx(name), meta[name] ? el("span", { class: "km" }, `${meta[name]} ${KM}`) : null),
      ...vals.map((v, j) => cell(v, name, columns[j]))));
  if (summary) {
    body.push(el("tr", { class: "sum" }, el("th", { scope: "row" }, summary.name),
      ...summary.values.map((v, j) => cell(v, summary.name, columns[j]))));
  }
  return el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, ""), ...columns.map((c) => el("th", { scope: "col" }, ...winHead(c))))),
    el("tbody", {}, body));
}

function renderRainTable() {
  const L = state.loc, t = L.tables.rain;
  const meta = Object.fromEntries(L.models.map((m) => [m.name, m.grid_km]));
  $("rain-table").replaceChildren(heatTable(t.columns, t.rows, {
    steps: RAIN_STEPS, unit: MM, meta, accent: L.models[0]?.grid_km <= 4 ? L.models[0].name : null,
    summary: { name: T("ค่ากลางทุกโมเดล", "All-model median"), values: L.consensus.median },
  }));
  const agree = L.windows.map((w, j) => `${winInfo(w).top} ${L.consensus.agree_pct[j] ?? "–"}%`).join(" · ");
  $("rain-note").textContent = T(`% ของโมเดลที่บอกว่าฝนตก (≥ ${L.threshold_mm} มม.): ${agree} · ช่อง “–” = โมเดลนั้นพยากรณ์ไปไม่ถึงช่วงนั้น`,
    `% of models saying rain (≥ ${L.threshold_mm} mm): ${agree} · “–” = the model does not forecast that far`);
}

function renderEnsemble() {
  const L = state.loc;
  $("ens-sub").textContent = T(`ช่วงเวลาเดียวกับตารางฝน · % ของรอบที่ฝน ≥ ${L.threshold_mm} มม.`, `Same periods as the rain table · % of runs with rain ≥ ${L.threshold_mm} mm`);
  $("ens-table").replaceChildren(heatTable(L.windows, L.ensemble, { steps: PROB_STEPS, digits: 0, unit: "%" }));
}

function renderParam() {
  const L = state.loc;
  const keys = Object.keys(L.tables).filter((k) => k !== "rain");
  if (!keys.includes(state.param)) state.param = keys[0];
  $("param").replaceChildren(...keys.map((k) =>
    el("option", { value: k, selected: k === state.param }, `${tx(L.tables[k].label)}${L.tables[k].unit ? ` (${tx(L.tables[k].unit)})` : ""}`)));
  $("param").onchange = (e) => { state.param = e.target.value; renderParam(); };
  const t = L.tables[state.param];
  const meta = Object.fromEntries(L.models.map((m) => [m.name, m.grid_km]));
  $("param-table").replaceChildren(heatTable(t.columns, t.rows, {
    digits: 0, unit: tx(t.unit), meta, accent: state.highlight,
    steps: state.param === "rain_prob" ? PROB_STEPS : null,
  }));
}

// ---------------------------------------------------------------------------
// กราฟรายชั่วโมง (SVG): median + ช่วง min–max + โมเดลที่เน้น
// ---------------------------------------------------------------------------
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function seriesStats(series, times) {
  const names = Object.keys(series);
  const med = [], lo = [], hi = [];
  times.forEach((_, i) => {
    const v = names.map((n) => series[n][i]).filter((x) => x != null).sort((a, b) => a - b);
    if (!v.length) { med.push(null); lo.push(null); hi.push(null); return; }
    const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    med.push(m); lo.push(v[0]); hi.push(v[v.length - 1]);
  });
  return { med, lo, hi, n: names.length };
}

function drawChart(spec, width) {
  const L = state.loc, H = L.hourly;
  const times = H.time.map(localTime);
  const s1 = cssVar("--series-1"), s2 = cssVar("--series-2");
  let med, lo, hi, hl = null, count = 0;
  if (spec.single) {
    med = H.pm25 || [];
    if (!med.some((v) => v != null)) return null;
  } else {
    const series = H.series[spec.key];
    if (!series) return null;
    ({ med, lo, hi, n: count } = seriesStats(series, times));
    hl = series[state.highlight] || null;
  }

  const card = el("div", { class: spec.wide ? "chart wide" : "chart" });
  card.append(el("h3", {}, `${spec.title} (${spec.unit})`));
  if (!spec.single) {
    card.append(el("div", { class: "legend" },
      el("span", {}, el("i", { class: "key-line", style: `background:${s1}` }), T(`ค่ากลาง ${count} โมเดล`, `Median of ${count} models`)),
      el("span", {}, el("i", { class: "key-band" }), T("ช่วงต่ำสุด–สูงสุด", "Min–max range")),
      hl ? el("span", {}, el("i", { class: "key-line", style: `background:${s2}` }), state.highlight) : null));
  }

  const W = Math.max(280, Math.round(width) - 24), Hh = spec.height || 190;   // 24 = padding ของการ์ด
  const m = { l: 38, r: 10, t: 10, b: 26 };
  const pw = W - m.l - m.r, ph = Hh - m.t - m.b;
  const all = [...med, ...(lo || []), ...(hi || []), ...(hl || [])].filter((v) => v != null);
  (spec.lines || []).forEach((l) => all.push(l.y));
  let yMin = spec.zero ? 0 : Math.floor(Math.min(...all) - 1);
  let yMax = spec.max ?? Math.max(...all, spec.zero ? 1 : -Infinity);
  if (!spec.max) yMax = yMax + (yMax - yMin) * 0.06;
  const ticks = niceTicks(yMin, yMax);
  yMin = Math.min(yMin, ticks[0]);
  yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const t0 = times[0].getTime(), t1 = times[times.length - 1].getTime();
  const X = (i) => m.l + ((times[i].getTime() - t0) / (t1 - t0 || 1)) * pw;
  const Y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

  const svg = sv("svg", { viewBox: `0 0 ${W} ${Hh}`, role: "img", tabindex: "0",
    "aria-label": T(`${spec.title} รายชั่วโมง ${spec.unit} — ใช้ลูกศรซ้าย/ขวาเพื่ออ่านค่า`, `${spec.title}, hourly, ${spec.unit} — use left/right arrows to read values`) });
  // gridlines + y ticks
  ticks.forEach((v) => {
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: cssVar("--grid"), "stroke-width": 1 }));
    const tx = sv("text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" });
    tx.textContent = v.toLocaleString(LOCALE);
    svg.append(tx);
  });
  // x ticks ที่เที่ยงคืน
  times.forEach((t, i) => {
    if (t.getHours() !== 0) return;
    svg.append(sv("line", { x1: X(i), x2: X(i), y1: m.t, y2: m.t + ph, stroke: cssVar("--grid"), "stroke-width": 1 }));
    const tx = sv("text", { x: X(i) + 3, y: Hh - 8, class: "tick" });
    tx.textContent = `${DAYS[t.getDay()]} ${t.getDate()}`;
    svg.append(tx);
  });
  // เส้นเกณฑ์ (สถานะ)
  (spec.lines || []).forEach((l) => {
    if (l.y > yMax) return;
    svg.append(sv("line", { x1: m.l, x2: W - m.r, y1: Y(l.y), y2: Y(l.y), stroke: cssVar(`--${l.status}`), "stroke-width": 1 }));
    const tx = sv("text", { x: W - m.r - 2, y: Y(l.y) - 4, "text-anchor": "end", class: "tick" });
    tx.textContent = l.label;
    svg.append(tx);
  });

  const path = (arr) => {
    let d = "", pen = false;
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  // ช่วง min–max
  if (lo) {
    let d = "", seg = [];
    const flush = () => {
      if (seg.length > 1) {
        d += "M" + seg.map((i) => `${X(i).toFixed(1)},${Y(hi[i]).toFixed(1)}`).join("L");
        d += "L" + seg.slice().reverse().map((i) => `${X(i).toFixed(1)},${Y(lo[i]).toFixed(1)}`).join("L") + "Z";
      }
      seg = [];
    };
    lo.forEach((v, i) => (v == null ? flush() : seg.push(i)));
    flush();
    svg.append(sv("path", { d, fill: cssVar("--band"), stroke: "none" }));
  }
  // median: แท่งสำหรับฝน เส้นสำหรับอย่างอื่น
  if (spec.bars) {
    const bw = Math.max(1, Math.min(24, pw / times.length - 1));
    med.forEach((v, i) => {
      if (v == null || v <= 0) return;
      const h = Math.max(1, Y(0) - Y(v)), x = X(i) - bw / 2, y = Y(v), r = Math.min(bw / 2, 4, h);
      svg.append(sv("path", { d: `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z`, fill: s1 }));
    });
  } else {
    svg.append(sv("path", { d: path(med), fill: "none", stroke: s1, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }
  if (hl) svg.append(sv("path", { d: path(hl), fill: "none", stroke: s2, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

  // crosshair + tooltip (ชี้ที่ไหนก็ได้ สแนปไปชั่วโมงที่ใกล้ที่สุด)
  const cross = sv("line", { y1: m.t, y2: m.t + ph, stroke: cssVar("--axis"), "stroke-width": 1, visibility: "hidden" });
  const dot1 = sv("circle", { r: 4, fill: s1, stroke: cssVar("--surface"), "stroke-width": 2, visibility: "hidden" });
  const dot2 = sv("circle", { r: 4, fill: s2, stroke: cssVar("--surface"), "stroke-width": 2, visibility: "hidden" });
  svg.append(cross, dot1, dot2);
  let cur = -1;
  const show = (i, cx, cy) => {
    cur = i;
    const x = X(i);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    const place = (dot, v) => {
      if (v == null || spec.bars && dot === dot1) { dot.setAttribute("visibility", "hidden"); return; }
      dot.setAttribute("cx", x); dot.setAttribute("cy", Y(v)); dot.setAttribute("visibility", "visible");
    };
    place(dot1, med[i]); place(dot2, hl ? hl[i] : null);
    const t = times[i];
    const head = `${DAYS[t.getDay()]} ${t.toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    const rows = [{ label: spec.single ? spec.title : T("ค่ากลาง", "Median"), value: `${fmt(med[i])} ${spec.unit}`, color: s1 }];
    if (lo) rows.push({ label: T("ต่ำสุด–สูงสุด", "Min–max"), value: `${fmt(lo[i])}–${fmt(hi[i])}` });
    if (hl) rows.push({ label: state.highlight, value: `${fmt(hl[i])} ${spec.unit}`, color: s2 });
    const box = svg.getBoundingClientRect();
    tip.show(cx ?? box.left + (x / W) * box.width, cy ?? box.top + 20, head, rows);
  };
  const hide = () => {
    cur = -1; tip.hide();
    [cross, dot1, dot2].forEach((n) => n.setAttribute("visibility", "hidden"));
  };
  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * W;
    const t = t0 + ((x - m.l) / pw) * (t1 - t0);
    let best = 0, bd = Infinity;
    times.forEach((tt, i) => { const d = Math.abs(tt.getTime() - t); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  svg.addEventListener("pointermove", (e) => show(nearest(e.clientX), e.clientX, e.clientY));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(times.length - 1, (cur < 0 ? 0 : cur) + (e.key === "ArrowRight" ? 1 : -1)));
    show(next);
  });
  card.append(svg);
  return card;
}

function renderCharts() {
  if (!state.loc || !$("step-4").open) return;                   // กล่องพับอยู่ = ไม่รู้ความกว้าง วาดตอนเปิด
  const box = $("charts");
  box.replaceChildren();
  CHARTS.forEach((spec) => {
    // วางการ์ดก่อนเพื่อให้รู้ความกว้างจริง แล้วค่อยวาด
    const tmp = el("div", { class: spec.wide ? "chart wide" : "chart" });
    box.append(tmp);
    const card = drawChart(spec, tmp.clientWidth);
    if (card) tmp.replaceWith(card); else tmp.remove();
  });
}

// ---------------------------------------------------------------------------
// แผนที่
// ---------------------------------------------------------------------------
let tiles = null;
function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function updateMapTiles() {
  if (!state.map) return;
  if (tiles) tiles.remove();
  tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(state.map);
  $("map").classList.toggle("dark-tiles", isDark());
}
function initMap() {
  if (typeof L === "undefined") { $("map").textContent = T("โหลดแผนที่ไม่ได้", "Could not load the map"); return; }
  const locs = state.index.locations;
  state.map = L.map("map", { scrollWheelZoom: false });
  updateMapTiles();
  state.markers = locs.map((l, i) => {
    const mk = L.circleMarker([l.lat, l.lon], {
      radius: 8, color: cssVar("--ink"), weight: 1.5, fillColor: cssVar("--surface"), fillOpacity: 1,
    }).addTo(state.map);
    mk.bindTooltip(tx(l.name), { direction: "top", className: "map-label" });
    mk.on("click", () => selectLocation(i));
    return mk;
  });
  state.map.setView([locs[0].lat, locs[0].lon], 8);
  requestAnimationFrame(() => state.map.invalidateSize());   // ขนาดกล่องแผนที่อาจยังไม่ถูกคำนวณตอนสร้าง
  loadRadar();
  loadStations();
}

// ---------------------------------------------------------------------------
// สถานีวัดบนแผนที่: โทรมาตร ThaiWater ทุกเครื่อง (แยกตามหน่วยงาน) + สถานีอุตุฯ + Air4Thai · กรองชั้นได้
// ---------------------------------------------------------------------------
const MAP_RAIN = [0.1, 1, 5, 10, 20, 35, 50, 90];                 // มม./24 ชม.
const PM_COLOR = [[15, "#2a78d6"], [25, "#1baf7a"], [37.5, "#eda100"], [75, "#eb6834"], [Infinity, "#e34948"]];
const AGENCY_FULL = EN ? { "สสน.": "Hydro-Informatics Institute", "ทน.": "Department of Water Resources", "ปภ.": "Department of Disaster Prevention and Mitigation",
  "ชป.": "Royal Irrigation Department", "อต.": "Thai Meteorological Department (gauges)", "กฟผ.": "Electricity Generating Authority of Thailand", "สนน. กทม.": "BMA Drainage and Sewerage Department" }
  : { "สสน.": "สถาบันสารสนเทศทรัพยากรน้ำ", "ทน.": "กรมทรัพยากรน้ำ", "ปภ.": "กรมป้องกันและบรรเทาสาธารณภัย",
  "ชป.": "กรมชลประทาน", "อต.": "กรมอุตุนิยมวิทยา (โทรมาตร)", "กฟผ.": "การไฟฟ้าฝ่ายผลิตแห่งประเทศไทย", "สนน. กทม.": "สำนักการระบายน้ำ กทม." };
const mapLayers = { groups: {}, meta: [] };
const rainFill = (v) => (v == null ? "#9a9a9a" : v < MAP_RAIN[0] ? cssVar("--surface") : stepColor(v, MAP_RAIN) || cssVar("--surface"));
async function loadStations() {
  const [st, now] = await Promise.all([getJSON("data/stations.json").catch(() => null),
    state.nowObs ? state.nowObs : getJSON("data/now_obs.json").catch(() => ({ tmd: [], air: [] }))]);
  state.nowObs = now;
  if (!st && !now.tmd.length) return;
  state.map.createPane("stations").style.zIndex = 390;             // ใต้วงกลมตำแหน่ง เหนือเรดาร์
  const renderer = L.canvas({ pane: "stations", padding: 0.3 });
  const check = new Set(st?.check_ids || []);
  const add = (key, label, icon, markers, on) => {
    mapLayers.groups[key] = L.layerGroup(markers);
    mapLayers.meta.push({ key, label, icon, n: markers.length, on });
  };
  // สถานีอุตุฯ (กรมอุตุฯ)
  add("tmd", T("สถานีอุตุฯ", "Weather stations"), "📡", now.tmd.map((x) => L.circleMarker([x.lat, x.lon], {
    renderer, radius: 6.5, weight: 2.2, color: cssVar("--ink"), fillColor: rainFill(x.rain_24h), fillOpacity: 1,
  }).bindPopup(() => el("div", { class: "pop" }, el("b", {}, T(`📡 สถานี${x.name}`, `📡 ${tx(x.name)} station`)),
    el("div", { class: "muted" }, `${tx(x.province) || ""} · ${T("กรมอุตุนิยมวิทยา", "Thai Meteorological Department")}`),
    el("div", {}, T(`ฝน 24 ชม. ${fmt(x.rain_24h)} มม. · 3 ชม. ${fmt(x.rain_3h)} มม.`, `Rain 24 h ${fmt(x.rain_24h)} mm · 3 h ${fmt(x.rain_3h)} mm`)),
    el("div", {}, T(`อุณหภูมิ ${fmt(x.temp)} °C · ความชื้น ${fmt(x.rh, 0)}%`, `Temperature ${fmt(x.temp)} °C · humidity ${fmt(x.rh, 0)}%`)),
    el("div", { class: "muted" }, `${String(x.time || "").slice(0, 16).replace("T", " ")}${T(" น.", "")}${check.has(String(x.id)) ? T(" · ⭕ จุดตรวจ", " · ⭕ check point") : ""}`)))), true);
  // โทรมาตร ThaiWater แยกตามหน่วยงาน (หน่วยงานเล็กรวมเป็น "อื่น ๆ")
  if (st) {
    const C = Object.fromEntries(st.tw_cols.map((c, i) => [c, i]));
    const byAg = {};
    st.tw.forEach((r) => { (byAg[r[C.agency] || "อื่น ๆ"] ||= []).push(r); });
    const small = Object.keys(byAg).filter((a) => byAg[a].length < 30);
    small.forEach((a) => { if (a !== "อื่น ๆ") { (byAg["อื่น ๆ"] ||= []).push(...byAg[a]); delete byAg[a]; } });
    Object.entries(byAg).sort((a, b) => b[1].length - a[1].length).forEach(([ag, rows]) => {
      add(`tw:${ag}`, `${T("เครื่องวัดฝน", "Gauges")} ${tx(ag)}`, "💧", rows.map((r) => L.circleMarker([r[C.lat], r[C.lon]], {
        renderer, radius: 3.6, weight: 0.8, color: "rgba(80,80,80,.55)", fillColor: rainFill(r[C.rain_24h]), fillOpacity: 0.95,
      }).bindPopup(() => el("div", { class: "pop" }, el("b", {}, `💧 ${r[C.name]}`), el("div", { class: "muted" }, r[C.area]),
        el("div", {}, T(`ฝน 24 ชม. ${fmt(r[C.rain_24h])} มม.`, `Rain 24 h ${fmt(r[C.rain_24h])} mm`)),
        el("div", { class: "muted" }, `${AGENCY_FULL[r[C.agency]] || tx(r[C.agency]) || "–"} · ${r[C.time]}${T(" น.", "")}`),
        r[C.density] != null ? el("div", { class: "muted" }, T(`มีคนอยู่ ${num(r[C.density])} คน/ตร.กม.`, `${num(r[C.density])} people/km²`) +
          ` (${r[C.density] >= 1500 ? T("เขตเมือง", "urban") : r[C.density] >= 300 ? T("ชานเมือง", "suburban") : T("ชนบท", "rural")})`) : null,
        r[C.check] ? el("div", {}, T("⭕ จุดที่ใช้ตรวจโมเดล", "⭕ used to check models")) : null))), true);
    });
    // จุดตรวจ (วงแหวน)
    const rings = st.tw.filter((r) => r[C.check]).map((r) => L.circleMarker([r[C.lat], r[C.lon]], {
      renderer, radius: 8, weight: 2, color: "#eb6834", fill: false, interactive: false }));
    now.tmd.filter((x) => check.has(String(x.id))).forEach((x) => rings.push(L.circleMarker([x.lat, x.lon], {
      renderer, radius: 10, weight: 2, color: "#eb6834", fill: false, interactive: false })));
    add("check", T("จุดตรวจโมเดล", "Model check points"), "⭕", rings, true);
  }
  // เซนเซอร์ของผู้ใช้ (PFAL SIS KU) · ไม่ใช่สถานีมาตรฐาน
  add("sensor", T("เซนเซอร์ PFAL", "PFAL sensor"), "🌡️", (now.sensor || []).map((x) => L.circleMarker([x.lat, x.lon], {
    renderer, radius: 7, weight: 2.5, color: "#c51b7d", fillColor: cssVar("--surface"), fillOpacity: 1,
  }).bindPopup(() => el("div", { class: "pop" }, el("b", {}, T(`🌡️ ${x.name}`, "🌡️ Outdoor sensor, PFAL SIS KU (Kasetsart University, Bang Khen)")),
    el("div", {}, T(`อุณหภูมิ ${fmt(x.temp)} °C · ความชื้น ${fmt(x.rh, 0)}%`, `Temperature ${fmt(x.temp)} °C · humidity ${fmt(x.rh, 0)}%`)),
    el("div", { class: "muted" }, `${String(x.time).replace("T", " ")}${T(" น.", "")}`),
    el("div", { class: "muted" }, T("เซนเซอร์ต้นทุนต่ำ ไม่ใช่สถานีมาตรฐาน · ช่วงเช้าอ่านสูงกว่าสถานีอ้างอิง ~1–2 °C",
      "Low-cost sensor, not a standard station · reads ~1–2 °C above the reference station in the morning"))))), true);
  // PM2.5 (Air4Thai)
  add("air", "PM2.5", "😷", now.air.map((x) => L.circleMarker([x.lat, x.lon], {
    renderer, radius: 5, weight: 1, color: "#fff", fillColor: PM_COLOR.find(([lim]) => x.pm25 < lim)[1], fillOpacity: 0.95,
  }).bindPopup(() => el("div", { class: "pop" }, el("b", {}, `😷 ${x.name}`), el("div", { class: "muted" }, x.area),
    el("div", {}, `PM2.5 ${fmt(x.pm25)} ${T("มคก./ลบ.ม.", "µg/m³")} · ${x.level.split(" ")[0]} ${tx(x.level.split(" ").slice(1).join(" "))}`),
    el("div", { class: "muted" }, `Air4Thai (${T("กรมควบคุมมลพิษ", "Pollution Control Department")}) · ${String(x.time).replace("T", " ").slice(0, 16)}${T(" น.", "")}`)))), false);
  let saved = null;
  try { saved = JSON.parse(store.get("map-layers") || "null"); } catch { saved = null; }
  mapLayers.on = new Set(saved || mapLayers.meta.filter((m) => m.on).map((m) => m.key));
  renderMapLayers();
}
function renderMapLayers() {
  for (const m of mapLayers.meta) {
    const g = mapLayers.groups[m.key], want = mapLayers.on.has(m.key);
    if (want && !state.map.hasLayer(g)) g.addTo(state.map);
    if (!want && state.map.hasLayer(g)) g.remove();
  }
  const toggle = (k) => { mapLayers.on.has(k) ? mapLayers.on.delete(k) : mapLayers.on.add(k);
    store.set("map-layers", JSON.stringify([...mapLayers.on])); renderMapLayers(); };
  const tw = mapLayers.meta.filter((m) => m.key.startsWith("tw:"));
  const allTw = tw.every((m) => mapLayers.on.has(m.key));
  $("map-layers").replaceChildren(
    ...mapLayers.meta.filter((m) => !m.key.startsWith("tw:")).slice(0, 1).map(chip),
    tw.length ? el("button", { class: "chip", type: "button", "aria-pressed": String(allTw), onclick: () => {
      tw.forEach((m) => (allTw ? mapLayers.on.delete(m.key) : mapLayers.on.add(m.key)));
      store.set("map-layers", JSON.stringify([...mapLayers.on])); renderMapLayers(); } },
      T("💧 เครื่องวัดฝนทั้งหมด", "💧 All rain gauges"), el("span", { class: "chip-n" }, ` ${num(tw.reduce((a, m) => a + m.n, 0))}`)) : null,
    ...tw.map(chip), ...mapLayers.meta.filter((m) => !m.key.startsWith("tw:")).slice(1).map(chip));
  function chip(m) {
    return el("button", { class: "chip small-chip", type: "button", "aria-pressed": String(mapLayers.on.has(m.key)),
      title: (m.key.startsWith("tw:") && AGENCY_FULL[m.key.slice(3)]) || m.label, onclick: () => toggle(m.key) },
      `${m.icon} ${m.label}`, el("span", { class: "chip-n" }, ` ${num(m.n)}`));
  }
  const sw = (bg, t, ring) => el("span", { class: "lg" }, el("i", { style: `background:${bg}${ring ? ";box-shadow:0 0 0 2px " + ring : ""}` }), t);
  $("map-legend").replaceChildren(el("span", { class: "muted" }, T("ฝน 24 ชม. (มม.):", "Rain 24 h (mm):")), sw(cssVar("--surface"), "0", "#bbb"),
    ...MAP_RAIN.slice(0, -1).map((v, i) => sw(stepColor(v, MAP_RAIN), `${v}–${MAP_RAIN[i + 1]}`)), sw(stepColor(999, MAP_RAIN), `≥ ${MAP_RAIN.at(-1)}`),
    sw("#9a9a9a", NA));
}

// เรดาร์ฝนจาก RainViewer: ภาพทุก 10 นาที ย้อนหลัง ~2 ชม. (ความละเอียดสูงสุดที่ zoom 7)
const radar = { frames: [], layers: {}, idx: -1, timer: null, host: "" };
const RADAR_PLAY = T("▶︎ ย้อนหลัง 2 ชม.", "▶︎ Last 2 h");
document.getElementById("radar-play").textContent = RADAR_PLAY;
async function loadRadar() {
  try {
    const j = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    radar.host = j.host;
    radar.frames = [...(j.radar.past || []), ...(j.radar.nowcast || [])];
    showRadarFrame(radar.frames.length - 1);
    $("radar-play").onclick = toggleRadar;
    setInterval(async () => {                 // หน้าเปิดค้างไว้ ก็ได้ภาพล่าสุดเอง
      if (radar.timer) return;
      const k = await getJSON("https://api.rainviewer.com/public/weather-maps.json").catch(() => null);
      if (k) { radar.frames = [...(k.radar.past || []), ...(k.radar.nowcast || [])]; showRadarFrame(radar.frames.length - 1); }
    }, 10 * 60000);
  } catch {
    $("radar-time").textContent = T("· โหลดเรดาร์ไม่ได้", "· radar unavailable");
  }
}
function radarLayer(f) {
  if (!radar.layers[f.path]) {
    radar.layers[f.path] = L.tileLayer(`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0, maxNativeZoom: 7, maxZoom: 18, zIndex: 10,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    }).addTo(state.map);
  }
  return radar.layers[f.path];
}
function showRadarFrame(i) {
  if (!radar.frames.length) return;
  const f = radar.frames[i];
  if (radar.idx >= 0 && radar.frames[radar.idx]) radarLayer(radar.frames[radar.idx]).setOpacity(0);
  radarLayer(f).setOpacity(0.75);
  radarLayer(radar.frames[(i + 1) % radar.frames.length]);   // โหลดเฟรมถัดไปรอไว้
  radar.idx = i;
  const t = new Date(f.time * 1000);
  const latest = i === radar.frames.length - 1;
  $("radar-time").textContent = `· ${t.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}${T(" น.", "")}${latest ? T(" (ล่าสุด)", " (latest)") : ""}`;
}
function toggleRadar() {
  if (radar.timer) {
    clearInterval(radar.timer); radar.timer = null;
    showRadarFrame(radar.frames.length - 1);
    $("radar-play").textContent = RADAR_PLAY;
    return;
  }
  $("radar-play").textContent = T("⏸ หยุด", "⏸ Stop");
  let i = 0;
  showRadarFrame(i);
  radar.timer = setInterval(() => { i = (i + 1) % radar.frames.length; showRadarFrame(i); }, 700);
}

// pill สถานะ: จุดสีมากับไอคอนและข้อความเสมอ (ไม่ใช้สีอย่างเดียว)
const style = document.createElement("style");
style.textContent = Object.entries({ good: "--good", warning: "--warning", serious: "--serious", critical: "--critical" })
  .map(([k, v]) => `.pill[data-status="${k}"]{box-shadow:inset 3px 0 0 var(${v}),0 0 0 1px var(--ring)}`).join("");
document.head.append(style);

init();


// ---------------------------------------------------------------------------
// 🌡️ พยากรณ์ภัยความร้อนรายเขต กรุงเทพมหานคร (HEAT-SAFE) · ลิงก์ตรงด้วย #heat
// ข้อมูล: data/heatsafe.json (weather_heatsafe.py) · ขอบเขตเขต: bkk_districts.geojson
// ---------------------------------------------------------------------------
const HS_COLORS = ["#d9d9d9", "#43A047", "#FDD835", "#FB8C00", "#D32F2F"];      // ต่ำกว่าเกณฑ์ · เขียว · เหลือง · ส้ม · แดง (เกณฑ์ กทม.)
const HS_NAMES = EN ? ["Below caution level", "Green · caution", "Yellow · warning", "Orange · danger", "Red · extreme danger"]
  : ["ต่ำกว่าระดับเฝ้าระวัง", "เขียว · เฝ้าระวัง", "เหลือง · เตือนภัย", "ส้ม · อันตราย", "แดง · อันตรายมาก"];
const HS_METRICS = {
  lvl: { label: T("ระดับเตือน (ดัชนีความร้อนที่ปรับแก้แล้ว)", "Warning level (corrected heat index)"), value: (d) => d.lvl },
  p_orange: { label: T("โอกาสถึงระดับส้มขึ้นไป", "Chance of orange or above"), value: (d) => d.p_orange },
  rain: { label: T("โอกาสฝน", "Rain chance"), value: (d) => d.p_rain },
};
const dayChip = (d) => `${d.lead_day === 0 ? TODAY : T(`+${d.lead_day} วัน`, `+${d.lead_day} d`)} · ${new Date(d.date).toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" })}`;
const dayCol = (d) => [d.lead_day === 0 ? TODAY : `+${d.lead_day}`, el("span", { class: "wsub" }, new Date(d.date).toLocaleDateString(LOCALE, { day: "numeric", month: "short" }))];
const hs = { data: null, geo: null, day: 0, metric: "lvl", sel: null, map: null, layer: null };
const hsLevel = (v) => (v == null ? null : v >= 52 ? 4 : v >= 42 ? 3 : v >= 33 ? 2 : v >= 27 ? 1 : 0);
const hsPctColor = (p, base) => (p == null ? "#d9d9d9" : p >= 70 ? base[3] : p >= 40 ? base[2] : p >= 10 ? base[1] : base[0]);
const HS_P_ORANGE = ["#fff3e0", "#ffcc80", "#fb8c00", "#bf360c"];
const HS_P_RAIN = ["#e3f2fd", "#90caf9", "#1e88e5", "#0d47a1"];

async function showHeat(on) {
  document.body.classList.remove("about-mode", "nat-mode");
  document.body.classList.toggle("heat-mode", on);
  if (on) { history.replaceState(null, "", "#heat"); store.set("tab", "heat"); }
  markChips();
  if (!on) return;
  window.scrollTo({ top: 0 });
  try {
    if (!hs.data) [hs.data, hs.geo] = await Promise.all([getJSON("data/heatsafe.json"), getJSON("bkk_districts.geojson")]);
  } catch (e) {
    $("hs-updated").textContent = T("ยังไม่มีพยากรณ์ — จะมีในรอบถัดไป", "No forecast yet — it will appear after the next run");
    return;
  }
  const D = hs.data;
  const days = D.districts[0].days;
  if (hs.day >= days.length) hs.day = 0;
  const gen = new Date(D.generated).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
  $("hs-updated").textContent = T(`คำนวณเมื่อ ${gen} · ${D.districts.length} เขต · ${D.models.length} โมเดล (${D.models.join(", ")}) · อัปเดตประมาณทุก 3 ชั่วโมง`,
    `Calculated ${gen} · ${D.districts.length} districts · ${D.models.length} models (${D.models.join(", ")}) · updated about every 3 hours`);
  $("hs-days").replaceChildren(...days.map((d, i) => el("button", { class: "chip", role: "tab", type: "button",
    "aria-selected": String(i === hs.day), onclick: () => { hs.day = i; renderHeat(); } }, dayChip(d))));
  $("hs-metric").replaceChildren(...Object.entries(HS_METRICS).map(([k, m]) => el("button", { class: "chip", role: "tab", type: "button",
    "aria-selected": String(k === hs.metric), onclick: () => { hs.metric = k; renderHeat(); } }, m.label)));
  renderHeatMethod();
  if (!hs.map && typeof L !== "undefined") {
    hs.map = L.map("hs-map", { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 16, opacity: 0.55 }).addTo(hs.map);
    $("hs-map").classList.toggle("dark-tiles", isDark());
  }
  renderHeat();
  requestAnimationFrame(() => hs.map && hs.map.invalidateSize());
}

function hsColor(d) {
  if (!d) return "#d9d9d9";
  if (hs.metric === "lvl") return d.lvl == null ? "#d9d9d9" : HS_COLORS[d.lvl];
  if (hs.metric === "p_orange") return hsPctColor(d.p_orange, HS_P_ORANGE);
  return hsPctColor(d.p_rain, HS_P_RAIN);
}

function renderHeat() {
  const D = hs.data;
  [...$("hs-days").children].forEach((c, i) => c.setAttribute("aria-selected", String(i === hs.day)));
  [...$("hs-metric").children].forEach((c) => c.setAttribute("aria-selected", String(c.textContent === HS_METRICS[hs.metric].label)));
  const byCode = Object.fromEntries(D.districts.map((x) => [x.dcode, x]));
  if (hs.map) {
    if (hs.layer) hs.layer.remove();
    hs.layer = L.geoJSON(hs.geo, {
      style: (f) => ({ color: "#ffffff", weight: 1, fillOpacity: 0.82, fillColor: hsColor(byCode[f.properties.dcode]?.days[hs.day]) }),
      onEachFeature: (f, ly) => {
        const x = byCode[f.properties.dcode], d = x?.days[hs.day];
        ly.bindTooltip(`<b>${EN ? x?.dname_en || f.properties.dname : f.properties.dname}</b><br>${T("ดัชนีความร้อนสูงสุด", "Max heat index")} ${fmt(d?.hi)} °C (${fmt(d?.hi_lo)}–${fmt(d?.hi_hi)})<br>` +
          `${T("≥ ส้ม", "≥ orange")} ${d?.p_orange ?? "–"}% · ${T("ฝน", "rain")} ${d?.p_rain ?? "–"}%`, { sticky: true, className: "map-label" });
        ly.on("click", () => { hs.sel = f.properties.dcode; renderHeatDetail(); });
      },
    }).addTo(hs.map);
    if (!hs.fitted) { hs.map.fitBounds(hs.layer.getBounds(), { padding: [6, 6] }); hs.fitted = true; }
  }
  const legend = hs.metric === "lvl"
    ? HS_NAMES.map((n, i) => [HS_COLORS[i], n])
    : (hs.metric === "p_orange" ? HS_P_ORANGE : HS_P_RAIN).map((c, i) => [c, ["< 10%", "10–39%", "40–69%", "≥ 70%"][i]]);
  $("hs-legend").replaceChildren(...legend.map(([c, n]) => el("span", { class: "lg" },
    el("i", { style: `display:inline-block;width:14px;height:14px;border-radius:3px;background:${c}` }), n)));
  // ตาราง: ทุกเขต × ทุกวัน (เรียงตาม HI ของวันที่เลือก)
  const days = D.districts[0].days;
  const rows = [...D.districts].sort((a, b) => (b.days[hs.day]?.hi ?? -99) - (a.days[hs.day]?.hi ?? -99));
  $("hs-table").replaceChildren(el("table", { class: "hs-table" },
    el("thead", {}, el("tr", {}, el("th", {}, T("เขต", "District")), ...days.map((d, i) => el("th", { class: i === hs.day ? "sel" : null }, ...dayCol(d))))),
    el("tbody", {}, rows.map((x) => el("tr", {},
      el("td", {}, el("a", { onclick: () => { hs.sel = x.dcode; renderHeatDetail(); $("hs-detail").scrollIntoView({ block: "nearest" }); } }, EN ? x.dname_en || x.dname : x.dname)),
      ...x.days.map((d) => {
        const c = d.lvl == null ? "#d9d9d9" : HS_COLORS[d.lvl];
        return el("td", { class: "lv", style: `background:${c};color:${inkOn(c)}` }, fmt(d.hi), el("small", {}, `${T("ส้ม", "orange")} ${d.p_orange ?? "–"}%`));
      }))))));
  if (!hs.sel) hs.sel = rows[0].dcode;
  renderHeatDetail();
}

function renderHeatDetail() {
  const x = hs.data.districts.find((d) => d.dcode === hs.sel);
  if (!x) return;
  const lvlTag = (v) => { const l = hsLevel(v); const c = l == null ? "#d9d9d9" : HS_COLORS[l];
    return el("span", { class: "hs-lvl", style: `background:${c};color:${inkOn(c)}` }, fmt(v)); };
  $("hs-detail").replaceChildren(
    el("h4", {}, EN ? x.dname_en : `เขต${x.dname}`, el("span", { class: "muted", style: "font-weight:400;font-size:12px" }, `  ${EN ? x.dname : x.dname_en}`)),
    el("table", {},
      el("thead", {}, el("tr", {}, ...(EN ? ["Day", "Max HI °C", "Model range", "P(≥orange)", "Tmax/Tmin", "Rain mm (P)"]
        : ["วัน", "ดัชนีความร้อนสูงสุด °C", "ช่วงของโมเดล", "P(≥ส้ม)", "Tmax/Tmin", "ฝน มม. (P)"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, x.days.map((d) => el("tr", {},
        el("td", {}, d.lead_day === 0 ? TODAY : `+${d.lead_day}`),
        el("td", {}, lvlTag(d.hi)),
        el("td", {}, `${fmt(d.hi_lo)}–${fmt(d.hi_hi)}`),
        el("td", {}, d.p_orange == null ? "–" : `${d.p_orange}%`),
        el("td", {}, `${fmt(d.tmax)}/${fmt(d.tmin)}`),
        el("td", {}, `${fmt(d.rain)} (${d.p_rain ?? "–"}%)`))))),
    el("p", { class: "note" }, T("ดัชนีความร้อนสูงสุด = ค่ากลางของโมเดลหลังปรับแก้ · ช่วง = ต่ำสุด–สูงสุดระหว่างโมเดล · " +
      `P(≥ส้ม) = % ของโมเดลที่ดัชนีความร้อนสูงสุดถึง 42 °C · P ฝน = % ของโมเดลที่ฝนรายวัน ≥ ${hs.data.rain_threshold_mm} มม.`,
      "Max HI = median of the models after correction · range = lowest–highest across models · " +
      `P(≥orange) = % of models with max HI of 42 °C or more · rain P = % of models with daily rain ≥ ${hs.data.rain_threshold_mm} mm`)));
}

function renderHeatMethod() {
  const C = hs.data.calibration || {};
  const leads = ["24 ชม.", "72 ชม.", "168 ชม."];       // คีย์ในไฟล์ค่าปรับแก้
  const cell = (o, k, d = 2) => (o && o[k] != null ? Number(o[k]).toFixed(d) : "–");
  const skill = el("table", {},
    el("thead", {}, el("tr", {}, ...(EN ? ["Lead time", "Temperature MAE / RMSE (°C)", "HI on very hot days MAE / RMSE (°C)", "HI bias (°C)",
      "Orange level POD / FAR", "Brier skill score"] : ["ล่วงหน้า", "อุณหภูมิ MAE / RMSE (°C)", "ดัชนีความร้อนวันร้อนจัด MAE / RMSE (°C)", "ดัชนีความร้อนสูง/ต่ำไป (°C)",
      "ระดับส้ม POD / FAR", "Brier skill score"]).map((h) => el("th", {}, h)))),
    el("tbody", {}, leads.map((l) => el("tr", {}, el("td", {}, tx(l)),
      el("td", {}, `${cell(C.skill_multimodel?.[l], "temp_MAE")} / ${cell(C.skill_multimodel?.[l], "temp_RMSE")}`),
      el("td", {}, `${cell(C.skill_hi_hotdays?.[l], "MAE")} / ${cell(C.skill_hi_hotdays?.[l], "RMSE")}`),
      el("td", {}, cell(C.skill_hi_hotdays?.[l], "bias")),
      el("td", {}, `${cell(C.alert_orange?.[l], "POD")} / ${cell(C.alert_orange?.[l], "FAR")}`),
      el("td", {}, C.brier_skill?.[l] != null ? Number(C.brier_skill[l]).toFixed(2) : "–")))));
  const nSt = (C.stations || []).length, excl = (hs.data.models_excluded || []).join(", ") || "–";
  const calDate = C.generated ? new Date(C.generated).toLocaleDateString(LOCALE) : "–";
  $("hs-method").replaceChildren(
    el("p", {}, T("ดัชนีความร้อน (Heat Index; HI) คำนวณทุกชั่วโมงจากอุณหภูมิและความชื้นที่ความสูง 2 เมตร ด้วยสมการของ " +
      "National Weather Service (Rothfusz, 1990) ที่จุดกลางของแต่ละเขต แล้วหาค่าสูงสุดของแต่ละวันในแต่ละโมเดล " +
      "จากนั้นปรับแก้ส่วนที่โมเดลทายสูงหรือต่ำเกินเป็นประจำ (bias correction) แยกตามโมเดลและเวลาล่วงหน้า โดยใช้ผลการตรวจย้อนหลังกับสถานีในกรุงเทพฯ " +
      `(${C.period || "–"}; ${nSt} สถานี) แล้วจัดระดับตามเกณฑ์เตือนภัยความร้อนของกรุงเทพมหานคร ` +
      "ซึ่งตรงกับเกณฑ์ของกรมอนามัย (เขียว 27.0–32.9, เหลือง 33.0–41.9, ส้ม 42.0–51.9, แดง ≥ 52.0 °C)",
      "The heat index (HI) is calculated every hour from temperature and humidity at 2 m, using the " +
      "National Weather Service equation (Rothfusz, 1990), at a central point of each district; the daily maximum is taken for each model. " +
      "It is then corrected for each model's usual over- or under-forecast (bias correction), by model and lead time, using a back-check against Bangkok stations " +
      `(${C.period || "–"}; ${nSt} stations), and classified with Bangkok's heat warning levels, ` +
      "which match the Department of Health's (green 27.0–32.9, yellow 33.0–41.9, orange 42.0–51.9, red ≥ 52.0 °C)")),
    el("p", {}, T("โอกาสที่จะเกินเกณฑ์ = % ของโมเดลที่ทายว่าถึงเกณฑ์ (multi-model ensemble) " +
      "ผลการตรวจย้อนหลังในหน้าร้อนของค่าเฉลี่ยหลายโมเดลอยู่ในตารางด้านล่าง (MAE = คลาดเฉลี่ย; RMSE = ให้น้ำหนักกับครั้งที่คลาดมาก; " +
      "POD = จับเหตุการณ์ได้กี่ %; FAR = เตือนแต่ไม่เกิดกี่ %)",
      "The chance of passing a level = % of models forecasting that level (multi-model ensemble). " +
      "The hot-season back-check of the multi-model mean is in the table below (MAE = average error; RMSE = weights large errors more; " +
      "POD = % of events caught; FAR = % of warnings with no event)")),
    skill,
    el("ul", {},
      el("li", {}, T("โมเดลระดับโลกมีช่องตารางขนาด 9–55 กม. จึงแยกความต่างระหว่างเขตที่อยู่ติดกันได้น้อย ความต่างระดับชุมชนควรดูร่วมกับค่าที่วัดได้ในพื้นที่และข้อมูลดาวเทียม",
        "Global models have 9–55 km grid boxes, so they separate neighbouring districts only a little; for community-level differences, also look at local measurements and satellite data")),
      el("li", {}, T("แม้ปรับแก้แล้ว พยากรณ์ยังมักให้โอกาสวันร้อนจัดต่ำกว่าจริง และโอกาสที่ล่วงหน้า 7 วันยังเชื่อถือได้น้อย",
        "Even after correction, forecasts still tend to underestimate the chance of very hot days, and chances 7 days ahead are not very reliable")),
      el("li", {}, T(`ไม่รวมโมเดลที่ยังไม่มีผลตรวจย้อนหลัง: ${excl}`, `Models without a back-check yet are excluded: ${excl}`)),
      el("li", {}, T(`ที่มาของค่าปรับแก้: ${C.source || "–"} · อัปเดต ${calDate}`, `Correction source: ${tx(C.source) || "–"} · updated ${calDate}`)),
      el("li", {}, T("พยากรณ์นี้มาจากโมเดลคอมพิวเตอร์ ไม่ใช่ประกาศเตือนภัยทางการ", "This forecast comes from computer models and is not an official warning"))));
}

// ---------------------------------------------------------------------------
// 🇹🇭 ทั่วประเทศ: พยากรณ์รายจังหวัด และความถูกต้องรายสถานี/รายภาค · ลิงก์ตรงด้วย #th
// ข้อมูล: data/national.json (weather_national.py) · ขอบเขตจังหวัด: th_provinces.geojson (Natural Earth)
// ---------------------------------------------------------------------------
const NT_FC = {
  tmax: { label: T("อุณหภูมิสูงสุด", "Max temperature"), unit: "°C", steps: [30, 32, 34, 36, 38], colors: ["#fff7bc", "#fee391", "#fec44f", "#fe9929", "#ec7014", "#b33f00"],
    names: ["< 30", "30–31.9", "32–33.9", "34–35.9", "36–37.9", "≥ 38"] },
  hi: { label: T("ระดับดัชนีความร้อน", "Heat index level"), unit: "°C" },
  rain: { label: T("ฝนรายวัน", "Daily rain"), unit: T("มม.", "mm"), steps: [1, 5, 10, 20, 35], colors: ["#f7fbff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
    names: ["< 1", "1–4.9", "5–9.9", "10–19.9", "20–34.9", "≥ 35"] },
  p_rain: { label: T("โอกาสฝน", "Rain chance"), unit: "%" },
};
const NT_VAR = {
  temp: { label: T("อุณหภูมิราย 3 ชม.", "3-hour temperature"), metric: "MAE", unit: "°C" },
  tmax: { label: T("อุณหภูมิสูงสุดรายวัน", "Daily max temperature"), metric: "MAE", unit: "°C" },
  tmin: { label: T("อุณหภูมิต่ำสุดรายวัน", "Daily min temperature"), metric: "MAE", unit: "°C" },
  rain: { label: T("ฝนรายวัน", "Daily rain"), metric: "CSI", unit: "" },
};
const NT_MAE = { steps: [1, 1.5, 2, 2.5, 3], colors: ["#1a9850", "#91cf60", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"],
  names: ["< 1.0", "1.0–1.4", "1.5–1.9", "2.0–2.4", "2.5–2.9", "≥ 3.0 °C"] };
const NT_CSI = { steps: [20, 35, 50, 65], colors: ["#d73027", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"],
  names: ["< 20", "20–34", "35–49", "50–64", "≥ 65"] };
const NT_LEAD = EN ? { H24: "24 h ahead", H72: "72 h ahead", H168: "168 h ahead" } : { H24: "ล่วงหน้า 24 ชม.", H72: "ล่วงหน้า 72 ชม.", H168: "ล่วงหน้า 168 ชม." };
const nt = { data: null, geo: null, mode: "fc", day: 1, metric: "tmax", vvar: "temp", lead: "H24", model: "_best", sel: null, ssel: null,
  map: null, layer: null, fitted: false };
const ntStep = (v, s) => (v == null ? "#d9d9d9" : s.colors[s.steps.filter((x) => v >= x).length]);
const ntIsMae = () => NT_VAR[nt.vvar].metric === "MAE";
const ntBetter = (a, b) => (ntIsMae() ? a < b : a > b);

async function loadNat() {
  if (!nt.data) nt.data = await getJSON("data/national.json");
  return nt.data;
}

async function showNat(on) {
  document.body.classList.remove("about-mode", "heat-mode");
  document.body.classList.toggle("nat-mode", on);
  if (on) { history.replaceState(null, "", "#th"); store.set("tab", "th"); }
  markChips();
  if (!on) return;
  window.scrollTo({ top: 0 });
  try {
    await loadNat();
    if (!nt.geo) nt.geo = await getJSON("th_provinces.geojson");
  } catch (e) {
    $("nt-updated").textContent = T("ยังไม่มีข้อมูล — จะมีในรอบถัดไป", "No data yet — it will appear after the next run");
    return;
  }
  if (!nt.map && typeof L !== "undefined") {
    nt.map = L.map("nt-map", { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ${T("ขอบเขต", "boundaries")}: Natural Earth`, maxZoom: 14, opacity: 0.55 }).addTo(nt.map);
    $("nt-map").classList.toggle("dark-tiles", isDark());
  }
  renderNat();
  requestAnimationFrame(() => nt.map && nt.map.invalidateSize());
}

function ntChips(id, items, cur, onpick) {
  $(id).replaceChildren(...items.map(([k, label]) => el("button", { class: "chip", role: "tab", type: "button",
    "aria-selected": String(k === cur), onclick: () => onpick(k) }, label)));
}

function ntScore(s, model) {
  const t = s.scores?.[nt.vvar]?.[nt.lead];
  if (!t) return null;
  if (model !== "_best") return t[model] ? { model, v: t[model][0], n: t[model][4] ?? t[model][2] } : null;
  let best = null;
  for (const [m, a] of Object.entries(t)) if (a[0] != null && (!best || ntBetter(a[0], best.v))) best = { model: m, v: a[0], n: a[4] ?? a[2] };
  return best;
}

function renderNat() {
  const D = nt.data, F = D.forecast;
  ntChips("nt-mode", [["fc", T("🗺️ พยากรณ์รายจังหวัด", "🗺️ Forecast by province")], ["vf", T("🎯 ความแม่นรายสถานี", "🎯 Accuracy by station")]], nt.mode, (k) => { nt.mode = k; renderNat(); });
  const fc = nt.mode === "fc";
  $("nt-fc-ctl").hidden = !fc;
  $("nt-vf-ctl").hidden = fc;
  const VP = D.verify_period || {};
  const when = (iso) => new Date(iso).toLocaleString(LOCALE, { dateStyle: "medium", timeStyle: "short" });
  $("nt-updated").textContent = fc
    ? (F ? T(`คำนวณเมื่อ ${when(F.generated)} · ${F.provinces.length} จังหวัด · ค่ากลางของ ${F.models.length} โมเดล (${F.models.join(", ")}) · อัปเดตประมาณทุก 6 ชั่วโมง`,
      `Calculated ${when(F.generated)} · ${F.provinces.length} provinces · median of ${F.models.length} models (${F.models.join(", ")}) · updated about every 6 hours`)
      : T("ยังไม่มีพยากรณ์", "No forecast yet"))
    : T(`ค่าที่วัดได้จาก ${D.stations.length} สถานีของกรมอุตุนิยมวิทยา · ${VP.from || "–"} ถึง ${VP.to || "–"} · อัปเดต ${when(D.generated)}`,
      `Measurements from ${D.stations.length} Thai Meteorological Department stations · ${VP.from || "–"} to ${VP.to || "–"} · updated ${when(D.generated)}`);
  if (nt.layer) { nt.layer.remove(); nt.layer = null; }
  if (fc) renderNatFc(); else renderNatVf();
  if (nt.map && nt.layer && !nt.fitted) { nt.map.fitBounds([[5.6, 97.3], [20.5, 105.7]]); nt.fitted = true; }
  renderNatMethod();
}

function ntFcColor(d) {
  if (!d) return "#d9d9d9";
  if (nt.metric === "hi") return d.lvl == null ? "#d9d9d9" : HS_COLORS[d.lvl];
  if (nt.metric === "p_rain") return hsPctColor(d.p_rain, HS_P_RAIN);
  return ntStep(d[nt.metric], NT_FC[nt.metric]);
}

function renderNatFc() {
  const F = nt.data.forecast;
  if (!F) return;
  const days = F.provinces[0].days;
  if (nt.day >= days.length) nt.day = 0;
  ntChips("nt-days", days.map((d, i) => [i, dayChip(d)]), nt.day, (k) => { nt.day = k; renderNat(); });
  ntChips("nt-metric", Object.entries(NT_FC).map(([k, m]) => [k, m.label]), nt.metric, (k) => { nt.metric = k; renderNat(); });
  const byCode = Object.fromEntries(F.provinces.map((p) => [p.pcode, p]));
  if (nt.map) {
    nt.layer = L.geoJSON(nt.geo, {
      style: (f) => ({ color: "#ffffff", weight: 0.8, fillOpacity: 0.85, fillColor: ntFcColor(byCode[f.properties.pcode]?.days[nt.day]) }),
      onEachFeature: (f, ly) => {
        const d = byCode[f.properties.pcode]?.days[nt.day];
        ly.bindTooltip(`<b>${tx(f.properties.name)}</b> <small>${tx(f.properties.region)}</small><br>` +
          T(`อุณหภูมิสูงสุด ${fmt(d?.tmax)} °C (${fmt(d?.tmax_lo)}–${fmt(d?.tmax_hi)}) · ต่ำสุด ${fmt(d?.tmin)} °C<br>ดัชนีความร้อนสูงสุด ${fmt(d?.hi)} °C · ฝน ${fmt(d?.rain)} มม. (โอกาส ${d?.p_rain ?? "–"}%)`,
            `Max ${fmt(d?.tmax)} °C (${fmt(d?.tmax_lo)}–${fmt(d?.tmax_hi)}) · min ${fmt(d?.tmin)} °C<br>Max heat index ${fmt(d?.hi)} °C · rain ${fmt(d?.rain)} mm (chance ${d?.p_rain ?? "–"}%)`),
          { sticky: true, className: "map-label" });
        ly.on("click", () => { nt.sel = f.properties.pcode; renderNatFcDetail(); });
      },
    }).addTo(nt.map);
  }
  const m = NT_FC[nt.metric];
  const legend = nt.metric === "hi" ? HS_NAMES.map((n, i) => [HS_COLORS[i], n])
    : nt.metric === "p_rain" ? HS_P_RAIN.map((c, i) => [c, ["< 10%", "10–39%", "40–69%", "≥ 70%"][i]])
      : m.colors.map((c, i) => [c, `${m.names[i]} ${m.unit}`]);
  $("nt-legend").replaceChildren(...legend.map(([c, n]) => el("span", { class: "lg" },
    el("i", { style: `display:inline-block;width:14px;height:14px;border-radius:3px;background:${c}` }), n)));
  // ตารางรายจังหวัด: จัดกลุ่มตามภาค
  const val = (d) => (nt.metric === "hi" ? fmt(d.hi) : nt.metric === "p_rain" ? `${d.p_rain ?? "–"}%` : fmt(d[nt.metric]));
  const regions = [...new Set(F.provinces.map((p) => p.region))];
  $("nt-table").replaceChildren(el("table", { class: "hs-table" },
    el("thead", {}, el("tr", {}, el("th", {}, T("จังหวัด", "Province")), ...days.map((d, i) => el("th", { class: i === nt.day ? "sel" : null }, ...dayCol(d))))),
    ...regions.map((r) => el("tbody", {},
      el("tr", { class: "nt-region" }, el("th", { colspan: String(days.length + 1) }, tx(r))),
      F.provinces.filter((p) => p.region === r).sort((a, b) => tx(a.name).localeCompare(tx(b.name), LANG)).map((p) => el("tr", {},
        el("td", {}, el("a", { onclick: () => { nt.sel = p.pcode; renderNatFcDetail(); $("nt-detail").scrollIntoView({ block: "nearest" }); } }, tx(p.name))),
        ...p.days.map((d) => { const c = ntFcColor(d); return el("td", { class: "lv", style: `background:${c};color:${inkOn(c)}` }, val(d)); })))))));
  if (!nt.sel || !byCode[nt.sel]) nt.sel = "TH-10";
  renderNatFcDetail();
}

function renderNatFcDetail() {
  const p = nt.data.forecast?.provinces.find((x) => x.pcode === nt.sel);
  if (!p) return;
  const lvlTag = (d) => { const c = d.lvl == null ? "#d9d9d9" : HS_COLORS[d.lvl];
    return el("span", { class: "hs-lvl", style: `background:${c};color:${inkOn(c)}` }, fmt(d.hi)); };
  $("nt-detail").replaceChildren(
    el("h4", {}, T(`จังหวัด${p.name}`, tx(p.name)), el("span", { class: "muted", style: "font-weight:400;font-size:12px" }, `  ${tx(p.region)}`)),
    el("table", {},
      el("thead", {}, el("tr", {}, ...(EN ? ["Day", "Tmax °C (range)", "Tmin °C", "Max HI °C", "Rain mm (P)"]
        : ["วัน", "Tmax °C (ช่วง)", "Tmin °C", "ดัชนีความร้อนสูงสุด °C", "ฝน มม. (P)"]).map((h) => el("th", {}, h)))),
      el("tbody", {}, p.days.map((d) => el("tr", {},
        el("td", {}, d.lead_day === 0 ? TODAY : `+${d.lead_day}`),
        el("td", {}, `${fmt(d.tmax)} (${fmt(d.tmax_lo)}–${fmt(d.tmax_hi)})`),
        el("td", {}, fmt(d.tmin)),
        el("td", {}, lvlTag(d)),
        el("td", {}, `${fmt(d.rain)} (${d.p_rain ?? "–"}%)`))))),
    el("p", { class: "note" }, T(`ค่าที่จุดกลางของจังหวัด (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}) · ค่ากลางของโมเดล · ช่วง = ต่ำสุด–สูงสุดระหว่างโมเดล · ` +
      `P = % ของโมเดลที่ฝนรายวัน ≥ ${nt.data.forecast.rain_threshold_mm} มม. · ดัชนีความร้อนยังไม่ได้ปรับแก้`,
      `Values at a central point of the province (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}) · median of the models · range = lowest–highest across models · ` +
      `P = % of models with daily rain ≥ ${nt.data.forecast.rain_threshold_mm} mm · heat index not yet corrected`)));
}

function renderNatVf() {
  const D = nt.data;
  ntChips("nt-var", Object.entries(NT_VAR).map(([k, v]) => [k, v.label]), nt.vvar, (k) => { nt.vvar = k; renderNat(); });
  ntChips("nt-lead", D.leads.map((l) => [l, NT_LEAD[l] || l]), nt.lead, (k) => { nt.lead = k; renderNat(); });
  const models = D.verify_models || [];
  $("nt-model").replaceChildren(el("option", { value: "_best", selected: nt.model === "_best" }, T("โมเดลที่แม่นที่สุดของแต่ละสถานี", "Most accurate model at each station")),
    ...models.map((m) => el("option", { value: m, selected: m === nt.model }, m)));
  $("nt-model").onchange = (e) => { nt.model = e.target.value; renderNat(); };
  const scale = ntIsMae() ? NT_MAE : NT_CSI;
  if (nt.map) {
    nt.layer = L.layerGroup(D.stations.map((s) => {
      const sc = ntScore(s, nt.model);
      const c = sc ? ntStep(sc.v, scale) : "#d9d9d9";
      return L.circleMarker([s.lat, s.lon], { radius: 7, color: "#333", weight: 0.8, fillColor: c, fillOpacity: 0.95 })
        .bindTooltip(`<b>${tx(s.name)}</b> <small>${T("จ.", "")}${tx(s.province) || "–"}</small><br>` +
          (sc ? `${NT_VAR[nt.vvar].metric} ${fmt(sc.v, ntIsMae() ? 2 : 0)}${NT_VAR[nt.vvar].unit ? " " + NT_VAR[nt.vvar].unit : ""} · ${sc.model} · ${sc.n} ${T("ครั้ง", "cases")}` : NA),
        { className: "map-label" })
        .on("click", () => { nt.ssel = s.id; renderNatVfDetail(); });
    })).addTo(nt.map);
  }
  $("nt-legend").replaceChildren(...scale.colors.map((c, i) => el("span", { class: "lg" },
    el("i", { style: `display:inline-block;width:14px;height:14px;border-radius:50%;background:${c}` }), `${NT_VAR[nt.vvar].metric} ${scale.names[i]}`)),
    el("span", { class: "lg" }, el("i", { style: "display:inline-block;width:14px;height:14px;border-radius:50%;background:#d9d9d9" }), NA));
  // ตารางรายภาค: แบบจำลอง × ภาค
  const regs = D.regions.map((r) => r.region);
  const col = (o) => o?.[nt.vvar]?.[nt.lead] || {};
  const cols = [...D.regions.map(col), col(D.national)];
  const best = cols.map((t) => { let b = null; for (const [m, a] of Object.entries(t)) if (a[0] != null && (b == null || ntBetter(a[0], t[b][0]))) b = m; return b; });
  const rowModels = [...new Set(cols.flatMap((t) => Object.keys(t)))].sort((a, b) => {
    const x = col(D.national)[a]?.[0], y = col(D.national)[b]?.[0];
    return x == null ? 1 : y == null ? -1 : ntIsMae() ? x - y : y - x;
  });
  $("nt-table").replaceChildren(el("table", { class: "hs-table nt-vtable" },
    el("thead", {}, el("tr", {}, el("th", {}, T("โมเดล", "Model")), ...regs.map((r) => el("th", {}, EN ? tx(r) : r.replace("ภาค", ""))), el("th", {}, T("ทั้งประเทศ", "Thailand")))),
    el("tbody", {}, rowModels.map((m) => el("tr", {}, el("td", {}, m),
      ...cols.map((t, j) => {
        const a = t[m];
        if (!a || a[0] == null) return el("td", {}, "–");
        const c = ntStep(a[0], scale);
        return el("td", { class: "lv", style: `background:${c};color:${inkOn(c)};${best[j] === m ? "font-weight:700;outline:2px solid var(--ink);outline-offset:-2px" : ""}` },
          fmt(a[0], ntIsMae() ? 2 : 0), el("small", {}, `${a[4] ?? a[2]} ${T("ครั้ง", "cases")}`));
      }))))));
  if (!nt.ssel) nt.ssel = "48455";
  renderNatVfDetail();
}

function renderNatVfDetail() {
  const s = nt.data.stations.find((x) => x.id === nt.ssel);
  if (!s) return;
  const t = s.scores?.[nt.vvar] || {};
  const leads = nt.data.leads;
  const models = [...new Set(leads.flatMap((l) => Object.keys(t[l] || {})))].sort((a, b) => {
    const x = t[nt.lead]?.[a]?.[0], y = t[nt.lead]?.[b]?.[0];
    return x == null ? 1 : y == null ? -1 : ntIsMae() ? x - y : y - x;
  });
  const scale = ntIsMae() ? NT_MAE : NT_CSI;
  $("nt-detail").replaceChildren(
    el("h4", {}, tx(s.name), el("span", { class: "muted", style: "font-weight:400;font-size:12px" }, `  ${T("จ.", "")}${tx(s.province) || "–"} · ${tx(s.region) || ""}`)),
    el("p", { class: "note" }, T(`ค่าที่วัดได้ล่าสุด ${s.time ? s.time.replace("T", " ") : "–"} น.: อุณหภูมิ ${fmt(s.temp)} °C · ฝน 24 ชม. ${fmt(s.rain_24h)} มม.`,
      `Latest measurement ${s.time ? s.time.replace("T", " ") : "–"}: temperature ${fmt(s.temp)} °C · rain 24 h ${fmt(s.rain_24h)} mm`)),
    models.length ? el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, `${NT_VAR[nt.vvar].label} (${NT_VAR[nt.vvar].metric})`), ...leads.map((l) => el("th", {}, `${l.replace("H", "")} ${H}`)))),
      el("tbody", {}, models.map((m) => el("tr", {}, el("td", {}, m), ...leads.map((l) => {
        const a = t[l]?.[m];
        if (!a || a[0] == null) return el("td", {}, "–");
        const c = ntStep(a[0], scale);
        return el("td", {}, el("span", { class: "hs-lvl", style: `background:${c};color:${inkOn(c)}` }, fmt(a[0], ntIsMae() ? 2 : 0)));
      }))))) : el("p", {}, T("สถานีนี้ยังไม่มีข้อมูลให้เทียบ", "No forecast–measurement pairs for this station yet")),
    el("p", { class: "note" }, ntIsMae() ? T("MAE = คลาดเฉลี่ยกี่ °C ยิ่งน้อยยิ่งดี", "MAE = average error in °C, lower is better")
      : T("CSI = คะแนนจับฝน (0–100) ยิ่งสูงยิ่งดี · ฝนตก = ≥ 1 มม./วัน", "CSI = rain-catching score (0–100), higher is better · rain = ≥ 1 mm/day")));
}

function renderNatMethod() {
  const D = nt.data, VP = D.verify_period || {};
  $("nt-method").replaceChildren(
    el("p", {}, T("พยากรณ์รายจังหวัดคิดที่จุดกลางของแต่ละจังหวัด (จุดที่อยู่ในเขตจังหวัดเสมอ) " +
      "จากพยากรณ์รายชั่วโมงของโมเดลระดับโลก 4 ตัวผ่าน Open-Meteo แล้วสรุปเป็นค่ารายวันตามวันของเวลาไทย และแสดงค่ากลางของโมเดล " +
      "ดัชนีความร้อนใช้สมการของ National Weather Service และจัดระดับตามเกณฑ์ของกรุงเทพมหานคร/กรมอนามัย โดยยังไม่ได้ปรับแก้ " +
      "เพราะค่าปรับแก้ที่มีได้จากสถานีในกรุงเทพฯ เท่านั้น",
      "Province forecasts are calculated at a central point of each province (always inside it) " +
      "from the hourly forecasts of 4 global models via Open-Meteo, summarised by Thai calendar day, showing the median of the models. " +
      "The heat index uses the National Weather Service equation and Bangkok/Department of Health levels, without correction, " +
      "because the only corrections available come from Bangkok stations")),
    el("p", {}, T(`ความแม่นรายสถานีคิดจากการเทียบพยากรณ์กับค่าที่วัดได้ที่สถานีอุตุนิยมวิทยาทั่วประเทศ ${VP.days || 30} วันล่าสุด (${VP.from || "–"} ถึง ${VP.to || "–"}) ` +
      "อุณหภูมิราย 3 ชม. เทียบกับรายงานทุก 3 ชม. (Weather3Hours) ส่วนฝนรายวันและอุณหภูมิสูงสุด/ต่ำสุดเทียบกับสรุปรายวัน 07:00 น. (WeatherToday) " +
      "พยากรณ์มาจาก Open-Meteo Previous Runs API ที่เวลาล่วงหน้าที่กำหนด แบ่งภาคตามกรมอุตุนิยมวิทยา (6 ภาค)",
      `Station accuracy compares forecasts with measurements at weather stations nationwide over the last ${VP.days || 30} days (${VP.from || "–"} to ${VP.to || "–"}). ` +
      "3-hour temperature is compared with the 3-hourly reports (Weather3Hours); daily rain and max/min temperature with the 07:00 daily summary (WeatherToday). " +
      "Forecasts come from the Open-Meteo Previous Runs API at the given lead times. Regions follow the Thai Meteorological Department (6 regions)")),
    el("ul", {},
      el("li", {}, T("จุดเดียวบอกความต่างภายในจังหวัดไม่ได้ โดยเฉพาะจังหวัดที่มีภูเขาหรือชายฝั่ง",
        "A single point cannot show differences within a province, especially in mountainous or coastal provinces")),
      el("li", {}, T("แต่ละสถานีมีข้อมูลประมาณ 30 วัน คะแนนฝน (CSI) รายสถานีจึงยังไม่แน่นอนมาก ควรดูคะแนนรายภาคประกอบ",
        "Each station has about 30 days of data, so its rain score (CSI) is still very uncertain; look at the regional scores too")),
      el("li", {}, T("พยากรณ์นี้มาจากโมเดลคอมพิวเตอร์ ไม่ใช่ประกาศของกรมอุตุนิยมวิทยา", "These forecasts come from computer models and are not Thai Meteorological Department announcements"))));
}

// ความถูกต้อง ณ สถานีอุตุนิยมวิทยาที่ใกล้ตำแหน่งที่เลือกที่สุด (ใช้ได้ทุกตำแหน่งในประเทศ)
async function renderNearSkill() {
  const box = $("near-skill");
  if (!box || !state.loc) return;
  try { await loadNat(); } catch { box.replaceChildren(); return; }
  const lat = state.loc.lat, lon = state.loc.lon;
  let s = null, dmin = Infinity;
  for (const x of nt.data.stations) {
    if (!x.scores?.temp) continue;
    const d = distKm(lat, lon, x.lat, x.lon);
    if (d < dmin) { dmin = d; s = x; }
  }
  if (!s) { box.replaceChildren(); return; }
  if (state.nearProv !== s.province) { state.nearProv = s.province; renderUserMode(); }
  const top = (v, k) => {
    const t = s.scores?.[v]?.H24 || {};
    const arr = Object.entries(t).filter(([, a]) => a[0] != null);
    arr.sort((a, b) => (k === "min" ? a[1][0] - b[1][0] : b[1][0] - a[1][0]));
    return arr[0];
  };
  const tb = top("temp", "min"), rb = top("rain", "max");
  const VP = nt.data.verify_period || {};
  box.replaceChildren(el("div", { class: "near-card" },
    el("b", {}, T("📍 ที่สถานีอุตุนิยมวิทยาใกล้ที่สุด: ", "📍 At the nearest weather station: ")),
    T(`${s.name} (จ.${s.province || "–"}, ห่าง ${fmt(dmin, 0)} กม.)`, `${tx(s.name)} (${tx(s.province) || "–"}, ${fmt(dmin, 0)} km away)`),
    el("br"),
    tb ? [T("โมเดลที่ทายอุณหภูมิล่วงหน้า 24 ชม. แม่นที่สุด: ", "Best 24 h temperature forecast: "), el("b", {}, tb[0]), T(` (คลาดเฉลี่ย ${fmt(tb[1][0], 2)} °C)`, ` (MAE ${fmt(tb[1][0], 2)} °C)`)] : "",
    rb ? [T(" · ฝนรายวัน: ", " · daily rain: "), el("b", {}, rb[0]), ` (CSI ${fmt(rb[1][0], 0)})`] : "",
    el("span", { class: "muted" }, ` · ${VP.from || "–"} ${T("ถึง", "to")} ${VP.to || "–"} · `),
    el("a", { href: "#th", onclick: (e) => { e.preventDefault(); nt.mode = "vf"; nt.ssel = s.id; showNat(true); } }, T("ดูทั่วประเทศ →", "See nationwide →"))));
}
