/*
 * Colours-MIX (version 2) - browser port of the Windows 3.x game by Lehcim Noil.
 * Two globules (red and yellow) take turns: they walk on the black ring around a
 * coloured board, choose an "application colour" and cross the board, mixing the
 * colours of the cells they cross. A grey globule wanders at random but may only
 * step onto a cell of the same colour or onto black: red wants it to reach the top
 * or bottom black zone, yellow the left or right one.
 * Uses the original sprite sheet (assets/sheet.png) and sounds (assets/sounds/).
 */
(function () {
  'use strict';

  // ---------- Constants ----------

  var N = 16;                 // board cells per side, black ring included
  var CELL = 24;              // cell size in pixels (sheet tiles are 24x24)
  var OX = 48, OY = 48;       // board origin inside the metal frame
  var KEY = [184, 10, 70];    // crimson key colour of the sheet
  var RED = 1, BLUE = 2, YEL = 4;  // colours are bit masks of the 3 primaries
  var PRIMARIES = [RED, BLUE, YEL];
  var COLOR_NAMES = { 1: 'rouge', 2: 'bleu', 4: 'jaune' };
  var STEP_MS = 110;          // walking speed on the black ring
  var CROSS_MS = 75;          // time per cell while crossing
  var GREY_MOVE_MS = 420;     // grey globule step duration

  // Sprite sheet rectangles
  var TILE = {                // board cell tiles by colour mask (0 = black zone)
    0: [0, 48], 1: [24, 0], 3: [48, 0], 2: [24, 24], 6: [48, 24], 4: [24, 48], 5: [48, 48], 7: [0, 72]
  };
  var NET = [0, 24];          // diamond net overlay (forbidden line, note 1)
  var PYRAMID = [0, 0];
  var DOTS = { 1: [72, 0], 2: [72, 24], 4: [72, 48] };       // application colour buttons
  var DOTS_ON = { 1: [72, 72], 2: [72, 96], 4: [72, 120] };  // pressed look
  var WALL = {                // 48x48 metal frame pieces
    top: [0, 288], bottom: [0, 144], left: [0, 240], right: [0, 192],
    tl: [48, 288], tr: [48, 240], bl: [48, 192], br: [48, 144]
  };
  var ROUNDS_SPR = [208, 0, 82, 80];     // "manche 1 / manche 2" indicator
  var GAUGE_SPR = [208, 80, 78, 150];    // oval timer gauge
  var GAUGE_BAR = [33, 32, 11, 84];      // blue bar inside the gauge (relative)
  var GLOB_X = [368, 512, 656];          // red, yellow, grey globule animation grids
  var EXPLODE_X = [152, 96];             // red, yellow explosions (14 frames, 28 px pitch)
  var SMILE_X = [180, 124];              // red, yellow: smoke then smiley (14 frames)
  var SMOKE_X = 288;                     // grey puff (14 frames)
  var RISE_X = 344, RISE_Y = 24;         // pyramid rising (16 frames, 24 px pitch)

  // ---------- Page and assets ----------

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var modeSel = document.getElementById('mode');
  var levelSel = document.getElementById('level');
  var musicChk = document.getElementById('music');
  var sheet = null;
  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);

  var SND = {};
  [1, 2, 3, 4, 5].forEach(function (n) { SND['s' + n] = 'assets/sounds/' + n + '.wav'; });
  // Loaded after the first user gesture (browsers refuse audio before it).
  var soundsLoaded = false;
  function loadSoundsOnce() { if (!soundsLoaded) { soundsLoaded = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSoundsOnce, { once: true }); });
  // Sound 6 is a 25 s tune by Nivek: background music, looped.
  var music = new Audio('assets/sounds/6.wav');
  music.loop = true; music.volume = 0.35;
  try { musicChk.checked = localStorage.getItem('lehcim.colorsmix.music') !== '0'; } catch (e) { /* ignore */ }

  function updateMusic() {
    var want = musicChk.checked && !Lehcim.isMuted() && G.phase !== 'idle' && G.phase !== 'over';
    if (want && music.paused) { var p = music.play(); if (p && p.catch) p.catch(function () { /* autoplay */ }); }
    else if (!want && !music.paused) music.pause();
  }
  musicChk.addEventListener('change', function () {
    try { localStorage.setItem('lehcim.colorsmix.music', musicChk.checked ? '1' : '0'); } catch (e) { /* ignore */ }
    musicChk.blur();
  });

  // ---------- Board helpers ----------

  function idx(c, r) { return r * N + c; }
  function colOf(i) { return i % N; }
  function rowOf(i) { return (i / N) | 0; }
  function isRing(c, r) { return c === 0 || r === 0 || c === N - 1 || r === N - 1; }
  function isCorner(c, r) { return (c === 0 || c === N - 1) && (r === 0 || r === N - 1); }
  function inside(c, r) { return c >= 0 && r >= 0 && c < N && r < N; }
  // Red zones are the top and bottom bands, yellow zones the left and right ones.
  function zoneOwner(c, r) { return (r === 0 || r === N - 1) ? 0 : 1; }

  // Colour mixing: XOR of the primaries; a pure colour keeps itself.
  function mix(m, a) { var n = m ^ a; return n === 0 ? a : n; }

  // Ring cells in clockwise order (used for mouse walking and AI paths).
  var RING = [];
  (function () {
    var c, r;
    for (c = 0; c < N; c++) RING.push(idx(c, 0));
    for (r = 1; r < N; r++) RING.push(idx(N - 1, r));
    for (c = N - 2; c >= 0; c--) RING.push(idx(c, N - 1));
    for (r = N - 2; r > 0; r--) RING.push(idx(0, r));
  })();
  var RING_POS = {};
  RING.forEach(function (v, k) { RING_POS[v] = k; });

  // Shortest walk along the ring from a to b that avoids the cell 'block'.
  // Returns the list of cells (without a) or null.
  function ringPath(a, b, block) {
    if (a === b) return [];
    var L = RING.length, best = null;
    [1, -1].forEach(function (d) {
      var path = [], k = RING_POS[a];
      for (var n = 0; n < L; n++) {
        k = (k + d + L) % L;
        if (RING[k] === block) return;
        path.push(RING[k]);
        if (RING[k] === b) break;
      }
      if (!best || path.length < best.length) best = path;
    });
    return best;
  }

  // Crossing line starting at ring cell s: {id, dir, cells (central), end}
  function lineFrom(s) {
    var c = colOf(s), r = rowOf(s), dc = 0, dr = 0;
    if (isCorner(c, r) || !isRing(c, r)) return null;
    if (r === 0) dr = 1; else if (r === N - 1) dr = -1; else if (c === 0) dc = 1; else dc = -1;
    var cells = [];
    for (var k = 1; k < N - 1; k++) cells.push(idx(c + dc * k, r + dr * k));
    return { id: dc ? 'r' + r : 'c' + c, dc: dc, dr: dr, cells: cells, end: idx(c + dc * (N - 1), r + dr * (N - 1)) };
  }

  // ---------- Game state ----------

  var G = {
    phase: 'idle',            // idle, intro, play, cross, end, over
    colors: new Uint8Array(N * N),
    pyr: new Uint8Array(N * N),
    pyrList: [],
    grey: null,
    players: [],
    turn: 0, turnStart: 0, turnLen: 12000,
    round: 1, roundStart: 0, results: [],
    crossing: null, reserved: {},
    effects: [], introStart: 0, endAt: 0,
    twoPlayers: false, level: 0
  };

  function makePlayer(k, cell, human) {
    return { k: k, cell: cell, from: cell, moveT: 0, dir: 0, app: k === 0 ? RED : YEL,
      lastLine: null, human: human, target: null, nextStep: 0, plan: null, visible: true, keyT: 0 };
  }

  // Random board: the grey globule starts in the middle, in a small region that
  // does not touch the black ring yet.
  function newBoard() {
    var colors = G.colors, tries = 0, gi;
    do {
      tries++;
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        colors[idx(c, r)] = isRing(c, r) ? 0 : [1, 2, 3, 4, 5, 6, 7][(Math.random() * 7) | 0];
      }
      gi = idx(7 + ((Math.random() * 2) | 0), 7 + ((Math.random() * 2) | 0));
      G.pyr.fill(0);
      var info = component(colors, gi, G.pyr);
    } while ((info.exits > 0 || info.size > 4) && tries < 500);
    // pyramids: 4 obstacles, away from the grey globule
    G.pyrList = [];
    while (G.pyrList.length < 4) {
      var pc = 2 + ((Math.random() * 12) | 0), pr = 2 + ((Math.random() * 12) | 0), pi = idx(pc, pr);
      if (G.pyr[pi] || Math.abs(pc - colOf(gi)) + Math.abs(pr - rowOf(gi)) < 3) continue;
      if (G.pyrList.some(function (q) { return colOf(q) === pc || rowOf(q) === pr; })) continue;
      G.pyr[pi] = 1; G.pyrList.push(pi);
    }
    G.grey = { cell: gi, from: gi, t0: 0, moving: false, next: 0, dir: 2 };
  }

  // Region the grey globule can roam: cells of its colour connected to it.
  function component(colors, start, pyr) {
    var col = colors[start], seen = {}, q = [start], size = 0, exits = 0;
    seen[start] = 1;
    while (q.length) {
      var i = q.shift(), c = colOf(i), r = rowOf(i); size++;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nc = c + d[0], nr = r + d[1], ni = idx(nc, nr);
        if (seen[ni]) return;
        if (isRing(nc, nr)) { exits++; seen[ni] = 1; return; }
        if (!pyr[ni] && colors[ni] === col) { seen[ni] = 1; q.push(ni); }
      });
    }
    return { size: size, exits: exits };
  }

  // ---------- Round flow ----------

  function newGame() {
    G.twoPlayers = modeSel.value === '2';
    G.level = +levelSel.value;
    G.turnLen = G.level ? 8000 : 12000;
    G.results = [];
    startRound(1);
  }

  function startRound(n) {
    G.round = n;
    newBoard();
    G.players = [makePlayer(0, idx(4, 0), G.twoPlayers), makePlayer(1, idx(N - 1, 11), true)];
    G.players[0].dir = 2; G.players[1].dir = 3;
    G.turn = n === 1 ? 1 : 0;        // yellow starts round 1, red round 2
    G.crossing = null; G.reserved = {}; G.effects = [];
    G.phase = 'intro';
    G.introStart = performance.now();
    Lehcim.play('s3', 0.6);
    updateMusic();
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
    var p = G.players[k];
    p.target = null; p.plan = null;
    if (!p.human) p.thinkAt = now + 500;
  }

  function nextTurn(now) { startTurn(1 - G.turn, now); }

  function roundSeconds(now) { return Math.max(0, Math.floor((now - G.roundStart) / 1000)); }

  function endRound(winner, now) {
    var secs = Math.max(1, Math.round((now - G.roundStart) / 1000));
    G.results.push({ winner: winner, secs: secs });
    G.phase = 'end';
    G.endAt = now + 2200;
    G.crossing = null;
    var gx = cellX(G.grey.cell), gy = cellY(G.grey.cell);
    addEffect(SMOKE_X, gx, gy, now, 70, false);
    G.grey.gone = true;
    var lose = G.players[1 - winner], win = G.players[winner];
    addEffect(EXPLODE_X[lose.k], cellX(lose.cell), cellY(lose.cell), now + 200, 70, false);
    lose.visible = false;
    addEffect(SMILE_X[win.k], cellX(win.cell), cellY(win.cell), now + 300, 80, true);
    win.visible = false;
    Lehcim.play('s1', 0.8);
  }

  var NAMES = ['rouge', 'jaune'];
  function finishRound() {
    G.phase = 'msg';
    var res = G.results[G.results.length - 1];
    var text = 'Le globule ' + NAMES[res.winner] + ' a gagné en ' + res.secs + ' secondes .';
    if (G.round === 1) {
      Lehcim.message(text + '\nLa première manche est terminée .').then(function () {
        if (G.phase === 'msg') startRound(2);
      });
      return;
    }
    var a = G.results[0], b = G.results[1], extra;
    if (a.winner === b.winner) {
      extra = 'Le globule ' + NAMES[a.winner] + ' a gagné les 2 manches .\nLe globule ' + NAMES[a.winner] + ' a donc gagné la partie .';
    } else if (a.secs === b.secs) {
      extra = 'Chacun a gagné sa manche dans le même temps !\nLe jaune a donc gagné la partie .';
    } else {
      var w = a.secs < b.secs ? a.winner : b.winner;
      extra = 'Le globule ' + NAMES[w] + ' a donc gagné la partie .';
    }
    Lehcim.message(text + '\n' + extra).then(function () {
      if (G.phase === 'msg') { G.phase = 'over'; updateMusic(); }
    });
  }

  // ---------- Moves ----------

  function occupiedByGlobule(i, except) {
    return G.players.some(function (p) { return p !== except && p.cell === i; });
  }
  function greyCells() { var gr = G.grey; return gr.moving ? [gr.from, gr.cell] : [gr.cell]; }

  // Why player p cannot cross from its cell (null when allowed).
  function crossProblem(p) {
    var L = lineFrom(p.cell);
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

  function tryCross(p, now) {
    var why = crossProblem(p);
    if (why) { flash(why, now); return false; }
    var L = lineFrom(p.cell);
    G.crossing = { p: p, line: L, k: -1, t: now };
    G.reserved = {};
    L.cells.forEach(function (i) { G.reserved[i] = 1; });
    G.reserved[L.end] = 1;
    p.dir = L.dc > 0 ? 1 : L.dc < 0 ? 3 : L.dr > 0 ? 2 : 0;
    p.lastLine = L.id;
    p.target = null; p.plan = null;
    G.phase = 'cross';
    Lehcim.play('s2', 0.6);
    return true;
  }

  function stepCross(now) {
    var X = G.crossing;
    while (now - X.t >= CROSS_MS) {
      X.t += CROSS_MS; X.k++;
      var p = X.p, L = X.line;
      var cell = X.k < L.cells.length ? L.cells[X.k] : L.end;
      p.from = p.cell; p.cell = cell; p.moveT = X.t;
      if (X.k < L.cells.length) G.colors[cell] = mix(G.colors[cell], p.app);
      else {
        G.crossing = null; G.reserved = {};
        p.dir = inwardDir(p.cell);
        G.phase = 'play';
        nextTurn(now);
        return;
      }
    }
  }

  function inwardDir(i) {
    var c = colOf(i), r = rowOf(i);
    if (r === 0) return 2; if (r === N - 1) return 0; if (c === 0) return 1; if (c === N - 1) return 3; return 2;
  }

  // One step on the black ring (keyboard direction).
  function walk(p, dc, dr, now) {
    var c = colOf(p.cell) + dc, r = rowOf(p.cell) + dr;
    p.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
    if (!inside(c, r) || !isRing(c, r)) return false;
    var ni = idx(c, r);
    if (occupiedByGlobule(ni, p) || (G.grey.cell === ni)) return false;
    p.from = p.cell; p.cell = ni; p.moveT = now;
    return true;
  }
  function walkTo(p, ni, now) {
    var dc = colOf(ni) - colOf(p.cell), dr = rowOf(ni) - rowOf(p.cell);
    return walk(p, dc, dr, now);
  }

  function changeColour(p) {
    p.app = PRIMARIES[(PRIMARIES.indexOf(p.app) + 1) % 3];
    Lehcim.play('s4', 0.5);
  }

  // ---------- Grey globule ----------

  function updateGrey(now) {
    var gr = G.grey;
    if (gr.moving && now - gr.t0 >= GREY_MOVE_MS) {
      gr.moving = false;
      gr.next = now + 150 + Math.random() * 650;
      var c = colOf(gr.cell), r = rowOf(gr.cell);
      if (isRing(c, r)) { endRound(zoneOwner(c, r), now); return; }
    }
    if (!gr.moving && now >= gr.next) {
      var opts = greyOptions(gr.cell);
      if (!opts.length) { gr.next = now + 300; return; }
      var ni = opts[(Math.random() * opts.length) | 0];
      var dc = colOf(ni) - colOf(gr.cell), dr = rowOf(ni) - rowOf(gr.cell);
      gr.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
      gr.from = gr.cell; gr.cell = ni; gr.t0 = now; gr.moving = true;
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

  // ---------- Computer (red globule in one-player mode) ----------

  // Board evaluation from red's point of view: exits of the grey globule's region
  // towards red zones are good, towards yellow zones bad (closer ones weigh more).
  function evaluate(colors, greyCell, occA, occB) {
    var col = colors[greyCell], dist = {}, q = [greyCell], head = 0;
    var red = 0, yel = 0, minR = 99, minY = 99;
    dist[greyCell] = 0;
    while (head < q.length) {
      var i = q[head++], c = colOf(i), r = rowOf(i), d = dist[i];
      minR = Math.min(minR, r - 1, N - 2 - r);
      minY = Math.min(minY, c - 1, N - 2 - c);
      for (var k = 0; k < 4; k++) {
        var nc = c + (k === 0 ? 1 : k === 1 ? -1 : 0), nr = r + (k === 2 ? 1 : k === 3 ? -1 : 0);
        var ni = nr * N + nc;
        if (dist[ni] !== undefined) continue;
        if (nc === 0 || nr === 0 || nc === N - 1 || nr === N - 1) {
          dist[ni] = -1;
          if (ni === occA || ni === occB) continue;
          if (nr === 0 || nr === N - 1) red += 1 / (1 + d); else yel += 1 / (1 + d);
        } else if (!G.pyr[ni] && colors[ni] === col) { dist[ni] = d + 1; q.push(ni); }
      }
    }
    return (red - yel) * 10 + (minY - minR) * 0.3 + (q.length > 1 ? 0 : 0);
  }

  // All legal crossings for player k standing at 'pos', other globule at 'other'.
  function legalMoves(k, lastLine, other, greyBlock) {
    var moves = [];
    RING.forEach(function (s) {
      if (s === other) return;
      var L = lineFrom(s);
      if (!L || L.id === lastLine || L.end === other) return;
      for (var j = 0; j < L.cells.length; j++) {
        if (G.pyr[L.cells[j]] || greyBlock.indexOf(L.cells[j]) >= 0) return;
      }
      PRIMARIES.forEach(function (a) { moves.push({ start: s, line: L, app: a }); });
    });
    return moves;
  }

  function applyMove(colors, m) {
    var out = new Uint8Array(colors);
    m.line.cells.forEach(function (i) { out[i] = mix(out[i], m.app); });
    return out;
  }

  // Chooses the next crossing for the computer. Time-bounded (about 250 ms max).
  function aiChoose(p, now) {
    var other = G.players[1 - p.k], gc = greyCells(), greyCell = G.grey.cell;
    var remaining = G.turnLen - (now - G.turnStart) - 1500;
    var maxSteps = Math.max(0, Math.floor(remaining / (STEP_MS + 20)));
    var moves = legalMoves(p.k, p.lastLine, other.cell, gc);
    var t0 = performance.now(), deep = G.level === 1;
    var scored = [];
    moves.forEach(function (m) {
      var path = ringPath(p.cell, m.start, other.cell);
      if (!path || path.length > maxSteps) return;
      var after = applyMove(G.colors, m);
      var s1 = evaluate(after, greyCell, m.line.end, other.cell);
      var value = s1;
      if (deep && performance.now() - t0 < 250) {
        // yellow's best answer (it minimises red's score)
        var replies = legalMoves(other.k, other.lastLine, m.line.end, gc), worst = s1;
        for (var j = 0; j < replies.length; j++) {
          var after2 = applyMove(after, replies[j]);
          var s2 = evaluate(after2, greyCell, m.line.end, replies[j].line.end);
          if (s2 < worst) worst = s2;
        }
        value = 0.45 * s1 + 0.55 * worst;
      } else if (!deep) {
        value += Math.random() * 3;   // beginner: less precise
      }
      value -= path.length * 0.01 + (m.app !== p.app ? 0.005 : 0);
      scored.push({ m: m, v: value, path: path });
    });
    if (!scored.length) return null;
    scored.sort(function (a, b) { return b.v - a.v; });
    var pick = scored[0];
    if (!deep && Math.random() < 0.2) pick = scored[(Math.random() * Math.min(5, scored.length)) | 0];
    return pick;
  }

  function updateAI(p, now) {
    if (now < p.thinkAt) return;
    if (!p.plan) {
      var pick = aiChoose(p, now);
      if (!pick) { p.thinkAt = now + 400; return; }
      p.plan = { start: pick.m.start, app: pick.m.app };
      p.thinkAt = now + 200;
      return;
    }
    p.thinkAt = now + STEP_MS + 20;
    if (p.cell !== p.plan.start) {
      var path = ringPath(p.cell, p.plan.start, G.players[1 - p.k].cell);
      if (!path || !path.length || !walkTo(p, path[0], now)) p.plan = null;
      return;
    }
    if (p.app !== p.plan.app) { changeColour(p); p.thinkAt = now + 220; return; }
    if (!tryCross(p, now)) { p.plan = null; p.thinkAt = now + 150; }
  }

  // ---------- Human input ----------

  var flashMsg = null;
  function flash(text, now) { flashMsg = { text: text, until: now + 1600 }; }

  function humanPlayer(k) {
    var p = G.players[k];
    return p && p.human ? p : null;
  }

  function act(k, action, now) {
    if (G.phase !== 'play' || G.turn !== k) return;
    var p = humanPlayer(k);
    if (!p) return;
    p.target = null;
    if (action === 'colour') changeColour(p);
    else if (action === 'cross') tryCross(p, now);
    else walk(p, action[0], action[1], now);
  }

  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var t = e.target && e.target.tagName;
    if (t === 'SELECT' || t === 'INPUT') return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, code = e.code, who = -1, action = null;
    // red: Q Z S D (also by physical position), 2 colour, 1 crossing
    if (k === 'z' || (code === 'KeyW')) { who = 0; action = DIRS.up; }
    else if (k === 'q' || code === 'KeyA') { who = 0; action = DIRS.left; }
    else if (k === 's' || code === 'KeyS') { who = 0; action = DIRS.down; }
    else if (k === 'd' || code === 'KeyD') { who = 0; action = DIRS.right; }
    else if (code === 'Digit2' || code === 'Numpad2' || k === '2' || k === 'é') { who = 0; action = 'colour'; }
    else if (code === 'Digit1' || code === 'Numpad1' || k === '1' || k === '&') { who = 0; action = 'cross'; }
    // yellow: arrows, Enter colour, Space crossing
    else if (k === 'ArrowUp') { who = 1; action = DIRS.up; }
    else if (k === 'ArrowDown') { who = 1; action = DIRS.down; }
    else if (k === 'ArrowLeft') { who = 1; action = DIRS.left; }
    else if (k === 'ArrowRight') { who = 1; action = DIRS.right; }
    else if (k === 'Enter') { who = 1; action = 'colour'; }
    else if (k === ' ' || code === 'Space') { who = 1; action = 'cross'; }
    if (who < 0) return;
    e.preventDefault();
    if (!G.twoPlayers) who = 1;       // one player: both key sets drive yellow
    var now = performance.now(), p = G.players[who];
    if (!p) return;
    if (e.repeat && (action === 'colour' || action === 'cross')) return;
    if (e.repeat && now - p.keyT < 80) return;
    p.keyT = now;
    act(who, action, now);
  });

  // Pointer: tap a black cell to walk there, tap your globule to cross,
  // tap a colour button (right panel) to choose the application colour.
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (G.phase !== 'play') return;
    var pos = Lehcim.canvasPos(canvas, e), now = performance.now();
    var p = G.players[G.turn];
    if (!p.human) return;
    // colour buttons of the active player's panel
    var py = PANEL_Y[p.k] + 30;
    for (var j = 0; j < 3; j++) {
      var bx = 500 + j * 34;
      if (pos.x >= bx && pos.x < bx + 28 && pos.y >= py && pos.y < py + 28) {
        if (p.app !== PRIMARIES[j]) { p.app = PRIMARIES[j]; Lehcim.play('s4', 0.5); }
        return;
      }
    }
    var c = Math.floor((pos.x - OX) / CELL), r = Math.floor((pos.y - OY) / CELL);
    if (!inside(c, r)) return;
    var i = idx(c, r);
    if (i === p.cell) { tryCross(p, now); return; }
    if (isRing(c, r)) { p.target = i; p.nextStep = now; }
    else {
      // tapped inside the board: go to the nearest black cell of that row/column
      var best = null;
      [idx(c, 0), idx(c, N - 1), idx(0, r), idx(N - 1, r)].forEach(function (s) {
        var path = ringPath(p.cell, s, G.players[1 - p.k].cell);
        if (path && (!best || path.length < best.len)) best = { s: s, len: path.length };
      });
      if (best) { p.target = best.s; p.nextStep = now; }
    }
  });

  function updateHumanWalk(p, now) {
    if (p.target == null || now < p.nextStep) return;
    if (p.cell === p.target) { p.target = null; p.dir = inwardDir(p.cell); return; }
    var path = ringPath(p.cell, p.target, G.players[1 - p.k].cell);
    if (!path || !path.length || !walkTo(p, path[0], now)) { p.target = null; return; }
    p.nextStep = now + STEP_MS;
  }

  document.getElementById('new').addEventListener('click', function (e) { e.target.blur(); newGame(); });
  document.getElementById('abandon').addEventListener('click', function (e) {
    e.target.blur();
    if (G.phase === 'idle' || G.phase === 'over') return;
    G.phase = 'over'; G.crossing = null; G.reserved = {};
    statusEl.textContent = 'Partie abandonnée';
    updateMusic();
  });

  // ---------- Effects ----------

  function addEffect(sx, x, y, t0, ms, hold) { G.effects.push({ sx: sx, x: x, y: y, t0: t0, ms: ms, hold: hold }); }
  function cellX(i) { return OX + colOf(i) * CELL; }
  function cellY(i) { return OY + rowOf(i) * CELL; }

  // ---------- Main loop ----------

  function update(now) {
    if (G.phase === 'intro' && now - G.introStart > 16 * 60 + 300) beginPlay(now);
    if (G.phase === 'play' || G.phase === 'cross') {
      updateGrey(now);
      if (G.phase === 'cross') stepCross(now);
    }
    if (G.phase === 'play') {
      var p = G.players[G.turn];
      if (p.human) updateHumanWalk(p, now); else updateAI(p, now);
      if (G.phase === 'play' && now - G.turnStart >= G.turnLen) {
        Lehcim.play('s5', 0.6);
        flash('Temps écoulé : au tour du globule ' + NAMES[1 - G.turn], now);
        nextTurn(now);
      }
    }
    if (G.phase === 'end' && now >= G.endAt) finishRound();
    updateMusic();
    updateStatus(now);
  }

  var lastStatus = '';
  function updateStatus(now) {
    var s;
    if (G.phase === 'idle') s = 'Cliquez sur "Nouvelle partie"';
    else if (G.phase === 'over') s = statusEl.textContent === 'Partie abandonnée' ? 'Partie abandonnée' : 'Partie terminée';
    else if (G.phase === 'intro') s = 'Manche ' + G.round;
    else if (G.phase === 'end' || G.phase === 'msg') s = 'Manche ' + G.round + ' terminée';
    else s = 'Manche ' + G.round + ' - globule ' + NAMES[G.turn] + (G.players[G.turn].human ? '' : ' (ordinateur)');
    if (s !== lastStatus) { statusEl.textContent = s; lastStatus = s; }
  }

  // ---------- Drawing ----------

  function blit(sx, sy, w, h, dx, dy, dw, dh) { Lehcim.blit(g, sheet, sx, sy, w, h, dx, dy, dw, dh); }

  function drawFrame() {
    var B = OX + N * CELL;       // 432: right/bottom wall position
    for (var x = OX; x < B; x += 48) { blit(WALL.top[0], WALL.top[1], 48, 48, x, 0); blit(WALL.bottom[0], WALL.bottom[1], 48, 48, x, B); }
    for (var y = OY; y < B; y += 48) { blit(WALL.left[0], WALL.left[1], 48, 48, 0, y); blit(WALL.right[0], WALL.right[1], 48, 48, B, y); }
    blit(WALL.tl[0], WALL.tl[1], 48, 48, 0, 0); blit(WALL.tr[0], WALL.tr[1], 48, 48, B, 0);
    blit(WALL.bl[0], WALL.bl[1], 48, 48, 0, B); blit(WALL.br[0], WALL.br[1], 48, 48, B, B);
  }

  function lerpPos(from, to, t) {
    return { x: cellX(from) + (cellX(to) - cellX(from)) * t, y: cellY(from) + (cellY(to) - cellY(from)) * t };
  }

  function drawGlobule(sx, dir, frame, x, y) { blit(sx + frame * CELL, dir * CELL, CELL, CELL, x, y); }

  function drawBoard(now) {
    var i, c, r;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      i = idx(c, r);
      var t = TILE[G.colors[i]];
      blit(t[0], t[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
    }
    var active = (G.phase === 'play') ? G.players[G.turn] : null;
    // note 1: the line crossed last time by the active globule is forbidden
    if (active && active.lastLine) {
      for (r = 1; r < N - 1; r++) for (c = 1; c < N - 1; c++) {
        if (('c' + c) === active.lastLine || ('r' + r) === active.lastLine) blit(NET[0], NET[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
      }
    }
    // preview of the crossing from the active human globule's cell
    if (active && active.human && active.target == null) {
      var L = lineFrom(active.cell);
      if (L) {
        var ok = !crossProblem(active);
        g.strokeStyle = ok ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
        g.lineWidth = 2;
        g.setLineDash([4, 4]);
        var a = L.cells[0], b = L.cells[L.cells.length - 1];
        var x0 = Math.min(cellX(a), cellX(b)), y0 = Math.min(cellY(a), cellY(b));
        var x1 = Math.max(cellX(a), cellX(b)) + CELL, y1 = Math.max(cellY(a), cellY(b)) + CELL;
        g.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
        g.setLineDash([]);
      }
    }
    // pyramids (rising during the intro)
    G.pyrList.forEach(function (pi) {
      var f = 15;
      if (G.phase === 'intro') f = Math.min(15, Math.max(0, Math.floor((now - G.introStart) / 60)));
      blit(RISE_X, RISE_Y + f * CELL, CELL, CELL, cellX(pi), cellY(pi));
    });
  }

  function drawActors(now) {
    // grey globule
    var gr = G.grey;
    if (gr && !gr.gone && G.phase !== 'idle') {
      var t = gr.moving ? Math.min(1, (now - gr.t0) / GREY_MOVE_MS) : 1;
      var q = lerpPos(gr.from, gr.cell, t);
      var gf = gr.moving ? Math.floor((now - gr.t0) / 35) % 12 : Math.floor(now / 160) % 12;
      drawGlobule(GLOB_X[2], gr.dir, gf, q.x, q.y);
    }
    G.players.forEach(function (p) {
      if (!p.visible) return;
      var t = Math.min(1, (now - p.moveT) / (G.crossing && G.crossing.p === p ? CROSS_MS : STEP_MS));
      var q = lerpPos(p.from, p.cell, t);
      var moving = t < 1;
      var f = moving ? Math.floor(now / 60) % 6 : Math.floor(now / 180) % 6;
      if (G.phase === 'play' && G.turn === p.k && Math.floor(now / 400) % 2 === 0) {
        g.strokeStyle = p.k === 0 ? '#ff4040' : '#ffff40';
        g.lineWidth = 2; g.strokeRect(q.x + 1, q.y + 1, CELL - 2, CELL - 2);
      }
      drawGlobule(GLOB_X[p.k], p.dir, f, q.x, q.y);
    });
    // effects (explosions, smoke, smiley)
    G.effects.forEach(function (e) {
      if (now < e.t0) return;
      var f = Math.floor((now - e.t0) / e.ms);
      if (f > 13) { if (!e.hold) return; f = 13; }
      blit(e.sx, f * 28, 28, 28, e.x - 2, e.y - 2);
    });
  }

  var PANEL_X = 480, PANEL_Y = [284, 364];
  function drawPanel(now) {
    g.fillStyle = '#000'; g.fillRect(PANEL_X, 0, 160, 480);
    // round indicator, with the winner of each round in its oval
    var rx = PANEL_X + 39, ry = 4;
    blit(ROUNDS_SPR[0], ROUNDS_SPR[1], ROUNDS_SPR[2], ROUNDS_SPR[3], rx, ry);
    [17, 65].forEach(function (oy, n) {
      var res = G.results[n], cx = rx + 40, cy = ry + oy;
      if (res) drawGlobule(GLOB_X[res.winner], 2, 0, cx - 12, cy - 12);
      else if (G.phase !== 'idle' && G.phase !== 'over' && G.round === n + 1 && Math.floor(now / 500) % 2) {
        drawGlobule(GLOB_X[2], 2, Math.floor(now / 160) % 12, cx - 12, cy - 12);
      }
    });
    // timer gauge: the blue bar empties during the turn
    var gx = PANEL_X + 39, gy = 88;
    blit(GAUGE_SPR[0], GAUGE_SPR[1], GAUGE_SPR[2], GAUGE_SPR[3], gx, gy);
    var frac = 1;
    if (G.phase === 'play') frac = Math.max(0, 1 - (now - G.turnStart) / G.turnLen);
    else if (G.phase === 'idle' || G.phase === 'over' || G.phase === 'end' || G.phase === 'msg') frac = 0;
    var bh = GAUGE_BAR[3], empty = Math.round(bh * (1 - frac));
    g.fillStyle = '#101028';
    g.fillRect(gx + GAUGE_BAR[0], gy + GAUGE_BAR[1], GAUGE_BAR[2], empty);
    if (G.phase === 'play' || G.phase === 'cross') {
      // whose turn: the globule next to the gauge
      drawGlobule(GLOB_X[G.turn], 2, Math.floor(now / 120) % 6, gx + 29, gy + 122);
    }
    // player panels
    g.font = 'bold 13px Arial, sans-serif';
    g.textBaseline = 'top';
    [0, 1].forEach(function (k) {
      var y = PANEL_Y[k], p = G.players[k];
      g.fillStyle = k === 0 ? '#ff5050' : '#ffff50';
      var who = (k === 0 && !G.twoPlayers && G.phase !== 'idle') ? 'Rouge (ordinateur)' : (k === 0 ? 'Globule rouge' : 'Globule jaune');
      if (G.phase === 'idle') who = k === 0 ? 'Globule rouge' : 'Globule jaune';
      drawGlobule(GLOB_X[k], 2, 0, 496, y);
      g.fillText(who, 524, y + 5);
      var app = p ? p.app : (k === 0 ? RED : YEL);
      for (var j = 0; j < 3; j++) {
        var col = PRIMARIES[j], bx = 500 + j * 34, by = y + 30;
        var spr = col === app ? DOTS_ON[col] : DOTS[col];
        blit(spr[0], spr[1], CELL, CELL, bx + 2, by + 2);
        if (col === app) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(bx, by, 28, 28); }
      }
    });
    // round time
    g.fillStyle = '#c0c0d0';
    var secs = 0;
    if (G.phase === 'play' || G.phase === 'cross') secs = roundSeconds(now);
    else if (G.results.length && (G.phase === 'end' || G.phase === 'msg' || G.phase === 'over')) secs = G.results[G.results.length - 1].secs;
    g.fillText('Temps : ' + secs + ' s', 500, 446);
  }

  function drawFlash(now) {
    if (!flashMsg || now > flashMsg.until) return;
    g.font = 'bold 14px Arial, sans-serif';
    g.textBaseline = 'middle';
    var w = g.measureText(flashMsg.text).width + 20, x = OX + N * CELL / 2 - w / 2, y = 228;
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x, y - 14, w, 28);
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText(flashMsg.text, OX + N * CELL / 2, y);
    g.textAlign = 'left';
  }

  function draw(now) {
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    drawFrame();
    drawBoard(now);
    drawActors(now);
    drawPanel(now);
    drawFlash(now);
  }

  function frame(now) {
    update(now);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------

  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    newBoard();
    G.players = [makePlayer(0, idx(4, 0), false), makePlayer(1, idx(N - 1, 11), true)];
    G.players[0].dir = 2; G.players[1].dir = 3;
    requestAnimationFrame(frame);
  });

  // Small hooks for automated tests.
  window.ColoursMix = { G: G, mix: mix, evaluate: evaluate, legalMoves: legalMoves, lineFrom: lineFrom,
    crossProblem: crossProblem, aiChoose: aiChoose, idx: idx, newGame: newGame, endRound: endRound };
})();
