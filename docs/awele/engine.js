/*
 * Awélé - rules engine and computer player (no drawing, no DOM).
 * Plain script: defines the global AweleEngine (also exported for node tests).
 *
 * Board: 12 pits, sowing goes counter-clockwise = increasing index.
 *   0..5  : player's pits A B C D E F (bottom row, left to right)
 *   6..11 : computer's pits a b c d e f (top row, RIGHT to left)
 * s[0] = seeds won by the player (right store), s[1] = by the computer (left store).
 * turn: 0 = player, 1 = computer.
 * tournament: false = "Règles usuelles", true = "Règles de tournoi".
 */
(function (root) {
  'use strict';

  var LETTERS = 'ABCDEFabcdef';

  function newState() {
    return { b: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], s: [0, 0], turn: 0 };
  }
  function clone(st) { return { b: st.b.slice(), s: st.s.slice(), turn: st.turn }; }

  function first(p) { return p * 6; }
  function owner(i) { return i < 6 ? 0 : 1; }
  function sideSum(b, p) { var t = 0, o = p * 6; for (var i = o; i < o + 6; i++) t += b[i]; return t; }
  function boardSum(b) { var t = 0; for (var i = 0; i < 12; i++) t += b[i]; return t; }

  // Does sowing pit i put at least one seed on the opponent's side?
  function feeds(b, i) {
    var n = b[i]; if (!n) return false;
    var dist = (first(1 - owner(i)) - i + 12) % 12; // steps to the first opposing pit
    return n >= dist;
  }

  // Legal moves of the side to move: non-empty pits, and if the opponent has no seeds,
  // only the moves that feed him (when at least one exists).
  function legalMoves(st) {
    var p = st.turn, o = first(p), res = [];
    for (var i = o; i < o + 6; i++) if (st.b[i] > 0) res.push(i);
    if (res.length && sideSum(st.b, 1 - p) === 0) {
      var f = res.filter(function (i) { return feeds(st.b, i); });
      if (f.length) res = f;
    }
    return res;
  }

  // Plays pit i. Returns {st, path: pits receiving seeds in order, caps: [{pit, n}],
  // leftOne: pit where one seed was given back (usual rules), or -1}.
  function doMove(st0, i, tournament) {
    var st = clone(st0), b = st.b, p = st.turn, n = b[i], j = i, path = [];
    b[i] = 0;
    while (n > 0) {
      j = (j + 1) % 12;
      if (j === i) continue;          // the origin pit stays empty
      b[j]++; n--; path.push(j);
    }
    var caps = [], leftOne = -1;
    while (owner(j) !== p && (b[j] === 2 || b[j] === 3)) {
      caps.push({ pit: j, n: b[j] }); st.s[p] += b[j]; b[j] = 0;
      j = (j + 11) % 12;
    }
    if (caps.length && !tournament && sideSum(b, 1 - p) === 0) {
      // Usual rules: leave one seed in the last examined pit so the opponent can play.
      leftOne = caps[caps.length - 1].pit; b[leftOne] = 1; st.s[p]--;
    }
    st.turn = 1 - p;
    return { st: st, path: path, caps: caps, leftOne: leftOne };
  }

  // Checks the end of the game for the state about to be played.
  // seen: optional object of already seen positions (tournament repetition rule).
  // Returns null, or {st (final state), result: 0 player wins / 1 computer wins / -1 draw,
  // reason: 'score' | 'small' | 'starve' | 'repeat', gather: [{pit, n, to}]}.
  function checkEnd(st, tournament, seen) {
    var b = st.b, left = boardSum(b), gather = [];
    function outcome(s) { return s[0] > s[1] ? 0 : (s[1] > s[0] ? 1 : -1); }
    if (st.s[0] > 24 || st.s[1] > 24) return { st: st, result: outcome(st.s), reason: 'score', gather: gather };
    if (!tournament) {
      if (left < 7) return { st: st, result: -1, reason: 'small', gather: gather };
      return null;
    }
    var f = clone(st), reason = null;
    if (sideSum(b, st.turn) === 0) {
      // Tournament: the side to move has no seed, the opponent takes all his own seeds.
      reason = 'starve';
    } else if (left < 7 && seen && seen[key(st)]) {
      reason = 'repeat';
    }
    if (!reason) return null;
    for (var i = 0; i < 12; i++) if (f.b[i]) {
      gather.push({ pit: i, n: f.b[i], to: owner(i) });
      f.s[owner(i)] += f.b[i]; f.b[i] = 0;
    }
    return { st: f, result: outcome(f.s), reason: reason, gather: gather };
  }

  function key(st) { return st.turn + ':' + st.b.join(','); }

  // ---------- Computer player: alpha-beta (negamax) ----------

  var WIN = 10000;

  // Static value for the side to move.
  function evaluate(st) {
    var p = st.turn, d = st.s[p] - st.s[1 - p];
    // small bonus for keeping seeds at home (mobility / threats)
    return d * 16 + (sideSum(st.b, p) - sideSum(st.b, 1 - p));
  }

  function terminalValue(st, tournament, plyFromRoot) {
    var e = checkEnd(st, tournament, null);
    if (!e) return null;
    if (e.result === -1) return 0;
    var v = WIN - plyFromRoot;
    return e.result === st.turn ? v : -v;
  }

  function search(st, depth, alpha, beta, tournament, ply, ctx) {
    if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) ctx.timeout = true;
    if (ctx.timeout) return 0;
    var t = terminalValue(st, tournament, ply);
    if (t !== null) return t;
    var moves = legalMoves(st);
    if (!moves.length) { // usual rules: no seed, pass
      var ps = clone(st); ps.turn = 1 - ps.turn;
      return depth <= 0 ? evaluate(st) : -search(ps, depth - 1, -beta, -alpha, tournament, ply + 1, ctx);
    }
    if (depth <= 0) return evaluate(st);
    var best = -Infinity;
    for (var k = 0; k < moves.length; k++) {
      var v = -search(doMove(st, moves[k], tournament).st, depth - 1, -beta, -alpha, tournament, ply + 1, ctx);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Depth (plies) and time budget by level 1..5.
  var LEVELS = { 1: { depth: 1, rand: 0.35 }, 2: { depth: 2, rand: 0.1 }, 3: { depth: 4, rand: 0 },
                 4: { depth: 6, rand: 0 }, 5: { depth: 14, rand: 0 } };

  // Chooses a move for the side to move. Iterative deepening, time-bounded.
  function bestMove(st, level, tournament, maxMs) {
    var moves = legalMoves(st);
    if (!moves.length) return -1;
    if (moves.length === 1) return moves[0];
    var cfg = LEVELS[level] || LEVELS[3];
    if (cfg.rand && Math.random() < cfg.rand) return moves[Math.floor(Math.random() * moves.length)];
    var ctx = { nodes: 0, deadline: Date.now() + (maxMs || 800), timeout: false };
    var order = moves.slice(), best = order[0];
    for (var d = 1; d <= cfg.depth; d++) {
      var scores = [], alpha = -Infinity, iterBest = null, iterVal = -Infinity;
      for (var k = 0; k < order.length; k++) {
        var v = -search(doMove(st, order[k], tournament).st, d - 1, -Infinity, -alpha + 1, tournament, 1, ctx);
        if (ctx.timeout) break;
        scores.push({ m: order[k], v: v });
        if (v > iterVal) { iterVal = v; iterBest = order[k]; }
        if (v > alpha) alpha = v;
      }
      if (ctx.timeout) break;
      // keep a random choice among equally good moves so games vary
      var ties = scores.filter(function (s) { return s.v === iterVal; });
      best = ties[Math.floor(Math.random() * ties.length)].m;
      scores.sort(function (x, y) { return y.v - x.v; });
      order = scores.map(function (s) { return s.m; });
      if (Math.abs(iterVal) > WIN / 2) break; // forced win/loss found
    }
    return best;
  }

  var api = {
    LETTERS: LETTERS, newState: newState, clone: clone, owner: owner, sideSum: sideSum, boardSum: boardSum,
    legalMoves: legalMoves, doMove: doMove, checkEnd: checkEnd, key: key, bestMove: bestMove
  };
  root.AweleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
