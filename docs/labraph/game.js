/*
 * LabRaph - browser port of Lehcim Noil's maze action game (Windows 3.x, 1999-2006).
 * Rewritten from the original help text, graphics and sounds (no source available).
 *
 * Each level: a random maze. Destroy every yellow globule (contact = 2 points,
 * bullet = 1 point), then leave by the exit before the time runs out. Red snakes
 * fly over the walls straight at you. Eggs open when you come close. No globule
 * may escape through the exit before you (Enter = 3 s barrier, once per level).
 * The walls become invisible during the last 20 seconds.
 *
 * Logic runs on a fixed 50 ms tick (the original TTimer interval).
 */
(function () {
  'use strict';

  // ---------- Constants and sprite tables ----------

  var W = 620, H = 400, MAZE_W = 560, MAZE_H = 400, PANEL_X = 560;
  var TICK = 50;                       // ms per logic step
  var KEY = [184, 10, 70];             // colour key of both sheets
  var U = 0, R = 1, D = 2, L = 3;      // directions = sprite rows 0..3
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  // One entry per zoom level (tile size T). Every sprite family exists in 4 sizes
  // on the sheets; s = sprite cell size, cols = frames per row, rot = turn frames.
  var ZOOMS = {
    40: { tileY: 0, growY: 216, s: 24, cols: 10, rot: 4, ship: 400, fx: [160, 354], bullet: [168, 339, 8], glob: 0, snake: 500 },
    32: { tileY: 80, growY: 256, s: 20, cols: 8, rot: 4, ship: 640, fx: [240, 232], bullet: [247, 218, 6], glob: 240, snake: 740 },
    20: { tileY: 144, growY: 288, s: 12, cols: 5, rot: 2, ship: 800, fx: [340, 152], bullet: [344, 144, 4], glob: 400, snake: 900 },
    16: { tileY: 184, growY: 308, s: 8, cols: 4, rot: 2, ship: 860, fx: [360, 88], bullet: [362, 82, 4], glob: 460, snake: 960 }
  };
  // Wall bits of a cell: 1 = top, 2 = right, 4 = bottom, 8 = left (bit = 1 << dir).
  // Position [col,row] of each wall combination in the tile rows of sheet-maze.png.
  var TILE = {};
  [[5, 0, 0], [10, 1, 0], [3, 2, 0], [6, 3, 0], [12, 4, 0], [9, 5, 0], [8, 6, 0], [1, 7, 0], [2, 8, 0], [4, 9, 0],
   [0, 0, 1], [14, 1, 1], [7, 2, 1], [11, 3, 1], [13, 4, 1], [15, 5, 1]].forEach(function (t) { TILE[t[0]] = [t[1], t[2]]; });
  // Ship quarter-turn rows (frames 0..rot-1): clockwise from U,R,D,L / counter-clockwise from U,R,D,L.
  var TURN_CW = [9, 12, 15, 6], TURN_CCW = [11, 4, 5, 8];
  var ROW_EXPLODE = 16, ROW_WARP = 17;            // ship sheet rows
  var ROW_EGG = 16, ROW_DIE = 17, ROW_FACE = 18;  // globule / snake rows
  var PANEL = [920, 0, 60, 400], BARRIER = [101, 517, 28, 80];
  // Value boxes of the side panel (centre y) and their colours, as on the labels.
  var BOXES = [['level', 72, '#4040ff'], ['lives', 123, '#ff2020'], ['globs', 178, '#ffff40'],
               ['bullets', 232, '#ff2020'], ['time', 288, '#e8d8a0'], ['score', 342, '#4060ff']];

  var SHIP_SPEED = 0.25;      // cells per tick
  var BULLET_SPEED = 0.5;
  var TURN_TICKS = 2;         // duration of a quarter turn
  var EGG_RANGE_GLOB = 1.6, EGG_RANGE_SNAKE = 3.2; // cells
  var BARRIER_TICKS = 60;     // 3 seconds
  var DARK_TIME = 20;         // last seconds without walls
  var MAX_BULLETS = 5;

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var maze, creatures, sheetsReady = false;
  var scores = Lehcim.highScores('labraph', [
    { name: 'Pro', score: 60 }, { name: 'Expert', score: 48 }, { name: 'Amateur', score: 36 },
    { name: 'Débutant', score: 24 }, { name: 'Gromové', score: 12 }
  ]);

  // ---------- Game state ----------

  var game = null;   // {level, lives, score, bullets}
  var lv = null;     // current level (maze, entities...)
  var state = 'idle';            // idle | intro | play | dying | exiting | wait
  var paused = false;
  var tickCount = 0;

  function rnd(n) { return Math.floor(Math.random() * n); }

  // Zoom (tile size) and difficulty of each level.
  function levelParams(n) {
    var T = n <= 2 ? 40 : n <= 4 ? 32 : n <= 7 ? 20 : 16;
    var cols = Math.floor(MAZE_W / T), rows = Math.floor(MAZE_H / T);
    var cells = cols * rows;
    return {
      T: T, cols: cols, rows: rows,
      globs: Math.min(3 + n, 14),
      snakes: Math.min(1 + Math.floor((n - 1) * 2 / 3), 10),
      time: Math.round(40 + cells * 0.12),
      globSpeed: Math.min(0.1 + 0.005 * n, 0.15),
      snakeSpeed: Math.min(0.08 + 0.008 * n, 0.17),
      bias: Math.min(0.02 * n, 0.15)       // chance a globule heads for the exit at a crossing
    };
  }

  // ---------- Maze generation ----------

  // Random perfect maze (depth-first backtracker) plus a few extra openings.
  function makeMaze(cols, rows) {
    var walls = [], i;
    for (i = 0; i < cols * rows; i++) walls.push(15);
    var seen = new Uint8Array(cols * rows), stack = [rnd(cols * rows)];
    seen[stack[0]] = 1;
    while (stack.length) {
      var c = stack[stack.length - 1], x = c % cols, y = (c / cols) | 0, opts = [];
      for (var d = 0; d < 4; d++) {
        var nx = x + DX[d], ny = y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      var dd = opts[rnd(opts.length)], n = (y + DY[dd]) * cols + x + DX[dd];
      walls[c] &= ~(1 << dd); walls[n] &= ~(1 << ((dd + 2) % 4));
      seen[n] = 1; stack.push(n);
    }
    // Knock down some extra walls so that there are loops (escape routes).
    var extra = Math.round(cols * rows * 0.08);
    for (i = 0; i < extra; i++) {
      var cx = rnd(cols - 1), cy = rnd(rows - 1), dir = rnd(2) ? R : D;
      var cc = cy * cols + cx, nn = cc + (dir === R ? 1 : cols);
      walls[cc] &= ~(1 << dir); walls[nn] &= ~(1 << ((dir + 2) % 4));
    }
    // Exit: an opening in the outer wall (top, bottom or left side; the right side touches the panel).
    var side = [U, D, L][rnd(3)], ex, ey;
    if (side === L) { ex = 0; ey = 1 + rnd(rows - 2); }
    else { ex = 1 + rnd(cols - 2); ey = side === U ? 0 : rows - 1; }
    walls[ey * cols + ex] &= ~(1 << side);
    return { cols: cols, rows: rows, walls: walls, exit: { x: ex, y: ey, dir: side } };
  }

  // Distance (in moves) from every cell to the exit cell.
  function exitDistances(m) {
    var dist = new Int32Array(m.cols * m.rows).fill(-1), q = [m.exit.y * m.cols + m.exit.x];
    dist[q[0]] = 0;
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

  function isOpen(cx, cy, d) { return !(lv.maze.walls[cy * lv.maze.cols + cx] & (1 << d)); }
  function isExitMove(cx, cy, d) { var e = lv.maze.exit; return cx === e.x && cy === e.y && d === e.dir; }
  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  // ---------- Level setup ----------

  function startLevel() {
    var p = levelParams(game.level);
    var m = makeMaze(p.cols, p.rows);
    lv = {
      p: p, maze: m, T: p.T, z: ZOOMS[p.T],
      ox: Math.floor((MAZE_W - p.cols * p.T) / 2), oy: Math.floor((MAZE_H - p.rows * p.T) / 2),
      dist: exitDistances(m),
      timeLeft: p.time * 1000 / TICK,        // ticks
      barrierUsed: false, barrier: 0,
      globs: [], snakes: [], eggs: [], bullets: [], fx: [],
      intro: 0, endTimer: 0, darkSound: null
    };
    // Ship: far from the exit.
    var maxD = 0, i;
    for (i = 0; i < lv.dist.length; i++) maxD = Math.max(maxD, lv.dist[i]);
    var far = [];
    for (i = 0; i < lv.dist.length; i++) if (lv.dist[i] >= maxD * 0.6) far.push(i);
    var sc = far[rnd(far.length)];
    lv.ship = { cx: sc % p.cols, cy: (sc / p.cols) | 0, dir: -1, t: 0, face: U, turn: null, anim: 0 };
    // Creatures on free cells away from the ship.
    var used = {}; used[sc] = 1;
    var shipPos = { x: lv.ship.cx, y: lv.ship.cy };
    function freeCell(minDist) {
      for (var tries = 0; tries < 500; tries++) {
        var c = rnd(p.cols * p.rows), pos = { x: c % p.cols, y: (c / p.cols) | 0 };
        if (used[c] || dist2(pos, shipPos) < minDist * minDist || lv.dist[c] < 4) continue;
        used[c] = 1; return pos;
      }
      return { x: rnd(p.cols), y: rnd(p.rows) };
    }
    var free = Math.ceil(p.globs / 2);
    for (i = 0; i < p.globs; i++) {
      var gp = freeCell(3);
      if (i < free) lv.globs.push(newGlob(gp.x, gp.y));
      else lv.eggs.push({ x: gp.x, y: gp.y, kind: 'glob', open: -1 });
    }
    for (i = 0; i < p.snakes; i++) {
      var spos = freeCell(EGG_RANGE_SNAKE + 1.5);
      lv.eggs.push({ x: spos.x, y: spos.y, kind: 'snake', open: -1 });
    }
    // At least one more bullet per level (sometimes two), 5 at most.
    game.bullets = Math.min(MAX_BULLETS, game.bullets + 1 + (Math.random() < 0.3 ? 1 : 0));
    state = 'intro'; lv.intro = 0;
    setStatus('Niveau ' + game.level);
  }

  function newGlob(x, y) {
    return { cx: x, cy: y, dir: -1, t: 0, last: rnd(4), anim: rnd(10), x: x, y: y };
  }

  function newGame() {
    stopDark();
    game = { level: 1, lives: 3, score: 0, bullets: 0 };
    paused = false; updatePauseButton();
    startLevel();
  }

  // ---------- Input ----------

  var held = [];              // arrow directions currently held, last pressed last
  var pivotHeld = false;
  var KEYDIR = { ArrowUp: U, ArrowRight: R, ArrowDown: D, ArrowLeft: L };

  function press(d) { release(d); held.push(d); }
  function release(d) { var i = held.indexOf(d); if (i >= 0) held.splice(i, 1); }
  function wantedDir() { return held.length ? held[held.length - 1] : -1; }
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

  function fire() {
    if (state !== 'play' || paused || game.bullets <= 0) return;
    var s = lv.ship;
    if (s.turn) return;
    game.bullets--;
    var pos = shipPos();
    lv.bullets.push({ x: pos.x, y: pos.y, dir: s.face, cx: s.dir >= 0 && s.t > 0.5 ? s.cx + DX[s.dir] : s.cx, cy: s.dir >= 0 && s.t > 0.5 ? s.cy + DY[s.dir] : s.cy });
    Lehcim.play('shot');
  }

  function putBarrier() {
    if (state !== 'play' || paused || lv.barrierUsed) return;
    lv.barrierUsed = true; lv.barrier = BARRIER_TICKS;
    Lehcim.play('barrier');
  }

  // ---------- Update ----------

  function shipPos() {
    var s = lv.ship;
    return s.dir >= 0 ? { x: s.cx + DX[s.dir] * s.t, y: s.cy + DY[s.dir] * s.t } : { x: s.cx, y: s.cy };
  }
  function globsLeft() {
    return lv.globs.length + lv.eggs.filter(function (e) { return e.kind === 'glob'; }).length;
  }
  function exitOpenFor(who) {
    if (lv.barrier > 0) return false;
    return who === 'glob' || globsLeft() === 0;
  }

  function updateShip() {
    var s = lv.ship;
    s.anim++;
    if (s.turn) {                      // turning animation in progress
      s.turn.k++;
      if (s.turn.k >= TURN_TICKS) {
        s.face = s.turn.to;
        s.turn = s.turn.steps.length ? { to: s.turn.steps.shift(), steps: s.turn.steps, k: 0, from: s.face } : null;
      }
      return;
    }
    if (s.dir >= 0) {                  // moving between two cells
      s.t += SHIP_SPEED;
      if (s.t < 1) return;
      s.cx += DX[s.dir]; s.cy += DY[s.dir]; s.t = 0; s.dir = -1;
      if (s.cx < 0 || s.cy < 0 || s.cx >= lv.maze.cols || s.cy >= lv.maze.rows) { leaveMaze(); return; }
    }
    var want = wantedDir();
    if (want < 0) return;
    if (want !== s.face) {             // turn first (one or two quarter turns)
      var diff = (want - s.face + 4) % 4, steps;
      if (diff === 1) steps = [want];
      else if (diff === 3) steps = [want];
      else steps = [(s.face + 1) % 4, want];
      s.turn = { to: steps.shift(), steps: steps, k: 0, from: s.face };
      return;
    }
    if (pivotHeld) return;             // "immobilisation": turn on the spot only
    if (isOpen(s.cx, s.cy, want)) {
      if (isExitMove(s.cx, s.cy, want) && !exitOpenFor('ship')) return;
      s.dir = want; s.t = SHIP_SPEED;
    }
  }

  function leaveMaze() {
    state = 'exiting'; lv.endTimer = 0;
    stopDark();
    Lehcim.play('exit');
  }

  function updateGlobs() {
    var p = lv.p;
    for (var i = lv.globs.length - 1; i >= 0; i--) {
      var o = lv.globs[i];
      o.anim++;
      if (o.dir >= 0) {
        o.t += p.globSpeed;
        if (o.t >= 1) {
          o.cx += DX[o.dir]; o.cy += DY[o.dir]; o.t = 0; o.last = o.dir; o.dir = -1;
          if (o.cx < 0 || o.cy < 0 || o.cx >= lv.maze.cols || o.cy >= lv.maze.rows) {
            lv.globs.splice(i, 1); globEscaped(o); return;
          }
        }
      }
      if (o.dir < 0) chooseGlobDir(o);
      o.x = o.dir >= 0 ? o.cx + DX[o.dir] * o.t : o.cx;
      o.y = o.dir >= 0 ? o.cy + DY[o.dir] * o.t : o.cy;
    }
  }

  // Globules wander: no U-turn unless in a dead end; sometimes they head for the exit.
  function chooseGlobDir(o) {
    var opts = [], back = (o.last + 2) % 4, d;
    for (d = 0; d < 4; d++) {
      if (!isOpen(o.cx, o.cy, d)) continue;
      if (isExitMove(o.cx, o.cy, d) && !exitOpenFor('glob')) continue;
      opts.push(d);
    }
    if (!opts.length) return;
    if (opts.length > 1) opts = opts.filter(function (x) { return x !== back; });
    var c = o.cy * lv.maze.cols + o.cx;
    if (Math.random() < lv.p.bias) {
      if (isExitMove(o.cx, o.cy, lv.maze.exit.dir) && opts.indexOf(lv.maze.exit.dir) >= 0 && lv.dist[c] === 0) { o.dir = lv.maze.exit.dir; return; }
      for (var k = 0; k < opts.length; k++) {
        d = opts[k];
        var nx = o.cx + DX[d], ny = o.cy + DY[d];
        if (nx >= 0 && ny >= 0 && nx < lv.maze.cols && ny < lv.maze.rows && lv.dist[ny * lv.maze.cols + nx] < lv.dist[c]) { o.dir = d; return; }
      }
    }
    o.dir = opts[rnd(opts.length)];
  }

  function updateSnakes() {
    var sp = shipPos(), v = lv.p.snakeSpeed;
    lv.snakes.forEach(function (s) {
      s.anim++;
      var dx = sp.x - s.x, dy = sp.y - s.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.001) {
        var k = Math.min(v, d) / d;
        s.x += dx * k; s.y += dy * k;
        s.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U);
      }
    });
  }

  function updateEggs() {
    var sp = shipPos();
    for (var i = lv.eggs.length - 1; i >= 0; i--) {
      var e = lv.eggs[i];
      if (e.open < 0) {
        var r = e.kind === 'snake' ? EGG_RANGE_SNAKE : EGG_RANGE_GLOB;
        if (dist2(e, sp) <= r * r) { e.open = 0; Lehcim.play('egg'); }
        continue;
      }
      e.open++;
      if (e.open >= (lv.z.cols - 1) * 2) {        // the egg has hatched
        lv.eggs.splice(i, 1);
        if (e.kind === 'glob') lv.globs.push(newGlob(e.x, e.y));
        else lv.snakes.push({ x: e.x, y: e.y, face: D, anim: 0 });
      }
    }
  }

  function updateBullets() {
    for (var i = lv.bullets.length - 1; i >= 0; i--) {
      var b = lv.bullets[i], gone = false;
      for (var step = 0; step < 2 && !gone; step++) {
        var nx = b.x + DX[b.dir] * BULLET_SPEED / 2, ny = b.y + DY[b.dir] * BULLET_SPEED / 2;
        // Crossing the middle line between two cells: is there a wall?
        var leaving = DX[b.dir] ? (DX[b.dir] > 0 ? nx > b.cx + 0.5 : nx < b.cx - 0.5) : (DY[b.dir] > 0 ? ny > b.cy + 0.5 : ny < b.cy - 0.5);
        if (leaving) {
          if (!isOpen(b.cx, b.cy, b.dir)) { addFx('wall', b.cx, b.cy, b.dir); gone = true; break; }
          if (isExitMove(b.cx, b.cy, b.dir)) {
            if (lv.barrier > 0) { addFx('wall', b.cx, b.cy, b.dir); }
            gone = true; break;
          }
          b.cx += DX[b.dir]; b.cy += DY[b.dir];
        }
        b.x = nx; b.y = ny;
        gone = bulletHits(b);
      }
      if (gone) lv.bullets.splice(i, 1);
    }
  }

  function bulletHits(b) {
    var j;
    for (j = 0; j < lv.globs.length; j++) {
      if (dist2(lv.globs[j], b) < 0.25) {
        killGlob(j, 1); return true;
      }
    }
    for (j = 0; j < lv.snakes.length; j++) {
      if (dist2(lv.snakes[j], b) < 0.3) {
        var s = lv.snakes.splice(j, 1)[0];
        addFx('snakeDie', s.x, s.y); Lehcim.play('snakeDie'); return true;
      }
    }
    return false;
  }

  function killGlob(j, points) {
    var o = lv.globs.splice(j, 1)[0];
    game.score += points;
    addFx('globDie', o.x, o.y);
    Lehcim.play(points === 2 ? 'eat' : 'globShot');
    if (globsLeft() === 0) setStatus('Tous les globules sont détruits : sors du labyrinthe !');
  }

  function checkContacts() {
    var sp = shipPos(), j;
    for (j = lv.globs.length - 1; j >= 0; j--) if (dist2(lv.globs[j], sp) < 0.4) killGlob(j, 2);
    for (j = 0; j < lv.snakes.length; j++) {
      if (dist2(lv.snakes[j], sp) < 0.3) { shipDies('snake', lv.snakes[j]); return; }
    }
  }

  function globEscaped(o) {
    addFx('globFace', o.cx - DX[lv.maze.exit.dir], o.cy - DY[lv.maze.exit.dir], null, true);
    Lehcim.play('escape');
    loseLife("Un globule s'est sauvé !", 40);
  }

  function shipDies(why, snake) {
    var sp = shipPos();
    addFx('shipBoom', sp.x, sp.y);
    if (snake) addFx('snakeFace', sp.x, sp.y, null, true);
    Lehcim.play('boom');
    lv.shipDead = true;
    loseLife(why === 'time' ? 'Le temps est écoulé ! Tu es mort !' : 'Tu es mort !', 40);
  }

  // Ends the level after a short animation, then shows the message.
  function loseLife(text, delay) {
    if (state !== 'play') return;
    state = 'dying'; lv.endTimer = delay; lv.endText = text;
    stopDark();
  }

  function addFx(kind, x, y, dir, hold) {
    lv.fx.push({ kind: kind, x: x, y: y, dir: dir, k: 0, hold: !!hold });
  }
  function fxFrames(f) {
    var c = lv.z.cols;
    switch (f.kind) {
      case 'wall': return c;
      case 'globDie': case 'snakeDie': case 'shipBoom': case 'warp': return c - 1;
      default: return c;   // faces
    }
  }

  function step() {
    tickCount++;
    if (!lv || paused || dialogOpen()) return;
    var i;
    // Effects (2 ticks per frame); "hold" effects stay on their last frame.
    for (i = lv.fx.length - 1; i >= 0; i--) {
      var f = lv.fx[i]; f.k++;
      if (f.k >= fxFrames(f) * 2 && !f.hold) lv.fx.splice(i, 1);
    }
    if (state === 'intro') {
      if (++lv.intro >= 14) { state = 'play'; setStatus('Niveau ' + game.level + ' : détruis tous les globules !'); }
      return;
    }
    if (state === 'dying') {
      if (--lv.endTimer <= 0) { state = 'wait'; afterLifeLost(lv.endText); }
      return;
    }
    if (state === 'exiting') {
      if (++lv.endTimer >= 30) { state = 'wait'; levelDone(); }
      return;
    }
    if (state !== 'play') return;

    updateShip();
    if (state !== 'play') return;
    updateEggs();
    updateGlobs();
    if (state !== 'play') return;
    updateSnakes();
    updateBullets();
    checkContacts();
    if (state !== 'play') return;
    if (lv.barrier > 0) lv.barrier--;
    lv.timeLeft--;
    if (lv.timeLeft === Math.round(DARK_TIME * 1000 / TICK)) startDark();
    if (lv.timeLeft <= 0) shipDies('time');
  }

  function afterLifeLost(text) {
    game.lives--;
    Lehcim.message(text).then(function () {
      if (game.lives <= 0) gameOver();
      else startLevel();
    });
  }

  function levelDone() {
    var n = game.level;
    Lehcim.message('Bravo ! Tu es sorti du niveau ' + n + ' .\nScore : ' + game.score).then(function () {
      game.level++;
      startLevel();
    });
  }

  function gameOver() {
    state = 'idle'; lv = null;
    setStatus('La partie est terminée .');
    var sc = game.score;
    var p = scores.qualifies(sc)
      ? Lehcim.prompt('Tu fais partie des meilleurs ! Ecris ton nom .\n( 14 caractères maximum )', 14).then(function (name) { scores.add(name.slice(0, 14) || 'bip-bip', sc); })
      : Lehcim.message('La partie est terminée .\nScore : ' + sc);
    p.then(function () { showScores('La partie est terminée .'); });
  }

  function abandon() {
    if (!game || state === 'idle') return;
    Lehcim.message('Abandonner la partie en cours ?', ['Oui', 'Non']).then(function (i) {
      if (i !== 0) return;
      stopDark(); state = 'wait';
      gameOver();
    });
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

  // Original WAVE resources (numbers = resource ids; their use is a guess from length/shape).
  var SND = {
    shot: 'assets/sounds/1.wav', escape: 'assets/sounds/2.wav', boom: 'assets/sounds/3.wav',
    barrier: 'assets/sounds/4.wav', eat: 'assets/sounds/5.wav', globShot: 'assets/sounds/6.wav',
    exit: 'assets/sounds/7.wav', snakeDie: 'assets/sounds/8.wav', egg: 'assets/sounds/9.wav'
  };
  // Browsers only allow audio after a user gesture: load the sounds then.
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  // The two long (21 s) sounds accompany the last 20 seconds, when the maze is invisible.
  function startDark() {
    stopDark();
    if (Lehcim.isMuted()) return;
    try {
      var a = new Audio('assets/sounds/' + (game.level % 2 ? 10 : 11) + '.wav');
      a.volume = 0.6; lv.darkSound = a;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay refused */ });
    } catch (e) { /* ignore */ }
  }
  function stopDark() {
    if (lv && lv.darkSound) { try { lv.darkSound.pause(); } catch (e) { /* ignore */ } lv.darkSound = null; }
  }

  // ---------- Drawing ----------

  function draw() {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    if (!sheetsReady) return;
    if (lv) drawLevel(); else drawTitle();
    drawPanel();
    if (paused && lv) banner('PAUSE');
  }

  function drawTitle() {
    // Demo background: a 40-pixel maze kept between games.
    if (!drawTitle.m) drawTitle.m = makeMaze(14, 10);
    var m = drawTitle.m, z = ZOOMS[40];
    for (var y = 0; y < m.rows; y++) for (var x = 0; x < m.cols; x++) {
      var t = TILE[m.walls[y * m.cols + x]];
      g.drawImage(maze, t[0] * 40, z.tileY + t[1] * 40, 40, 40, x * 40, y * 40, 40, 40);
    }
    var f = (tickCount >> 1) % z.cols;
    g.drawImage(maze, z.ship + f * 24, U * 24, 24, 24, 268, 228, 24, 24);
    g.drawImage(creatures, z.glob + ((tickCount >> 1) % 10) * 24, R * 24, 24, 24, 188, 148, 24, 24);
    g.drawImage(creatures, z.snake + ((tickCount >> 1) % 10) * 24, L * 24, 24, 24, 388, 108, 24, 24);
    banner('LabRaph', 'Clique sur « Nouvelle partie »');
  }

  function banner(big, small) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 160, MAZE_W, small ? 80 : 60);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold italic 34px "Times New Roman", serif'; g.fillStyle = '#ffd34d';
    g.fillText(big, MAZE_W / 2, 190);
    if (small) { g.font = '15px "Times New Roman", serif'; g.fillStyle = '#fff'; g.fillText(small, MAZE_W / 2, 224); }
    g.restore();
  }

  function cx2px(x) { return lv.ox + (x + 0.5) * lv.T; }
  function cy2px(y) { return lv.oy + (y + 0.5) * lv.T; }

  // Draws a square sprite of size s centred on a cell position.
  function spr(img, sx, sy, s, x, y) {
    g.drawImage(img, sx, sy, s, s, Math.round(cx2px(x) - s / 2), Math.round(cy2px(y) - s / 2), s, s);
  }

  function drawLevel() {
    var z = lv.z, T = lv.T, m = lv.maze, s = z.s, x, y;
    var dark = state === 'play' && lv.timeLeft <= DARK_TIME * 1000 / TICK;
    // Floor and walls (during the intro the floor tiles grow from the centre of each cell).
    for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
      var px = lv.ox + x * T, py = lv.oy + y * T;
      if (state === 'intro' && lv.intro < 10) {
        var f = Math.min(4, lv.intro >> 1);
        g.drawImage(maze, f * T, z.growY, T, T, px, py, T, T);
      } else {
        var t = TILE[dark ? 0 : m.walls[y * m.cols + x]];
        g.drawImage(maze, t[0] * T, z.tileY + t[1] * T, T, T, px, py, T, T);
      }
    }
    if (state === 'intro') { banner('Niveau ' + game.level); return; }
    // Barrier in front of the exit.
    if (lv.barrier > 0) drawBarrier();
    // Eggs (same picture for both kinds: only the distance at which they open differs).
    lv.eggs.forEach(function (e) {
      var col = e.open < 0 ? 0 : Math.min(z.cols - 2, e.open >> 1);
      spr(e.kind === 'glob' ? creatures : creatures, (e.kind === 'glob' ? z.glob : z.snake) + col * s, ROW_EGG * s, s, e.x, e.y);
    });
    lv.globs.forEach(function (o) {
      var row = o.dir >= 0 ? o.dir : o.last;
      spr(creatures, z.glob + ((o.anim >> 1) % z.cols) * s, row * s, s, o.x, o.y);
    });
    lv.bullets.forEach(function (b) {
      var bb = z.bullet;
      g.drawImage(maze, bb[0], bb[1], bb[2], bb[2], Math.round(cx2px(b.x) - bb[2] / 2), Math.round(cy2px(b.y) - bb[2] / 2), bb[2], bb[2]);
    });
    if (!lv.shipDead) drawShip();
    lv.snakes.forEach(function (n) {
      spr(creatures, z.snake + ((n.anim >> 1) % z.cols) * s, n.face * s, s, n.x, n.y);
    });
    lv.fx.forEach(drawFx);
    if (dark && (lv.timeLeft >> 2) % 2 === 0 && lv.timeLeft > DARK_TIME * 1000 / TICK - 40) {
      g.save(); g.font = 'bold 16px "Times New Roman", serif'; g.fillStyle = '#ff4040'; g.textAlign = 'center';
      g.fillText('Le labyrinthe devient invisible !', MAZE_W / 2, 20); g.restore();
    }
  }

  function drawShip() {
    var z = lv.z, s = z.s, sh = lv.ship, pos = shipPos(), sx, sy;
    if (state === 'exiting') {
      // Warp frames (drawn pointing right) rotated towards the exit direction.
      var k = Math.min(z.cols - 2, lv.endTimer >> 1), d = lv.maze.exit.dir;
      var ex = lv.maze.exit.x + DX[d] * (lv.endTimer / 30), ey = lv.maze.exit.y + DY[d] * (lv.endTimer / 30);
      g.save();
      g.translate(Math.round(cx2px(ex)), Math.round(cy2px(ey)));
      g.rotate((d - R) * Math.PI / 2);
      g.drawImage(maze, z.ship + k * s, ROW_WARP * s, s, s, -s / 2, -s / 2, s, s);
      g.restore();
      return;
    }
    if (sh.turn) {
      var cw = sh.turn.to === (sh.turn.from + 1) % 4;
      sy = (cw ? TURN_CW : TURN_CCW)[sh.turn.from] * s;
      sx = z.ship + Math.min(z.rot - 1, Math.floor(sh.turn.k * z.rot / TURN_TICKS)) * s;
    } else {
      sy = sh.face * s;
      sx = z.ship + ((sh.anim >> 1) % z.cols) * s;
    }
    spr(maze, sx, sy, s, pos.x, pos.y);
  }

  function drawFx(f) {
    var z = lv.z, s = z.s, n = fxFrames(f), k = Math.min(n - 1, f.k >> 1);
    switch (f.kind) {
      case 'wall': {
        // Bullet hitting a wall: rows 1..4 = up, right, down, left.
        var off = (lv.T - s) / 2 / lv.T;
        g.drawImage(maze, z.fx[0] + k * s, z.fx[1] + (1 + f.dir) * s, s, s,
          Math.round(cx2px(f.x + DX[f.dir] * off) - s / 2), Math.round(cy2px(f.y + DY[f.dir] * off) - s / 2), s, s);
        break;
      }
      case 'globDie': spr(creatures, z.glob + k * s, ROW_DIE * s, s, f.x, f.y); break;
      case 'snakeDie': spr(creatures, z.snake + k * s, ROW_DIE * s, s, f.x, f.y); break;
      case 'shipBoom': spr(maze, z.ship + k * s, ROW_EXPLODE * s, s, f.x, f.y); break;
      case 'globFace': spr(creatures, z.glob + k * s, ROW_FACE * s, s, f.x, f.y); break;
      case 'snakeFace':
        if (f.k >= (z.cols - 1) * 2) spr(creatures, z.snake + Math.min(z.cols - 1, (f.k >> 1) - (z.cols - 1)) * s, ROW_FACE * s, s, f.x, f.y);
        break;
    }
  }

  function drawBarrier() {
    var e = lv.maze.exit, T = lv.T, h = Math.round(T * 1.2), w = Math.round(h * BARRIER[2] / BARRIER[3]);
    var px = cx2px(e.x) + DX[e.dir] * (T / 2 - w / 2), py = cy2px(e.y) + DY[e.dir] * (T / 2 - w / 2);
    g.save(); g.translate(Math.round(px), Math.round(py));
    if (e.dir === U || e.dir === D) g.rotate(Math.PI / 2);
    if ((lv.barrier > 15 || (lv.barrier >> 1) % 2)) g.drawImage(maze, BARRIER[0], BARRIER[1], BARRIER[2], BARRIER[3], -w / 2, -h / 2, w, h);
    g.restore();
  }

  function drawPanel() {
    g.drawImage(maze, PANEL[0], PANEL[1], PANEL[2], PANEL[3], PANEL_X, 0, PANEL[2], PANEL[3]);
    if (!game) return;
    var vals = {
      level: game.level, lives: game.lives, globs: lv ? globsLeft() : 0, bullets: game.bullets,
      time: lv ? Math.max(0, Math.ceil(lv.timeLeft * TICK / 1000)) : 0, score: game.score
    };
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 13px "Times New Roman", serif';
    BOXES.forEach(function (b) {
      g.fillStyle = b[0] === 'time' && lv && vals.time <= DARK_TIME ? '#ff4040' : b[2];
      g.fillText(String(vals[b[0]]), PANEL_X + 32, b[1]);
    });
    g.restore();
  }

  // ---------- Toolbar / page ----------

  function setStatus(t) { statusEl.textContent = t; }
  function togglePause() {
    if (!lv || state === 'idle' || state === 'wait') return;
    paused = !paused; updatePauseButton();
    if (lv.darkSound) { try { if (paused) lv.darkSound.pause(); else lv.darkSound.play().catch(function () {}); } catch (e) { /* ignore */ } }
  }
  function updatePauseButton() { document.getElementById('pause').textContent = paused ? 'Reprendre' : 'Pause'; }

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
