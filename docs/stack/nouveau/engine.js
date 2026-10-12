/*
 * Stack - engine of the "nouvelle version" (no DOM, also runs in node).
 * The rules are those of the original program, shared with the original
 * port: ../engine.js (StackSim, 40 ms ticks, integer coordinates). This file
 * adds what the new version needs around it:
 *  - a seeded random generator (mulberry32), so that a game is fully
 *    reproducible from its seed and its inputs;
 *  - a fixed-step accumulator (one tick = 40 ms, as the original timer);
 *  - the prediction of the marble trajectories through the pins and bars
 *    (deterministic next to a bar, a fork where the original draws at random);
 *  - a hash of the state for the determinism tests.
 */
(function (root) {
  'use strict';

  var SS = root.StackSim || (typeof require === 'function' ? require('../engine.js') : null);

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

  function create(opts) {
    opts = opts || {};
    var rng = mulberry32(1);
    var acc = 0;
    var stats = { matches: 0, landed: 0, crashes: 0 };
    var sim = SS.create({
      random: function () { return rng(); },
      onSound: opts.onSound,
      onEvent: function (type, a) {
        if (type === 'match') stats.matches++;
        else if (type === 'land') stats.landed++;
        else if (type === 'crash') stats.crashes++;
        if (opts.onEvent) opts.onEvent(type, a);
      }
    });
    var S = sim.S;
    var seed = 1;

    function newGame(o) {
      o = o || {};
      seed = seedFrom(o.seed != null ? o.seed : 1);
      rng = mulberry32(seed);
      acc = 0;
      stats.matches = 0; stats.landed = 0; stats.crashes = 0;
      sim.newGame(o.level || 1);
    }

    // Advances real time by fixed 40 ms ticks. beforeTick (optional) runs
    // before every tick: held buttons, scripted inputs, replays.
    function advance(realDt, beforeTick) {
      if (!S.playing) { acc = 0; return 0; }
      acc += Math.min(0.25, Math.max(0, realDt));
      var n = 0;
      while (acc >= SS.TICK - 1e-9 && S.playing) {
        if (beforeTick) beforeTick(S);
        sim.tick(); acc -= SS.TICK; n++;
      }
      if (!S.playing) acc = 0;
      return n;
    }

    // ---------- Trajectories ----------

    // Side taken on pin row r by a marble at x, with the bars as they are now:
    // -1 left, +1 right, 0 random (no bar next to it).
    function sideAt(r, x) {
      var g = Math.floor((x + 8 + 24 - 158 - 12 * (6 - r)) / 24), b = S.bars[r].pos;
      if (b === g) return -1;
      if (b + 1 === g) return 1;
      return 0;
    }

    // Tree of the possible paths of a marble: {pts: [[x,y]...], end: {col, y, h, match, deadly}, fork: [left, right]}
    // Coordinates are the top-left corner of the marble sprite.
    function pathFrom(x, y, c, nextRow) {
      var node = { pts: [[x, y]] };
      for (var r = nextRow; r <= 6; r++) {
        var yr = 40 + 24 * (r - 1);
        node.pts.push([x, yr]);
        var s = sideAt(r, x);
        if (s === 0) {
          node.fork = [pathFrom(x - 12, yr + 12, c, r + 1), pathFrom(x + 12, yr + 12, c, r + 1)];
          node.fork[0].pts.unshift([x, yr]); node.fork[1].pts.unshift([x, yr]);
          return node;
        }
        x += 12 * s;
        node.pts.push([x, yr + 12]);
      }
      var col = Math.floor((x - 138) / 24), C = S.cols[col], h = C ? C.h : 0;
      var match = h > 0 && C.colors[h] === c;
      var yEnd = 384 - 20 * (match ? h : h + 1);
      node.pts.push([x, yEnd]);
      node.end = { col: col, x: x, y: yEnd, h: h, match: match, deadly: !match && h + 1 >= 7 };
      return node;
    }

    function predict(m) {
      var x = m.x, y = m.y, row;
      if (m.state === 1) {
        // finish the current roll first
        var s = m.dir === 0 ? 1 : -1, steps = [[4, 0], [3, 2], [3, 3], [2, 3], [0, 4]];
        for (var k = m.sub; k < 5; k++) { x += s * steps[k][0]; y += steps[k][1]; }
        row = m.row + 1;
      } else row = y <= 40 ? 1 : Math.floor((y - 40) / 24) + 2;
      return pathFrom(x, y, m.c, row);
    }
    // path of the marble that the dispenser will release next
    function predictNext() { return pathFrom(SS.DROP_X, SS.DROP_Y, S.next, 1); }

    function hash() {
      var s = [S.score, S.chose.lives, S.vitesse, S.chose.x, S.chose.speed,
        S.cols.map(function (c) { return c.colors.slice(1, c.h + 1).join(''); }).join(','),
        S.marbles.map(function (m) { return m.x + ':' + m.y + ':' + m.c; }).join(','),
        S.bars.slice(1).map(function (b) { return b.x; }).join(',')].join('|');
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(16);
    }

    return {
      sim: sim, S: S, stats: stats, newGame: newGame, advance: advance, tick: sim.tick,
      click: sim.click, moveBar: sim.moveBar, canMove: sim.canMove, boost: sim.boost, abandon: sim.abandon,
      predict: predict, predictNext: predictNext, sideAt: sideAt, hash: hash,
      seed: function () { return seed; }
    };
  }

  var api = { create: create, mulberry32: mulberry32, seedFrom: seedFrom, Sim: SS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StackEngine = api;
})(this);
