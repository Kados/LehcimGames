/*
 * Agora (nouvelle version) - Web Worker running the computer player, so the
 * page never freezes while the computer thinks. The transposition table is
 * kept between moves of the same game: Agora has no draw, so the value of a
 * position does not depend on the game history and only the position is sent.
 * Messages in: {type:'reset'} or {type:'think', id, stacks, side, opts}.
 * Messages out: {id, result} (result: see AgoraEngine.Engine.think).
 */
/* global importScripts, AgoraEngine */
importScripts('engine.js');
var engine = new AgoraEngine.Engine();
onmessage = function (e) {
  var d = e.data;
  if (d.type === 'reset') { engine.clear(); return; }
  var p = AgoraEngine.Pos.fromStacks(d.stacks, d.side);
  var r = engine.think(p, d.opts);
  postMessage({ id: d.id, result: r });
};
