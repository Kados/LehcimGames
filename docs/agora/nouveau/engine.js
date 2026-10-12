/*
 * Agora (nouvelle version) - rules engine and computer player.
 * No DOM: loaded by the page, by the Web Worker (importScripts) and by node.
 *
 * Board: 6x6 squares, index = row*6 + col. Colours: 0 = white, 1 = black.
 * A stack never holds more than two segments: the controlling pieces on top
 * (colour col[i], count top[i]) and, underneath, the prisoners of the other
 * colour (count bot[i]); top[i] >= bot[i] always holds (same rules as the
 * original version, see ../rules.js).
 *
 * Improvements over the original computer player:
 *  - Zobrist hashing (two 32-bit keys, updated incrementally by play/undo);
 *  - transposition table (depth, score, bound, best move), kept between moves;
 *  - move ordering: TT move, captures / revolutions, killer moves, history;
 *  - principal variation search (null windows after the first move);
 *  - quiescence search on captures and revolutions (horizon effect);
 *  - cheaper evaluation: mobility counted without building move lists and
 *    the move list of the leaf reused (the original generated it 3 times);
 *  - draw rules known by the search: a repeated position (game history or
 *    current line) and the 400 move limit score 0.
 * Exposes the global AgoraEngine (or module.exports under node).
 */
(function (root) {
  'use strict';

  var N = 6, SIZE = N * N;
  var SIMPLE = 0, STACK = 1, CAPTURE = 2, PRISON = 3; // move kinds
  var MAX_PLIES = 400;                                // draw after 400 moves

  // Neighbour lists (8 directions), flat for speed: NB[i*8 .. i*8+NC[i]-1].
  var NEIGH = [], NB = new Int8Array(SIZE * 8), NC = new Int8Array(SIZE);
  for (var i = 0; i < SIZE; i++) {
    var r = (i / N) | 0, c = i % N, l = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) l.push(rr * N + cc);
    }
    NEIGH.push(l); NC[i] = l.length;
    for (var k = 0; k < l.length; k++) NB[i * 8 + k] = l[k];
  }

  // ---------- Zobrist keys ----------
  // One pair of random 32-bit numbers per (square, colour, top, bot); empty = 0.
  var ZT = 17; // top and bot are at most 16
  var Z1 = new Int32Array(SIZE * 2 * ZT * ZT), Z2 = new Int32Array(SIZE * 2 * ZT * ZT);
  var ZS1, ZS2;
  (function () {
    var s = 0x9e3779b9 | 0;
    function rnd() { // mulberry32
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) | 0;
    }
    for (var k = 0; k < Z1.length; k++) { Z1[k] = rnd(); Z2[k] = rnd(); }
    ZS1 = rnd(); ZS2 = rnd();
  })();
  function zi(i, c, t, b) { return ((i * 2 + c) * ZT + t) * ZT + b; }

  // ---------- Position ----------

  function Pos() {
    this.col = new Int8Array(SIZE).fill(-1); // colour of the top segment, -1 = empty
    this.top = new Int8Array(SIZE);          // pieces of the controlling colour
    this.bot = new Int8Array(SIZE);          // prisoners (other colour) underneath
    this.side = 0;                           // player to move
    this.h1 = 0; this.h2 = 0;                // Zobrist hash
  }
  Pos.prototype.clone = function () {
    var p = new Pos();
    p.col.set(this.col); p.top.set(this.top); p.bot.set(this.bot); p.side = this.side;
    p.h1 = this.h1; p.h2 = this.h2;
    return p;
  };
  Pos.prototype.rehash = function () {
    var a = 0, b = 0;
    for (var i = 0; i < SIZE; i++) if (this.col[i] >= 0) {
      var z = zi(i, this.col[i], this.top[i], this.bot[i]); a ^= Z1[z]; b ^= Z2[z];
    }
    if (this.side) { a ^= ZS1; b ^= ZS2; }
    this.h1 = a; this.h2 = b;
    return this;
  };
  Pos.prototype.setSide = function (s) { if (s !== this.side) { this.side = s; this.h1 ^= ZS1; this.h2 ^= ZS2; } return this; };
  Pos.prototype.height = function (i) { return this.top[i] + this.bot[i]; };
  // Stack as an array bottom -> top of colours (for drawing).
  Pos.prototype.stack = function (i) {
    var s = [], k;
    if (this.col[i] < 0) return s;
    for (k = 0; k < this.bot[i]; k++) s.push(1 - this.col[i]);
    for (k = 0; k < this.top[i]; k++) s.push(this.col[i]);
    return s;
  };
  // Compact key of the position (repetitions); the hash pair as a string.
  Pos.prototype.key = function () { return (this.h1 >>> 0).toString(36) + '.' + (this.h2 >>> 0).toString(36); };
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
    return p.rehash();
  };
  Pos.prototype.toStacks = function () { var s = []; for (var i = 0; i < SIZE; i++) s.push(this.stack(i)); return s; };

  // Default opening (same as the original version): the 16 border squares that
  // are not corners, each side reading B W W B or W B B W.
  function initial() {
    var p = new Pos();
    var rows = { 0: [0, 1, 1, 0], 5: [1, 0, 0, 1] };
    var cols = { 0: [0, 1, 1, 0], 5: [1, 0, 0, 1] };
    for (var k = 0; k < 4; k++) {
      put(p, 0 * N + k + 1, rows[0][k]); put(p, 5 * N + k + 1, rows[5][k]);
      put(p, (k + 1) * N + 0, cols[0][k]); put(p, (k + 1) * N + 5, cols[5][k]);
    }
    return p.rehash();
  }
  function put(p, i, c) { p.col[i] = c; p.top[i] = 1; p.bot[i] = 0; }

  // ---------- Moves ----------
  // A move is an int: from | to << 6 | kind << 12 (always < 16384).
  function mk(f, t, k) { return f | (t << 6) | (k << 12); }
  function mFrom(m) { return m & 63; }
  function mTo(m) { return (m >> 6) & 63; }
  function mKind(m) { return m >> 12; }

  function ownNeighbours(p, i, c) {
    var n = 0, b = i * 8, e = b + NC[i], col = p.col;
    for (var k = b; k < e; k++) if (col[NB[k]] === c) n++;
    return n;
  }

  // Fills buf with the legal moves of the side to move; returns their number.
  function gen(p, buf) {
    var n = 0, me = p.side, col = p.col, top = p.top, bot = p.bot;
    for (var f = 0; f < SIZE; f++) {
      if (col[f] !== me) continue;
      var hf = top[f] + bot[f], b = f * 8, e = b + NC[f], isolated = -1;
      for (var k = b; k < e; k++) {
        var t = NB[k], ct = col[t];
        if (ct < 0) buf[n++] = f | (t << 6);
        else if (ct === me) {
          if (isolated < 0) isolated = ownNeighbours(p, f, me) === 1 ? 1 : 0;
          if (isolated) buf[n++] = f | (t << 6) | (STACK << 12);
        } else {
          var ht = top[t] + bot[t];
          if (hf >= ht) buf[n++] = f | (t << 6) | (CAPTURE << 12);
          if (hf <= ht) buf[n++] = f | (t << 6) | (PRISON << 12);
        }
      }
    }
    return n;
  }
  // Number of legal moves of colour s (no allocation).
  function countMoves(p, s) {
    var n = 0, col = p.col, top = p.top, bot = p.bot;
    for (var f = 0; f < SIZE; f++) {
      if (col[f] !== s) continue;
      var hf = top[f] + bot[f], b = f * 8, e = b + NC[f], own = 0;
      for (var k = b; k < e; k++) {
        var t = NB[k], ct = col[t];
        if (ct < 0) n++;
        else if (ct === s) own++;
        else { var ht = top[t] + bot[t]; n += (hf >= ht ? 1 : 0) + (hf <= ht ? 1 : 0); }
      }
      if (own === 1) n++;
    }
    return n;
  }
  // All legal moves (array) for the side to move, or for square `only`.
  var genBuf = new Int32Array(512);
  function moves(p, only) {
    var n = gen(p, genBuf), out = [];
    for (var k = 0; k < n; k++) if (only == null || (genBuf[k] & 63) === only) out.push(genBuf[k]);
    return out;
  }

  // Plays m on p (in place). Returns an undo record; info gets flags {revolt, freed, lost}.
  function play(p, m, info) {
    var f = m & 63, t = (m >> 6) & 63, kind = m >> 12, me = p.side;
    var col = p.col, top = p.top, bot = p.bot;
    var u = [f, col[f], top[f], bot[f], t, col[t], top[t], bot[t], p.h1, p.h2];
    var h1 = p.h1 ^ ZS1, h2 = p.h2 ^ ZS2, z;
    z = zi(f, col[f], top[f], bot[f]); h1 ^= Z1[z]; h2 ^= Z2[z];
    if (col[t] >= 0) { z = zi(t, col[t], top[t], bot[t]); h1 ^= Z1[z]; h2 ^= Z2[z]; }
    // 1. the top piece leaves its stack
    top[f]--;
    if (top[f] === 0) {
      if (bot[f] > 0) { col[f] = 1 - me; top[f] = bot[f]; bot[f] = 0; if (info) info.freed = true; }
      else col[f] = -1;
    } else if (top[f] < bot[f]) {
      col[f] = 1 - me; top[f] += bot[f]; bot[f] = 0; if (info) info.lost = true;
    }
    // 2. it arrives on the target
    if (kind === SIMPLE) { col[t] = me; top[t] = 1; bot[t] = 0; }
    else if (kind === STACK) { top[t]++; }
    else if (kind === CAPTURE) { top[t] += bot[t] + 1; bot[t] = 0; col[t] = me; }
    else {
      bot[t]++;
      if (bot[t] > top[t]) { col[t] = me; top[t] += bot[t]; bot[t] = 0; if (info) info.revolt = true; }
    }
    if (col[f] >= 0) { z = zi(f, col[f], top[f], bot[f]); h1 ^= Z1[z]; h2 ^= Z2[z]; }
    z = zi(t, col[t], top[t], bot[t]); h1 ^= Z1[z]; h2 ^= Z2[z];
    p.h1 = h1; p.h2 = h2;
    p.side = 1 - me;
    return u;
  }
  function undo(p, u) {
    p.col[u[0]] = u[1]; p.top[u[0]] = u[2]; p.bot[u[0]] = u[3];
    p.col[u[4]] = u[5]; p.top[u[4]] = u[6]; p.bot[u[4]] = u[7];
    p.h1 = u[8]; p.h2 = u[9];
    p.side = 1 - p.side;
  }
  // Undo without allocation, used by the search: saves into an Int32Array slot.
  function playS(p, m, sv, o) {
    var f = m & 63, t = (m >> 6) & 63;
    sv[o] = p.col[f]; sv[o + 1] = p.top[f]; sv[o + 2] = p.bot[f];
    sv[o + 3] = p.col[t]; sv[o + 4] = p.top[t]; sv[o + 5] = p.bot[t];
    sv[o + 6] = p.h1; sv[o + 7] = p.h2;
    play2(p, m);
  }
  function undoS(p, m, sv, o) {
    var f = m & 63, t = (m >> 6) & 63;
    p.col[f] = sv[o]; p.top[f] = sv[o + 1]; p.bot[f] = sv[o + 2];
    p.col[t] = sv[o + 3]; p.top[t] = sv[o + 4]; p.bot[t] = sv[o + 5];
    p.h1 = sv[o + 6]; p.h2 = sv[o + 7];
    p.side = 1 - p.side;
  }
  // play() without the undo array (search).
  function play2(p, m) {
    var f = m & 63, t = (m >> 6) & 63, kind = m >> 12, me = p.side;
    var col = p.col, top = p.top, bot = p.bot;
    var h1 = p.h1 ^ ZS1, h2 = p.h2 ^ ZS2, z;
    z = zi(f, col[f], top[f], bot[f]); h1 ^= Z1[z]; h2 ^= Z2[z];
    if (col[t] >= 0) { z = zi(t, col[t], top[t], bot[t]); h1 ^= Z1[z]; h2 ^= Z2[z]; }
    top[f]--;
    if (top[f] === 0) {
      if (bot[f] > 0) { col[f] = 1 - me; top[f] = bot[f]; bot[f] = 0; }
      else col[f] = -1;
    } else if (top[f] < bot[f]) { col[f] = 1 - me; top[f] += bot[f]; bot[f] = 0; }
    if (kind === SIMPLE) { col[t] = me; top[t] = 1; bot[t] = 0; }
    else if (kind === STACK) { top[t]++; }
    else if (kind === CAPTURE) { top[t] += bot[t] + 1; bot[t] = 0; col[t] = me; }
    else { bot[t]++; if (bot[t] > top[t]) { col[t] = me; top[t] += bot[t]; bot[t] = 0; } }
    if (col[f] >= 0) { z = zi(f, col[f], top[f], bot[f]); h1 ^= Z1[z]; h2 ^= Z2[z]; }
    z = zi(t, col[t], top[t], bot[t]); h1 ^= Z1[z]; h2 ^= Z2[z];
    p.h1 = h1; p.h2 = h2; p.side = 1 - me;
  }

  // Counts for display: free pieces (controllers), prisoners and stacks per colour.
  function counts(p) {
    var r = { free: [0, 0], prisoners: [0, 0], stacks: [0, 0], tallest: [0, 0] };
    for (var i = 0; i < SIZE; i++) {
      var c = p.col[i]; if (c < 0) continue;
      r.free[c] += p.top[i]; r.prisoners[1 - c] += p.bot[i]; r.stacks[c]++;
      r.tallest[c] = Math.max(r.tallest[c], p.top[i] + p.bot[i]);
    }
    return r;
  }

  // Board coordinates: files A-F from left to right, ranks 1-6 from the near
  // side of the default camera (row 5) to the far side (row 0).
  function sqName(i) { return 'ABCDEF'.charAt(i % N) + (N - ((i / N) | 0)); }
  var KIND_SIGN = ['-', '+', 'x', 'v'];
  function moveName(m) { return sqName(mFrom(m)) + KIND_SIGN[mKind(m)] + sqName(mTo(m)); }

  // ---------- Evaluation ----------
  var WIN = 100000;

  // Same terms and weights as the original evaluation; mobility counts are passed in
  // (nMe = moves of the side to move, already known by the caller).
  function evaluate(p, nMe) {
    var me = p.side, s = 0, col = p.col, top = p.top, bot = p.bot;
    for (var i = 0; i < SIZE; i++) {
      var c = col[i]; if (c < 0) continue;
      var t = top[i], b = bot[i], h = t + b;
      var v = t * 10 + 14 + (h < 4 ? h : 4) * 2 - b * 6;
      if (b > 0 && t - b <= 1) v -= 4;
      if (c === me) s += v - b * 4; else s += b * 4 - v;
    }
    if (nMe == null) nMe = countMoves(p, me);
    return s + (nMe - countMoves(p, 1 - me)) * 2;
  }

  // ---------- Search ----------

  var MAXPLY = 64, TT_BITS = 20;
  var EXACT = 1, LOWER = 2, UPPER = 3;

  function Engine(ttBits) {
    var size = 1 << (ttBits || TT_BITS);
    this.mask = size - 1;
    this.tk1 = new Int32Array(size); this.tk2 = new Int32Array(size);
    this.tmove = new Int32Array(size); this.tscore = new Int32Array(size);
    this.tdepth = new Int8Array(size); this.tflag = new Int8Array(size);
    this.killers = new Int32Array(MAXPLY * 2);
    this.hist = new Int32Array(16384);
    this.bufs = []; this.scores = [];
    for (var k = 0; k <= MAXPLY + 16; k++) { this.bufs.push(new Int32Array(256)); this.scores.push(new Int32Array(256)); }
    this.sv = new Int32Array((MAXPLY + 16) * 8);
    this.path1 = new Int32Array(MAXPLY + 16); this.path2 = new Int32Array(MAXPLY + 16);
    this.useQ = true; this.useTT = true; this.qMax = 8;
  }
  Engine.prototype.clear = function () {
    this.tk1.fill(0); this.tk2.fill(0); this.tmove.fill(0); this.tflag.fill(0); this.hist.fill(0);
  };

  // Repetition: the position already occurred in the game or earlier in the line.
  Engine.prototype.repeated = function (p, ply) {
    var h1 = p.h1, h2 = p.h2;
    for (var k = ply - 2; k >= 0; k -= 2) if (this.path1[k] === h1 && this.path2[k] === h2) return true;
    var g = this.game[h1];
    return g !== undefined && g === h2;
  };

  // Scores moves for ordering (higher first).
  Engine.prototype.score = function (p, buf, sc, n, ttMove, ply) {
    var k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1], hist = this.hist;
    for (var k = 0; k < n; k++) {
      var m = buf[k], kind = m >> 12, t = (m >> 6) & 63, v;
      if (m === ttMove) v = 1 << 30;
      else if (kind === CAPTURE) v = 20000000 + (p.top[t] + p.bot[t]) * 100000 + p.bot[t] * 1000;
      else if (kind === PRISON && p.bot[t] + 1 > p.top[t]) v = 20000000 + (p.top[t] + p.bot[t]) * 100000;
      else if (m === k1) v = 19000000;
      else if (m === k2) v = 18000000;
      else v = hist[m] + (kind === PRISON ? 1 : 0);
      sc[k] = v;
    }
  };
  // Swaps the best remaining move into position k.
  function pickNext(buf, sc, k, n) {
    var b = k, bv = sc[k];
    for (var j = k + 1; j < n; j++) if (sc[j] > bv) { bv = sc[j]; b = j; }
    if (b !== k) { var tm = buf[k]; buf[k] = buf[b]; buf[b] = tm; sc[b] = sc[k]; sc[k] = bv; }
    return buf[k];
  }

  Engine.prototype.ab = function (p, depth, alpha, beta, ply) {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stop = true;
    if (this.stop) return 0;
    if (ply > this.seldepth) this.seldepth = ply;
    if (this.plies0 + ply >= MAX_PLIES) return 0;          // 400 moves: draw
    if (this.repeated(p, ply)) return 0;                     // repetition: draw
    this.path1[ply] = p.h1; this.path2[ply] = p.h2;
    var buf = this.bufs[ply], sc = this.scores[ply];
    var n = gen(p, buf);
    if (!n) return -WIN + ply;                               // cannot play: lost
    if (depth <= 0 || ply >= MAXPLY) return this.useQ ? this.qs(p, alpha, beta, ply, 0, n) : evaluate(p, n);

    var idx = p.h1 & this.mask, ttMove = -1;
    if (this.useTT && this.tk1[idx] === p.h1 && this.tk2[idx] === p.h2 && this.tflag[idx]) {
      ttMove = this.tmove[idx] - 1;
      if (this.tdepth[idx] >= depth) {
        var ts = this.tscore[idx], fl = this.tflag[idx];
        if (ts > WIN / 2) ts -= ply; else if (ts < -WIN / 2) ts += ply;
        if (fl === EXACT || (fl === LOWER && ts >= beta) || (fl === UPPER && ts <= alpha)) return ts;
      }
    }
    this.score(p, buf, sc, n, ttMove, ply);
    var best = -Infinity, bestM = 0, a0 = alpha, sv = this.sv, o = ply * 8;
    for (var k = 0; k < n; k++) {
      var m = pickNext(buf, sc, k, n), v;
      playS(p, m, sv, o);
      if (k === 0) v = -this.ab(p, depth - 1, -beta, -alpha, ply + 1);
      else {
        v = -this.ab(p, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (v > alpha && v < beta && !this.stop) v = -this.ab(p, depth - 1, -beta, -alpha, ply + 1);
      }
      undoS(p, m, sv, o);
      if (this.stop) return 0;
      if (v > best) { best = v; bestM = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        var kind = m >> 12;
        if (kind !== CAPTURE) {
          if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
          this.hist[m] += depth * depth;
        }
        break;
      }
    }
    if (this.useTT) {
      var st = best;
      if (st > WIN / 2) st += ply; else if (st < -WIN / 2) st -= ply;
      this.tk1[idx] = p.h1; this.tk2[idx] = p.h2; this.tmove[idx] = bestM + 1; this.tscore[idx] = st;
      this.tdepth[idx] = depth; this.tflag[idx] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
    }
    return best;
  };

  // Quiescence: stand pat, then only captures and revolutions (moves that flip a stack).
  // n = number of legal moves of the side to move (already generated in bufs[ply]).
  Engine.prototype.qs = function (p, alpha, beta, ply, qd, n) {
    var stand = evaluate(p, n);
    if (stand >= beta || qd >= this.qMax || ply >= MAXPLY + 8) return stand;
    if (stand > alpha) alpha = stand;
    var buf = this.bufs[ply], sc = this.scores[ply], cnt = 0, k;
    for (k = 0; k < n; k++) {
      var m = buf[k], kind = m >> 12, t = (m >> 6) & 63;
      if (kind === CAPTURE) { buf[cnt] = m; sc[cnt++] = (p.top[t] + p.bot[t]) * 16 + p.bot[t]; }
      else if (kind === PRISON && p.bot[t] + 1 > p.top[t]) { buf[cnt] = m; sc[cnt++] = (p.top[t] + p.bot[t]) * 16; }
    }
    var best = stand, sv = this.sv, o = ply * 8;
    for (k = 0; k < cnt; k++) {
      var mv = pickNext(buf, sc, k, cnt);
      playS(p, mv, sv, o);
      if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stop = true;
      var nb = this.bufs[ply + 1], n2 = gen(p, nb), v;
      if (!n2) v = WIN - ply - 1;
      else v = -this.qs(p, -beta, -alpha, ply + 1, qd + 1, n2);
      undoS(p, mv, sv, o);
      if (this.stop) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (ply + 1 > this.seldepth) this.seldepth = ply + 1;
    return best;
  };

  // Level settings: max depth, time (worker / main thread), randomness, features.
  var LEVELS = {
    1: { depth: 2, time: 150, timeMain: 150, random: 12, q: false },
    2: { depth: 4, time: 500, timeMain: 400, random: 0, q: true },
    3: { depth: 40, time: 2000, timeMain: 900, random: 0, q: true }
  };

  // Best move for p.side.
  // opts: {level, timeMs, maxDepth, history: [[h1,h2],...] positions already played
  //        (side to move included), plies: moves already played, mainThread, random}
  // Returns {move, score, depth, seldepth, nodes, ms, pv} (move -1 if no legal move).
  Engine.prototype.think = function (p0, opts) {
    opts = opts || {};
    var L = LEVELS[opts.level] || LEVELS[2];
    var p = p0.clone(), t0 = Date.now();
    var timeMs = opts.timeMs || (opts.mainThread ? L.timeMain : L.time);
    var maxDepth = opts.maxDepth || L.depth;
    this.useQ = opts.q != null ? opts.q : L.q;
    this.deadline = t0 + timeMs; this.stop = false; this.nodes = 0; this.seldepth = 0;
    this.plies0 = opts.plies || 0;
    this.game = {};
    var hist = opts.history || [];
    for (var h = 0; h < hist.length; h++) this.game[hist[h][0]] = hist[h][1];
    // the root itself counts as already seen (its key is in the history)
    this.game[p.h1] = p.h2;
    this.killers.fill(0);
    for (var hi = 0; hi < 16384; hi++) this.hist[hi] >>= 3;

    var ms = moves(p), res = { move: -1, score: 0, depth: 0, seldepth: 0, nodes: 0, ms: 0, pv: [] };
    if (!ms.length) return res;
    // initial ordering: TT move, captures, revolutions, history
    var tmpB = new Int32Array(ms), tmpS = new Int32Array(ms.length), order = [];
    var idx = p.h1 & this.mask, ttm = this.tk1[idx] === p.h1 && this.tk2[idx] === p.h2 ? this.tmove[idx] - 1 : -1;
    this.score(p, tmpB, tmpS, ms.length, ttm, 0);
    for (var q = 0; q < tmpB.length; q++) order.push([tmpS[q], tmpB[q]]);
    order.sort(function (a, b) { return b[0] - a[0]; });
    ms = order.map(function (e) { return e[1]; });

    var best = ms[0], bestScore = 0, scores = [], randomize = opts.random != null ? opts.random : L.random;
    this.path1[0] = p.h1; this.path2[0] = p.h2;
    var sv = this.sv;
    for (var d = 1; d <= maxDepth; d++) {
      var alpha = -Infinity, bestD = -1, sc = [];
      for (var k = 0; k < ms.length; k++) {
        var m = ms[k], v;
        playS(p, m, sv, 0);
        if (randomize) v = -this.ab(p, d - 1, -Infinity, Infinity, 1);      // exact scores for the random pick
        else if (k === 0) v = -this.ab(p, d - 1, -Infinity, -alpha, 1);
        else {
          v = -this.ab(p, d - 1, -alpha - 1, -alpha, 1);
          if (v > alpha && !this.stop) v = -this.ab(p, d - 1, -Infinity, -alpha, 1);
        }
        undoS(p, m, sv, 0);
        if (this.stop) break;
        sc.push([v, m]);
        if (v > alpha) { alpha = v; bestD = m; }
      }
      // the previous best is searched first, so a move that beat it before the
      // deadline is really better: a partial iteration can be trusted.
      if (bestD >= 0) { best = bestD; bestScore = alpha; if (!this.stop || randomize === 0) scores = sc; }
      if (this.stop) break;
      res.depth = d;
      // next iteration: best first, then by score of this iteration
      sc.sort(function (a, b) { return b[0] - a[0]; });
      ms = sc.map(function (e) { return e[1]; });
      if (Math.abs(alpha) > WIN / 2) break;  // forced win or loss found
      if (Date.now() - t0 > timeMs * 0.55 && !opts.fixedDepth) break; // next iteration would not finish
    }
    if (randomize && scores.length) {
      scores.sort(function (a, b) { return b[0] - a[0]; });
      var top = scores[0][0];
      var ok = scores.filter(function (e) { return e[0] >= top - randomize; });
      var rnd = opts.rng || Math.random;
      var pickE = ok[(rnd() * ok.length) | 0]; best = pickE[1]; bestScore = pickE[0];
    }
    res.move = best; res.score = bestScore; res.nodes = this.nodes; res.ms = Date.now() - t0; res.seldepth = this.seldepth;
    res.pv = this.pv(p, best);
    return res;
  };
  // Principal variation read from the transposition table (for display).
  Engine.prototype.pv = function (p, first) {
    var q = p.clone(), out = [first], seen = {};
    play2(q, first);
    for (var k = 0; k < 8; k++) {
      var idx = q.h1 & this.mask;
      if (this.tk1[idx] !== q.h1 || this.tk2[idx] !== q.h2 || seen[q.h1]) break;
      seen[q.h1] = 1;
      var m = this.tmove[idx] - 1;
      if (m < 0 || moves(q).indexOf(m) < 0) break;
      out.push(m); play2(q, m);
    }
    return out;
  };

  var shared = null;
  function think(p, opts) { if (!shared) shared = new Engine(); return shared.think(p, opts); }
  function reset() { if (shared) shared.clear(); }

  var api = {
    N: N, SIZE: SIZE, SIMPLE: SIMPLE, STACK: STACK, CAPTURE: CAPTURE, PRISON: PRISON, MAX_PLIES: MAX_PLIES,
    NEIGH: NEIGH, Pos: Pos, initial: initial, moves: moves, countMoves: countMoves, play: play, undo: undo,
    mk: mk, mFrom: mFrom, mTo: mTo, mKind: mKind, counts: counts, evaluate: evaluate,
    ownNeighbours: ownNeighbours, sqName: sqName, moveName: moveName, WIN: WIN, LEVELS: LEVELS,
    Engine: Engine, think: think, reset: reset
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AgoraEngine = api;
})(this);
