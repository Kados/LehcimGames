/*
 * LabRaph - browser port of Lehcim Noil's maze action game (Windows 3.x, 1999-2006).
 * Rules, level table, speeds and creature behaviour were read from the original
 * program (LabRaph.exe, Delphi 1) and checked by running it.
 *
 * Each level: a new maze. Every globule and snake starts inside an egg. Destroy
 * every yellow globule (contact = 2 points, bullet = 1 point), then leave by the
 * exit on the right before the time runs out. No globule may reach the exit
 * before you (Enter = 3 s barrier, once per level). During the last 20 seconds
 * the walls are erased little by little.
 *
 * Logic runs on a fixed 50 ms tick (the original TTimer interval). Everything
 * moves 4 pixels per tick, cell by cell; bullets cross a cell in 2 ticks.
 */
(function () {
  'use strict';

  // ---------- Constants and sprite tables ----------

  var W = 620, H = 400, PANEL_X = 560;
  var TICK = 50;                       // ms per logic step
  var KEY = [184, 10, 70];             // colour key of both sheets
  var U = 0, R = 1, D = 2, L = 3;      // directions = sprite rows 0..3
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  var STEP = 4;                        // pixels per tick (ship, globules, snakes)

  // One entry per zoom (tile size T). Every sprite family exists in 4 sizes on the
  // sheets; s = sprite size, n = frames per row = ticks to cross a cell (T / 4).
  // rows x cols = maze size of the original; path = length of the main path.
  var ZOOMS = {
    40: { tileY: 0, growY: 216, s: 24, n: 10, ship: 400, fx: [160, 354], bullet: [168, 339, 8], glob: 0, snake: 500, rows: 10, cols: 13, path: 55 },
    32: { tileY: 80, growY: 256, s: 20, n: 8, ship: 640, fx: [240, 232], bullet: [247, 218, 6], glob: 240, snake: 740, rows: 12, cols: 16, path: 90 },
    20: { tileY: 144, growY: 288, s: 12, n: 5, ship: 800, fx: [340, 152], bullet: [344, 144, 4], glob: 400, snake: 900, rows: 20, cols: 27, path: 180 },
    16: { tileY: 184, growY: 308, s: 8, n: 4, ship: 860, fx: [360, 88], bullet: [362, 82, 4], glob: 460, snake: 960, rows: 25, cols: 34, path: 300 }
  };
  // Zoom of levels 1..25 (from the original's table); level 26 and more: 16.
  var LEVEL_T = [40, 32, 40, 32, 40, 32, 20, 40, 32, 20, 16, 40, 32, 20, 16, 40, 32, 20, 16, 32, 20, 16, 20, 16, 20];
  // Wall bits of a cell: 1 = top, 2 = right, 4 = bottom, 8 = left (bit = 1 << dir).
  // Position [col,row] of each wall combination in the tile rows of sheet-maze.png.
  var TILE = {};
  [[5, 0, 0], [10, 1, 0], [3, 2, 0], [6, 3, 0], [12, 4, 0], [9, 5, 0], [8, 6, 0], [1, 7, 0], [2, 8, 0], [4, 9, 0],
   [0, 0, 1], [14, 1, 1], [7, 2, 1], [11, 3, 1], [13, 4, 1], [15, 5, 1]].forEach(function (t) { TILE[t[0]] = [t[1], t[2]]; });
  // Second tile row, columns 6..9: stone corner, bottom stone, right stone, exit.
  var T_CORNER = 6, T_BOTTOM = 7, T_STONE = 8, T_EXIT = 9;
  var ROW_EXPLODE = 16, ROW_WARP = 17;            // ship sheet rows
  var ROW_EGG = 16, ROW_DIE = 17, ROW_FACE = 18;  // globule / snake rows
  var PANEL = [920, 0, 60, 400], BARRIER = [101, 517, 28, 80];
  // Value boxes of the side panel (centre y) and their colours, as on the labels.
  var BOXES = [['level', 72, '#4040ff'], ['lives', 123, '#ff2020'], ['globs', 178, '#ffff40'],
               ['bullets', 232, '#ff2020'], ['time', 288, '#e8d8a0'], ['score', 342, '#4060ff']];

  var BARRIER_TICKS = 60;     // 3 seconds
  var DARK_TIME = 20;         // last seconds: the walls are erased
  var MAX_BULLETS = 5;

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var maze, creatures, sheetsReady = false;
  var bg = document.createElement('canvas'); bg.width = W; bg.height = H;   // maze background
  var bgc = bg.getContext('2d');
  var scores = Lehcim.highScores('labraph', [
    { name: 'Pro', score: 60 }, { name: 'Expert', score: 48 }, { name: 'Amateur', score: 36 },
    { name: 'Débutant', score: 24 }, { name: 'Gromové', score: 12 }
  ]);

  // ---------- Game state ----------

  var game = null;   // {level, lives, score, bullets (left at the end of the last level), start (bullets at level start)}
  var lv = null;     // current level (maze, entities...)
  var state = 'idle';            // idle | play | ending | wait
  var paused = false;
  var tickCount = 0;

  function rnd(n) { return Math.floor(Math.random() * n); }

  // Number of globules and snakes, time and bullet bonus of each level (original table).
  function levelParams(n) {
    var T = n <= 25 ? LEVEL_T[n - 1] : 16, z = ZOOMS[T];
    var p = n === 1 ? [1, 90, 0] : n === 2 ? [1, 100, 1] : n <= 4 ? [2, 110, 2] : n <= 7 ? [3, 120, 3] :
            n <= 11 ? [4, 130, 4] : n <= 15 ? [5, 140, 5] : n <= 19 ? [5, 150, 4] : n <= 22 ? [5, 160, 3] :
            n <= 24 ? [5, 170, 2] : [5, 180, 1];
    return { T: T, cols: z.cols, rows: z.rows, globs: p[0], snakes: p[0], time: p[1], bonus: p[2] };
  }

  // ---------- Maze generation ----------

  // The original first draws one long winding path from the ship (left column) to
  // the exit (right column), by adding rectangular detours to an L-shaped path until
  // it is long enough, then fills the rest with dead-end branches.
  function makeMaze(cols, rows, pathLen) {
    var n = cols * rows, i;
    var sr = 1 + rnd(rows - 2), er = rnd(rows);
    // Initial path: right along the ship row, then vertically, then right to the exit.
    var c = 1 + rnd(cols - 2), path = [], x, y;
    for (x = 0; x <= c; x++) path.push([x, sr]);
    for (y = sr; y !== er; ) { y += er > sr ? 1 : -1; path.push([c, y]); }
    for (x = c + 1; x < cols; x++) path.push([x, er]);
    var inPath = new Uint8Array(n);
    path.forEach(function (p) { inPath[p[1] * cols + p[0]] = 1; });
    // Detours: replace a straight run path[i..i+len] by a bump of depth d on one side.
    for (var tries = 0; tries < 4000 && path.length < pathLen; tries++) {
      var len = 1 + rnd(4), a = rnd(path.length - len);
      var p0 = path[a], p1 = path[a + len];
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      if (Math.abs(dx) + Math.abs(dy) !== len || (dx && dy)) continue;   // not straight
      var sx = dx ? 0 : (rnd(2) ? 1 : -1), sy = dx ? (rnd(2) ? 1 : -1) : 0, d = 1 + rnd(2);
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
    // Branches: grow corridors from the cells already in the maze (straight runs preferred).
    var seen = new Uint8Array(n), list = [];
    path.forEach(function (p) { seen[p[1] * cols + p[0]] = 1; list.push(p[1] * cols + p[0]); });
    var lastDir = -1;
    while (list.length) {
      var li = rnd(3) ? list.length - 1 : rnd(list.length), cc = list[li];
      var cx = cc % cols, cy = (cc / cols) | 0, opts = [];
      for (var dd = 0; dd < 4; dd++) {
        var nx = cx + DX[dd], ny = cy + DY[dd];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(dd);
      }
      if (!opts.length) { list.splice(li, 1); continue; }
      var dir = opts.indexOf(lastDir) >= 0 && rnd(3) ? lastDir : opts[rnd(opts.length)];
      var nc = (cy + DY[dir]) * cols + cx + DX[dir];
      open(cx, cy, cx + DX[dir], cy + DY[dir]);
      seen[nc] = 1; list.push(nc); lastDir = dir;
    }
    // Exit: through the right wall of the last column, into the stone column.
    walls[er * cols + cols - 1] &= ~(1 << R);
    return { cols: cols, rows: rows, walls: walls, start: sr, exit: { x: cols, y: er } };
  }

  // Is the move from (cx,cy) in direction d free of walls? (The exit cell is (cols, exit row).)
  function isOpen(cx, cy, d) {
    var m = lv.maze;
    if (cx === m.cols) return d === L;
    if (cx === m.cols - 1 && cy === m.exit.y && d === R) return true;
    return !(m.walls[cy * m.cols + cx] & (1 << d));
  }
  function occKey(x, y) { return y * 64 + x; }

  // ---------- Level setup ----------

  function startLevel(isNew) {
    var p = levelParams(game.level), z = ZOOMS[p.T];
    var m = makeMaze(p.cols, p.rows, z.path);
    if (isNew) game.start = game.level === 1 ? 2 : Math.min(MAX_BULLETS, game.bullets + p.bonus);
    lv = {
      p: p, maze: m, T: p.T, z: z, n: z.n,
      limit: p.time, elapsed: 0, sub: 0,
      barrier: { state: 0, k: 0, slide: 6 },
      avail: game.start, fired: 0, fire: false,
      occ: {}, creatures: [], bullets: [], fx: [],
      dark: false, erase: { k: 0, x: 0, y: 0 },
      end: null, endK: 0, music: null
    };
    lv.ship = newMover(0, m.start); lv.ship.face = U; lv.ship.state = 0;
    // Eggs: globules first, then snakes, on distinct cells away from the left and right edges.
    var used = {};
    for (var i = 0; i < p.globs + p.snakes; i++) {
      var ex, ey;
      do { ex = 3 + rnd(p.cols - 7); ey = 1 + rnd(p.rows - 2); } while (used[occKey(ex, ey)]);
      used[occKey(ex, ey)] = 1;
      var cr = newMover(ex, ey);
      cr.kind = i < p.globs ? 'glob' : 'snake'; cr.state = 1; cr.t = 0; cr.face = D;
      lv.occ[occKey(ex, ey)] = cr;
      lv.creatures.push(cr);
    }
    renderBackground();
    state = 'play';
    startMusic();
    setStatus('Niveau ' + game.level);
  }

  function newMover(x, y) { return { cx: x, cy: y, dir: -1, k: 0, face: U, turn: null, anim: 0 }; }

  function newGame() {
    stopMusic();
    game = { level: 1, lives: 3, score: 0, bullets: 0, start: 2 };
    paused = false; updatePauseButton();
    startLevel(true);
  }

  // ---------- Input ----------

  var held = [];              // arrow directions currently held, last pressed last
  var pivotHeld = false;
  var KEYDIR = { ArrowUp: U, ArrowRight: R, ArrowDown: D, ArrowLeft: L };

  function press(d) { if (held.indexOf(d) < 0) held.push(d); }
  function release(d) { var i = held.indexOf(d); if (i >= 0) held.splice(i, 1); }
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }

  window.addEventListener('keydown', function (e) {
    if (dialogOpen()) return;
    var k = e.key;
    if (k in KEYDIR) { e.preventDefault(); press(KEYDIR[k]); return; }
    if (k === 'w' || k === 'W' || e.code === 'KeyW') { e.preventDefault(); pivotHeld = true; return; }
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); if (!e.repeat) fire(); return; }
    if (k === 'Enter') { e.preventDefault(); if (!e.repeat) putBarrier(); return; }
    if (k === 'p' || k === 'P') { e.preventDefault(); togglePause(); }
  });
  window.addEventListener('keyup', function (e) {
    if (e.key in KEYDIR) release(KEYDIR[e.key]);
    if (e.key === 'w' || e.key === 'W' || e.code === 'KeyW') pivotHeld = false;
  });
  window.addEventListener('blur', function () { held = []; pivotHeld = false; });

  // Touch pad (pointer events): arrows and W are held, Tir / Barrière are taps.
  document.querySelectorAll('#pad button').forEach(function (b) {
    var k = b.getAttribute('data-k'), dmap = { up: U, right: R, down: D, left: L };
    function down(e) {
      e.preventDefault(); b.classList.add('on');
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (k in dmap) press(dmap[k]);
      else if (k === 'pivot') pivotHeld = true;
      else if (k === 'fire') fire();
      else if (k === 'barrier') putBarrier();
    }
    function up() {
      b.classList.remove('on');
      if (k in dmap) release(dmap[k]); else if (k === 'pivot') pivotHeld = false;
    }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  // Space only raises a request; the bullet leaves on the next tick.
  function fire() {
    if (state !== 'play' || paused) return;
    lv.fire = true;
  }

  function putBarrier() {
    if (state !== 'play' || paused || lv.barrier.state !== 0) return;
    if (lv.occ[occKey(lv.maze.exit.x, lv.maze.exit.y)]) return;   // a globule is in the exit
    lv.barrier.state = 1; lv.barrier.k = 0;
    Lehcim.play('barrier');
  }

  // ---------- Movement ----------

  function centre(c) { return c * lv.T + lv.T / 2; }
  // Pixel centre of a mover (it has already entered its cell when k > 0).
  function pos(o) {
    if (o.k > 0 && o.dir >= 0) return { x: centre(o.cx) - DX[o.dir] * (lv.n - o.k) * STEP, y: centre(o.cy) - DY[o.dir] * (lv.n - o.k) * STEP };
    return { x: centre(o.cx), y: centre(o.cy) };
  }
  // Blocked for creatures: walls, other creatures, eggs and the barrier.
  function blocked(o, d, creature) {
    if (!isOpen(o.cx, o.cy, d)) return true;
    if (!creature) return false;
    return !!lv.occ[occKey(o.cx + DX[d], o.cy + DY[d])] || (lv.barrier.state === 1 &&
      o.cx + DX[d] === lv.maze.exit.x && o.cy + DY[d] === lv.maze.exit.y);
  }
  // Facing change: shows the turning rows of the sheets (one row per pair of directions).
  function setFace(o, d) {
    if (d === o.face) return;
    o.turn = { from: o.face, to: d, k: 0 };
    o.face = d;
  }
  // Starts the move to the next cell or continues it. choose(o) returns a direction or -1.
  function advance(o, choose, creature) {
    if (o.turn && ++o.turn.k >= lv.n) o.turn = null;
    o.anim++;
    if (o.k > 0) { if (++o.k >= lv.n) { o.k = 0; } return; }
    var d = choose(o);
    if (d < 0) { o.dir = -1; return; }
    if (creature) { delete lv.occ[occKey(o.cx, o.cy)]; lv.occ[occKey(o.cx + DX[d], o.cy + DY[d])] = o; }
    o.dir = d; o.cx += DX[d]; o.cy += DY[d]; o.k = 1;
  }

  // Ship: the most recent arrow that is open wins; W only turns the ship.
  function chooseShip(s) {
    if (!held.length) return -1;
    for (var i = held.length - 1; i >= 0; i--) {
      if (!blocked(s, held[i], false)) { setFace(s, held[i]); return pivotHeld ? -1 : held[i]; }
    }
    setFace(s, held[held.length - 1]);
    return -1;
  }
  function firstFree(o, list) {
    for (var i = 0; i < list.length; i++) if (!blocked(o, list[i], true)) return list[i];
    return -1;
  }
  function openCount(o) { var c = 0; for (var d = 0; d < 4; d++) if (isOpen(o.cx, o.cy, d)) c++; return c; }
  // Directions open in the walls, in the order left turn, straight, right turn, back.
  function leftHand(o) {
    var f = o.face, out = [];
    [(f + 3) % 4, f, (f + 1) % 4, (f + 2) % 4].forEach(function (d) { if (isOpen(o.cx, o.cy, d)) out.push(d); });
    return out;
  }
  // Globules follow the left-hand wall; when the ship is 2 cells away or less in the
  // same row or column they run away from it.
  function chooseGlob(o) {
    var s = lv.ship, dx = s.cx - o.cx, dy = s.cy - o.cy, list;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3 && (dx === 0 || dy === 0)) {
      list = dy < 0 ? [D, L, R] : dx > 0 ? [L, U, D] : dy > 0 ? [U, R, L] : [R, D, U];
    } else list = leftHand(o);
    var d = firstFree(o, list);
    if (d >= 0) setFace(o, d);
    return d;
  }
  // Snakes go on along corridors; at every crossing they take the direction that
  // brings them closer to the ship as the crow flies, without regard to the walls.
  function chooseSnake(o) {
    var list;
    if (openCount(o) >= 3) {
      var s = lv.ship, dx = o.cx - s.cx, dy = o.cy - s.cy, h = Math.abs(dy) < Math.abs(dx);
      if (dx > 0 && dy > 0) list = h ? [L, U, R, D] : [U, L, R, D];
      else if (dx > 0) list = h ? [L, D, U, R] : [D, L, U, R];
      else if (dy < 0) list = h ? [R, D, U, L] : [D, R, U, L];
      else list = h ? [R, U, D, L] : [U, R, D, L];
    } else {
      list = leftHand(o);
      var back = (o.face + 2) % 4;
      list.sort(function (a, b) { return (a === back) - (b === back); });
    }
    var d = firstFree(o, list);
    if (d >= 0) setFace(o, d);
    return d;
  }

  // Same pixel row (or column) and overlapping sprites, as in the original.
  function touch(a, b) {
    var s = lv.z.s;
    return (a.x === b.x && Math.abs(a.y - b.y) < s) || (a.y === b.y && Math.abs(a.x - b.x) < s);
  }
  function globsLeft() {
    return lv.creatures.filter(function (c) { return c.kind === 'glob' && c.state < 5; }).length;
  }
  function killCreature(c) {
    c.state = 5; c.t = 0;
    if (lv.occ[occKey(c.cx, c.cy)] === c) delete lv.occ[occKey(c.cx, c.cy)];
  }

  // ---------- Update ----------

  function step() {
    tickCount++;
    if (!lv || paused || dialogOpen() || state === 'idle' || state === 'wait') return;
    var i;
    for (i = lv.fx.length - 1; i >= 0; i--) if (++lv.fx[i].k >= lv.n) lv.fx.splice(i, 1);
    animateCreatures();
    if (state === 'ending') {
      lv.ship.anim++;
      if (++lv.endK >= lv.n) { state = 'wait'; endMessage(); }
      return;
    }
    if (state !== 'play') return;

    // Clock: 20 ticks per second.
    if (++lv.sub === 20) { lv.sub = 0; lv.elapsed++; }
    if (lv.elapsed === lv.limit) { endLevel('time'); return; }
    if (!lv.dark && lv.limit - lv.elapsed === DARK_TIME) { lv.dark = true; Lehcim.play('dark'); }
    if (lv.dark) eraseWalls();

    // Barrier: closes in 6 ticks, stays, opens in the last 6 of its 60 ticks.
    var b = lv.barrier;
    if (b.state === 1) {
      b.k++;
      if (b.k <= 6) b.slide--;
      if (b.k > 54) b.slide++;
      if (b.k === BARRIER_TICKS) b.state = 2;
    }

    updateBullets();
    var s = lv.ship;
    advance(s, chooseShip, false);
    if (s.k === 0 && s.cx === lv.maze.exit.x && s.cy === lv.maze.exit.y && globsLeft() === 0) {
      Lehcim.play('exit'); endLevel('win'); return;
    }
    var sp = pos(s), escaped = null;
    lv.creatures.forEach(function (c) {
      if (c.kind !== 'glob' || c.state >= 6) return;
      if (c.state === 1 && Math.max(Math.abs(c.cx - s.cx), Math.abs(c.cy - s.cy)) < 3 && (c.cx === s.cx || c.cy === s.cy)) c.state = 2;
      if (c.state === 3) {
        advance(c, chooseGlob, true);
        if (c.k === 0 && c.cx === lv.maze.exit.x && c.cy === lv.maze.exit.y) { escaped = c; return; }
      }
      if (c.state < 5 && touch(pos(c), sp)) { killCreature(c); game.score += 2; Lehcim.play('glob'); }
    });
    if (escaped) {
      escaped.state = 4; escaped.t = 0; Lehcim.play('death');
      endLevel('escape'); return;
    }
    var killer = null;
    lv.creatures.forEach(function (c) {
      if (c.kind !== 'snake' || c.state >= 6 || killer) return;
      if (c.state === 1 && Math.abs(c.cx - s.cx) < 4 && Math.abs(c.cy - s.cy) < 4) c.state = 2;
      if (c.state === 3) advance(c, chooseSnake, true);
      if (c.state < 5 && touch(pos(c), sp)) killer = c;
    });
    if (killer) {
      killer.state = 4; killer.t = 0; Lehcim.play('death');
      endLevel('snake'); return;
    }
    if (lv.fire) { lv.fire = false; if (lv.fired < lv.avail) { lv.fired++; shoot(); } }
  }

  // Eggs open, explosions and faces play their frames.
  function animateCreatures() {
    lv.creatures.forEach(function (c) {
      if (c.state === 2) { if (++c.t >= lv.n - 1) { c.state = 3; c.t = 0; } }
      else if (c.state === 3) { if (c.k === 0) c.anim++; }
      else if (c.state === 4) { if (c.t < lv.n - 1) c.t++; }
      else if (c.state === 5) { if (++c.t >= lv.n - 1) c.state = 6; }
    });
  }

  // The bullet appears in the next cell in front of the ship (or explodes at once on a wall).
  function shoot() {
    var s = lv.ship, d = s.face;
    Lehcim.play('shot');
    if (!isOpen(s.cx, s.cy, d)) { wallHit(s.cx, s.cy, d); return; }
    lv.bullets.push({ cx: s.cx + DX[d], cy: s.cy + DY[d], dir: d, k: 0 });
  }
  function bulletPos(b) {
    return { x: centre(b.cx) + (b.k ? DX[b.dir] * lv.T / 2 : 0), y: centre(b.cy) + (b.k ? DY[b.dir] * lv.T / 2 : 0) };
  }
  function wallHit(cx, cy, d) {
    lv.fx.push({ kind: 'wall', x: cx, y: cy, dir: d, k: 0 });
    Lehcim.play(rnd(2) ? 'ricochet1' : 'ricochet2');
  }
  // Bullets go through globules and eggs (1 point each, one per tick) and stop on a snake.
  function updateBullets() {
    for (var i = lv.bullets.length - 1; i >= 0; i--) {
      var b = lv.bullets[i], bp = bulletPos(b), gone = false, hitGlob = false;
      lv.creatures.forEach(function (c) {
        if (gone || c.state >= 5 || (c.kind === 'glob' && hitGlob) || !touch(pos(c), bp)) return;
        killCreature(c);
        if (c.kind === 'glob') { hitGlob = true; game.score += 1; Lehcim.play('glob'); }
        else { gone = true; Lehcim.play('snakeShot'); }
      });
      if (!gone && b.k === 0 && !isOpen(b.cx, b.cy, b.dir)) { wallHit(b.cx, b.cy, b.dir); gone = true; }
      if (gone) { lv.bullets.splice(i, 1); continue; }
      if (b.k === 0) b.k = 1;
      else { b.k = 0; b.cx += DX[b.dir]; b.cy += DY[b.dir]; }
    }
  }

  // Last 20 seconds: every 6 ticks a random spot of the maze is covered by floor.
  function eraseWalls() {
    var e = lv.erase, T = lv.T;
    if (e.k === 0) { e.x = rnd(lv.maze.cols - 2); e.y = rnd(lv.maze.rows - 2); }
    bgc.drawImage(maze, e.k * T, lv.z.growY, T, T, e.x * T + T / 2, e.y * T + T / 2, T, T);
    if (++e.k === 6) e.k = 0;
  }

  // why: win | time | escape | snake
  function endLevel(why) {
    lv.end = why; lv.endK = 0; state = 'ending';
    lv.bullets = [];
    lv.creatures.forEach(function (c) { if (c.state < 4) killCreature(c); });
    if (why !== 'win') { lv.ship.state = 4; game.lives--; } else lv.ship.state = 5;
    lv.ship.anim = 0;
    game.bullets = lv.avail - lv.fired;
    stopMusic();
  }

  var END_TEXT = {
    win: ['Bravo !', 'Niveau terminé .'], time: ['Dommage...', 'Temps écoulé .'],
    snake: ['Dommage...', 'Tu es mort !'], escape: ['Dommage...', "Un globule s'est sauvé ."]
  };
  function endMessage() {
    var t = END_TEXT[lv.end];
    msgBox(t[0], t[1]).then(function () {
      if (lv.end === 'win') game.level++;
      if (game.lives <= 0) gameOver();
      else startLevel(lv.end === 'win');
    });
  }

  // Message box with a caption, like the original MessageBox.
  function msgBox(title, text) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      var h = document.createElement('h2'); h.textContent = title; d.appendChild(h);
      var p = document.createElement('p'); p.textContent = text; d.appendChild(p);
      var row = document.createElement('div'); row.className = 'row';
      var b = document.createElement('button'); b.textContent = 'OK';
      b.addEventListener('click', function () { d.close(); });
      d.addEventListener('close', function () { d.remove(); resolve(); });
      row.appendChild(b); d.appendChild(row); document.body.appendChild(d); d.showModal(); b.focus();
    });
  }

  function gameOver() {
    state = 'idle';
    setStatus('La partie est terminée .');
    var sc = game.score;
    var p = scores.qualifies(sc)
      ? nameBox().then(function (name) { scores.add(name.slice(0, 14) || 'bip-bip', sc); })
      : Promise.resolve();
    p.then(function () { showScores('La partie est terminée .'); });
  }
  // "BRAVO !" window of the original: the name field starts with "bip-bip".
  function nameBox() {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      d.innerHTML = '<h2>BRAVO  !</h2><form method="dialog"><p>Tu fais partie des meilleurs ! Ecris ton nom .\n( 14 caractères maximum )</p>' +
        '<input maxlength="14" autocomplete="off" value="bip-bip"><div class="row"><button>OK</button></div></form>';
      var input = d.querySelector('input');
      d.addEventListener('close', function () { var v = input.value.trim(); d.remove(); resolve(v); });
      document.body.appendChild(d); d.showModal(); input.select();
    });
  }

  // "Abandonner" stops the game at once (no confirmation, no score).
  function abandon() {
    if (!game || state === 'idle') return;
    stopMusic(); state = 'idle'; paused = false; updatePauseButton();
    setStatus('Partie abandonnée .');
  }

  function showScores(title) {
    var d = document.getElementById('scores');
    d.querySelector('h2').textContent = title || 'Scores';
    var tb = d.querySelector('tbody'); tb.innerHTML = '';
    scores.list().forEach(function (e) {
      var tr = document.createElement('tr');
      var a = document.createElement('td'); a.textContent = e.name;
      var b = document.createElement('td'); b.textContent = e.score;
      tr.appendChild(a); tr.appendChild(b); tb.appendChild(tr);
    });
    d.showModal();
  }

  // ---------- Sound ----------

  // Original WAVE resources and their use in the program.
  var SND = {
    barrier: 'assets/sounds/1.wav', ricochet1: 'assets/sounds/2.wav', ricochet2: 'assets/sounds/3.wav',
    snakeShot: 'assets/sounds/4.wav', death: 'assets/sounds/5.wav', glob: 'assets/sounds/6.wav',
    dark: 'assets/sounds/7.wav', shot: 'assets/sounds/8.wav', exit: 'assets/sounds/9.wav'
  };
  // Browsers only allow audio after a user gesture: load the sounds then.
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  // Music of a level: one of the two long sounds (10 or 11), chosen at random and looped.
  function startMusic() {
    stopMusic();
    if (Lehcim.isMuted()) return;
    try {
      var a = new Audio('assets/sounds/' + (rnd(2) ? 10 : 11) + '.wav');
      a.loop = true; a.volume = 0.5; lv.music = a;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay refused */ });
    } catch (e) { /* ignore */ }
  }
  function stopMusic() {
    if (lv && lv.music) { try { lv.music.pause(); } catch (e) { /* ignore */ } lv.music = null; }
  }

  // ---------- Drawing ----------

  // Maze, stone column (and stone row at zoom 32) and exit, drawn once per level.
  function renderBackground() {
    var z = lv.z, T = lv.T, m = lv.maze, x, y;
    bgc.fillStyle = '#000'; bgc.fillRect(0, 0, W, H);
    function tile(col, row, dx, dy, h) { bgc.drawImage(maze, col * T, z.tileY + row * T, T, h || T, dx, dy, T, h || T); }
    for (y = 0; y < m.rows; y++) {
      for (x = 0; x < m.cols; x++) { var t = TILE[m.walls[y * m.cols + x]]; tile(t[0], t[1], x * T, y * T); }
      tile(y === m.exit.y ? T_EXIT : T_STONE, 1, m.cols * T, y * T);
    }
    var rest = H - m.rows * T;
    if (rest > 0) {
      for (x = 0; x < m.cols; x++) tile(T_BOTTOM, 1, x * T, m.rows * T, rest);
      tile(T_CORNER, 1, m.cols * T, m.rows * T, rest);
    }
  }

  function draw() {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (!sheetsReady) return;
    if (lv) { g.drawImage(bg, 0, 0); drawLevel(); }
    if (game) drawPanel();
    if (paused && lv) banner('PAUSE');
  }

  function banner(big) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 160, PANEL_X, 60);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold italic 34px "Times New Roman", serif'; g.fillStyle = '#ffd34d';
    g.fillText(big, PANEL_X / 2, 190);
    g.restore();
  }

  // Draws a square sprite of size s centred on a pixel position.
  function spr(img, sx, sy, s, p) {
    g.drawImage(img, sx, sy, s, s, Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  // Sprite row of a mover: its direction, or the turning row from its old direction.
  var TURN_ROW = [[-1, 4, 5, 6], [9, -1, 7, 8], [11, 12, -1, 10], [13, 14, 15, -1]];  // [to][from]
  function rowOf(o) { return o.turn ? TURN_ROW[o.turn.to][o.turn.from] : o.face; }
  function frameOf(o) { return o.turn ? Math.min(lv.n - 1, o.turn.k) : (o.k > 0 ? o.k - 1 : o.anim % lv.n); }

  function drawLevel() {
    var z = lv.z, s = z.s;
    if (lv.barrier.state === 1) drawBarrier();
    lv.creatures.forEach(function (c) {
      var x0 = c.kind === 'glob' ? z.glob : z.snake, p = pos(c);
      if (c.state === 1) spr(creatures, x0, ROW_EGG * s, s, p);
      else if (c.state === 2) spr(creatures, x0 + c.t * s, ROW_EGG * s, s, p);
      else if (c.state === 3) spr(creatures, x0 + frameOf(c) * s, rowOf(c) * s, s, p);
      else if (c.state === 4) spr(creatures, x0 + c.t * s, ROW_FACE * s, s, p);
      else if (c.state === 5) spr(creatures, x0 + c.t * s, ROW_DIE * s, s, p);
    });
    lv.bullets.forEach(function (b) {
      var bb = z.bullet, p = bulletPos(b);
      g.drawImage(maze, bb[0], bb[1], bb[2], bb[2], Math.round(p.x - bb[2] / 2), Math.round(p.y - bb[2] / 2), bb[2], bb[2]);
    });
    drawShip();
    lv.fx.forEach(function (f) {
      // Bullet hitting a wall: rows 1..4 of the effect block = up, right, down, left.
      var off = (lv.T - s) / 2, k = Math.min(lv.n - 1, f.k);
      g.drawImage(maze, z.fx[0] + k * s, z.fx[1] + (1 + f.dir) * s, s, s,
        Math.round(centre(f.x) + DX[f.dir] * off - s / 2), Math.round(centre(f.y) + DY[f.dir] * off - s / 2), s, s);
    });
  }

  function drawShip() {
    var z = lv.z, s = z.s, sh = lv.ship, p = pos(sh);
    if (sh.state === 4) { if (sh.anim < lv.n - 1) spr(maze, z.ship + sh.anim * s, ROW_EXPLODE * s, s, p); return; }
    if (sh.state === 5) { spr(maze, z.ship + Math.min(lv.n - 1, sh.anim) * s, ROW_WARP * s, s, p); return; }
    spr(maze, z.ship + frameOf(sh) * s, rowOf(sh) * s, s, p);
  }

  // The barrier slides down over the exit opening, then up again.
  function drawBarrier() {
    var T = lv.T, e = lv.maze.exit, w = Math.round(T * BARRIER[2] / BARRIER[3]);
    var x = e.x * T - Math.round(w / 2), y = e.y * T - Math.round(lv.barrier.slide * T / 6);
    g.drawImage(maze, BARRIER[0], BARRIER[1], BARRIER[2], BARRIER[3], x, y, w, T);
  }

  function drawPanel() {
    g.drawImage(maze, PANEL[0], PANEL[1], PANEL[2], PANEL[3], PANEL_X, 0, PANEL[2], PANEL[3]);
    var vals = {
      level: game.level, lives: game.lives, globs: lv ? globsLeft() : 0, bullets: lv ? lv.avail - lv.fired : game.start,
      time: lv ? lv.limit - lv.elapsed : 0, score: game.score
    };
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 13px "Times New Roman", serif';
    BOXES.forEach(function (b) {
      g.fillStyle = b[2];
      g.fillText(String(vals[b[0]]), PANEL_X + 32, b[1]);
    });
    g.restore();
  }

  // ---------- Toolbar / page ----------

  function setStatus(t) { statusEl.textContent = t; }
  function togglePause() {
    if (!lv || state !== 'play') return;
    paused = !paused; updatePauseButton();
    if (lv.music) { try { if (paused) lv.music.pause(); else lv.music.play().catch(function () {}); } catch (e) { /* ignore */ } }
  }
  function updatePauseButton() { document.getElementById('pause').textContent = paused ? 'Reprise' : 'Pause'; }

  document.getElementById('new').addEventListener('click', function (e) { e.target.blur(); newGame(); });
  document.getElementById('pause').addEventListener('click', function (e) { e.target.blur(); togglePause(); });
  document.getElementById('abandon').addEventListener('click', function (e) { e.target.blur(); abandon(); });
  document.getElementById('showScores').addEventListener('click', function (e) { e.target.blur(); showScores('Scores'); });
  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  g.imageSmoothingEnabled = false;

  Promise.all([
    Lehcim.loadSheet('assets/sheet-maze.png', KEY),
    Lehcim.loadSheet('assets/sheet-creatures.png', KEY)
  ]).then(function (sh) {
    maze = sh[0]; creatures = sh[1]; sheetsReady = true;
  });

  // Fixed-step loop: logic every 50 ms, drawing on each animation frame.
  var acc = 0, last = performance.now();
  function frame(now) {
    acc += Math.min(500, now - last); last = now;
    while (acc >= TICK) { acc -= TICK; step(); }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Hooks for automated tests.
  window.LabRaph = {
    get state() { return state; }, get level() { return lv; }, get game() { return game; },
    newGame: newGame, startLevel: startLevel, step: step, levelParams: levelParams, makeMaze: makeMaze,
    press: press, release: release, fire: fire, putBarrier: putBarrier
  };
})();
