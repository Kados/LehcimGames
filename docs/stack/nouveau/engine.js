/*
 * Stack - simulation engine of the "nouvelle version" (no DOM, also runs in node).
 * Same rules as the original port (docs/stack/game.js), with:
 *  - a seeded random generator (mulberry32) and a fixed time step (1/120 s),
 *    so that a game is fully reproducible from its seed and inputs;
 *  - a smoother difficulty curve (15 levels, interval 2.6 x 0.9^(level-1),
 *    colours arriving one every two levels);
 *  - fair spawning: predictColumn() follows the deterministic deflections
 *    through the 4 doors and the spawner avoids columns whose LANDING pile
 *    (not the starting one) would overflow into the lane;
 *  - the overflow fix: when the "chose" hits a pile, everything from the lane
 *    row up is removed (the row-7 marble no longer drops back into the lane);
 *  - door moves are buffered for 0.3 s when a marble is in the way instead of
 *    being cancelled at once.
 */
(function (root) {
  'use strict';

  // ---------- Layout (same coordinates as the original 640x480 board) ----------

  var CELL = 20, COLS = 20;
  var FX = 40, FY = 40, FW = COLS * CELL, FB = 460;
  var DOOR_TOPS = [70, 125, 180, 235];
  var DOOR_START = [9, 3, 14, 7];
  var LANE_Y = 320, LANE_ROW = 6, MAX_STACK = 8;
  var CHOSE_W = 146, CHOSE_H = 24, TUNNEL = 100;
  var NCOLORS = 7, MAX_LEVEL = 15, POINTS_PER_LEVEL = 50;
  var STEP = 1 / 120;          // fixed simulation step
  var APPEAR_T = 0.45, DEAD_T = 1.8, GRACE_T = 1.5, DOOR_BUFFER = 0.3;

  function stackY(k) { return FB - CELL - CELL * k; }
  function colX(c) { return FX + c * CELL; }

  // ---------- Seeded RNG ----------

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFrom(v) {
    if (typeof v === 'number' && isFinite(v)) return v >>> 0;
    var s = String(v == null ? '' : v), h = 2166136261;
    if (/^\d+$/.test(s)) return parseInt(s, 10) >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- Difficulty curve ----------

  function nColors(level) { return Math.min(NCOLORS, 3 + Math.floor((level - 1) / 2)); }
  function spawnInterval(level) { return Math.max(0.6, 2.6 * Math.pow(0.9, level - 1)); }
  function fallSpeed(level) { return level <= 9 ? 70 + 10 * level : 160 + 5 * (level - 9); }
  function choseBase(level) { return 1 + Math.floor((level - 1) / 2); }
  function levelFor(score) { return Math.min(MAX_LEVEL, 1 + Math.floor(score / POINTS_PER_LEVEL)); }

  function create(opts) {
    opts = opts || {};
    var emit = opts.onEvent || function () {};
    var rng = mulberry32(1);
    var acc = 0;

    var G = {
      state: 'idle', seed: 1,
      score: 0, lives: 3, level: 1, startLevel: 1,
      stacks: [], marbles: [], doors: [], fx: [],
      chose: { x: FX + FW, alive: true, deadT: 0, frame: 0, ft: 0, grace: 0 },
      spawnT: 0, fast: false, time: 0, ticks: 0,
      stats: { spawned: 0, matches: 0, hits: 0, bursts: 0 }
    };

    function rnd(n) { return Math.floor(rng() * n); }
    function choseSpeed() { return (26 + 6 * choseBase(G.level)) * (G.fast ? 4 : 1); }

    function resetBoard() {
      G.stacks = []; for (var c = 0; c < COLS; c++) G.stacks.push([]);
      G.marbles = []; G.fx = [];
      G.doors = DOOR_TOPS.map(function (t, i) {
        return { top: t, col: DOOR_START[i], x: colX(DOOR_START[i]), target: DOOR_START[i], stepT: 0, blockT: 0 };
      });
    }

    function newGame(o) {
      o = o || {};
      G.seed = seedFrom(o.seed != null ? o.seed : 1);
      rng = mulberry32(G.seed);
      acc = 0;
      G.startLevel = Math.max(1, Math.min(MAX_LEVEL, o.level || 1));
      G.level = G.startLevel;
      G.score = (G.startLevel - 1) * POINTS_PER_LEVEL;
      G.lives = 3;
      resetBoard();
      G.chose = { x: FX + FW, alive: true, deadT: 0, frame: 0, ft: 0, grace: 0 };
      G.spawnT = 0.6; G.state = 'play'; G.fast = false; G.time = 0; G.ticks = 0;
      G.stats = { spawned: 0, matches: 0, hits: 0, bursts: 0 };
    }

    // ---------- Deterministic deflection ----------

    // Column where a marble currently in column `col`, above height `y`
    // (default: the top of the board), will land with the doors as they are now.
    function predictColumn(col, y) {
      if (y == null) y = FY;
      for (var i = 0; i < G.doors.length; i++) {
        var d = G.doors[i], yy = d.top - CELL;
        if (yy < y - 0.001) continue;
        if (col === d.col || col === d.col + 1) col = deflect(d, col);
      }
      return col;
    }
    function deflect(d, col) {
      var to = col === d.col ? d.col - 1 : d.col + 2;
      if (to < 0) to = d.col + 2;
      if (to >= COLS) to = d.col - 1;
      return to;
    }

    // Path of a moving marble: list of [x, y] points (top-left of the marble)
    // through the doors down to the top of its landing pile.
    function predictPath(m) {
      var pts = [[m.x, m.y]], col = m.col, y = m.y, first = 0;
      if (m.state === 'roll') {
        var dr = G.doors[m.door];
        col = m.to; y = dr.top - CELL + 40;
        pts.push([colX(col), y]);
        first = m.door + 1;
      }
      for (var i = first; i < G.doors.length; i++) {
        var d = G.doors[i], yy = d.top - CELL;
        if (yy < y - 0.001) continue;
        if (col === d.col || col === d.col + 1) {
          var to = deflect(d, col);
          pts.push([colX(col), yy]);
          pts.push([colX(to), yy + 40]);
          col = to; y = yy + 40;
        }
      }
      var h = G.stacks[col].length;
      pts.push([colX(col), stackY(Math.min(h, MAX_STACK))]);
      return { points: pts, col: col, height: h };
    }

    // Number of marbles already in flight that will land in each column.
    function inFlight() {
      var n = []; for (var c = 0; c < COLS; c++) n.push(0);
      G.marbles.forEach(function (m) { if (!m.dead) n[predictPath(m).col]++; });
      return n;
    }

    // ---------- Marbles ----------

    function spawnMarble() {
      var color = rnd(nColors(G.level));
      // fair spawn: only columns whose landing pile stays out of the lane
      // (counting marbles already falling there), unless the marble would
      // match the top of that pile and so lower it
      var fly = inFlight(), ok = [];
      for (var c = 0; c < COLS; c++) {
        var land = predictColumn(c), st = G.stacks[land], h = st.length + fly[land];
        var matches = fly[land] === 0 && st.length > 0 && st[st.length - 1].color === color;
        if (h < LANE_ROW || matches) ok.push(c);
      }
      var col = ok.length ? ok[rnd(ok.length)] : rnd(COLS);
      G.marbles.push({ col: col, x: colX(col), y: FY, color: color, state: 'appear', t: 0, dist: 0 });
      G.score++; G.stats.spawned++;
      emit('spawn', { x: colX(col), y: FY, col: col });
      var lv = levelFor(G.score);
      if (lv > G.level) { G.level = lv; emit('level', lv); }
    }

    function stepMarble(m, dt) {
      var v = fallSpeed(G.level);
      if (m.state === 'appear') {
        m.t += dt;
        if (m.t >= APPEAR_T) { m.state = 'fall'; m.t = 0; }
        return;
      }
      if (m.state === 'roll') {
        var d = G.doors[m.door];
        m.t += v * dt / 40;
        if (m.t >= 1) m.t = 1;
        m.x = colX(m.from) + (colX(m.to) - colX(m.from)) * m.t;
        m.y = d.top - CELL + 40 * m.t;
        m.dist += v * dt * 1.2;
        if (m.t >= 1) { m.col = m.to; m.x = colX(m.to); m.state = 'fall'; }
        return;
      }
      var ny = m.y + v * dt;
      m.dist += v * dt;
      for (var i = 0; i < G.doors.length; i++) {
        var dr = G.doors[i], yy = dr.top - CELL;
        if (m.y < yy + 0.001 && ny >= yy && (m.col === dr.col || m.col === dr.col + 1)) {
          m.state = 'roll'; m.door = i; m.from = m.col; m.to = deflect(dr, m.col); m.t = 0; m.y = yy;
          emit('roll');
          return;
        }
      }
      var st = G.stacks[m.col], h = st.length, top = stackY(h);
      if (ny >= top) {
        if (h >= MAX_STACK) {
          m.dead = true; G.stats.bursts++;
          addFx('burst', m.x - 3, top - 4);
          emit('burst', { x: m.x, y: top });
          return;
        }
        if (h > 0 && st[h - 1].color === m.color) {
          var other = st.pop();
          m.dead = true; G.stats.matches++;
          addFx('vanish', m.x, top, m.color, m.dist);
          addFx('vanish', m.x, stackY(h - 1), other.color, other.frame * 4);
          emit('match', { x: m.x, y: stackY(h - 1), color: m.color });
          return;
        }
        st.push({ color: m.color, frame: Math.floor(m.dist / 4) % 36 });
        m.dead = true;
        emit('land', { x: m.x, y: top, col: m.col });
        return;
      }
      m.y = ny;
    }

    // ---------- Doors ----------

    function doorBlocked(i, newCol) {
      var d = G.doors[i];
      for (var k = 0; k < G.marbles.length; k++) {
        var m = G.marbles[k];
        if (m.dead) continue;
        if (m.state === 'roll' && m.door === i) return true;
        if (m.y + CELL > d.top - CELL + 1 && m.y < d.top + 40) {
          var c0 = Math.floor((m.x - FX) / CELL), c1 = Math.ceil((m.x - FX) / CELL);
          if (c0 === newCol || c0 === newCol + 1 || c1 === newCol || c1 === newCol + 1) return true;
        }
      }
      return false;
    }

    function stepDoors(dt) {
      G.doors.forEach(function (d, i) {
        var tx = colX(d.col);
        if (d.x !== tx) {
          var s = 240 * dt;
          d.x = Math.abs(tx - d.x) <= s ? tx : d.x + (tx > d.x ? s : -s);
        }
        if (d.target === d.col || d.x !== tx) { d.blockT = 0; return; }
        d.stepT -= dt;
        if (d.stepT > 0) return;
        var nc = d.col + (d.target > d.col ? 1 : -1);
        if (nc < 0 || nc > COLS - 2) { d.target = d.col; return; }
        if (doorBlocked(i, nc)) {
          // input buffering: keep trying for a short while instead of dropping the order
          d.blockT += dt;
          if (d.blockT > DOOR_BUFFER) { d.target = d.col; d.blockT = 0; emit('blocked', i); }
          return;
        }
        d.blockT = 0;
        d.col = nc; d.stepT = 0.02;
        emit('door', i);
      });
    }

    function setDoorTarget(i, col) {
      var d = G.doors[i];
      if (!d) return;
      d.target = Math.max(0, Math.min(COLS - 2, col));
      d.blockT = 0;
    }

    // Original control: click left or right of a door, in its band.
    function doorAt(y) {
      for (var i = 0; i < G.doors.length; i++) {
        var d = G.doors[i];
        if (y >= d.top - 10 && y < d.top + 50) return i;
      }
      return -1;
    }
    function clickAt(p) {
      if (G.state !== 'play') return -1;
      if (p.x < FX || p.x >= FX + FW) return -1;
      var c = Math.floor((p.x - FX) / CELL), i = doorAt(p.y);
      if (i < 0) return -1;
      var d = G.doors[i];
      if (c < d.col) setDoorTarget(i, c);
      else if (c > d.col + 1) setDoorTarget(i, c - 1);
      return i;
    }

    // ---------- The "chose" ----------

    function hitChose(cx, cy) {
      var ch = G.chose;
      ch.alive = false; ch.deadT = 0;
      G.lives--; G.stats.hits++;
      addFx('burst', cx - 3, cy - 4);
      for (var k = 0; k < 5; k++) addFx('dust', ch.x + 8 + k * 28, LANE_Y - 4, null, 0, k * 0.07);
      emit('crash', { x: cx, y: cy, lives: G.lives });
    }

    function stepChose(dt) {
      var ch = G.chose;
      if (!ch.alive) {
        ch.deadT += dt;
        if (ch.deadT >= DEAD_T) {
          if (G.lives <= 0) { G.state = 'over'; G.fast = false; emit('over', { score: G.score }); return; }
          ch.alive = true; ch.x = FX + FW; ch.grace = GRACE_T;
        }
        return;
      }
      ch.ft += dt * (G.fast ? 3 : 1);
      if (ch.ft > 0.07) { ch.ft = 0; ch.frame = (ch.frame + 1) % 18; }
      ch.x -= choseSpeed() * dt;
      if (ch.x + CHOSE_W < FX - TUNNEL) ch.x = FX + FW;
      var x0 = ch.x + 3, x1 = ch.x + CHOSE_W - 3;
      if (ch.grace > 0) { ch.grace -= dt; return; }
      if (x1 < FX || x0 > FX + FW) return;
      for (var c = 0; c < COLS; c++) {
        var st = G.stacks[c];
        if (st.length > LANE_ROW && colX(c) + 17 > x0 && colX(c) + 3 < x1) {
          // overflow fix: clear the whole part of the pile from the lane up
          var removed = st.splice(LANE_ROW);
          for (var k = 1; k < removed.length; k++) addFx('vanish', colX(c), stackY(LANE_ROW + k), removed[k].color, removed[k].frame * 4);
          hitChose(colX(c), LANE_Y);
          return;
        }
      }
      for (var j = 0; j < G.marbles.length; j++) {
        var m = G.marbles[j];
        if (m.dead || m.state === 'appear') continue;
        if (m.y + CELL > LANE_Y + 4 && m.y < LANE_Y + CELL - 4 && m.x + 17 > ch.x + 20 && m.x + 3 < ch.x + 126) {
          m.dead = true;
          hitChose(m.x, m.y);
          return;
        }
      }
    }

    // ---------- Effects (sprite animations of the original) ----------

    function addFx(type, x, y, color, dist, delay) {
      G.fx.push({ type: type, x: x, y: y, color: color, dist: dist || 0, t: -(delay || 0) });
    }
    function stepFx(dt) {
      for (var i = 0; i < G.fx.length; i++) G.fx[i].t += dt;
      G.fx = G.fx.filter(function (f) { return f.type === 'vanish' ? f.t < 0.62 : f.t < 13 * 0.06; });
    }

    // ---------- Main step ----------

    function step(dt) {
      G.time += dt; G.ticks++;
      stepFx(dt);
      if (G.state !== 'play') return;
      stepDoors(dt);
      if (G.chose.alive) {
        G.spawnT -= dt;
        if (G.spawnT <= 0) { spawnMarble(); G.spawnT = spawnInterval(G.level) * (0.75 + rng() * 0.5); }
      }
      for (var i = 0; i < G.marbles.length; i++) if (!G.marbles[i].dead) stepMarble(G.marbles[i], dt);
      stepChose(dt);
      G.marbles = G.marbles.filter(function (m) { return !m.dead; });
    }

    // Advances real time with a fixed step and an accumulator.
    // beforeStep (optional) runs before every tick: scripted inputs / replays.
    function advance(realDt, beforeStep) {
      acc += Math.min(0.1, Math.max(0, realDt));
      var n = 0;
      while (acc >= STEP - 1e-9) { if (beforeStep) beforeStep(G); step(STEP); acc -= STEP; n++; }
      return n;
    }
    // Only the visual effects (pause, countdown).
    function advanceFx(realDt) { G.time += realDt; stepFx(realDt); }

    function abandon() {
      if (G.state !== 'play') return;
      G.lives = 0; G.chose.alive = false; G.state = 'over'; G.fast = false;
      emit('over', { score: G.score, abandoned: true });
    }

    function hash() {
      var s = G.score + '|' + G.lives + '|' + G.level + '|' + G.chose.x.toFixed(3) + '|' +
        G.stacks.map(function (st) { return st.map(function (b) { return b.color; }).join(''); }).join(',') + '|' +
        G.marbles.map(function (m) { return m.col + ':' + m.color + ':' + m.y.toFixed(3); }).join(',') + '|' +
        G.doors.map(function (d) { return d.col; }).join(',');
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    }

    resetBoard();

    return {
      G: G, newGame: newGame, step: step, advance: advance, advanceFx: advanceFx,
      spawnMarble: spawnMarble, stepMarble: stepMarble, predictColumn: predictColumn, predictPath: predictPath,
      setDoorTarget: setDoorTarget, clickAt: clickAt, doorAt: doorAt, abandon: abandon, hash: hash,
      choseSpeed: choseSpeed, setFast: function (on) { G.fast = !!on && G.state === 'play'; }
    };
  }

  var api = {
    create: create, mulberry32: mulberry32, seedFrom: seedFrom,
    nColors: nColors, spawnInterval: spawnInterval, fallSpeed: fallSpeed, choseBase: choseBase, levelFor: levelFor,
    stackY: stackY, colX: colX,
    C: { CELL: CELL, COLS: COLS, FX: FX, FY: FY, FW: FW, FB: FB, DOOR_TOPS: DOOR_TOPS, LANE_Y: LANE_Y, LANE_ROW: LANE_ROW,
      MAX_STACK: MAX_STACK, CHOSE_W: CHOSE_W, CHOSE_H: CHOSE_H, TUNNEL: TUNNEL, NCOLORS: NCOLORS, MAX_LEVEL: MAX_LEVEL,
      POINTS_PER_LEVEL: POINTS_PER_LEVEL, STEP: STEP, APPEAR_T: APPEAR_T }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StackEngine = api;
})(this);
