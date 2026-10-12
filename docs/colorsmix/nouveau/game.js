/*
 * Colours-MIX (nouvelle version) - page, input, drawing and game flow.
 * Same rules, sprites and sounds as the original port (../game.js); the rules
 * and the computer player live in engine.js (run in a Web Worker when possible).
 */
(function () {
  'use strict';

  var E = window.CMEngine;
  var N = E.N, RED = E.RED, BLUE = E.BLUE, YEL = E.YEL, PRIMARIES = E.PRIMARIES;
  var idx = E.idx, colOf = E.colOf, rowOf = E.rowOf, isRing = E.isRing, inside = E.inside;
  var mix = E.mix, lineFrom = E.lineFrom, ringPath = E.ringPath, RING = E.RING, RING_POS = E.RING_POS;

  var CELL = 24, OX = 48, OY = 48;
  var KEY = [184, 10, 70];
  var STEP_MS = 110, AI_STEP_MS = 130, CROSS_MS = 75, GREY_MOVE_MS = 420;
  var NAMES = ['rouge', 'jaune'];
  var COLOR_NAMES = { 1: 'rouge', 2: 'bleu', 4: 'jaune', 3: 'violet', 5: 'orange', 6: 'vert', 7: 'brun' };
  var SWATCH = { 0: '#111', 1: '#e02020', 2: '#2040e0', 4: '#f0e000', 3: '#e020e0', 5: '#f08000', 6: '#20c020', 7: '#8a4a36' };

  // Sprite sheet rectangles (same sheet as the original)
  var TILE = { 0: [0, 48], 1: [24, 0], 3: [48, 0], 2: [24, 24], 6: [48, 24], 4: [24, 48], 5: [48, 48], 7: [0, 72] };
  var NET = [0, 24];
  var DOTS = { 1: [72, 0], 2: [72, 24], 4: [72, 48] };
  var DOTS_ON = { 1: [72, 72], 2: [72, 96], 4: [72, 120] };
  var WALL = {
    top: [0, 288], bottom: [0, 144], left: [0, 240], right: [0, 192],
    tl: [48, 288], tr: [48, 240], bl: [48, 192], br: [48, 144]
  };
  var ROUNDS_SPR = [208, 0, 82, 80];
  var GLOB_X = [368, 512, 656];
  var EXPLODE_X = [152, 96];
  var SMILE_X = [180, 124];
  var SMOKE_X = 288;
  var RISE_X = 344, RISE_Y = 24;

  // Levels: turn length, search depth, randomness, time budget of the search.
  var LEVELS = [
    { name: 'Débutant', turnLen: 12000, depth: 1, noise: 2.5, budget: 100, info: '12 s par tour, ordinateur prudent qui se trompe parfois.' },
    { name: 'Confirmé', turnLen: 10000, depth: 1, noise: 0, budget: 150, info: '10 s par tour, ordinateur précis (probabilités exactes du gris).' },
    { name: 'Expert', turnLen: 8000, depth: 2, noise: 0, budget: 300, info: '8 s par tour, ordinateur qui anticipe aussi votre réponse.' }
  ];

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
  var settings = { mode: 1, level: 1, music: true, preview: true, aid: false };
  try { var saved = JSON.parse(localStorage.getItem(SKEY)); if (saved) for (var sk in settings) if (saved[sk] !== undefined) settings[sk] = saved[sk]; } catch (e) { /* ignore */ }
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
    phase: 'idle',            // idle, intro, play, cross, end, msg, over
    colors: new Uint8Array(N * N),
    pyr: new Uint8Array(N * N),
    pyrList: [],
    grey: null,
    players: [],
    turn: 0, turnStart: 0, turnLen: 10000, turnId: 0,
    round: 1, roundStart: 0, results: [],
    crossing: null, reserved: {},
    effects: [], introStart: 0, endAt: 0,
    twoPlayers: false, level: 1, ver: 0,
    log: [], hint: null, hover: null
  };

  function makePlayer(k, cell, human) {
    return { k: k, cell: cell, from: cell, moveT: 0, dir: 0, app: k === 0 ? RED : YEL,
      lastLine: null, human: human, target: null, nextStep: 0, plan: null, visible: true, keyT: 0,
      thinkAt: 0, pending: false, crossQueued: false };
  }

  function newBoard() {
    var colors = G.colors, tries = 0, gi, reg;
    G.pyr.fill(0);
    do {
      tries++;
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        colors[idx(c, r)] = isRing(c, r) ? 0 : 1 + ((Math.random() * 7) | 0);
      }
      gi = idx(7 + ((Math.random() * 2) | 0), 7 + ((Math.random() * 2) | 0));
      reg = E.region(colors, G.pyr, [gi], -1, -1, null);
    } while ((reg.exitR + reg.exitY > 0 || reg.size > 4) && tries < 500);
    G.pyrList = [];
    while (G.pyrList.length < 4) {
      var pc = 2 + ((Math.random() * 12) | 0), pr = 2 + ((Math.random() * 12) | 0), pi = idx(pc, pr);
      if (G.pyr[pi] || Math.abs(pc - colOf(gi)) + Math.abs(pr - rowOf(gi)) < 3) continue;
      if (G.pyrList.some(function (q) { return colOf(q) === pc || rowOf(q) === pr; })) continue;
      G.pyr[pi] = 1; G.pyrList.push(pi);
    }
    G.grey = { cell: gi, from: gi, t0: 0, moving: false, next: 0, dir: 2, gone: false };
    G.ver++;
  }

  // ---------- Round flow ----------

  function newGame() {
    G.twoPlayers = settings.mode === 2;
    G.level = settings.level;
    G.turnLen = LEVELS[G.level].turnLen;
    G.results = [];
    G.log = [];
    renderLog();
    setPaused(false);
    startRound(1);
  }

  function startRound(n) {
    hideOverlay();
    G.round = n;
    newBoard();
    G.players = [makePlayer(0, idx(4, 0), G.twoPlayers), makePlayer(1, idx(N - 1, 11), true)];
    G.players[0].dir = 2; G.players[1].dir = 3;
    G.turn = n === 1 ? 1 : 0;
    G.crossing = null; G.reserved = {}; G.effects = []; G.hint = null;
    G.phase = 'intro';
    G.introStart = clock();
    G.turnId++;
    Lehcim.play('s3', 0.6);
    updateMusic();
    addLog(null, 'Manche ' + n + ' : le ' + NAMES[G.turn] + ' commence');
  }

  function beginPlay(now) {
    G.phase = 'play';
    G.roundStart = now;
    G.grey.next = now + 800;
    startTurn(G.turn, now);
  }

  function startTurn(k, now) {
    G.turn = k;
    G.turnStart = now;
    G.turnId++;
    G.hint = null;
    var p = G.players[k];
    p.target = null; p.plan = null; p.pending = false; p.crossQueued = false;
    if (!p.human) p.thinkAt = now + 500;
    else announceTurn(p);
  }

  function announceTurn(p) {
    if (G.twoPlayers) toast('Au globule ' + NAMES[p.k], 1200);
    else if (p.human) toast('À vous de jouer', 1100);
  }

  function nextTurn(now) { startTurn(1 - G.turn, now); }

  function roundSeconds(now) { return Math.max(0, Math.floor((now - G.roundStart) / 1000)); }

  function endRound(winner, now) {
    var secs = Math.max(1, Math.round((now - G.roundStart) / 1000));
    G.results.push({ winner: winner, secs: secs });
    G.phase = 'end';
    G.endAt = now + 2200;
    G.crossing = null; G.hint = null;
    var gx = cellX(G.grey.cell), gy = cellY(G.grey.cell);
    addEffect(SMOKE_X, gx, gy, now, 70, false);
    G.grey.gone = true;
    var lose = G.players[1 - winner], win = G.players[winner];
    addEffect(EXPLODE_X[lose.k], cellX(lose.cell), cellY(lose.cell), now + 200, 70, false);
    lose.visible = false;
    addEffect(SMILE_X[win.k], cellX(win.cell), cellY(win.cell), now + 300, 80, true);
    win.visible = false;
    Lehcim.play('s1', 0.8);
    addLog(winner, 'Le ' + NAMES[winner] + ' gagne la manche ' + G.round + ' en ' + secs + ' s');
    if (!G.twoPlayers && winner === 1) recordBest(secs);
  }

  function finishRound() {
    G.phase = 'msg';
    var res = G.results[G.results.length - 1];
    var who = 'Le globule ' + NAMES[res.winner] + ' a gagné en ' + res.secs + ' secondes.';
    if (G.round === 1) {
      showOverlay('Manche 1 terminée', '<p>' + who + '</p><p>Dans la manche 2, c\'est le rouge qui commence.</p>',
        [{ label: 'Manche 2', primary: true, fn: function () { if (G.phase === 'msg') startRound(2); } }]);
      return;
    }
    var a = G.results[0], b = G.results[1], extra, w;
    if (a.winner === b.winner) {
      w = a.winner;
      extra = 'Le globule ' + NAMES[w] + ' a gagné les 2 manches.';
    } else if (a.secs === b.secs) {
      w = 1;
      extra = 'Chacun a gagné sa manche dans le même temps : le jaune gagne la partie.';
    } else {
      w = a.secs < b.secs ? a.winner : b.winner;
      extra = 'Manche la plus rapide : ' + Math.min(a.secs, b.secs) + ' s.';
    }
    var title = G.twoPlayers ? 'Le globule ' + NAMES[w] + ' gagne la partie !' : (w === 1 ? 'Bravo, vous gagnez la partie !' : 'L\'ordinateur gagne la partie');
    if (!G.twoPlayers) recordGame(w === 1);
    addLog(w, title);
    Lehcim.message(who + '\n' + extra + '\n' + title).then(function () {
      if (G.phase !== 'msg') return;
      G.phase = 'over';
      updateMusic();
      showOverlay(title, '<p>' + extra + '</p>', [
        { label: 'Rejouer', primary: true, fn: newGame },
        { label: 'Réglages', fn: function () { $('settings').showModal(); } }
      ]);
    });
  }

  // ---------- Moves ----------

  function occupiedByGlobule(i, except) {
    return G.players.some(function (p) { return p !== except && p.cell === i; });
  }
  function greyCells() { var gr = G.grey; return gr.moving ? [gr.from, gr.cell] : [gr.cell]; }

  function lineProblem(p, cell) {
    var L = lineFrom(cell);
    if (!L) return 'Placez-vous sur un côté (pas dans un coin)';
    if (L.id === p.lastLine) return 'Pas deux fois de suite au même endroit';
    var gc = greyCells();
    for (var k = 0; k < L.cells.length; k++) {
      if (G.pyr[L.cells[k]]) return 'Une pyramide bloque le passage';
      if (gc.indexOf(L.cells[k]) >= 0) return 'Le globule gris bloque le passage';
    }
    if (occupiedByGlobule(L.end, p)) return "La case d'arrivée est occupée";
    return null;
  }
  function crossProblem(p) { return lineProblem(p, p.cell); }

  function lineName(L) { return L.dc ? 'ligne ' + rowOf(L.start) : 'colonne ' + colOf(L.start); }

  function tryCross(p, now) {
    var why = crossProblem(p);
    if (why) { if (p.human) { toast(why); Lehcim.play('s5', 0.3); } return false; }
    var L = lineFrom(p.cell);
    G.crossing = { p: p, line: L, k: -1, t: now };
    G.reserved = {};
    L.cells.forEach(function (i) { G.reserved[i] = 1; });
    G.reserved[L.end] = 1;
    p.dir = L.dc > 0 ? 1 : L.dc < 0 ? 3 : L.dr > 0 ? 2 : 0;
    p.lastLine = L.id;
    p.target = null; p.plan = null; p.crossQueued = false;
    G.hint = null;
    G.phase = 'cross';
    Lehcim.play('s2', 0.6);
    addLog(p.k, 'Le ' + NAMES[p.k] + ' traverse la ' + lineName(L) + ' en ' + COLOR_NAMES[p.app], p.app);
    return true;
  }

  function stepCross(now) {
    var X = G.crossing;
    while (now - X.t >= CROSS_MS) {
      X.t += CROSS_MS; X.k++;
      var p = X.p, L = X.line;
      var cell = X.k < L.cells.length ? L.cells[X.k] : L.end;
      p.from = p.cell; p.cell = cell; p.moveT = X.t;
      if (X.k < L.cells.length) { G.colors[cell] = mix(G.colors[cell], p.app); G.ver++; }
      else {
        G.crossing = null; G.reserved = {};
        p.dir = inwardDir(p.cell);
        G.phase = 'play';
        G.ver++;
        nextTurn(now);
        return;
      }
    }
  }

  function inwardDir(i) {
    var c = colOf(i), r = rowOf(i);
    if (r === 0) return 2; if (r === N - 1) return 0; if (c === 0) return 1; if (c === N - 1) return 3; return 2;
  }

  function walk(p, dc, dr, now) {
    var c = colOf(p.cell) + dc, r = rowOf(p.cell) + dr;
    p.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
    if (!inside(c, r) || !isRing(c, r)) return false;
    var ni = idx(c, r);
    if (occupiedByGlobule(ni, p) || G.grey.cell === ni) return false;
    p.from = p.cell; p.cell = ni; p.moveT = now;
    G.ver++;
    return true;
  }
  function walkTo(p, ni, now) { return walk(p, colOf(ni) - colOf(p.cell), rowOf(ni) - rowOf(p.cell), now); }
  function walkRing(p, d, now) {
    var L = RING.length, ni = RING[(RING_POS[p.cell] + d + L) % L];
    if (walkTo(p, ni, now)) { p.dir = inwardDir(p.cell); return true; }
    return false;
  }

  function setColour(p, a) {
    if (p.app === a) return;
    p.app = a;
    Lehcim.play('s4', 0.5);
    renderDots();
  }
  function changeColour(p) { setColour(p, PRIMARIES[(PRIMARIES.indexOf(p.app) + 1) % 3]); }

  // ---------- Grey globule ----------

  function updateGrey(now) {
    var gr = G.grey;
    if (gr.moving && now - gr.t0 >= GREY_MOVE_MS) {
      gr.moving = false;
      gr.next = now + 150 + Math.random() * 650;
      var c = colOf(gr.cell), r = rowOf(gr.cell);
      if (isRing(c, r)) { endRound(E.zoneOwner(c, r), now); return; }
    }
    if (!gr.moving && now >= gr.next) {
      var opts = greyOptions(gr.cell);
      if (!opts.length) { gr.next = now + 300; return; }
      var ni = opts[(Math.random() * opts.length) | 0];
      var dc = colOf(ni) - colOf(gr.cell), dr = rowOf(ni) - rowOf(gr.cell);
      gr.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
      gr.from = gr.cell; gr.cell = ni; gr.t0 = now; gr.moving = true;
      G.ver++;
    }
  }

  function greyOptions(i) {
    var c = colOf(i), r = rowOf(i), col = G.colors[i], out = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nc = c + d[0], nr = r + d[1], ni = idx(nc, nr);
      if (!inside(nc, nr) || G.reserved[ni] || occupiedByGlobule(ni, null)) return;
      if (isRing(nc, nr)) { out.push(ni); return; }
      if (!G.pyr[ni] && G.colors[ni] === col) out.push(ni);
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
      msg.pyr = Array.prototype.slice.call(st.pyr);
      try { AI.worker.postMessage({ id: id, st: msg }); } catch (e) { workerFailed(); }
    } else sliceSearch(st, cb);
  }

  function searchState(p, now, depth, noise, budget) {
    var o = G.players[1 - p.k];
    var remaining = G.turnLen - (now - G.turnStart) - 1500 - budget;
    return {
      colors: new Uint8Array(G.colors), pyr: new Uint8Array(G.pyr),
      greyCell: G.grey.cell, greyBlock: greyCells(),
      me: { k: p.k, cell: p.cell, lastLine: p.lastLine, app: p.app },
      other: { cell: o.cell, lastLine: o.lastLine },
      maxSteps: Math.max(0, Math.floor(remaining / (p.human ? STEP_MS + 40 : AI_STEP_MS))),
      depth: depth, noise: noise, budgetMs: budget
    };
  }

  function updateAI(p, now) {
    if (now < p.thinkAt || p.pending) return;
    if (!p.plan) {
      var lv = LEVELS[G.level], turnId = G.turnId;
      p.pending = true;
      think(searchState(p, now, lv.depth, lv.noise, lv.budget), function (res) {
        if (G.turnId !== turnId || G.phase !== 'play') return;
        p.pending = false;
        var t = clock();
        if (!res) { p.thinkAt = t + 400; return; }
        p.plan = { start: res.start, app: res.app };
        p.thinkAt = t + 200;
        AI.last = res.stats;
      });
      return;
    }
    p.thinkAt = now + AI_STEP_MS;
    if (p.cell !== p.plan.start) {
      var path = ringPath(p.cell, p.plan.start, G.players[1 - p.k].cell);
      if (!path || !path.length || !walkTo(p, path[0], now)) p.plan = null;
      return;
    }
    if (p.app !== p.plan.app) { changeColour(p); p.thinkAt = now + 220; return; }
    if (!tryCross(p, now)) { p.plan = null; p.thinkAt = now + 150; }
  }

  // Hint for the human whose turn it is.
  var hintBusy = false;
  function askHint() {
    if (G.phase !== 'play' || paused) return;
    var p = G.players[G.turn];
    if (!p.human) { toast("Attendez votre tour pour demander un indice"); return; }
    if (hintBusy) return;
    hintBusy = true;
    var turnId = G.turnId;
    $('hintBtn').disabled = true;
    think(searchState(p, clock(), 2, 0, 300), function (res) {
      hintBusy = false;
      $('hintBtn').disabled = false;
      if (G.turnId !== turnId || G.phase !== 'play') return;
      if (!res) { toast('Aucune traversée possible pour le moment'); return; }
      G.hint = { start: res.start, app: res.app };
      var L = lineFrom(res.start);
      toast('Indice : ' + lineName(L) + ' en ' + COLOR_NAMES[res.app] + ' (case marquée)', 3000);
    });
  }

  // ---------- Aid: grey region and probabilities (cached per board version) ----------

  var aidCache = { key: '', data: null }, prevCache = { key: '', data: null };
  function occFor(k) { return G.players[k] ? G.players[k].cell : -1; }
  function currentAid() {
    if (!G.grey || G.grey.gone) return null;
    var key = G.ver + ':' + G.grey.cell;
    if (aidCache.key !== key) aidCache = { key: key, data: E.analyse(G.colors, G.pyr, G.grey.cell, occFor(0), occFor(1)) };
    return aidCache.data;
  }
  // Effect of crossing the line from 'cell' with colour 'app' for player p.
  function previewAid(p, cell, app) {
    var L = lineFrom(cell);
    if (!L || !G.grey || G.grey.gone) return null;
    var key = G.ver + ':' + G.grey.cell + ':' + cell + ':' + app;
    if (prevCache.key !== key) {
      var after = E.applyLine(G.colors, L, app);
      prevCache = { key: key, data: E.analyse(after, G.pyr, G.grey.cell, L.end, occFor(1 - p.k)) };
    }
    return prevCache.data;
  }

  // ---------- Pause ----------

  function setPaused(v) {
    if (v === paused) return;
    if (v) {
      if (G.phase !== 'play' && G.phase !== 'cross' && G.phase !== 'intro') return;
      paused = true; pauseAt = performance.now();
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
      '<li>Le gris ne passe que sur des cases de <b>sa couleur</b> (ou sur le noir).</li>' +
      '<li>À votre tour : marchez sur le noir, choisissez une couleur, puis <b>traversez</b> : les cases de la ligne se mélangent.</li>' +
      '<li>Touchez une case noire pour y aller, touchez votre globule pour traverser.</li></ul>',
      [{ label: 'Jouer', primary: true, fn: newGame }, { label: 'Règles', fn: function () { $('help').showModal(); } }]);
  }

  // ---------- Human input ----------

  function humanPlayer(k) { var p = G.players[k]; return p && p.human ? p : null; }

  function act(k, action, now) {
    if (G.phase !== 'play' || G.turn !== k || paused) return;
    var p = humanPlayer(k);
    if (!p) return;
    if (action === 'colour') { changeColour(p); return; }
    if (action === 'cross') {
      if (p.target != null && p.target !== p.cell) { p.crossQueued = true; toast('Traversée dès l\'arrivée', 1200); return; }
      tryCross(p, now); return;
    }
    p.target = null; p.crossQueued = false;
    if (action === 'cw' || action === 'ccw') walkRing(p, action === 'cw' ? 1 : -1, now);
    else walk(p, action[0], action[1], now);
  }

  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var t = e.target && e.target.tagName;
    if (t === 'SELECT' || t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, code = e.code, who = -1, action = null;
    if (k === 'p' || k === 'Escape') {
      if (paused) setPaused(false); else setPaused(true);
      e.preventDefault(); return;
    }
    if (k === 'h') { askHint(); return; }
    if (k === 'v') { toggleAid(); return; }
    if (k === 'z' || code === 'KeyW') { who = 0; action = DIRS.up; }
    else if (k === 'q' || code === 'KeyA') { who = 0; action = DIRS.left; }
    else if (k === 's' || code === 'KeyS') { who = 0; action = DIRS.down; }
    else if (k === 'd' || code === 'KeyD') { who = 0; action = DIRS.right; }
    else if (code === 'Digit2' || code === 'Numpad2' || k === '2' || k === 'é') { who = 0; action = 'colour'; }
    else if (code === 'Digit1' || code === 'Numpad1' || k === '1' || k === '&') { who = 0; action = 'cross'; }
    else if (k === 'ArrowUp') { who = 1; action = DIRS.up; }
    else if (k === 'ArrowDown') { who = 1; action = DIRS.down; }
    else if (k === 'ArrowLeft') { who = 1; action = DIRS.left; }
    else if (k === 'ArrowRight') { who = 1; action = DIRS.right; }
    else if (k === 'Enter') { who = 1; action = 'colour'; }
    else if (k === ' ' || code === 'Space') { who = 1; action = 'cross'; }
    if (who < 0) return;
    // Buttons keep their own Enter / Space behaviour.
    if (t === 'BUTTON' && (k === 'Enter' || k === ' ')) return;
    e.preventDefault();
    if (!G.twoPlayers) who = 1;
    var now = clock(), p = G.players[who];
    if (!p) return;
    if (e.repeat && (action === 'colour' || action === 'cross')) return;
    if (e.repeat && now - p.keyT < 80) return;
    p.keyT = now;
    act(who, action, now);
  });

  function cellAt(e) {
    var pos = Lehcim.canvasPos(canvas, e);
    var c = Math.floor((pos.x - OX) / CELL), r = Math.floor((pos.y - OY) / CELL);
    return inside(c, r) ? idx(c, r) : -1;
  }

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var i = cellAt(e);
    G.hover = (i >= 0 && isRing(colOf(i), rowOf(i)) && lineFrom(i)) ? i : null;
  });
  canvas.addEventListener('pointerleave', function () { G.hover = null; });

  // Tap a black cell to walk there (tap it again, or tap your globule, to cross);
  // tap inside the board to walk to the nearest end of that row / column.
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (G.phase !== 'play' || paused) return;
    var now = clock(), p = G.players[G.turn];
    if (!p.human) return;
    var i = cellAt(e);
    if (i < 0) return;
    var c = colOf(i), r = rowOf(i);
    if (i === p.cell) { tryCross(p, now); return; }
    if (isRing(c, r)) {
      if (p.target === i) { p.crossQueued = true; toast('Traversée dès l\'arrivée', 1200); return; }
      p.target = i; p.nextStep = now; p.crossQueued = false;
    } else {
      var best = null;
      [idx(c, 0), idx(c, N - 1), idx(0, r), idx(N - 1, r)].forEach(function (s) {
        var path = ringPath(p.cell, s, G.players[1 - p.k].cell);
        if (path && (!best || path.length < best.len)) best = { s: s, len: path.length };
      });
      if (best) {
        if (best.s === p.cell) { tryCross(p, now); return; }
        if (p.target === best.s) { p.crossQueued = true; toast('Traversée dès l\'arrivée', 1200); return; }
        p.target = best.s; p.nextStep = now; p.crossQueued = false;
      }
    }
  });

  function updateHumanWalk(p, now) {
    if (p.target == null || now < p.nextStep) return;
    if (p.cell === p.target) {
      p.target = null; p.dir = inwardDir(p.cell);
      if (p.crossQueued) { p.crossQueued = false; tryCross(p, now); }
      return;
    }
    var path = ringPath(p.cell, p.target, G.players[1 - p.k].cell);
    if (!path || !path.length || !walkTo(p, path[0], now)) { p.target = null; p.crossQueued = false; return; }
    p.nextStep = now + STEP_MS;
  }

  // Touch pad: hold the arrows to keep walking.
  var padTimer = null;
  function padAction(a) {
    var who = G.twoPlayers ? G.turn : 1;
    act(who, a, clock());
  }
  document.querySelectorAll('[data-pad]').forEach(function (b) {
    var a = b.getAttribute('data-pad');
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      padAction(a);
      if (a === 'cw' || a === 'ccw') {
        clearInterval(padTimer);
        padTimer = setInterval(function () { padAction(a); }, STEP_MS + 30);
      }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, function () { clearInterval(padTimer); }); });
    b.addEventListener('click', function (e) { if (e.detail === 0) padAction(a); });   // keyboard activation
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

  var RKEY = 'lehcim.colorsmix.nv.records';
  function loadRecords() { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch (e) { return {}; } }
  function saveRecords(r) { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { /* ignore */ } }
  function recBucket(r) { var k = 'l' + G.level; if (!r[k]) r[k] = { wins: 0, losses: 0, best: 0 }; return r[k]; }
  function recordBest(secs) {
    var r = loadRecords(), b = recBucket(r);
    if (!b.best || secs < b.best) { b.best = secs; saveRecords(r); toast('Nouveau record : manche gagnée en ' + secs + ' s !', 3000); }
    renderRecords();
  }
  function recordGame(won) {
    var r = loadRecords(), b = recBucket(r);
    if (won) b.wins++; else b.losses++;
    saveRecords(r); renderRecords();
  }
  function renderRecords() {
    var r = loadRecords(), b = r['l' + settings.level] || { wins: 0, losses: 0, best: 0 };
    $('records').innerHTML = '<dt>Niveau</dt><dd>' + LEVELS[settings.level].name + '</dd>' +
      '<dt>Parties gagnées</dt><dd>' + b.wins + '</dd><dt>Parties perdues</dt><dd>' + b.losses + '</dd>' +
      '<dt>Manche la plus rapide</dt><dd>' + (b.best ? b.best + ' s' : '-') + '</dd>';
  }

  // ---------- Side panel ----------

  function spriteCanvas(cv, sx, sy, w, h) {
    var c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    if (sheet) c.drawImage(sheet, sx, sy, w, h, 0, 0, cv.width, cv.height);
  }

  function buildPanel() {
    [0, 1].forEach(function (k) {
      spriteCanvas($('pl' + k).querySelector('canvas.glob'), GLOB_X[k], 2 * CELL, CELL, CELL);
      var box = document.querySelector('.dots[data-k="' + k + '"]');
      box.innerHTML = '';
      PRIMARIES.forEach(function (col) {
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
    // colour legend
    var L = $('legend');
    var rows = [[1, 2, 3], [2, 4, 6], [1, 4, 5], [3, 4, 7], [3, 1, 2, 'on retire le rouge'], [1, 1, 1, 'inchangé']];
    L.innerHTML = '';
    rows.forEach(function (rw) {
      var d = document.createElement('div');
      [rw[0], '+', rw[1], '=', rw[2]].forEach(function (x) {
        if (typeof x === 'string') { var s = document.createElement('span'); s.textContent = x; d.appendChild(s); return; }
        var cv = document.createElement('canvas'); cv.width = 24; cv.height = 24; cv.title = COLOR_NAMES[x];
        spriteCanvas(cv, TILE[x][0], TILE[x][1], CELL, CELL);
        d.appendChild(cv);
      });
      var txt = document.createElement('span');
      txt.className = rw[3] ? 'note' : '';
      txt.textContent = rw[3] ? '(' + rw[3] + ')' : COLOR_NAMES[rw[2]];
      d.appendChild(txt);
      L.appendChild(d);
    });
    renderDots();
  }

  function renderDots() {
    [0, 1].forEach(function (k) {
      var p = G.players[k], app = p ? p.app : (k === 0 ? RED : YEL);
      var can = p && p.human && G.turn === k && G.phase === 'play';
      document.querySelectorAll('.dots[data-k="' + k + '"] .dot').forEach(function (b) {
        var col = +b.dataset.col, on = col === app;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = !can;
        var spr = on ? DOTS_ON[col] : DOTS[col];
        spriteCanvas(b.querySelector('canvas'), spr[0], spr[1], CELL, CELL);
      });
    });
  }

  function renderKeys() {
    var two = settings.mode === 2;
    $('keysBox').innerHTML = two
      ? '<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span><span>jaune : marcher</span><span><kbd>Entrée</kbd> <kbd>Espace</kbd></span><span>jaune : couleur, traverser</span>' +
        '<span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd></span><span>rouge : marcher</span><span><kbd>2</kbd> <kbd>1</kbd></span><span>rouge : couleur, traverser</span>'
      : '<span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></span><span>marcher sur le noir</span><span><kbd>Entrée</kbd></span><span>changer de couleur</span>' +
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
      sw.style.background = e.app ? SWATCH[e.app] : e.k === 0 ? '#e02020' : e.k === 1 ? '#f0e000' : 'transparent';
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
    else if (G.phase === 'intro') { st = 'Manche ' + G.round; sub = 'Les pyramides se dressent...'; }
    else if (G.phase === 'end' || G.phase === 'msg') { var r = G.results[G.results.length - 1]; st = 'Le ' + NAMES[r.winner] + ' gagne la manche'; sub = 'en ' + r.secs + ' s'; }
    else if (G.phase === 'cross') { st = 'Le ' + NAMES[G.crossing.p.k] + ' traverse'; sub = 'Les couleurs se mélangent.'; }
    else if (!p.human) {
      st = 'L\'ordinateur (rouge) joue';
      sub = p.plan ? 'Il se dirige vers sa case de départ.' : 'Il réfléchit...';
    } else {
      st = G.twoPlayers ? 'Au globule ' + NAMES[p.k] : 'À vous (globule jaune)';
      var why = crossProblem(p);
      sub = p.target != null ? (p.crossQueued ? 'En route, traversée à l\'arrivée.' : 'En route...') : why ? why + '.' : 'Traversée possible : ' + (G.twoPlayers && p.k === 0 ? 'touche 1' : 'Espace') + ' ou touchez votre globule.';
    }
    if (paused) { st = 'Pause'; sub = 'Appuyez sur P ou « Reprendre ».'; }
    setText('status', st);
    if (G.phase === 'play' && !p.human && !p.plan && !paused) setHTML('substatus', 'Il réfléchit <span class="think" aria-hidden="true"><i></i><i></i><i></i></span>');
    else setText('substatus', sub);

    // turn timer
    var frac = 0, secs = '-';
    if (G.phase === 'play') { var left = Math.max(0, G.turnLen - (now - G.turnStart)); frac = left / G.turnLen; secs = (left / 1000).toFixed(1) + ' s'; }
    else if (G.phase === 'cross') { frac = 1; secs = 'traversée'; }
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
      var cc = a ? E.connection(G.colors, G.pyr, G.grey.cell, occFor(0), occFor(1)) : null;
      setText('conn', cc ? 'rouge ' + fmtConn(cc.red) + ', jaune ' + fmtConn(cc.yel) : '-');
      var pv = previewSource(), after = '';
      if (a && pv) {
        var b = previewAid(pv.p, pv.cell, pv.p.app);
        if (b) {
          var mine = pv.p.k === 0 ? b.longR - a.longR : b.longY - a.longY;
          var theirs = pv.p.k === 0 ? b.longY - a.longY : b.longR - a.longR;
          after = 'Après cette traversée : vous ' + fmtDelta(mine) + ', adversaire ' + fmtDelta(-theirs, theirs);
        }
      }
      setHTML('after', after);
    }
    var canHint = G.phase === 'play' && p && p.human && !paused && !hintBusy;
    $('hintBtn').disabled = !canHint;
  }
  function fmtConn(n) { return n >= 12 ? '12+' : String(n); }
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
    if (G.phase === 'intro' && now - G.introStart > 16 * 60 + 600) beginPlay(now);
    if (G.phase === 'play' || G.phase === 'cross') {
      updateGrey(now);
      if (G.phase === 'cross') stepCross(now);
    }
    if (G.phase === 'play') {
      var p = G.players[G.turn];
      if (p.human) updateHumanWalk(p, now); else updateAI(p, now);
      if (G.phase === 'play' && now - G.turnStart >= G.turnLen) {
        Lehcim.play('s5', 0.6);
        toast('Temps écoulé : au tour du globule ' + NAMES[1 - G.turn]);
        addLog(G.turn, 'Le ' + NAMES[G.turn] + ' a laissé passer son tour');
        nextTurn(now);
      }
    }
    if (G.phase === 'end' && now >= G.endAt) finishRound();
  }

  // ---------- Drawing ----------

  function blit(sx, sy, w, h, dx, dy, dw, dh) { Lehcim.blit(g, sheet, sx, sy, w, h, dx, dy, dw, dh); }

  function drawFrame() {
    var B = OX + N * CELL;
    for (var x = OX; x < B; x += 48) { blit(WALL.top[0], WALL.top[1], 48, 48, x, 0); blit(WALL.bottom[0], WALL.bottom[1], 48, 48, x, B); }
    for (var y = OY; y < B; y += 48) { blit(WALL.left[0], WALL.left[1], 48, 48, 0, y); blit(WALL.right[0], WALL.right[1], 48, 48, B, y); }
    blit(WALL.tl[0], WALL.tl[1], 48, 48, 0, 0); blit(WALL.tr[0], WALL.tr[1], 48, 48, B, 0);
    blit(WALL.bl[0], WALL.bl[1], 48, 48, 0, B); blit(WALL.br[0], WALL.br[1], 48, 48, B, B);
  }

  function lerpPos(from, to, t) {
    return { x: cellX(from) + (cellX(to) - cellX(from)) * t, y: cellY(from) + (cellY(to) - cellY(from)) * t };
  }
  function drawGlobule(sx, dir, frame, x, y) { blit(sx + frame * CELL, dir * CELL, CELL, CELL, x, y); }

  // Which crossing to preview: the hovered black cell, else the active human's cell.
  function previewSource() {
    if (G.phase !== 'play' || paused) return null;
    var p = G.players[G.turn];
    if (!p || !p.human) return null;
    if (G.hover != null && G.hover !== p.cell) return { p: p, cell: G.hover, hover: true };
    if (p.target != null && p.target !== p.cell) return { p: p, cell: p.target, hover: false };
    return lineFrom(p.cell) ? { p: p, cell: p.cell, hover: false } : null;
  }

  function drawBoard(now) {
    var i, c, r;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      i = idx(c, r);
      var t = TILE[G.colors[i]];
      blit(t[0], t[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
    }
    var active = (G.phase === 'play') ? G.players[G.turn] : null;
    if (active && active.lastLine) {
      for (r = 1; r < N - 1; r++) for (c = 1; c < N - 1; c++) {
        if (('c' + c) === active.lastLine || ('r' + r) === active.lastLine) blit(NET[0], NET[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
      }
    }
    G.pyrList.forEach(function (pi) {
      var f = 15;
      if (G.phase === 'intro') f = Math.min(15, Math.max(0, Math.floor((now - G.introStart) / 60)));
      blit(RISE_X, RISE_Y + f * CELL, CELL, CELL, cellX(pi), cellY(pi));
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
    }
    if (why) {
      // forbidden line: dimmed, with a red cross on its ends
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      [a, b].forEach(function (i) {
        g.strokeStyle = '#ff5050'; g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cellX(i) + 6, cellY(i) + 6); g.lineTo(cellX(i) + CELL - 6, cellY(i) + CELL - 6);
        g.moveTo(cellX(i) + CELL - 6, cellY(i) + 6); g.lineTo(cellX(i) + 6, cellY(i) + CELL - 6);
        g.stroke();
      });
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
    var d = DOTS[G.hint.app];
    blit(d[0], d[1], CELL, CELL, cellX(s) + 6, cellY(s) + 6, 12, 12);
    g.strokeStyle = 'rgba(80,255,140,0.5)'; g.lineWidth = 1;
    var e = L.end;
    g.beginPath();
    g.moveTo(cellX(s) + CELL / 2, cellY(s) + CELL / 2);
    g.lineTo(cellX(e) + CELL / 2, cellY(e) + CELL / 2);
    g.stroke();
  }

  function drawActors(now) {
    var gr = G.grey;
    if (gr && !gr.gone && G.phase !== 'idle') {
      var t = gr.moving ? Math.min(1, (now - gr.t0) / GREY_MOVE_MS) : 1;
      var q = lerpPos(gr.from, gr.cell, t);
      var gf = gr.moving ? Math.floor((now - gr.t0) / 35) % 12 : Math.floor(now / 160) % 12;
      drawGlobule(GLOB_X[2], gr.dir, gf, q.x, q.y);
    }
    G.players.forEach(function (p) {
      if (!p.visible) return;
      var tt = Math.min(1, (now - p.moveT) / (G.crossing && G.crossing.p === p ? CROSS_MS : STEP_MS));
      var q = lerpPos(p.from, p.cell, tt);
      var moving = tt < 1;
      var f = moving ? Math.floor(now / 60) % 6 : Math.floor(now / 180) % 6;
      if (G.phase === 'play' && G.turn === p.k && (reduceMotion || Math.floor(now / 400) % 2 === 0)) {
        g.strokeStyle = p.k === 0 ? '#ff4040' : '#ffff40';
        g.lineWidth = 2; g.strokeRect(q.x + 1, q.y + 1, CELL - 2, CELL - 2);
      }
      drawGlobule(GLOB_X[p.k], p.dir, f, q.x, q.y);
      // thinking bubble
      if (G.phase === 'play' && G.turn === p.k && !p.human && !p.plan) {
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(q.x - 2, q.y - 12, 28, 10);
        g.fillStyle = '#fff';
        for (var d = 0; d < 3; d++) {
          var on = reduceMotion || Math.floor(now / 200) % 3 === d;
          g.globalAlpha = on ? 1 : 0.35;
          g.fillRect(q.x + 4 + d * 7, q.y - 9, 4, 4);
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

  function drawBanner(now) {
    if (G.phase !== 'intro') return;
    var t = (now - G.introStart) / (16 * 60 + 600);
    var text = t < 0.6 ? 'Manche ' + G.round : 'Partez !';
    g.font = 'bold 28px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var cx = OX + N * CELL / 2, cy = OY + N * CELL / 2;
    var w = g.measureText(text).width + 36;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(cx - w / 2, cy - 26, w, 52);
    g.fillStyle = '#fff'; g.fillText(text, cx, cy + 1);
    g.textAlign = 'left';
  }

  function draw(now) {
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
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
    newBoard();
    G.players = [makePlayer(0, idx(4, 0), false), makePlayer(1, idx(N - 1, 11), true)];
    G.players[0].dir = 2; G.players[1].dir = 3;
    buildPanel();
    fit();
    startScreen();
    requestAnimationFrame(frame);
  });

  // Hooks for automated tests.
  window.ColoursMixNV = { G: G, E: E, AI: AI, settings: settings, newGame: newGame, endRound: endRound,
    setPaused: setPaused, askHint: askHint, clock: clock, crossProblem: crossProblem, tryCross: tryCross };
})();
