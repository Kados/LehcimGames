/*
 * Morpion - rules engine and computer player (no DOM, also loadable in node).
 *
 * Board: N x N cells, 0 = empty, 1 = player (grey), 2 = computer (orange).
 * Every possible segment of 5 cells ("window") is precomputed, in 4 directions.
 *
 * Scoring rule, as observed in the original running under Wine:
 *   - a completed 5-window of one colour scores 1 point and is crossed out;
 *   - a marble may be part of several scored lines in different directions;
 *   - in the SAME direction two lines may share only their end marble
 *     (6, 7 or 8 in a row = 1 point; 9 in a row = 2 points when scored as
 *     0-4 and 4-8). In other words a window can score only if none of its
 *     3 inner cells is already crossed out in its direction.
 * The game ends when no window is still achievable for anybody: every window
 * either holds both colours, has a crossed-out inner cell in its direction,
 * or is full.
 * Exposes: MorpionEngine (global, or module.exports under node).
 */
(function (root) {
  'use strict';

  var DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]]; // horizontal, vertical, "\", "/"
  var POINT = 10000;                              // eval value of one point

  // ---------- Board / rules ----------

  function Game(n) {
    this.n = n;
    var cells = n * n, wins = [], i;
    this.board = new Uint8Array(cells);
    // windows
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
    this.cellWins = [];     // cell -> windows containing it
    this.cellDirWins = [];  // cell*4+d -> windows of direction d containing it (in order of start)
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
    this.cnt = [null, new Uint8Array(W), new Uint8Array(W)]; // marbles of each colour per window
    this.usedCnt = new Uint8Array(W);  // crossed-out INNER cells (same direction) per window
    this.used = new Uint8Array(cells * 4); // number of lines crossing out cell c in direction d
    this.score = [0, 0, 0];
    this.lines = [];                   // scored windows: {w, p}
    this.moves = 0;
  }

  // Drops a marble of player p on cell c. Returns an undo record {c, p, scored:[w...]}.
  // One marble can score several lines of the same direction (filling the middle
  // of 9 in a row scores 0-4 and 4-8).
  Game.prototype.play = function (c, p) {
    var cw = this.cellWins[c], cnt = this.cnt[p], i;
    this.board[c] = p; this.moves++;
    for (i = 0; i < cw.length; i++) cnt[cw[i]]++;
    var scored = [];
    for (var d = 0; d < 4; d++) {
      var dw = this.cellDirWins[c * 4 + d];
      for (i = 0; i < dw.length; i++) {
        var w = dw[i];
        if (cnt[w] === 5 && this.usedCnt[w] === 0) { this.mark(w, 1); scored.push(w); }
      }
    }
    for (i = 0; i < scored.length; i++) this.lines.push({ w: scored[i], p: p });
    this.score[p] += scored.length;
    return { c: c, p: p, scored: scored };
  };

  Game.prototype.undo = function (rec) {
    var cw = this.cellWins[rec.c], cnt = this.cnt[rec.p], i;
    for (i = rec.scored.length - 1; i >= 0; i--) { this.mark(rec.scored[i], -1); this.lines.pop(); }
    this.score[rec.p] -= rec.scored.length;
    for (i = 0; i < cw.length; i++) cnt[cw[i]]--;
    this.board[rec.c] = 0; this.moves--;
  };

  // Crosses out (s = 1) or restores (s = -1) the 5 cells of window w in its direction.
  // usedCnt[v] counts the inner cells (positions 1..3) of window v that are crossed out.
  Game.prototype.mark = function (w, s) {
    var d = this.wDir[w], wc = this.wCells;
    for (var i = 0; i < 5; i++) {
      var x = wc[w * 5 + i], k = x * 4 + d, before = this.used[k];
      this.used[k] += s;
      if ((before === 0) === (this.used[k] === 0)) continue; // shared end: no change
      var dw = this.cellDirWins[k];
      for (var j = 0; j < dw.length; j++) {
        var v = dw[j];
        if (wc[v * 5] !== x && wc[v * 5 + 4] !== x) this.usedCnt[v] += s;
      }
    }
  };

  // A window is "alive" if someone can still complete it.
  Game.prototype.alive = function (w) {
    var a = this.cnt[1][w], b = this.cnt[2][w];
    return this.usedCnt[w] === 0 && (a === 0 || b === 0) && a + b < 5;
  };

  // True when neither player can still score (the original's automatic stop).
  Game.prototype.over = function () {
    for (var w = 0; w < this.W; w++) if (this.alive(w)) return false;
    return true;
  };

  // Empty cells lying in at least one alive window.
  Game.prototype.usefulCells = function () {
    var out = [], seen = new Uint8Array(this.n * this.n);
    for (var w = 0; w < this.W; w++) {
      if (!this.alive(w)) continue;
      for (var i = 0; i < 5; i++) {
        var c = this.wCells[w * 5 + i];
        if (!this.board[c] && !seen[c]) { seen[c] = 1; out.push(c); }
      }
    }
    return out;
  };

  // ---------- Evaluation ----------

  var VAL = [0, 2, 12, 70, 160];        // open window with k marbles
  var ATT = [1, 5, 24, 150, 1000000];   // move ordering: extending my window to k+1
  var DEF = [0, 4, 18, 120, 400000];    // move ordering: blocking a window of k

  // Quick interest of cell c for player p (used to order / prune moves).
  Game.prototype.cellValue = function (c, p) {
    var q = 3 - p, cw = this.cellWins[c], h = 0;
    for (var i = 0; i < cw.length; i++) {
      var w = cw[i];
      if (this.usedCnt[w]) continue;
      var a = this.cnt[p][w], b = this.cnt[q][w];
      if (b === 0) h += ATT[a];
      if (a === 0) h += DEF[b];
    }
    return h;
  };

  // Static evaluation from the point of view of p, who is to move.
  Game.prototype.evaluate = function (p) {
    var q = 3 - p, s = (this.score[p] - this.score[q]) * POINT, i, w;
    var c1 = this.cnt[p], c2 = this.cnt[q], fourP = [], fourQ = [];
    for (w = 0; w < this.W; w++) {
      if (this.usedCnt[w]) continue;
      var a = c1[w], b = c2[w];
      if (a && b) continue;
      if (a) {
        s += VAL[a];
        if (a === 4) fourP.push(emptyOf(this, w));
      } else if (b) {
        s -= VAL[b];
        if (b === 4) fourQ.push(emptyOf(this, w));
      }
    }
    // Threats: p moves next, so one open four of p is (almost) a point;
    // q's fours are only sure points when p cannot block them all.
    var fp = distinct(fourP), fq = distinct(fourQ);
    if (fp) s += POINT * 0.9 + (fp - 1) * POINT * 0.5;
    else if (fq) s -= (fq - 1) * POINT * 0.8 + 300;
    return s;
  };

  function emptyOf(g, w) {
    for (var i = 0; i < 5; i++) { var c = g.wCells[w * 5 + i]; if (!g.board[c]) return c; }
    return -1;
  }
  function distinct(arr) {
    if (arr.length < 2) return arr.length;
    var seen = {}, n = 0;
    for (var i = 0; i < arr.length; i++) if (!seen[arr[i]]) { seen[arr[i]] = 1; n++; }
    return n;
  }

  // Candidate moves for p, best first, at most k of them.
  Game.prototype.candidates = function (p, k) {
    var cells = this.usefulCells(), list = [];
    for (var i = 0; i < cells.length; i++) list.push({ c: cells[i], h: this.cellValue(cells[i], p) });
    list.sort(function (a, b) { return b.h - a.h; });
    if (k && list.length > k) list.length = k;
    return list;
  };

  // ---------- Search (negamax + alpha-beta, iterative deepening, time-bounded) ----------

  var TIMEOUT = {};

  // Level 1..5 -> search settings. The original announces 0.5 s, 1 s, 12 s, 25 s and
  // 1 min 40 s on the 10-10 board (1995 PCs); under Wine today level 1 answers at
  // once, level 3 in 2-4 s and level 5 in about 10 s. Even level 1 blocks every
  // threat, so its noise stays small. 'wait' = minimum thinking time shown (ms).
  var LEVELS = [
    null,
    { depth: 0, width: 8, time: 100, noise: 0.15, wait: 300 },
    { depth: 2, width: 6, time: 400, noise: 0, wait: 700 },
    { depth: 3, width: 12, time: 1200, noise: 0, wait: 1800 },
    { depth: 4, width: 12, time: 2200, noise: 0, wait: 2800 },
    { depth: 6, width: 10, time: 3800, noise: 0, wait: 4500 }
  ];

  Game.prototype.negamax = function (depth, alpha, beta, p, ctx) {
    if ((++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) throw TIMEOUT;
    var q = 3 - p;
    var cands = this.candidates(p, ctx.width);
    if (!cands.length) return (this.score[p] - this.score[q]) * POINT * 10; // final result
    if (depth === 0) return this.evaluate(p);
    var best = -Infinity;
    for (var i = 0; i < cands.length; i++) {
      var rec = this.play(cands[i].c, p), v;
      // try/finally: when the search times out (TIMEOUT thrown deep in the tree),
      // every move of the current line is undone, not only the root move.
      try { v = -this.negamax(depth - 1, -beta, -alpha, q, ctx); }
      finally { this.undo(rec); }
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };

  // Chooses the move of player p. level 1..5. rnd: optional random() for tests.
  Game.prototype.bestMove = function (p, level, rnd) {
    rnd = rnd || Math.random;
    var L = LEVELS[level] || LEVELS[3], n = this.n;
    if (this.moves === 0) { // first marble: always (N/2-1, N/2-1), as in the original
      var m = (n >> 1) - 1;
      return m * n + m;
    }
    var root = this.candidates(p, Math.max(L.width, 8));
    if (!root.length) return -1;
    // immediate point or urgent block: no need to think (the original blocks at every level)
    if (root[0].h >= 400000) return root[0].c;
    if (L.depth === 0) { // level 1: greedy with a lot of randomness
      var pick = 0;
      while (pick < root.length - 1 && rnd() < L.noise) pick++;
      return root[pick].c;
    }
    var ctx = { nodes: 0, deadline: Date.now() + L.time, width: L.width };
    var scores = root.map(function (r, k) { return k ? -Infinity : 0; }), bestC = root[0].c;
    var margin = L.noise ? 64 : 4; // exact scores for moves within margin of the best
    for (var depth = 1; depth <= L.depth; depth++) {
      try {
        var alpha = -Infinity, iterBest = -1, iterScores = [];
        for (var i = 0; i < root.length; i++) {
          var rec = this.play(root[i].c, p);
          var v;
          try { v = -this.negamax(depth - 1, -Infinity, -(alpha - margin), 3 - p, ctx); }
          finally { this.undo(rec); }
          iterScores.push(v);
          if (v > alpha) { alpha = v; iterBest = i; }
        }
        scores = iterScores; bestC = root[iterBest].c;
        // reorder the root for the next iteration
        var order = root.map(function (r, k) { return { r: r, s: iterScores[k] }; });
        order.sort(function (a, b) { return b.s - a.s; });
        root = order.map(function (o) { return o.r; });
        scores = order.map(function (o) { return o.s; });
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        break;
      }
    }
    // a little variety among (almost) equal moves, plus noise at low levels
    var top = scores[0], pool = [];
    for (var j = 0; j < root.length; j++) {
      if (scores[j] >= top - margin + 1) pool.push(root[j].c);
    }
    if (pool.length > 1 && pool.indexOf(bestC) >= 0) return pool[Math.floor(rnd() * pool.length)];
    return bestC;
  };

  var api = { Game: Game, DIRS: DIRS, LEVELS: LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MorpionEngine = api;
})(this);
