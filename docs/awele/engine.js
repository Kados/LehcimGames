/*
 * Awélé - rules engine and computer player (no drawing, no DOM), as in AWELE.EXE.
 * Plain script: defines the global AweleEngine (also exported for node tests).
 *
 * Board: 12 pits, sowing goes counter-clockwise = increasing index (same numbering as the original).
 *   0..5  : player's pits A B C D E F (bottom row, left to right)
 *   6..11 : computer's pits a b c d e f (top row, RIGHT to left)
 * s[0] = seeds won by the player (right store), s[1] = by the computer (left store).
 * turn: 0 = player, 1 = computer.
 * mode: 0 = "Règles usuelles", 1 = "Règles de tournoi".
 *
 * Everything below was read in the original program (16-bit code of AWELE.EXE) and checked
 * against games played with it: same move evaluation, same legality test, same end rules,
 * same search (depth 1, 3, 5, 7, 9 for levels 1 to 5, with the same pruning and tie order).
 */
(function (root) {
  'use strict';

  var LETTERS = 'ABCDEFabcdef';

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
  function bestMove(st, level, mode) {
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

  var api = {
    LETTERS: LETTERS, newState: newState, clone: clone, owner: owner, sideSum: sideSum, boardSum: boardSum,
    sim: sim, legalMoves: legalMoves, doMove: doMove, afterMove: afterMove, bestMove: bestMove
  };
  root.AweleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
