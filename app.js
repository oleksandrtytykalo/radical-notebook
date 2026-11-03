// Radical Notebook — app logic. Plain JS, no build step.
// Data: WORDS / CHARS / PARTS / FORMATION from data.js, plus words added in the app.

/* ---------- small utils ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[(Math.random() * a.length) | 0];
const chars = (s) => [...s].filter((c) => /\p{Script=Han}/u.test(c));
const norm = (s) => String(s).toLowerCase().trim();

let toastTimer;
function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

/* ---------- pinyin ---------- */
const TONES = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", "ü": "ǖǘǚǜ" };
const MARKED = {};
for (const [b, s] of Object.entries(TONES)) [...s].forEach((ch, i) => (MARKED[ch] = [b, i + 1]));

// Reduce any pinyin spelling (marks or numbers) to letters + tone sequence.
function analysePinyin(str) {
  const s = String(str).toLowerCase().normalize("NFC").replace(/u:/g, "ü").replace(/v/g, "ü");
  let base = ""; const tones = [];
  for (const ch of s) {
    if (MARKED[ch]) { base += MARKED[ch][0]; tones.push(MARKED[ch][1]); }
    else if (/[1-4]/.test(ch)) tones.push(+ch);
    else if (/[a-zü]/.test(ch)) base += ch;
  }
  return { base, tones: tones.join("") };
}
function pinyinVerdict(input, target) {
  const a = analysePinyin(input), b = analysePinyin(target);
  if (a.base !== b.base) return "wrong";
  return a.tones === b.tones ? "right" : "tones";
}
// Same syllables, different tones: the best distractors for tone training.
function toneVariants(p) {
  const arr = [...p.normalize("NFC")];
  const out = new Set();
  arr.forEach((ch, i) => {
    if (!MARKED[ch]) return;
    const [b, t] = MARKED[ch];
    for (let n = 1; n <= 4; n++) if (n !== t) { const c = [...arr]; c[i] = TONES[b][n - 1]; out.add(c.join("")); }
  });
  return [...out];
}

/* ---------- storage: this device, plus your claude.ai account when available ---------- */
const LS_KEY = "radical-notebook-v1";
const Store = {
  data: { progress: {}, custom: [], settings: { len: 20, rate: 0.8, scope: [] }, updatedAt: 0 },
  ref: null,
  synced: false,
  loadLocal() {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) this.adopt(JSON.parse(raw)); } catch {}
  },
  adopt(d) {
    this.data = { ...this.data, ...d, settings: { ...this.data.settings, ...(d.settings || {}) } };
  },
  async connect() {
    try {
      if (!window.claude?.use) return;
      const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.ref = db.doc(`data/users/${uid}/state`);
      const snap = await this.ref.get();
      const remote = snap.exists ? snap.data() : null;
      if (remote && (remote.updatedAt || 0) > (this.data.updatedAt || 0)) {
        this.adopt(remote);
        try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch {}
        if (S.view !== "session") render();
      } else {
        await this.ref.set(this.data);
      }
      this.synced = true;
      if (S.view === "add") render();
    } catch { this.ref = null; }
  },
  timer: null,
  save() {
    this.data.updatedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch {}
    if (!this.ref) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ref.set(this.data).catch(() => {}), 1200);
  },
};
const settings = () => Store.data.settings;

/* ---------- data access ---------- */
// Every folder entry. A word may sit in several folders (e.g. Lessons and Light Lessons);
// progress is keyed by the characters, so it is shared between them.
function folderEntries() {
  return [...WORDS, ...Store.data.custom.map((w) => ({ ...w, custom: true }))];
}
const uniqueWords = (list) => { const seen = new Set(); return list.filter((w) => !seen.has(w.hanzi) && seen.add(w.hanzi)); };
function allWords() { return uniqueWords(folderEntries()); }
function folders() {
  const m = new Map();
  for (const w of folderEntries()) { if (!m.has(w.folder)) m.set(w.folder, []); m.get(w.folder).push(w); }
  return m;
}
// Saved folder choices that still exist (folders can be renamed or removed in data.js)
function liveScope() { const fs = folders(); return (settings().scope || []).filter((f) => fs.has(f)); }
function scopeWords() {
  const sc = liveScope();
  return sc.length ? uniqueWords(folderEntries().filter((w) => sc.includes(w.folder))) : allWords();
}
const wordByHanzi = (h) => allWords().find((w) => w.hanzi === h);
const wordForChar = (c) => wordByHanzi(c) || allWords().find((w) => w.hanzi.includes(c));
function learnedChars() {
  const s = new Set(); allWords().forEach((w) => chars(w.hanzi).forEach((c) => s.add(c))); return [...s];
}
// part -> [{ch, role}] across characters you have learned
// A part may be described in PARTS, or be a character with its own breakdown
function partInfo(k) { const c = CHARS[k]; return PARTS[k] || (c && { py: c.py, en: c.en, note: c.story }); }
function partIndex() {
  const idx = new Map();
  for (const ch of learnedChars()) {
    const info = CHARS[ch]; if (!info) continue;
    for (const p of info.parts) {
      if (!idx.has(p.c)) idx.set(p.c, []);
      if (!idx.get(p.c).some((x) => x.ch === ch)) idx.get(p.c).push({ ch, role: p.role });
    }
    if (partInfo(ch)) { if (!idx.has(ch)) idx.set(ch, []); }
  }
  return idx;
}
function relatedChars(ch) {
  const info = CHARS[ch]; if (!info) return [];
  const mine = new Set(info.parts.map((p) => p.c).concat(ch));
  return learnedChars().filter((c) => c !== ch && CHARS[c] && (CHARS[c].parts.some((p) => mine.has(p.c)) || mine.has(c)));
}

/* ---------- progress ---------- */
const prog = (h) => Store.data.progress[h] || { b: 0, c: 0, w: 0, t: 0 };
function grade(h, ok) {
  const p = { ...prog(h) };
  if (ok) { p.b = Math.min(5, p.b + 1); p.c++; } else { p.b = Math.max(0, p.b - 1); p.w++; }
  p.t = Date.now();
  Store.data.progress[h] = p; Store.save();
}
const dots = (h) => `<span class="dots" aria-label="mastery ${prog(h).b} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${prog(h).b >= i ? "on" : ""}"></i>`).join("")}</span>`;
// Weak and unseen words come up more often.
function weightedPick(pool, avoid = []) {
  const cand = pool.length > avoid.length + 1 ? pool.filter((w) => !avoid.includes(w.hanzi)) : pool;
  const weights = cand.map((w) => { const p = prog(w.hanzi); return (6 - p.b) ** 2 + (p.c + p.w === 0 ? 8 : 0); });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cand.length; i++) { r -= weights[i]; if (r <= 0) return cand[i]; }
  return cand[cand.length - 1];
}

/* ---------- speech ---------- */
let zhVoice = null;
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find((v) => /zh[-_]CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang) && !/HK|yue/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text) {
  if (!("speechSynthesis" in window)) return toast("This browser has no speech voice.");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN"; if (zhVoice) u.voice = zhVoice; u.rate = settings().rate || 0.8;
  speechSynthesis.speak(u);
}
const speakBtn = (h, cls = "") => `<button class="speak ${cls}" data-say="${esc(h)}">▶ Play sound</button>`;

/* ---------- stroke order (Hanzi Writer) ---------- */
function strokeLoader(ch, onLoad, onErr) {
  const hex = ch.codePointAt(0).toString(16);
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  get(`strokes/${hex}.json`)
    .catch(() => get(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(ch)}.json`))
    .then(onLoad, onErr);
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function makeWriter(el, ch, opts = {}) {
  if (!window.HanziWriter) return null;
  const size = el.clientWidth || 130;
  return HanziWriter.create(el, ch, {
    width: size, height: size, padding: Math.round(size * 0.06),
    strokeColor: cssVar("--ink"), outlineColor: cssVar("--rule"), drawingColor: cssVar("--ink"),
    highlightColor: cssVar("--dim"), radicalColor: null, drawingWidth: Math.max(4, size / 40),
    strokeAnimationSpeed: 1.2, delayBetweenStrokes: 220, charDataLoader: strokeLoader,
    onLoadCharDataError: () => { el.innerHTML = `<p class="muted" style="padding:10px;font-size:12px">No stroke data for ${esc(ch)} yet.</p>`; },
    ...opts,
  });
}
// 米字格 practice grid, like a Chinese exercise book
const GUIDES = `<svg class="guides" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
  <g fill="none" stroke="var(--rule)" stroke-width="1" vector-effect="non-scaling-stroke">
  <path d="M50 0V100M0 50H100" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
  <path d="M0 0L100 100M100 0L0 100" stroke-dasharray="1 4" vector-effect="non-scaling-stroke"/></g></svg>`;

/* ---------- breakdown rendering ---------- */
const ROLE_LABEL = { meaning: "meaning", sound: "sound", picture: "picture", "stand-in": "stand-in" };
function formulaHTML(ch, clickable = true) {
  const info = CHARS[ch];
  if (!info || !info.parts.length) return "";
  const tag = clickable ? "button" : "div";
  return `<div class="formula">${info.parts.map((p, i) => `${i ? '<span class="op">+</span>' : ""}
    <${tag} class="part r-${p.role}" ${clickable ? `data-part="${esc(p.c)}"` : ""}>
      <span class="han">${esc(p.c)}</span><span class="m">${esc(p.m)}</span><span class="role">${ROLE_LABEL[p.role]}</span>
    </${tag}>`).join("")}<span class="op">=</span>
    <div class="part"><span class="han">${esc(ch)}</span><span class="m">${esc(info.en)}</span><span class="role">${esc(info.py)}</span></div></div>`;
}
const typeTag = (t) => { const f = FORMATION[t]; return f ? `<span class="typetag"><span class="han">${f.zh}</span>${f.en}</span>` : ""; };
function compactBreakdown(word) {
  return chars(word.hanzi).filter((c, i, a) => a.indexOf(c) === i).map((c) => {
    const info = CHARS[c];
    if (!info) return `<div class="muted"><span class="han">${esc(c)}</span> · breakdown not added yet</div>`;
    const f = info.parts.length ? info.parts.map((p) => `<span class="han">${esc(p.c)}</span> ${esc(p.m)}`).join(" + ") : FORMATION[info.type].en.toLowerCase() + ": " + esc(info.story.split(". ")[0]);
    return `<div><span class="han" style="font-size:20px">${esc(c)}</span> = ${f}</div>`;
  }).join("");
}

/* ---------- app state + navigation ---------- */
const S = { view: "study", param: null, history: [], session: null };
function go(view, param = null, push = true) {
  if (push) S.history.push([S.view, S.param]);
  if (S.view === "session" && !push && view !== "session") S.session = null;
  S.view = view; S.param = param;
  render(); window.scrollTo(0, 0);
}
function back() { const [v, p] = S.history.pop() || ["study", null]; go(v, p, false); }

function render() {
  $$("#tabs button").forEach((b) => b.toggleAttribute("aria-current", false));
  const tab = { study: "study", session: "study", library: "library", vocab: "vocab", radicals: "radicals", part: "radicals" }[S.view];
  const cur = $(`#tabs button[data-view="${tab}"]`); if (cur) cur.setAttribute("aria-current", "page");
  const app = $("#app");
  ({ study: viewStudy, library: viewLibrary, vocab: viewVocab, detail: viewDetail, radicals: viewRadicals, part: viewPart, session: viewSession })[S.view](app);
}

/* ---------- STUDY (home) ---------- */
const DIRS = [
  { id: "audio-hanzi", from: "audio", to: "hanzi", label: "Sound → Character" },
  { id: "pinyin-hanzi", from: "pinyin", to: "hanzi", label: "Pinyin → Character" },
  { id: "en-hanzi", from: "en", to: "hanzi", label: "English → Character" },
  { id: "en-pinyin", from: "en", to: "pinyin", label: "English → Pinyin" },
  { id: "hanzi-en", from: "hanzi", to: "en", label: "Character → English" },
  { id: "hanzi-pinyin", from: "hanzi", to: "pinyin", label: "Character → Pinyin" },
  { id: "audio-en", from: "audio", to: "en", label: "Sound → English" },
  { id: "mixed", label: "Mixed directions" },
];
function viewStudy(app) {
  const fs = folders();
  const sc = liveScope();
  const n = scopeWords().length;
  const st = settings();
  app.innerHTML = `
  <section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">WHAT TO STUDY</h1><span class="muted">${n} word${n === 1 ? "" : "s"} selected</span></div>
    <div class="row" id="scope">
      <button class="chip" data-folder="" aria-pressed="${!sc.length}">All folders<span class="n">${allWords().length}</span></button>
      ${[...fs].map(([f, ws]) => `<button class="chip" data-folder="${esc(f)}" aria-pressed="${sc.includes(f)}">${esc(f)}<span class="n">${ws.length}</span></button>`).join("")}
    </div>
    <div class="row">
      <label class="field">Questions per round
        <select id="len">${[10, 20, 40, 0].map((v) => `<option value="${v}" ${st.len === v ? "selected" : ""}>${v || "Endless"}</option>`).join("")}</select>
      </label>
    </div>
  </section>
  <section class="block">
    <div class="eyebrow">Practice</div>
    <div class="modes">
      <button class="mode featured" data-mode="mix"><span class="glyph">乱</span><span class="t">Random mix</span><span class="d">Every exercise type, shuffled across your selection. Weak words come up more.</span></button>
      <button class="mode" data-mode="flash"><span class="glyph">卡</span><span class="t">Flashcards</span><span class="d">Flip, then mark Again or Know it.</span></button>
      <button class="mode" data-mode="mc"><span class="glyph">选</span><span class="t">ABC questions</span><span class="d">Pick one of four. Choose a direction below.</span></button>
      <button class="mode" data-mode="write"><span class="glyph">写</span><span class="t">Write it</span><span class="d">Hear or read a word, draw the strokes in a 米字格 grid.</span></button>
      <button class="mode" data-mode="type"><span class="glyph">拼</span><span class="t">Type pinyin</span><span class="d">See, hear or read the meaning; type the pinyin with tones.</span></button>
      <button class="mode" data-mode="build"><span class="glyph">部</span><span class="t">Radical builder</span><span class="d">Assemble characters from parts, name each radical, find the sound part.</span></button>
    </div>
  </section>
  <section class="block">
    <div class="eyebrow">Options</div>
    <div class="form-grid">
      <label class="field">ABC direction
        <select id="dir">${DIRS.map((d) => `<option value="${d.id}" ${st.dir === d.id ? "selected" : ""}>${d.label}</option>`).join("")}</select>
      </label>
      <label class="field">Flashcard front
        <select id="front">${[["hanzi", "Character"], ["pinyin", "Pinyin"], ["en", "English"], ["audio", "Sound"], ["mixed", "Mixed"]].map(([v, l]) => `<option value="${v}" ${st.front === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field">Write prompt
        <select id="wprompt">${[["mixed", "Mixed"], ["audio", "Sound"], ["pinyin", "Pinyin"], ["en", "English"]].map(([v, l]) => `<option value="${v}" ${st.wprompt === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field">Type-pinyin prompt
        <select id="tprompt">${[["mixed", "Mixed"], ["hanzi", "Character"], ["audio", "Sound"], ["en", "English"]].map(([v, l]) => `<option value="${v}" ${st.tprompt === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
    </div>
    <p class="muted hide-sm" style="margin:0;font-size:13px">Keys: <kbd>1</kbd>–<kbd>4</kbd> answer · <kbd>Enter</kbd> next · <kbd>Space</kbd> flip card</p>
  </section>
  <section class="block">
    <div class="eyebrow">Settings</div>
    <div class="form-grid">
      <label class="field">Voice speed
        <select id="rate">${[[0.6, "Slow"], [0.8, "Learner"], [1, "Natural"]].map(([v, l]) => `<option value="${v}" ${st.rate === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="field">Test voice<div>${speakBtn("你好，我是学生。")}</div></div>
    </div>
    <p class="note">${Store.synced ? "Progress syncs to your claude.ai account, so phone and laptop stay in step." : "Progress is saved in this browser only."} ${zhVoice ? "" : "No Mandarin voice was found yet; install one in your system's speech settings if playback sounds wrong."}</p>
    <div><button class="btn ghost" id="reset">Reset all progress</button></div>
  </section>`;
  $("#rate", app).onchange = (e) => { st.rate = +e.target.value; Store.save(); };
  const reset = $("#reset", app);
  reset.onclick = () => {
    if (!reset.dataset.armed) { reset.dataset.armed = 1; reset.textContent = "Tap again to reset"; return; }
    Store.data.progress = {}; Store.save(); toast("Progress reset."); render();
  };

  $("#scope", app).onclick = (e) => {
    const b = e.target.closest("[data-folder]"); if (!b) return;
    const f = b.dataset.folder;
    let next = f ? (sc.includes(f) ? sc.filter((x) => x !== f) : [...sc, f]) : [];
    if (next.length === fs.size) next = [];
    st.scope = next; Store.save(); render();
  };
  for (const id of ["len", "dir", "front", "wprompt", "tprompt"]) {
    $("#" + id, app).onchange = (e) => { st[id] = id === "len" ? +e.target.value : e.target.value; Store.save(); };
  }
  $$(".mode", app).forEach((b) => (b.onclick = () => startSession(b.dataset.mode)));
}

/* ---------- SESSION ---------- */
function startSession(mode) {
  const pool = scopeWords();
  if (!pool.length) return toast("No words in this selection yet.");
  if (mode === "build" && !buildableChars(pool).length) return toast("These words have no radical breakdowns yet.");
  if (mode === "write" && !window.HanziWriter) return toast("The stroke engine didn't load. Check your connection.");
  const len = settings().len;
  S.session = { mode, pool, n: 0, len, results: [], recent: [], q: null };
  if (mode === "flash") {
    const deck = []; const size = len ? Math.min(len, pool.length) : pool.length;
    const pickFrom = [...pool];
    while (deck.length < size) { const w = weightedPick(pickFrom); deck.push(w); pickFrom.splice(pickFrom.indexOf(w), 1); }
    S.session.deck = deck; S.session.len = 0; // flash rounds end when the deck is empty
  }
  go("session");
  nextQuestion();
}

function nextQuestion() {
  const s = S.session; if (!s) return;
  if (s.mode === "flash") { if (!s.deck.length) return showSummary(); }
  else if (s.len && s.n >= s.len) return showSummary();
  s.n++;
  const word = s.mode === "flash" ? s.deck[0] : weightedPick(s.pool, s.recent);
  s.recent = [word.hanzi, ...s.recent].slice(0, Math.min(4, Math.floor(s.pool.length / 2)));
  let kind = s.mode;
  if (s.mode === "mix") {
    const kinds = ["mc", "mc", "mc", "type", "build", "build", "flash"];
    if (window.HanziWriter) kinds.push("write", "write");
    kind = pick(kinds);
    if (kind === "build" && !buildableChars(s.pool).length) kind = "mc";
  }
  s.q = { kind, word, done: false };
  viewSession($("#app"));
}

function sessionHead() {
  const s = S.session;
  const total = s.mode === "flash" ? s.results.length + s.deck.length : s.len;
  const done = s.results.length;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return `<div class="study-head">
    <button class="btn ghost" id="quit" style="padding:6px 10px">✕ End</button>
    <div class="meter" role="progressbar" aria-valuenow="${done}" aria-valuemax="${total || done}"><i style="width:${total ? pct : 100}%"></i></div>
    <span class="pix">${done}${total ? "/" + total : ""}</span></div><div id="q"></div>`;
}

function viewSession(app) {
  const s = S.session;
  if (!s) return go("study", null, false);
  if (s.summary) return renderSummary(app);
  if (!s.q) return;
  if (s.q.done) return nextQuestion(); // back from Details: move on
  app.innerHTML = sessionHead();
  $("#quit", app).onclick = () => (s.results.length ? showSummary() : go("study", null, false));
  const el = $("#q", app);
  ({ mc: qMC, flash: qFlash, type: qType, write: qWrite, build: qBuild })[s.q.kind](el, s.q);
}

// Shared result handling
function finish(el, ok, { word, label = "", extra = "", keyWord } = {}) {
  const s = S.session; if (!s || s.q.done) return;
  s.q.done = true;
  const w = word || s.q.word;
  grade(keyWord || w.hanzi, ok);
  s.results.push({ word: w, ok, kind: s.q.kind });
  const fb = document.createElement("div");
  fb.className = "feedback " + (ok ? "ok" : "bad");
  fb.innerHTML = `<div class="verdict">${ok ? "✓ CORRECT" : "✗ " + (label || "NOT QUITE")}</div>
    <div class="ans"><span class="han">${esc(w.hanzi)}</span><span style="font-size:18px">${esc(w.pinyin)}</span><span>${esc(w.en)}</span></div>
    ${extra}
    <div style="font-size:13px;display:grid;gap:2px">${compactBreakdown(w)}</div>`;
  const act = document.createElement("div");
  act.className = "actions";
  act.innerHTML = `${speakBtn(w.hanzi)}<button class="btn ghost" data-open="${esc(w.hanzi)}">Details</button><button class="btn solid" id="next">Next →</button>`;
  el.append(fb, act);
  $("#next").focus({ preventScroll: true });
  $("#next").onclick = nextQuestion;
  fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function promptHTML(word, from, ask) {
  const body = {
    hanzi: `<div class="big-han">${esc(word.hanzi)}</div>`,
    pinyin: `<div class="big-py">${esc(word.pinyin)}</div>`,
    en: `<div class="big-en">${esc(word.en)}</div>`,
    audio: speakBtn(word.hanzi, "huge"),
  }[from];
  return `<div class="prompt-card"><span class="ask">${esc(ask)}</span>${body}</div>`;
}
const FIELD = { hanzi: "hanzi", pinyin: "pinyin", en: "en" };
const ASK_TO = { hanzi: "Which character?", pinyin: "Which pinyin?", en: "What does it mean?" };

/* ABC */
function qMC(el, q) {
  let dir = DIRS.find((d) => d.id === (S.session.mode === "mc" ? settings().dir : "mixed")) || DIRS[0];
  if (dir.id === "mixed") dir = q.dir || (q.dir = pick(DIRS.slice(0, -1)));
  const { word } = q; const pool = S.session.pool;
  const correct = word[FIELD[dir.to]];
  const seen = new Set([norm(correct)]); const out = [];
  if (dir.to === "pinyin") for (const v of shuffle(toneVariants(correct)).slice(0, Math.random() < 0.5 ? 1 : 2)) { out.push(v); seen.add(norm(v)); }
  const len = [...word.hanzi].length;
  const others = (arr) => shuffle(arr.filter((w) => w.hanzi !== word.hanzi)).sort((a, b) => dir.to === "hanzi" ? Math.abs([...a.hanzi].length - len) - Math.abs([...b.hanzi].length - len) : 0);
  for (const w of [...others(pool), ...others(allWords())]) {
    if (out.length >= 3) break;
    const v = w[FIELD[dir.to]]; if (seen.has(norm(v))) continue;
    if (dir.from !== "audio" && norm(w[FIELD[dir.from]]) === norm(word[FIELD[dir.from]])) continue;
    seen.add(norm(v)); out.push(v);
  }
  const opts = shuffle([correct, ...out]);
  el.innerHTML = promptHTML(word, dir.from, `${dir.label} · ${ASK_TO[dir.to]}`) +
    `<div class="options">${opts.map((v, i) => `<button class="opt" data-i="${i}"><span class="key">${"ABCD"[i]}</span><span class="val ${dir.to === "hanzi" ? "han" : ""}">${esc(v)}</span></button>`).join("")}</div>`;
  if (dir.from === "audio") speak(word.hanzi);
  $$(".opt", el).forEach((b) => (b.onclick = () => {
    if (q.done) return;
    const v = opts[+b.dataset.i]; const ok = v === correct;
    $$(".opt", el).forEach((x) => { x.disabled = true; if (opts[+x.dataset.i] === correct) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    speak(word.hanzi);
    finish(el, ok, { label: dir.to === "pinyin" && pinyinVerdict(v, correct) === "tones" ? "WRONG TONE" : "" });
  }));
}

/* Flashcards */
function qFlash(el, q) {
  const { word } = q;
  let front = settings().front || "hanzi";
  if (S.session.mode !== "flash" || front === "mixed") front = q.front || (q.front = pick(["hanzi", "pinyin", "en", "audio"]));
  const backBody = `<div class="big-han" style="font-size:clamp(56px,14vw,96px)">${esc(word.hanzi)}</div>
    <div class="big-py" style="font-size:24px">${esc(word.pinyin)}</div><div class="big-en" style="font-size:18px">${esc(word.en)}</div>
    <div style="font-size:13px;display:grid;gap:2px;text-align:left">${compactBreakdown(word)}</div>`;
  el.innerHTML = `<div class="flash"><div class="card" id="card" tabindex="0" aria-label="Flashcard. Press space to flip.">
      <div class="face front">${promptHTML(word, front, "Recall it · tap to flip")}</div>
      <div class="face back"><div class="prompt-card">${backBody}</div></div></div></div>
    <div class="actions" id="grade" hidden>
      <button class="btn" data-g="0">✗ Again</button><button class="btn solid" data-g="1">✓ Know it</button></div>
    <div class="actions" id="flipbar"><button class="btn solid" id="flip">Flip card</button></div>`;
  const card = $("#card", el);
  // match the card height to the taller face
  requestAnimationFrame(() => { card.style.minHeight = Math.max(300, ...$$(".face .prompt-card", el).map((f) => f.scrollHeight)) + "px"; });
  if (front === "audio") speak(word.hanzi);
  const flip = () => {
    if (q.flipped) return; q.flipped = true;
    card.classList.add("flipped"); $("#grade", el).hidden = false; $("#flipbar", el).hidden = true;
    if (front !== "audio") speak(word.hanzi);
  };
  q.flip = flip;
  card.onclick = (e) => { if (!e.target.closest("[data-say]")) flip(); };
  $("#flip", el).onclick = flip;
  $$("#grade [data-g]", el).forEach((b) => (b.onclick = () => {
    const ok = b.dataset.g === "1";
    const s = S.session;
    if (s.mode === "flash") {
      grade(word.hanzi, ok);
      s.results.push({ word, ok, kind: "flash" });
      s.deck.shift();
      if (!ok) s.deck.splice(Math.min(3, s.deck.length), 0, word); // see it again soon
      q.done = true; nextQuestion();
    } else {
      $("#grade", el).hidden = true; finish(el, ok, { label: "MARKED AGAIN" });
    }
  }));
}

/* Type pinyin */
function qType(el, q) {
  const { word } = q;
  let from = settings().tprompt || "mixed";
  if (S.session.mode !== "type" || from === "mixed") from = q.from || (q.from = pick(["hanzi", "audio", "en"]));
  el.innerHTML = promptHTML(word, from, "Type the pinyin") +
    `<form class="type-in" id="tf" autocomplete="off"><input type="text" id="tin" inputmode="latin" autocapitalize="off" spellcheck="false" placeholder="e.g. ni3 hao3" aria-label="Pinyin answer"><button class="btn solid">Check</button></form>
     <p class="muted" style="font-size:13px;margin:8px 0 0">Tone numbers <b>1–4</b> after each syllable (neutral: no number). Use <b>v</b> for ü. Tone marks work too.</p>
     <div class="row" style="margin-top:8px"><button class="btn ghost" id="idk">I don't know</button></div>`;
  if (from === "audio") speak(word.hanzi);
  const input = $("#tin", el);
  if (matchMedia("(hover: hover)").matches) input.focus();
  $("#tf", el).onsubmit = (e) => {
    e.preventDefault(); if (q.done) return;
    const v = input.value.trim(); if (!v) return;
    const verdict = pinyinVerdict(v, word.pinyin);
    if (verdict === "tones" && !q.toneHint) { q.toneHint = true; toast("Right syllables. Check the tones and try once more."); input.select(); return; }
    input.disabled = true; speak(word.hanzi);
    finish(el, verdict === "right", { label: verdict === "tones" ? "WRONG TONE" : "", extra: verdict === "right" ? "" : `<div>You typed: <b>${esc(v)}</b></div>` });
  };
  $("#idk", el).onclick = () => { if (q.done) return; input.disabled = true; speak(word.hanzi); finish(el, false, { label: "HERE IT IS" }); };
}

/* Write it */
function qWrite(el, q) {
  const { word } = q;
  let from = settings().wprompt || "mixed";
  if (S.session.mode !== "write" || from === "mixed") from = q.from || (q.from = pick(["audio", "pinyin", "en"]));
  const cs = chars(word.hanzi);
  q.idx = 0; q.mistakes = 0; q.revealed = false;
  el.innerHTML = promptHTML(word, from, `Write it · ${cs.length} character${cs.length > 1 ? "s" : ""}`) +
    `<div class="write-area">
      <div class="write-slots" id="slots">${cs.map((c, i) => `<span class="${i === 0 ? "cur" : ""}">${i === 0 ? "?" : ""}</span>`).join("")}</div>
      <div class="grid-box" id="gb">${GUIDES}<div class="hw" id="hw"></div></div>
      <div class="row" style="justify-content:center">
        <button class="btn ghost" id="hint">Show outline</button>
        <button class="btn ghost" id="show">Show me</button>
        <button class="btn ghost" id="skip">I don't know</button>
      </div>
      <p class="muted" style="font-size:12px;margin:0">After 3 misses on a stroke the grid flashes a hint.</p></div>`;
  if (from === "audio") speak(word.hanzi);
  const slots = $$("#slots span", el);
  const startChar = () => {
    const hw = $("#hw", el); hw.innerHTML = "";
    const ch = cs[q.idx];
    const writer = makeWriter(hw, ch, { showCharacter: false, showOutline: false });
    q.writer = writer;
    writer.quiz({
      showHintAfterMisses: 3, leniency: 1.2,
      onMistake: () => q.mistakes++,
      onComplete: () => {
        slots[q.idx].textContent = ch; slots[q.idx].classList.remove("cur");
        q.idx++;
        if (q.idx < cs.length) { slots[q.idx].classList.add("cur"); slots[q.idx].textContent = "?"; setTimeout(startChar, 450); }
        else done();
      },
    });
  };
  const done = () => {
    const ok = !q.revealed && q.mistakes <= cs.length * 3;
    speak(word.hanzi);
    $$(".write-area .row button", el).forEach((b) => (b.disabled = true));
    finish(el, ok, { label: q.revealed ? "REVEALED" : "TOO MANY MISSES", extra: `<div>${q.mistakes} stroke mistake${q.mistakes === 1 ? "" : "s"}</div>` });
  };
  $("#hint", el).onclick = () => { q.writer?.showOutline(); q.mistakes += 2; };
  $("#show", el).onclick = () => {
    q.revealed = true; const w = q.writer; if (!w) return;
    w.cancelQuiz(); w.showCharacter(); w.animateCharacter({ onComplete: () => { w.hideCharacter(); w.showOutline(); startCharKeep(); } });
  };
  const startCharKeep = () => { // after a demo, practise the same character with its outline
    const w = q.writer;
    w.quiz({ showHintAfterMisses: 2, onMistake: () => q.mistakes++, onComplete: () => {
      slots[q.idx].textContent = cs[q.idx]; slots[q.idx].classList.remove("cur"); q.idx++;
      if (q.idx < cs.length) { slots[q.idx].classList.add("cur"); slots[q.idx].textContent = "?"; setTimeout(startChar, 450); } else done();
    } });
  };
  $("#skip", el).onclick = () => {
    if (q.done) return; q.revealed = true; q.writer?.cancelQuiz();
    $$(".write-area .row button", el).forEach((b) => (b.disabled = true));
    const hw = $("#hw", el); hw.innerHTML = "";
    const w = makeWriter(hw, cs[q.idx], { showCharacter: false, showOutline: true });
    w && w.loopCharacterAnimation();
    finish(el, false, { label: "HERE IT IS" });
  };
  startChar();
}

/* Radical builder */
function buildableChars(pool) {
  const s = new Set(); pool.forEach((w) => chars(w.hanzi).forEach((c) => CHARS[c] && s.add(c))); return [...s];
}
function qBuild(el, q) {
  const pool = S.session.pool;
  const avail = buildableChars(pool);
  // choose a character from this word if possible
  let cand = chars(q.word.hanzi).filter((c) => CHARS[c]);
  if (!cand.length) cand = avail;
  const ch = q.ch || (q.ch = pick(cand));
  const info = CHARS[ch];
  const useful = info.parts.filter((p) => p.role !== "stand-in");
  const kinds = ["formation"];
  if (info.parts.length >= 2) kinds.push("assemble", "assemble", "meanings");
  if (useful.length) kinds.push("part", "part");
  if (info.type === "phono" && info.parts.some((p) => p.role === "sound")) kinds.push("sound", "sound");
  const kind = q.bkind || (q.bkind = pick(kinds));
  const word = wordForChar(ch) || q.word;
  const allC = learnedChars().filter((c) => CHARS[c]);
  const otherChars = shuffle(allC.filter((c) => c !== ch))
    .sort((a, b) => sharesPart(b, ch) - sharesPart(a, ch)); // look-alikes first
  let ask, body, opts, correct, isHan = false;

  if (kind === "assemble" || kind === "meanings") {
    ask = kind === "assemble" ? "Which character do these parts build?" : "Which character combines these meanings?";
    body = kind === "assemble"
      ? `<div class="formula" style="justify-content:center">${info.parts.map((p, i) => `${i ? '<span class="op">+</span>' : ""}<div class="part r-${p.role}"><span class="han">${esc(p.c)}</span><span class="m">${esc(p.m)}</span><span class="role">${p.role}</span></div>`).join("")}<span class="op">= ?</span></div>`
      : `<div class="big-en">${info.parts.map((p) => p.role === "sound" ? `[sound: ${esc(p.m)}]` : esc(p.m)).join(" + ")}</div>`;
    correct = ch; isHan = true;
    opts = shuffle([ch, ...otherChars.slice(0, 3)]);
  } else if (kind === "part") {
    const p = q.part || (q.part = pick(useful));
    ask = `In ${ch}, what does ${p.c} stand for?`;
    body = `<div class="big-han">${esc(ch)}</div><div class="formula" style="justify-content:center"><div class="part"><span class="han">${esc(p.c)}</span><span class="m">?</span></div></div>`;
    correct = p.m;
    const pool2 = shuffle([...new Set(Object.values(CHARS).flatMap((c) => c.parts.map((x) => x.m)).concat(Object.values(PARTS).map((x) => x.en)))])
      .filter((m) => norm(m) !== norm(correct) && !norm(m).includes(norm(correct)) && !norm(correct).includes(norm(m)));
    opts = shuffle([correct, ...pool2.slice(0, 3)]);
  } else if (kind === "sound") {
    ask = `Which part of ${ch} (${info.py}) gives the sound?`;
    body = `<div class="big-han">${esc(ch)}</div>`;
    const sp = info.parts.find((p) => p.role === "sound");
    correct = sp.c; isHan = true;
    const extras = shuffle(Object.keys(PARTS).filter((k) => !info.parts.some((p) => p.c === k)));
    opts = shuffle([...new Set([...info.parts.map((p) => p.c), ...extras])].slice(0, 4));
    if (!opts.includes(correct)) opts[0] = correct;
  } else {
    ask = `How was ${ch} formed?`;
    body = `<div class="big-han">${esc(ch)}</div>`;
    correct = info.type;
    opts = shuffle([info.type, ...shuffle(Object.keys(FORMATION).filter((t) => t !== info.type)).slice(0, 3)]);
  }
  const label = (v) => kind === "formation" ? `${FORMATION[v].en} <span class="han muted">${FORMATION[v].zh}</span>` : esc(v);
  el.innerHTML = `<div class="prompt-card"><span class="ask">Radical builder · ${esc(ask)}</span>${body}</div>
    <div class="options">${opts.map((v, i) => `<button class="opt" data-i="${i}"><span class="key">${"ABCD"[i]}</span><span class="val ${isHan ? "han" : ""}">${label(v)}</span></button>`).join("")}</div>`;
  $$(".opt", el).forEach((b) => (b.onclick = () => {
    if (q.done) return;
    const v = opts[+b.dataset.i]; const ok = v === correct;
    $$(".opt", el).forEach((x) => { x.disabled = true; if (opts[+x.dataset.i] === correct) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    speak(ch);
    const extra = `<div style="color:var(--ink);background:var(--paper);padding:10px;border:2px solid var(--ink);display:grid;gap:8px">
      <div>${typeTag(info.type)}</div>${formulaHTML(ch, false)}<p class="story">${esc(info.story)}</p></div>`;
    finish(el, ok, { word, extra });
  }));
}
function sharesPart(a, b) {
  const A = CHARS[a]?.parts.map((p) => p.c) || [], B = CHARS[b]?.parts.map((p) => p.c) || [];
  return A.some((x) => B.includes(x)) ? 1 : 0;
}

/* Summary */
function showSummary() { if (!S.session) return; S.session.summary = true; viewSession($("#app")); }
function renderSummary(app) {
  const s = S.session; const r = s.results;
  const right = r.filter((x) => x.ok).length;
  const missed = [...new Map(r.filter((x) => !x.ok).map((x) => [x.word.hanzi, x.word])).values()];
  app.innerHTML = `<section class="block">
    <div class="eyebrow">Round complete</div>
    <div class="row" style="align-items:flex-end;gap:16px"><span class="score">${right}/${r.length}</span><span class="muted">${r.length ? Math.round((right / r.length) * 100) : 0}% correct</span></div>
    <div class="actions"><button class="btn solid" id="again">Go again</button><button class="btn" id="home">Change mode</button></div>
  </section>
  ${missed.length ? `<section class="block"><div class="eyebrow">Review these</div><div class="missed">${missed.map(wordItem).join("")}</div></section>` : ""}`;
  $("#again", app).onclick = () => startSession(s.mode);
  $("#home", app).onclick = () => go("study", null, false);
}

/* ---------- LIBRARY ---------- */
function wordItem(w) {
  return `<button class="witem" data-open="${esc(w.hanzi)}"><span class="han">${esc(w.hanzi)}</span>
    <span class="info"><div>${esc(w.pinyin)}</div><div class="en">${esc(w.en)}</div></span>${dots(w.hanzi)}</button>`;
}
// First words of a folder, at most 5 characters in total
function folderPreview(ws) {
  const out = []; let n = 0;
  for (const w of ws) { const len = [...w.hanzi].length; if (n + len > 5) break; out.push(w.hanzi); n += len; }
  return out.join(" ") + (out.length < ws.length ? " …" : "");
}
// Folders grouped into islands; folders matching no island land in "My words" (off the route)
function islands() {
  const out = ISLANDS.map((i) => ({ ...i, folders: [] }));
  const rest = { name: "My words", mark: "我", note: "Folders you added", tone: 4, side: true, folders: [] };
  for (const [f, ws] of folders()) (out.find((i) => i.match.test(f)) || rest).folders.push([f, ws]);
  return [...out, rest].filter((i) => i.folders.length);
}
// Level from the LEVELS rubric: mastery % = total boxes / (5 × words)
function islandLevel(ws) {
  const ps = ws.map((w) => prog(w.hanzi));
  const pct = ws.length ? Math.round((ps.reduce((a, p) => a + p.b, 0) / (5 * ws.length)) * 100) : 0;
  let lv = 0;
  if (ps.some((p) => p.c + p.w > 0)) LEVELS.forEach((L, i) => { if (L.at !== null && pct >= L.at) lv = i; });
  return { lv, pct, next: LEVELS[lv + 1] };
}
function viewLibrary(app) {
  const q = S.libQuery || "";
  const fs = folders();
  const qb = analysePinyin(q).base;
  const match = (w) => !q || norm(w.hanzi).includes(norm(q)) || norm(w.en).includes(norm(q)) || (qb && analysePinyin(w.pinyin).base.includes(qb));
  const folderHTML = ([f, ws], isl) => {
    const hits = ws.filter(match); if (!hits.length) return "";
    return `<details class="folder" ${q || fs.size === 1 ? "open" : ""}><summary><span class="name">${esc(isl.prefix && f.startsWith(isl.prefix) ? f.slice(isl.prefix.length) : f)}</span><span class="preview">${esc(folderPreview(ws))}</span><span class="muted count">${ws.length}</span></summary>
      <div class="wlist">${hits.map(wordItem).join("")}
      <div style="padding:10px 14px;border-top:2px solid var(--ink)"><button class="btn" data-studyfolder="${esc(f)}">Study this folder</button></div></div></details>`;
  };
  const isls = islands().map((isl) => ({ ...isl, words: isl.folders.flatMap(([, ws]) => ws) }));
  isls.forEach((isl) => (isl.level = islandLevel(isl.words)));
  const route = isls.filter((i) => !i.side);
  const here = route.find((i) => i.level.lv < 3) || route[route.length - 1];
  const blocks = isls.map((isl, n) => {
    const body = isl.folders.map((fw) => folderHTML(fw, isl)).join(""); if (!body) return "";
    const { lv, pct, next } = isl.level, L = LEVELS[lv];
    const stop = route.indexOf(isl) + 1;
    const goal = next ? (lv === 0 ? "Practise any word to land" : `${next.en} at ${next.at}%`) : "Fully mastered";
    return `${n && !isl.side ? `<div class="route" aria-hidden="true"><span>Route · island ${stop}</span></div>` : n ? `<div class="route" aria-hidden="true"><span>Side island</span></div>` : ""}
      <section class="island tone-${isl.tone}" style="--lvl:${lv}" aria-labelledby="isl-${n}">
        <div class="island-label"><span class="han island-mark" aria-hidden="true">${esc(isl.mark)}</span>
          <div class="island-title"><div class="island-kicker">${isl.side ? "Side island" : `Island ${stop}`}${isl === here ? '<span class="here">You are here</span>' : ""}</div>
            <h2 class="pix" id="isl-${n}">${esc(isl.name.toUpperCase())}</h2>
            <span class="island-note">${esc(isl.note)} · ${isl.folders.length} folder${isl.folders.length === 1 ? "" : "s"} · ${isl.words.length} words</span></div>
          <div class="island-level" title="${esc(L.desc)}"><span class="lv">LV ${lv}</span><span class="lvname"><span class="han">${L.zh}</span>${L.en}</span></div></div>
        <div class="island-progress"><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemax="100" aria-label="${esc(isl.name)} mastery"><i style="width:${pct}%"></i>${next && next.at ? `<b style="left:${next.at}%"></b>` : ""}</div>
          <span>${pct}% mastered · ${goal}</span></div>
        <div class="island-folders">${body}</div>
        <button class="island-study" data-studyisland="${n}">Study island →</button>
      </section>`;
  }).join("");
  app.innerHTML = `<section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">ISLANDS</h1><span class="muted">${allWords().length} words · ${learnedChars().length} characters</span></div>
    <input type="text" class="search" id="lq" placeholder="Search 字, pinyin or English" value="${esc(q)}" aria-label="Search words">
    <details class="rubric"><summary>How island levels work</summary><div class="rubric-body">
      <p style="margin:0">Every word has 5 mastery boxes: a correct answer fills one, a miss empties one. An island's mastery is how many of its boxes are filled. Follow the route: settle an island (LV 3) before moving on to the next.</p>
      <table>${LEVELS.map((L, i) => `<tr><td>LV ${i}</td><td><span class="han">${L.zh}</span> ${L.py}</td><td><b>${L.en}</b> · ${L.at === null ? "start" : L.at === 0 ? "first practice" : L.at + "%"}<br><span class="muted">${L.desc}</span></td></tr>`).join("")}</table>
    </div></details>
    <div class="islands" id="flist">${blocks}</div></section>`;
  const inp = $("#lq", app);
  inp.oninput = () => { S.libQuery = inp.value; const pos = inp.selectionStart; render(); const n = $("#lq"); n.focus(); n.setSelectionRange(pos, pos); };
  $$("[data-studyfolder]", app).forEach((b) => (b.onclick = () => { settings().scope = [b.dataset.studyfolder]; Store.save(); go("study"); }));
  $$("[data-studyisland]", app).forEach((b) => (b.onclick = () => { settings().scope = isls[+b.dataset.studyisland].folders.map(([f]) => f); Store.save(); go("study"); }));
}

function viewDetail(app) {
  const w = wordByHanzi(S.param);
  if (!w) return go("library", null, false);
  const cs = chars(w.hanzi).filter((c, i, a) => a.indexOf(c) === i);
  const p = prog(w.hanzi);
  app.innerHTML = `<section class="block">
    <div><button class="btn ghost" id="back" style="padding:6px 10px">← Back</button></div>
    <div class="detail-hero"><div class="big-han">${esc(w.hanzi)}</div>
      <div style="display:grid;gap:6px;min-width:0"><div class="big-py">${esc(w.pinyin)}</div><div class="big-en">${esc(w.en)}</div>
      <div class="row">${speakBtn(w.hanzi)}</div>
      <div class="muted" style="font-size:13px">${esc(w.folder)} · ${dots(w.hanzi)} · ${p.c} right / ${p.w} wrong</div></div></div>
  </section>
  <section class="block">
    <div class="eyebrow">How ${cs.length > 1 ? "each character is" : "it is"} built</div>
    ${cs.map((c) => {
      const info = CHARS[c];
      const rel = relatedChars(c);
      return `<article class="charblock">
        <div class="stage"><div class="grid-box" data-writer="${esc(c)}">${GUIDES}<div class="hw"></div></div>
          <button class="btn ghost" data-anim="${esc(c)}" style="padding:6px 10px;font-size:12px">▶ Strokes</button></div>
        <div class="body">${info ? `
          <div class="row"><span class="han" style="font-size:28px">${esc(c)}</span><span>${esc(info.py)} · ${esc(info.en)}</span>${typeTag(info.type)}${info.trad ? `<span class="muted">traditional <span class="han">${esc(info.trad)}</span></span>` : ""}</div>
          ${formulaHTML(c)}
          <p class="story">${esc(info.story)}</p>
          <p class="muted" style="margin:0;font-size:12px">${esc(FORMATION[info.type].zh)} ${esc(FORMATION[info.type].py)}: ${esc(FORMATION[info.type].desc)}</p>
          ${rel.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Shares parts with</div><div class="related">${rel.map((r) => `<button data-char="${esc(r)}" title="${esc(CHARS[r].en)}">${esc(r)}</button>`).join("")}</div></div>` : ""}`
        : `<div class="row"><span class="han" style="font-size:28px">${esc(c)}</span></div><p class="note">No radical breakdown for this character yet. Send the list to Claude to have it added.</p>`}
        </div></article>`;
    }).join("")}
  </section>
  ${w.custom ? `<section class="block"><div><button class="btn ghost" id="del">Delete this word</button></div></section>` : ""}`;
  $("#back", app).onclick = back;
  const writers = {};
  $$("[data-writer]", app).forEach((box) => {
    const c = box.dataset.writer;
    const wr = makeWriter($(".hw", box), c, { showOutline: true });
    writers[c] = wr;
  });
  $$("[data-anim]", app).forEach((b) => (b.onclick = () => writers[b.dataset.anim]?.animateCharacter()));
  $$("[data-char]", app).forEach((b) => (b.onclick = () => { const t = wordForChar(b.dataset.char); if (t) go("detail", t.hanzi); }));
  const del = $("#del", app);
  if (del) del.onclick = () => {
    if (!del.dataset.armed) { del.dataset.armed = 1; del.textContent = "Tap again to delete"; return; }
    Store.data.custom = Store.data.custom.filter((x) => x.hanzi !== w.hanzi); Store.save(); toast(`Deleted ${w.hanzi}`); back();
  };
}

/* ---------- RADICALS ---------- */
// Formation group card: 5 characters when closed, every character with pinyin and meaning when open
function formationCard(k, f) {
  const cs = learnedChars().filter((c) => CHARS[c]?.type === k);
  const n = cs.length;
  if (S.openForm === k) return `<div class="form open" id="form-${k}">
    <div class="form-head"><span class="han zh">${f.zh}</span>
      <div class="form-title"><div class="en">${f.en}</div><div class="py">${f.py} · ${n} character${n === 1 ? "" : "s"}</div></div>
      <button class="form-toggle" data-form="${k}" aria-expanded="true">Close ▴</button></div>
    <p class="desc">${f.desc}</p>
    <div class="form-tiles">${cs.map((c) => `<button class="form-tile" data-char="${esc(c)}"><span class="han">${esc(c)}</span><span class="py">${esc(CHARS[c].py)}</span><span class="m">${esc(CHARS[c].en)}</span></button>`).join("")}</div>
  </div>`;
  return `<div class="form">
    <span class="han zh">${f.zh}</span><span class="en">${f.en}</span><span class="py">${f.py}</span>
    <span class="desc">${f.desc}</span>
    <div class="form-mini">${cs.slice(0, 5).map((c) => `<button data-char="${esc(c)}" title="${esc(CHARS[c].en)}">${esc(c)}</button>`).join("") || '<span class="muted">None yet</span>'}</div>
    ${n ? `<button class="form-toggle" data-form="${k}" aria-expanded="false">${n > 5 ? `+${n - 5} more · ` : ""}All ${n} ▾</button>` : ""}
  </div>`;
}
function viewRadicals(app) {
  const idx = partIndex();
  const keys = [...idx.keys()].filter((k) => partInfo(k)).sort((a, b) => idx.get(b).length - idx.get(a).length);
  app.innerHTML = `<section class="block">
    <h1 class="pix" style="font-size:34px">RADICALS &amp; PARTS</h1>
    <p class="story">Every character is built from smaller parts. A <b>meaning</b> part (solid label) hints at what the character is about. A <b>sound</b> part (dashed box) hints at how it is pronounced. Learn the parts once and new characters stop looking random.</p>
  </section>
  <section class="block">
    <div class="spread"><div class="eyebrow">Five ways characters are made</div><span class="muted" style="font-size:12px">Open a group to see all its characters</span></div>
    <div class="form-grid">${Object.entries(FORMATION).map(([k, f]) => formationCard(k, f)).join("")}</div>
  </section>
  <section class="block">
    <div class="spread"><div class="eyebrow">Parts in your characters</div><span class="muted">${keys.length}</span></div>
    <div class="rad-grid">${keys.map((k) => `<button class="rad" data-part="${esc(k)}">
      <div class="top"><span class="han">${esc(k)}</span><span class="muted">${esc(partInfo(k).py)}</span></div>
      <span class="en">${esc(partInfo(k).en)}</span><span class="in">${idx.get(k).map((x) => x.ch).join(" ") || "&nbsp;"}</span></button>`).join("")}</div>
  </section>`;
  $$("[data-form]", app).forEach((b) => (b.onclick = () => {
    const k = b.dataset.form;
    S.openForm = S.openForm === k ? null : k;
    render();
    const card = $(`#form-${k}`) || $(`[data-form="${k}"]`);
    card?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
  $$(".form [data-char]", app).forEach((b) => (b.onclick = () => { const t = wordForChar(b.dataset.char); if (t) go("detail", t.hanzi); }));
}
function viewPart(app) {
  const k = S.param; const info = partInfo(k);
  if (!info) return go("radicals", null, false);
  const list = partIndex().get(k) || [];
  app.innerHTML = `<section class="block">
    <div><button class="btn ghost" id="back" style="padding:6px 10px">← Back</button></div>
    <div class="detail-hero"><div class="big-han">${esc(k)}</div>
      <div style="display:grid;gap:6px"><div class="big-py">${esc(info.py)}</div><div class="big-en">${esc(info.en)}</div>
      ${info.from ? `<div class="muted">Short form of <span class="han" style="font-size:20px">${esc(info.from)}</span></div>` : ""}</div></div>
    <p class="story">${esc(info.note)}</p>
  </section>
  <section class="block">
    <div class="eyebrow">In your characters</div>
    ${list.length ? `<div class="missed">${list.map(({ ch, role }) => { const c = CHARS[ch]; return `<button class="witem" data-char="${esc(ch)}"><span class="han">${esc(ch)}</span>
      <span class="info"><div>${esc(c.py)} · ${esc(c.en)}</div><div class="en">${c.parts.map((p) => `${p.c} ${p.m}`).join(" + ")}</div></span><span class="typetag">${esc(role)}</span></button>`; }).join("")}</div>`
      : `<p class="muted">Not used inside any of your characters yet.</p>`}
    ${CHARS[k] && wordForChar(k) ? `<div><button class="btn" data-char="${esc(k)}">Open ${esc(k)} as a word</button></div>` : ""}
  </section>`;
  $("#back", app).onclick = back;
  $$("[data-char]", app).forEach((b) => (b.onclick = () => { const t = wordForChar(b.dataset.char); if (t) go("detail", t.hanzi); }));
}

/* ---------- VOCABULARY ---------- */
// Ranked lookup. Whole meanings beat whole words, which beat word starts:
// "I" finds 我 ("I, me") but not every gloss that merely contains the letter i.
const ARTICLE = /^(to|a|an|the)\s+/;
function glosses(en) {
  return String(en).split(/[,;/]/).map((g) => {
    const full = norm(g);
    const core = full.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(ARTICLE, "");
    return { core, full, words: core.split(/[^a-z']+/).filter(Boolean) };
  }).filter((g) => g.core || g.full);
}
function englishScore(w, q) {
  const qn = norm(q).replace(ARTICLE, ""); if (!qn) return 0;
  const qw = qn.split(/[^a-z']+/).filter(Boolean); if (!qw.length) return 0;
  const phrase = (words) => words.some((_, i) => qw.every((x, k) => words[i + k] === x));
  let best = 0;
  glosses(w.en).forEach((g, i) => {
    let s = 0;
    if (g.core === qn) s = 100 - i;
    else if (g.core.startsWith(qn + " ")) s = 70;
    else if (phrase(g.words)) s = 50;
    else if (phrase(g.full.split(/[^a-z']+/))) s = 30;
    else if (qn.length >= 3 && qw.length === 1 && g.words.some((x) => x.startsWith(qn))) s = 20;
    best = Math.max(best, s);
  });
  return best;
}
// The word's pinyin cut into one syllable per character, using each character's readings
// (银行 → yin + hang). Empty when a character has no card or the readings don't line up.
function syllables(w) {
  let rest = analysePinyin(w.pinyin).base; const out = [];
  for (const c of chars(w.hanzi)) {
    const rs = (String(CHARS[c]?.py || "") + (c === "儿" ? "/r" : "")).split(/[/,]/).map(analysePinyin).filter((r) => r.base && rest.startsWith(r.base));
    if (!rs.length) return [];
    const r = rs.sort((x, y) => y.base.length - x.base.length)[0];
    out.push(r); rest = rest.slice(r.base.length);
  }
  return rest ? [] : out;
}
function pinyinScore(w, q) {
  const a = analysePinyin(q), b = analysePinyin(w.pinyin);
  if (!a.base || /[^a-zü\s1-5'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(q)) return 0;
  const tonesOk = !a.tones || b.tones.startsWith(a.tones);
  if (b.base === a.base) return tonesOk ? 90 : 40;
  const sy = syllables(w);
  if (a.base.length >= 3 && b.base.startsWith(a.base)) {
    // a start that stops mid-syllable ("che" → chènshān) is likely still being typed: rank it lower
    let n = 0; const ends = sy.map((s) => (n += s.base.length));
    const whole = !sy.length || ends.includes(a.base.length);
    return tonesOk ? (whole ? 60 : 30) : 15;
  }
  // whole syllables inside the word: "hang" finds 银行 yínháng, not 长城 chángchéng
  for (let i = 0; i < sy.length; i++) {
    let base = "", tones = "";
    for (let k = i; k < sy.length && base.length < a.base.length; k++) { base += sy[k].base; tones += sy[k].tones; }
    if (base === a.base) return !a.tones || tones.startsWith(a.tones) ? 45 : 15;
  }
  return 0;
}
function hanziScore(w, q) {
  const qh = chars(q).join(""); if (!qh) return 0;
  return w.hanzi === qh ? 100 : w.hanzi.startsWith(qh) ? 80 : w.hanzi.includes(qh) ? 60 : 0;
}
function searchWords(q) {
  q = q.trim();
  const ws = allWords();
  const byPinyin = (x, y) => analysePinyin(x.pinyin).base.localeCompare(analysePinyin(y.pinyin).base) || x.pinyin.localeCompare(y.pinyin);
  if (!q) return ws.slice().sort(byPinyin).map((w) => ({ w, s: 0 }));
  const han = chars(q).length > 0;
  return ws.map((w) => ({ w, s: han ? hanziScore(w, q) : Math.max(englishScore(w, q), pinyinScore(w, q)) }))
    .filter((r) => r.s > 0)
    .sort((x, y) => y.s - x.s || [...x.w.hanzi].length - [...y.w.hanzi].length || byPinyin(x.w, y.w));
}
function vocabItem(w, fmap) {
  const fs = fmap.get(w.hanzi) || [];
  return `<button class="witem" data-open="${esc(w.hanzi)}"><span class="han">${esc(w.hanzi)}</span>
    <span class="info"><div>${esc(w.pinyin)}</div><div class="en">${esc(w.en)}</div>
    <div class="vfolders">${fs.map((f) => `<span>${esc(f)}</span>`).join("")}</div></span>${dots(w.hanzi)}</button>`;
}
function viewVocab(app) {
  const q = S.vocabQuery || "";
  const fmap = new Map();
  for (const e of folderEntries()) { if (!fmap.has(e.hanzi)) fmap.set(e.hanzi, []); if (!fmap.get(e.hanzi).includes(e.folder)) fmap.get(e.hanzi).push(e.folder); }
  app.innerHTML = `<section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">VOCABULARY</h1><span class="muted">${allWords().length} words</span></div>
    <input type="search" class="search" id="vq" placeholder="Look up 字, pinyin or English" value="${esc(q)}" aria-label="Look up a word" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div id="vres"></div></section>`;
  const out = $("#vres", app);
  const show = () => {
    const rs = searchWords(S.vocabQuery || "");
    if (!rs.length) { out.innerHTML = `<p class="muted" style="margin:0">No word matches “${esc(S.vocabQuery)}”.</p>`; return; }
    if ((S.vocabQuery || "").trim()) {
      out.innerHTML = `<div class="eyebrow">${rs.length} result${rs.length === 1 ? "" : "s"}</div><div class="missed">${rs.map((r) => vocabItem(r.w, fmap)).join("")}</div>`;
      return;
    }
    const groups = new Map();
    for (const { w } of rs) { const L = (analysePinyin(w.pinyin).base[0] || "#").toUpperCase(); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(w); }
    out.innerHTML = [...groups].map(([L, ws]) => `<div class="vgroup"><div class="vletter pix">${esc(L)}</div><div class="missed">${ws.map((w) => vocabItem(w, fmap)).join("")}</div></div>`).join("");
  };
  const inp = $("#vq", app);
  inp.oninput = () => { S.vocabQuery = inp.value; show(); };
  show();
}

/* ---------- global events ---------- */
document.addEventListener("click", (e) => {
  const say = e.target.closest("[data-say]"); if (say) { e.stopPropagation(); speak(say.dataset.say); return; }
  const open = e.target.closest("[data-open]"); if (open) { go("detail", open.dataset.open); return; }
  const part = e.target.closest("button[data-part]"); if (part) { go("part", part.dataset.part); return; }
});
$("#tabs").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) { S.history = []; go(b.dataset.view, null, false); } };
$("#logo").onclick = () => { S.history = []; go("study", null, false); };
$("#theme-btn").onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem(LS_KEY + "-theme", root.dataset.theme); } catch {}
  render();
};
document.addEventListener("keydown", (e) => {
  if (S.view !== "session" || !S.session || e.metaKey || e.ctrlKey || e.altKey) return;
  const inInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  const q = S.session.q;
  if (!inInput && /^[1-4]$/.test(e.key)) { const b = $$(".opt")[+e.key - 1]; if (b) { if (!b.disabled) { e.preventDefault(); b.click(); } return; } }
  if (!inInput && e.key === " " && q?.kind === "flash" && !q.flipped) { e.preventDefault(); q.flip?.(); return; }
  if (!inInput && q?.kind === "flash" && q.flipped && !q.done && /^[12]$/.test(e.key)) { const g = $(`[data-g="${+e.key - 1}"]`); if (g && !$("#grade").hidden) g.click(); return; }
  if (e.key === "Enter" && q?.done && document.activeElement?.id !== "next") { const n = $("#next"); if (n) { e.preventDefault(); n.click(); } }
});

/* ---------- boot ---------- */
try { const t = localStorage.getItem(LS_KEY + "-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
Store.loadLocal();
render();
Store.connect();
