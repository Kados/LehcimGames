/*
 * LabRaph (nouvelle version) - game logic, without any drawing or DOM access.
 * Runs in the browser (global LabEngine) and in node (require) for tests and benchmarks.
 *
 * Changes compared with the original port (../game.js):
 *  - seeded random generator (mulberry32): every level can be replayed from its seed,
 *    and the "défi du jour" uses the date as seed;
 *  - extra loop walls are drawn among the internal walls that are still closed;
 *  - level time computed from the real route (ship -> every globule and egg -> exit);
 *  - snakes steer: separation between snakes, flanking far from the ship, limited turn rate;
 *  - the difficulty keeps rising after level 15 (globules flee the ship, more and faster snakes);
 *  - input buffering: a turn asked a little too early is taken at the next crossing.
 * The original behaviours are kept behind cfg.legacy flags so that benchmarks can compare.
 */
(function (root) {
  'use strict';

  var TICK = 50;                       // ms per logic step (original TTimer interval)
  var U = 0, R = 1, D = 2, L = 3;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var SHIP_SPEED = 0.25, BULLET_SPEED = 0.5, TURN_TICKS = 2;
  var EGG_RANGE_GLOB = 1.6, EGG_RANGE_SNAKE = 3.2;
  var BARRIER_TICKS = 60, DARK_TIME = 20, MAX_BULLETS = 5;
  var INTRO_TICKS = 14, COUNTDOWN_TICKS = 36, BUFFER_TICKS = 6;
  var MAZE_W = 560, MAZE_H = 400;      // landscape play area (the original panel takes 60 px on the right)

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

  // ---------- Difficulty ----------

  var PRESETS = {
    facile: { label: 'Facile', lives: 4, time: 1.3, snake: 0.85 },
    normal: { label: 'Normal', lives: 3, time: 1, snake: 1 },
    difficile: { label: 'Difficile', lives: 3, time: 0.85, snake: 1.12 }
  };

  // Tile size changes at levels 3, 5 and 8 (40, 32, 20 then 16 pixels), as the help says.
  function tileSize(n) { return n <= 2 ? 40 : n <= 4 ? 32 : n <= 7 ? 20 : 16; }

  function levelParams(n, cfg) {
    cfg = cfg || {};
    var pre = PRESETS[cfg.preset] || PRESETS.normal;
    var T = tileSize(n);
    var mw = cfg.portrait ? MAZE_H : MAZE_W, mh = cfg.portrait ? MAZE_W : MAZE_H;
    var cols = Math.floor(mw / T), rows = Math.floor(mh / T), cells = cols * rows;
    var over = Math.max(0, n - 15);            // levels beyond the original curve
    var legacyCurve = cfg.legacy && cfg.legacy.curve;
    if (legacyCurve) over = 0;
    return {
      n: n, T: T, cols: cols, rows: rows, cells: cells,
      globs: Math.min(3 + n, 14) + Math.min(Math.floor(over / 3), 4),
      snakes: Math.min(1 + Math.floor((n - 1) * 2 / 3), 10) + Math.min(Math.floor(over / 3), 4),
      legacyTime: Math.round(40 + cells * 0.12),
      globSpeed: Math.min(0.1 + 0.005 * n, 0.15) + Math.min(over * 0.002, 0.03),
      snakeSpeed: (Math.min(0.08 + 0.008 * n, 0.17) + Math.min(over * 0.0025, 0.035)) * pre.snake,
      bias: Math.min(0.02 * n, 0.15),          // chance a globule heads for the exit at a crossing
      flee: Math.min(0.06 * over, 0.6),        // chance a globule runs away from the ship (level 16+)
      // Time = 10 s + autopilot time * margin; the margin shrinks with the level.
      margin: over ? Math.max(1.45, 1.6 - 0.02 * over) : Math.max(1.6, 3 - 0.12 * (n - 1)),
      timeFactor: pre.time
    };
  }

  // ---------- Maze ----------

  // Random perfect maze (depth-first backtracker), then extra openings so that there are loops.
  function makeMaze(cols, rows, rng, legacyLoops) {
    var walls = [], i, n = cols * rows;
    for (i = 0; i < n; i++) walls.push(15);
    var seen = new Uint8Array(n), stack = [rng.int(n)];
    seen[stack[0]] = 1;
    while (stack.length) {
      var c = stack[stack.length - 1], x = c % cols, y = (c / cols) | 0, opts = [];
      for (var d = 0; d < 4; d++) {
        var nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      var dd = opts[rng.int(opts.length)], nn = (y + DY[dd]) * cols + x + DX[dd];
      walls[c] &= ~(1 << dd); walls[nn] &= ~(1 << ((dd + 2) % 4));
      seen[nn] = 1; stack.push(nn);
    }
    var extra = Math.round(n * 0.08), opened = 0;
    if (legacyLoops) {
      // Original code: random walls, possibly already open, never on the last row/column.
      for (i = 0; i < extra; i++) {
        var cx = rng.int(cols - 1), cy = rng.int(rows - 1), dir = rng.int(2) ? R : D;
        var cc = cy * cols + cx, n2 = cc + (dir === R ? 1 : cols);
        if (walls[cc] & (1 << dir)) opened++;
        walls[cc] &= ~(1 << dir); walls[n2] &= ~(1 << ((dir + 2) % 4));
      }
    } else {
      // Draw among the internal walls that are still closed (all rows and columns).
      var closed = [];
      for (i = 0; i < n; i++) {
        var xx = i % cols, yy = (i / cols) | 0;
        if (xx < cols - 1 && (walls[i] & 2)) closed.push(i * 2);
        if (yy < rows - 1 && (walls[i] & 4)) closed.push(i * 2 + 1);
      }
      for (i = 0; i < extra && closed.length; i++) {
        var k = rng.int(closed.length), w = closed[k];
        closed[k] = closed[closed.length - 1]; closed.pop();
        var cell = w >> 1, down = w & 1, other = cell + (down ? cols : 1);
        walls[cell] &= ~(down ? 4 : 2); walls[other] &= ~(down ? 1 : 8);
        opened++;
      }
    }
    // Exit: an opening in the outer wall (top, bottom or left; the right side touches the panel).
    var side = [U, D, L][rng.int(3)], ex, ey;
    if (side === L) { ex = 0; ey = 1 + rng.int(rows - 2); }
    else { ex = 1 + rng.int(cols - 2); ey = side === U ? 0 : rows - 1; }
    walls[ey * cols + ex] &= ~(1 << side);
    return { cols: cols, rows: rows, walls: walls, exit: { x: ex, y: ey, dir: side }, loopsOpened: opened, loopsWanted: extra };
  }

  // Breadth-first distances (in moves) from cell `from` to every cell.
  function bfs(m, from) {
    var dist = new Int32Array(m.cols * m.rows).fill(-1), q = [from];
    dist[from] = 0;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], x = c % m.cols, y = (c / m.cols) | 0;
      for (var d = 0; d < 4; d++) {
        if (m.walls[c] & (1 << d)) continue;
        var nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
        var n = ny * m.cols + nx;
        if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
      }
    }
    return dist;
  }

  // Length (in moves) of a short tour: start -> every target (any order) -> exit, then one
  // step out. Nearest neighbour then 2-opt on the BFS distance matrix (targets <= 18).
  function planRoute(m, start, targets, exitDist) {
    var pts = [start].concat(targets), k = pts.length, maps = pts.map(function (c) { return bfs(m, c); });
    function dd(a, b) { return maps[a][pts[b]]; }
    var order = [], used = new Uint8Array(k), cur = 0;
    used[0] = 1;
    for (var s = 1; s < k; s++) {
      var best = -1, bd = 1e9;
      for (var j = 1; j < k; j++) if (!used[j] && dd(cur, j) < bd) { bd = dd(cur, j); best = j; }
      used[best] = 1; order.push(best); cur = best;
    }
    function len(o) {
      var t = 0, p = 0;
      for (var i = 0; i < o.length; i++) { t += dd(p, o[i]); p = o[i]; }
      return t + exitDist[pts[p]] + 1;
    }
    var bestLen = len(order), improved = true;
    while (improved) {
      improved = false;
      for (var a = 0; a < order.length - 1; a++) {
        for (var b = a + 1; b < order.length; b++) {
          var o2 = order.slice(0, a).concat(order.slice(a, b + 1).reverse(), order.slice(b + 1));
          var l2 = len(o2);
          if (l2 < bestLen) { order = o2; bestLen = l2; improved = true; }
        }
      }
    }
    return { length: bestLen, order: order.map(function (i) { return pts[i]; }) };
  }

  // ---------- Autopilot (used to estimate the level time, and for the title screen demo) ----------

  // Direction to take at the next cell centre: shortest path to the nearest globule or
  // globule egg (BFS with early exit), then to the exit.
  function autopilotDir(lv) {
    var m = lv.maze, s0 = lv.ship;
    var cx = s0.dir >= 0 ? s0.cx + DX[s0.dir] : s0.cx, cy = s0.dir >= 0 ? s0.cy + DY[s0.dir] : s0.cy;
    if (cx < 0 || cy < 0 || cx >= m.cols || cy >= m.rows) return s0.dir;
    var n = m.cols * m.rows, sc = cy * m.cols + cx, i, d;
    var mark = new Uint8Array(n), any = false;
    for (i = 0; i < lv.globs.length; i++) {
      var g = lv.globs[i];
      if (g.cx >= 0 && g.cy >= 0 && g.cx < m.cols && g.cy < m.rows) { mark[g.cy * m.cols + g.cx] = 1; any = true; }
    }
    for (i = 0; i < lv.eggs.length; i++) if (lv.eggs[i].kind === 'glob') { mark[lv.eggs[i].y * m.cols + lv.eggs[i].x] = 1; any = true; }
    if (!any) {
      if (lv.dist[sc] === 0) return m.exit.dir;
      for (d = 0; d < 4; d++) {
        if (m.walls[sc] & (1 << d)) continue;
        var ex = cx + DX[d], ey = cy + DY[d];
        if (ex >= 0 && ey >= 0 && ex < m.cols && ey < m.rows && lv.dist[ey * m.cols + ex] === lv.dist[sc] - 1) return d;
      }
      return -1;
    }
    if (mark[sc]) return -1;                       // wait here (egg hatching / globule arriving)
    var first = new Int8Array(n).fill(-1), q = [sc];
    first[sc] = 4;
    for (var h = 0; h < q.length; h++) {
      var c = q[h], x = c % m.cols, y = (c / m.cols) | 0;
      for (d = 0; d < 4; d++) {
        if (m.walls[c] & (1 << d)) continue;
        var nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
        var nn = ny * m.cols + nx;
        if (first[nn] >= 0) continue;
        first[nn] = c === sc ? d : first[c];
        if (mark[nn]) return first[nn];
        q.push(nn);
      }
    }
    return -1;
  }

  // Plays the level `runs` times with the autopilot (no snakes, globules cannot escape)
  // and returns the mean time in seconds from the start to the exit.
  function simulateLevel(game, cfg, runs) {
    var total = 0;
    for (var k = 0; k < runs; k++) {
      var g = { level: game.level, lives: 1, score: 0, bullets: 0, seed: game.seed, attempt: game.attempt };
      var lv = createLevel(g, { preset: cfg.preset, portrait: cfg.portrait, legacy: cfg.legacy, noSnakes: true, countdown: false, sim: true });
      lv.rng = makeRng(hashSeed(game.seed + '/sim/' + k));
      lv.state = 'play';
      var input = newInput(), t = 0;
      while (lv.state === 'play' && t < 12000) {
        var s = lv.ship;
        if (!s.turn && (s.dir < 0 || s.t + SHIP_SPEED >= 1)) { var d = autopilotDir(lv); input.held = d >= 0 ? [d] : []; }
        step(lv, input); t++;
      }
      total += t;
    }
    return total / runs * TICK / 1000;
  }

  function routeSeconds(route) { return route * TICK / SHIP_SPEED / 1000; }

  function levelTime(p, simSeconds) {
    return Math.max(DARK_TIME + 25, Math.round((10 + simSeconds * p.margin) * p.timeFactor));
  }

  // ---------- Level ----------

  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  // game: {level, lives, score, bullets, seed, attempt}. cfg: {preset, portrait, legacy:{...}}
  function createLevel(game, cfg) {
    cfg = cfg || {};
    var legacy = cfg.legacy || {};
    var p = levelParams(game.level, cfg);
    var seed = game.seed != null ? hashSeed(game.seed + '/' + game.level + '/' + (game.attempt || 0)) : null;
    var rng = seed != null ? makeRng(seed) : mathRng();
    var m = makeMaze(p.cols, p.rows, rng, legacy.loops);
    var exitCell = m.exit.y * m.cols + m.exit.x;
    var lv = {
      p: p, cfg: cfg, game: game, maze: m, T: p.T, seed: seed,
      rng: seed != null ? makeRng(seed ^ 0x9e3779b9) : mathRng(),   // in-game randomness
      dist: bfs(m, exitCell),
      barrierUsed: false, barrier: 0, nearExit: false,
      globs: [], snakes: [], eggs: [], bullets: [], fx: [], events: [],
      state: 'intro', tick: 0, stateTick: 0, endText: '', reason: '',
      shipDead: false, snakeCount: 0, shipDist: null, shipDistCell: -1
    };
    // Ship: far from the exit.
    var maxD = 0, i;
    for (i = 0; i < lv.dist.length; i++) maxD = Math.max(maxD, lv.dist[i]);
    var far = [];
    for (i = 0; i < lv.dist.length; i++) if (lv.dist[i] >= maxD * 0.6) far.push(i);
    var sc = far[rng.int(far.length)];
    lv.ship = { cx: sc % p.cols, cy: (sc / p.cols) | 0, dir: -1, t: 0, face: U, turn: null, anim: 0, momentum: -1 };
    // Creatures on free cells away from the ship.
    var used = {}; used[sc] = 1;
    var shipPos0 = { x: lv.ship.cx, y: lv.ship.cy };
    function freeCell(minDist) {
      for (var tries = 0; tries < 500; tries++) {
        var c = rng.int(p.cols * p.rows), pos = { x: c % p.cols, y: (c / p.cols) | 0 };
        if (used[c] || dist2(pos, shipPos0) < minDist * minDist || lv.dist[c] < 4) continue;
        used[c] = 1; return pos;
      }
      return { x: rng.int(p.cols), y: rng.int(p.rows) };
    }
    var free = Math.ceil(p.globs / 2), targets = [];
    for (i = 0; i < p.globs; i++) {
      var gp = freeCell(3);
      targets.push(gp.y * p.cols + gp.x);
      if (i < free) lv.globs.push(newGlob(lv, gp.x, gp.y));
      else lv.eggs.push({ x: gp.x, y: gp.y, kind: 'glob', open: -1 });
    }
    if (!cfg.noSnakes) {
      for (i = 0; i < p.snakes; i++) {
        var spos = freeCell(EGG_RANGE_SNAKE + 1.5);
        lv.eggs.push({ x: spos.x, y: spos.y, kind: 'snake', open: -1 });
      }
    }
    // Time: from the real route (autopilot runs on this very level), or the original formula.
    lv.route = planRoute(m, sc, targets, lv.dist);
    if (legacy.time) lv.time = p.legacyTime;
    else if (cfg.sim) lv.time = 1e6;
    else {
      lv.simSeconds = game.seed != null ? simulateLevel(game, cfg, cfg.simRuns || 3) : routeSeconds(lv.route.length) * 1.6;
      lv.time = levelTime(p, Math.max(lv.simSeconds, routeSeconds(lv.route.length)));
    }
    lv.timeLeft = lv.time * 1000 / TICK;
    lv.timeTotal = lv.timeLeft;
    // At least one more bullet per level (sometimes two), 5 at most.
    game.bullets = Math.min(MAX_BULLETS, game.bullets + 1 + (rng.next() < 0.3 ? 1 : 0));
    return lv;
  }

  function newGlob(lv, x, y) {
    return { cx: x, cy: y, dir: -1, t: 0, last: lv.rng.int(4), anim: lv.rng.int(10), x: x, y: y };
  }

  function isOpen(lv, cx, cy, d) { return !(lv.maze.walls[cy * lv.maze.cols + cx] & (1 << d)); }
  function isExitMove(lv, cx, cy, d) { var e = lv.maze.exit; return cx === e.x && cy === e.y && d === e.dir; }
  function shipPos(lv) {
    var s = lv.ship;
    return s.dir >= 0 ? { x: s.cx + DX[s.dir] * s.t, y: s.cy + DY[s.dir] * s.t } : { x: s.cx, y: s.cy };
  }
  function globsLeft(lv) {
    var n = lv.globs.length;
    for (var i = 0; i < lv.eggs.length; i++) if (lv.eggs[i].kind === 'glob') n++;
    return n;
  }
  function exitOpenFor(lv, who) {
    if (lv.barrier > 0 || (lv.cfg.sim && who === 'glob')) return false;
    return who === 'glob' || globsLeft(lv) === 0;
  }
  function emit(lv, type, data) { var e = data || {}; e.type = type; lv.events.push(e); }
  function addFx(lv, kind, x, y, dir, hold) { lv.fx.push({ kind: kind, x: x, y: y, dir: dir, k: 0, hold: !!hold }); }

  // ---------- Input ----------
  // input: {held: [dirs, newest last], pivot: bool, buffer: dir, bufferTick: tick of the press}

  function newInput() { return { held: [], pivot: false, buffer: -1, bufferTick: -99 }; }
  function inputPress(lv, input, d) {
    var i = input.held.indexOf(d); if (i >= 0) input.held.splice(i, 1);
    input.held.push(d);
    input.buffer = d; input.bufferTick = lv ? lv.tick : 0;
  }
  function inputRelease(input, d) { var i = input.held.indexOf(d); if (i >= 0) input.held.splice(i, 1); }

  function canGo(lv, s, d) {
    if (!isOpen(lv, s.cx, s.cy, d)) return false;
    return !(isExitMove(lv, s.cx, s.cy, d) && !exitOpenFor(lv, 'ship'));
  }

  function startTurn(s, want) {
    var diff = (want - s.face + 4) % 4, steps = diff === 2 ? [(s.face + 1) % 4, want] : [want];
    s.turn = { to: steps.shift(), steps: steps, k: 0, from: s.face };
  }

  function updateShip(lv, input) {
    var s = lv.ship;
    s.anim++;
    if (s.turn) {
      s.turn.k++;
      if (s.turn.k >= TURN_TICKS) {
        s.face = s.turn.to;
        s.turn = s.turn.steps.length ? { to: s.turn.steps.shift(), steps: s.turn.steps, k: 0, from: s.face } : null;
      }
      return;
    }
    if (s.dir >= 0) {
      s.t += SHIP_SPEED;
      if (s.t < 1) return;
      s.cx += DX[s.dir]; s.cy += DY[s.dir]; s.t = 0; s.momentum = s.dir; s.dir = -1;
      if (s.cx < 0 || s.cy < 0 || s.cx >= lv.maze.cols || s.cy >= lv.maze.rows) { leaveMaze(lv); return; }
    }
    var legacyInput = lv.cfg.legacy && lv.cfg.legacy.input;
    var held = input.held, want = held.length ? held[held.length - 1] : -1;
    var momentum = s.momentum; s.momentum = -1;
    if (legacyInput) {
      if (want < 0) return;
      if (want !== s.face) { startTurn(s, want); return; }
      if (input.pivot) return;
      if (canGo(lv, s, want)) { s.dir = want; s.t = SHIP_SPEED; }
      return;
    }
    if (input.pivot) {                   // "immobilisation": turn on the spot only
      if (want >= 0 && want !== s.face) startTurn(s, want);
      return;
    }
    // Candidates: the most recent key press (even if already released, within BUFFER_TICKS),
    // then the keys still held, newest first.
    var cand = [], i;
    if (input.buffer >= 0 && lv.tick - input.bufferTick <= BUFFER_TICKS) cand.push(input.buffer);
    for (i = held.length - 1; i >= 0; i--) if (cand.indexOf(held[i]) < 0) cand.push(held[i]);
    for (i = 0; i < cand.length; i++) {
      if (!canGo(lv, s, cand[i])) continue;
      if (cand[i] !== s.face) {
        startTurn(s, cand[i]);
        if (cand[i] === input.buffer) input.bufferTick = lv.tick + 2 * TURN_TICKS;  // still fresh after the turn
        return;
      }
      if (cand[i] === input.buffer) input.buffer = -1;   // consumed
      s.dir = cand[i]; s.t = SHIP_SPEED; return;
    }
    if (want < 0) return;
    // Turn asked too early (wall on that side): keep going straight until it opens.
    if (momentum >= 0 && momentum === s.face && canGo(lv, s, momentum)) { s.dir = momentum; s.t = SHIP_SPEED; return; }
    if (want !== s.face) startTurn(s, want);   // stopped: face the key (to aim), as in the original
  }

  function leaveMaze(lv) {
    setState(lv, 'exiting');
    emit(lv, 'sound', { name: 'exit' });
  }

  // ---------- Globules ----------

  function updateGlobs(lv) {
    var p = lv.p;
    for (var i = lv.globs.length - 1; i >= 0; i--) {
      var o = lv.globs[i];
      o.anim++;
      if (o.dir >= 0) {
        o.t += p.globSpeed;
        if (o.t >= 1) {
          o.cx += DX[o.dir]; o.cy += DY[o.dir]; o.t = 0; o.last = o.dir; o.dir = -1;
          if (o.cx < 0 || o.cy < 0 || o.cx >= lv.maze.cols || o.cy >= lv.maze.rows) {
            lv.globs.splice(i, 1); globEscaped(lv, o); return;
          }
        }
      }
      if (o.dir < 0) chooseGlobDir(lv, o);
      o.x = o.dir >= 0 ? o.cx + DX[o.dir] * o.t : o.cx;
      o.y = o.dir >= 0 ? o.cy + DY[o.dir] * o.t : o.cy;
    }
  }

  function shipDistances(lv) {
    var s = lv.ship, c = s.cy * lv.maze.cols + s.cx;
    if (c !== lv.shipDistCell) { lv.shipDist = bfs(lv.maze, c); lv.shipDistCell = c; }
    return lv.shipDist;
  }

  // Globules wander (no U-turn unless in a dead end); sometimes they head for the exit;
  // from level 16 they may also run away from the ship.
  function chooseGlobDir(lv, o) {
    var opts = [], back = (o.last + 2) % 4, d, m = lv.maze;
    for (d = 0; d < 4; d++) {
      if (!isOpen(lv, o.cx, o.cy, d)) continue;
      if (isExitMove(lv, o.cx, o.cy, d) && !exitOpenFor(lv, 'glob')) continue;
      opts.push(d);
    }
    if (!opts.length) return;
    if (opts.length > 1) opts = opts.filter(function (x) { return x !== back; });
    var c = o.cy * m.cols + o.cx;
    if (lv.rng.next() < lv.p.bias) {
      if (lv.dist[c] === 0 && opts.indexOf(m.exit.dir) >= 0 && isExitMove(lv, o.cx, o.cy, m.exit.dir)) { o.dir = m.exit.dir; return; }
      for (var k = 0; k < opts.length; k++) {
        d = opts[k];
        var nx = o.cx + DX[d], ny = o.cy + DY[d];
        if (nx >= 0 && ny >= 0 && nx < m.cols && ny < m.rows && lv.dist[ny * m.cols + nx] < lv.dist[c]) { o.dir = d; return; }
      }
    }
    if (lv.p.flee > 0 && opts.length > 1 && lv.rng.next() < lv.p.flee) {
      var sd = shipDistances(lv), best = -1, bv = -1;
      for (k = 0; k < opts.length; k++) {
        d = opts[k];
        var ax = o.cx + DX[d], ay = o.cy + DY[d];
        if (ax < 0 || ay < 0 || ax >= m.cols || ay >= m.rows) continue;
        var v = sd[ay * m.cols + ax];
        if (v > bv) { bv = v; best = d; }
      }
      if (best >= 0 && sd[c] < 8) { o.dir = best; return; }
    }
    o.dir = opts[lv.rng.int(opts.length)];
  }

  // ---------- Snakes ----------

  var SEP_RADIUS = 1.6, SEP_WEIGHT = 1.4, MAX_TURN = 0.3, FLANK = 0.7;

  function updateSnakes(lv) {
    var sp = shipPos(lv), v = lv.p.snakeSpeed, sn = lv.snakes;
    var legacySnakes = lv.cfg.legacy && lv.cfg.legacy.snakes;
    for (var i = 0; i < sn.length; i++) {
      var s = sn[i];
      s.anim++;
      var dx = sp.x - s.x, dy = sp.y - s.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) continue;
      if (legacySnakes || d <= v) {
        var k = Math.min(v, d) / d;
        s.x += dx * k; s.y += dy * k;
        s.hx = dx / d; s.hy = dy / d;
      } else {
        var ux = dx / d, uy = dy / d;
        // Flanking: far from the ship, each snake aims a little to its own side.
        var fl = s.flank * FLANK * Math.min(1, Math.max(0, (d - 2.5) / 4));
        var wx = ux - uy * fl, wy = uy + ux * fl;
        // Separation from the other snakes (weaker very close to the ship, so they still bite).
        var near = Math.min(1, d / 2);
        for (var j = 0; j < sn.length; j++) {
          if (j === i) continue;
          var ox = s.x - sn[j].x, oy = s.y - sn[j].y, od = Math.sqrt(ox * ox + oy * oy);
          if (od >= SEP_RADIUS) continue;
          if (od < 1e-4) { ox = (i < j ? -uy : uy); oy = (i < j ? ux : -ux); od = 1; }
          var f = SEP_WEIGHT * near * (SEP_RADIUS - od) / SEP_RADIUS / od;
          wx += ox * f; wy += oy * f;
        }
        var wl = Math.sqrt(wx * wx + wy * wy) || 1; wx /= wl; wy /= wl;
        // Limited turn rate (none when close: a snake next to you does not circle around).
        if (s.hx == null) { s.hx = wx; s.hy = wy; }
        var maxTurn = d < 1.2 ? Math.PI : MAX_TURN;
        var a0 = Math.atan2(s.hy, s.hx), a1 = Math.atan2(wy, wx), da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (da > maxTurn) da = maxTurn; else if (da < -maxTurn) da = -maxTurn;
        var a = a0 + da;
        s.hx = Math.cos(a); s.hy = Math.sin(a);
        s.x += s.hx * v; s.y += s.hy * v;
      }
      // Keep the snakes over the maze.
      s.x = Math.max(-0.4, Math.min(lv.maze.cols - 0.6, s.x));
      s.y = Math.max(-0.4, Math.min(lv.maze.rows - 0.6, s.y));
      s.face = Math.abs(s.hx) > Math.abs(s.hy) ? (s.hx > 0 ? R : L) : (s.hy > 0 ? D : U);
    }
  }

  // ---------- Eggs, bullets, contacts ----------

  function updateEggs(lv) {
    var sp = shipPos(lv);
    for (var i = lv.eggs.length - 1; i >= 0; i--) {
      var e = lv.eggs[i];
      if (e.open < 0) {
        var r = e.kind === 'snake' ? EGG_RANGE_SNAKE : EGG_RANGE_GLOB;
        if (dist2(e, sp) <= r * r) { e.open = 0; emit(lv, 'sound', { name: 'egg' }); }
        continue;
      }
      e.open++;
      if (e.open >= hatchTicks(lv)) {
        lv.eggs.splice(i, 1);
        if (e.kind === 'glob') lv.globs.push(newGlob(lv, e.x, e.y));
        else {
          var k = lv.snakeCount++;
          // Flank side: -1, +1, -0.5, +0.5, 0, -1 ...
          var flank = [-1, 1, -0.5, 0.5, 0][k % 5];
          lv.snakes.push({ x: e.x, y: e.y, face: D, anim: 0, flank: flank, hx: null, hy: null });
          emit(lv, 'snake');
        }
      }
    }
  }
  function hatchTicks(lv) { return ({ 40: 10, 32: 8, 20: 5, 16: 4 }[lv.T] - 1) * 2; }

  function updateBullets(lv) {
    for (var i = lv.bullets.length - 1; i >= 0; i--) {
      var b = lv.bullets[i], gone = false;
      for (var step = 0; step < 2 && !gone; step++) {
        var nx = b.x + DX[b.dir] * BULLET_SPEED / 2, ny = b.y + DY[b.dir] * BULLET_SPEED / 2;
        var leaving = DX[b.dir] ? (DX[b.dir] > 0 ? nx > b.cx + 0.5 : nx < b.cx - 0.5) : (DY[b.dir] > 0 ? ny > b.cy + 0.5 : ny < b.cy - 0.5);
        if (leaving) {
          if (!isOpen(lv, b.cx, b.cy, b.dir)) { addFx(lv, 'wall', b.cx, b.cy, b.dir); gone = true; break; }
          if (isExitMove(lv, b.cx, b.cy, b.dir)) {
            if (lv.barrier > 0) addFx(lv, 'wall', b.cx, b.cy, b.dir);
            gone = true; break;
          }
          b.cx += DX[b.dir]; b.cy += DY[b.dir];
        }
        b.x = nx; b.y = ny;
        gone = bulletHits(lv, b);
      }
      if (gone) lv.bullets.splice(i, 1);
    }
  }

  function bulletHits(lv, b) {
    var j;
    for (j = 0; j < lv.globs.length; j++) {
      if (dist2(lv.globs[j], b) < 0.25) { killGlob(lv, j, 1); return true; }
    }
    for (j = 0; j < lv.snakes.length; j++) {
      if (dist2(lv.snakes[j], b) < 0.3) {
        var s = lv.snakes.splice(j, 1)[0];
        addFx(lv, 'snakeDie', s.x, s.y);
        emit(lv, 'sound', { name: 'snakeDie' });
        emit(lv, 'snakeKilled', { x: s.x, y: s.y });
        return true;
      }
    }
    return false;
  }

  function killGlob(lv, j, points) {
    var o = lv.globs.splice(j, 1)[0];
    lv.game.score += points;
    addFx(lv, 'globDie', o.x, o.y);
    emit(lv, 'sound', { name: points === 2 ? 'eat' : 'globShot' });
    emit(lv, 'points', { x: o.x, y: o.y, points: points });
    if (globsLeft(lv) === 0) emit(lv, 'allGlobs');
  }

  function checkContacts(lv) {
    var sp = shipPos(lv), j;
    for (j = lv.globs.length - 1; j >= 0; j--) if (dist2(lv.globs[j], sp) < 0.4) killGlob(lv, j, 2);
    if (lv.cfg.god) return;
    for (j = 0; j < lv.snakes.length; j++) {
      if (dist2(lv.snakes[j], sp) < 0.3) { shipDies(lv, 'snake', lv.snakes[j]); return; }
    }
  }

  function globEscaped(lv, o) {
    var e = lv.maze.exit;
    addFx(lv, 'globFace', o.cx - DX[e.dir], o.cy - DY[e.dir], null, true);
    emit(lv, 'sound', { name: 'escape' });
    loseLife(lv, 'escape', "Un globule s'est sauvé !");
  }

  function shipDies(lv, why, snake) {
    var sp = shipPos(lv);
    addFx(lv, 'shipBoom', sp.x, sp.y);
    if (snake) addFx(lv, 'snakeFace', sp.x, sp.y, null, true);
    emit(lv, 'sound', { name: 'boom' });
    lv.shipDead = true;
    loseLife(lv, why, why === 'time' ? 'Le temps est écoulé ! Tu es mort !' : 'Un serpent t\'a attrapé ! Tu es mort !');
  }

  function loseLife(lv, reason, text) {
    if (lv.state !== 'play') return;
    lv.reason = reason; lv.endText = text;
    setState(lv, 'dying');
    emit(lv, 'dying', { reason: reason, text: text });
  }

  function setState(lv, st) { lv.state = st; lv.stateTick = 0; }

  // ---------- Actions ----------

  function fire(lv) {
    var game = lv.game;
    if (lv.state !== 'play' || game.bullets <= 0) return false;
    var s = lv.ship;
    if (s.turn) return false;
    game.bullets--;
    var pos = shipPos(lv);
    lv.bullets.push({ x: pos.x, y: pos.y, dir: s.face, cx: s.dir >= 0 && s.t > 0.5 ? s.cx + DX[s.dir] : s.cx, cy: s.dir >= 0 && s.t > 0.5 ? s.cy + DY[s.dir] : s.cy });
    emit(lv, 'sound', { name: 'shot' });
    return true;
  }

  function putBarrier(lv) {
    if (lv.state !== 'play' || lv.barrierUsed) return false;
    lv.barrierUsed = true; lv.barrier = BARRIER_TICKS;
    emit(lv, 'sound', { name: 'barrier' });
    return true;
  }

  function fxFrames(lv, f) {
    var c = { 40: 10, 32: 8, 20: 5, 16: 4 }[lv.T];
    return (f.kind === 'globDie' || f.kind === 'snakeDie' || f.kind === 'shipBoom') ? c - 1 : c;
  }

  // One logic step (50 ms). Final states: 'lost' and 'won'.
  function step(lv, input) {
    lv.tick++; lv.stateTick++;
    for (var i = lv.fx.length - 1; i >= 0; i--) {
      var f = lv.fx[i]; f.k++;
      if (f.k >= fxFrames(lv, f) * 2 && !f.hold) lv.fx.splice(i, 1);
    }
    switch (lv.state) {
      case 'intro':
        if (lv.stateTick >= INTRO_TICKS) setState(lv, lv.cfg.countdown === false ? 'play' : 'countdown');
        if (lv.state === 'play') emit(lv, 'go');
        return;
      case 'countdown':
        if (lv.stateTick % 12 === 1) emit(lv, 'count', { n: 3 - Math.floor(lv.stateTick / 12) });
        if (lv.stateTick >= COUNTDOWN_TICKS) { setState(lv, 'play'); emit(lv, 'go'); }
        lv.ship.anim++;
        return;
      case 'dying':
        if (lv.stateTick >= 40) { setState(lv, 'lost'); emit(lv, 'lost', { reason: lv.reason, text: lv.endText }); }
        return;
      case 'exiting':
        if (lv.stateTick >= 30) { setState(lv, 'won'); emit(lv, 'won'); }
        return;
      case 'play': break;
      default: return;
    }
    updateShip(lv, input);
    if (lv.state !== 'play') return;
    updateEggs(lv);
    updateGlobs(lv);
    if (lv.state !== 'play') return;
    updateSnakes(lv);
    updateBullets(lv);
    checkContacts(lv);
    if (lv.state !== 'play') return;
    if (lv.barrier > 0) lv.barrier--;
    // Warn when a globule comes close to the open exit.
    var near = false;
    if (!lv.barrierUsed) for (i = 0; i < lv.globs.length; i++) {
      var g = lv.globs[i], c = g.cy * lv.maze.cols + g.cx;
      if (c >= 0 && c < lv.dist.length && lv.dist[c] <= 3) { near = true; break; }
    }
    if (near && !lv.nearExit) emit(lv, 'nearExit');
    lv.nearExit = near;
    lv.timeLeft--;
    if (lv.timeLeft === Math.round(DARK_TIME * 1000 / TICK)) emit(lv, 'dark');
    if (lv.timeLeft <= 0) shipDies(lv, 'time');
  }

  function isDark(lv) { return lv.state === 'play' && lv.timeLeft <= DARK_TIME * 1000 / TICK; }

  var api = {
    TICK: TICK, U: U, R: R, D: D, L: L, DX: DX, DY: DY, MAZE_W: MAZE_W, MAZE_H: MAZE_H,
    SHIP_SPEED: SHIP_SPEED, DARK_TIME: DARK_TIME, MAX_BULLETS: MAX_BULLETS, PRESETS: PRESETS,
    INTRO_TICKS: INTRO_TICKS, COUNTDOWN_TICKS: COUNTDOWN_TICKS,
    mulberry32: mulberry32, hashSeed: hashSeed, makeRng: makeRng, randomSeedCode: randomSeedCode, dailySeed: dailySeed,
    tileSize: tileSize, levelParams: levelParams, makeMaze: makeMaze, bfs: bfs, planRoute: planRoute, autopilotDir: autopilotDir, simulateLevel: simulateLevel, levelTime: levelTime,
    createLevel: createLevel, step: step, fire: fire, putBarrier: putBarrier,
    newInput: newInput, inputPress: inputPress, inputRelease: inputRelease,
    shipPos: shipPos, globsLeft: globsLeft, exitOpenFor: exitOpenFor, isDark: isDark, hatchTicks: hatchTicks, fxFrames: fxFrames
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabEngine = api;
})(this);
