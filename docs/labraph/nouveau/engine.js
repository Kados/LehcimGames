/*
 * LabRaph (nouvelle version) - game logic, without any drawing or DOM access.
 * Runs in the browser (global LabEngine) and in node (require) for tests.
 *
 * The rules are those of the original program (LabRaph.exe, Delphi 1), as in the
 * port ../game.js: level table, maze sizes per zoom, stone column with the exit on
 * the right, everything moving 4 px per 50 ms tick cell by cell, eggs, globules
 * following the left-hand wall and running away from the ship, snakes that stay in
 * the corridors and aim at the ship at each crossing, bullets going through the
 * globules, barrier blocking only the creatures, walls erased little by little
 * during the last 20 s.
 *
 * What this version adds without changing those rules:
 *  - a seeded random generator (mulberry32): a level can be replayed from its seed,
 *    and the "défi du jour" uses the date as seed;
 *  - fairness checks on every generated level (redrawn if one fails): every cell is
 *    reachable, no snake egg opens on the starting cell, and the shortest tour
 *    ship -> every globule egg -> exit fits comfortably in the level time;
 *  - optional turn assistance (input buffering): a short tap is remembered until the
 *    next cell centre, and a turn asked too early keeps the ship going straight to
 *    the next crossing instead of stopping it in front of a wall;
 *  - an optional countdown, and difficulty presets that only change the number of
 *    lives and the level time (the default preset is the original game).
 */
(function (root) {
  'use strict';

  var TICK = 50;                       // ms per logic step (original TTimer interval)
  var U = 0, R = 1, D = 2, L = 3;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var STEP = 4;                        // pixels per tick (ship, globules, snakes)
  var BARRIER_TICKS = 60, DARK_TIME = 20, MAX_BULLETS = 5, START_BULLETS = 2;
  var ERASE_FRAMES = 6;                // frames of the "growing floor" animation
  var COUNTDOWN_TICKS = 36, HOLD_TICKS = 16;
  var MAZE_W = 560, MAZE_H = 400;      // play area of the original (panel at x = 560)
  var ROUTE_SHARE = 0.6;               // fairness: shortest tour <= 60 % of the level time
  var FAIR_TRIES = 40;

  // One entry per zoom (tile size T): sprite size s, ticks per cell n (= T / 4),
  // maze size and length of the main path of the original.
  var ZOOMS = {
    40: { s: 24, n: 10, cols: 13, rows: 10, path: 55 },
    32: { s: 20, n: 8, cols: 16, rows: 12, path: 90 },
    20: { s: 12, n: 5, cols: 27, rows: 20, path: 180 },
    16: { s: 8, n: 4, cols: 34, rows: 25, path: 300 }
  };
  // Zoom of levels 1..25 (original table); level 26 and more: 16.
  var LEVEL_T = [40, 32, 40, 32, 40, 32, 20, 40, 32, 20, 16, 40, 32, 20, 16, 40, 32, 20, 16, 32, 20, 16, 20, 16, 20];

  // ---------- Seeded random numbers ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // FNV-1a hash of a string -> unsigned 32-bit seed.
  function hashSeed(s) {
    s = String(s);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function makeRng(seed) {
    var f = mulberry32(seed);
    return { next: f, int: function (n) { return Math.floor(f() * n); } };
  }
  function mathRng() { return { next: Math.random, int: function (n) { return Math.floor(Math.random() * n); } }; }
  // Short readable seed code, e.g. "K7Q2MX".
  function randomSeedCode() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }
  function dailySeed(date) {
    var d = date || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ---------- Levels ----------

  // Presets only change the lives and the level time; "normal" is the original game.
  var PRESETS = {
    facile: { label: 'Facile', lives: 5, time: 1.25 },
    normal: { label: 'Original', lives: 3, time: 1 },
    difficile: { label: 'Difficile', lives: 3, time: 0.85 }
  };

  function zoomOf(n) { return n <= 25 ? LEVEL_T[n - 1] : 16; }

  // Globules (= snakes), time in seconds and bullet bonus of each level (original table).
  function levelRow(n) {
    return n === 1 ? [1, 90, 0] : n === 2 ? [1, 100, 1] : n <= 4 ? [2, 110, 2] : n <= 7 ? [3, 120, 3] :
      n <= 11 ? [4, 130, 4] : n <= 15 ? [5, 140, 5] : n <= 19 ? [5, 150, 4] : n <= 22 ? [5, 160, 3] :
      n <= 24 ? [5, 170, 2] : [5, 180, 1];
  }

  function levelParams(n, cfg) {
    cfg = cfg || {};
    var pre = PRESETS[cfg.preset] || PRESETS.normal;
    var T = zoomOf(n), z = ZOOMS[T], row = levelRow(n);
    return {
      n: n, T: T, s: z.s, ticks: z.n, cols: z.cols, rows: z.rows, path: z.path,
      globs: row[0], snakes: row[0], baseTime: row[1], time: Math.round(row[1] * pre.time), bonus: row[2]
    };
  }

  // Bullets at the start of a game begun at level n: 2, plus the bonus of every level
  // passed (as if no bullet had been fired), 5 at most.
  function startBullets(n) {
    var b = START_BULLETS;
    for (var k = 2; k <= n; k++) b = Math.min(MAX_BULLETS, b + levelRow(k)[2]);
    return b;
  }

  // ---------- Maze ----------

  // As in the original: one long winding path from the ship (left column) to the exit
  // (right column), made by adding rectangular detours to an L-shaped path until it is
  // long enough, then dead-end branches grown from it until every cell is used.
  function makeMaze(cols, rows, pathLen, rng) {
    var n = cols * rows, i;
    var sr = 1 + rng.int(rows - 2), er = rng.int(rows);
    var c = 1 + rng.int(cols - 2), path = [], x, y;
    for (x = 0; x <= c; x++) path.push([x, sr]);
    for (y = sr; y !== er; ) { y += er > sr ? 1 : -1; path.push([c, y]); }
    for (x = c + 1; x < cols; x++) path.push([x, er]);
    var inPath = new Uint8Array(n);
    path.forEach(function (p) { inPath[p[1] * cols + p[0]] = 1; });
    for (var tries = 0; tries < 4000 && path.length < pathLen; tries++) {
      var len = 1 + rng.int(4), a = rng.int(path.length - len);
      var p0 = path[a], p1 = path[a + len];
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      if (Math.abs(dx) + Math.abs(dy) !== len || (dx && dy)) continue;   // not straight
      var sx = dx ? 0 : (rng.int(2) ? 1 : -1), sy = dx ? (rng.int(2) ? 1 : -1) : 0, d = 1 + rng.int(2);
      var bump = [], ok = true, k;
      for (k = 1; k <= d; k++) bump.push([p0[0] + sx * k, p0[1] + sy * k]);
      for (k = 1; k <= len; k++) bump.push([p0[0] + sx * d + Math.sign(dx) * k, p0[1] + sy * d + Math.sign(dy) * k]);
      for (k = d - 1; k >= 1; k--) bump.push([p1[0] + sx * k, p1[1] + sy * k]);
      for (k = 0; k < bump.length && ok; k++) {
        var b = bump[k];
        if (b[0] < 0 || b[1] < 0 || b[0] >= cols || b[1] >= rows || inPath[b[1] * cols + b[0]]) ok = false;
      }
      if (!ok) continue;
      for (k = a + 1; k < a + len; k++) inPath[path[k][1] * cols + path[k][0]] = 0;
      bump.forEach(function (q) { inPath[q[1] * cols + q[0]] = 1; });
      path.splice.apply(path, [a + 1, len - 1].concat(bump));
    }
    var walls = [];
    for (i = 0; i < n; i++) walls.push(15);
    function open(x1, y1, x2, y2) {
      for (var dd = 0; dd < 4; dd++) if (x1 + DX[dd] === x2 && y1 + DY[dd] === y2) {
        walls[y1 * cols + x1] &= ~(1 << dd); walls[y2 * cols + x2] &= ~(1 << ((dd + 2) % 4));
      }
    }
    for (i = 1; i < path.length; i++) open(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    var seen = new Uint8Array(n), list = [], lastDir = -1;
    path.forEach(function (p) { seen[p[1] * cols + p[0]] = 1; list.push(p[1] * cols + p[0]); });
    while (list.length) {
      var li = rng.int(3) ? list.length - 1 : rng.int(list.length), cc = list[li];
      var cx = cc % cols, cy = (cc / cols) | 0, opts = [];
      for (var dd = 0; dd < 4; dd++) {
        var nx = cx + DX[dd], ny = cy + DY[dd];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(dd);
      }
      if (!opts.length) { list.splice(li, 1); continue; }
      var dir = opts.indexOf(lastDir) >= 0 && rng.int(3) ? lastDir : opts[rng.int(opts.length)];
      var nc = (cy + DY[dir]) * cols + cx + DX[dir];
      open(cx, cy, cx + DX[dir], cy + DY[dir]);
      seen[nc] = 1; list.push(nc); lastDir = dir;
    }
    walls[er * cols + cols - 1] &= ~(1 << R);       // exit: into the stone column
    return { cols: cols, rows: rows, walls: walls, start: sr, exit: { x: cols, y: er }, mainPath: path.length };
  }

  // Is the move from (cx,cy) in direction d free of walls? The exit cell is (cols, exit row).
  function isOpenM(m, cx, cy, d) {
    if (cx === m.cols) return cy === m.exit.y && d === L;
    if (cx === m.cols - 1 && cy === m.exit.y && d === R) return true;
    return !(m.walls[cy * m.cols + cx] & (1 << d));
  }
  // Breadth-first distances (in moves) from (x,y) on the grid plus the exit cell.
  // Index of a cell: y * (cols + 1) + x.
  function bfs(m, x, y) {
    var w = m.cols + 1, dist = new Int32Array(w * m.rows).fill(-1), q = [y * w + x];
    dist[q[0]] = 0;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], cx = c % w, cy = (c / w) | 0;
      for (var d = 0; d < 4; d++) {
        if (!isOpenM(m, cx, cy, d)) continue;
        var nn = (cy + DY[d]) * w + cx + DX[d];
        if (dist[nn] < 0) { dist[nn] = dist[c] + 1; q.push(nn); }
      }
    }
    return dist;
  }

  // Length (in moves) of a short tour start -> every target (any order) -> exit.
  // Nearest neighbour, then 2-opt on the breadth-first distances (5 targets at most).
  function planRoute(m, start, targets) {
    var w = m.cols + 1, pts = [start].concat(targets);
    var maps = pts.map(function (c) { return bfs(m, c % w, (c / w) | 0); });
    var exitC = m.exit.y * w + m.exit.x;
    function dd(a, b) { return maps[a][pts[b]]; }
    function len(o) {
      var t = 0, p = 0;
      for (var i = 0; i < o.length; i++) { if (dd(p, o[i]) < 0) return Infinity; t += dd(p, o[i]); p = o[i]; }
      return maps[p][exitC] < 0 ? Infinity : t + maps[p][exitC];
    }
    var order = [], used = new Uint8Array(pts.length), cur = 0;
    for (var s = 1; s < pts.length; s++) {
      var best = -1, bd = Infinity;
      for (var j = 1; j < pts.length; j++) {
        var v = dd(cur, j) < 0 ? Infinity : dd(cur, j);
        if (!used[j] && (best < 0 || v < bd)) { bd = v; best = j; }
      }
      used[best] = 1; order.push(best); cur = best;
    }
    var bestLen = len(order), improved = true;
    while (improved && isFinite(bestLen)) {
      improved = false;
      for (var a = 0; a < order.length - 1; a++) {
        for (var b = a + 1; b < order.length; b++) {
          var o2 = order.slice(0, a).concat(order.slice(a, b + 1).reverse(), order.slice(b + 1));
          var l2 = len(o2);
          if (l2 < bestLen) { order = o2; bestLen = l2; improved = true; }
        }
      }
    }
    return bestLen;
  }

  // Eggs: globules first, then snakes, on distinct cells, x in 3..cols-5, y in 1..rows-2.
  function placeEggs(p, rng) {
    var used = {}, out = [];
    for (var i = 0; i < p.globs + p.snakes; i++) {
      var ex, ey;
      do { ex = 3 + rng.int(p.cols - 7); ey = 1 + rng.int(p.rows - 2); } while (used[ey * 64 + ex]);
      used[ey * 64 + ex] = 1;
      out.push({ x: ex, y: ey, kind: i < p.globs ? 'glob' : 'snake' });
    }
    return out;
  }

  // Fairness checks of a generated level (none of them changes the rules):
  //  - every cell and the exit can be reached from the ship (no sealed pocket);
  //  - no snake egg would open on the starting cell (3 cells or less in both axes);
  //  - the shortest tour ship -> every globule egg -> exit takes at most ROUTE_SHARE
  //    of the level time at 4 px per tick.
  function checkLevel(m, eggs, p) {
    var w = m.cols + 1, dist = bfs(m, 0, m.start), i, x, y;
    for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) if (dist[y * w + x] < 0) return { ok: false, why: 'pocket' };
    if (dist[m.exit.y * w + m.exit.x] < 0) return { ok: false, why: 'pocket' };
    var targets = [];
    for (i = 0; i < eggs.length; i++) {
      var e = eggs[i];
      if (e.kind === 'snake' && Math.abs(e.x) < 4 && Math.abs(e.y - m.start) < 4) return { ok: false, why: 'snake' };
      if (e.kind === 'glob') targets.push(e.y * w + e.x);
    }
    var moves = planRoute(m, m.start * w, targets), seconds = moves * p.ticks * TICK / 1000;
    if (!(seconds <= p.time * ROUTE_SHARE)) return { ok: false, why: 'time', seconds: seconds };
    return { ok: true, moves: moves, seconds: seconds };
  }

  // ---------- Level ----------

  // game: {level, lives, score, bullets (left at the end of the last level), start
  // (bullets at the start of the level), seed, attempt}. isNew: false when the level is
  // played again after a life lost (the bullets go back to their value at its start).
  // cfg: {preset, countdown (default true), fair (default true), god (demo)}.
  function createLevel(game, cfg, isNew) {
    cfg = cfg || {};
    var p = levelParams(game.level, cfg);
    var seed = game.seed != null ? hashSeed(game.seed + '/' + game.level + '/' + (game.attempt || 0)) : null;
    var rng = seed != null ? makeRng(seed) : mathRng();
    var m, eggs, check, tries = 0, rejected = { pocket: 0, snake: 0, time: 0 };
    for (;;) {
      m = makeMaze(p.cols, p.rows, p.path, rng);
      eggs = placeEggs(p, rng);
      if (cfg.fair === false) { check = { ok: true }; break; }
      check = checkLevel(m, eggs, p);
      if (check.ok || ++tries >= FAIR_TRIES) break;
      rejected[check.why]++;
    }
    if (isNew !== false) game.start = game.start == null ? startBullets(game.level) : Math.min(MAX_BULLETS, game.bullets + p.bonus);
    var w = m.cols + 1;
    var lv = {
      p: p, cfg: cfg, game: game, maze: m, T: p.T, n: p.ticks, s: p.s, seed: seed,
      rng: seed != null ? makeRng(seed ^ 0x9e3779b9) : mathRng(),   // in-game randomness
      fair: { tries: tries + 1, rejected: rejected, route: check.seconds },
      dist: bfs(m, m.exit.x, m.exit.y),                             // distance to the exit
      limit: p.time, elapsed: 0, sub: 0,
      barrier: { state: 0, k: 0, slide: 6 },
      avail: game.start, fired: 0, fireReq: false,
      occ: {}, creatures: [], bullets: [], fx: [], events: [],
      dark: false, erase: { k: 0, x: 0, y: 0 }, eraseLog: [],
      end: null, endK: 0, nearExit: false, allGlobs: false,
      state: cfg.countdown === false ? 'play' : 'countdown', tick: 0, stateTick: 0
    };
    lv.distW = w;
    lv.ship = newMover(0, m.start); lv.ship.face = U; lv.ship.state = 0;
    eggs.forEach(function (e) {
      var cr = newMover(e.x, e.y);
      cr.kind = e.kind; cr.state = 1; cr.t = 0; cr.face = D;
      lv.occ[occKey(e.x, e.y)] = cr;
      lv.creatures.push(cr);
    });
    if (lv.state === 'play') emit(lv, 'go');
    return lv;
  }

  function newMover(x, y) { return { cx: x, cy: y, dir: -1, k: 0, face: U, turn: null, anim: 0 }; }
  function occKey(x, y) { return y * 64 + x; }
  function emit(lv, type, data) { var e = data || {}; e.type = type; lv.events.push(e); }
  function setState(lv, st) { lv.state = st; lv.stateTick = 0; }
  function isOpen(lv, cx, cy, d) { return isOpenM(lv.maze, cx, cy, d); }

  // ---------- Input ----------
  // input: {held: [dirs, newest last], pivot: bool, assist: bool, buffer: dir, bufferTick}

  function newInput() { return { held: [], pivot: false, assist: true, buffer: -1, bufferTick: -99 }; }
  function inputPress(lv, input, d) {
    var i = input.held.indexOf(d); if (i >= 0) input.held.splice(i, 1);
    input.held.push(d);
    input.buffer = d; input.bufferTick = lv ? lv.tick : 0;
  }
  function inputRelease(input, d) { var i = input.held.indexOf(d); if (i >= 0) input.held.splice(i, 1); }

  // ---------- Movement ----------

  function centre(lv, c) { return c * lv.T + lv.T / 2; }
  // Pixel centre of a mover (it has already entered its cell when k > 0).
  function pos(lv, o) {
    if (o.k > 0 && o.dir >= 0) return { x: centre(lv, o.cx) - DX[o.dir] * (lv.n - o.k) * STEP, y: centre(lv, o.cy) - DY[o.dir] * (lv.n - o.k) * STEP };
    return { x: centre(lv, o.cx), y: centre(lv, o.cy) };
  }
  // Blocked for creatures: walls, other creatures, eggs and the barrier.
  function blocked(lv, o, d, creature) {
    if (!isOpen(lv, o.cx, o.cy, d)) return true;
    if (!creature) return false;
    var nx = o.cx + DX[d], ny = o.cy + DY[d];
    return !!lv.occ[occKey(nx, ny)] || (lv.barrier.state === 1 && nx === lv.maze.exit.x && ny === lv.maze.exit.y);
  }
  // Facing change: the renderer shows the turning row of the sheets (one per pair of directions).
  function setFace(lv, o, d) {
    if (d === o.face) return;
    o.turn = { from: o.face, to: d, k: 0 };
    o.face = d;
  }
  // Starts the move to the next cell or continues it. choose() returns a direction or -1.
  function advance(lv, o, choose, creature) {
    if (o.turn && ++o.turn.k >= lv.n) o.turn = null;
    o.anim++;
    if (o.k > 0) { if (++o.k >= lv.n) o.k = 0; return; }
    var d = choose(lv, o);
    if (d < 0) { o.dir = -1; return; }
    if (creature) { delete lv.occ[occKey(o.cx, o.cy)]; lv.occ[occKey(o.cx + DX[d], o.cy + DY[d])] = o; }
    o.dir = d; o.cx += DX[d]; o.cy += DY[d]; o.k = 1;
  }

  // Ship, original rule: the most recent arrow held that is open wins, else an older
  // one; if none is open the ship only turns. W (pivot) turns it without moving.
  // Assistance (optional): a tap released before the cell centre is still taken there,
  // and a turn asked too early (wall on that side) does not stop a moving ship.
  function chooseShip(lv, s) {
    var input = lv.input, held = input.held, i, cand = [];
    var momentum = s.dir;              // direction of the move that just ended (-1 if stopped)
    var fresh = input.assist && input.buffer >= 0 && lv.tick - input.bufferTick <= Math.max(6, lv.n + 2);
    if (fresh && held.indexOf(input.buffer) < 0) cand.push(input.buffer);
    for (i = held.length - 1; i >= 0; i--) cand.push(held[i]);
    if (!cand.length) return -1;
    for (i = 0; i < cand.length; i++) {
      if (blocked(lv, s, cand[i], false)) continue;
      if (cand[i] === input.buffer) input.buffer = -1;            // consumed
      setFace(lv, s, cand[i]);
      return input.pivot ? -1 : cand[i];
    }
    if (input.assist && !input.pivot && momentum >= 0 && momentum === s.face && !blocked(lv, s, momentum, false)) {
      return momentum;                 // keep going straight to the crossing asked for
    }
    setFace(lv, s, cand[0]);
    return -1;
  }
  function firstFree(lv, o, list) {
    for (var i = 0; i < list.length; i++) if (!blocked(lv, o, list[i], true)) return list[i];
    return -1;
  }
  function openCount(lv, o) { var c = 0; for (var d = 0; d < 4; d++) if (isOpen(lv, o.cx, o.cy, d)) c++; return c; }
  // Directions open in the walls, in the order left turn, straight, right turn, back.
  function leftHand(lv, o) {
    var f = o.face, out = [];
    [(f + 3) % 4, f, (f + 1) % 4, (f + 2) % 4].forEach(function (d) { if (isOpen(lv, o.cx, o.cy, d)) out.push(d); });
    return out;
  }
  // Globules follow the left-hand wall; when the ship is 2 cells away or less in the
  // same row or column they run away from it (opposite side first, never towards it).
  function chooseGlob(lv, o) {
    var s = lv.ship, dx = s.cx - o.cx, dy = s.cy - o.cy, list;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && (dx === 0 || dy === 0)) {
      list = dy < 0 ? [D, L, R] : dx > 0 ? [L, U, D] : dy > 0 ? [U, R, L] : [R, D, U];
    } else list = leftHand(lv, o);
    var d = firstFree(lv, o, list);
    if (d >= 0) setFace(lv, o, d);
    return d;
  }
  // Snakes go on along corridors (U-turn only in a dead end); at every crossing they
  // take the direction that brings them closer to the ship as the crow flies, the
  // longer axis first, without regard to the walls further on.
  function chooseSnake(lv, o) {
    var list;
    if (openCount(lv, o) >= 3) {
      var s = lv.ship, dx = o.cx - s.cx, dy = o.cy - s.cy, h = Math.abs(dy) < Math.abs(dx);
      if (dx > 0 && dy > 0) list = h ? [L, U, R, D] : [U, L, R, D];
      else if (dx > 0) list = h ? [L, D, U, R] : [D, L, U, R];
      else if (dy < 0) list = h ? [R, D, U, L] : [D, R, U, L];
      else list = h ? [R, U, D, L] : [U, R, D, L];
    } else {
      list = leftHand(lv, o);
      var back = (o.face + 2) % 4;
      list.sort(function (a, b) { return (a === back) - (b === back); });
    }
    var d = firstFree(lv, o, list);
    if (d >= 0) setFace(lv, o, d);
    return d;
  }

  // Same pixel row (or column) and overlapping sprites, as in the original.
  function touch(lv, a, b) {
    var s = lv.s;
    return (a.x === b.x && Math.abs(a.y - b.y) < s) || (a.y === b.y && Math.abs(a.x - b.x) < s);
  }
  function globsLeft(lv) {
    var n = 0;
    for (var i = 0; i < lv.creatures.length; i++) if (lv.creatures[i].kind === 'glob' && lv.creatures[i].state < 5) n++;
    return n;
  }
  function killCreature(lv, c) {
    c.state = 5; c.t = 0;
    if (lv.occ[occKey(c.cx, c.cy)] === c) delete lv.occ[occKey(c.cx, c.cy)];
  }
  function globKilled(lv, c, points) {
    var p = pos(lv, c);
    killCreature(lv, c);
    lv.game.score += points;
    emit(lv, 'sound', { name: 'glob' });
    emit(lv, 'points', { x: p.x, y: p.y, points: points });
  }

  // ---------- Actions ----------

  // Space only raises a request; the bullet leaves on the next tick if one is left.
  function fire(lv) {
    if (lv.state !== 'play') return false;
    if (lv.fired >= lv.avail) return false;
    lv.fireReq = true;
    return true;
  }
  // Enter, once per level, if no globule is in the exit: the exit is closed to the
  // creatures for 3 s. Returns true, or the reason why not ('used', 'glob', 'state').
  function putBarrier(lv) {
    if (lv.state !== 'play') return 'state';
    if (lv.barrier.state !== 0) return 'used';
    if (lv.occ[occKey(lv.maze.exit.x, lv.maze.exit.y)]) return 'glob';
    lv.barrier.state = 1; lv.barrier.k = 0;
    emit(lv, 'sound', { name: 'barrier' });
    return true;
  }

  // The bullet appears in the next cell in front of the ship (or explodes at once on a wall).
  function shoot(lv) {
    var s = lv.ship, d = s.face;
    emit(lv, 'sound', { name: 'shot' });
    if (!isOpen(lv, s.cx, s.cy, d)) { wallHit(lv, s.cx, s.cy, d); return; }
    lv.bullets.push({ cx: s.cx + DX[d], cy: s.cy + DY[d], dir: d, k: 0 });
  }
  function bulletPos(lv, b) {
    return { x: centre(lv, b.cx) + (b.k ? DX[b.dir] * lv.T / 2 : 0), y: centre(lv, b.cy) + (b.k ? DY[b.dir] * lv.T / 2 : 0) };
  }
  function wallHit(lv, cx, cy, d) {
    lv.fx.push({ kind: 'wall', x: cx, y: cy, dir: d, k: 0 });
    emit(lv, 'sound', { name: lv.rng.int(2) ? 'ricochet1' : 'ricochet2' });
  }
  // Half a cell per tick; through globules and eggs (one per tick), stops on a snake.
  function updateBullets(lv) {
    for (var i = lv.bullets.length - 1; i >= 0; i--) {
      var b = lv.bullets[i], bp = bulletPos(lv, b), gone = false, hitGlob = false;
      for (var j = 0; j < lv.creatures.length && !gone; j++) {
        var c = lv.creatures[j];
        if (c.state >= 5 || (c.kind === 'glob' && hitGlob) || !touch(lv, pos(lv, c), bp)) continue;
        if (c.kind === 'glob') { hitGlob = true; globKilled(lv, c, 1); }
        else {
          var sp = pos(lv, c);
          killCreature(lv, c); gone = true;
          emit(lv, 'sound', { name: 'snakeShot' });
          emit(lv, 'snakeKilled', { x: sp.x, y: sp.y });
        }
      }
      if (!gone && b.k === 0 && !isOpen(lv, b.cx, b.cy, b.dir)) { wallHit(lv, b.cx, b.cy, b.dir); gone = true; }
      if (gone) { lv.bullets.splice(i, 1); continue; }
      if (b.k === 0) b.k = 1;
      else { b.k = 0; b.cx += DX[b.dir]; b.cy += DY[b.dir]; }
    }
  }

  // Eggs open, explosions and faces play their frames.
  function animateCreatures(lv) {
    lv.creatures.forEach(function (c) {
      if (c.state === 2) { if (++c.t >= lv.n - 1) { c.state = 3; c.t = 0; } }
      else if (c.state === 3) { if (c.k === 0) c.anim++; }
      else if (c.state === 4) { if (c.t < lv.n - 1) c.t++; }
      else if (c.state === 5) { if (++c.t >= lv.n - 1) c.state = 6; }
    });
  }

  // Last 20 seconds: every 6 ticks a random spot of the maze (4 cells around a corner)
  // is covered by the growing-floor animation. Drawing only: the walls still block.
  function eraseWalls(lv) {
    var e = lv.erase;
    if (e.k === 0) { e.x = lv.rng.int(lv.maze.cols - 2); e.y = lv.rng.int(lv.maze.rows - 2); }
    lv.eraseLog.push([e.x, e.y, e.k]);
    if (++e.k === ERASE_FRAMES) e.k = 0;
  }

  // why: win | time | escape | snake
  function endLevel(lv, why) {
    lv.end = why; lv.endK = 0; setState(lv, 'ending');
    lv.bullets = [];
    lv.creatures.forEach(function (c) { if (c.state < 4) killCreature(lv, c); });
    if (why !== 'win') { lv.ship.state = 4; lv.game.lives--; } else lv.ship.state = 5;
    lv.ship.anim = 0;
    lv.game.bullets = lv.avail - lv.fired;
    emit(lv, 'ending', { why: why });
  }

  // ---------- One logic step (50 ms). Final states: 'won' and 'lost'. ----------

  function step(lv, input) {
    lv.tick++; lv.stateTick++;
    lv.input = input || lv.input || newInput();
    var i;
    for (i = lv.fx.length - 1; i >= 0; i--) if (++lv.fx[i].k >= lv.n) lv.fx.splice(i, 1);
    animateCreatures(lv);
    switch (lv.state) {
      case 'countdown':
        if (lv.stateTick % 12 === 1) emit(lv, 'count', { n: 3 - Math.floor(lv.stateTick / 12) });
        if (lv.stateTick >= COUNTDOWN_TICKS) { setState(lv, 'play'); emit(lv, 'go'); }
        return;
      case 'ending':
        lv.ship.anim++;
        if (++lv.endK >= lv.n + HOLD_TICKS) {
          setState(lv, lv.end === 'win' ? 'won' : 'lost');
          emit(lv, lv.state, { why: lv.end });
        }
        return;
      case 'play': break;
      default: return;
    }

    // Clock: 20 ticks per second.
    if (++lv.sub === 20) { lv.sub = 0; lv.elapsed++; }
    if (lv.elapsed >= lv.limit) { endLevel(lv, 'time'); return; }
    if (!lv.dark && lv.limit - lv.elapsed <= DARK_TIME) { lv.dark = true; emit(lv, 'sound', { name: 'dark' }); emit(lv, 'dark'); }
    if (lv.dark) eraseWalls(lv);

    // Barrier: closes in 6 ticks, stays, opens in the last 6 of its 60 ticks.
    var b = lv.barrier;
    if (b.state === 1) {
      b.k++;
      if (b.k <= 6) b.slide--;
      if (b.k > BARRIER_TICKS - 6) b.slide++;
      if (b.k === BARRIER_TICKS) b.state = 2;
    }

    updateBullets(lv);
    var s = lv.ship;
    advance(lv, s, chooseShip, false);
    var m = lv.maze;
    if (s.k === 0 && s.cx === m.exit.x && s.cy === m.exit.y && globsLeft(lv) === 0) {
      emit(lv, 'sound', { name: 'exit' }); endLevel(lv, 'win'); return;
    }
    var sp = pos(lv, s), escaped = null;
    lv.creatures.forEach(function (c) {
      if (c.kind !== 'glob' || c.state >= 6 || escaped) return;
      if (c.state === 1 && Math.max(Math.abs(c.cx - s.cx), Math.abs(c.cy - s.cy)) < 3 && (c.cx === s.cx || c.cy === s.cy)) c.state = 2;
      if (c.state === 3) {
        advance(lv, c, chooseGlob, true);
        if (c.k === 0 && c.cx === m.exit.x && c.cy === m.exit.y) { escaped = c; return; }
      }
      if (c.state < 5 && touch(lv, pos(lv, c), sp)) globKilled(lv, c, 2);
    });
    if (escaped) {
      escaped.state = 4; escaped.t = 0;
      emit(lv, 'sound', { name: 'death' });
      endLevel(lv, 'escape'); return;
    }
    var killer = null;
    lv.creatures.forEach(function (c) {
      if (c.kind !== 'snake' || c.state >= 6 || killer) return;
      if (c.state === 1 && Math.abs(c.cx - s.cx) < 4 && Math.abs(c.cy - s.cy) < 4) c.state = 2;
      if (c.state === 3) advance(lv, c, chooseSnake, true);
      if (c.state < 5 && !lv.cfg.god && touch(lv, pos(lv, c), sp)) killer = c;
    });
    if (killer) {
      killer.state = 4; killer.t = 0;
      emit(lv, 'sound', { name: 'death' });
      endLevel(lv, 'snake'); return;
    }
    if (lv.fireReq) { lv.fireReq = false; if (lv.fired < lv.avail) { lv.fired++; shoot(lv); } }

    var left = globsLeft(lv);
    if (left === 0 && !lv.allGlobs) { lv.allGlobs = true; emit(lv, 'allGlobs'); }
    // Warning (new): a globule comes within 3 moves of the exit while the barrier is unused.
    var near = false;
    if (b.state === 0) for (i = 0; i < lv.creatures.length && !near; i++) {
      var c = lv.creatures[i];
      if (c.kind === 'glob' && c.state === 3) { var dd = lv.dist[c.cy * lv.distW + c.cx]; near = dd >= 0 && dd <= 3; }
    }
    if (near && !lv.nearExit) emit(lv, 'nearExit');
    lv.nearExit = near;
  }

  // ---------- Autopilot (title screen demo) ----------

  // Direction to take at the next cell centre: shortest path to the nearest globule
  // (or globule egg), then to the exit.
  function autopilotDir(lv) {
    var m = lv.maze, s = lv.ship, w = m.cols + 1;
    var mark = new Uint8Array(w * m.rows), any = false;
    lv.creatures.forEach(function (c) { if (c.kind === 'glob' && c.state < 5) { mark[c.cy * w + c.cx] = 1; any = true; } });
    if (!any) mark[m.exit.y * w + m.exit.x] = 1;
    var sc = s.cy * w + s.cx;
    if (mark[sc]) return -1;
    var first = new Int8Array(w * m.rows).fill(-1), q = [sc];
    first[sc] = 4;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], x = c % w, y = (c / w) | 0;
      for (var d = 0; d < 4; d++) {
        if (!isOpenM(m, x, y, d)) continue;
        var nn = (y + DY[d]) * w + x + DX[d];
        if (first[nn] >= 0) continue;
        first[nn] = c === sc ? d : first[c];
        if (mark[nn]) return first[nn];
        q.push(nn);
      }
    }
    return -1;
  }

  function bulletsLeft(lv) { return lv.avail - lv.fired; }
  function timeLeft(lv) { return Math.max(0, lv.limit - lv.elapsed); }
  function shipPos(lv) { return pos(lv, lv.ship); }

  var api = {
    TICK: TICK, U: U, R: R, D: D, L: L, DX: DX, DY: DY, STEP: STEP, MAZE_W: MAZE_W, MAZE_H: MAZE_H,
    DARK_TIME: DARK_TIME, MAX_BULLETS: MAX_BULLETS, BARRIER_TICKS: BARRIER_TICKS, ERASE_FRAMES: ERASE_FRAMES,
    PRESETS: PRESETS, ZOOMS: ZOOMS, LEVEL_T: LEVEL_T, COUNTDOWN_TICKS: COUNTDOWN_TICKS, ROUTE_SHARE: ROUTE_SHARE,
    mulberry32: mulberry32, hashSeed: hashSeed, makeRng: makeRng, randomSeedCode: randomSeedCode, dailySeed: dailySeed,
    zoomOf: zoomOf, levelParams: levelParams, startBullets: startBullets, makeMaze: makeMaze, placeEggs: placeEggs,
    checkLevel: checkLevel, isOpen: isOpenM, bfs: bfs, planRoute: planRoute, autopilotDir: autopilotDir,
    createLevel: createLevel, step: step, fire: fire, putBarrier: putBarrier,
    newInput: newInput, inputPress: inputPress, inputRelease: inputRelease,
    pos: pos, bulletPos: bulletPos, shipPos: shipPos, globsLeft: globsLeft, bulletsLeft: bulletsLeft, timeLeft: timeLeft
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabEngine = api;
})(this);
