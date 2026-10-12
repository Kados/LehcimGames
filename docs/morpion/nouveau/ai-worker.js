/*
 * Morpion (nouvelle version) - Web Worker running the computer's search,
 * so that the page (pendulum, hover, buttons) never freezes.
 * Request:  {id, n, moves: [[cell, player], ...], p, level, opts}
 * Response: {id, c, info}
 */
/* global importScripts, MorpionEngine */
importScripts('engine.js');

self.onmessage = function (e) {
  var r = e.data;
  try {
    var g = MorpionEngine.replay(r.n, r.moves);
    var c = g.bestMove(r.p, r.level, null, r.opts);
    self.postMessage({ id: r.id, c: c, info: g.lastInfo });
  } catch (err) {
    self.postMessage({ id: r.id, error: String(err && err.message || err) });
  }
};
