/*
 * Colours-MIX (nouvelle version) - rules and computer player, without any DOM.
 * Shared by the page (game.js), the Web Worker (ai-worker.js, via importScripts)
 * and node test scripts (module.exports).
 *
 * Rules measured on the original program (see ../algorithme.html):
 * - 13 x 13 board: a ring of black cells around 11 x 11 coloured cells.
 * - Colours 0..5 sit on a wheel (red, orange, yellow, green, blue, magenta), 6 is
 *   brown, 7 the black ring. Applying a colour moves a cell one step towards it on
 *   the wheel, the opposite colour turns brown, brown takes the applied colour.
 * - Red (player 0) applies blue or red and wants the grey globule to reach the top
 *   or bottom band; yellow (player 1) applies blue or yellow, left or right band.
 * - A crossing starts from any side cell (not a corner) and goes straight to the
 *   opposite side; the arrival cell must be free of pyramids and globules. The
 *   pyramid of the crossing globule then moves to the start cell.
 */
(function (root) {
  'use strict';

  var N = 13;
  var RED = 0, ORANGE = 1, YEL = 2, GREEN = 3, BLUE = 4, MAGENTA = 5, BROWN = 6, BLACK = 7;
  var START_COLOURS = [RED, ORANGE, YEL, GREEN, MAGENTA];
  var OWN = [RED, YEL];                    // second application colour (the first is blue)
  var APPS = [[BLUE, RED], [BLUE, YEL]];   // application colours of each globule
  var GREY_STEP_MS = 730;   // mean time of one grey step (480 ms slide + 0..500 ms pause)
  var H_SHORT = 16;         // short horizon of the absorption computation (about 12 s)
  var H_LONG = 40;          // longer horizon, lower weight (about 29 s)

  function idx(c, r) { return r * N + c; }
  function colOf(i) { return i % N; }
  function rowOf(i) { return (i / N) | 0; }
  function isRing(c, r) { return c === 0 || r === 0 || c === N - 1 || r === N - 1; }
  function isCorner(c, r) { return (c === 0 || c === N - 1) && (r === 0 || r === N - 1); }
  function inside(c, r) { return c >= 0 && r >= 0 && c < N && r < N; }
  // 0 = red zone (top / bottom), 1 = yellow zone (left / right)
  function zoneOwner(c, r) { return (r === 0 || r === N - 1) ? 0 : 1; }

  // Colour wheel mixing (measured on the original).
  function mix(c, a) {
    if (c === BROWN || c === a) return a;
    var d = (a - c + 6) % 6;
    if (d === 3) return BROWN;
    return d < 3 ? (c + 1) % 6 : (c + 5) % 6;
  }

  // PASSES[c * 8 + g]: smallest number of crossings (red, blue or yellow applied)
  // that turn colour c into colour g. Used by the connection cost.
  var PASSES = new Uint8Array(64);
  (function () {
    for (var c = 0; c < 7; c++) {
      var d = [99, 99, 99, 99, 99, 99, 99], q = [c];
      d[c] = 0;
      while (q.length) {
        var x = q.shift();
        [RED, BLUE, YEL].forEach(function (a) { var y = mix(x, a); if (d[y] > d[x] + 1) { d[y] = d[x] + 1; q.push(y); } });
      }
      for (var g = 0; g < 7; g++) PASSES[c * 8 + g] = d[g];
    }
  })();

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

  // Ring cells in clockwise order (48 cells).
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

  function has(list, x) { for (var i = 0; i < list.length; i++) if (list[i] === x) return true; return false; }

  // Shortest walk along the ring from a to b avoiding the cells of 'blocks'
  // (corners are walkable). Returns the list of cells (without a) or null.
  function ringPath(a, b, blocks) {
    if (a === b) return [];
    var L = RING.length, best = null;
    for (var s = 0; s < 2; s++) {
      var d = s ? -1 : 1, path = [], k = RING_POS[a], ok = true;
      for (var n = 0; n < L; n++) {
        k = (k + d + L) % L;
        if (has(blocks, RING[k])) { ok = false; break; }
        path.push(RING[k]);
        if (RING[k] === b) break;
      }
      if (ok && (!best || path.length < best.length)) best = path;
    }
    return best;
  }

  // Crossing line starting at ring cell s: {id, start, dc, dr, cells (11), end}.
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

  // Crossings a globule standing on 'pos' can make: any side cell it can walk to
  // within maxSteps (pyramids and the other globule block the walk), whose arrival
  // cell holds no pyramid and no globule. blocks = [own pyramid, other pyramid,
  // other globule] (-1 for none). Returns [{line, path}].
  function legalCrossings(pos, blocks, maxSteps) {
    var out = [];
    for (var n = 0; n < RING.length; n++) {
      var s = RING[n], L = LINE_AT[s];
      if (!L || has(blocks, s) || has(blocks, L.end)) continue;
      var path = ringPath(pos, s, blocks);
      if (!path || path.length > maxSteps) continue;
      out.push({ line: L, path: path });
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

  // Region the grey globule can roam from the start cells (same colour, connected),
  // its free exits (ring cells not in 'blk': pyramids and globules) and the smallest
  // distances to the red / yellow bands. 'influence' (optional Uint8Array) is set to
  // 1 on the region and on its interior neighbours.
  function region(colors, starts, blk, influence) {
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
            if (!has(blk, j)) { if (RED_EXIT[j]) exitR++; else exitY++; }
          }
          continue;
        }
        if (influence) influence[j] = 1;
        if (bfsSeen[j] === bfsStamp || colors[j] !== colors[i]) continue;
        bfsSeen[j] = bfsStamp; bfsQueue[tail++] = j;
      }
    }
    return { size: tail, exitR: exitR, exitY: exitY, minR: minR, minY: minY };
  }

  // Probability that the grey globule's random walk reaches a red band / a yellow
  // band within H_SHORT and H_LONG steps. Same rules as the game: at each step it
  // moves uniformly to a free neighbour that is black (ring, not a pyramid or a
  // globule) or of the same colour as its cell; it stays put when there is none.
  // exitMass (optional Float64Array): filled with the short-horizon probability of
  // leaving through each ring cell (for the on-screen aid).
  var mCur = new Float64Array(N * N), mNext = new Float64Array(N * N);
  var actCur = new Int16Array(N * N), actNext = new Int16Array(N * N);
  var inNext = new Int32Array(N * N), stepStamp = 0;

  function absorb(colors, starts, mass, blk, exitMass) {
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
          if (RING_CELL[j]) { if (!has(blk, j)) opts[no++] = j; }
          else if (colors[j] === col) opts[no++] = j;
        }
        if (no === 0) { opts[0] = i; no = 1; }
        var share = mi / no;
        for (k = 0; k < no; k++) {
          var x = opts[k];
          if (RING_CELL[x]) {
            if (RED_EXIT[x]) aR += share; else aY += share;
            if (exitMass && t <= H_SHORT) exitMass[x] += share;
          } else {
            if (inNext[x] !== stepStamp) { inNext[x] = stepStamp; actNext[nNext++] = x; mNext[x] = 0; }
            mNext[x] += share;
          }
        }
      }
      var tm = mCur; mCur = mNext; mNext = tm;
      var ta = actCur; actCur = actNext; actNext = ta;
      nCur = nNext;
      if (t === H_SHORT) { sR = aR; sY = aY; }
      if (total - aR - aY < 1e-6 * total) { if (t < H_SHORT) { sR = aR; sY = aY; } break; }
    }
    for (k = 0; k < nCur; k++) mCur[actCur[k]] = 0;
    return { shortR: sR, shortY: sY, longR: aR, longY: aY };
  }

  // Connection cost: how many crossings ("passes" of red, blue or yellow) the cells
  // of the cheapest path from the grey globule to a red band / a yellow band still
  // need before the grey can walk it. The path may use any target colour among the
  // grey's current colour, red, blue and yellow (the grey's own cell is repainted
  // too). Cells of the right colour cost 0, like distances in Hex.
  var cDist = new Int16Array(N * N), cStamp = new Int32Array(N * N), cRun = 0;
  var MAXD = 63, buckets = [];
  for (var b0 = 0; b0 <= MAXD; b0++) buckets.push([]);
  function connectionTo(colors, start, blk, g, best) {
    cRun++;
    var cR = best[0], cY = best[1];
    for (var b = 0; b <= MAXD; b++) buckets[b].length = 0;
    var d0 = PASSES[colors[start] * 8 + g];
    if (d0 >= Math.max(cR, cY)) return;
    cStamp[start] = cRun; cDist[start] = d0; buckets[d0].push(start);
    for (var d = d0; d <= MAXD && d < Math.max(cR, cY); d++) {
      var B = buckets[d];
      for (var q = 0; q < B.length; q++) {
        var i = B[q];
        if (cDist[i] !== d) continue;
        var nb = NB[i];
        for (var k = 0; k < nb.length; k++) {
          var j = nb[k];
          if (RING_CELL[j]) {
            if (has(blk, j)) continue;
            if (RED_EXIT[j]) { if (d < cR) cR = d; } else if (d < cY) cY = d;
            continue;
          }
          var nd = d + PASSES[colors[j] * 8 + g];
          if (nd > MAXD) continue;
          if (cStamp[j] !== cRun || nd < cDist[j]) { cStamp[j] = cRun; cDist[j] = nd; buckets[nd].push(j); }
        }
      }
    }
    best[0] = cR; best[1] = cY;
  }
  function connection(colors, start, blk) {
    var best = [99, 99], gc = colors[start];
    connectionTo(colors, start, blk, gc, best);
    if (gc !== RED) connectionTo(colors, start, blk, RED, best);
    if (gc !== BLUE) connectionTo(colors, start, blk, BLUE, best);
    if (gc !== YEL) connectionTo(colors, start, blk, YEL, best);
    return { red: Math.min(best[0], 20), yel: Math.min(best[1], 20) };
  }

  // Board evaluation from red's point of view.
  //   10 x (P(red) - P(yellow)) within ~12 s, 3 x the same within ~29 s,
  //   + W.conn x (yellow connection cost - red connection cost),
  //   + 0.05 x (distance to yellow bands - distance to red bands) as a last tie-break.
  var W = { conn: 0.4, worst: 0.55 };
  var STATS = { evals: 0 };
  function evaluate(colors, starts, blk) {
    STATS.evals++;
    var reg = region(colors, starts, blk, null);
    var score = 0.05 * (reg.minY - reg.minR);
    if (W.conn) { var cc = connection(colors, starts[0], blk); score += W.conn * (cc.yel - cc.red); }
    if (reg.exitR + reg.exitY === 0) return score;   // enclosed: nothing to propagate
    var p = absorb(colors, starts, null, blk, null);
    return score + 10 * (p.shortR - p.shortY) + 3 * (p.longR - p.longY);
  }

  // Detailed analysis for the on-screen aid.
  function analyse(colors, greyCell, blk) {
    var infl = new Uint8Array(N * N);
    var reg = region(colors, [greyCell], blk, infl);
    var cells = [];
    var col = colors[greyCell];
    for (var i = 0; i < N * N; i++) if (bfsSeen[i] === bfsStamp && !RING_CELL[i] && colors[i] === col) cells.push(i);
    var exitMass = new Float64Array(N * N);
    var p = (reg.exitR + reg.exitY) ? absorb(colors, [greyCell], null, blk, exitMass)
      : { shortR: 0, shortY: 0, longR: 0, longY: 0 };
    var exits = [];
    for (var j = 0; j < N * N; j++) if (exitMass[j] > 0) exits.push({ cell: j, p: exitMass[j] });
    var cc = connection(colors, greyCell, blk);
    return { cells: cells, exits: exits, shortR: p.shortR, shortY: p.shortY, longR: p.longR, longY: p.longY,
      connRed: cc.red, connYel: cc.yel, score: evaluate(colors, [greyCell], blk) };
  }

  // ---------- Search ----------

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  // A resumable search: step(ms) works for at most about ms milliseconds and
  // returns true when finished; result() gives the chosen move.
  // st = { colors, greyCell, me: {k, cell, app, pyr}, other: {k, cell, pyr},
  //        maxSteps, otherSteps, depth (1, 2 or 3), noise (0..), budgetMs, rand }
  // pyr = cell of the globule's pyramid (-1 for none).
  function Search(st) {
    this.st = st;
    this.sign = st.me.k === 0 ? 1 : -1;
    this.rand = st.rand || Math.random;
    this.phase = 0;
    this.spent = 0;
    this.cand = [];
    this.next = 0;
    this.best = null;
    this.deepList = [];
    this.next3 = 0;
    this.stats = { moves: 0, deepened: 0, third: 0, evals: 0, cutoffs: 0, ms: 0 };
  }

  // Values of all crossings of the globule 'who' (me or other) on board 'colors'
  // from the point of view of this.sign, with the other side's position given.
  Search.prototype.generate = function () {
    var st = this.st, me = st.me, other = st.other, self = this;
    var moves = legalCrossings(me.cell, [me.pyr, other.pyr, other.cell], st.maxSteps);
    moves.forEach(function (mv) {
      var L = mv.line;
      APPS[me.k].forEach(function (a) {
        self.stats.moves++;
        var s1 = self.sign * evaluate(applyLine(st.colors, L, a), [st.greyCell], [other.pyr, L.start, L.end, other.cell]);
        var pen = mv.path.length * 0.01 + (a !== me.app ? 0.005 : 0);
        self.cand.push({ line: L, start: L.start, app: a, path: mv.path, s1: s1, pen: pen, v: s1 - pen, deep: false });
      });
    });
    // best-first order for the deepening
    this.cand.sort(function (x, y) { return y.v - x.v; });
  };

  // Replies of the other globule after candidate m, worst ones (for us) first.
  // Returns the list of {line, app, s2, colors?}; stops early when the deepened
  // value can no longer beat 'bound'.
  Search.prototype.deepen = function (m, bound, keep) {
    var st = this.st, other = st.other, sign = this.sign;
    var after = applyLine(st.colors, m.line, m.app);
    var replies = legalCrossings(other.cell, [other.pyr, m.line.start, m.line.end], st.otherSteps);
    // replies touching the grey's region (or its neighbours) first: they are the dangerous ones
    var infl = new Uint8Array(N * N);
    region(after, [st.greyCell], [], infl);
    replies.sort(function (x, y) { return touch(y.line, infl) - touch(x.line, infl); });
    var worst = m.s1, cut = false, list = keep ? [] : null;
    var save = new Uint8Array(N - 2);
    for (var r = 0; r < replies.length && !cut; r++) {
      var L = replies[r].line, cells = L.cells, k;
      for (var c = 0; c < 2; c++) {
        var a = APPS[other.k][c];
        for (k = 0; k < cells.length; k++) { save[k] = after[cells[k]]; after[cells[k]] = mix(save[k], a); }
        var s2 = sign * evaluate(after, [st.greyCell], [m.line.start, L.start, m.line.end, L.end]);
        if (list) list.push({ line: L, app: a, s2: s2 });
        for (k = 0; k < cells.length; k++) after[cells[k]] = save[k];
        if (s2 < worst) worst = s2;
        if (!keep && (1 - W.worst) * m.s1 + W.worst * worst - m.pen < bound) { cut = true; break; }
      }
    }
    if (cut) this.stats.cutoffs++;
    m.deep = true;
    m.worst = worst;
    m.v = (1 - W.worst) * m.s1 + W.worst * worst - m.pen;
    if (list) { list.sort(function (x, y) { return x.s2 - y.s2; }); m.replies = list; m.after = after; }
  };
  function touch(L, infl) { for (var j = 0; j < L.cells.length; j++) if (infl[L.cells[j]]) return 1; return 0; }

  // Third ply (expert): for each of the 5 best candidates, its 3 most dangerous
  // replies are answered by our best crossing; the value of each line becomes the
  // value after our answer (we get to play again before the grey goes far).
  Search.prototype.third = function (m) {
    var st = this.st, me = st.me, sign = this.sign, worst3 = Infinity;
    var replies = m.replies.slice(0, 3);
    replies.forEach(function (rp) {
      var b2 = applyLine(m.after, rp.line, rp.app), best = rp.s2;
      var mine = legalCrossings(m.line.end, [m.line.start, rp.line.start, rp.line.end], st.otherSteps);
      mine.forEach(function (mv) {
        APPS[me.k].forEach(function (a) {
          var s3 = sign * evaluate(applyLine(b2, mv.line, a), [st.greyCell], [rp.line.start, mv.line.start, mv.line.end, rp.line.end]);
          if (s3 > best) best = s3;
        });
      });
      // the reply's own value still counts: the grey moves during our answer
      var v = 0.5 * rp.s2 + 0.5 * best;
      if (v < worst3) worst3 = v;
    });
    if (worst3 === Infinity) worst3 = m.worst;
    m.v3 = (1 - W.worst) * m.s1 + W.worst * worst3 - m.pen;
    this.stats.third++;
  };

  Search.prototype.step = function (ms) {
    var t0 = now(), st = this.st, e0 = STATS.evals;
    var over = function (self) { return self.spent + (now() - t0) >= st.budgetMs; };
    if (this.phase === 0) {
      this.generate();
      this.phase = (st.depth >= 2 && this.cand.length > 1) ? 1 : 3;
    }
    while (this.phase === 1) {
      if (this.next >= this.cand.length || over(this)) { this.phase = st.depth >= 3 ? 2 : 3; break; }
      if (now() - t0 >= ms) break;
      var m = this.cand[this.next++];
      // Upper bound of a deepened value is s1 - pen: once it is below the best
      // deepened value, no later candidate can win (they are sorted).
      if (this.best && m.v <= this.best.v) { this.phase = st.depth >= 3 ? 2 : 3; break; }
      this.deepen(m, this.best ? this.best.v : -Infinity, false);
      this.stats.deepened++;
      if (!this.best || m.v > this.best.v) this.best = m;
    }
    if (this.phase === 2 && !this.deepList.length) {
      // the 5 best deepened candidates get the third ply
      this.deepList = this.cand.filter(function (c) { return c.deep; }).sort(function (x, y) { return y.v - x.v; }).slice(0, 5);
    }
    while (this.phase === 2) {
      if (this.next3 >= this.deepList.length || over(this)) { this.phase = 3; break; }
      if (now() - t0 >= ms) break;
      var c3 = this.deepList[this.next3++];
      this.deepen(c3, -Infinity, true);
      this.third(c3);
    }
    this.spent += now() - t0;
    this.stats.evals += STATS.evals - e0;
    this.stats.ms = this.spent;
    return this.phase === 3;
  };

  Search.prototype.result = function () {
    var c = this.cand, st = this.st, rand = this.rand;
    if (!c.length) return null;
    var pick;
    if (st.depth >= 3 && this.deepList.length) {
      var done = this.deepList.filter(function (x) { return x.v3 !== undefined; });
      pick = done.length ? done.sort(function (x, y) { return y.v3 - x.v3; })[0] : this.best;
    } else if (st.depth >= 2) {
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
    N: N, RED: RED, ORANGE: ORANGE, YEL: YEL, GREEN: GREEN, BLUE: BLUE, MAGENTA: MAGENTA, BROWN: BROWN, BLACK: BLACK,
    START_COLOURS: START_COLOURS, OWN: OWN, APPS: APPS, PASSES: PASSES,
    GREY_STEP_MS: GREY_STEP_MS, H_SHORT: H_SHORT, H_LONG: H_LONG,
    idx: idx, colOf: colOf, rowOf: rowOf, isRing: isRing, isCorner: isCorner, inside: inside,
    zoneOwner: zoneOwner, mix: mix, RING: RING, RING_POS: RING_POS, ringPath: ringPath,
    lineFrom: lineFrom, legalCrossings: legalCrossings, applyLine: applyLine,
    region: region, absorb: absorb, connection: connection, W: W, evaluate: evaluate, analyse: analyse,
    Search: Search, choose: choose, STATS: STATS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CMEngine = API;
})(typeof self !== 'undefined' ? self : this);
