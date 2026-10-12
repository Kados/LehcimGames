/*
 * Colours-MIX (nouvelle version) - rules and computer player, without any DOM.
 * Shared by the page (game.js), the Web Worker (ai-worker.js, via importScripts)
 * and node test scripts (module.exports).
 *
 * Board: N x N cells, a black ring (colour 0) around a 14 x 14 coloured centre.
 * Colours are bit masks of the primaries RED = 1, BLUE = 2, YEL = 4.
 * Red (player 0) wants the grey globule to reach the top or bottom band,
 * yellow (player 1) the left or right band.
 */
(function (root) {
  'use strict';

  var N = 16;
  var RED = 1, BLUE = 2, YEL = 4;
  var PRIMARIES = [RED, BLUE, YEL];
  var GREY_STEP_MS = 895;   // mean time of one grey step (420 ms slide + 150..800 ms pause)
  var H_SHORT = 16;         // short horizon of the absorption computation (about 14 s)
  var H_LONG = 40;          // longer horizon, lower weight (about 36 s)

  function idx(c, r) { return r * N + c; }
  function colOf(i) { return i % N; }
  function rowOf(i) { return (i / N) | 0; }
  function isRing(c, r) { return c === 0 || r === 0 || c === N - 1 || r === N - 1; }
  function isCorner(c, r) { return (c === 0 || c === N - 1) && (r === 0 || r === N - 1); }
  function inside(c, r) { return c >= 0 && r >= 0 && c < N && r < N; }
  // 0 = red zone (top / bottom), 1 = yellow zone (left / right)
  function zoneOwner(c, r) { return (r === 0 || r === N - 1) ? 0 : 1; }
  // Colour mixing: XOR of the primaries; a pure colour keeps itself.
  function mix(m, a) { var n = m ^ a; return n === 0 ? a : n; }

  var RING_CELL = new Uint8Array(N * N);
  var RED_EXIT = new Uint8Array(N * N);     // 1 on the top and bottom bands
  var NB = [];                              // 4-neighbours of every cell
  (function () {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var i = idx(c, r), list = [];
      RING_CELL[i] = isRing(c, r) ? 1 : 0;
      RED_EXIT[i] = (r === 0 || r === N - 1) ? 1 : 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        if (inside(c + d[0], r + d[1])) list.push(idx(c + d[0], r + d[1]));
      });
      NB.push(list);
    }
  })();

  // Ring cells in clockwise order.
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

  // Crossing line starting at ring cell s: {id, dc, dr, cells (central), end}.
  // Lines are precomputed once and shared (never mutate them).
  var LINE_AT = [];
  (function () {
    for (var s = 0; s < N * N; s++) {
      var c = colOf(s), r = rowOf(s), dc = 0, dr = 0;
      if (isCorner(c, r) || !isRing(c, r)) { LINE_AT.push(null); continue; }
      if (r === 0) dr = 1; else if (r === N - 1) dr = -1; else if (c === 0) dc = 1; else dc = -1;
      var cells = [];
      for (var k = 1; k < N - 1; k++) cells.push(idx(c + dc * k, r + dr * k));
      LINE_AT.push({ id: dc ? 'r' + r : 'c' + c, start: s, dc: dc, dr: dr, cells: cells,
        end: idx(c + dc * (N - 1), r + dr * (N - 1)) });
    }
  })();
  function lineFrom(s) { return LINE_AT[s] || null; }

  // Starting cells of all legal crossings for a globule whose previous line is
  // 'lastLine', the other globule standing on 'other', the grey globule on the
  // cells of 'greyBlock' (one cell, two while it slides).
  function legalLines(pyr, lastLine, other, greyBlock) {
    var out = [];
    for (var n = 0; n < RING.length; n++) {
      var s = RING[n];
      if (s === other) continue;
      var L = LINE_AT[s];
      if (!L || L.id === lastLine || L.end === other) continue;
      var ok = true;
      for (var j = 0; j < L.cells.length && ok; j++) {
        var x = L.cells[j];
        if (pyr[x] || greyBlock.indexOf(x) >= 0) ok = false;
      }
      if (ok) out.push(L);
    }
    return out;
  }

  function applyLine(colors, L, app) {
    var out = new Uint8Array(colors);
    for (var k = 0; k < L.cells.length; k++) out[L.cells[k]] = mix(out[L.cells[k]], app);
    return out;
  }

  // ---------- Grey globule: region and absorption probabilities ----------

  var bfsSeen = new Int32Array(N * N), bfsStamp = 0;
  var bfsQueue = new Int16Array(N * N);

  // Region the grey globule can roam from the start cells (cells of the same
  // colour connected to them, without pyramid), its free exits, and the smallest
  // distances to the red / yellow bands. 'influence' (optional Uint8Array) is set
  // to 1 on the region and on its interior neighbours: a crossing that touches
  // none of these cells cannot change the region.
  function region(colors, pyr, starts, occA, occB, influence) {
    bfsStamp++;
    var head = 0, tail = 0, exitR = 0, exitY = 0, minR = 99, minY = 99;
    for (var s = 0; s < starts.length; s++) {
      if (bfsSeen[starts[s]] !== bfsStamp) { bfsSeen[starts[s]] = bfsStamp; bfsQueue[tail++] = starts[s]; }
    }
    while (head < tail) {
      var i = bfsQueue[head++], c = colOf(i), r = rowOf(i);
      if (influence) influence[i] = 1;
      if (r - 1 < minR) minR = r - 1;
      if (N - 2 - r < minR) minR = N - 2 - r;
      if (c - 1 < minY) minY = c - 1;
      if (N - 2 - c < minY) minY = N - 2 - c;
      var nb = NB[i];
      for (var k = 0; k < nb.length; k++) {
        var j = nb[k];
        if (RING_CELL[j]) {
          if (bfsSeen[j] !== bfsStamp) {
            bfsSeen[j] = bfsStamp;
            if (j !== occA && j !== occB) { if (RED_EXIT[j]) exitR++; else exitY++; }
          }
          continue;
        }
        if (influence) influence[j] = 1;
        if (bfsSeen[j] === bfsStamp || pyr[j] || colors[j] !== colors[i]) continue;
        bfsSeen[j] = bfsStamp; bfsQueue[tail++] = j;
      }
    }
    return { size: tail, exitR: exitR, exitY: exitY, minR: minR, minY: minY };
  }

  // Probability that the grey globule's random walk reaches a red band / a yellow
  // band within H_SHORT and H_LONG steps. Same rules as the game: at each step it
  // moves uniformly to a free neighbour that is black (ring, not occupied by a
  // globule) or of the same colour without pyramid; it stays put when there is none.
  // starts: cells, mass: their probabilities (default 1 each).
  // exitMass (optional Float64Array): filled with the short-horizon probability of
  // leaving through each ring cell (for the on-screen aid).
  var mCur = new Float64Array(N * N), mNext = new Float64Array(N * N);
  var actCur = new Int16Array(N * N), actNext = new Int16Array(N * N);
  var inNext = new Int32Array(N * N), stepStamp = 0;

  function absorb(colors, pyr, starts, mass, occA, occB, exitMass) {
    var nCur = 0, k, total = 0;
    for (k = 0; k < starts.length; k++) {
      var m0 = mass ? mass[k] : 1;
      if (mCur[starts[k]] === 0) actCur[nCur++] = starts[k];
      mCur[starts[k]] += m0; total += m0;
    }
    var aR = 0, aY = 0, sR = 0, sY = 0, opts = [0, 0, 0, 0];
    for (var t = 1; t <= H_LONG; t++) {
      stepStamp++;
      var nNext = 0;
      for (var a = 0; a < nCur; a++) {
        var i = actCur[a], mi = mCur[i];
        mCur[i] = 0;
        if (mi === 0) continue;
        var nb = NB[i], no = 0, col = colors[i];
        for (k = 0; k < nb.length; k++) {
          var j = nb[k];
          if (RING_CELL[j]) { if (j !== occA && j !== occB) opts[no++] = j; }
          else if (!pyr[j] && colors[j] === col) opts[no++] = j;
        }
        if (no === 0) { opts[0] = i; no = 1; }
        var share = mi / no;
        for (k = 0; k < no; k++) {
          var x = opts[k];
          if (RING_CELL[x] && x !== i) {
            if (RED_EXIT[x]) aR += share; else aY += share;
            if (exitMass && t <= H_SHORT) exitMass[x] += share;
          } else {
            if (inNext[x] !== stepStamp) { inNext[x] = stepStamp; actNext[nNext++] = x; mNext[x] = 0; }
            mNext[x] += share;
          }
        }
      }
      // swap
      var tm = mCur; mCur = mNext; mNext = tm;
      var ta = actCur; actCur = actNext; actNext = ta;
      nCur = nNext;
      if (t === H_SHORT) { sR = aR; sY = aY; }
      if (total - aR - aY < 1e-6 * total) { if (t < H_SHORT) { sR = aR; sY = aY; } break; }
    }
    for (k = 0; k < nCur; k++) mCur[actCur[k]] = 0;
    return { shortR: sR, shortY: sY, longR: aR, longY: aY };
  }

  // Connection cost: how many colour changes (primaries to add or remove) the
  // cells of the cheapest path from the grey globule to a red band / a yellow
  // band still need before the grey can walk it (cells of its own colour cost 0).
  // Gives a direction while the grey is still enclosed, like distances in Hex.
  var POP = [0, 1, 1, 2, 1, 2, 2, 3];
  var cDist = new Int16Array(N * N), cStamp = new Int32Array(N * N), cRun = 0;
  var buckets = [];
  for (var b0 = 0; b0 < 64; b0++) buckets.push([]);
  function connection(colors, pyr, start, occA, occB) {
    cRun++;
    var g = colors[start], cR = 99, cY = 99, top = 0, maxD = 63;
    for (var b = 0; b <= maxD; b++) buckets[b].length = 0;
    cStamp[start] = cRun; cDist[start] = 0; buckets[0].push(start);
    for (var d = 0; d <= maxD && d < Math.max(cR, cY); d++) {
      var B = buckets[d];
      for (var q = 0; q < B.length; q++) {
        var i = B[q];
        if (cDist[i] !== d) continue;
        var nb = NB[i];
        for (var k = 0; k < nb.length; k++) {
          var j = nb[k];
          if (RING_CELL[j]) {
            if (j === occA || j === occB) continue;
            if (RED_EXIT[j]) { if (d < cR) cR = d; } else if (d < cY) cY = d;
            continue;
          }
          if (pyr[j]) continue;
          var nd = d + POP[colors[j] ^ g];
          if (nd > maxD) continue;
          if (cStamp[j] !== cRun || nd < cDist[j]) { cStamp[j] = cRun; cDist[j] = nd; buckets[nd].push(j); }
        }
      }
    }
    return { red: Math.min(cR, 12), yel: Math.min(cY, 12) };
  }

  // Board evaluation from red's point of view.
  //   10 x (P(red) - P(yellow)) within ~14 s, 3 x the same within ~36 s,
  //   + W_CONN x (yellow connection cost - red connection cost),
  //   + 0.05 x (distance to yellow bands - distance to red bands) as a last tie-break.
  var W = { conn: 0.3, worst: 0.55 };
  var STATS = { evals: 0 };
  function evaluate(colors, pyr, starts, occA, occB) {
    STATS.evals++;
    var reg = region(colors, pyr, starts, occA, occB, null);
    var score = 0.05 * (reg.minY - reg.minR);
    if (W.conn) { var cc = connection(colors, pyr, starts[0], occA, occB); score += W.conn * (cc.yel - cc.red); }
    if (reg.exitR + reg.exitY === 0) return score;   // enclosed: nothing to propagate
    var p = absorb(colors, pyr, starts, null, occA, occB, null);
    return score + 10 * (p.shortR - p.shortY) + 3 * (p.longR - p.longY);
  }

  // Detailed analysis for the on-screen aid.
  function analyse(colors, pyr, greyCell, occA, occB) {
    var infl = new Uint8Array(N * N);
    var reg = region(colors, pyr, [greyCell], occA, occB, infl);
    var cells = [];
    var col = colors[greyCell];
    for (var i = 0; i < N * N; i++) if (bfsSeen[i] === bfsStamp && !RING_CELL[i] && colors[i] === col) cells.push(i);
    var exitMass = new Float64Array(N * N);
    var p = (reg.exitR + reg.exitY) ? absorb(colors, pyr, [greyCell], null, occA, occB, exitMass)
      : { shortR: 0, shortY: 0, longR: 0, longY: 0 };
    var exits = [];
    for (var j = 0; j < N * N; j++) if (exitMass[j] > 0) exits.push({ cell: j, p: exitMass[j] });
    return { cells: cells, exits: exits, shortR: p.shortR, shortY: p.shortY, longR: p.longR, longY: p.longY,
      score: evaluate(colors, pyr, [greyCell], occA, occB) };
  }

  // ---------- Search ----------

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // A resumable search: step(ms) works for at most about ms milliseconds and
  // returns true when finished; result() gives the chosen move.
  // st = { colors, pyr, greyCell, greyBlock, me: {k, cell, lastLine, app},
  //        other: {cell, lastLine}, maxSteps, depth (1 or 2), noise (0..), budgetMs,
  //        prune (default true), rand (optional function) }
  function Search(st) {
    this.st = st;
    this.sign = st.me.k === 0 ? 1 : -1;
    this.rand = st.rand || Math.random;
    this.phase = 0;
    this.spent = 0;
    this.cand = [];
    this.next = 0;
    this.best = null;
    this.stats = { moves: 0, kept: 0, deepened: 0, evals: 0, replyEvals: 0, cutoffs: 0, ms: 0 };
  }

  Search.prototype.generate = function () {
    var st = this.st, me = st.me, other = st.other, prune = st.prune !== false;
    var lines = legalLines(st.pyr, me.lastLine, other.cell, st.greyBlock);
    var infl = new Uint8Array(N * N);
    region(st.colors, st.pyr, [st.greyCell], -1, -1, infl);
    var endMemo = {}, self = this;
    lines.forEach(function (L) {
      var path = ringPath(me.cell, L.start, other.cell);
      if (!path || path.length > st.maxSteps) return;
      var touches = false;
      for (var j = 0; j < L.cells.length; j++) if (infl[L.cells[j]]) { touches = true; break; }
      var apps = PRIMARIES;
      self.stats.moves += 3;
      // A crossing that does not touch the grey region (or its neighbours) gives
      // the same board value whatever the colour: keep one representative.
      if (prune && !touches) apps = [me.app];
      apps.forEach(function (a) {
        var s1;
        if (prune && !touches) {
          if (endMemo[L.end] === undefined) endMemo[L.end] = self.sign * evaluate(st.colors, st.pyr, [st.greyCell], L.end, other.cell);
          s1 = endMemo[L.end];
        } else {
          s1 = self.sign * evaluate(applyLine(st.colors, L, a), st.pyr, [st.greyCell], L.end, other.cell);
        }
        var pen = path.length * 0.01 + (a !== me.app ? 0.005 : 0);
        self.cand.push({ line: L, start: L.start, app: a, path: path, s1: s1, pen: pen, v: s1 - pen, deep: false, touches: touches });
      });
    });
    this.stats.kept = this.cand.length;
    // best-first order for the deepening
    this.cand.sort(function (x, y) { return (y.s1 - y.pen) - (x.s1 - x.pen); });
  };

  // Opponent's best answer to candidate m (it minimises our score). Stops early
  // when the value can no longer beat 'bound'.
  Search.prototype.deepen = function (m, bound) {
    var st = this.st, other = st.other, prune = st.prune !== false;
    var after = applyLine(st.colors, m.line, m.app);
    var replies = legalLines(st.pyr, other.lastLine, m.line.end, st.greyBlock);
    var infl = new Uint8Array(N * N);
    region(after, st.pyr, [st.greyCell], -1, -1, infl);
    var worst = m.s1, memo = {}, sign = this.sign, cut = false;
    // touching replies first: they are the dangerous ones
    var touching = [], quiet = [];
    for (var r = 0; r < replies.length; r++) {
      var L = replies[r], t = false;
      for (var j = 0; j < L.cells.length; j++) if (infl[L.cells[j]]) { t = true; break; }
      (t || !prune ? touching : quiet).push(L);
    }
    for (var a = 0; a < touching.length && !cut; a++) {
      for (var c = 0; c < 3; c++) {
        this.stats.replyEvals++;
        var s2 = sign * evaluate(applyLine(after, touching[a], PRIMARIES[c]), st.pyr, [st.greyCell], m.line.end, touching[a].end);
        if (s2 < worst) worst = s2;
        if ((1 - W.worst) * m.s1 + W.worst * worst - m.pen < bound) { cut = true; break; }
      }
    }
    for (var q = 0; q < quiet.length && !cut; q++) {
      var e = quiet[q].end;
      if (memo[e] === undefined) { this.stats.replyEvals++; memo[e] = sign * evaluate(after, st.pyr, [st.greyCell], m.line.end, e); }
      if (memo[e] < worst) worst = memo[e];
      if ((1 - W.worst) * m.s1 + W.worst * worst - m.pen < bound) cut = true;
    }
    if (cut) this.stats.cutoffs++;
    m.deep = true;
    m.v = (1 - W.worst) * m.s1 + W.worst * worst - m.pen;
  };

  Search.prototype.step = function (ms) {
    var t0 = now(), st = this.st, e0 = STATS.evals;
    if (this.phase === 0) {
      this.generate();
      this.phase = (st.depth >= 2 && this.cand.length > 1) ? 1 : 2;
    }
    while (this.phase === 1) {
      if (this.next >= this.cand.length || this.spent + (now() - t0) >= st.budgetMs) { this.phase = 2; break; }
      if (now() - t0 >= ms) break;
      var m = this.cand[this.next++];
      // Upper bound of a deepened value is s1 - pen: once it is below the best
      // deepened value, no later candidate can win (they are sorted).
      if (this.best && m.s1 - m.pen <= this.best.v) { this.phase = 2; break; }
      this.deepen(m, this.best ? this.best.v : -Infinity);
      this.stats.deepened++;
      if (!this.best || m.v > this.best.v) this.best = m;
    }
    this.spent += now() - t0;
    this.stats.evals += STATS.evals - e0;
    this.stats.ms = this.spent;
    return this.phase === 2;
  };

  Search.prototype.result = function () {
    var c = this.cand, st = this.st, rand = this.rand;
    if (!c.length) return null;
    var pick;
    if (st.depth >= 2) {
      // compare like with like: only deepened moves (the best of them)
      pick = this.best || c[0];
    } else {
      var noise = st.noise || 0;
      var scored = c.map(function (m) { return { m: m, v: m.v + (noise ? rand() * noise : 0) }; });
      scored.sort(function (a, b) { return b.v - a.v; });
      pick = scored[0].m;
      if (noise && rand() < 0.2) pick = scored[(rand() * Math.min(5, scored.length)) | 0].m;
    }
    return { start: pick.start, app: pick.app, path: pick.path, value: pick.v, lineId: pick.line.id, stats: this.stats };
  };

  // Runs a whole search (blocking, bounded by st.budgetMs).
  function choose(st) {
    var s = new Search(st);
    while (!s.step(1e9)) { /* keep going */ }
    return s.result();
  }

  var API = {
    N: N, RED: RED, BLUE: BLUE, YEL: YEL, PRIMARIES: PRIMARIES, GREY_STEP_MS: GREY_STEP_MS,
    H_SHORT: H_SHORT, H_LONG: H_LONG,
    idx: idx, colOf: colOf, rowOf: rowOf, isRing: isRing, isCorner: isCorner, inside: inside,
    zoneOwner: zoneOwner, mix: mix, RING: RING, RING_POS: RING_POS, ringPath: ringPath,
    lineFrom: lineFrom, legalLines: legalLines, applyLine: applyLine,
    region: region, absorb: absorb, connection: connection, W: W, evaluate: evaluate, analyse: analyse,
    Search: Search, choose: choose, STATS: STATS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CMEngine = API;
})(typeof self !== 'undefined' ? self : this);
