/*
 * Morpion (nouvelle version) - rules engine and computer player.
 * No DOM: loaded by the page, by ai-worker.js (importScripts) and by node.
 *
 * Same rules as the original port (../engine.js):
 *   board N x N, 0 = empty, 1 = player (orange), 2 = computer (grey);
 *   a completed 5-window of one colour scores 1 point and is crossed out in its
 *   direction (6 in a row = 1 point, 10 in a row = 2 points); the game ends when
 *   no 5-window is still achievable for anybody.
 *
 * What is new compared with ../engine.js:
 *   - everything the search needs is INCREMENTAL: per-cell move-ordering values
 *     (hv), alive windows per cell, material, "fours" and "threes" are updated in
 *     play/undo/mark instead of being recomputed by scanning every window;
 *   - Zobrist hashing (two 32-bit keys: marbles + crossed-out cells + side to move)
 *     and a transposition table;
 *   - principal variation search with killer moves and history heuristic;
 *   - a quiescence / threat-space extension at the horizon: completing a four,
 *     blocking a four and (a few plies) creating a four;
 *   - weights tuned by self-play (see ../algorithme.html).
 * Exposes: MorpionEngine (global, or module.exports under node).
 */
(function (root) {
  'use strict';

  var DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]]; // horizontal, vertical, "\", "/"
  var POINT = 10000;                              // eval value of one point

  // Default weights (tuned by self-play, see tune.js in the report).
  var WEIGHTS = {
    VAL: [0, 2, 12, 70, 160, 0],          // open window with k marbles (evaluation)
    ATT: [1, 5, 24, 150, 1000000, 0],     // move ordering: extending my window to k+1
    DEF: [0, 4, 18, 120, 400000, 0],      // move ordering: blocking a window of k
    F1: 0.9, F2: 0.5,                     // my fours (I move next): first / each extra one
    Q2: 0.8, Q1: 300                      // opponent fours: each extra one / small penalty
  };

  // Deterministic 32-bit keys for Zobrist hashing (xorshift32).
  function makeKeys(count, seed) {
    var a = new Int32Array(count), s = seed | 0;
    for (var i = 0; i < count; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; a[i] = s; }
    return a;
  }

  // ---------- Board / rules ----------

  function Game(n, weights) {
    this.n = n;
    this.w8 = weights || WEIGHTS;
    var cells = n * n, wins = [], i;
    this.board = new Uint8Array(cells);
    for (var d = 0; d < 4; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var ex = x + 4 * dx, ey = y + 4 * dy;
        if (ex < 0 || ex >= n || ey >= n) continue;
        var w = [];
        for (i = 0; i < 5; i++) w.push((y + i * dy) * n + x + i * dx);
        wins.push({ d: d, cells: w });
      }
    }
    var W = wins.length;
    this.W = W;
    this.wCells = new Int16Array(W * 5);
    this.wDir = new Uint8Array(W);
    this.cellWins = [];
    this.cellDirWins = [];
    for (i = 0; i < cells; i++) this.cellWins.push([]);
    for (i = 0; i < cells * 4; i++) this.cellDirWins.push([]);
    for (var k = 0; k < W; k++) {
      this.wDir[k] = wins[k].d;
      for (i = 0; i < 5; i++) {
        var c = wins[k].cells[i];
        this.wCells[k * 5 + i] = c;
        this.cellWins[c].push(k);
        this.cellDirWins[c * 4 + wins[k].d].push(k);
      }
    }
    this.cnt = [null, new Uint8Array(W), new Uint8Array(W)];
    this.usedCnt = new Uint8Array(W);
    this.used = new Uint8Array(cells * 4);
    this.score = [0, 0, 0];
    this.lines = [];
    this.moves = 0;
    // incremental data
    this.hv = [null, new Int32Array(cells), new Int32Array(cells)];      // cellValue for p
    this.aliveCell = new Uint8Array(cells);                               // alive windows through the cell
    this.aliveTotal = 0;
    this.mat = [0, 0, 0];                                                 // sum of VAL over pure windows
    this.fourCnt = [null, new Uint8Array(cells), new Uint8Array(cells)];  // p's fours completed by the cell
    this.fourCells = [0, 0, 0];                                           // distinct such cells
    this.threeCnt = [null, new Uint8Array(cells), new Uint8Array(cells)]; // p's threes extended by the cell
    this.stamp = new Int32Array(W); this.stampId = 0;
    this.tmpW = new Int32Array(W);
    // Zobrist
    this.zm1 = makeKeys(cells * 2, 0x1234567); this.zm2 = makeKeys(cells * 2, 0x7654321);
    this.zu1 = makeKeys(cells * 4, 0x2468ace); this.zu2 = makeKeys(cells * 4, 0x1357bdf);
    this.h1 = 0; this.h2 = 0;
    for (k = 0; k < W; k++) this.acc(k, 1);
  }

  // Adds (s = 1) or removes (s = -1) the contribution of window w to every
  // incremental table. Must be called with board / cnt / usedCnt consistent.
  Game.prototype.acc = function (w, s) {
    if (this.usedCnt[w]) return;
    var a = this.cnt[1][w], b = this.cnt[2][w], base = w * 5, i, c, W8 = this.w8;
    var ATT = W8.ATT, DEF = W8.DEF;
    var v1 = (b === 0 ? ATT[a] : 0) + (a === 0 ? DEF[b] : 0);
    var v2 = (a === 0 ? ATT[b] : 0) + (b === 0 ? DEF[a] : 0);
    var al = (a === 0 || b === 0) && a + b < 5;
    var hv1 = this.hv[1], hv2 = this.hv[2], wc = this.wCells, ac = this.aliveCell, board = this.board;
    for (i = 0; i < 5; i++) {
      c = wc[base + i];
      hv1[c] += s * v1; hv2[c] += s * v2;
      if (al) ac[c] += s;
    }
    if (!al) return;
    this.aliveTotal += s;
    var p = a ? 1 : b ? 2 : 0, k = a || b;
    if (!p) return;
    this.mat[p] += s * W8.VAL[k];
    if (k === 4) {
      for (i = 0; i < 5; i++) { c = wc[base + i]; if (!board[c]) break; }
      var f = this.fourCnt[p];
      if (s > 0) { if (f[c]++ === 0) this.fourCells[p]++; }
      else if (--f[c] === 0) this.fourCells[p]--;
    } else if (k === 3) {
      var t = this.threeCnt[p];
      for (i = 0; i < 5; i++) { c = wc[base + i]; if (!board[c]) t[c] += s; }
    }
  };

  // Drops a marble of player p on cell c. Returns an undo record {c, p, scored:[w...]}.
  Game.prototype.play = function (c, p) {
    var cw = this.cellWins[c], cnt = this.cnt[p], i;
    for (i = 0; i < cw.length; i++) this.acc(cw[i], -1);
    this.board[c] = p; this.moves++;
    var z = c * 2 + p - 1;
    this.h1 ^= this.zm1[z]; this.h2 ^= this.zm2[z];
    for (i = 0; i < cw.length; i++) cnt[cw[i]]++;
    for (i = 0; i < cw.length; i++) this.acc(cw[i], 1);
    var scored = [];
    for (var d = 0; d < 4; d++) {
      var dw = this.cellDirWins[c * 4 + d];
      for (i = 0; i < dw.length; i++) {
        var w = dw[i];
        if (cnt[w] === 5 && this.usedCnt[w] === 0) { this.mark(w, 1); scored.push(w); break; }
      }
    }
    for (i = 0; i < scored.length; i++) this.lines.push({ w: scored[i], p: p });
    this.score[p] += scored.length;
    return { c: c, p: p, scored: scored };
  };

  Game.prototype.undo = function (rec) {
    var c = rec.c, p = rec.p, cw = this.cellWins[c], cnt = this.cnt[p], i;
    for (i = rec.scored.length - 1; i >= 0; i--) { this.mark(rec.scored[i], -1); this.lines.pop(); }
    this.score[p] -= rec.scored.length;
    for (i = 0; i < cw.length; i++) this.acc(cw[i], -1);
    for (i = 0; i < cw.length; i++) cnt[cw[i]]--;
    this.board[c] = 0; this.moves--;
    var z = c * 2 + p - 1;
    this.h1 ^= this.zm1[z]; this.h2 ^= this.zm2[z];
    for (i = 0; i < cw.length; i++) this.acc(cw[i], 1);
  };

  // Crosses out (s = 1) or restores (s = -1) the 5 cells of window w in its direction.
  Game.prototype.mark = function (w, s) {
    var d = this.wDir[w], i, j, x, dw, list = this.tmpW, nl = 0, id = ++this.stampId, st = this.stamp;
    for (i = 0; i < 5; i++) {
      dw = this.cellDirWins[this.wCells[w * 5 + i] * 4 + d];
      for (j = 0; j < dw.length; j++) if (st[dw[j]] !== id) { st[dw[j]] = id; list[nl++] = dw[j]; }
    }
    for (j = 0; j < nl; j++) this.acc(list[j], -1);
    for (i = 0; i < 5; i++) {
      x = this.wCells[w * 5 + i];
      this.used[x * 4 + d] = s > 0 ? 1 : 0;
      this.h1 ^= this.zu1[x * 4 + d]; this.h2 ^= this.zu2[x * 4 + d];
      dw = this.cellDirWins[x * 4 + d];
      for (j = 0; j < dw.length; j++) this.usedCnt[dw[j]] += s;
    }
    for (j = 0; j < nl; j++) this.acc(list[j], 1);
  };

  Game.prototype.alive = function (w) {
    var a = this.cnt[1][w], b = this.cnt[2][w];
    return this.usedCnt[w] === 0 && (a === 0 || b === 0) && a + b < 5;
  };

  Game.prototype.over = function () { return this.aliveTotal === 0; };

  Game.prototype.usefulCells = function () {
    var out = [], b = this.board, ac = this.aliveCell;
    for (var c = 0; c < b.length; c++) if (!b[c] && ac[c]) out.push(c);
    return out;
  };

  Game.prototype.cellValue = function (c, p) { return this.hv[p][c]; };

  // Cells where p completes a four (scores now). Used by the UI threat display too.
  Game.prototype.fourCellsOf = function (p) {
    var out = [], f = this.fourCnt[p];
    for (var c = 0; c < f.length; c++) if (f[c] && !this.board[c]) out.push(c);
    return out;
  };
  // Cells that turn one of p's threes into a four.
  Game.prototype.threeCellsOf = function (p) {
    var out = [], t = this.threeCnt[p];
    for (var c = 0; c < t.length; c++) if (t[c] && !this.board[c]) out.push(c);
    return out;
  };

  // ---------- Evaluation ----------

  Game.prototype.evaluate = function (p) {
    var q = 3 - p, W8 = this.w8;
    var s = (this.score[p] - this.score[q]) * POINT + this.mat[p] - this.mat[q];
    var fp = this.fourCells[p], fq = this.fourCells[q];
    if (fp) s += POINT * W8.F1 + (fp - 1) * POINT * W8.F2;
    else if (fq) s -= (fq - 1) * POINT * W8.Q2 + W8.Q1;
    return s;
  };

  // Candidate moves for p, best first, at most k of them (partial selection).
  Game.prototype.candidates = function (p, k) {
    var b = this.board, ac = this.aliveCell, hv = this.hv[p], list = [], c, i, h;
    if (!k) {
      for (c = 0; c < b.length; c++) if (!b[c] && ac[c]) list.push({ c: c, h: hv[c] });
      list.sort(function (x, y) { return y.h - x.h; });
      return list;
    }
    for (c = 0; c < b.length; c++) {
      if (b[c] || !ac[c]) continue;
      h = hv[c];
      if (list.length === k) {
        if (h <= list[k - 1].h) continue;
        list.pop();
      }
      i = list.length;
      list.push(null);
      while (i > 0 && list[i - 1].h < h) { list[i] = list[i - 1]; i--; }
      list[i] = { c: c, h: h };
    }
    return list;
  };

  // ---------- Search ----------

  var TIMEOUT = {};
  var BIG = 1e9;

  // Level 1..5. time = budget in ms (the page uses timeWorker when the search
  // runs in a Web Worker, since the interface does not freeze any more).
  var LEVELS = [
    null,
    { depth: 0, width: 8, time: 100, noise: 0.7 },
    { depth: 1, width: 12, time: 300, noise: 0.08, q: 0 },
    { depth: 3, width: 12, time: 500, noise: 0, q: 4 },
    { depth: 5, width: 12, time: 900, timeWorker: 1500, noise: 0, q: 6 },
    { depth: 12, width: 12, time: 1400, timeWorker: 2500, noise: 0, q: 8 }
  ];

  var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var EXACT = 1, LOWER = 2, UPPER = 3;

  function newTT() {
    return {
      key: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Uint8Array(TT_SIZE),
      val: new Float64Array(TT_SIZE), move: new Int16Array(TT_SIZE)
    };
  }

  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  Game.prototype.finalValue = function (p) { return (this.score[p] - this.score[3 - p]) * POINT * 10; };

  Game.prototype.negamax = function (depth, alpha, beta, p, ctx, ply) {
    if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) throw TIMEOUT;
    if (this.aliveTotal === 0) return this.finalValue(p);
    if (depth <= 0) return ctx.q ? this.qsearch(alpha, beta, p, ctx, ctx.q) : this.evaluate(p);
    var q = 3 - p, tt = ctx.tt, ttMove = -1, alpha0 = alpha;
    var h1 = this.h1 ^ (p === 2 ? 0x5bd1e995 : 0), idx = h1 & TT_MASK;
    if (tt) {
      if (tt.key[idx] === (this.h2 | 0) && tt.flag[idx]) {
        ttMove = tt.move[idx];
        if (tt.depth[idx] >= depth) {
          var tv = tt.val[idx], tf = tt.flag[idx];
          if (tf === EXACT) return tv;
          if (tf === LOWER && tv > alpha) alpha = tv;
          else if (tf === UPPER && tv < beta) beta = tv;
          if (alpha >= beta) return tv;
        }
      }
    }
    var cands = this.candidates(p, ctx.width);
    if (!cands.length) return this.finalValue(p);
    // move ordering: TT move, urgent (point / block four), killers, then h + history
    var kil = ctx.killers[ply] || (ctx.killers[ply] = [-1, -1]), hist = ctx.hist[p], i;
    for (i = 0; i < cands.length; i++) {
      var m = cands[i], key = m.h + hist[m.c];
      if (m.c === ttMove) key += 8 * BIG;
      else if (m.h >= 400000) key += 4 * BIG;
      else if (m.c === kil[0]) key += 2 * BIG;
      else if (m.c === kil[1]) key += BIG;
      m.k = key;
    }
    cands.sort(function (x, y) { return y.k - x.k; });
    var best = -Infinity, bestC = cands[0].c;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i].c, v;
      ctx.stack.push(this.play(c, p));
      if (i === 0) v = -this.negamax(depth - 1, -beta, -alpha, q, ctx, ply + 1);
      else {
        v = -this.negamax(depth - 1, -alpha - 1, -alpha, q, ctx, ply + 1);
        if (v > alpha && v < beta) v = -this.negamax(depth - 1, -beta, -alpha, q, ctx, ply + 1);
      }
      this.undo(ctx.stack.pop());
      if (v > best) { best = v; bestC = c; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (cands[i].h < 400000 && kil[0] !== c) { kil[1] = kil[0]; kil[0] = c; }
        hist[c] += depth * depth;
        break;
      }
    }
    if (tt) {
      tt.key[idx] = this.h2 | 0; tt.depth[idx] = depth; tt.val[idx] = best; tt.move[idx] = bestC;
      tt.flag[idx] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    }
    return best;
  };

  // Threat-space quiescence: only "forcing" moves are searched beyond the
  // horizon. If p can complete a four, it takes the point; otherwise it blocks
  // the opponent's fours; otherwise (while qd allows) it may create a four.
  // Stand pat = the static evaluation (which already prices pending fours).
  Game.prototype.qsearch = function (alpha, beta, p, ctx, qd) {
    if ((++ctx.nodes & 1023) === 0 && now() > ctx.deadline) throw TIMEOUT;
    ctx.qnodes++;
    if (this.aliveTotal === 0) return this.finalValue(p);
    var stand = this.evaluate(p);
    if (qd <= 0) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    var q = 3 - p, moves;
    if (this.fourCells[p]) moves = this.fourCellsOf(p).slice(0, 2);
    else if (this.fourCells[q]) {
      if (this.fourCells[q] > 2) return stand; // cannot block them all: eval already knows
      moves = this.fourCellsOf(q);
    } else if (qd >= 2) {
      moves = this.threeCellsOf(p);
      if (!moves.length) return stand;
      var hv = this.hv[p];
      moves.sort(function (x, y) { return hv[y] - hv[x]; });
      if (moves.length > 3) moves.length = 3;
    } else return stand;
    var best = stand;
    for (var i = 0; i < moves.length; i++) {
      ctx.stack.push(this.play(moves[i], p));
      var v = -this.qsearch(-beta, -alpha, q, ctx, qd - 1);
      this.undo(ctx.stack.pop());
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  // Chooses the move of player p. level 1..5. rnd: optional random() for tests.
  // opts: {time: ms budget, worker: true to use timeWorker, tt: false to disable}.
  // Details of the last search are left in this.lastInfo.
  Game.prototype.bestMove = function (p, level, rnd, opts) {
    rnd = rnd || Math.random; opts = opts || {};
    var L = LEVELS[level] || LEVELS[3], n = this.n, t0 = now();
    var info = this.lastInfo = { depth: 0, nodes: 0, qnodes: 0, ms: 0, level: level };
    if (this.moves === 0) {
      var m = (n >> 1) - 1 + Math.floor(rnd() * 2), m2 = (n >> 1) - 1 + Math.floor(rnd() * 2);
      return m2 * n + m;
    }
    var root = this.candidates(p, Math.max(L.width, 8));
    if (!root.length) return -1;
    if (L.depth <= 1 && root[0].h >= 400000 && (L.depth > 0 || rnd() < 0.6)) return root[0].c;
    if (L.depth === 0) {
      var pick = 0;
      while (pick < root.length - 1 && rnd() < L.noise) pick++;
      return root[pick].c;
    }
    var time = opts.time || (opts.worker && L.timeWorker) || L.time;
    var ctx = {
      nodes: 0, qnodes: 0, stack: [], deadline: t0 + time, width: L.width, q: opts.q != null ? opts.q : L.q,
      tt: opts.tt === false ? null : (this._tt || (this._tt = newTT())), killers: [],
      hist: [null, new Int32Array(n * n), new Int32Array(n * n)]
    };
    if (ctx.tt) ctx.tt.flag.fill(0); // fresh table for every search (levels differ in width)
    var maxDepth = opts.depth || L.depth;
    var scores = root.map(function (r, k) { return k ? -Infinity : 0; }), bestC = root[0].c;
    var margin = L.noise ? 64 : 4, q = 3 - p;
    for (var depth = 1; depth <= maxDepth; depth++) {
      try {
        var alpha = -Infinity, iterBest = -1, iterScores = [];
        for (var i = 0; i < root.length; i++) {
          var v;
          ctx.stack.push(this.play(root[i].c, p));
          {
            if (i === 0 || margin > 4) v = -this.negamax(depth - 1, -Infinity, -(alpha - margin), q, ctx, 1);
            else {
              // null window first: is this move within "margin" of the best?
              v = -this.negamax(depth - 1, -(alpha - margin + 1), -(alpha - margin), q, ctx, 1);
              if (v > alpha - margin) v = -this.negamax(depth - 1, -Infinity, -(alpha - margin), q, ctx, 1);
            }
          }
          this.undo(ctx.stack.pop());
          iterScores.push(v);
          if (v > alpha) { alpha = v; iterBest = i; }
        }
        bestC = root[iterBest].c;
        var order = root.map(function (r, k) { return { r: r, s: iterScores[k] }; });
        order.sort(function (a, b) { return b.s - a.s; });
        root = order.map(function (o) { return o.r; });
        scores = order.map(function (o) { return o.s; });
        info.depth = depth; info.score = scores[0];
        // a decided game (every point already settled) needs no deeper look
        if (Math.abs(scores[0]) >= POINT * 10 && depth >= 2) break;
        // the next iteration would very likely not finish in time
        if (now() - t0 > time * 0.45) break;
      } catch (e) {
        // unwind every move still on the board (the legacy engine only undid the root move)
        while (ctx.stack.length) this.undo(ctx.stack.pop());
        if (e !== TIMEOUT) throw e;
        break;
      }
    }
    info.nodes = ctx.nodes; info.qnodes = ctx.qnodes; info.ms = Math.round(now() - t0);
    var top = scores[0], pool = [];
    for (var j = 0; j < root.length; j++) if (scores[j] >= top - margin + 1) pool.push(root[j].c);
    if (pool.length > 1 && pool.indexOf(bestC) >= 0) return pool[Math.floor(rnd() * pool.length)];
    return bestC;
  };

  // Rebuilds a game from a list of moves [[cell, player], ...] (worker, undo).
  function replay(n, moves, weights) {
    var g = new Game(n, weights);
    for (var i = 0; i < moves.length; i++) g.play(moves[i][0], moves[i][1]);
    return g;
  }

  var api = { Game: Game, DIRS: DIRS, LEVELS: LEVELS, WEIGHTS: WEIGHTS, POINT: POINT, replay: replay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MorpionEngine = api;
})(this);
