/*
 * Colours-MIX (nouvelle version) - computer player in a Web Worker, so the
 * animation never freezes while it thinks. Message in: {id, st} (see
 * CMEngine.Search); message out: {id, result}.
 */
importScripts('engine.js');

self.onmessage = function (e) {
  var d = e.data;
  var st = d.st;
  st.colors = new Uint8Array(st.colors);
  st.pyr = new Uint8Array(st.pyr);
  var result = null;
  try { result = self.CMEngine.choose(st); } catch (err) { result = null; }
  self.postMessage({ id: d.id, result: result });
};
