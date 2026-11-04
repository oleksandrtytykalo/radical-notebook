/* ---------- SENTENCE GAMES ----------
   Two arcade runs over SENTENCES (sentences.js):
   JOURNEY  10 sentences, 3 lives. RUSH  60 seconds, +3s per hit, −5s per miss.
   Each sentence comes up as one of four rounds: BUILD (English → tiles), LISTEN (audio → tiles),
   GAP (pick the missing word) and MEANING (Chinese → pick the English).
   Points grow with sentence length and a combo multiplier (×1 → ×4) that a miss or a hint resets. */

const ROUNDS = {
  build: { label: "Build it", zh: "组句", base: 100, perTile: 15 },
  listen: { label: "Listen & build", zh: "听写", base: 150, perTile: 15 },
  gap: { label: "Fill the gap", zh: "填空", base: 60, perTile: 0 },
  meaning: { label: "What does it mean?", zh: "意思", base: 60, perTile: 0 },
};
const ROUND_WEIGHT = { build: 4, listen: 3, gap: 2, meaning: 2 };
const GAMES = {
  journey: { zh: "旅", name: "Journey", d: "10 sentences, 3 lives. Clear the route without running out of hearts.", n: 10, hearts: 3 },
  rush: { zh: "快", name: "Rush", d: "60 seconds on the clock. Every hit +3s, every miss −5s.", secs: 60, plus: 3, minus: 5 },
};

const SENTS = SENTENCES.map(([src, zh, en]) => {
  const all = zh.trim().split(/\s+/);
  const punct = /^[。？！，]$/.test(all[all.length - 1]) ? all.pop() : "";
  return { id: all.join(""), src, toks: all, punct, en, text: all.join("") + punct };
});
const sentData = () => (Store.data.sent ||= { best: {}, s: {} });
const sentRec = (id) => sentData().s[id] || { c: 0, w: 0 };
const cleared = (id) => sentRec(id).c > 0;
function tokInfo(t) {
  const w = wordByHanzi(t); if (w) return { pinyin: w.pinyin, en: w.en };
  if (SENT_EXTRA[t]) return SENT_EXTRA[t];
  return { pinyin: chars(t).map((c) => String(CHARS[c]?.py || "").split("/")[0].trim()).join(""), en: "" };
}
function sentScope() { const sc = settings().sscope || []; return sc.filter((s) => SENT_SOURCES.some(([k]) => k === s)); }
function sentPool() { const sc = sentScope(); return sc.length ? SENTS.filter((s) => sc.includes(s.src)) : SENTS; }
// Time words may lead the sentence: compare answers with any leading time word moved first
function canon(toks) {
  const a = [...toks];
  if (a.length > 1 && SENT_TIME.has(a[1]) && !SENT_TIME.has(a[0])) [a[0], a[1]] = [a[1], a[0]];
  return a.join("|");
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

/* ----- picking ----- */
function pickRound(s) {
  const kinds = Object.keys(ROUND_WEIGHT).filter((k) => !(k === "gap" && !s.toks.some((t) => !SENT_EXTRA[t])));
  return pick(kinds.flatMap((k) => Array(ROUND_WEIGHT[k]).fill(k)));
}
// Fresh sentences and ones you missed come up more often
function sentWeight(s) { const r = sentRec(s.id); return (r.c ? 1 : 3) + Math.min(3, r.w); }
function drawSentences(pool, n, avoid = []) {
  const left = pool.filter((s) => !avoid.includes(s.id)); const out = [];
  const from = left.length ? left : pool;
  const bag = [...from];
  while (out.length < n && bag.length) {
    const tot = bag.reduce((a, s) => a + sentWeight(s), 0); let r = Math.random() * tot;
    const i = bag.findIndex((s) => (r -= sentWeight(s)) < 0);
    out.push(bag.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
const bankToks = [...new Set(SENTS.flatMap((s) => s.toks))].filter((t) => !SENT_EXTRA[t]);
function distractorToks(s, n) {
  const own = new Set(s.toks);
  const lens = s.toks.map((t) => [...t].length);
  const cands = shuffle(bankToks.filter((t) => !own.has(t))).sort((a, b) => (lens.includes([...a].length) ? 0 : 1) - (lens.includes([...b].length) ? 0 : 1));
  return cands.slice(0, n);
}

/* ----- game state ----- */
function startGame(type) {
  const pool = sentPool();
  if (!pool.length) return toast("No sentences in this selection.");
  const G = GAMES[type];
  S.game = { type, pool, i: 0, score: 0, combo: 0, bestCombo: 0, results: [], recent: [], q: null, over: false };
  if (type === "journey") { S.game.queue = drawSentences(pool, Math.min(G.n, pool.length)); S.game.hearts = G.hearts; }
  else S.game.ends = Date.now() + G.secs * 1000;
  go("sgame");
  nextRound();
}
function nextRound() {
  const g = S.game; if (!g || g.over) return;
  let s;
  if (g.type === "journey") { if (g.i >= g.queue.length || g.hearts <= 0) return endGame(); s = g.queue[g.i]; }
  else { if (Date.now() >= g.ends) return endGame(); s = drawSentences(g.pool, 1, g.recent)[0]; }
  g.i++;
  g.recent = [s.id, ...g.recent].slice(0, Math.min(6, Math.floor(g.pool.length / 2)));
  const kind = pickRound(s);
  const q = { s, kind, done: false, hinted: false };
  if (kind === "build" || kind === "listen") {
    const extra = distractorToks(s, s.toks.length >= 6 ? 1 : 2);
    q.tiles = shuffle([...s.toks, ...extra].map((t, k) => ({ t, k })));
    q.placed = [];
  } else if (kind === "gap") {
    const idxs = s.toks.map((t, i) => i).filter((i) => !SENT_EXTRA[s.toks[i]]);
    q.gap = pick(idxs);
    const right = s.toks[q.gap]; const len = [...right].length; const own = new Set(s.toks);
    const pool = shuffle(bankToks.filter((t) => !own.has(t))).sort((a, b) => Math.abs([...a].length - len) - Math.abs([...b].length - len));
    q.opts = shuffle([right, ...pool.slice(0, 3)]);
  } else {
    const others = shuffle(SENTS.filter((x) => x.id !== s.id && x.en !== s.en)).sort((a, b) => (a.src === s.src ? 0 : 1) - (b.src === s.src ? 0 : 1));
    q.opts = shuffle([s.en, ...others.slice(0, 3).map((x) => x.en)]);
  }
  g.q = q;
  viewSGame($("#app"));
}

/* ----- view ----- */
const hearts = (n, max) => `<span class="hearts" aria-label="${n} of ${max} lives">${"♥".repeat(Math.max(0, n))}${"♡".repeat(Math.max(0, max - n))}</span>`;
const mult = (c) => Math.min(4, 1 + 0.5 * c);
const fmtTime = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function gameHead() {
  const g = S.game, G = GAMES[g.type];
  const left = g.type === "journey"
    ? hearts(g.hearts, G.hearts)
    : `<span class="pix stimer" id="stimer">${fmtTime(g.ends - Date.now())}</span>`;
  const meter = g.type === "journey"
    ? `<div class="meter" role="progressbar" aria-valuenow="${g.results.length}" aria-valuemax="${g.queue.length}"><i style="width:${(g.results.length / g.queue.length) * 100}%"></i></div>`
    : `<div class="meter" id="tmeter" aria-hidden="true"><i style="width:${Math.min(100, ((g.ends - Date.now()) / (G.secs * 1000)) * 100)}%"></i></div>`;
  return `<div class="study-head game-head">
    <button class="btn ghost" id="quit" style="padding:6px 10px">✕</button>
    ${left}${meter}
    <span class="combo pix" title="Combo multiplier">×${mult(g.combo)}</span>
    <span class="gscore pix" id="gscore">${g.score}</span></div>`;
}
function tileHTML(tile, i, used) {
  const info = tokInfo(tile.t);
  return `<button class="tile ${used ? "used" : ""}" data-tile="${i}" ${used ? 'disabled aria-hidden="true"' : ""}><span class="han">${esc(tile.t)}</span><span class="py">${esc(info.pinyin)}</span></button>`;
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
  let body = "";
  if (q.kind === "build" || q.kind === "listen") {
    const prompt = q.kind === "build"
      ? `<div class="big-en">${esc(q.s.en)}</div>`
      : `<button class="speak huge" id="replay">▶ Play sentence</button><span class="muted" style="font-size:13px">Build what you hear</span>`;
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span>${prompt}</div>
      <div class="sline" id="sline" aria-label="Your sentence">${q.placed.length ? "" : '<span class="muted sline-hint">Tap the tiles in order</span>'}</div>
      <div class="tray" id="tray">${q.tiles.map((tile, i) => tileHTML(tile, i, q.placed.includes(i))).join("")}</div>
      <div class="actions game-actions" id="gact"><button class="btn ghost" id="hint">Hint</button><button class="btn" id="undo">⌫ Undo</button><button class="btn solid" id="check" disabled>Check</button></div>`;
  } else if (q.kind === "gap") {
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span>${sentenceRuby(q.s, q.gap)}<span class="muted">${esc(q.s.en)}</span></div>
      <div class="options" id="opts">${q.opts.map((o, i) => `<button class="opt" data-opt="${i}"><span class="key">${i + 1}</span><span class="val"><span class="han" style="font-size:28px">${esc(o)}</span> <span class="muted" style="font-size:13px">${esc(tokInfo(o).pinyin)}</span></span></button>`).join("")}</div>`;
  } else {
    body = `<div class="prompt-card game-card"><span class="ask">${R.zh} · ${R.label}</span>${sentenceRuby(q.s, -1, false)}<button class="speak" id="replay">▶ Listen</button></div>
      <div class="options" id="opts">${q.opts.map((o, i) => `<button class="opt" data-opt="${i}"><span class="key">${i + 1}</span><span class="val">${esc(o)}</span></button>`).join("")}</div>`;
  }
  app.innerHTML = gameHead() + `<div id="gq">${body}</div>`;
  $("#quit", app).onclick = () => (g.results.length ? endGame(true) : go("study", null, false));
  const replay = $("#replay", app); if (replay) replay.onclick = () => speakSentence(q.s);
  if (q.kind === "listen" || q.kind === "meaning") speakSentence(q.s);
  if (q.tiles) bindTiles(app, q); else bindOpts(app, q);
  if (g.type === "rush") tickRush();
}
function renderLine(app, q) {
  const line = $("#sline", app);
  line.innerHTML = q.placed.length
    ? q.placed.map((ti, j) => { const info = tokInfo(q.tiles[ti].t); return `<button class="tile placed" data-placed="${j}"><span class="han">${esc(q.tiles[ti].t)}</span><span class="py">${esc(info.pinyin)}</span></button>`; }).join("") + (q.placed.length === q.s.toks.length ? `<span class="han punct">${esc(q.s.punct)}</span>` : "")
    : '<span class="muted sline-hint">Tap the tiles in order</span>';
  $$("#tray .tile", app).forEach((b) => { const used = q.placed.includes(+b.dataset.tile); b.classList.toggle("used", used); b.disabled = used || q.done; });
  const check = $("#check", app); if (check) check.disabled = q.done || q.placed.length !== q.s.toks.length;
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
    const ans = q.placed.map((i) => q.tiles[i].t);
    resolveRound(canon(ans) === canon(q.s.toks));
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
  const rec = sentData().s[q.s.id] ||= { c: 0, w: 0 };
  let gained = 0, timeNote = "";
  if (ok) {
    let base = R.base + R.perTile * q.s.toks.length;
    if (q.hinted) base = Math.round(base / 2);
    gained = Math.round(base * mult(g.combo));
    g.score += gained;
    g.combo = q.hinted ? 0 : g.combo + 1;
    g.bestCombo = Math.max(g.bestCombo, g.combo);
    if (!q.hinted) rec.c++;
    if (g.type === "rush") { g.ends += GAMES.rush.plus * 1000; timeNote = ` · +${GAMES.rush.plus}s`; }
  } else {
    g.combo = 0; rec.w++;
    if (g.type === "journey") g.hearts--;
    else { g.ends -= GAMES.rush.minus * 1000; timeNote = ` · −${GAMES.rush.minus}s`; }
  }
  Store.save();
  g.results.push({ s: q.s, ok, kind: q.kind, hinted: q.hinted });
  const app = $("#app");
  // refresh the head (score, hearts, combo) without redrawing the round
  const head = $(".game-head", app); if (head) { head.outerHTML = gameHead(); $("#quit", app).onclick = () => endGame(true); }
  if (ok) { const sc = $("#gscore", app); sc?.classList.add("pop"); }
  if (q.tiles) {
    renderLine(app, q);
    $$("#sline .tile", app).forEach((t, j) => t.classList.add(ok || q.tiles[q.placed[j]].t === q.s.toks[j] ? "good" : "bad"));
    $("#gact", app)?.remove();
  }
  const last = g.type === "journey" ? (g.i >= g.queue.length || g.hearts <= 0) : Date.now() >= g.ends;
  const fb = document.createElement("div");
  fb.className = "feedback " + (ok ? "ok" : "bad");
  fb.innerHTML = `<div class="spread"><div class="verdict">${ok ? `✓ +${gained}` : "✗ NOT QUITE"}</div><span class="pix" style="font-size:20px">${ok ? (g.combo > 1 ? `COMBO ×${mult(g.combo)}` : q.hinted ? "HINTED · ½" : "") : g.type === "journey" ? `${g.hearts} ♥ LEFT` : ""}${timeNote}</span></div>
    ${sentenceRuby(q.s)}<div>${esc(q.s.en)}</div>`;
  const act = document.createElement("div");
  act.className = "actions";
  act.innerHTML = `<button class="btn" id="say">▶ Hear it</button><button class="btn solid" id="next">${last ? "Results →" : "Next →"}</button>`;
  const gq = $("#gq", app); gq.append(fb, act);
  $("#say", app).onclick = () => speakSentence(q.s);
  $("#next", app).onclick = nextRound;
  $("#next", app).focus({ preventScroll: true });
  fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (ok && q.kind !== "listen") speakSentence(q.s);
  // Rush keeps moving: a hit advances by itself
  if (ok && g.type === "rush" && !last) setTimeout(() => { if (S.game === g && g.q === q && S.view === "sgame") nextRound(); }, 1100);
}
function tickRush() {
  const g = S.game;
  clearInterval(tickRush.t);
  tickRush.t = setInterval(() => {
    if (S.view !== "sgame" || S.game !== g || g.over) return clearInterval(tickRush.t);
    const left = g.ends - Date.now();
    const el = $("#stimer"); if (el) { el.textContent = fmtTime(left); el.classList.toggle("low", left < 10000); }
    const m = $("#tmeter i"); if (m) m.style.width = Math.min(100, (left / (GAMES.rush.secs * 1000)) * 100) + "%";
    if (left <= 0) { clearInterval(tickRush.t); endGame(); }
  }, 200);
}
function endGame(quit = false) {
  const g = S.game; if (!g || g.over) return;
  g.over = true; g.quit = quit; clearInterval(tickRush.t); stopAudio();
  const best = sentData().best;
  g.prevBest = best[g.type] || 0;
  if (!quit && g.score > g.prevBest) best[g.type] = g.score;
  Store.save();
  viewSGame($("#app"));
}
function renderGameOver(app) {
  const g = S.game, G = GAMES[g.type];
  const right = g.results.filter((r) => r.ok).length;
  const title = g.quit ? "RUN ENDED" : g.type === "rush" ? "TIME!" : g.hearts > 0 ? "JOURNEY CLEAR" : "OUT OF HEARTS";
  const stars = g.type === "journey" && !g.quit && g.hearts > 0 ? g.hearts : 0;
  const isBest = !g.quit && g.score > g.prevBest && g.score > 0;
  const missed = [...new Map(g.results.filter((r) => !r.ok || r.hinted).map((r) => [r.s.id, r.s])).values()];
  app.innerHTML = `<section class="block">
    <div class="eyebrow">${G.zh} ${G.name}</div>
    <h1 class="pix" style="font-size:44px">${title}</h1>
    <div class="row" style="align-items:flex-end;gap:16px"><span class="score">${g.score}</span>${isBest ? '<span class="stamp">NEW BEST</span>' : `<span class="muted">best ${Math.max(g.prevBest, g.quit ? 0 : g.score)}</span>`}</div>
    ${g.type === "journey" ? `<div class="stars" aria-label="${stars} of 3 stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>` : ""}
    <div class="row muted" style="font-size:13px">${right}/${g.results.length} right · best combo ×${mult(g.bestCombo)}</div>
    <div class="actions"><button class="btn solid" id="again">Play again</button><button class="btn" id="home">Back</button></div>
  </section>
  ${missed.length ? `<section class="block"><div class="eyebrow">Practise these</div><div class="missed">${missed.map((s) => `<div class="sitem">${sentenceRuby(s)}<div class="spread"><span class="muted" style="font-size:13px">${esc(s.en)}</span><button class="speak" data-sent="${esc(s.id)}">▶</button></div></div>`).join("")}</div></section>` : ""}`;
  $("#again", app).onclick = () => startGame(g.type);
  $("#home", app).onclick = () => go("study", null, false);
  $$("[data-sent]", app).forEach((b) => (b.onclick = () => speakSentence(SENTS.find((s) => s.id === b.dataset.sent))));
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
function viewSentences(app) {
  const sc = sentScope(); const pool = sentPool(); const best = sentData().best;
  const done = SENTS.filter((s) => cleared(s.id)).length;
  app.innerHTML = trackSwitch() + `
  <section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">SENTENCE GAMES</h1><span class="muted">${pool.length} sentence${pool.length === 1 ? "" : "s"} selected</span></div>
    <div class="row" id="sscope">
      <button class="chip" data-src="" aria-pressed="${!sc.length}">All<span class="n">${SENTS.length}</span></button>
      ${SENT_SOURCES.map(([k, name]) => `<button class="chip" data-src="${k}" aria-pressed="${sc.includes(k)}">${esc(name)}<span class="n">${SENTS.filter((s) => s.src === k).length}</span></button>`).join("")}
    </div>
  </section>
  <section class="block">
    <div class="eyebrow">Play</div>
    <div class="games">${Object.entries(GAMES).map(([k, G]) => `<button class="game" data-game="${k}">
      <span class="glyph">${G.zh}</span><span class="t">${G.name}</span><span class="d">${G.d}</span>
      <span class="best"><span class="eyebrow">Best</span><span class="pix">${best[k] || "—"}</span></span></button>`).join("")}</div>
  </section>
  <section class="block">
    <div class="spread"><div class="eyebrow">Sentence log</div><span class="pix">${done}/${SENTS.length}</span></div>
    <div class="slog" aria-label="${done} of ${SENTS.length} sentences cleared">${SENTS.map((s) => `<i class="${cleared(s.id) ? "on" : sentRec(s.id).w ? "tried" : ""}" title="${esc(s.text)}"></i>`).join("")}</div>
    <p class="muted" style="margin:0;font-size:13px">A square fills when you get its sentence right without a hint.</p>
    <details class="rubric"><summary>How to play</summary><div class="rubric-body">
      <table>${Object.values(ROUNDS).map((R) => `<tr><td class="han">${R.zh}</td><td><b>${R.label}</b></td><td class="muted">${{ "Build it": "Read the English, tap the word tiles into a Chinese sentence. Watch out for extra tiles.", "Listen & build": "Hear the sentence, then build it from tiles.", "Fill the gap": "Pick the word that completes the sentence.", "What does it mean?": "Read the Chinese, choose the right English." }[R.label]}</td></tr>`).join("")}</table>
      <p style="margin:0">Points grow with sentence length. Each hit in a row raises the combo (×1 → ×4); a miss or a hint resets it, and a hint halves that round's points.</p>
    </div></details>
  </section>`;
  bindTrack(app);
  $("#sscope", app).onclick = (e) => {
    const b = e.target.closest("[data-src]"); if (!b) return;
    const k = b.dataset.src;
    let next = k ? (sc.includes(k) ? sc.filter((x) => x !== k) : [...sc, k]) : [];
    if (next.length === SENT_SOURCES.length) next = [];
    settings().sscope = next; Store.save(); render();
  };
  $$("[data-game]", app).forEach((b) => (b.onclick = () => startGame(b.dataset.game)));
}

document.addEventListener("keydown", (e) => {
  if (S.view !== "sgame" || !S.game || S.game.over || e.metaKey || e.ctrlKey || e.altKey) return;
  const q = S.game.q; if (!q) return;
  if (e.key === "Enter") { const b = q.done ? $("#next") : $("#check"); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
  if (q.done) return;
  if (/^[1-4]$/.test(e.key) && q.opts) { const b = $$(".opt")[+e.key - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
  if (e.key === "Backspace" && q.tiles) { e.preventDefault(); $("#undo")?.click(); }
});
