/*
 * Colours-MIX (version 2) - browser port of the Windows 3.x game by Lehcim Noil.
 * Rules, layout and timings were measured on the original program (run under Wine):
 * - 13 x 13 board: a ring of black cells around 11 x 11 coloured cells, the 3 x 3
 *   centre is brown and the grey globule starts in its middle.
 * - Cell colours sit on a 6 colour wheel (red, orange, yellow, green, blue, magenta)
 *   plus brown. Applying a primary colour moves a cell one step towards it along the
 *   wheel; the opposite colour turns brown; brown takes the applied colour.
 * - Red starts at the middle of the top side, yellow at the middle of the right side;
 *   both begin each round with the blue application colour (red toggles blue/red,
 *   yellow toggles blue/yellow). A crossing goes straight across the board from any
 *   side cell (not a corner) to the opposite side; a pyramid then rises on the start
 *   cell. Pyramids and globules block walking and the arrival cell.
 * - The gauge holds 80 pixels: 19.2 s per turn at "Niveau débutant", 9.6 s at
 *   "Niveau confirmé". When it is empty, the globule whose turn it is loses the round.
 * Uses the original sprite sheet (assets/sheet.png) and sounds (assets/sounds/).
 */
(function () {
  'use strict';

  // ---------- Constants ----------

  var N = 13;                 // board cells per side, black ring included
  var CELL = 24;
  var OX = 48, OY = 48;       // board origin inside the metal frame
  var W = 600, H = 401;       // client area of the original window (below its menu bar)
  var KEY = [184, 10, 70];    // crimson key colour of the sheet
  // Colour codes: 0..5 on the colour wheel, 6 brown, 7 black zone
  var RED = 0, ORANGE = 1, YEL = 2, GREEN = 3, BLUE = 4, MAGENTA = 5, BROWN = 6, BLACK = 7;
  var START_COLOURS = [RED, ORANGE, YEL, GREEN, MAGENTA];
  var OWN = [RED, YEL];       // second application colour of each globule (first is blue)
  var STEP_MS = 300;          // walking: 4 px every 50 ms
  var CROSS_MS = 300;         // crossing: same speed
  var GREY_MS = 480;          // grey globule: 4 px every 80 ms
  var RISE_MS = 1280;         // pyramid rising: 16 frames of 80 ms (the gauge waits for it)
  var GAUGE_PX = 80;
  var PX_MS = [240, 120];     // gauge speed: débutant, confirmé (ms per pixel)
  var END_MS = 2500;          // end of round animation before the message

  // Sprite sheet rectangles
  var TILE = {};
  TILE[RED] = [24, 0]; TILE[MAGENTA] = [48, 0]; TILE[BLUE] = [24, 24]; TILE[GREEN] = [48, 24];
  TILE[YEL] = [24, 48]; TILE[ORANGE] = [48, 48]; TILE[BROWN] = [0, 72]; TILE[BLACK] = [0, 48];
  var NET = [0, 24];          // cell bevel and diamond net, drawn over every cell
  var PANEL_GRID = [24, 72];  // 8 px grid drawn over the black panel
  var DOT = { 0: 0, 4: 1, 2: 2 };          // application colour -> indicator tile index
  var GAUGE_SPR = [208, 80, 78, 150], GAUGE_X = 460, GAUGE_Y = 100;
  var BAR = [33, 36, 11, 80];               // blue bar inside the gauge (relative)
  var GROOVE = ['#3a3a3a', '#3a3a3a', '#505050', '#505050', '#666666', '#666666', '#666666', '#666666', '#666666', '#666666', '#666666'];
  var ROUNDS_SPR = [208, 0, 82, 80], ROUNDS_X = 460, ROUNDS_Y = 280;
  var GLOB_X = [368, 512, 656];             // red, yellow, grey globule animation grids
  var EXPLODE_X = [152, 96];                // red, yellow explosions (14 frames, 28 px pitch)
  var SMILE_X = [180, 124];                 // red, yellow: smoke then smiley (14 frames)
  var SMOKE_X = 288;                        // grey puff (14 frames)
  var PYRAMID = [0, 0], RISE_X = 344, RISE_Y = 24;   // static pyramid, rising (16 frames)

  // ---------- Page and assets ----------

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var sheet = null;
  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);

  var SND = {};
  [1, 2, 3, 4, 5].forEach(function (n) { SND['s' + n] = 'assets/sounds/' + n + '.wav'; });
  // Loaded after the first user gesture (browsers refuse audio before it).
  var soundsLoaded = false;
  function loadSoundsOnce() { if (!soundsLoaded) { soundsLoaded = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSoundsOnce, { once: true }); });
  // Sound 6 is a 25 s tune by Nivek: background music during a game ("Musique activée").
  var music = new Audio('assets/sounds/6.wav');
  music.loop = true; music.volume = 0.35;
  var musicOn = true;
  try { musicOn = localStorage.getItem('lehcim.colorsmix.music') !== '0'; } catch (e) { /* ignore */ }

  function updateMusic() {
    var want = musicOn && !Lehcim.isMuted() && (G.phase === 'play' || G.phase === 'end');
    if (want && music.paused) { var p = music.play(); if (p && p.catch) p.catch(function () { /* autoplay */ }); }
    else if (!want && !music.paused) music.pause();
  }

  // ---------- Board helpers ----------

  function idx(c, r) { return r * N + c; }
  function colOf(i) { return i % N; }
  function rowOf(i) { return (i / N) | 0; }
  function isRing(c, r) { return c === 0 || r === 0 || c === N - 1 || r === N - 1; }
  function isCorner(c, r) { return (c === 0 || c === N - 1) && (r === 0 || r === N - 1); }
  function inside(c, r) { return c >= 0 && r >= 0 && c < N && r < N; }
  // Red's zones are the top and bottom bands, yellow's the left and right ones.
  function zoneOwner(c, r) { return (r === 0 || r === N - 1) ? 0 : 1; }

  // Colour wheel mixing (measured on the original).
  function mix(c, a) {
    if (c === BROWN || c === a) return a;
    var d = (a - c + 6) % 6;
    if (d === 3) return BROWN;
    return d < 3 ? (c + 1) % 6 : (c + 5) % 6;
  }

  // Ring cells in clockwise order (mouse walking, computer paths).
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

  // Shortest walk along the ring from a to b avoiding the cells in 'blocks'.
  // Returns the list of cells (without a) or null.
  function ringPath(a, b, blocks) {
    if (a === b) return [];
    var L = RING.length, best = null;
    [1, -1].forEach(function (d) {
      var path = [], k = RING_POS[a];
      for (var n = 0; n < L; n++) {
        k = (k + d + L) % L;
        if (blocks.indexOf(RING[k]) >= 0) return;
        path.push(RING[k]);
        if (RING[k] === b) break;
      }
      if (!best || path.length < best.length) best = path;
    });
    return best;
  }

  // Crossing line starting at ring cell s: {dc, dr, cells (11 central cells), end}
  function lineFrom(s) {
    var c = colOf(s), r = rowOf(s), dc = 0, dr = 0;
    if (isCorner(c, r) || !isRing(c, r)) return null;
    if (r === 0) dr = 1; else if (r === N - 1) dr = -1; else if (c === 0) dc = 1; else dc = -1;
    var cells = [];
    for (var k = 1; k < N - 1; k++) cells.push(idx(c + dc * k, r + dr * k));
    return { start: s, dc: dc, dr: dr, cells: cells, end: idx(c + dc * (N - 1), r + dr * (N - 1)) };
  }

  // ---------- Game state ----------

  var G = {
    phase: 'idle',            // idle, play, end, msg, over
    colors: new Uint8Array(N * N),
    pyr: [null, null],        // one pyramid per globule: {cell, t0}
    grey: null,
    players: [],
    turn: 1, gaugeStart: 0, frozenPx: null,
    round: 1, roundStart: 0, results: [], times: [null, null],
    crossing: null, effects: [], endAt: 0, endSecs: 0,
    twoPlayers: false, level: 0, aborted: false
  };
  var settings = { twoPlayers: false, level: 0 };
  try {
    settings.twoPlayers = localStorage.getItem('lehcim.colorsmix.mode') === '2';
    settings.level = localStorage.getItem('lehcim.colorsmix.level') === '1' ? 1 : 0;
  } catch (e) { /* ignore */ }

  function makePlayer(k, cell, human) {
    return { k: k, cell: cell, from: cell, moveT: 0, moveMs: STEP_MS, dir: k === 0 ? 2 : 3, app: BLUE,
      human: human, hold: null, nextStep: 0, target: null, plan: null, thinkAt: 0, visible: true };
  }

  function newBoard() {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var col;
      if (isRing(c, r)) col = BLACK;
      else if (c >= 5 && c <= 7 && r >= 5 && r <= 7) col = BROWN;
      else col = START_COLOURS[(Math.random() * 5) | 0];
      G.colors[idx(c, r)] = col;
    }
  }

  // ---------- Round flow ----------

  function newGame() {
    G.twoPlayers = settings.twoPlayers;
    G.level = settings.level;
    G.results = []; G.times = [null, null];
    G.aborted = false;
    startRound(1, performance.now());
  }

  function startRound(n, now) {
    G.round = n;
    newBoard();
    G.grey = { cell: idx(6, 6), from: idx(6, 6), t0: 0, moving: false, next: now + RISE_MS + 300, dir: 2, gone: false };
    G.players = [makePlayer(0, idx(6, 0), G.twoPlayers), makePlayer(1, idx(N - 1, 6), true)];
    G.pyr = [{ cell: idx(0, 0), t0: now }, { cell: idx(N - 1, N - 1), t0: now }];
    G.crossing = null; G.effects = []; G.frozenPx = null;
    G.roundStart = now;
    G.phase = 'play';
    startTurn(n === 1 ? 1 : 0, now);   // yellow starts round 1, red round 2
    Lehcim.play('s3', 0.6);
    updateButtons();
  }

  // The gauge starts once the last pyramid has risen.
  function startTurn(k, now) {
    G.turn = k;
    G.gaugeStart = now + RISE_MS;
    G.frozenPx = null;
    var p = G.players[k];
    p.target = null; p.plan = null; p.hold = null;
    if (!p.human) p.thinkAt = G.gaugeStart + 150;
  }

  function gaugePx(now) {
    if (G.frozenPx !== null) return G.frozenPx;
    if (now <= G.gaugeStart) return GAUGE_PX;
    return Math.max(0, GAUGE_PX - Math.floor((now - G.gaugeStart) / PX_MS[G.level]));
  }

  function roundSecs(now) { return Math.floor((now - G.roundStart) / 1000); }

  function endRound(winner, now) {
    var secs = roundSecs(now);
    G.results.push({ winner: winner, secs: secs });
    G.times[G.round - 1] = secs;
    G.phase = 'end';
    G.endAt = now + END_MS;
    G.crossing = null;
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
  }

  var NAMES = ['rouge', 'jaune'];
  function finishRound() {
    G.phase = 'msg';
    updateMusic();
    var res = G.results[G.results.length - 1];
    if (G.round === 1) {
      Lehcim.message('Le globule ' + NAMES[res.winner] + ' a gagné en ' + res.secs + ' secondes .\n\nLa première manche est terminée .').then(function () {
        if (G.phase === 'msg') startRound(2, performance.now());
      });
      return;
    }
    var a = G.results[0], b = G.results[1], title, text;
    if (a.winner === b.winner) {
      title = 'Le globule ' + NAMES[a.winner] + ' a gagné les 2 manches .';
      text = 'Le globule ' + NAMES[a.winner] + ' a donc gagné la partie .';
    } else if (a.secs === b.secs) {
      title = 'Chacun a gagné sa manche dans le même temps !';
      text = 'Partie nulle.';
    } else {
      var red = a.winner === 0 ? a : b, yel = a.winner === 1 ? a : b;
      var w = red.secs < yel.secs ? 0 : 1;
      title = w === 0 ? 'Le globule rouge a gagné en ' + red.secs + ' s., le jaune en ' + yel.secs + ' s.'
        : 'Le globule jaune a gagné en ' + yel.secs + ' s., le rouge en ' + red.secs + ' s.';
      text = 'Le globule ' + NAMES[w] + ' a donc gagné la partie .';
    }
    Lehcim.message(title + '\n\n' + text).then(function () {
      if (G.phase === 'msg') { G.phase = 'over'; updateButtons(); updateMusic(); }
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

  // Why player p cannot cross from cell s (null when allowed).
  function crossProblem(p, s) {
    var L = lineFrom(s);
    if (!L) return 'coin';
    if (walkBlocks(p).indexOf(L.end) >= 0) return 'arrivée occupée';
    return null;
  }

  function tryCross(p, now) {
    if (G.crossing || moving(p, now)) return false;
    if (crossProblem(p, p.cell)) return false;
    var L = lineFrom(p.cell);
    G.frozenPx = gaugePx(now);
    G.pyr[p.k] = null;          // the previous pyramid of this globule disappears
    G.crossing = { p: p, line: L, k: -1, t: now - CROSS_MS };
    p.dir = L.dc > 0 ? 1 : L.dc < 0 ? 3 : L.dr > 0 ? 2 : 0;
    p.target = null; p.plan = null; p.hold = null;
    Lehcim.play('s2', 0.6);
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
      } else if (X.k === L.cells.length) {
        p.from = p.cell; p.cell = L.end; p.moveT = X.t; p.moveMs = CROSS_MS;
      } else {
        G.crossing = null;
        p.dir = inwardDir(p.cell);
        G.pyr[p.k] = { cell: L.start, t0: now };
        startTurn(1 - p.k, now);
      }
    }
  }

  function inwardDir(i) {
    var c = colOf(i), r = rowOf(i);
    if (r === 0) return 2; if (r === N - 1) return 0; if (c === 0) return 1; if (c === N - 1) return 3; return 2;
  }

  function moving(p, now) { return now - p.moveT < p.moveMs; }

  // One step on the black ring.
  function walk(p, dc, dr, now) {
    var c = colOf(p.cell) + dc, r = rowOf(p.cell) + dr;
    if (!inside(c, r) || !isRing(c, r)) return false;
    var ni = idx(c, r);
    if (walkBlocks(p).indexOf(ni) >= 0) return false;
    p.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
    p.from = p.cell; p.cell = ni; p.moveT = now; p.moveMs = STEP_MS;
    return true;
  }
  function walkTo(p, ni, now) {
    return walk(p, colOf(ni) - colOf(p.cell), rowOf(ni) - rowOf(p.cell), now);
  }

  function changeColour(p) {
    p.app = p.app === BLUE ? OWN[p.k] : BLUE;
    Lehcim.play('s4', 0.5);
  }

  // ---------- Grey globule ----------

  function updateGrey(now) {
    var gr = G.grey;
    if (gr.moving && now - gr.t0 >= GREY_MS) {
      gr.moving = false;
      gr.next = now + Math.random() * 500;
      var c = colOf(gr.cell), r = rowOf(gr.cell);
      if (isRing(c, r)) { endRound(zoneOwner(c, r), now); return; }
    }
    if (!gr.moving && now >= gr.next) {
      var opts = greyOptions(gr.cell);
      if (!opts.length) { gr.next = now + 200; return; }
      var ni = opts[(Math.random() * opts.length) | 0];
      var dc = colOf(ni) - colOf(gr.cell), dr = rowOf(ni) - rowOf(gr.cell);
      gr.dir = dc > 0 ? 1 : dc < 0 ? 3 : dr > 0 ? 2 : 0;
      gr.from = gr.cell; gr.cell = ni; gr.t0 = now; gr.moving = true;
    }
  }

  // Neighbours the grey globule may enter: same colour as its own cell, or black,
  // and free of pyramids and globules.
  function greyOptions(i) {
    var c = colOf(i), r = rowOf(i), col = G.colors[i], out = [], blocks = pyrCells();
    G.players.forEach(function (p) { blocks.push(p.cell); });
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nc = c + d[0], nr = r + d[1];
      if (!inside(nc, nr)) return;
      var ni = idx(nc, nr);
      if (blocks.indexOf(ni) >= 0) return;
      if (G.colors[ni] === BLACK || G.colors[ni] === col) out.push(ni);
    });
    return out;
  }

  // ---------- Computer (red globule in one-player mode) ----------

  // Cheapest repaint distance from the grey globule's cell to each side, through
  // cells of its colour (cost 0) or of another colour (cost 1, one more crossing).
  // Returns red's advantage: positive when the top/bottom is closer than left/right.
  function evaluate(colors, greyCell, blocks) {
    var gc = colors[greyCell], dist = new Array(N * N), best = [99, 99];
    for (var i = 0; i < N * N; i++) dist[i] = 99;
    dist[greyCell] = 0;
    // 0-1 BFS
    var dq = [greyCell], head = 0;
    while (head < dq.length) {
      var v = dq[head++], c = colOf(v), r = rowOf(v), d = dist[v];
      for (var k = 0; k < 4; k++) {
        var nc = c + (k === 0 ? 1 : k === 1 ? -1 : 0), nr = r + (k === 2 ? 1 : k === 3 ? -1 : 0);
        var ni = nr * N + nc;
        if (isRing(nc, nr)) {
          if (isCorner(nc, nr)) continue;
          var extra = blocks.indexOf(ni) >= 0 ? 0.6 : 0;
          var side = (nr === 0 || nr === N - 1) ? 0 : 1;
          if (d + extra < best[side]) best[side] = d + extra;
          continue;
        }
        var w = colors[ni] === gc ? 0 : 1;
        if (d + w < dist[ni]) { dist[ni] = d + w; if (w === 0) dq.splice(head, 0, ni); else dq.push(ni); }
      }
    }
    var s = (best[1] - best[0]) * 10;
    if (best[0] === 0) s += 60;      // open path to red's zones
    if (best[1] === 0) s -= 80;      // open path to yellow's zones
    return s;
  }

  function applyLine(colors, cells, app) {
    var out = new Uint8Array(colors);
    cells.forEach(function (i) { out[i] = mix(out[i], app); });
    return out;
  }

  // Crossings player k can make: from any reachable side cell, arrival cell free.
  function legalMoves(k, pos, otherCell, pyrs, maxSteps) {
    var moves = [], blocks = pyrs.concat([otherCell]);
    RING.forEach(function (s) {
      var L = lineFrom(s);
      if (!L || blocks.indexOf(s) >= 0 || blocks.indexOf(L.end) >= 0) return;
      var path = ringPath(pos, s, blocks);
      if (!path || path.length > maxSteps) return;
      [BLUE, OWN[k]].forEach(function (a) { moves.push({ line: L, app: a, path: path }); });
    });
    return moves;
  }

  function aiChoose(p, now) {
    var other = G.players[1 - p.k];
    var remaining = (GAUGE_PX * PX_MS[G.level]) - (now - G.gaugeStart) - 1500;
    var maxSteps = Math.max(0, Math.floor(remaining / STEP_MS));
    var moves = legalMoves(p.k, p.cell, other.cell, pyrCells(), maxSteps);
    if (!moves.length) return null;
    var deep = G.level === 1, t0 = performance.now(), greyCell = G.grey.cell;
    var scored = moves.map(function (m) {
      var after = applyLine(G.colors, m.line.cells, m.app);
      // after the crossing: red's pyramid on its start cell, red on the arrival cell
      var newPyrs = (G.pyr[other.k] ? [G.pyr[other.k].cell] : []).concat([m.line.start]);
      var s1 = evaluate(after, greyCell, newPyrs.concat([m.line.end, other.cell]));
      var v = s1;
      if (deep && performance.now() - t0 < 300) {
        // yellow's best answer from where it stands (it minimises red's score)
        var replies = legalMoves(other.k, other.cell, m.line.end, newPyrs, 40), worst = s1;
        for (var j = 0; j < replies.length; j++) {
          var after2 = applyLine(after, replies[j].line.cells, replies[j].app);
          var s2 = evaluate(after2, greyCell, [m.line.start, m.line.end, replies[j].line.start, replies[j].line.end]);
          if (s2 < worst) worst = s2;
        }
        v = 0.4 * s1 + 0.6 * worst;
      } else if (!deep) {
        v += Math.random() * 6;
      }
      v -= m.path.length * 0.05 + (m.app !== p.app ? 0.02 : 0);
      return { m: m, v: v };
    });
    scored.sort(function (a, b) { return b.v - a.v; });
    var pick = scored[0];
    if (!deep && Math.random() < 0.25) pick = scored[(Math.random() * Math.min(4, scored.length)) | 0];
    return pick.m;
  }

  function updateAI(p, now) {
    if (now < p.thinkAt || G.crossing || moving(p, now)) return;
    if (!p.plan) {
      var m = aiChoose(p, now);
      if (!m) { p.thinkAt = now + 400; return; }
      p.plan = { start: m.line.start, app: m.app };
      p.thinkAt = now + 100;
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

  // ---------- Human input ----------

  function activeHuman(k) {
    if (G.phase !== 'play' || G.crossing || G.turn !== k) return null;
    var p = G.players[k];
    return p && p.human ? p : null;
  }

  function walkStep(p, d, now) {
    if (moving(p, now)) return;
    walk(p, d[0], d[1], now);
    p.nextStep = now + STEP_MS;
  }

  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function keyAction(e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key, code = e.code;
    // red: Q Z S D (also by physical position), 2 colour, 1 crossing
    if (k === 'z' || code === 'KeyW') return [0, DIRS.up];
    if (k === 'q' || code === 'KeyA') return [0, DIRS.left];
    if (k === 's' || code === 'KeyS') return [0, DIRS.down];
    if (k === 'd' || code === 'KeyD') return [0, DIRS.right];
    if (code === 'Digit2' || code === 'Numpad2' || k === '2' || k === 'é') return [0, 'colour'];
    if (code === 'Digit1' || code === 'Numpad1' || k === '1' || k === '&') return [0, 'cross'];
    // yellow: arrows, Enter colour, Space crossing
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
    if (t === 'SELECT' || t === 'INPUT') return;
    var a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    var who = a[0], action = a[1];
    if (!G.twoPlayers) who = 1;       // one player: both key sets drive yellow
    if (e.repeat) return;
    var now = performance.now(), p = activeHuman(who);
    if (!p) return;
    p.target = null;
    if (action === 'colour') changeColour(p);
    else if (action === 'cross') tryCross(p, now);
    else { p.hold = action; walkStep(p, action, now); }
  });
  document.addEventListener('keyup', function (e) {
    var a = keyAction(e);
    if (!a || typeof a[1] === 'string') return;
    G.players.forEach(function (p) { if (p.hold === a[1]) p.hold = null; });
  });
  window.addEventListener('blur', function () { G.players.forEach(function (p) { p.hold = null; }); });

  // Pointer: tap a black cell to walk there (or a coloured cell: the nearest end of its
  // row or column), tap your globule to cross, tap the right-hand panel or the
  // indicator on the wall to change the application colour.
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = activeHuman(G.turn);
    if (!p) return;
    var pos = Lehcim.canvasPos(canvas, e), now = performance.now();
    if (pos.x >= 408 || (pos.x >= 192 && pos.x < 216 && pos.y < 24) || (pos.x >= 384 && pos.y >= 192 && pos.y < 216)) {
      changeColour(p); return;
    }
    var c = Math.floor((pos.x - OX) / CELL), r = Math.floor((pos.y - OY) / CELL);
    if (!inside(c, r)) return;
    var i = idx(c, r);
    if (i === p.cell) { tryCross(p, now); return; }
    if (isRing(c, r)) { p.target = i; return; }
    var best = null;
    [idx(c, 0), idx(c, N - 1), idx(0, r), idx(N - 1, r)].forEach(function (s) {
      var path = ringPath(p.cell, s, walkBlocks(p));
      if (path && (!best || path.length < best.len)) best = { s: s, len: path.length };
    });
    if (best) p.target = best.s;
  });

  function updateHuman(p, now) {
    if (moving(p, now)) return;
    if (p.hold && now >= p.nextStep) { walkStep(p, p.hold, now); return; }
    if (p.target == null) return;
    if (p.cell === p.target) { p.target = null; p.dir = inwardDir(p.cell); return; }
    var path = ringPath(p.cell, p.target, walkBlocks(p));
    if (!path || !path.length || !walkTo(p, path[0], now)) p.target = null;
  }

  // ---------- Toolbar: menus of the original ----------

  function $(id) { return document.getElementById(id); }
  function inGame() { return G.phase === 'play' || G.phase === 'end' || G.phase === 'msg'; }
  function updateButtons() {
    // As in the original, "Mode" and "Niveau" only open between games.
    $('modeBtn').disabled = inGame();
    $('levelBtn').disabled = inGame();
  }

  $('new').addEventListener('click', function (e) {
    e.target.blur();
    if (G.phase === 'msg') return;   // a message is waiting for OK
    newGame();
  });
  $('abandon').addEventListener('click', function (e) {
    e.target.blur();
    if (G.phase !== 'play' && G.phase !== 'end') return;
    // The original simply freezes the board.
    G.phase = 'over'; G.aborted = true;
    updateButtons(); updateMusic();
  });

  function radioDialog(id, value, onOk) {
    var d = $(id);
    d.querySelectorAll('input[type=radio]').forEach(function (r) { r.checked = r.value === String(value); });
    d.querySelector('.ok').onclick = function () {
      var r = d.querySelector('input[type=radio]:checked');
      if (r) onOk(r.value);
      d.close();
    };
    d.showModal();
  }
  $('modeBtn').addEventListener('click', function (e) {
    e.target.blur();
    if (inGame()) return;
    radioDialog('modeDlg', settings.twoPlayers ? 2 : 1, function (v) {
      settings.twoPlayers = v === '2';
      try { localStorage.setItem('lehcim.colorsmix.mode', v); } catch (err) { /* ignore */ }
    });
  });
  $('levelBtn').addEventListener('click', function (e) {
    e.target.blur();
    if (inGame()) return;
    radioDialog('levelDlg', settings.level, function (v) {
      settings.level = v === '1' ? 1 : 0;
      try { localStorage.setItem('lehcim.colorsmix.level', v); } catch (err) { /* ignore */ }
    });
  });
  $('musicBtn').addEventListener('click', function (e) {
    e.target.blur();
    radioDialog('musicDlg', musicOn ? 1 : 0, function (v) {
      musicOn = v === '1';
      try { localStorage.setItem('lehcim.colorsmix.music', musicOn ? '1' : '0'); } catch (err) { /* ignore */ }
      updateMusic();
    });
  });

  // ---------- Effects ----------

  function addEffect(sx, x, y, t0, ms, hold) { G.effects.push({ sx: sx, x: x, y: y, t0: t0, ms: ms, hold: hold }); }
  function cellX(i) { return OX + colOf(i) * CELL; }
  function cellY(i) { return OY + rowOf(i) * CELL; }

  // ---------- Main loop ----------

  function update(now) {
    if (G.phase === 'play') {
      updateGrey(now);
      if (G.phase === 'play' && G.crossing) stepCross(now);
      if (G.phase === 'play' && !G.crossing) {
        var p = G.players[G.turn];
        if (p.human) updateHuman(p, now); else updateAI(p, now);
        if (!G.crossing && gaugePx(now) <= 0) {
          // time is up: the globule whose turn it is loses the round
          Lehcim.play('s5', 0.6);
          endRound(1 - G.turn, now);
        }
      }
    }
    if (G.phase === 'end' && now >= G.endAt) finishRound();
    updateMusic();
    updateStatus();
  }

  var lastStatus = '';
  function updateStatus() {
    var s;
    if (G.phase === 'idle') s = 'Cliquez sur "Nouvelle Partie"';
    else if (G.phase === 'over') s = G.aborted ? 'Partie abandonnée' : 'Partie terminée';
    else if (G.phase === 'end' || G.phase === 'msg') s = 'Manche ' + G.round + ' terminée';
    else s = 'Manche ' + G.round + ' : au tour du globule ' + NAMES[G.turn] + (G.players[G.turn].human ? '' : ' (ordinateur)');
    if (s !== lastStatus) { statusEl.textContent = s; lastStatus = s; }
  }

  // ---------- Drawing ----------

  function blit(sx, sy, w, h, dx, dy) { Lehcim.blit(g, sheet, sx, sy, w, h, dx, dy); }

  // Metal frame, rebuilt piece by piece from the original screen.
  function drawFrame() {
    blit(48, 288, 48, 48, 0, 0); blit(48, 240, 48, 48, 360, 0);
    blit(48, 192, 48, 48, 0, 360); blit(48, 144, 48, 48, 360, 360);
    [48, 96, 144, 216, 264, 312].forEach(function (v) {
      blit(0, 288, 48, 48, v, 0);      // top
      blit(0, 144, 48, 48, v, 360);    // bottom
      blit(0, 240, 48, 48, 0, v);      // left
      blit(0, 192, 48, 48, 360, v);    // right
    });
    // middle pieces (the application colour indicators sit there)
    blit(24, 360, 24, 24, 192, 24);
    blit(0, 336, 24, 48, 192, 360);
    blit(48, 360, 48, 24, 0, 192);
    blit(48, 336, 24, 24, 360, 192);
    var red = G.players[0], yel = G.players[1];
    var ra = red ? red.app : BLUE, ya = yel ? yel.app : BLUE;
    blit(72, 72 + 24 * DOT[ra], 24, 24, 192, 0);
    blit(72, 24 * DOT[ya], 24, 24, 384, 192);
  }

  function drawPanel(now) {
    g.fillStyle = '#000'; g.fillRect(408, 0, W - 408, H);
    for (var y = 0; y < H; y += 24) for (var x = 408; x < W; x += 24) blit(PANEL_GRID[0], PANEL_GRID[1], 24, 24, x, y);
    // gauge: the blue bar empties from the top
    blit(GAUGE_SPR[0], GAUGE_SPR[1], GAUGE_SPR[2], GAUGE_SPR[3], GAUGE_X, GAUGE_Y);
    var px = GAUGE_PX;
    if (G.phase === 'play') px = gaugePx(now);
    else if (G.phase === 'end' || G.phase === 'msg' || G.phase === 'over') px = G.frozenPx !== null ? G.frozenPx : gaugePx(G.endAt - END_MS);
    var empty = GAUGE_PX - px;
    for (var i = 0; i < BAR[2]; i++) {
      g.fillStyle = GROOVE[i];
      g.fillRect(GAUGE_X + BAR[0] + i, GAUGE_Y + BAR[1], 1, empty);
    }
    // round ovals with the time of each round
    blit(ROUNDS_SPR[0], ROUNDS_SPR[1], ROUNDS_SPR[2], ROUNDS_SPR[3], ROUNDS_X, ROUNDS_Y);
    g.font = 'bold 13px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    [0, 1].forEach(function (n) {
      var t = G.times[n];
      if (t == null && G.phase === 'play' && G.round === n + 1) t = roundSecs(now);
      if (t != null) g.fillText(String(t), ROUNDS_X + 41, ROUNDS_Y + (n ? 65 : 18));
    });
    g.textAlign = 'left';
  }

  function lerp(from, to, t) {
    return { x: cellX(from) + (cellX(to) - cellX(from)) * t, y: cellY(from) + (cellY(to) - cellY(from)) * t };
  }

  function drawBoard(now) {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var i = idx(c, r), t = TILE[G.phase === 'idle' ? BLACK : G.colors[i]];
      blit(t[0], t[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
      blit(NET[0], NET[1], CELL, CELL, OX + c * CELL, OY + r * CELL);
    }
    G.pyr.forEach(function (q) {
      if (!q || G.phase === 'idle') return;
      var f = Math.floor((now - q.t0) / (RISE_MS / 16));
      if (f >= 15) blit(PYRAMID[0], PYRAMID[1], CELL, CELL, cellX(q.cell), cellY(q.cell));
      else if (f >= 0) blit(RISE_X, RISE_Y + f * CELL, CELL, CELL, cellX(q.cell), cellY(q.cell));
    });
  }

  function drawGlobule(sx, dir, frame, x, y) { blit(sx + frame * CELL, dir * CELL, CELL, CELL, x, y); }

  function drawActors(now) {
    if (G.phase === 'idle') return;
    var gr = G.grey;
    if (gr && !gr.gone) {
      var t = gr.moving ? Math.min(1, (now - gr.t0) / GREY_MS) : 1;
      var q = lerp(gr.from, gr.cell, t);
      drawGlobule(GLOB_X[2], gr.dir, Math.floor(now / 80) % 12, q.x, q.y);
    }
    G.players.forEach(function (p) {
      if (!p.visible) return;
      var t2 = Math.min(1, (now - p.moveT) / p.moveMs);
      var q2 = lerp(p.from, p.cell, t2);
      var dir = (t2 >= 1 && !(G.crossing && G.crossing.p === p) && !p.hold && p.target == null) ? inwardDir(p.cell) : p.dir;
      drawGlobule(GLOB_X[p.k], dir, Math.floor(now / 80) % 6, q2.x, q2.y);
    });
    G.effects.forEach(function (e) {
      if (now < e.t0) return;
      var f = Math.floor((now - e.t0) / e.ms);
      if (f > 13) { if (!e.hold) return; f = 13; }
      blit(e.sx, f * 28, 28, 28, e.x - 2, e.y - 2);
    });
  }

  function draw(now) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    drawFrame();
    drawBoard(now);
    drawActors(now);
    drawPanel(now);
    if (G.phase === 'idle') {
      g.font = 'bold 14px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.fillText('Nouvelle Partie pour commencer', OX + N * CELL / 2, OY + N * CELL / 2);
      g.textAlign = 'left';
    }
  }

  function frame(now) {
    update(now);
    draw(now);
    requestAnimationFrame(frame);
  }

  // ---------- Start ----------

  updateButtons();
  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    newBoard();
    requestAnimationFrame(frame);
  });

  // Small hooks for automated tests.
  window.ColoursMix = { G: G, mix: mix, evaluate: evaluate, legalMoves: legalMoves, lineFrom: lineFrom,
    crossProblem: crossProblem, aiChoose: aiChoose, idx: idx, newGame: newGame, endRound: endRound,
    settings: settings };
})();
