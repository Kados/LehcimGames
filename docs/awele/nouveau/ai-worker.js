/*
 * Awélé (nouvelle version) - computer player in a Web Worker,
 * so the page never freezes while the computer thinks.
 * Message in : {id, st, opts}   (opts: see AweleEngine.think)
 * Message out: {id, res}        (res: {move, score, depth, nodes, ms, ...})
 */
importScripts('engine.js');
self.onmessage = function (e) {
  var d = e.data;
  var res = self.AweleEngine.think(d.st, d.opts);
  self.postMessage({ id: d.id, res: res });
};
