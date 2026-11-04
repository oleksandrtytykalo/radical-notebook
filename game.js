/* ---------- SENTENCE GAMES ----------
   Sentences are generated on the spot from PATTERNS × LEXICON (sentences.js), like Duolingo-style
   apps: a pattern such as "S 喜欢 X" is filled with your vocabulary and the English is generated
   with it. Answers are checked against every arrangement that means the same thing (你/你们 both
   give "you"; a time word may lead the sentence).
   Rounds: BUILD (English → tiles), GAP (pick the missing word), MEANING (Chinese → English).
   A run is a fixed number of sentences; the score grows with sentence length and a combo
   multiplier (×1 → ×4) that a miss or a hint resets. */

const ROUNDS = {
  build: { zh: "组", label: "Build it", d: "Read the English, tap the word tiles into a Chinese sentence. Watch for decoys.", base: 100, perTile: 15, w: 4 },
  gap: { zh: "填", label: "Fill the gap", d: "Pick the word that completes the sentence.", base: 60, perTile: 0, w: 2 },
  meaning: { zh: "意", label: "What does it mean?", d: "Read the Chinese, choose the English. The wrong answers differ by one word.", base: 60, perTile: 0, w: 2 },
};

const sentData = () => (Store.data.sent ||= { best: {}, s: {} });
const patRec = (id) => sentData().s[id] || { c: 0, w: 0 };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function tokInfo(t) {
  const w = wordByHanzi(t); if (w) return { pinyin: w.pinyin, en: w.en };
  if (SENT_EXTRA[t]) return SENT_EXTRA[t];
  return { pinyin: chars(t).map((c) => String(CHARS[c]?.py || "").split("/")[0].trim()).join(""), en: "" };
}
function sentTopics() { const sc = settings().sscope || []; return sc.filter((s) => SENT_TOPICS.some(([k]) => k === s)); }
function patternPool() { const sc = sentTopics(); return sc.length ? PATTERNS.filter((p) => sc.includes(p.topic)) : PATTERNS; }

/* ----- generation ----- */
const slotList = (p, name, v) => { const c = p.slots[name]; return typeof c === "function" ? c(v) : LEXICON[c]; };
const slotZh = (p, name, item) => (p.expand?.[name] ? p.expand[name](item) : typeof item === "string" ? item : item.zh); // measure words are plain strings
function realise(p, v) {
  const toks = [], spans = {};
  const parts = p.zh.split(" "); const punct = /^[。？！]$/.test(parts[parts.length - 1]) ? parts.pop() : "";
  for (const part of parts) {
    if (p.slots[part] && v[part]) { const z = slotZh(p, part, v[part]).split(" "); spans[part] = [toks.length, toks.length + z.length]; toks.push(...z); }
    else toks.push(part);
  }
  return { pid: p.id, p, v, toks, punct, spans, en: cap(p.en(v)), text: toks.join("") + punct, id: toks.join("") };
}
function generate(p, forced = {}) {
  const v = {};
  for (const name of Object.keys(p.slots)) {
    const list = slotList(p, name, v);
    v[name] = forced[name] && list.includes(forced[name]) ? forced[name] : pick(list);
  }
  return realise(p, v);
}
// Items for a slot that give exactly the same English (你 / 你们 → "you"): all count as right
function sameMeaning(s, name) {
  const list = slotList(s.p, name, s.v);
  return list.filter((it) => { try { return cap(s.p.en({ ...s.v, [name]: it })) === s.en; } catch { return false; } });
}
// Every token order accepted as correct: each same-meaning filling, plus the time word
// moved to the very front (我明天去 = 明天我去), never anywhere else
const answerKey = (toks) => toks.join("|");
function acceptedAnswers(s) {
  let combos = [{}];
  for (const name of Object.keys(s.p.slots)) {
    const alts = sameMeaning(s, name);
    combos = combos.flatMap((c) => alts.map((it) => ({ ...c, [name]: it }))).slice(0, 200);
  }
  const out = new Set();
  for (const c of combos) {
    const toks = realise(s.p, { ...s.v, ...c }).toks;
    out.add(answerKey(toks));
    const t = toks.findIndex((x) => SENT_TIME.has(x));
    if (t > 0) { const a = [...toks]; const [w] = a.splice(t, 1); out.add(answerKey([w, ...a])); }
  }
  return out;
}
// A slot that is one tile wide and has real alternatives: used for gaps and decoys
function swappableSlots(s, need = 1) {
  return Object.keys(s.spans).filter((n) => {
    const [a, b] = s.spans[n]; if (b - a !== 1 || SENT_EXTRA[s.toks[a]]) return false;
    const same = new Set(sameMeaning(s, n));
    return slotList(s.p, n, s.v).filter((it) => !same.has(it) && !slotZh(s.p, n, it).includes(" ")).length >= need;
  });
}
function otherFillers(s, n, k) {
  const same = new Set(sameMeaning(s, n));
  return shuffle(slotList(s.p, n, s.v).filter((it) => !same.has(it))).map((it) => slotZh(s.p, n, it)).filter((z) => !z.includes(" ") && !s.toks.includes(z)).slice(0, k);
}
const bankToks = [...new Set(PATTERNS.flatMap((p) => p.zh.split(" ").filter((t) => !p.slots[t] && !/^[。？！]$/.test(t))))].filter((t) => !SENT_EXTRA[t]);

/* ----- picking ----- */
function patWeight(p) { const r = patRec(p.id); return (r.c ? 1 : 3) + Math.min(3, r.w); }
function drawPattern(pool, avoid) {
  const from = pool.filter((p) => !avoid.includes(p.id)); const bag = from.length ? from : pool;
  const tot = bag.reduce((a, p) => a + patWeight(p), 0); let r = Math.random() * tot;
  return bag.find((p) => (r -= patWeight(p)) < 0) || bag[0];
}
function roundKinds() {
  const ms = (settings().smodes || []).filter((m) => ROUNDS[m]);
  return ms.length ? ms : Object.keys(ROUNDS);
}

/* ----- sentence audio: every word's recording in a row, silence trimmed ----- */
function tokClips(t) {
  let rec = recordingFor(t);
  if (!rec && SENT_EXTRA[t]) { const a = analysePinyin(SENT_EXTRA[t].pinyin); rec = ["syl", [a.base.replace(/ü/g, "v") + (a.tones || 1)]]; }
  if (!rec) return null;
  return rec[0] === "word" ? [`audio/w/${rec[1]}.mp3`] : rec[1].map((n) => `audio/s/${n}.mp3`);
}
async function playClips(groups) {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const bufs = await Promise.all(groups.map((g) => Promise.all(g.map(trimmedBuffer))));
  const slow = Math.max(0, (0.9 - (settings().rate || 0.8)) * 0.6);
  let t = audioCtx.currentTime + 0.03;
  for (const g of bufs) {
    for (const b of g) {
      const src = audioCtx.createBufferSource(); src.buffer = b; src.connect(audioCtx.destination);
      src.start(t); playing.push(src); t += b.duration + (g.length > 1 ? slow : 0);
    }
    t += 0.08 + slow; // a breath between words
  }
}
function speakSentence(s) {
  stopAudio();
  const groups = s.toks.map(tokClips);
  const rec = groups.every(Boolean) ? () => playClips(groups).catch(() => ttsSpeak(s.text)) : null;
  if (settings().voice === "default" || !rec) return ttsSpeak(s.text, rec);
  rec();
}

/* ----- a run ----- */
function startGame() {
  const pool = patternPool();
  if (!pool.length) return toast("No sentence types in this selection.");
  const len = settings().slen || 10;
  S.game = { pool, len, kinds: roundKinds(), i: 0, score: 0, combo: 0, bestCombo: 0, results: [], recent: [], seen: new Set(), q: null, over: false };
  go("sgame");
  nextRound();
}
function makeRound(g) {
  let s;
  for (let tries = 0; tries < 12; tries++) { // a fresh sentence, not one already shown this run
    s = generate(drawPattern(g.pool, g.recent));
    if (!g.seen.has(s.id)) break;
  }
  g.seen.add(s.id);
  g.recent = [s.pid, ...g.recent].slice(0, Math.min(5, Math.floor(g.pool.length / 2)));
  let kinds = [...g.kinds];
  const gapSlots = swappableSlots(s, 3);
  if (!gapSlots.length && kinds.length > 1) kinds = kinds.filter((k) => k !== "gap");
  let kind = pick(kinds.flatMap((k) => Array(ROUNDS[k].w).fill(k)));
  if (kind === "gap" && !gapSlots.length) kind = "build";
  const q = { s, kind, done: false, hinted: false };
  if (kind === "build") {
    const decoys = [];
    const slots = shuffle(swappableSlots(s));
    if (slots.length) decoys.push(...otherFillers(s, slots[0], 1));
    if (s.toks.length <= 5) decoys.push(...shuffle(bankToks.filter((t) => !s.toks.includes(t) && !decoys.includes(t))).slice(0, 1));
    q.tiles = shuffle([...s.toks, ...decoys].map((t) => ({ t })));
    q.placed = [];
    q.accept = acceptedAnswers(s);
  } else if (kind === "gap") {
    const n = pick(gapSlots); q.gap = s.spans[n][0];
    q.opts = shuffle([s.toks[q.gap], ...otherFillers(s, n, 3)]);
  } else {
    // wrong answers: the same pattern with one slot changed, so they differ by a single idea
    const names = Object.keys(s.p.slots); const seen = new Set([s.en]); const opts = [];
    for (let tries = 0; opts.length < 3 && tries < 40; tries++) {
      const n = pick(names); const same = new Set(sameMeaning(s, n));
      const alt = shuffle(slotList(s.p, n, s.v)).find((it) => !same.has(it)); if (!alt) continue;
      const e = generate(s.p, { ...s.v, [n]: alt }).en;
      if (!seen.has(e)) { seen.add(e); opts.push(e); }
    }
    while (opts.length < 3) { const e = generate(pick(PATTERNS)).en; if (!seen.has(e)) { seen.add(e); opts.push(e); } }
    q.opts = shuffle([s.en, ...opts]);
  }
  return q;
}
function nextRound() {
  const g = S.game; if (!g || g.over) return;
  if (g.i >= g.len) return endGame();
  g.i++;
  g.q = makeRound(g);
  viewSGame($("#app"));
}

/* ----- view ----- */
const mult = (c) => Math.min(4, 1 + 0.5 * c);
function gameHead() {
  const g = S.game;
  return `<div class="study-head game-head">
    <button class="btn ghost" id="quit" style="padding:6px 10px">✕ End</button>
    <div class="meter" role="progressbar" aria-valuenow="${g.results.length}" aria-valuemax="${g.len}"><i style="width:${(g.results.length / g.len) * 100}%"></i></div>
    <span class="pix">${g.results.length}/${g.len}</span>
    <span class="combo pix" title="Combo multiplier">×${mult(g.combo)}</span>
    <span class="gscore pix" id="gscore">${g.score}</span></div>`;
}
function bindHead(app) { $("#quit", app).onclick = () => (S.game.results.length ? endGame(true) : go("study", null, false)); }
function tileHTML(tile, i, used) {
  return `<button class="tile ${used ? "used" : ""}" data-tile="${i}" ${used ? 'disabled aria-hidden="true"' : ""}><span class="han">${esc(tile.t)}</span><span class="py">${esc(tokInfo(tile.t).pinyin)}</span></button>`;
}
function sentenceRuby(s, gapIdx = -1, showPy = true) {
  return `<div class="ruby">${s.toks.map((t, i) => i === gapIdx
    ? `<span class="rt gap"><span class="han">＿＿</span>${showPy ? '<span class="py">?</span>' : ""}</span>`
    : `<span class="rt"><span class="han">${esc(t)}</span>${showPy ? `<span class="py">${esc(tokInfo(t).pinyin)}</span>` : ""}</span>`).join("")}<span class="rt"><span class="han">${esc(s.punct)}</span></span></div>`;
}
function viewSGame(app) {
  const g = S.game;
  if (!g) return go("study", null, false);
  if (g.over) return renderGameOver(app);
  const q = g.q; if (!q) return;
  const R = ROUNDS[q.kind];
  let body;
  if (q.kind === "build") {
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span><div class="big-en">${esc(q.s.en)}</div></div>
      <div class="sline" id="sline" aria-label="Your sentence"></div>
      <div class="tray" id="tray">${q.tiles.map((tile, i) => tileHTML(tile, i, false)).join("")}</div>
      <div class="actions game-actions" id="gact"><button class="btn ghost" id="hint">Hint</button><button class="btn" id="undo">⌫ Undo</button><button class="btn solid" id="check" disabled>Check</button></div>`;
  } else if (q.kind === "gap") {
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span>${sentenceRuby(q.s, q.gap)}<span class="muted">${esc(q.s.en)}</span></div>
      <div class="options" id="opts">${q.opts.map((o, i) => `<button class="opt" data-opt="${i}"><span class="key">${i + 1}</span><span class="val"><span class="han" style="font-size:28px">${esc(o)}</span> <span class="muted" style="font-size:13px">${esc(tokInfo(o).pinyin)}</span></span></button>`).join("")}</div>`;
  } else {
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span>${sentenceRuby(q.s, -1, false)}<button class="speak" id="replay">▶ Listen</button></div>
      <div class="options" id="opts">${q.opts.map((o, i) => `<button class="opt" data-opt="${i}"><span class="key">${i + 1}</span><span class="val">${esc(o)}</span></button>`).join("")}</div>`;
  }
  app.innerHTML = gameHead() + `<div id="gq">${body}</div>`;
  bindHead(app);
  const replay = $("#replay", app); if (replay) replay.onclick = () => speakSentence(q.s);
  if (q.tiles) bindTiles(app, q); else bindOpts(app, q);
}
function renderLine(app, q) {
  const full = q.placed.length === q.s.toks.length;
  $("#sline", app).innerHTML = q.placed.length
    ? q.placed.map((ti, j) => `<button class="tile placed" data-placed="${j}"><span class="han">${esc(q.tiles[ti].t)}</span><span class="py">${esc(tokInfo(q.tiles[ti].t).pinyin)}</span></button>`).join("") + (full ? `<span class="han punct">${esc(q.s.punct)}</span>` : "")
    : '<span class="muted sline-hint">Tap the tiles in order</span>';
  $$("#tray .tile", app).forEach((b) => { const used = q.placed.includes(+b.dataset.tile); b.classList.toggle("used", used); b.disabled = used || q.done; });
  const check = $("#check", app); if (check) check.disabled = q.done || !full;
}
function bindTiles(app, q) {
  $("#tray", app).onclick = (e) => {
    const b = e.target.closest("[data-tile]"); if (!b || q.done) return;
    const i = +b.dataset.tile; if (q.placed.includes(i) || q.placed.length >= q.s.toks.length) return;
    q.placed.push(i); renderLine(app, q);
  };
  $("#sline", app).onclick = (e) => {
    const b = e.target.closest("[data-placed]"); if (!b || q.done) return;
    q.placed.splice(+b.dataset.placed, 1); renderLine(app, q);
  };
  $("#undo", app).onclick = () => { if (q.done) return; q.placed.pop(); renderLine(app, q); };
  // Hint: keep the correct start, drop the rest, place the next right tile. Halves the points, breaks the combo.
  $("#hint", app).onclick = () => {
    if (q.done) return;
    let ok = 0; while (ok < q.placed.length && q.tiles[q.placed[ok]].t === q.s.toks[ok]) ok++;
    q.placed = q.placed.slice(0, ok);
    if (ok < q.s.toks.length) { const i = q.tiles.findIndex((tile, k) => tile.t === q.s.toks[ok] && !q.placed.includes(k)); if (i >= 0) q.placed.push(i); }
    q.hinted = true; renderLine(app, q);
  };
  $("#check", app).onclick = () => {
    if (q.done || q.placed.length !== q.s.toks.length) return;
    q.answer = q.placed.map((i) => q.tiles[i].t);
    resolveRound(q.accept.has(answerKey(q.answer)));
  };
  renderLine(app, q);
}
function bindOpts(app, q) {
  const right = q.kind === "gap" ? q.s.toks[q.gap] : q.s.en;
  $("#opts", app).onclick = (e) => {
    const b = e.target.closest("[data-opt]"); if (!b || q.done) return;
    const ok = q.opts[+b.dataset.opt] === right;
    $$("#opts .opt", app).forEach((o) => { o.disabled = true; if (q.opts[+o.dataset.opt] === right) o.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    resolveRound(ok);
  };
}
function resolveRound(ok) {
  const g = S.game, q = g.q; if (!g || q.done) return;
  q.done = true;
  const R = ROUNDS[q.kind];
  const rec = sentData().s[q.s.pid] ||= { c: 0, w: 0 };
  let gained = 0;
  if (ok) {
    let base = R.base + R.perTile * q.s.toks.length;
    if (q.hinted) base = Math.round(base / 2);
    gained = Math.round(base * mult(g.combo));
    g.score += gained;
    g.combo = q.hinted ? 0 : g.combo + 1;
    g.bestCombo = Math.max(g.bestCombo, g.combo);
    if (!q.hinted) rec.c++;
  } else { g.combo = 0; rec.w++; }
  Store.save();
  g.results.push({ s: q.s, ok, kind: q.kind, hinted: q.hinted });
  const app = $("#app");
  const head = $(".game-head", app); if (head) { head.outerHTML = gameHead(); bindHead(app); }
  if (ok) $("#gscore", app)?.classList.add("pop");
  if (q.tiles) {
    renderLine(app, q);
    $$("#sline .tile", app).forEach((t, j) => t.classList.add(ok || q.tiles[q.placed[j]].t === q.s.toks[j] ? "good" : "bad"));
    $("#gact", app)?.remove();
  }
  const last = g.i >= g.len;
  const fb = document.createElement("div");
  fb.className = "feedback " + (ok ? "ok" : "bad");
  fb.innerHTML = `<div class="spread"><div class="verdict">${ok ? `✓ +${gained}` : "✗ NOT QUITE"}</div><span class="pix" style="font-size:20px">${ok ? (g.combo > 1 ? `COMBO ×${mult(g.combo)}` : q.hinted ? "HINTED · ½" : "") : "COMBO RESET"}</span></div>
    ${sentenceRuby(q.s)}<div>${esc(q.s.en)}</div>`;
  const act = document.createElement("div");
  act.className = "actions";
  act.innerHTML = `<button class="btn" id="say">▶ Hear it</button><button class="btn solid" id="next">${last ? "Results →" : "Next →"}</button>`;
  $("#gq", app).append(fb, act);
  $("#say", app).onclick = () => speakSentence(q.s);
  $("#next", app).onclick = nextRound;
  $("#next", app).focus({ preventScroll: true });
  fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
  speakSentence(q.s);
}
function endGame(quit = false) {
  const g = S.game; if (!g || g.over) return;
  g.over = true; g.quit = quit; stopAudio();
  const best = sentData().best;
  g.prevBest = best[g.len] || 0;
  if (!quit && g.score > g.prevBest) best[g.len] = g.score;
  Store.save();
  viewSGame($("#app"));
}
const starsFor = (pct) => (pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0);
function renderGameOver(app) {
  const g = S.game;
  const right = g.results.filter((r) => r.ok).length;
  const pct = g.results.length ? Math.round((right / g.results.length) * 100) : 0;
  const stars = g.quit ? 0 : starsFor(pct);
  const isBest = !g.quit && g.score > g.prevBest && g.score > 0;
  const missed = g.results.filter((r) => !r.ok || r.hinted).map((r) => r.s);
  app.innerHTML = `<section class="block">
    <div class="eyebrow">句 Sentences · ${g.len} round${g.len === 1 ? "" : "s"}</div>
    <h1 class="pix" style="font-size:44px">${g.quit ? "RUN ENDED" : ["KEEP GOING", "NICE RUN", "GREAT RUN", "PERFECT RUN"][stars]}</h1>
    <div class="row" style="align-items:flex-end;gap:16px"><span class="score">${g.score}</span>${isBest ? '<span class="stamp">NEW BEST</span>' : `<span class="muted">best ${Math.max(g.prevBest, g.quit ? 0 : g.score)}</span>`}</div>
    <div class="stars" aria-label="${stars} of 3 stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
    <div class="row muted" style="font-size:13px">${right}/${g.results.length} right (${pct}%) · best combo ×${mult(g.bestCombo)}</div>
    <div class="actions"><button class="btn solid" id="again">Play again</button><button class="btn" id="home">Back</button></div>
  </section>
  ${missed.length ? `<section class="block"><div class="eyebrow">Practise these</div><div class="missed">${missed.map((s, i) => `<div class="sitem">${sentenceRuby(s)}<div class="spread"><span class="muted" style="font-size:13px">${esc(s.en)}</span><button class="speak" data-miss="${i}">▶</button></div></div>`).join("")}</div></section>` : ""}`;
  $("#again", app).onclick = startGame;
  $("#home", app).onclick = () => go("study", null, false);
  $$("[data-miss]", app).forEach((b) => (b.onclick = () => speakSentence(missed[+b.dataset.miss])));
}

/* ----- home: the Sentences side of the Study tab ----- */
function trackSwitch() {
  const t = settings().track === "sentences" ? "sentences" : "words";
  return `<div class="track" role="tablist" aria-label="Practice type">
    <button role="tab" data-track="words" aria-selected="${t === "words"}"><span class="han">词</span>Words</button>
    <button role="tab" data-track="sentences" aria-selected="${t === "sentences"}"><span class="han">句</span>Sentences</button></div>`;
}
function bindTrack(app) {
  $$("[data-track]", app).forEach((b) => (b.onclick = () => { settings().track = b.dataset.track; Store.save(); render(); }));
}
const smodeSummary = (ms) => (ms.length ? ms.map((m) => ROUNDS[m].label).join(" + ") : "Random mix");
function viewSentences(app) {
  const st = settings(); const sc = sentTopics(); const pool = patternPool();
  const ms = (st.smodes || []).filter((m) => ROUNDS[m]);
  const len = st.slen || 10; const best = sentData().best[len];
  const done = PATTERNS.filter((p) => patRec(p.id).c).length;
  app.innerHTML = trackSwitch() + `
  <section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">SENTENCE GAMES</h1><span class="muted">${pool.length} sentence type${pool.length === 1 ? "" : "s"} selected</span></div>
    <div class="row" id="sscope">
      <button class="chip" data-src="" aria-pressed="${!sc.length}">All topics<span class="n">${PATTERNS.length}</span></button>
      ${SENT_TOPICS.map(([k, name]) => `<button class="chip" data-src="${k}" aria-pressed="${sc.includes(k)}">${esc(name)}<span class="n">${PATTERNS.filter((p) => p.topic === k).length}</span></button>`).join("")}
    </div>
    <div class="row">
      <label class="field">Sentences per round
        <select id="slen">${[10, 20, 40].map((v) => `<option value="${v}" ${len === v ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>
    </div>
  </section>
  <section class="block">
    <div class="spread"><div class="eyebrow">Practice</div><span class="muted" style="font-size:13px">Pick one or several</span></div>
    <div class="modes" id="smodes">
      <button class="mode" data-smode="" aria-pressed="${!ms.length}"><span class="glyph">乱</span><span class="t">Random mix</span><span class="d">All round types, shuffled. New sentence types come up more.</span></button>
      ${Object.entries(ROUNDS).map(([k, R]) => `<button class="mode" data-smode="${k}" aria-pressed="${ms.includes(k)}"><span class="glyph">${R.zh}</span><span class="t">${R.label}</span><span class="d">${R.d}</span></button>`).join("")}
    </div>
    <button class="btn solid start" id="sstart">Start · ${esc(smodeSummary(ms))}</button>
    <div class="spread muted" style="font-size:13px"><span>Best score · ${len} sentences</span><span class="pix" style="font-size:26px;color:var(--ink)">${best || "—"}</span></div>
  </section>
  <section class="block">
    <div class="spread"><div class="eyebrow">Sentence types mastered</div><span class="pix">${done}/${PATTERNS.length}</span></div>
    <div class="slog" aria-label="${done} of ${PATTERNS.length} sentence types solved">${PATTERNS.map((p) => `<i class="${patRec(p.id).c ? "on" : patRec(p.id).w ? "tried" : ""}" title="${esc(generate(p).text)}"></i>`).join("")}</div>
    <p class="muted" style="margin:0;font-size:13px">Every round is a new sentence, built from your vocabulary on the spot. A square fills once you solve its sentence type without a hint.</p>
    <details class="rubric"><summary>How scoring works</summary><div class="rubric-body">
      <p style="margin:0">Points grow with sentence length. Each right answer in a row raises the combo (×1 → ×4); a miss or a hint resets it, and a hint halves that round's points. Stars at the end: ★ 50%, ★★ 70%, ★★★ 90% right.</p>
    </div></details>
  </section>`;
  bindTrack(app);
  $("#sscope", app).onclick = (e) => {
    const b = e.target.closest("[data-src]"); if (!b) return;
    const k = b.dataset.src;
    let next = k ? (sc.includes(k) ? sc.filter((x) => x !== k) : [...sc, k]) : [];
    if (next.length === SENT_TOPICS.length) next = [];
    st.sscope = next; Store.save(); render();
  };
  $("#slen", app).onchange = (e) => { st.slen = +e.target.value; Store.save(); render(); };
  $("#smodes", app).onclick = (e) => {
    const b = e.target.closest("[data-smode]"); if (!b) return;
    const m = b.dataset.smode;
    let next = m ? (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]) : [];
    if (next.length === Object.keys(ROUNDS).length) next = [];
    st.smodes = next; Store.save(); render();
  };
  $("#sstart", app).onclick = startGame;
}

document.addEventListener("keydown", (e) => {
  if (S.view !== "sgame" || !S.game || S.game.over || e.metaKey || e.ctrlKey || e.altKey) return;
  const q = S.game.q; if (!q) return;
  if (e.key === "Enter") { const b = q.done ? $("#next") : $("#check"); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
  if (q.done) return;
  if (/^[1-4]$/.test(e.key) && q.opts) { const b = $$(".opt")[+e.key - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
  if (e.key === "Backspace" && q.tiles) { e.preventDefault(); $("#undo")?.click(); }
});
