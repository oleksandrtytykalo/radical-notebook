/* ---------- LEARN: new words, island by island ----------
   Built on what works best for new vocabulary:
   · small batches ("camps") of 5 new words: about what working memory holds at once
   · a rich first meeting: sound, meaning and the radical story as a memory hook
   · recognition before recall: pick the meaning first, produce the character later
   · retrieval, not re-reading: every word is tested right after you meet it
   · learning steps: a miss comes back a few steps later until you get it
   · spaced review: learned words come back after 1, 2, 4, 7, 14 days
   Finishing a camp moves its words onto the mastery boxes (1, or 2 if you never missed),
   so learning lifts the island's level; the Words games take it further. */

const CAMP_SIZE = 5;
const SRS_DAYS = [0, 1, 2, 4, 7, 14]; // review interval by mastery box
const DAY = 864e5;
const isMet = (h) => { const p = Store.data.progress[h]; return !!p && p.c + p.w > 0; };
const dueAt = (h) => { const p = prog(h); return p.t + SRS_DAYS[p.b] * DAY; };
const isDue = (h) => isMet(h) && Date.now() >= dueAt(h);

function learnIslands() {
  return islands().map((isl) => {
    const words = uniqueWords(isl.folders.flatMap(([, ws]) => ws));
    return { ...isl, words, fresh: words.filter((w) => !isMet(w.hanzi)), due: words.filter((w) => isDue(w.hanzi)) };
  });
}
function currentLearnIsland(list) {
  return list.find((i) => i.name === settings().learnIsland) || list.find((i) => !i.side && i.fresh.length) || list[0];
}

/* ----- the Learn page (third side of the Study tab) ----- */
function viewLearn(app) {
  const list = learnIslands();
  const cur = currentLearnIsland(list);
  const totalNew = allWords().filter((w) => !isMet(w.hanzi)).length; // words on two islands count once
  const camps = Math.ceil(cur.words.length / CAMP_SIZE);
  const met = cur.words.length - cur.fresh.length;
  const next = cur.fresh.slice(0, CAMP_SIZE);
  const lv = islandLevel(cur.words);
  app.innerHTML = trackSwitch() + `
  <section class="block">
    <div class="spread"><h1 class="pix" style="font-size:34px">LEARN NEW WORDS</h1><span class="muted">${totalNew} new to meet</span></div>
    <div class="lisles" id="lisles">${list.map((i) => `<button class="lisle tone-${i.tone}" data-lisle="${esc(i.name)}" aria-pressed="${i === cur}">
      <span class="swatch han">${esc(i.mark)}</span><span class="nm">${esc(i.name)}</span>
      <span class="ct">${i.fresh.length ? `${i.fresh.length} new` : "all met"}${i.due.length ? ` · ${i.due.length} due` : ""}</span></button>`).join("")}</div>
  </section>
  <section class="block">
    <div class="camp tone-${cur.tone}">
      <div class="spread"><div><div class="eyebrow">${cur.side ? "Side island" : "Island"} · LV ${lv.lv} ${LEVELS[lv.lv].en}</div><h2 class="pix" style="font-size:32px">${esc(cur.name.toUpperCase())}</h2></div>
        <span class="pix" style="font-size:26px">${met}/${cur.words.length}</span></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Camps · ${CAMP_SIZE} words each</div>
        <div class="camps" aria-label="${Math.floor(met / CAMP_SIZE)} of ${camps} camps set up">${Array.from({ length: camps }, (_, k) => {
          const ws = cur.words.slice(k * CAMP_SIZE, (k + 1) * CAMP_SIZE); const m = ws.filter((w) => isMet(w.hanzi)).length;
          return `<i class="${m === ws.length ? "on" : m ? "part" : ""}" title="Camp ${k + 1}: ${esc(ws.map((w) => w.hanzi).join(" "))}"></i>`;
        }).join("")}</div></div>
      ${next.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Next camp</div><div class="next-camp">${next.map((w) => `<span class="han">${esc(w.hanzi)}</span>`).join("")}</div></div>` : `<p style="margin:0">Every word on this island has been met. Keep it fresh with reviews and the Words games.</p>`}
      <div class="actions" style="margin-top:4px">
        ${next.length ? `<button class="btn solid" id="learn-go">Learn ${next.length} new word${next.length === 1 ? "" : "s"} →</button>` : ""}
        ${cur.due.length ? `<button class="btn" id="review-go">Review ${Math.min(10, cur.due.length)} due</button>` : ""}
      </div>
    </div>
  </section>
  <section class="block">
    <details class="rubric"><summary>Why this way of learning works</summary><div class="rubric-body">
      <table>
        <tr><td class="han">小</td><td><b>Small camps</b></td><td class="muted">Five words at a time, about what working memory can juggle.</td></tr>
        <tr><td class="han">见</td><td><b>Meet it properly</b></td><td class="muted">Sound, meaning and the radical story together: a picture and a reason stick better than a bare shape.</td></tr>
        <tr><td class="han">认</td><td><b>Recognise, then recall</b></td><td class="muted">First pick the meaning, then pick the character from the meaning: difficulty grows as memory forms.</td></tr>
        <tr><td class="han">考</td><td><b>Test, don't re-read</b></td><td class="muted">Pulling a word out of memory strengthens it far more than looking at it again.</td></tr>
        <tr><td class="han">回</td><td><b>Misses come back</b></td><td class="muted">A word you miss returns a few steps later until you get it.</td></tr>
        <tr><td class="han">隔</td><td><b>Spaced reviews</b></td><td class="muted">Learned words come back after 1, 2, 4, 7 and 14 days, just as you are about to forget.</td></tr>
      </table>
      <p style="margin:0">A finished camp puts its words on the mastery boxes (1, or 2 with no misses), so learning raises the island's level. Practice in the Words games takes it from there.</p>
    </div></details>
  </section>`;
  bindTrack(app);
  $("#lisles", app).onclick = (e) => { const b = e.target.closest("[data-lisle]"); if (!b) return; settings().learnIsland = b.dataset.lisle; Store.save(); render(); };
  const lg = $("#learn-go", app); if (lg) lg.onclick = () => startLearn(cur.name, "learn");
  const rg = $("#review-go", app); if (rg) rg.onclick = () => startLearn(cur.name, "review");
}

/* ----- a session ----- */
function learnSteps(words) {
  const steps = [];
  words.forEach((w, k) => {
    steps.push({ t: "meet", w });
    if (k > 0) steps.push({ t: "rec", w: words[k - 1] }); // test the previous word once a new one has been met
  });
  steps.push({ t: "rec", w: words[words.length - 1] });
  if (words.length >= 2) steps.push({ t: "match" });
  for (const w of shuffle(words)) steps.push({ t: "recall", w });
  shuffle(words).forEach((w, k) => steps.push({ t: k % 2 && toneVariants(w.pinyin).length ? "tone" : "listen", w }));
  return steps;
}
function startLearn(islandName, mode) {
  const isl = learnIslands().find((i) => i.name === islandName); if (!isl) return;
  const words = mode === "learn" ? isl.fresh.slice(0, CAMP_SIZE) : isl.due.sort((a, b) => dueAt(a.hanzi) - dueAt(b.hanzi)).slice(0, 10);
  if (!words.length) return toast(mode === "learn" ? "No new words left here." : "Nothing due right now.");
  const steps = mode === "learn" ? learnSteps(words) : shuffle(words).map((w) => ({ t: Math.random() < 0.5 ? "rec" : "recall", w }));
  S.learn = { island: isl, mode, words, steps, i: 0, misses: {}, graded: new Set(), requeued: {}, before: islandLevel(isl.words), done: false };
  go("learn");
  renderStep();
}
function learnOptions(w, field) {
  const L = S.learn;
  const pool = [...L.words, ...shuffle(L.island.words), ...shuffle(allWords())];
  const out = [w[field]]; const seen = new Set([norm(w[field])]);
  for (const x of pool) { if (out.length >= 4) break; if (seen.has(norm(x[field]))) continue; seen.add(norm(x[field])); out.push(x[field]); }
  return shuffle(out);
}
function learnHead() {
  const L = S.learn;
  return `<div class="study-head">
    <button class="btn ghost" id="lquit" style="padding:6px 10px">✕ End</button>
    <div class="meter" role="progressbar" aria-valuenow="${L.i}" aria-valuemax="${L.steps.length}"><i style="width:${(L.i / L.steps.length) * 100}%"></i></div>
    <span class="pix">${L.mode === "learn" ? "学" : "复"}</span></div>`;
}
function viewLearnSession(app) {
  const L = S.learn;
  if (!L) return go("study", null, false);
  if (L.done) return renderLearnEnd(app);
  const st = L.steps[L.i]; if (!st) return;
  let body = "";
  if (st.t === "meet") {
    const n = L.words.indexOf(st.w) + 1;
    const cs = chars(st.w.hanzi).filter((c, i, a) => a.indexOf(c) === i);
    body = `<div class="prompt-card meet"><span class="ask">New word ${n}/${L.words.length}</span>
        <div class="big-han">${esc(st.w.hanzi)}</div><div class="big-py">${esc(st.w.pinyin)}</div><div class="big-en">${esc(st.w.en)}</div>
        ${speakBtn(st.w.hanzi)}</div>
      <div class="meet-parts">${cs.map((c) => CHARS[c] ? `<div class="meet-char">${formulaHTML(c, false)}<p class="story">${esc(CHARS[c].story)}</p></div>` : "").join("")}</div>
      <div class="actions"><button class="btn solid" id="lnext">Got it →</button></div>`;
  } else if (st.t === "match") {
    st.left ||= shuffle(L.words.map((w) => w.hanzi)); st.right ||= shuffle(L.words.map((w) => w.en)); st.paired ||= [];
    body = `<div class="prompt-card game-card"><span class="ask">配对 · Match the pairs</span><span class="muted">Tap a character, then its meaning</span></div>
      <div class="match" id="match"><div class="mcol">${st.left.map((h) => `<button class="mtile han" data-mh="${esc(h)}">${esc(h)}</button>`).join("")}</div>
      <div class="mcol">${st.right.map((e) => `<button class="mtile" data-me="${esc(e)}">${esc(e)}</button>`).join("")}</div></div>`;
  } else {
    const ask = { rec: "What does it mean?", recall: "Which character?", listen: "Which character do you hear?", tone: "How is it pronounced?" }[st.t];
    const prompt = { rec: `<div class="big-han">${esc(st.w.hanzi)}</div>`, recall: `<div class="big-en">${esc(st.w.en)}</div>`, listen: speakBtn(st.w.hanzi, "huge"), tone: `<div class="big-han">${esc(st.w.hanzi)}</div><span class="muted">${esc(st.w.en)}</span>` }[st.t];
    if (!st.opts) st.opts = st.t === "rec" ? learnOptions(st.w, "en") : st.t === "tone" ? shuffle([st.w.pinyin, ...shuffle(toneVariants(st.w.pinyin)).slice(0, 3)]) : learnOptions(st.w, "hanzi");
    const han = st.t === "recall" || st.t === "listen";
    body = `<div class="prompt-card"><span class="ask">${ask}</span>${prompt}</div>
      <div class="options" id="lopts">${st.opts.map((o, i) => `<button class="opt" data-lo="${i}"><span class="key">${i + 1}</span><span class="val ${han ? "han" : ""}">${esc(o)}</span></button>`).join("")}</div>`;
  }
  app.innerHTML = learnHead() + `<div id="lq">${body}</div>`;
  $("#lquit", app).onclick = () => { S.learn = null; go("study", null, false); };
  if (st.t === "meet") { speak(st.w.hanzi); $("#lnext", app).onclick = nextStep; }
  else if (st.t === "match") bindMatch(app, st);
  else {
    if (st.t === "listen") speak(st.w.hanzi);
    bindLearnOpts(app, st);
  }
}
function renderStep() { viewLearnSession($("#app")); window.scrollTo(0, 0); }
function nextStep() { const L = S.learn; L.i++; if (L.i >= L.steps.length) return finishLearn(); renderStep(); }
function miss(w, st) {
  const L = S.learn;
  L.misses[w.hanzi] = (L.misses[w.hanzi] || 0) + 1;
  // learning step: ask again a few steps later (at most twice per word and type)
  const key = w.hanzi + st.t; L.requeued[key] = (L.requeued[key] || 0) + 1;
  if (L.requeued[key] <= 2) L.steps.splice(Math.min(L.steps.length, L.i + 3), 0, { t: st.t, w });
}
function bindLearnOpts(app, st) {
  const L = S.learn;
  const right = st.t === "rec" ? st.w.en : st.t === "tone" ? st.w.pinyin : st.w.hanzi;
  $("#lopts", app).onclick = (e) => {
    const b = e.target.closest("[data-lo]"); if (!b || st.done) return;
    st.done = true;
    const ok = st.opts[+b.dataset.lo] === right;
    $$("#lopts .opt", app).forEach((o) => { o.disabled = true; if (st.opts[+o.dataset.lo] === right) o.classList.add("right"); });
    if (L.mode === "review" && !L.graded.has(st.w.hanzi)) { L.graded.add(st.w.hanzi); grade(st.w.hanzi, ok); }
    if (ok) {
      if (st.t !== "listen") speak(st.w.hanzi);
      setTimeout(() => { if (S.learn === L && L.steps[L.i] === st) nextStep(); }, 750);
      return;
    }
    b.classList.add("wrong"); miss(st.w, st); speak(st.w.hanzi);
    const fb = document.createElement("div"); fb.className = "feedback bad";
    fb.innerHTML = `<div class="verdict">✗ IT'S THIS ONE</div><div class="ans"><span class="han">${esc(st.w.hanzi)}</span><span style="font-size:18px">${esc(st.w.pinyin)}</span><span>${esc(st.w.en)}</span></div>
      <div style="font-size:13px;display:grid;gap:2px">${compactBreakdown(st.w)}</div><div class="muted" style="font-size:13px">It will come back in a moment.</div>`;
    const act = document.createElement("div"); act.className = "actions"; act.innerHTML = `<button class="btn solid" id="lnext">Next →</button>`;
    $("#lq", app).append(fb, act);
    $("#lnext", app).onclick = nextStep; $("#lnext", app).focus({ preventScroll: true });
    fb.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
}
function bindMatch(app, st) {
  const L = S.learn; let selH = null, selE = null;
  const byH = (h) => L.words.find((w) => w.hanzi === h);
  const refresh = () => {
    $$("[data-mh]", app).forEach((b) => { const done = st.paired.includes(b.dataset.mh); b.disabled = done; b.classList.toggle("done", done); b.setAttribute("aria-pressed", b.dataset.mh === selH); });
    $$("[data-me]", app).forEach((b) => { const done = st.paired.some((h) => byH(h).en === b.dataset.me); b.disabled = done; b.classList.toggle("done", done); b.setAttribute("aria-pressed", b.dataset.me === selE); });
  };
  const tryPair = () => {
    if (!selH || !selE) return;
    const w = byH(selH);
    if (w.en === selE) { st.paired.push(selH); speak(selH); }
    else {
      L.misses[w.hanzi] = (L.misses[w.hanzi] || 0) + 1;
      const bh = $(`[data-mh="${CSS.escape(selH)}"]`, app), be = $(`[data-me="${CSS.escape(selE)}"]`, app);
      [bh, be].forEach((b) => { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 400); });
    }
    selH = selE = null; refresh();
    if (st.paired.length === L.words.length) setTimeout(() => { if (S.learn === L && L.steps[L.i] === st) nextStep(); }, 600);
  };
  $("#match", app).onclick = (e) => {
    const h = e.target.closest("[data-mh]"), en = e.target.closest("[data-me]");
    if (h && !h.disabled) { selH = h.dataset.mh; tryPair(); refresh(); }
    if (en && !en.disabled) { selE = en.dataset.me; tryPair(); refresh(); }
  };
  refresh();
}
function finishLearn() {
  const L = S.learn; L.done = true;
  if (L.mode === "learn") {
    const now = Date.now();
    for (const w of L.words) {
      const p = { ...prog(w.hanzi) };
      p.b = Math.max(p.b, L.misses[w.hanzi] ? 1 : 2); p.c++; p.t = now;
      Store.data.progress[w.hanzi] = p;
    }
    Store.save();
  }
  L.after = islandLevel(L.island.words);
  renderStep();
}
function renderLearnEnd(app) {
  const L = S.learn;
  const missTotal = Object.values(L.misses).reduce((a, b) => a + b, 0);
  const stars = missTotal === 0 ? 3 : missTotal <= 2 ? 2 : 1;
  const fresh = learnIslands().find((i) => i.name === L.island.name);
  const isLearn = L.mode === "learn";
  const right = isLearn ? 0 : L.words.filter((w) => !L.misses[w.hanzi]).length;
  app.innerHTML = `<section class="block">
    <div class="eyebrow">${esc(L.island.name)} · ${isLearn ? "Camp" : "Review"}</div>
    <h1 class="pix" style="font-size:44px">${isLearn ? "CAMP SET UP" : "REVIEW DONE"}</h1>
    ${isLearn ? `<div class="stars" aria-label="${stars} of 3 stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>` : `<div class="row"><span class="score">${right}/${L.words.length}</span><span class="muted">remembered first time</span></div>`}
    <div class="camp-gain"><div class="spread"><span class="eyebrow">Island mastery</span><span class="pix">${L.before.pct}% → ${L.after.pct}%</span></div>
      <div class="bar"><i style="width:${L.after.pct}%"></i><b style="left:${L.before.pct}%"></b></div>
      ${L.after.lv > L.before.lv ? `<div class="pix" style="font-size:22px">LEVEL UP · LV ${L.after.lv} ${LEVELS[L.after.lv].en.toUpperCase()}</div>` : ""}</div>
    <div class="missed">${L.words.map(wordItem).join("")}</div>
    <div class="actions">
      ${isLearn && fresh?.fresh.length ? `<button class="btn solid" id="lmore">Next camp →</button>` : ""}
      <button class="btn ${isLearn && fresh?.fresh.length ? "" : "solid"}" id="lhome">Back</button></div>
  </section>`;
  const more = $("#lmore", app); if (more) more.onclick = () => startLearn(L.island.name, "learn");
  $("#lhome", app).onclick = () => { S.learn = null; go("study", null, false); };
}

document.addEventListener("keydown", (e) => {
  if (S.view !== "learn" || !S.learn || S.learn.done || e.metaKey || e.ctrlKey || e.altKey) return;
  const st = S.learn.steps[S.learn.i]; if (!st) return;
  if (e.key === "Enter") { const b = $("#lnext"); if (b) { e.preventDefault(); b.click(); } return; }
  if (/^[1-4]$/.test(e.key) && st.opts && !st.done) { const b = $$("#lopts .opt")[+e.key - 1]; if (b) { e.preventDefault(); b.click(); } }
});
