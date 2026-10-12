/*
 * Colours-MIX (nouvelle version) - page, input, drawing and game flow.
 * Same rules, timings, sprites and sounds as the original program (measured
 * under Wine, see ../algorithme.html and ../game.js); the rules and the computer
 * player live in engine.js (run in a Web Worker when possible).
 */
(function () {
  'use strict';

  var E = window.CMEngine;
  var N = E.N, RED = E.RED, ORANGE = E.ORANGE, YEL = E.YEL, GREEN = E.GREEN, BLUE = E.BLUE, MAGENTA = E.MAGENTA;
  var BROWN = E.BROWN, BLACK = E.BLACK, APPS = E.APPS, OWN = E.OWN;
  var idx = E.idx, colOf = E.colOf, rowOf = E.rowOf, isRing = E.isRing, inside = E.inside;
  var mix = E.mix, lineFrom = E.lineFrom, ringPath = E.ringPath, RING = E.RING, RING_POS = E.RING_POS;

  var CELL = 24, OX = 48, OY = 48, SIZE = 408;
  var KEY = [184, 10, 70];
  var STEP_MS = 300;          // walking (players and computer): 4 px every 50 ms
  var CROSS_MS = 300;         // crossing: same speed
  var GREY_MS = 480;          // grey globule: 4 px every 80 ms, then a pause of 0 to 500 ms
  var RISE_MS = 1280;         // pyramid rising (16 frames); the gauge waits for it
  var GAUGE_PX = 80;
  var END_MS = 2500;
  var NAMES = ['rouge', 'jaune'];
  var COLOR_NAMES = ['rouge', 'orange', 'jaune', 'vert', 'bleu', 'magenta', 'brun', 'noir'];
  var SWATCH = ['#e02020', '#f08000', '#f0e000', '#20c020', '#2040e0', '#e020e0', '#8a4a36', '#111'];

  // Sprite sheet rectangles (same sheet as the original)
  var TILE = [];
  TILE[RED] = [24, 0]; TILE[MAGENTA] = [48, 0]; TILE[BLUE] = [24, 24]; TILE[GREEN] = [48, 24];
  TILE[YEL] = [24, 48]; TILE[ORANGE] = [48, 48]; TILE[BROWN] = [0, 72]; TILE[BLACK] = [0, 48];
  var NET = [0, 24];                        // bevel and diamond net drawn over every cell
  var DOT = []; DOT[RED] = 0; DOT[BLUE] = 1; DOT[YEL] = 2;   // indicator tile index
  var ROUNDS_SPR = [208, 0, 82, 80];
  var GLOB_X = [368, 512, 656];
  var EXPLODE_X = [152, 96];
  var SMILE_X = [180, 124];
  var SMOKE_X = 288;
  var PYRAMID = [0, 0], RISE_X = 344, RISE_Y = 24;

  // Levels: gauge speed (ms per pixel, as in the original), search depth, randomness, budget.
  var LEVELS = [
    { name: 'Débutant', pxMs: 240, depth: 1, noise: 2, budget: 100, info: 'Jauge de 19,2 s par tour, comme le niveau débutant de l\'original. Ordinateur qui se trompe parfois.' },
    { name: 'Confirmé', pxMs: 120, depth: 2, noise: 0, budget: 250, info: 'Jauge de 9,6 s par tour, comme le niveau confirmé de l\'original. Ordinateur qui prévoit votre réponse.' },
    { name: 'Expert', pxMs: 120, depth: 3, noise: 0, budget: 800, info: 'Jauge de 9,6 s (comme confirmé). Ordinateur qui prévoit votre réponse et sa propre réplique.' }
  ];
  function gaugeMs() { return GAUGE_PX * LEVELS[G.level].pxMs; }

  // ---------- Page ----------

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };
  var overlay = $('overlay'), toastsEl = $('toasts');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sheet = null;
  Lehcim.initPage();
  var fit = Lehcim.fitCanvas(canvas);

  // ---------- Settings (persisted) ----------

  var SKEY = 'lehcim.colorsmix.nv.settings';
  var settings = { mode: 1, level: 0, music: true, preview: true, aid: false };
  try { var saved = JSON.parse(localStorage.getItem(SKEY)); if (saved) for (var sk in settings) if (saved[sk] !== undefined) settings[sk] = saved[sk]; } catch (e) { /* ignore */ }
  if (!LEVELS[settings.level]) settings.level = 0;
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }

  // ---------- Sounds and music ----------

  var SND = {};
  [1, 2, 3, 4, 5].forEach(function (n) { SND['s' + n] = '../assets/sounds/' + n + '.wav'; });
  var soundsLoaded = false;
  function loadSoundsOnce() { if (!soundsLoaded) { soundsLoaded = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSoundsOnce, { once: true }); });
  var music = new Audio('../assets/sounds/6.wav');
  music.loop = true; music.volume = 0.35; music.preload = 'none';

  function updateMusic() {
    var want = settings.music && !Lehcim.isMuted() && !paused && G.phase !== 'idle' && G.phase !== 'over';
    if (want && music.paused) { var p = music.play(); if (p && p.catch) p.catch(function () { /* autoplay refused */ }); }
    else if (!want && !music.paused) music.pause();
  }
  var muteBtn = $('muteBtn');
  function showMute() {
    var m = Lehcim.isMuted();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', m ? 'Rétablir le son' : 'Couper le son');
    muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  }
  muteBtn.addEventListener('click', function () { Lehcim.setMuted(!Lehcim.isMuted()); showMute(); updateMusic(); });
  showMute();

  // ---------- Toasts ----------

  function toast(text, ms) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    toastsEl.appendChild(t);
    while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2200);
  }

  // ---------- Clock with pause ----------

  var paused = false, pauseAt = 0, pauseTotal = 0;
  function clock() { return (paused ? pauseAt : performance.now()) - pauseTotal; }

  // ---------- Game state ----------

  var G = {
    phase: 'idle',            // idle, play, cross, end, msg, over
    colors: new Uint8Array(N * N),
    pyr: [null, null],        // one pyramid per globule: {cell, t0}
    grey: null,
    players: [],
    turn: 1, gaugeStart: 0, frozen: null, turnId: 0,
    round: 1, roundStart: 0, results: [],
    crossing: null, effects: [], endAt: 0,
    twoPlayers: false, level: 0, ver: 0,
    log: [], hint: null, hover: null
  };

  function makePlayer(k, cell, human) {
    return { k: k, cell: cell, from: cell, moveT: -1e9, moveMs: STEP_MS, dir: k === 0 ? 2 : 3, app: BLUE,
      human: human, target: null, hold: null, queued: null, plan: null, visible: true,
      thinkAt: 0, pending: false, crossQueued: false };
  }

  // Start of a round: 11 x 11 cells drawn among red, orange, yellow, green and
  // magenta, brown 3 x 3 centre, grey globule in the middle, pyramids in the corners.
  function newBoard(now) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var col;
      if (isRing(c, r)) col = BLACK;
      else if (c >= 5 && c <= 7 && r >= 5 && r <= 7) col = BROWN;
      else col = E.START_COLOURS[(Math.random() * 5) | 0];
      G.colors[idx(c, r)] = col;
    }
    var mid = idx(6, 6);
    G.grey = { cell: mid, from: mid, t0: 0, moving: false, next: now + RISE_MS + 300, dir: 2, gone: false };
    G.pyr = [{ cell: idx(0, 0), t0: now }, { cell: idx(N - 1, N - 1), t0: now }];
    G.players = [makePlayer(0, idx(6, 0), G.twoPlayers), makePlayer(1, idx(N - 1, 6), true)];
    G.ver++;
  }

  // ---------- Round flow ----------

  function newGame() {
    G.twoPlayers = settings.mode === 2;
    G.level = settings.level;
    G.results = [];
    G.log = [];
    renderLog();
    setPaused(false);
    startRound(1);
  }

  function startRound(n) {
    hideOverlay();
    var now = clock();
    G.round = n;
    newBoard(now);
    G.crossing = null; G.effects = []; G.hint = null; G.frozen = null;
    G.roundStart = now;
    G.phase = 'play';
    Lehcim.play('s3', 0.6);
    updateMusic();
    addLog(null, 'Manche ' + n + ' : le ' + NAMES[n === 1 ? 1 : 0] + ' commence');
    startTurn(n === 1 ? 1 : 0, now);   // yellow starts round 1, red round 2
  }

  // A turn: the gauge stays full while the last pyramid rises, then empties.
  function startTurn(k, now) {
    G.turn = k;
    G.gaugeStart = now + RISE_MS;
    G.frozen = null;
    G.turnId++;
    G.hint = null;
    var p = G.players[k];
    p.target = null; p.plan = null; p.pending = false; p.crossQueued = false; p.hold = null; p.queued = null;
    if (!p.human) p.thinkAt = G.gaugeStart + 150;
    else announceTurn(p);
  }

  function announceTurn(p) {
    if (G.twoPlayers) toast('Au globule ' + NAMES[p.k], 1200);
    else if (p.human) toast('À vous de jouer', 1100);
  }

  // Milliseconds left in the gauge.
  function gaugeLeft(now) {
    if (G.frozen !== null) return G.frozen;
    if (now <= G.gaugeStart) return gaugeMs();
    return Math.max(0, gaugeMs() - (now - G.gaugeStart));
  }

  function roundSeconds(now) { return Math.max(0, Math.floor((now - G.roundStart) / 1000)); }

  function endRound(winner, now, why) {
    var secs = roundSeconds(now);
    G.results.push({ winner: winner, secs: secs, why: why });
    G.phase = 'end';
    G.endAt = now + END_MS;
    G.crossing = null; G.hint = null;
    G.pyr = [null, null];
    var gr = G.grey;
    addEffect(SMOKE_X, cellX(gr.cell), cellY(gr.cell), now, 70, false);
    gr.gone = true;
    var lose = G.players[1 - winner], win = G.players[winner];
    addEffect(EXPLODE_X[lose.k], cellX(lose.cell), cellY(lose.cell), now + 150, 70, false);
    lose.visible = false;
    addEffect(SMILE_X[win.k], cellX(win.cell), cellY(win.cell), now + 300, 80, true);
    win.visible = false;
    Lehcim.play('s1', 0.8);
    addLog(winner, 'Le ' + NAMES[winner] + ' gagne la manche ' + G.round + ' en ' + secs + ' s' + (why === 'time' ? ' (temps écoulé pour le ' + NAMES[1 - winner] + ')' : ''));
    if (!G.twoPlayers && winner === 1) recordBest(secs);
  }

  // Messages of the original (title, then text).
  function finishRound() {
    G.phase = 'msg';
    var res = G.results[G.results.length - 1];
    if (G.round === 1) {
      showOverlay('Le globule ' + NAMES[res.winner] + ' a gagné en ' + res.secs + ' secondes .',
        '<p>La première manche est terminée .</p>' + (res.why === 'time' ? '<p class="small">La jauge du globule ' + NAMES[1 - res.winner] + ' s\'est vidée.</p>' : ''),
        [{ label: 'Manche 2', primary: true, fn: function () { if (G.phase === 'msg') startRound(2); } }]);
      return;
    }
    var a = G.results[0], b = G.results[1], title, text, w;
    if (a.winner === b.winner) {
      w = a.winner;
      title = 'Le globule ' + NAMES[w] + ' a gagné les 2 manches .';
      text = 'Le globule ' + NAMES[w] + ' a donc gagné la partie .';
    } else if (a.secs === b.secs) {
      w = -1;
      title = 'Chacun a gagné sa manche dans le même temps !';
      text = 'Partie nulle.';
    } else {
      var red = a.winner === 0 ? a : b, yel = a.winner === 1 ? a : b;
      w = red.secs < yel.secs ? 0 : 1;
      title = w === 0 ? 'Le globule rouge a gagné en ' + red.secs + ' s., le jaune en ' + yel.secs + ' s.'
        : 'Le globule jaune a gagné en ' + yel.secs + ' s., le rouge en ' + red.secs + ' s.';
      text = 'Le globule ' + NAMES[w] + ' a donc gagné la partie .';
    }
    if (!G.twoPlayers) recordGame(w === 1 ? 'win' : w === 0 ? 'loss' : 'draw');
    addLog(w < 0 ? null : w, text);
    Lehcim.message(title + '\n\n' + text).then(function () {
      if (G.phase !== 'msg') return;
      G.phase = 'over';
      updateMusic();
      showOverlay(text, '<p>' + title + '</p>', [
        { label: 'Rejouer', primary: true, fn: newGame },
        { label: 'Réglages', fn: function () { syncSettingsUI(); $('settings').showModal(); } }
      ]);
    });
  }

  // ---------- Moves ----------

  function pyrCells() {
    var out = [];
    G.pyr.forEach(function (q) { if (q) out.push(q.cell); });
    return out;
  }
  // Cells a walking globule may not enter: pyramids and the other globule.
  function walkBlocks(p) { return pyrCells().concat([G.players[1 - p.k].cell]); }
  // Ring cells the grey globule cannot leave through: pyramids and globules.
  function exitBlocks() { return pyrCells().concat([G.players[0].cell, G.players[1].cell]); }

  // Why player p cannot cross from cell s (null when allowed).
  function lineProblem(p, s) {
    var L = lineFrom(s);
    if (!L) return isRing(colOf(s), rowOf(s)) ? 'Pas de traversée depuis un coin' : 'Placez-vous sur la zone noire';
    var pc = pyrCells();
    if (pc.indexOf(L.end) >= 0) return G.pyr[p.k] && G.pyr[p.k].cell === L.end ? 'Pas deux fois de suite au même endroit (votre pyramide est à l\'arrivée)' : 'Une pyramide occupe la case d\'arrivée';
    if (G.players[1 - p.k].cell === L.end) return 'L\'autre globule occupe la case d\'arrivée';
    if (s !== p.cell && !ringPath(p.cell, s, walkBlocks(p))) return 'Chemin bloqué sur la zone noire';
    return null;
  }
  function crossProblem(p) { return lineProblem(p, p.cell); }

  function lineName(L) { return L.dc ? 'ligne ' + rowOf(L.start) : 'colonne ' + colOf(L.start); }

  function moving(p, now) { return now - p.moveT < p.moveMs; }

  function tryCross(p, now) {
    if (G.crossing || moving(p, now)) { if (p.human) p.crossQueued = true; return false; }
    var why = crossProblem(p);
    if (why) { if (p.human) { toast(why); Lehcim.play('s5', 0.3); } return false; }
    var L = lineFrom(p.cell);
    G.frozen = gaugeLeft(now);          // the gauge stops during the crossing
    G.pyr[p.k] = null;                  // the previous pyramid of this globule disappears
    G.crossing = { p: p, line: L, k: -1, t: now - CROSS_MS };
    p.dir = L.dc > 0 ? 1 : L.dc < 0 ? 3 : L.dr > 0 ? 2 : 0;
    p.target = null; p.plan = null; p.crossQueued = false; p.hold = null; p.queued = null;
    G.hint = null;
    G.phase = 'cross';
    Lehcim.play('s2', 0.6);
    addLog(p.k, 'Le ' + NAMES[p.k] + ' traverse la ' + lineName(L) + ' en ' + COLOR_NAMES[p.app], p.app);
    return true;
  }

  function stepCross(now) {
    var X = G.crossing;
    while (G.crossing && now - X.t >= CROSS_MS) {
      X.t += CROSS_MS; X.k++;
      var p = X.p, L = X.line;
      if (X.k < L.cells.length) {
        var cell = L.cells[X.k];
        p.from = p.cell; p.cell = cell; p.moveT = X.t; p.moveMs = CROSS_MS;
        G.colors[cell] = mix(G.colors[cell], p.app);
        G.ver++;
      } else if (X.k === L.cells.length) {
        p.from = p.cell; p.cell = L.end; p.moveT = X.t; p.moveMs = CROSS_MS;
        G.ver++;
      } else {
        G.crossing = null;
        p.dir = inwardDir(p.cell);
        G.pyr[p.k] = { cell: L.start, t0: now };   // a pyramid rises on the start cell
        G.phase = 'play';
        G.ver++;
        startTurn(1 - p.k, now);
      }
    }
  }

  function inwardDir(i) {
    var c = colOf(i), r = rowOf(i);
    if (r === 0) return 2; if (r === N - 1) return 0; if (c === 0) return 1; if (c === N - 1) return 3; return 2;
  }

  // One step on the black ring (corners included).
  function walk(p, dc, dr, now) {
    var c = colOf(p.cell) + dc, r = rowOf(p.cell) + dr;
    if (!inside(c, r) || !isRing(c, r)) return false;
    var ni = idx(c, r);
    if (walkBlocks(p).indexOf(ni) >= 0) return false;
    p.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
    p.from = p.cell; p.cell = ni; p.moveT = now; p.moveMs = STEP_MS;
    G.ver++;
    return true;
  }
  function walkTo(p, ni, now) { return walk(p, colOf(ni) - colOf(p.cell), rowOf(ni) - rowOf(p.cell), now); }
  function walkRing(p, d, now) {
    var L = RING.length, ni = RING[(RING_POS[p.cell] + d + L) % L];
    return walkTo(p, ni, now);
  }
  function walkAction(p, a, now) {
    if (a === 'cw' || a === 'ccw') return walkRing(p, a === 'cw' ? 1 : -1, now);
    return walk(p, a[0], a[1], now);
  }

  function setColour(p, a) {
    if (p.app === a) return;
    p.app = a;
    Lehcim.play('s4', 0.5);
    renderDots();
  }
  // Each globule toggles between blue and its own colour.
  function changeColour(p) { setColour(p, p.app === BLUE ? OWN[p.k] : BLUE); }

  // ---------- Grey globule ----------

  function updateGrey(now) {
    var gr = G.grey;
    if (gr.moving && now - gr.t0 >= GREY_MS) {
      gr.moving = false;
      gr.next = now + Math.random() * 500;
      var c = colOf(gr.cell), r = rowOf(gr.cell);
      if (isRing(c, r)) { endRound(E.zoneOwner(c, r), now, 'grey'); return; }
    }
    if (!gr.moving && now >= gr.next) {
      var opts = greyOptions(gr.cell);
      if (!opts.length) { gr.next = now + 200; return; }
      var ni = opts[(Math.random() * opts.length) | 0];
      var dc = colOf(ni) - colOf(gr.cell), dr = rowOf(ni) - rowOf(gr.cell);
      gr.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
      gr.from = gr.cell; gr.cell = ni; gr.t0 = now; gr.moving = true;
      G.ver++;
    }
  }

  // Neighbours the grey globule may enter: same colour as its own cell, or black,
  // and free of pyramids and globules.
  function greyOptions(i) {
    var c = colOf(i), r = rowOf(i), col = G.colors[i], out = [], blocks = exitBlocks();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nc = c + d[0], nr = r + d[1];
      if (!inside(nc, nr)) return;
      var ni = idx(nc, nr);
      if (blocks.indexOf(ni) >= 0) return;
      if (G.colors[ni] === BLACK || G.colors[ni] === col) out.push(ni);
    });
    return out;
  }

  // ---------- Computer player: Web Worker, or time-sliced search as fallback ----------

  var AI = { worker: null, broken: false, seq: 0, pending: {}, mode: 'tranches' };
  (function initWorker() {
    try {
      var w = new Worker('ai-worker.js');
      w.onmessage = function (e) {
        var job = AI.pending[e.data.id];
        if (!job) return;
        delete AI.pending[e.data.id];
        clearTimeout(job.timer);
        job.cb(e.data.result);
      };
      w.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        workerFailed();
      };
      AI.worker = w; AI.mode = 'worker';
    } catch (err) { AI.worker = null; AI.mode = 'tranches'; }
  })();

  function workerFailed() {
    AI.broken = true; AI.mode = 'tranches';
    if (AI.worker) { try { AI.worker.terminate(); } catch (e) { /* ignore */ } }
    AI.worker = null;
    var jobs = AI.pending; AI.pending = {};
    Object.keys(jobs).forEach(function (id) { clearTimeout(jobs[id].timer); sliceSearch(jobs[id].st, jobs[id].cb); });
  }

  // Main-thread fallback: the same search, cut into slices of a few ms so the
  // animation keeps running.
  function sliceSearch(st, cb) {
    var s = new E.Search(st);
    (function tick() { if (s.step(6)) cb(s.result()); else setTimeout(tick, 0); })();
  }

  function think(st, cb) {
    if (AI.worker && !AI.broken) {
      var id = ++AI.seq;
      var job = { st: st, cb: cb };
      job.timer = setTimeout(function () { if (AI.pending[id]) workerFailed(); }, 4000);
      AI.pending[id] = job;
      var msg = {}; for (var k in st) msg[k] = st[k];
      msg.colors = Array.prototype.slice.call(st.colors);
      try { AI.worker.postMessage({ id: id, st: msg }); } catch (e) { workerFailed(); }
    } else sliceSearch(st, cb);
  }

  function searchState(p, now, depth, noise, budget) {
    var o = G.players[1 - p.k];
    // time left to walk: the gauge, minus the colour change, the reaction and the search
    var left = gaugeLeft(now) + Math.max(0, G.gaugeStart - now);
    var margin = p.human ? 2500 : 1200 + budget;
    return {
      colors: new Uint8Array(G.colors), greyCell: G.grey.cell,
      me: { k: p.k, cell: p.cell, app: p.app, pyr: G.pyr[p.k] ? G.pyr[p.k].cell : -1 },
      other: { k: o.k, cell: o.cell, pyr: G.pyr[o.k] ? G.pyr[o.k].cell : -1 },
      maxSteps: Math.max(0, Math.floor((left - margin) / STEP_MS)),
      otherSteps: Math.floor((gaugeMs() + RISE_MS - 1800) / STEP_MS),
      depth: depth, noise: noise, budgetMs: budget
    };
  }

  function updateAI(p, now) {
    if (now < p.thinkAt || p.pending || moving(p, now)) return;
    if (!p.plan) {
      var lv = LEVELS[G.level], turnId = G.turnId;
      p.pending = true;
      think(searchState(p, now, lv.depth, lv.noise, lv.budget), function (res) {
        if (G.turnId !== turnId || (G.phase !== 'play' && G.phase !== 'cross')) return;
        p.pending = false;
        var t = clock();
        if (!res) { p.thinkAt = t + 400; return; }
        p.plan = { start: res.start, app: res.app };
        p.thinkAt = t + 100;
        AI.last = res.stats;
      });
      return;
    }
    if (p.cell !== p.plan.start) {
      var path = ringPath(p.cell, p.plan.start, walkBlocks(p));
      if (!path || !path.length || !walkTo(p, path[0], now)) { p.plan = null; p.thinkAt = now + 200; }
      return;
    }
    if (p.app !== p.plan.app) { changeColour(p); p.thinkAt = now + 250; return; }
    if (!tryCross(p, now)) { p.plan = null; p.thinkAt = now + 200; }
  }

  // Hint for the human whose turn it is (the expert search).
  var hintBusy = false;
  function askHint() {
    if (G.phase !== 'play' || paused) return;
    var p = G.players[G.turn];
    if (!p.human) { toast('Attendez votre tour pour demander un indice'); return; }
    if (hintBusy) return;
    hintBusy = true;
    var turnId = G.turnId;
    $('hintBtn').disabled = true;
    think(searchState(p, clock(), 3, 0, 400), function (res) {
      hintBusy = false;
      $('hintBtn').disabled = false;
      if (G.turnId !== turnId || G.phase !== 'play') return;
      if (!res) { toast('Aucune traversée possible à temps'); return; }
      G.hint = { start: res.start, app: res.app };
      var L = lineFrom(res.start);
      toast('Indice : ' + lineName(L) + ' en ' + COLOR_NAMES[res.app] + ' (case marquée)', 3000);
    });
  }

  // ---------- Aid: grey region and probabilities (cached per board version) ----------

  var aidCache = { key: '', data: null }, prevCache = { key: '', data: null };
  function currentAid() {
    if (!G.grey || G.grey.gone) return null;
    var key = G.ver + ':' + G.grey.cell;
    if (aidCache.key !== key) aidCache = { key: key, data: E.analyse(G.colors, G.grey.cell, exitBlocks()) };
    return aidCache.data;
  }
  // Effect of crossing the line from 'cell' with colour 'app' for player p: the
  // globule then stands on the arrival cell and its pyramid on the start cell.
  function previewAid(p, cell, app) {
    var L = lineFrom(cell);
    if (!L || !G.grey || G.grey.gone) return null;
    var key = G.ver + ':' + G.grey.cell + ':' + cell + ':' + app;
    if (prevCache.key !== key) {
      var after = E.applyLine(G.colors, L, app), o = G.players[1 - p.k];
      var blk = [L.start, L.end, o.cell];
      if (G.pyr[o.k]) blk.push(G.pyr[o.k].cell);
      prevCache = { key: key, data: E.analyse(after, G.grey.cell, blk) };
    }
    return prevCache.data;
  }

  // ---------- Pause ----------

  function setPaused(v) {
    if (v === paused) return;
    if (v) {
      if (G.phase !== 'play' && G.phase !== 'cross') return;
      paused = true; pauseAt = performance.now();
      G.players.forEach(function (p) { p.hold = null; });
      showOverlay('Pause', '<p>Le globule gris attend votre retour.</p>', [{ label: 'Reprendre', primary: true, fn: function () { setPaused(false); } }]);
    } else {
      paused = false; pauseTotal += performance.now() - pauseAt;
      if (overlay.dataset.kind === 'Pause') hideOverlay();
    }
    $('pauseBtn').textContent = paused ? '▶ Reprendre' : '⏸ Pause';
    updateMusic();
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) setPaused(true); });

  // ---------- Overlay ----------

  function showOverlay(title, html, buttons) {
    overlay.innerHTML = '';
    overlay.dataset.kind = title;
    var h = document.createElement('h2'); h.textContent = title; overlay.appendChild(h);
    var body = document.createElement('div'); body.innerHTML = html; body.style.display = 'grid'; body.style.gap = '8px'; body.style.justifyItems = 'center';
    overlay.appendChild(body);
    var row = document.createElement('div'); row.className = 'row';
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', function () { el.blur(); b.fn(); });
      row.appendChild(el);
    });
    overlay.appendChild(row);
    overlay.hidden = false;
    var first = row.querySelector('.primary');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 30);
  }
  function hideOverlay() { overlay.hidden = true; overlay.dataset.kind = ''; }

  function startScreen() {
    showOverlay('Colours-MIX', '<ul>' +
      '<li>Vous êtes le <b>globule jaune</b> : amenez le globule gris dans la zone noire de <b>gauche</b> ou de <b>droite</b>.</li>' +
      '<li>Le gris ne passe que sur une case de <b>la même couleur</b> que la sienne (ou sur le noir).</li>' +
      '<li>À votre tour : marchez sur le noir, choisissez bleu ou jaune, puis <b>traversez</b> : chaque case avance d\'un cran vers cette couleur.</li>' +
      '<li>Traversez avant que la jauge se vide, sinon vous perdez la manche.</li></ul>',
      [{ label: 'Jouer', primary: true, fn: newGame }, { label: 'Règles', fn: function () { $('help').showModal(); } }]);
  }

  // ---------- Human input ----------

  function humanPlayer(k) { var p = G.players[k]; return p && p.human ? p : null; }

  // Keys work from the start of the turn, even while the pyramid rises.
  function act(k, action, now) {
    if (G.phase !== 'play' || G.turn !== k || paused) return;
    var p = humanPlayer(k);
    if (!p) return;
    if (action === 'colour') { changeColour(p); return; }
    if (action === 'cross') {
      if ((p.target != null && p.target !== p.cell) || moving(p, now)) { p.crossQueued = true; if (p.target != null) toast('Traversée dès l\'arrivée', 1200); return; }
      tryCross(p, now); return;
    }
    p.target = null; p.crossQueued = false;
    p.hold = action;
    if (moving(p, now)) p.queued = action;     // buffered: played at the end of the step
    else walkAction(p, action, now);
  }
  function release(k, action) {
    var p = G.players[k];
    if (p && p.hold === action) p.hold = null;
  }

  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function keyAction(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, code = e.code;
    if (k === 'z' || code === 'KeyW') return [0, DIRS.up];
    if (k === 'q' || code === 'KeyA') return [0, DIRS.left];
    if (k === 's' || code === 'KeyS') return [0, DIRS.down];
    if (k === 'd' || code === 'KeyD') return [0, DIRS.right];
    if (code === 'Digit2' || code === 'Numpad2' || k === '2' || k === 'é') return [0, 'colour'];
    if (code === 'Digit1' || code === 'Numpad1' || k === '1' || k === '&') return [0, 'cross'];
    if (k === 'ArrowUp') return [1, DIRS.up];
    if (k === 'ArrowDown') return [1, DIRS.down];
    if (k === 'ArrowLeft') return [1, DIRS.left];
    if (k === 'ArrowRight') return [1, DIRS.right];
    if (k === 'Enter') return [1, 'colour'];
    if (k === ' ' || code === 'Space') return [1, 'cross'];
    return null;
  }
  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var t = e.target && e.target.tagName;
    if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'p' || k === 'Escape') {
      if (paused) setPaused(false); else setPaused(true);
      e.preventDefault(); return;
    }
    if (k === 'h') { askHint(); return; }
    if (k === 'v') { toggleAid(); return; }
    var a = keyAction(e);
    if (!a) return;
    // Buttons keep their own Enter / Space behaviour.
    if (t === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    e.preventDefault();
    if (e.repeat) return;              // holding a key keeps walking (see updateHuman)
    var who = G.twoPlayers ? a[0] : 1;   // one player: both key sets drive yellow
    act(who, a[1], clock());
  });
  document.addEventListener('keyup', function (e) {
    var a = keyAction(e);
    if (!a || typeof a[1] === 'string') return;
    [0, 1].forEach(function (k) { release(k, a[1]); });
  });
  window.addEventListener('blur', function () { G.players.forEach(function (p) { p.hold = null; }); });

  function cellAt(e) {
    var pos = Lehcim.canvasPos(canvas, e);
    var c = Math.floor((pos.x - OX) / CELL), r = Math.floor((pos.y - OY) / CELL);
    return inside(c, r) ? idx(c, r) : -1;
  }

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var i = cellAt(e);
    G.hover = (i >= 0 && lineFrom(i)) ? i : null;
  });
  canvas.addEventListener('pointerleave', function () { G.hover = null; });

  // Tap a black cell to walk there (tap it again, or tap your globule, to cross);
  // tap inside the board to walk to the nearest end of that row / column; tap a
  // wall indicator to change colour.
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (G.phase !== 'play' || paused) return;
    var now = clock(), p = G.players[G.turn];
    if (!p.human) return;
    var pos = Lehcim.canvasPos(canvas, e);
    if ((p.k === 0 && pos.x >= 192 && pos.x < 216 && pos.y < 24) || (p.k === 1 && pos.x >= 384 && pos.y >= 192 && pos.y < 216)) { changeColour(p); return; }
    var i = cellAt(e);
    if (i < 0) return;
    var c = colOf(i), r = rowOf(i);
    p.hold = null; p.queued = null;
    if (i === p.cell) { act(p.k, 'cross', now); return; }
    if (isRing(c, r)) {
      if (p.target === i) { p.crossQueued = true; toast('Traversée dès l\'arrivée', 1200); return; }
      p.target = i; p.crossQueued = false;
    } else {
      var best = null;
      [idx(c, 0), idx(c, N - 1), idx(0, r), idx(N - 1, r)].forEach(function (s) {
        var path = ringPath(p.cell, s, walkBlocks(p));
        if (path && (!best || path.length < best.len)) best = { s: s, len: path.length };
      });
      if (best) {
        if (best.s === p.cell) { act(p.k, 'cross', now); return; }
        if (p.target === best.s) { p.crossQueued = true; toast('Traversée dès l\'arrivée', 1200); return; }
        p.target = best.s; p.crossQueued = false;
      }
    }
  });

  function updateHuman(p, now) {
    if (moving(p, now)) return;
    if (p.queued) { var q = p.queued; p.queued = null; if (walkAction(p, q, now)) return; }
    if (p.hold) { if (walkAction(p, p.hold, now)) return; }
    if (p.target != null) {
      if (p.cell === p.target) { p.target = null; p.dir = inwardDir(p.cell); }
      else {
        var path = ringPath(p.cell, p.target, walkBlocks(p));
        if (!path || !path.length || !walkTo(p, path[0], now)) { p.target = null; p.crossQueued = false; }
        return;
      }
    }
    if (p.crossQueued && !p.hold) { p.crossQueued = false; tryCross(p, now); }
  }

  // Touch pad: hold the arrows to keep walking around the ring.
  document.querySelectorAll('[data-pad]').forEach(function (b) {
    var a = b.getAttribute('data-pad');
    var who = function () { return G.twoPlayers ? G.turn : 1; };
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      act(who(), a, clock());
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function () { if (a === 'cw' || a === 'ccw') { release(0, a); release(1, a); } });
    });
    b.addEventListener('click', function (e) {    // keyboard activation
      if (e.detail !== 0) return;
      act(who(), a, clock());
      if (a === 'cw' || a === 'ccw') { release(0, a); release(1, a); }
    });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  $('new').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (G.phase === 'idle' || G.phase === 'over') { newGame(); return; }
    var wasPaused = paused;
    if (!wasPaused) setPaused(true);
    Lehcim.message('Abandonner la partie en cours et en commencer une nouvelle ?', ['Nouvelle partie', 'Continuer']).then(function (i) {
      if (i === 0) newGame(); else if (!wasPaused) setPaused(false);
    });
  });
  $('hintBtn').addEventListener('click', askHint);
  $('pauseBtn').addEventListener('click', function () { setPaused(!paused); });
  $('aidBtn').addEventListener('click', toggleAid);
  function toggleAid() {
    settings.aid = !settings.aid; saveSettings(); syncSettingsUI();
    toast(settings.aid ? 'Aide affichée : région du gris et chances de sortie' : 'Aide masquée', 1600);
  }

  // ---------- Settings dialog ----------

  function syncSettingsUI() {
    document.querySelectorAll('#segMode button').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.v === settings.mode ? 'true' : 'false'); });
    document.querySelectorAll('#segLevel button').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.v === settings.level ? 'true' : 'false'); });
    $('levelInfo').textContent = LEVELS[settings.level].info;
    $('optMusic').checked = settings.music;
    $('optPreview').checked = settings.preview;
    $('optAid').checked = settings.aid;
    $('aidBtn').setAttribute('aria-pressed', settings.aid ? 'true' : 'false');
    $('aidCard').hidden = !settings.aid;
    renderKeys();
  }
  function inGame() { return G.phase !== 'idle' && G.phase !== 'over'; }
  document.querySelectorAll('#segMode button').forEach(function (b) {
    b.addEventListener('click', function () {
      settings.mode = +b.dataset.v; saveSettings(); syncSettingsUI();
      if (inGame()) toast('Le mode changera à la prochaine partie');
    });
  });
  document.querySelectorAll('#segLevel button').forEach(function (b) {
    b.addEventListener('click', function () {
      settings.level = +b.dataset.v; saveSettings(); syncSettingsUI(); renderRecords();
      if (inGame()) toast('Le niveau changera à la prochaine partie');
    });
  });
  $('optMusic').addEventListener('change', function (e) { settings.music = e.target.checked; saveSettings(); updateMusic(); });
  $('optPreview').addEventListener('change', function (e) { settings.preview = e.target.checked; saveSettings(); });
  $('optAid').addEventListener('change', function (e) { settings.aid = e.target.checked; saveSettings(); syncSettingsUI(); });
  $('settingsBtn').addEventListener('click', function (e) { e.currentTarget.blur(); syncSettingsUI(); $('settings').showModal(); });

  // ---------- Records (1 player, per level) ----------

  var RKEY = 'lehcim.colorsmix.nv.records2';
  function loadRecords() { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch (e) { return {}; } }
  function saveRecords(r) { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { /* ignore */ } }
  function recBucket(r) { var k = 'l' + G.level; if (!r[k]) r[k] = { wins: 0, losses: 0, draws: 0, best: 0 }; return r[k]; }
  function recordBest(secs) {
    var r = loadRecords(), b = recBucket(r);
    if (!b.best || secs < b.best) { b.best = secs; saveRecords(r); toast('Nouveau record : manche gagnée en ' + secs + ' s !', 3000); }
    renderRecords();
  }
  function recordGame(res) {
    var r = loadRecords(), b = recBucket(r);
    if (res === 'win') b.wins++; else if (res === 'loss') b.losses++; else b.draws = (b.draws || 0) + 1;
    saveRecords(r); renderRecords();
  }
  function renderRecords() {
    var r = loadRecords(), b = r['l' + settings.level] || { wins: 0, losses: 0, draws: 0, best: 0 };
    $('records').innerHTML = '<dt>Niveau</dt><dd>' + LEVELS[settings.level].name + '</dd>' +
      '<dt>Parties gagnées</dt><dd>' + b.wins + '</dd><dt>Parties perdues</dt><dd>' + b.losses + '</dd>' +
      '<dt>Parties nulles</dt><dd>' + (b.draws || 0) + '</dd>' +
      '<dt>Manche la plus rapide</dt><dd>' + (b.best ? b.best + ' s' : '-') + '</dd>';
  }

  // ---------- Side panel ----------

  function spriteCanvas(cv, sx, sy, w, h) {
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    if (sheet) c.drawImage(sheet, sx, sy, w, h, 0, 0, cv.width, cv.height);
  }
  function tileCanvas(col) {
    var cv = document.createElement('canvas'); cv.width = 24; cv.height = 24; cv.title = COLOR_NAMES[col];
    var c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    if (sheet) { c.drawImage(sheet, TILE[col][0], TILE[col][1], CELL, CELL, 0, 0, 24, 24); c.drawImage(sheet, NET[0], NET[1], CELL, CELL, 0, 0, 24, 24); }
    return cv;
  }

  function buildPanel() {
    [0, 1].forEach(function (k) {
      spriteCanvas($('pl' + k).querySelector('canvas.glob'), GLOB_X[k], 2 * CELL, CELL, CELL);
      var box = document.querySelector('.dots[data-k="' + k + '"]');
      box.innerHTML = '';
      APPS[k].forEach(function (col) {
        var b = document.createElement('button');
        b.className = 'dot'; b.dataset.col = col;
        b.setAttribute('aria-label', 'Couleur d\'application ' + COLOR_NAMES[col] + ' (globule ' + NAMES[k] + ')');
        b.title = 'Appliquer le ' + COLOR_NAMES[col];
        var cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
        b.appendChild(cv);
        b.addEventListener('click', function () {
          var p = G.players[k];
          if (!p || !p.human || G.turn !== k || G.phase !== 'play' || paused) return;
          setColour(p, col);
        });
        box.appendChild(b);
      });
    });
    // colour legend: the real colour circle, drawn with the original tiles
    var L = $('legend');
    L.innerHTML = '';
    var wheel = document.createElement('div'); wheel.className = 'wheel';
    [RED, ORANGE, YEL, GREEN, BLUE, MAGENTA, RED].forEach(function (col, n) {
      if (n) { var s = document.createElement('span'); s.textContent = '›'; s.setAttribute('aria-hidden', 'true'); wheel.appendChild(s); }
      wheel.appendChild(tileCanvas(col));
    });
    wheel.setAttribute('aria-label', 'Cercle des couleurs : rouge, orange, jaune, vert, bleu, magenta, puis rouge');
    L.appendChild(wheel);
    var note = document.createElement('div'); note.className = 'note';
    note.textContent = 'Chaque passage avance la case d\'un cran vers la couleur appliquée, par le plus court chemin du cercle. La couleur opposée devient brune, le brun prend la couleur appliquée.';
    L.appendChild(note);
    var rows = [[YEL, BLUE], [GREEN, BLUE], [RED, BLUE], [YEL, RED], [GREEN, RED, 'opposé'], [BROWN, YEL], [RED, RED, 'inchangé']];
    rows.forEach(function (rw) {
      var d = document.createElement('div');
      var res = mix(rw[0], rw[1]);
      [rw[0], '+', rw[1], '=', res].forEach(function (x) {
        if (typeof x === 'string') { var s = document.createElement('span'); s.textContent = x; d.appendChild(s); return; }
        d.appendChild(tileCanvas(x));
      });
      var txt = document.createElement('span');
      txt.textContent = COLOR_NAMES[res] + (rw[2] ? ' (' + rw[2] + ')' : '');
      if (rw[2]) txt.className = 'note';
      d.appendChild(txt);
      L.appendChild(d);
    });
    var tip = document.createElement('div'); tip.className = 'note';
    tip.textContent = 'Deux passages de la même couleur rendent toute la ligne de cette couleur.';
    L.appendChild(tip);
    renderDots();
  }

  function renderDots() {
    [0, 1].forEach(function (k) {
      var p = G.players[k], app = p ? p.app : BLUE;
      var can = p && p.human && G.turn === k && G.phase === 'play';
      document.querySelectorAll('.dots[data-k="' + k + '"] .dot').forEach(function (b) {
        var col = +b.dataset.col, on = col === app;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !can;
        spriteCanvas(b.querySelector('canvas'), 72, (on ? 72 : 0) + 24 * DOT[col], CELL, CELL);
      });
    });
  }

  function renderKeys() {
    var two = settings.mode === 2;
    $('keysBox').innerHTML = two
      ? '<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span><span>jaune : marcher</span><span><kbd>Entrée</kbd> <kbd>Espace</kbd></span><span>jaune : couleur, traverser</span>' +
        '<span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd></span><span>rouge : marcher</span><span><kbd>2</kbd> <kbd>1</kbd></span><span>rouge : couleur, traverser</span>'
      : '<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span><span>marcher sur le noir (touche tenue)</span><span><kbd>Entrée</kbd></span><span>bleu ou jaune</span>' +
        '<span><kbd>Espace</kbd></span><span>traverser</span>';
    $('keysBox').innerHTML += '<span><kbd>P</kbd></span><span>pause</span><span><kbd>H</kbd> <kbd>V</kbd></span><span>indice, aide</span>';
  }

  function addLog(k, text, app) {
    G.log.unshift({ k: k, text: text, app: app, t: G.phase === 'play' || G.phase === 'cross' ? roundSeconds(clock()) : null });
    if (G.log.length > 40) G.log.pop();
    renderLog();
  }
  function renderLog() {
    var ol = $('log');
    ol.innerHTML = '';
    if (!G.log.length) { var li0 = document.createElement('li'); li0.textContent = 'Aucune traversée pour le moment.'; li0.style.color = 'var(--ink-2)'; ol.appendChild(li0); return; }
    G.log.slice(0, 30).forEach(function (e) {
      var li = document.createElement('li');
      var sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = e.app != null ? SWATCH[e.app] : e.k === 0 ? '#e02020' : e.k === 1 ? '#f0e000' : 'transparent';
      li.appendChild(sw);
      var tx = document.createElement('span'); tx.textContent = e.text; li.appendChild(tx);
      if (e.t != null) { var t = document.createElement('span'); t.className = 't'; t.textContent = e.t + ' s'; li.appendChild(t); }
      ol.appendChild(li);
    });
  }

  var panelState = {};
  function setText(id, s) { if (panelState[id] !== s) { panelState[id] = s; $(id).textContent = s; } }
  function setHTML(id, s) { if (panelState[id] !== s) { panelState[id] = s; $(id).innerHTML = s; } }

  function pct(x) { return Math.round(x * 100) + ' %'; }

  function updatePanel(now) {
    var st, sub = '', p = G.players[G.turn];
    if (G.phase === 'idle') { st = 'Prêt à jouer'; sub = 'Cliquez sur « Jouer » ou « Nouvelle partie ».'; }
    else if (G.phase === 'over') { st = 'Partie terminée'; sub = 'Nouvelle partie quand vous voulez.'; }
    else if (G.phase === 'end' || G.phase === 'msg') { var r = G.results[G.results.length - 1]; st = 'Le ' + NAMES[r.winner] + ' gagne la manche'; sub = 'en ' + r.secs + ' s' + (r.why === 'time' ? ' (jauge vide)' : ''); }
    else if (G.phase === 'cross') { st = 'Le ' + NAMES[G.crossing.p.k] + ' traverse'; sub = 'Chaque case avance d\'un cran vers le ' + COLOR_NAMES[G.crossing.p.app] + '.'; }
    else if (!p.human) {
      st = 'L\'ordinateur (rouge) joue';
      sub = p.plan ? 'Il se dirige vers sa case de départ.' : now < G.gaugeStart ? 'Sa pyramide se dresse...' : 'Il réfléchit...';
    } else {
      st = G.twoPlayers ? 'Au globule ' + NAMES[p.k] : 'À vous (globule jaune)';
      var why = crossProblem(p);
      sub = p.target != null ? (p.crossQueued ? 'En route, traversée à l\'arrivée.' : 'En route...') : why ? why + '.' : 'Traversée possible : ' + (G.twoPlayers && p.k === 0 ? 'touche 1' : 'Espace') + ' ou touchez votre globule.';
    }
    if (paused) { st = 'Pause'; sub = 'Appuyez sur P ou « Reprendre ».'; }
    setText('status', st);
    if (G.phase === 'play' && p && !p.human && !p.plan && !paused && now >= G.gaugeStart) setHTML('substatus', 'Il réfléchit <span class="think" aria-hidden="true"><i></i><i></i><i></i></span>');
    else setText('substatus', sub);

    // turn gauge (19.2 s or 9.6 s, full while the pyramid rises, frozen during a crossing)
    var frac = 0, secs = '-';
    if (G.phase === 'play' || G.phase === 'cross') {
      var left = gaugeLeft(now);
      frac = left / gaugeMs();
      secs = G.phase === 'cross' ? 'traversée' : (left / 1000).toFixed(1) + ' s';
    }
    var warn = G.phase === 'play' && frac < 0.3;
    var tb = $('timer');
    tb.firstChild.style.width = (frac * 100).toFixed(1) + '%';
    tb.classList.toggle('warn', warn);
    $('timerRow').classList.toggle('warn', warn);
    tb.setAttribute('aria-valuenow', Math.round(frac * 100));
    setText('timerTxt', secs);

    // players
    [0, 1].forEach(function (k) {
      var el = $('pl' + k);
      el.classList.toggle('turn', (G.phase === 'play' || G.phase === 'cross') && G.turn === k);
      var role = (k === 0 ? 'Haut et bas' : 'Gauche et droite');
      if (G.phase !== 'idle') role += G.players[k] && !G.players[k].human ? ' - ordinateur (' + LEVELS[G.level].name.toLowerCase() + ')' : (G.twoPlayers ? '' : ' - vous');
      if (panelState['role' + k] !== role) { panelState['role' + k] = role; el.querySelector('.role').textContent = role; }
    });
    var dk = G.phase + ':' + G.turn + ':' + (G.players[0] && G.players[0].app) + ':' + (G.players[1] && G.players[1].app);
    if (panelState.dots !== dk) { panelState.dots = dk; renderDots(); }

    // rounds
    var rr = '';
    for (var n = 0; n < 2; n++) {
      var res = G.results[n];
      rr += '<dt>Manche ' + (n + 1) + '</dt><dd>' + (res ? NAMES[res.winner] + ', ' + res.secs + ' s' : (G.round === n + 1 && inGame() ? 'en cours' : '-')) + '</dd>';
    }
    var tsec = (G.phase === 'play' || G.phase === 'cross') ? roundSeconds(now) : (G.results.length ? G.results[G.results.length - 1].secs : 0);
    rr += '<dt>Temps</dt><dd>' + tsec + ' s</dd>';
    setHTML('roundsRows', rr);
    drawRoundsSprite(now);

    // aid
    if (settings.aid) {
      var a = (G.phase === 'play' || G.phase === 'cross') ? currentAid() : null;
      $('barR').style.width = a ? pct(a.longR).replace(' ', '') : '0%';
      $('barY').style.width = a ? pct(a.longY).replace(' ', '') : '0%';
      setText('pR', a ? pct(a.longR) : '-');
      setText('pY', a ? pct(a.longY) : '-');
      setText('conn', a ? 'rouge ' + fmtConn(a.connRed) + ', jaune ' + fmtConn(a.connYel) : '-');
      var pv = previewSource(), after = '';
      if (a && pv && !lineProblem(pv.p, pv.cell)) {
        var b = previewAid(pv.p, pv.cell, pv.p.app);
        if (b) {
          var mine = pv.p.k === 0 ? b.longR - a.longR : b.longY - a.longY;
          var theirs = pv.p.k === 0 ? b.longY - a.longY : b.longR - a.longR;
          var cm = pv.p.k === 0 ? a.connRed - b.connRed : a.connYel - b.connYel;
          after = 'Après cette traversée : vous ' + fmtDelta(mine) + ', adversaire ' + fmtDelta(-theirs, theirs) +
            (cm ? ', passages manquants ' + (cm > 0 ? '<span class="up">-' + cm + '</span>' : '<span class="down">+' + (-cm) + '</span>') : '');
        }
      }
      setHTML('after', after);
    }
    var canHint = G.phase === 'play' && p && p.human && !paused && !hintBusy;
    $('hintBtn').disabled = !canHint;
  }
  function fmtConn(n) { return n >= 20 ? '20+' : String(n); }
  function fmtDelta(good, raw) {
    var v = raw === undefined ? good : raw, s = Math.round(v * 100);
    var cls = good > 0.005 ? 'up' : good < -0.005 ? 'down' : '';
    return '<span class="' + cls + '">' + (s > 0 ? '+' : '') + s + ' pts</span>';
  }

  var roundsCv = $('roundsCv'), roundsKey = '';
  function drawRoundsSprite(now) {
    if (!sheet) return;
    var blink = inGame() && G.phase !== 'end' && G.phase !== 'msg' && (reduceMotion || Math.floor(now / 500) % 2);
    var key = G.results.map(function (r) { return r.winner; }).join(',') + ':' + G.round + ':' + blink + ':' + G.phase;
    if (key === roundsKey) return;
    roundsKey = key;
    var c = roundsCv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 82, 80);
    c.drawImage(sheet, ROUNDS_SPR[0], ROUNDS_SPR[1], ROUNDS_SPR[2], ROUNDS_SPR[3], 0, 0, 82, 80);
    [17, 65].forEach(function (oy, n) {
      var res = G.results[n];
      if (res) c.drawImage(sheet, GLOB_X[res.winner], 2 * CELL, CELL, CELL, 40 - 12, oy - 12, CELL, CELL);
      else if (blink && G.round === n + 1) c.drawImage(sheet, GLOB_X[2], 2 * CELL, CELL, CELL, 40 - 12, oy - 12, CELL, CELL);
    });
  }

  // ---------- Effects ----------

  function addEffect(sx, x, y, t0, ms, hold) { G.effects.push({ sx: sx, x: x, y: y, t0: t0, ms: ms, hold: hold }); }
  function cellX(i) { return OX + colOf(i) * CELL; }
  function cellY(i) { return OY + rowOf(i) * CELL; }

  // ---------- Main loop ----------

  function update(now) {
    if (paused) return;
    if (G.phase === 'play' || G.phase === 'cross') {
      updateGrey(now);
      if (G.phase === 'cross') stepCross(now);
    }
    if (G.phase === 'play') {
      var p = G.players[G.turn];
      if (p.human) updateHuman(p, now); else updateAI(p, now);
      if (G.phase === 'play' && gaugeLeft(now) <= 0) {
        // the gauge is empty: the globule whose turn it is loses the round
        Lehcim.play('s5', 0.6);
        toast('Temps écoulé : le globule ' + NAMES[G.turn] + ' perd la manche', 3000);
        endRound(1 - G.turn, now, 'time');
      }
    }
    if (G.phase === 'end' && now >= G.endAt) finishRound();
  }

  // ---------- Drawing ----------

  function blit(sx, sy, w, h, dx, dy, dw, dh) { Lehcim.blit(g, sheet, sx, sy, w, h, dx, dy, dw, dh); }

  // Metal frame of the original, with the application colour indicators on the
  // top wall (red) and the right wall (yellow).
  function drawFrame() {
    blit(48, 288, 48, 48, 0, 0); blit(48, 240, 48, 48, 360, 0);
    blit(48, 192, 48, 48, 0, 360); blit(48, 144, 48, 48, 360, 360);
    [48, 96, 144, 216, 264, 312].forEach(function (v) {
      blit(0, 288, 48, 48, v, 0);
      blit(0, 144, 48, 48, v, 360);
      blit(0, 240, 48, 48, 0, v);
      blit(0, 192, 48, 48, 360, v);
    });
    blit(24, 360, 24, 24, 192, 24);
    blit(0, 336, 24, 48, 192, 360);
    blit(48, 360, 48, 24, 0, 192);
    blit(48, 336, 24, 24, 360, 192);
    var red = G.players[0], yel = G.players[1];
    blit(72, 72 + 24 * DOT[red ? red.app : BLUE], 24, 24, 192, 0);
    blit(72, 24 * DOT[yel ? yel.app : BLUE], 24, 24, 384, 192);
  }

  function lerpPos(from, to, t) {
    return { x: cellX(from) + (cellX(to) - cellX(from)) * t, y: cellY(from) + (cellY(to) - cellY(from)) * t };
  }
  function drawGlobule(sx, dir, frame, x, y) { blit(sx + frame * CELL, dir * CELL, CELL, CELL, x, y); }

  // Which crossing to preview: the hovered side cell, else the target, else the active human's cell.
  function previewSource() {
    if (G.phase !== 'play' || paused) return null;
    var p = G.players[G.turn];
    if (!p || !p.human) return null;
    if (G.hover != null && G.hover !== p.cell) return { p: p, cell: G.hover, hover: true };
    if (p.target != null && p.target !== p.cell && lineFrom(p.target)) return { p: p, cell: p.target, hover: false };
    return lineFrom(p.cell) ? { p: p, cell: p.cell, hover: false } : null;
  }

  function drawBoard(now) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var i = idx(c, r), t = TILE[G.colors[i]];
      blit(t[0], t[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
      blit(NET[0], NET[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
    }
    G.pyr.forEach(function (q) {
      if (!q) return;
      var f = Math.floor((now - q.t0) / (RISE_MS / 16));
      if (f >= 15) blit(PYRAMID[0], PYRAMID[1], CELL, CELL, cellX(q.cell), cellY(q.cell));
      else if (f >= 0) blit(RISE_X, RISE_Y + f * CELL, CELL, CELL, cellX(q.cell), cellY(q.cell));
    });
  }

  function drawAid() {
    if (!settings.aid || (G.phase !== 'play' && G.phase !== 'cross')) return;
    var a = currentAid();
    if (!a) return;
    g.fillStyle = 'rgba(255,255,255,0.22)';
    a.cells.forEach(function (i) { g.fillRect(cellX(i) + 2, cellY(i) + 2, CELL - 4, CELL - 4); });
    g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    a.exits.forEach(function (e) {
      var red = E.zoneOwner(colOf(e.cell), rowOf(e.cell)) === 0;
      var al = Math.min(0.9, 0.25 + e.p * 3);
      g.fillStyle = red ? 'rgba(230,40,40,' + al + ')' : 'rgba(240,220,0,' + al + ')';
      g.fillRect(cellX(e.cell) + 1, cellY(e.cell) + 1, CELL - 2, CELL - 2);
      g.fillStyle = red ? '#fff' : '#000';
      var v = Math.round(e.p * 100);
      g.fillText(v < 1 ? '<1' : String(v), cellX(e.cell) + CELL / 2, cellY(e.cell) + CELL / 2 + 1);
    });
    g.textAlign = 'left';
  }

  function drawPreview(now) {
    if (!settings.preview) return;
    var pv = previewSource();
    if (!pv) return;
    var L = lineFrom(pv.cell), p = pv.p;
    if (!L) return;
    var why = lineProblem(p, pv.cell);
    var a = L.cells[0], b = L.cells[L.cells.length - 1];
    var x0 = Math.min(cellX(a), cellX(b)), y0 = Math.min(cellY(a), cellY(b));
    var x1 = Math.max(cellX(a), cellX(b)) + CELL, y1 = Math.max(cellY(a), cellY(b)) + CELL;
    if (!why) {
      // resulting colour of each cell that changes, as a small tile in its centre
      L.cells.forEach(function (i) {
        var nc = mix(G.colors[i], p.app);
        if (nc === G.colors[i]) return;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(cellX(i) + 5, cellY(i) + 5, 14, 14);
        var t = TILE[nc];
        blit(t[0] + 4, t[1] + 4, 16, 16, cellX(i) + 6, cellY(i) + 6, 12, 12);
      });
    } else {
      // forbidden crossing: dimmed, with a red cross on the arrival cell (or on the
      // start cell when it cannot be reached)
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      var e = (pyrCells().indexOf(L.end) >= 0 || G.players[1 - p.k].cell === L.end) ? L.end : pv.cell;
      g.strokeStyle = '#ff5050'; g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cellX(e) + 5, cellY(e) + 5); g.lineTo(cellX(e) + CELL - 5, cellY(e) + CELL - 5);
      g.moveTo(cellX(e) + CELL - 5, cellY(e) + 5); g.lineTo(cellX(e) + 5, cellY(e) + CELL - 5);
      g.stroke();
    }
    g.strokeStyle = why ? 'rgba(255,80,80,0.95)' : 'rgba(255,255,255,0.9)';
    g.lineWidth = 2;
    g.setLineDash([4, 4]);
    g.lineDashOffset = reduceMotion ? 0 : -Math.floor(now / 60) % 8;
    g.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    g.setLineDash([]);
    if (pv.hover) {
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.strokeRect(cellX(pv.cell) + 1, cellY(pv.cell) + 1, CELL - 2, CELL - 2);
    }
  }

  function drawHint(now) {
    if (!G.hint || G.phase !== 'play') return;
    var s = G.hint.start, L = lineFrom(s);
    var pulse = reduceMotion ? 1 : 0.6 + 0.4 * Math.sin(now / 180);
    g.strokeStyle = 'rgba(80,255,140,' + pulse + ')';
    g.lineWidth = 3;
    g.strokeRect(cellX(s) - 1, cellY(s) - 1, CELL + 2, CELL + 2);
    blit(72, 24 * DOT[G.hint.app], CELL, CELL, cellX(s) + 6, cellY(s) + 6, 12, 12);
    g.strokeStyle = 'rgba(80,255,140,0.5)'; g.lineWidth = 1;
    var e = L.end;
    g.beginPath();
    g.moveTo(cellX(s) + CELL / 2, cellY(s) + CELL / 2);
    g.lineTo(cellX(e) + CELL / 2, cellY(e) + CELL / 2);
    g.stroke();
  }

  function drawActors(now) {
    var gr = G.grey;
    if (gr && !gr.gone) {
      var t = gr.moving ? Math.min(1, (now - gr.t0) / GREY_MS) : 1;
      var q = lerpPos(gr.from, gr.cell, t);
      drawGlobule(GLOB_X[2], gr.dir, Math.floor(now / 80) % 12, q.x, q.y);
    }
    G.players.forEach(function (p) {
      if (!p.visible) return;
      var tt = Math.min(1, (now - p.moveT) / p.moveMs);
      var q2 = lerpPos(p.from, p.cell, tt);
      var crossing = G.crossing && G.crossing.p === p;
      var dir = (tt >= 1 && !crossing && !p.hold && p.target == null) ? inwardDir(p.cell) : p.dir;
      if (G.phase === 'play' && G.turn === p.k && (reduceMotion || Math.floor(now / 400) % 2 === 0)) {
        g.strokeStyle = p.k === 0 ? '#ff4040' : '#ffff40';
        g.lineWidth = 2; g.strokeRect(q2.x + 1, q2.y + 1, CELL - 2, CELL - 2);
      }
      drawGlobule(GLOB_X[p.k], dir, Math.floor(now / 80) % 6, q2.x, q2.y);
      // thinking bubble
      if (G.phase === 'play' && G.turn === p.k && !p.human && !p.plan && now >= G.gaugeStart) {
        g.fillStyle = 'rgba(0,0,0,0.7)';
        var by = rowOf(p.cell) === 0 ? q2.y + CELL + 2 : q2.y - 12;
        g.fillRect(q2.x - 2, by, 28, 10);
        g.fillStyle = '#fff';
        for (var d = 0; d < 3; d++) {
          var on = reduceMotion || Math.floor(now / 200) % 3 === d;
          g.globalAlpha = on ? 1 : 0.35;
          g.fillRect(q2.x + 4 + d * 7, by + 3, 4, 4);
        }
        g.globalAlpha = 1;
      }
      if (p.target != null && G.turn === p.k && G.phase === 'play') {
        g.strokeStyle = p.crossQueued ? '#80ff80' : 'rgba(255,255,255,0.7)';
        g.lineWidth = 1;
        g.strokeRect(cellX(p.target) + 3, cellY(p.target) + 3, CELL - 6, CELL - 6);
      }
    });
    G.effects.forEach(function (e) {
      if (now < e.t0) return;
      var fr = Math.floor((now - e.t0) / e.ms);
      if (fr > 13) { if (!e.hold) return; fr = 13; }
      blit(e.sx, fr * 28, 28, 28, e.x - 2, e.y - 2);
    });
  }

  // "Manche N" while the pyramids rise (the keys already work).
  function drawBanner(now) {
    if ((G.phase !== 'play' && G.phase !== 'cross') || now - G.roundStart > RISE_MS + 200) return;
    var text = 'Manche ' + G.round;
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var cx = OX + N * CELL / 2, cy = OY + N * CELL / 2 - 48;
    var w = g.measureText(text).width + 36;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(cx - w / 2, cy - 24, w, 48);
    g.fillStyle = '#fff'; g.fillText(text, cx, cy + 1);
    g.textAlign = 'left';
  }

  function draw(now) {
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000'; g.fillRect(0, 0, SIZE, SIZE);
    drawFrame();
    drawBoard(now);
    drawAid();
    drawPreview(now);
    drawHint(now);
    drawActors(now);
    drawBanner(now);
  }

  var lastPanel = 0;
  function frame() {
    var now = clock();
    update(now);
    draw(now);
    var real = performance.now();
    if (real - lastPanel > 90) { lastPanel = real; updatePanel(now); updateMusic(); }
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------

  syncSettingsUI();
  renderRecords();
  renderLog();
  Lehcim.loadSheet('../assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    newBoard(-1e6);
    buildPanel();
    fit();
    startScreen();
    requestAnimationFrame(frame);
  });

  // Hooks for automated tests.
  window.ColoursMixNV = { G: G, E: E, AI: AI, settings: settings, newGame: newGame, endRound: endRound,
    setPaused: setPaused, askHint: askHint, clock: clock, crossProblem: crossProblem, tryCross: tryCross,
    gaugeLeft: gaugeLeft, LEVELS: LEVELS };
})();
