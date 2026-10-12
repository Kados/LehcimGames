/*
 * Agora - rules engine and computer player (no DOM, also loadable from node).
 * Board: 6x6 squares, index = row*6 + col (row 0 = far side, row 5 = the player's side).
 * Colours: 0 = white, 1 = black.
 *
 * The board is terraced like the original (observed in the real program):
 * the outer ring is the highest level, the middle ring is 3 piece thicknesses
 * lower and the central 2x2 square 2 more thicknesses lower. "Height" in the
 * capture / prisoner rules is the real height of the top of a stack:
 * LEVEL[square] + number of pieces (in piece thicknesses).
 *
 * A stack never holds more than two segments: the controlling pieces on top
 * (colour col[i], count top[i]) and, underneath, the prisoners of the other
 * colour (count bot[i]). Rules guarantee top[i] >= bot[i] after every move:
 *  - capture: every opponent piece of the target stack is flipped, so the
 *    stack becomes one colour;
 *  - prisoner: the piece slides under; if the prisoners become the majority
 *    the controllers are flipped (revolution);
 *  - leaving a stack: if the remaining controllers become the minority they
 *    are flipped (the prisoners take over).
 * Exposes the global AgoraRules (or module.exports under node).
 */
(function (root) {
  'use strict';

  var N = 6, SIZE = N * N;
  var SIMPLE = 0, STACK = 1, CAPTURE = 2, PRISON = 3; // move kinds

  // Height of each square's floor, in piece thicknesses: outer ring 5, middle ring 2, centre 0.
  var LEVEL = [];
  for (var q = 0; q < N * N; q++) {
    var ring = Math.min((q / N) | 0, q % N, N - 1 - ((q / N) | 0), N - 1 - q % N);
    LEVEL.push(ring === 0 ? 5 : ring === 1 ? 2 : 0);
  }

  // Neighbour lists (8 directions).
  var NEIGH = [];
  for (var i = 0; i < SIZE; i++) {
    var r = (i / N) | 0, c = i % N, l = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) l.push(rr * N + cc);
    }
    NEIGH.push(l);
  }

  // ---------- Position ----------

  function Pos() {
    this.col = new Int8Array(SIZE).fill(-1); // colour of the top segment, -1 = empty
    this.top = new Int8Array(SIZE);          // pieces of the controlling colour
    this.bot = new Int8Array(SIZE);          // prisoners (other colour) underneath
    this.side = 0;                           // player to move
  }
  Pos.prototype.clone = function () {
    var p = new Pos();
    p.col.set(this.col); p.top.set(this.top); p.bot.set(this.bot); p.side = this.side;
    return p;
  };
  Pos.prototype.height = function (i) { return this.top[i] + this.bot[i]; };
  // Stack as an array bottom -> top of colours (for drawing).
  Pos.prototype.stack = function (i) {
    var s = [], k;
    if (this.col[i] < 0) return s;
    for (k = 0; k < this.bot[i]; k++) s.push(1 - this.col[i]);
    for (k = 0; k < this.top[i]; k++) s.push(this.col[i]);
    return s;
  };
  Pos.prototype.key = function () {
    var s = this.side + ':';
    for (var i = 0; i < SIZE; i++) s += this.col[i] < 0 ? '.' : (this.col[i] + '' + this.top[i] + this.bot[i]);
    return s;
  };
  // Builds a position from stacks given bottom -> top (arrays of 0/1). Returns null if impossible.
  Pos.fromStacks = function (stacks, side) {
    var p = new Pos(); p.side = side || 0;
    for (var i = 0; i < SIZE; i++) {
      var s = stacks[i] || [];
      if (!s.length) continue;
      var c = s[s.length - 1], k = s.length - 1, t = 0;
      while (k >= 0 && s[k] === c) { t++; k--; }
      var b = k + 1;
      for (; k >= 0; k--) if (s[k] === c) return null; // three segments
      if (b > t) return null;                           // prisoners in majority
      p.col[i] = c; p.top[i] = t; p.bot[i] = b;
    }
    return p;
  };

  // Opening of the original: each side has its 6 pieces on its back row plus the
  // two squares in front of its corners. `front` is the colour placed on rows 4-5
  // (the player's side, near the camera); the other colour gets rows 0-1.
  function initial(front) {
    front = front || 0;
    var p = new Pos();
    for (var c = 0; c < N; c++) { put(p, 5 * N + c, front); put(p, c, 1 - front); }
    put(p, 4 * N, front); put(p, 4 * N + 5, front);
    put(p, N, 1 - front); put(p, N + 5, 1 - front);
    return p;
  }
  function put(p, i, c) { p.col[i] = c; p.top[i] = 1; p.bot[i] = 0; }

  // ---------- Moves ----------
  // A move is an int: from | to << 6 | kind << 12.
  function mk(f, t, k) { return f | (t << 6) | (k << 12); }
  function mFrom(m) { return m & 63; }
  function mTo(m) { return (m >> 6) & 63; }
  function mKind(m) { return m >> 12; }

  // Number of pieces of colour c (free pieces and prisoners) on the 8 neighbouring squares.
  // A piece is isolated when this is exactly 1: it touches a single piece of its colour.
  function ownNeighbours(p, i, c) {
    var n = 0, l = NEIGH[i];
    for (var k = 0; k < l.length; k++) {
      var j = l[k];
      if (p.col[j] === c) n += p.top[j]; else if (p.col[j] === 1 - c) n += p.bot[j];
    }
    return n;
  }
  // Height of the top of the stack on square i (floor level + pieces).
  function topHeight(p, i) { return LEVEL[i] + p.top[i] + p.bot[i]; }

  // All legal moves for the side to move (or for square `only`).
  function moves(p, only) {
    var out = [], me = p.side;
    for (var f = 0; f < SIZE; f++) {
      if (p.col[f] !== me || (only != null && f !== only)) continue;
      var hf = topHeight(p, f), l = NEIGH[f], isolated = ownNeighbours(p, f, me) === 1;
      for (var k = 0; k < l.length; k++) {
        var t = l[k], ct = p.col[t];
        if (ct < 0) out.push(mk(f, t, SIMPLE));
        else if (ct === me) { if (isolated) out.push(mk(f, t, STACK)); }
        else {
          var ht = topHeight(p, t);
          if (hf >= ht) out.push(mk(f, t, CAPTURE));
          if (hf <= ht) out.push(mk(f, t, PRISON));
        }
      }
    }
    return out;
  }

  // Plays m on p (in place). Returns an undo record; info gets flags {revolt, freed}.
  function play(p, m, info) {
    var f = mFrom(m), t = mTo(m), kind = mKind(m), me = p.side;
    var u = [f, p.col[f], p.top[f], p.bot[f], t, p.col[t], p.top[t], p.bot[t]];
    // 1. the top piece leaves its stack
    p.top[f]--;
    if (p.top[f] === 0) {
      if (p.bot[f] > 0) { p.col[f] = 1 - me; p.top[f] = p.bot[f]; p.bot[f] = 0; if (info) info.freed = true; }
      else p.col[f] = -1;
    } else if (p.top[f] < p.bot[f]) {
      // our remaining pieces are now the minority: they are flipped
      p.col[f] = 1 - me; p.top[f] += p.bot[f]; p.bot[f] = 0; if (info) info.lost = true;
    }
    // 2. it arrives on the target
    if (kind === SIMPLE) { p.col[t] = me; p.top[t] = 1; p.bot[t] = 0; }
    else if (kind === STACK) { p.top[t]++; }
    else if (kind === CAPTURE) { p.top[t] += p.bot[t] + 1; p.bot[t] = 0; p.col[t] = me; }
    else { // PRISON
      p.bot[t]++;
      if (p.bot[t] > p.top[t]) { p.col[t] = me; p.top[t] += p.bot[t]; p.bot[t] = 0; if (info) info.revolt = true; }
    }
    p.side = 1 - me;
    return u;
  }
  function undo(p, u) {
    p.col[u[0]] = u[1]; p.top[u[0]] = u[2]; p.bot[u[0]] = u[3];
    p.col[u[4]] = u[5]; p.top[u[4]] = u[6]; p.bot[u[4]] = u[7];
    p.side = 1 - p.side;
  }

  // Counts for display: free pieces (controllers) and prisoners per colour.
  function counts(p) {
    var r = { free: [0, 0], prisoners: [0, 0], stacks: [0, 0] };
    for (var i = 0; i < SIZE; i++) {
      var c = p.col[i]; if (c < 0) continue;
      r.free[c] += p.top[i]; r.prisoners[1 - c] += p.bot[i]; r.stacks[c]++;
    }
    return r;
  }

  // ---------- Computer player: alpha-beta, iterative deepening ----------

  var WIN = 100000;

  // Static evaluation from the point of view of the side to move.
  function evaluate(p) {
    var me = p.side, s = 0, i, c, h;
    for (i = 0; i < SIZE; i++) {
      c = p.col[i]; if (c < 0) continue;
      h = p.top[i] + p.bot[i];
      var v = 0;
      v += p.top[i] * 10;            // pieces of the controlling colour
      v += 14;                       // a controlled stack = a piece able to move
      v += Math.min(h + LEVEL[i], 9);  // high stacks (and high squares) can capture more
      v -= p.bot[i] * 6;             // prisoners held under us are a revolt risk...
      if (p.top[i] - p.bot[i] <= 1 && p.bot[i] > 0) v -= 4;
      s += c === me ? v : -v;
      if (p.bot[i]) s += (1 - c === me ? 1 : -1) * p.bot[i] * 4; // ...and still worth something to their owner
    }
    // mobility of both sides
    var m1 = moves(p).length; p.side = 1 - me; var m2 = moves(p).length; p.side = me;
    s += (m1 - m2) * 2;
    return s;
  }

  function Search(timeMs, maxDepth) {
    this.deadline = Date.now() + timeMs; this.maxDepth = maxDepth; this.nodes = 0; this.stop = false;
  }
  Search.prototype.ab = function (p, depth, alpha, beta, ply) {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    var ms = moves(p);
    if (!ms.length) return -WIN + ply;           // cannot play: lost
    if (depth <= 0) return evaluate(p);
    order(p, ms);
    var best = -Infinity;
    for (var k = 0; k < ms.length; k++) {
      var u = play(p, ms[k]);
      var v = -this.ab(p, depth - 1, -beta, -alpha, ply + 1);
      undo(p, u);
      if (this.stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  };
  // Captures and prisoner moves first (cheap move ordering).
  function order(p, ms) {
    ms.sort(function (a, b) { return score(b) - score(a); });
    function score(m) { var k = mKind(m); return k === CAPTURE ? 3 + p.height(mTo(m)) : k === PRISON ? 2 : 0; }
  }

  // Best move for p.side. level 1..3. Returns a move int or -1.
  function think(p, level, timeMs) {
    p = p.clone();
    var ms = moves(p);
    if (!ms.length) return -1;
    var depthMax = [0, 2, 4, 9][level] || 4;
    timeMs = timeMs || [0, 150, 450, 900][level];
    var s = new Search(timeMs, depthMax), best = ms[0], scores = [];
    order(p, ms);
    for (var d = 1; d <= depthMax; d++) {
      var alpha = -Infinity, bestD = -1, sc = [];
      for (var k = 0; k < ms.length; k++) {
        var u = play(p, ms[k]);
        var v = -s.ab(p, d - 1, -Infinity, -alpha, 1);
        undo(p, u);
        if (s.stop) break;
        sc.push([v, ms[k]]);
        if (v > alpha) { alpha = v; bestD = ms[k]; }
      }
      if (s.stop && bestD < 0) break;
      if (bestD >= 0) { best = bestD; scores = sc; }
      if (s.stop) break;
      // search the best move first next iteration
      ms.splice(ms.indexOf(best), 1); ms.unshift(best);
      if (alpha > WIN / 2) break;
    }
    // level 1: some randomness among near-equal moves
    if (level === 1 && scores.length) {
      scores.sort(function (a, b) { return b[0] - a[0]; });
      var ok = scores.filter(function (e) { return e[0] >= scores[0][0] - 12; });
      best = ok[(Math.random() * ok.length) | 0][1];
    }
    return best;
  }

  var api = {
    N: N, SIZE: SIZE, SIMPLE: SIMPLE, STACK: STACK, CAPTURE: CAPTURE, PRISON: PRISON,
    NEIGH: NEIGH, LEVEL: LEVEL, Pos: Pos, initial: initial, moves: moves, play: play, undo: undo, topHeight: topHeight,
    mk: mk, mFrom: mFrom, mTo: mTo, mKind: mKind, counts: counts, evaluate: evaluate, think: think,
    ownNeighbours: ownNeighbours
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AgoraRules = api;
})(this);
