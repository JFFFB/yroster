(() => {
"use strict";
const $ = id => document.getElementById(id);
const LS_OVR = "yroster_overrides_v3", LS_LIVE = "yroster_espn_live_v3", LS_RECENT = "yroster_recent_v3";
const ESPN_TEAM = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/252";
const ESPN_STATS = ESPN_TEAM + "/statistics";
const STALE_MS = 15 * 60 * 1000, EXPIRE_MS = 24 * 60 * 60 * 1000, TIMEOUT_MS = 5000;
const UNITS = { OFF: "Offense", DEF: "Defense", ST: "Special Teams" };

let recentTimer = 0, BASE = [], META = {}, ROSTER = [], digits = "", mode = "keypad", unitFilter = "ALL", editing = null, syncing = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const keyOf = p => p.num + "__" + norm(p.name);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const timeLabel = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const numsOf = s => (String(s || "").replace(/\(\s*\d+\s*GP\s*\)/gi, "").match(/\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(",", "")).join("|");

/* ---------- data ---------- */
function build() {
  const ovr = load(LS_OVR, {});
  const live = freshLive();
  ROSTER = BASE.map(b => {
    const o = ovr[keyOf(b)];
    const gp = o && o.gp !== undefined ? o.gp : b.gp;
    const espn = o && o.espn !== undefined ? o.espn : b.espn;
    const byu = o && o.byu !== undefined ? o.byu : b.byu;
    const diff = !!(espn && byu && numsOf(espn) !== numsOf(byu));
    return { ...b, gp, espn, byu, diff, note: (o && o.note) || "", edited: !!o, live: live && live.map[norm(b.name)] || null, liveAt: live && live.t };
  }).sort((a, c) => (+a.num - +c.num) || a.unit.localeCompare(c.unit));
  const n = ROSTER.filter(p => p.diff).length;
  renderPills();
}
function freshLive() {
  const l = load(LS_LIVE, null);
  return l && Date.now() - l.t < EXPIRE_MS ? l : null;
}

/* ---------- live ESPN sync (timeout, no third-party proxy) ---------- */
async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }); if (!r.ok) throw 0; return await r.json(); }
  finally { clearTimeout(t); }
}
function parseLeaders(d) {
  const map = {};
  const cats = (d && ((d.results && d.results.stats && d.results.stats.categories) || (d.stats && d.stats.categories) || (d.splits && d.splits.categories))) || [];
  cats.forEach(c => (c.leaders || []).forEach(g => (g.leaders || []).forEach(e => {
    const name = e.athlete && (e.athlete.displayName || e.athlete.fullName);
    if (!name || e.displayValue == null) return;
    const line = `${c.displayName || c.name || ""} ${g.shortDisplayName || g.displayName || g.name || ""}: ${e.displayValue}`.trim();
    const k = norm(name); (map[k] = map[k] || []).includes(line) || map[k].push(line);
  })));
  return map;
}
async function sync(manual) {
  if (syncing) return;
  if (!navigator.onLine) { setStatus(); return; }
  const prev = load(LS_LIVE, null);
  if (!manual && prev && Date.now() - prev.t < STALE_MS) { setStatus(); return; }
  syncing = true; $("sync-btn").classList.add("spin"); $("dot").className = "busy"; $("status-text").textContent = "Syncing ESPN…";
  try {
    const [team, stats] = await Promise.allSettled([getJSON(ESPN_TEAM), getJSON(ESPN_STATS)]);
    if (team.status === "rejected" && stats.status === "rejected") throw 0;
    const rec = team.status === "fulfilled" && team.value.team && team.value.team.record && team.value.team.record.items && team.value.team.record.items[0];
    const next = team.status === "fulfilled" && team.value.team && team.value.team.nextEvent && team.value.team.nextEvent[0];
    save(LS_LIVE, {
      t: Date.now(),
      record: rec ? rec.summary : (prev && prev.record) || "",
      next: next ? (next.shortName || next.name || "") : "",
      map: stats.status === "fulfilled" ? parseLeaders(stats.value) : (prev && prev.map) || {}
    });
    build();
  } catch { /* keep saved data */ }
  syncing = false; $("sync-btn").classList.remove("spin");
  setStatus(); refresh(false);
}
function setStatus() {
  const l = freshLive(), dot = $("dot"), txt = $("status-text");
  if (!navigator.onLine) { dot.className = "off"; txt.textContent = "Offline • showing saved data"; return; }
  if (l) {
    dot.className = Date.now() - l.t < STALE_MS * 4 ? "ok" : "busy";
    txt.textContent = `${l.record ? "BYU " + l.record + " • " : ""}ESPN live as of ${timeLabel(l.t)}`;
  } else { dot.className = "busy"; txt.textContent = "Saved baseline • tap Sync for live ESPN"; }
}

/* ---------- rendering ---------- */
const unitTag = u => `<span class="tag ${esc(u)}">${esc(u)}</span>`;
function statsHTML(p) {
  const base = esc(META.baselineLabel || "Saved baseline");
  let h = "";
  if (!p.espn && !p.byu) {
    h = `<div class="stats"><div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem"><span class="note">No 2026 stats saved</span><button class="mini" data-edit="${esc(keyOf(p))}">Log stats</button></div></div>`;
  } else if (p.diff) {
    h = `<div class="stats diff">
      <div class="lbl" style="color:#451a03">⚠ Sources differ${p.gp ? " (" + esc(p.gp) + ")" : ""}</div>
      <div class="src e"><div class="lbl"><span>ESPN</span></div><p>${esc(p.espn)}</p></div>
      <div class="src b"><div class="lbl"><span>BYU official</span></div><p>${esc(p.byu)}</p></div>
      <div class="note">${p.note ? "<b>Note:</b> " + esc(p.note) : "Totals differ between sources. Check the official box score to confirm."}</div>
      <div class="note">${base}</div></div>`;
  } else {
    h = `<div class="stats"><div class="lbl" style="display:flex;justify-content:space-between"><span>2026 stats ${p.gp ? "(" + esc(p.gp) + ")" : ""}</span><span class="tag">ESPN = BYU</span></div>
      <p>${esc(p.byu || p.espn)}</p><div class="note">${p.edited ? "Edited on this device" : base}</div></div>`;
  }
  if (p.live && p.live.length) {
    h += `<div class="stats src l"><div class="lbl"><span>ESPN live</span><span>${timeLabel(p.liveAt)}</span></div><p>${p.live.slice(0, 4).map(esc).join(" | ")}</p></div>`;
  }
  return h;
}
function cardHTML(p) {
  const meta = [p.yr, p.ht && p.wt ? `${p.ht}, ${p.wt} lbs` : p.ht].filter(Boolean).join(" • ");
  const loc = [p.hometown, p.prevSchool].filter(Boolean).join(" • ");
  return `<article class="card ${esc(p.unit)}"><div class="top">
    <div class="jersey"><small>#</small>${esc(p.num)}</div>
    <div class="info"><div class="tags">${unitTag(p.unit)}<span class="tag">${esc(p.pos)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ""}</div>
      <h2>${esc(p.name)}</h2>${loc ? `<div class="loc">📍 ${esc(loc)}</div>` : ""}</div>
    <button class="mini" data-edit="${esc(keyOf(p))}" aria-label="Edit stats for ${esc(p.name)}">+ Stat</button></div>
    ${statsHTML(p)}</article>`;
}
const rowHTML = n => {
  const ps = ROSTER.filter(p => p.num === n);
  return `<button class="row" data-pick="${esc(n)}"><span style="display:flex;gap:.6rem;min-width:0"><span class="n">#${esc(n)}</span><span class="nm">${ps.map(p => esc(p.name) + " (" + esc(p.pos) + ")").join(" • ")}</span></span>${ps.length > 1 ? '<span class="tag">2x</span>' : "<span>›</span>"}</button>`;
};

function refresh(resetScroll = true) {
  const box = $("numbox"), out = $("results");
  if (resetScroll) out.scrollTop = 0;
  $("top-clear").classList.toggle("hide", !digits);
  $("num").textContent = digits || "__"; box.classList.toggle("on", !!digits);

  if (!digits) {
    $("t1").textContent = "Tap a jersey number";
    $("t2").textContent = `${ROSTER.length} players • ${ROSTER.filter(p => p.diff).length} with source differences`;
    const rec = load(LS_RECENT, []).filter(n => ROSTER.some(p => p.num === n));
    out.innerHTML = (rec.length ? `<div class="box"><div class="lbl">Recent lookups</div>${rec.map(rowHTML).join("")}</div>` : "") +
      `<div class="empty"><h3>Enter a jersey number</h3>Results appear as you type. <b style="color:#b91c1c">ESPN</b> lines have a solid red border and <b style="color:#0062B8">BYU</b> lines a dashed blue one, so they're distinguishable without color.</div>`;
    return;
  }
  const exact = ROSTER.filter(p => p.num === digits);
  const prefix = digits.length === 1 ? [...new Set(ROSTER.filter(p => p.num.length === 2 && p.num[0] === digits).map(p => p.num))].sort((a, b) => a - b) : [];
  if (exact.length) {
    $("t1").textContent = `${exact.length} match${exact.length > 1 ? "es" : ""} for #${digits}`;
    $("t2").textContent = exact.length > 1 ? "Shared number: " + exact.map(p => p.unit).join(" & ") : `${exact[0].pos} • ${exact[0].unit}`;
    const d0 = digits; clearTimeout(recentTimer); recentTimer = setTimeout(() => { if (digits === d0) pushRecent(d0); }, 1500);
  } else {
    $("t1").textContent = prefix.length ? `No #${digits} assigned` : `No #${digits} on roster`;
    $("t2").textContent = prefix.length ? `Pick a #${digits}0–#${digits}9 below` : "Tap CLEAR or try another number";
  }
  let h = "";
  if (exact.length > 1) h += `<div class="warn">Duplicate #${esc(digits)}: shared by ${exact.map(p => UNITS[p.unit]).join(" & ")}</div>`;
  h += exact.map(cardHTML).join("");
  if (!exact.length && !prefix.length) h += `<div class="empty"><h3>Unassigned number</h3>No player is listed at #${esc(digits)}.<br><button class="cta" data-clear>Reset keypad</button></div>`;
  if (prefix.length) h += `<div class="box"><div class="lbl">Numbers starting with ${esc(digits)}</div>${prefix.map(rowHTML).join("")}</div>`;
  out.innerHTML = h;
}
function pushRecent(n) {
  const r = load(LS_RECENT, []).filter(x => x !== n); r.unshift(n); save(LS_RECENT, r.slice(0, 6));
}

function renderPills() {
  const c = u => u === "ALL" ? ROSTER.length : u === "DISCREPANCY" ? ROSTER.filter(p => p.diff).length : ROSTER.filter(p => p.unit === u).length;
  const defs = [["ALL", "All"], ["DISCREPANCY", "Differences"], ["OFF", "Offense"], ["DEF", "Defense"], ["ST", "Special Teams"]];
  $("pills").innerHTML = defs.map(([u, n]) => `<button class="pill ${u === "DISCREPANCY" ? "d " : ""}${u === unitFilter ? "on" : ""}" data-unit="${u}">${n} ${c(u)}</button>`).join("");
}
function renderRoster() {
  const q = $("q").value.trim().toLowerCase().replace(/^#/, "");
  $("q-clear").classList.toggle("hide", !q);
  const list = ROSTER.filter(p => {
    if (unitFilter === "DISCREPANCY" ? !p.diff : unitFilter !== "ALL" && p.unit !== unitFilter) return false;
    if (!q) return true;
    return p.num.startsWith(q) || [p.name, p.pos, p.yr, p.espn, p.byu, p.hometown, p.prevSchool].some(f => (f || "").toLowerCase().includes(q));
  });
  $("count").textContent = `${list.length} player${list.length === 1 ? "" : "s"}`;
  $("list").innerHTML = list.length ? list.map(cardHTML).join("") : `<div class="empty"><h3>No matching players</h3>Try a number, name, position, or hometown.</div>`;
  renderPills();
}

/* ---------- input ---------- */
function press(d) {
  buzz();
  digits = (digits.length >= 2 || digits === "0") ? d : digits + d;
  refresh();
}
const back = () => { buzz(10); digits = digits.slice(0, -1); refresh(); };
const clear = () => { buzz(15); digits = ""; refresh(); };

function setMode(m) {
  mode = m;
  $("view-keypad").classList.toggle("hide", m !== "keypad");
  $("view-roster").classList.toggle("hide", m !== "roster");
  [["keypad", "tab-keypad"], ["roster", "tab-roster"]].forEach(([k, id]) => $(id).setAttribute("aria-selected", String(k === m)));
  if (m === "roster") renderRoster(); else refresh(false);
}

/* ---------- edit modal ---------- */
function openModal(key) {
  const p = ROSTER.find(x => keyOf(x) === key); if (!p) return;
  editing = key;
  $("m-title").textContent = `#${p.num} ${p.name} (${p.pos})`;
  $("m-gp").value = p.gp || ""; $("m-espn").value = p.espn || ""; $("m-byu").value = p.byu || ""; $("m-note").value = p.note || "";
  $("modal").classList.remove("hide"); $("m-gp").focus();
}
function closeModal() { editing = null; $("modal").classList.add("hide"); }
function afterEdit() { build(); closeModal(); mode === "keypad" ? refresh(false) : renderRoster(); }
function saveEdit() {
  if (!editing) return;
  const o = load(LS_OVR, {});
  o[editing] = { gp: $("m-gp").value.trim(), espn: $("m-espn").value.trim(), byu: $("m-byu").value.trim(), note: $("m-note").value.trim() };
  save(LS_OVR, o); afterEdit();
}
function resetEdit() {
  if (!editing) return;
  const o = load(LS_OVR, {}); delete o[editing]; save(LS_OVR, o); afterEdit();
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-key],[data-pick],[data-edit],[data-unit],[data-clear]");
  if (!t) return;
  if (t.dataset.key !== undefined) { const k = t.dataset.key; k === "Escape" ? clear() : k === "Backspace" ? back() : press(k); }
  else if (t.dataset.pick !== undefined) { buzz(15); digits = t.dataset.pick; refresh(); }
  else if (t.dataset.edit !== undefined) openModal(t.dataset.edit);
  else if (t.dataset.unit !== undefined) { unitFilter = t.dataset.unit; renderRoster(); }
  else if (t.dataset.clear !== undefined) clear();
});
$("tab-keypad").onclick = () => setMode("keypad");
$("tab-roster").onclick = () => setMode("roster");
$("top-clear").onclick = clear;
$("sync-btn").onclick = () => sync(true);
$("q").oninput = renderRoster;
$("q-clear").onclick = () => { $("q").value = ""; $("q").focus(); renderRoster(); };
$("m-close").onclick = closeModal; $("m-save").onclick = saveEdit; $("m-reset").onclick = resetEdit;
$("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });
window.addEventListener("online", () => { setStatus(); sync(false); });
window.addEventListener("offline", setStatus);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { setStatus(); sync(false); } });

function flash(k) {
  const b = document.querySelector(`.key[data-key="${k}"]`); if (!b) return;
  b.classList.add("pressed"); setTimeout(() => b.classList.remove("pressed"), 110);
}
document.addEventListener("keydown", e => {
  if (!$("modal").classList.contains("hide")) { if (e.key === "Escape") closeModal(); return; }
  if (mode !== "keypad" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); flash(e.key); press(e.key); }
  else if (e.key === "Backspace") { e.preventDefault(); flash("Backspace"); back(); }
  else if (e.key === "Escape" || e.key === "Delete" || e.key.toLowerCase() === "c") { e.preventDefault(); flash("Escape"); clear(); }
});

/* ---------- boot ---------- */
async function init() {
  try {
    const r = await fetch("./roster.json"); const d = await r.json();
    BASE = d.players; META = d.meta || {};
  } catch {
    $("results").innerHTML = `<div class="empty"><h3>Roster unavailable</h3>Open the app once while online so it can save the roster for offline use.</div>`;
    return;
  }
  build(); setStatus(); refresh(false); sync(false);
}
init();

/* ---------- service worker + update prompt ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      const prompt = w => {
        if ($("toast")) return;
        const t = document.createElement("div"); t.className = "toast"; t.id = "toast";
        t.innerHTML = `<span>Update available</span><button>Reload</button>`;
        t.querySelector("button").onclick = () => w.postMessage("SKIP_WAITING");
        document.body.appendChild(t);
      };
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) prompt(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
    } catch {}
  });
}
})();
