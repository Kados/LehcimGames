/*
 * Awélé (nouvelle version) - rules engine and computer players (no DOM).
 * Plain script: defines the global AweleEngine; also loaded by ai-worker.js
 * (importScripts) and by node (module.exports) for tests and benchmarks.
 *
 * Board: 0..5 = player's pits A..F (bottom row, left to right), 6..11 = computer's pits
 * a..f (top row, right to left). s[0] = seeds won by the player, s[1] = by the computer.
 * turn: 0 player, 1 computer. mode: 0 = "Règles usuelles", 1 = "Règles de tournoi".
 *
 * The rules (sim, legalMoves, doMove, afterMove) and the original computer player
 * (originalMove, levels 1 to 5) are copied unchanged from ../engine.js, which reproduces
 * AWELE.EXE. What is new: a second computer player ("Maître", level 6) with alpha-beta,
 * transposition table (Zobrist), move ordering (captures, killers, history), PVS,
 * optional quiescence, a self-play tuned evaluation and the repetition rule seen by
 * the search; plus a move preview and a seedable random generator.
 */
(function (root) {
  'use strict';

  var LETTERS = 'ABCDEFabcdef';

  // ---------- Rules (copied from ../engine.js) ----------

  function newState(starter) {
    return { b: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], s: [0, 0], turn: starter || 0 };
  }
  function clone(st) { return { b: st.b.slice(), s: st.s.slice(), turn: st.turn }; }
  function owner(i) { return i < 6 ? 0 : 1; }
  function sideSum(b, p) { var t = 0, o = p * 6; for (var i = o; i < o + 6; i++) t += b[i]; return t; }
  function boardSum(b) { var t = 0; for (var i = 0; i < 12; i++) t += b[i]; return t; }

  // ---------- The original move evaluator ----------
  // Plays pit `pit` for `side` on board b0 with stores sa0 (player) / sb0 (computer).
  // Returns the resulting board and stores, `over` (the move ends the game) and the
  // static value the original gives to the move:
  //   2, +1 if the last seed falls on the mover's own side, +3 per seed won;
  //   333 if the mover passes 24 seeds; 1 for a move that leaves the opponent without
  //   seeds (forbidden when another move is possible).
  // Usual rules: if a capture would take the last seeds of the opponent, one seed is left
  // in that pit. Tournament: full capture, and if the opponent has no seed left the mover
  // takes all the seeds of his own side.
  function sim(mode, side, pit, b0, sa0, sb0) {
    var b = b0.slice(), sa = sa0, sb = sb0, value = 2, over = 0, j, n, k, flag = 0;
    var opp = function (bb) { var t = 0, o = side === 1 ? 0 : 6; for (var q = o; q < o + 6; q++) t += bb[q]; return t; };
    if (mode && opp(b0) === 0) {          // tournament: the opponent is starving, can we feed him?
      if (side === 0) { for (k = 0; k <= 5 && b0[k] + k - 5 <= 0; k++); if (k === 6) value = 1; }
      else { for (k = 6; k <= 11 && b0[k] + k - 11 <= 0; k++); if (k === 12) value = 1; }
    }
    j = pit; n = b[pit]; b[pit] = 0;
    do { if (j === pit) j = (j + 1) % 12; else { b[j]++; n--; j = (j + 1) % 12; } } while (n !== 0);
    j = (j + 11) % 12;                    // last pit sown
    if ((side === 1 && j >= 6) || (side === 0 && j <= 5)) value++;
    while ((b[j] === 2 || b[j] === 3) && ((side === 1 && j <= 5) || (side === 0 && j >= 6))) {
      if (!mode && opp(b) - b[j] === 0) {  // usual rules: leave one seed
        if (side === 0) sa += b[j] - 1; else sb += b[j] - 1;
        b[j] = 1;
      } else {
        if (side === 0) sa += b[j]; else sb += b[j];
        b[j] = 0;
      }
      j = (j + 11) % 12;
    }
    if (!mode) {
      if (side === 1) { if (sb > 24) { over = 1; value = 333; } else { value += 3 * (sb - sb0); if (sa + sb > 41) over = 1; } }
      else { if (sa > 24) { over = 1; value = 333; } else { value += 3 * (sa - sa0); if (sa + sb > 41) over = 1; } }
      if (opp(b) === 0) value = 1;
    } else {
      if (value === 3 && opp(b) === 0 && ((side === 1 && sb === sb0) || (side === 0 && sa === sa0))) flag = 1;
      if (opp(b) === 0) {                  // the opponent cannot play: the mover takes his own seeds
        var own = 0; for (k = side * 6; k < side * 6 + 6; k++) own += b[k];
        if (side === 0) sa += own; else sb += own;
        for (k = 0; k < 12; k++) b[k] = 0;
      }
      if (flag) value = 1;
      else if (side === 1) { if (sb > 24) { over = 1; value = 333; } else value += 3 * (sb - sb0); }
      else { if (sa > 24) { over = 1; value = 333; } else value += 3 * (sa - sa0); }
    }
    return { value: value, sa: sa, sb: sb, b: b, over: over };
  }

  // Legal moves of the side to move: non-empty pits, except the moves valued 1 (that leave the
  // opponent without seeds) when the best move is not valued 1.
  function legalMoves(st, mode) {
    var p = st.turn, o = p * 6, res = [], vals = [], best = 0;
    for (var i = o; i < o + 6; i++) if (st.b[i] > 0) {
      var v = sim(mode, p, i, st.b, st.s[0], st.s[1]).value;
      res.push(i); vals.push(v); if (v > best) best = v;
    }
    if (best === 1) return res;
    return res.filter(function (m, k) { return vals[k] !== 1; });
  }

  // Plays pit i for the side to move (sowing and captures only).
  // Returns {st, path: pits receiving a seed in order, caps: [{pit, n, keep}]}.
  function doMove(st0, i, mode) {
    var st = clone(st0), b = st.b, p = st.turn, n = b[i], j = i, path = [];
    b[i] = 0;
    while (n > 0) { j = (j + 1) % 12; if (j === i) continue; b[j]++; n--; path.push(j); }
    var caps = [];
    while (owner(j) !== p && (b[j] === 2 || b[j] === 3)) {
      var keep = (!mode && sideSum(b, 1 - p) - b[j] === 0) ? 1 : 0;
      caps.push({ pit: j, n: b[j], keep: keep });
      st.s[p] += b[j] - keep; b[j] = keep;
      j = (j + 11) % 12;
    }
    return { st: st, path: path, caps: caps };
  }

  // What happens after side `mover` has played (st.turn still = mover), in the original order.
  // history: boards seen with fewer than 7 seeds left (tournament repetition rule), updated here.
  // Returns {st (with turn = next player), over, result: 0 player wins / 1 computer wins / -1 draw,
  //          repeated, gather: [{pit, n, to}]}.
  function afterMove(st0, mode, history) {
    var st = clone(st0), mover = st.turn, gather = [], repeated = false, i;
    function take(i, to) { if (st.b[i]) { gather.push({ pit: i, n: st.b[i], to: to }); st.s[to] += st.b[i]; st.b[i] = 0; } }
    if (mode) {
      if (st.s[0] + st.s[1] > 41 && history.some(function (h) { return h === st.b.join(','); })) {
        repeated = true;                    // position already played: each takes his own seeds
        for (i = 0; i < 12; i++) take(i, owner(i));
      } else if (sideSum(st.b, 1 - mover) === 0) {
        for (i = mover * 6; i < mover * 6 + 6; i++) take(i, mover);
      }
      if (st.s[0] + st.s[1] > 41) { history.unshift(st.b.join(',')); if (history.length > 24) history.length = 24; }
    }
    var s = st.s, over = mode ? (s[0] > 24 || s[1] > 24 || (s[0] === 24 && s[1] === 24))
                              : (s[0] > 24 || s[1] > 24 || s[0] + s[1] > 41);
    var result = s[0] > 24 ? 0 : (s[1] > 24 ? 1 : -1);
    // next player; a player without seeds passes his turn (usual rules)
    var next = 1 - mover;
    if (!over && sideSum(st.b, next) === 0) next = mover;
    st.turn = next;
    return { st: st, over: over, result: result, repeated: repeated, gather: gather };
  }


  // ---------- Computer player: the original search ----------
  // A "best-first" minimax: each node lists the moves sorted by static value (stable, so equal
  // values keep the pit order a, b, ... f / A ... F); plies 1 to 7 look at every move, ply 8
  // at the 2 best ones, ply 9 at the best one only; a move's value is its static value minus
  // the best value of the reply. Depth 1, 3, 5, 7, 9 for the levels 1 to 5. The quirks of the
  // original (shared result slot, no search under a node where a move ends the game) are kept,
  // so that the computer plays exactly the same moves.
  function originalMove(st, level, mode) {
    var depth = [0, 1, 3, 5, 7, 9][level] || 5;
    var G = { b: st.b.slice(), sa: st.s[0], sb: st.s[1] }, A = [], p, i;
    function slot() { return { value: 0, move: 0, sa: 0, sb: 0, b: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }; }
    for (p = 0; p <= depth + 2; p++) { A[p] = []; for (i = 0; i <= 6; i++) A[p][i] = slot(); }
    function insert(arr, K, value, move, sa, sb, bd) {
      var k = K + 1;
      do { k--; } while (value > arr[k].value && k !== 1);
      if (k === K && !(value > arr[K].value)) return;
      var pos = k + 1 + (value <= arr[k].value ? 1 : 0);
      for (var q = K; q >= pos; q--) arr[q] = arr[q - 1];
      arr[pos - 1] = { value: value, move: move, sa: sa, sb: sb, b: bd };
    }
    function search(p, maxD) {
      var K = p <= 7 ? 6 : (p === 8 ? 2 : 1), side = p % 2 === 1 ? st.turn : 1 - st.turn;
      var cnt = 0, anyOver = 0, i, arr = A[p], o = side * 6;
      for (i = 1; i <= K; i++) arr[i] = { value: 0, move: arr[i].move, sa: arr[i].sa, sb: arr[i].sb, b: arr[i].b };
      for (var pit = o; pit < o + 6; pit++) if (G.b[pit] !== 0) {
        cnt++;
        var r = sim(mode, side, pit, G.b, G.sa, G.sb);
        if (r.over) anyOver = 1;
        insert(arr, K, r.value, pit, r.sa, r.sb, r.b);
      }
      if (cnt < K) K = cnt;
      if (arr[1].value !== 1) for (i = 2; i <= cnt; i++) if (arr[i] && arr[i].value === 1) K = (K - 1) & 255;
      if (K === 0) { K = 1; arr[1] = { value: arr[1].value, move: 100, sa: G.sa, sb: G.sb, b: G.b.slice() }; }
      for (i = 1; i <= K; i++) {
        var c = arr[i] || slot();
        G.b = c.b.slice(); G.sa = c.sa; G.sb = c.sb;
        if (p < maxD && !anyOver) search(p + 1, maxD);
        var diff = c.value - A[p + 1][1].value;
        if (i === 1) arr[1] = { value: diff, move: arr[1].move, sa: arr[1].sa, sb: arr[1].sb, b: arr[1].b };
        if (arr[1].value < diff) arr[1] = { value: diff, move: c.move, sa: c.sa, sb: c.sb, b: c.b };
      }
    }
    search(1, depth);
    var m = A[1][1].move;
    return m >= 0 && m < 12 ? m : -1;
  }


  // ---------- Random numbers (seedable) ----------

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = Math.random;
  function setSeed(n) { rnd = n == null ? Math.random : mulberry32(n); }

  // ---------- New computer player: alpha-beta with transposition table ----------
  // Same rules as above (legality "value 1", usual-rules seed left, tournament gathering,
  // repetition among the last 24 boards with fewer than 7 seeds, a player without seeds passes),
  // re-implemented on typed arrays for speed and checked against sim/legalMoves/afterMove.

  // Zobrist keys: pit*49 + seeds for pits 0..11, 12*49 + player's store, 13*49 + side to move.
  var ZR = mulberry32(20061984);
  var Z1 = new Int32Array(14 * 49), Z2 = new Int32Array(14 * 49);
  for (var zi = 0; zi < Z1.length; zi++) { Z1[zi] = (ZR() * 4294967296) | 0; Z2[zi] = (ZR() * 4294967296) | 0; }

  var WIN = 10000, MAXPLY = 96, QMAX = 10, QDEF = 2, NOTERM = -999999;
  // Evaluation weights: captured seeds, seeds at home, vulnerable pits (1-2 seeds) of the
  // opponent / of the side to move, mobility (playable pits), "kroo" (12+ seeds in one pit).
  // Tuned by self-play (algorithme.html).
  var DEFAULT_W = [16, 1, 0, -1, 6, 0];

  var TT_SIZE = 1 << 19, TT_MASK = TT_SIZE - 1;
  var ttK = null, ttV = null, ttI = null;
  var EXACT = 1, LOWER = 2, UPPER = 3;
  function ttClear() {
    if (!ttK) { ttK = new Int32Array(TT_SIZE); ttV = new Int32Array(TT_SIZE); ttI = new Int32Array(TT_SIZE); }
    ttI.fill(0);
  }

  var NP = MAXPLY + QMAX + 4;
  var B = [], C = [], CS0 = [], CS1 = [], CT = [], CV = [], CG = [], CM = [], CK = [], SC = [], ORD = [];
  for (var bp = 0; bp < NP; bp++) {
    B.push(new Int8Array(12)); C.push(new Int8Array(72));
    CS0.push(new Int32Array(6)); CS1.push(new Int32Array(6)); CT.push(new Int8Array(6)); CV.push(new Int32Array(6));
    CG.push(new Int8Array(6)); CM.push(new Int8Array(6)); CK.push([null, null, null, null, null, null]);
    SC.push(new Int32Array(6)); ORD.push(new Int8Array(6));
  }
  var S0 = new Int32Array(NP), S1 = new Int32Array(NP), T = new Int8Array(NP), PATHK = new Array(NP);
  var KILL = new Int8Array(NP * 2), HIST = new Int32Array(24);
  var cx = { nodes: 0, deadline: 0, timeout: false, mode: 0, W: DEFAULT_W, q: true, qmax: QDEF, tt: true, hist: [], seldepth: 0 };

  function boardKey(a, off) {
    var s = '' + a[off];
    for (var k = 1; k < 12; k++) s += ',' + a[off + k];
    return s;
  }
  // Was this board (fewer than 7 seeds) among the last 24 such boards? (line searched, then game)
  function repeated(ply, key) {
    var cnt = 0;
    for (var i = ply; i >= 1; i--) {
      var p = PATHK[i];
      if (p !== null && p !== undefined) { if (p === key) return true; if (++cnt >= 24) return false; }
    }
    var h = cx.hist;
    for (var j = 0; j < h.length && cnt < 24; j++, cnt++) if (h[j] === key) return true;
    return false;
  }

  // Generates the legal moves of node ply: children boards in C[ply], stores, side to move
  // next, terminal value (for the mover) and history key. Returns the number of children.
  function gen(ply) {
    var b = B[ply], me = T[ply], s0 = S0[ply], s1 = S1[ply], mode = cx.mode;
    var o = me * 6, oo = 6 - o, opp0 = 0, k, n = 0, nLegal = 0;
    var ch = C[ply], cs0 = CS0[ply], cs1 = CS1[ply], ct = CT[ply], cv = CV[ply], cg = CG[ply], cm = CM[ply], ck = CK[ply];
    var ill = 0; // bit mask of illegal children
    for (k = oo; k < oo + 6; k++) opp0 += b[k];
    var noFeed = false;
    if (mode && opp0 === 0) {
      noFeed = true;
      for (k = o; k < o + 6; k++) if (b[k] && b[k] + (k - o) - 5 > 0) { noFeed = false; break; }
    }
    for (var pit = o; pit < o + 6; pit++) {
      if (!b[pit]) continue;
      var off = n * 12;
      for (k = 0; k < 12; k++) ch[off + k] = b[k];
      var cnt = ch[off + pit], j = pit, v;
      ch[off + pit] = 0;
      while (cnt > 0) { j++; if (j === 12) j = 0; if (j === pit) continue; ch[off + j]++; cnt--; }
      var lastOwn = j >= o && j < o + 6, gain = 0;
      while (!(j >= o && j < o + 6) && ((v = ch[off + j]) === 2 || v === 3)) {
        var keep = 0;
        if (!mode) { var os = 0; for (k = oo; k < oo + 6; k++) os += ch[off + k]; if (os - v === 0) keep = 1; }
        gain += v - keep; ch[off + j] = keep;
        j = j === 0 ? 11 : j - 1;
      }
      var oppA = 0;
      for (k = oo; k < oo + 6; k++) oppA += ch[off + k];
      // the original's "value 1": the move leaves the opponent without seeds
      if (mode ? (lastOwn && gain === 0 && oppA === 0 && !noFeed) : oppA === 0) ill |= 1 << n;
      else nLegal++;
      var ns0 = s0 + (me ? 0 : gain), ns1 = s1 + (me ? gain : 0), key = null, over, x;
      if (mode) {
        if (ns0 + ns1 > 41 && repeated(ply, boardKey(ch, off))) {
          for (x = 0; x < 6; x++) { ns0 += ch[off + x]; ch[off + x] = 0; }
          for (x = 6; x < 12; x++) { ns1 += ch[off + x]; ch[off + x] = 0; }
        } else if (oppA === 0) {
          var own = 0;
          for (x = o; x < o + 6; x++) { own += ch[off + x]; ch[off + x] = 0; }
          if (me) ns1 += own; else ns0 += own;
        }
        if (ns0 + ns1 > 41) key = boardKey(ch, off);
        over = ns0 > 24 || ns1 > 24 || (ns0 === 24 && ns1 === 24);
      } else over = ns0 > 24 || ns1 > 24 || ns0 + ns1 > 41;
      var next = 1 - me;
      if (over) {
        var res = ns0 > 24 ? 0 : (ns1 > 24 ? 1 : -1);
        cv[n] = res === -1 ? 0 : (res === me ? WIN - ply - 1 : -(WIN - ply - 1));
      } else {
        cv[n] = NOTERM;
        var ns = 0, no = next * 6;
        for (x = no; x < no + 6; x++) ns += ch[off + x];
        if (ns === 0) next = me;
      }
      cs0[n] = ns0; cs1[n] = ns1; ct[n] = next; cg[n] = gain; cm[n] = pit; ck[n] = key;
      n++;
    }
    // keep only the legal children (all of them when every move is "value 1")
    var ord = ORD[ply], m = 0;
    for (k = 0; k < n; k++) if (!nLegal || !(ill & (1 << k))) ord[m++] = k;
    return m;
  }

  function setChild(ply, k) {
    var nb = B[ply + 1], ch = C[ply], off = k * 12;
    for (var x = 0; x < 12; x++) nb[x] = ch[off + x];
    S0[ply + 1] = CS0[ply][k]; S1[ply + 1] = CS1[ply][k]; T[ply + 1] = CT[ply][k];
    PATHK[ply + 1] = CK[ply][k];
  }

  function evaluate(ply) {
    var b = B[ply], me = T[ply], W = cx.W, o = me * 6, q = 6 - o;
    var sMe = me ? S1[ply] : S0[ply], sOp = me ? S0[ply] : S1[ply];
    var home = 0, away = 0, vMe = 0, vOp = 0, mMe = 0, mOp = 0, kroo = 0;
    for (var k = 0; k < 6; k++) {
      var a = b[o + k], c = b[q + k];
      home += a; away += c;
      if (a) { mMe++; if (a < 3) vMe++; if (a >= 12) kroo++; }
      if (c) { mOp++; if (c < 3) vOp++; if (c >= 12) kroo--; }
    }
    return W[0] * (sMe - sOp) + W[1] * (home - away) + W[2] * vOp - W[3] * vMe + W[4] * (mMe - mOp) + W[5] * kroo;
  }

  // Sorts the n legal children listed in ORD[ply] by decreasing SC (insertion sort).
  function sortOrd(ply, n) {
    var sc = SC[ply], ord = ORD[ply];
    for (var a = 1; a < n; a++) {
      var x = ord[a], v = sc[x], y = a;
      while (y > 0 && sc[ord[y - 1]] < v) { ord[y] = ord[y - 1]; y--; }
      ord[y] = x;
    }
  }

  // Value of child k of node ply for the side to move at ply, window (a, b).
  function childVal(ply, k, depth, a, b, quiet, qd) {
    var tv = CV[ply][k];
    if (tv !== NOTERM) return tv;
    setChild(ply, k);
    var same = CT[ply][k] === T[ply];
    if (quiet) return same ? quiesce(ply + 1, a, b, qd) : -quiesce(ply + 1, -b, -a, qd);
    return same ? search(ply + 1, depth, a, b) : -search(ply + 1, depth, -b, -a);
  }

  function quiesce(ply, alpha, beta, qd) {
    cx.nodes++;
    if (ply > cx.seldepth) cx.seldepth = ply;
    var stand = evaluate(ply);
    if (stand >= beta || qd >= cx.qmax || ply >= NP - 2) return stand;
    if (stand > alpha) alpha = stand;
    var n = gen(ply), ord = ORD[ply], sc = SC[ply], cg = CG[ply], cv = CV[ply], best = stand, k, m = 0;
    // captures (and game ends) only, biggest first
    for (k = 0; k < n; k++) { var c = ord[k]; if (cg[c] > 0 || cv[c] !== NOTERM) { ord[m++] = c; sc[c] = cg[c]; } }
    sortOrd(ply, m);
    for (var r = 0; r < m; r++) {
      var v = childVal(ply, ord[r], 0, alpha, beta, true, qd + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function search(ply, depth, alpha, beta) {
    if ((++cx.nodes & 1023) === 0 && Date.now() > cx.deadline) cx.timeout = true;
    if (cx.timeout) return 0;
    if (depth <= 0 || ply >= MAXPLY) return cx.q && ply < MAXPLY ? quiesce(ply, alpha, beta, 0) : evaluate(ply);
    var me = T[ply], b = B[ply], k;
    // with fewer than 7 seeds in tournament, values depend on the boards already seen
    var useTT = cx.tt && !(cx.mode && S0[ply] + S1[ply] > 41);
    var ttMove = -1, slot = 0, h2 = 0, alpha0 = alpha;
    if (useTT) {
      var h1 = Z1[13 * 49 + me] ^ Z1[12 * 49 + S0[ply]];
      h2 = Z2[13 * 49 + me] ^ Z2[12 * 49 + S0[ply]];
      for (k = 0; k < 12; k++) { h1 ^= Z1[k * 49 + b[k]]; h2 ^= Z2[k * 49 + b[k]]; }
      slot = h1 & TT_MASK;
      var info = ttI[slot];
      if (info && ttK[slot] === h2) {
        ttMove = (info >> 4) & 15;
        if (ttMove === 15) ttMove = -1;
        if ((info >> 8) >= depth) {
          var tv = ttV[slot], fl = (info >> 2) & 3;
          if (tv > WIN / 2) tv -= ply; else if (tv < -WIN / 2) tv += ply;
          if (fl === EXACT) return tv;
          if (fl === LOWER && tv >= beta) return tv;
          if (fl === UPPER && tv <= alpha) return tv;
        }
      }
    }
    var n = gen(ply), ord = ORD[ply], sc = SC[ply], cg = CG[ply], cm = CM[ply];
    var k1 = KILL[ply * 2], k2 = KILL[ply * 2 + 1];
    for (k = 0; k < n; k++) {
      var c = ord[k], pit = cm[c], s = cg[c] * 100000 + Math.min(HIST[me * 12 + pit], 40000);
      if (CV[ply][c] !== NOTERM) s += 50000000;
      if (pit === ttMove) s += 100000000;
      else if (!cg[c] && (pit === k1 || pit === k2)) s += 50000;
      sc[c] = s;
    }
    sortOrd(ply, n);
    var best = -Infinity, bestPit = -1;
    for (var r = 0; r < n; r++) {
      c = ord[r];
      var v;
      if (r === 0) v = childVal(ply, c, depth - 1, alpha, beta);
      else {
        v = childVal(ply, c, depth - 1, alpha, alpha + 1);
        if (v > alpha && v < beta && !cx.timeout) v = childVal(ply, c, depth - 1, alpha, beta);
      }
      if (cx.timeout) return 0;
      if (v > best) { best = v; bestPit = cm[c]; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!cg[c] && KILL[ply * 2] !== cm[c]) { KILL[ply * 2 + 1] = KILL[ply * 2]; KILL[ply * 2] = cm[c]; }
        HIST[me * 12 + cm[c]] += depth * depth;
        break;
      }
    }
    if (useTT) {
      var flag = best <= alpha0 ? UPPER : (best >= beta ? LOWER : EXACT);
      var sv = best > WIN / 2 ? best + ply : (best < -WIN / 2 ? best - ply : best);
      var old = ttI[slot];
      if (!old || ttK[slot] !== h2 || (old >> 8) <= depth) {
        ttK[slot] = h2; ttV[slot] = sv;
        ttI[slot] = (Math.min(depth, 127) << 8) | ((bestPit < 0 ? 15 : bestPit) << 4) | (flag << 2) | 1;
      }
    }
    return best;
  }

  // Levels: 1 to 5 = the original computer (search of 1, 3, 5, 7, 9 half-moves, deterministic);
  // 6 = "Maître", the new alpha-beta search with a time limit.
  var LEVELS = {
    1: { orig: 1 }, 2: { orig: 2 }, 3: { orig: 3 }, 4: { orig: 4 }, 5: { orig: 5 },
    6: { depth: 60, q: false, ms: 1500 }
  };

  // Chooses a move for the side to move.
  // opts: {level, mode (0 usual / 1 tournament), hist (boards of the tournament repetition rule,
  //        most recent first), ms, depth, weights, noTT, q, qmax, noRandom}
  // Returns {move, score, depth, nodes, ms, scores}.
  function think(st, opts) {
    opts = opts || {};
    var t0 = Date.now(), mode = opts.mode ? 1 : 0;
    var res = { move: -1, score: 0, depth: 0, nodes: 0, ms: 0, seldepth: 0, scores: [] };
    var cfg = LEVELS[opts.level] || LEVELS[6];
    if (cfg.orig && !opts.depth) {
      res.move = originalMove(st, cfg.orig, mode); res.original = true; res.ms = Date.now() - t0;
      return res;
    }
    var maxDepth = opts.depth || cfg.depth, ms = opts.ms || cfg.ms || 1500;
    cx.nodes = 0; cx.timeout = false; cx.deadline = t0 + ms; cx.mode = mode; cx.seldepth = 0;
    cx.W = opts.weights || DEFAULT_W; cx.q = opts.q != null ? !!opts.q : !!cfg.q;
    cx.qmax = Math.min(QMAX, opts.qmax != null ? opts.qmax : QDEF); cx.tt = !opts.noTT;
    cx.hist = opts.hist || [];
    if (cx.tt) ttClear();
    KILL.fill(-1); HIST.fill(0);
    var b0 = B[0];
    for (var x = 0; x < 12; x++) b0[x] = st.b[x];
    S0[0] = st.s[0]; S1[0] = st.s[1]; T[0] = st.turn; PATHK[0] = null;
    var n = gen(0), kids = [];
    for (var k = 0; k < n; k++) { var c = ORD[0][k]; kids.push({ c: c, m: CM[0][c], g: CG[0][c], v: 0 }); }
    if (!n) return res;
    res.move = kids[0].m;
    if (n === 1) return res;
    kids.sort(function (a, b) { return b.g - a.g; });
    for (var d = 1; d <= maxDepth; d++) {
      var alpha = -Infinity, iterVal = -Infinity, done = [];
      for (k = 0; k < kids.length; k++) {
        // window (alpha - 1, +inf): moves equal to the best keep an exact value
        var v = childVal(0, kids[k].c, d - 1, alpha - 1, Infinity);
        if (cx.timeout) break;
        kids[k].v = v; done.push(kids[k]);
        if (v > iterVal) iterVal = v;
        if (v > alpha) alpha = v;
      }
      if (cx.timeout) {
        if (done.length > 1 && d > 1) {
          var top = done[0];
          done.forEach(function (q) { if (q.v > top.v) top = q; });
          if (top !== done[0]) { res.move = top.m; res.score = top.v; }
        }
        break;
      }
      var ties = done.filter(function (q) { return q.v === iterVal; });
      var pick = (opts.noRandom || ties.length === 1) ? ties[0] : ties[Math.floor(rnd() * ties.length)];
      res.move = pick.m; res.score = iterVal; res.depth = d;
      res.scores = done.map(function (q) { return { m: q.m, v: q.v }; });
      kids.sort(function (a, b) { return b.v - a.v; });
      kids.splice(kids.indexOf(pick), 1); kids.unshift(pick);
      if (Math.abs(iterVal) > WIN / 2) break;
    }
    res.nodes = cx.nodes; res.ms = Date.now() - t0; res.seldepth = cx.seldepth;
    return res;
  }
  function bestMove(st, level, mode, ms, hist) {
    return think(st, { level: level, mode: mode, ms: ms, hist: hist }).move;
  }

  // What a move would do (preview): last pit, captured pits, seeds won, end of game.
  function preview(st, i, mode, hist) {
    var r = doMove(st, i, mode), gain = 0;
    r.caps.forEach(function (c) { gain += c.n - c.keep; });
    var a = afterMove(r.st, mode, (hist || []).slice());
    var gathered = 0;
    a.gather.forEach(function (g) { if (g.to === st.turn) gathered += g.n; });
    return { last: r.path[r.path.length - 1], caps: r.caps, gain: gain, n: st.b[i], over: a.over,
             repeated: a.repeated, gathered: gathered, again: !a.over && a.st.turn === st.turn };
  }

  var api = {
    LETTERS: LETTERS, WIN: WIN, LEVELS: LEVELS, DEFAULT_W: DEFAULT_W,
    newState: newState, clone: clone, owner: owner, sideSum: sideSum, boardSum: boardSum,
    sim: sim, legalMoves: legalMoves, doMove: doMove, afterMove: afterMove,
    originalMove: originalMove, think: think, bestMove: bestMove, preview: preview, setSeed: setSeed
  };
  root.AweleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
