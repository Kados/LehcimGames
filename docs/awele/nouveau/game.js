/*
 * Awélé (nouvelle version) - page logic.
 * Same rules, image bank, seed layouts (../layouts.js), sounds and messages as the
 * original (../game.js reproduces AWELE.EXE), with a modern frame around them:
 *  - side panel (status, score, actions, game log, results), settings dialog, overlays,
 *  - preview of a move on hover / keyboard / first tap (last seed, captures, end),
 *  - undo, hint, adjustable speed of the original "ring" animation, end-of-game summary,
 *  - computer player in a Web Worker (ai-worker.js) with main-thread fallback;
 *    levels 1 to 5 = the original computer, level 6 "Maître" = new alpha-beta search.
 * The canvas is drawn at 2x (1280x800) so that texts and vector marks stay crisp; the
 * 640x400 pixel art is scaled with nearest-neighbour sampling.
 */
(function () {
  'use strict';

  var E = window.AweleEngine, LAY = window.AweleLayouts;
  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var SCALE = 2;
  var $ = function (id) { return document.getElementById(id); };
  var overlay = $('overlay');

  // ---------- Image bank layout (AWELE.EXE coordinates, as in ../game.js) ----------

  var KEY = [250, 250, 250];
  var SPR = {
    pit: [640, 0, 64, 64], store: [640, 64, 64, 128],
    red: [640, 192, 16, 16], green: [656, 192, 16, 16], holes: [640, 208, 64, 20],
    lit: [640, 228, 20, 8], unlit: [640, 236, 20, 8],
    ring: function (k) { return [704, k * 64, 64, 64]; },
    storeLit: function (k) { return [768, k * 128, 64, 128]; }
  };
  function pitXY(i) { return i < 6 ? { x: 128 + 64 * i, y: 134 } : { x: 128 + 64 * (11 - i), y: 70 }; }
  var STORE_XY = [{ x: 512, y: 70 }, { x: 64, y: 70 }];
  var IND_XY = [{ x: 572, y: 50 }, { x: 48, y: 50 }];
  var TICK = 40; // the original timer (ms)

  // ---------- Settings ----------

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  // defaults of the original (Awele.tut): tournament, level 3, the player starts
  var settings = { mode: 1, level: 3, starter: 0, speed: reduced ? 2 : 1, counts: 1, preview: 1, confirm: coarse ? 1 : 0 };
  var SKEY = 'lehcim.awele.nouveau.settings2';
  try {
    var saved = JSON.parse(localStorage.getItem(SKEY));
    if (saved) for (var k in settings) if (saved[k] != null) settings[k] = +saved[k];
  } catch (e) { /* ignore */ }
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  var SPEED = [1, 2, 4, 0];   // ticks of the original timer per 40 ms (0 = instant)
  var LEVEL_NAMES = { 1: '1 (novice)', 2: '2', 3: '3 (amateur)', 4: '4', 5: '5 (expert)', 6: 'Maître' };

  // ---------- Stats ----------

  var STKEY = 'lehcim.awele.nouveau.stats2';
  function loadStats() { try { return JSON.parse(localStorage.getItem(STKEY)) || {}; } catch (e) { return {}; } }
  function addStat(level, field, delta) {
    var st = loadStats(), r = st[level] || (st[level] = { w: 0, l: 0, d: 0 });
    r[field] = Math.max(0, (r[field] || 0) + delta);
    try { localStorage.setItem(STKEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
    renderStats();
  }
  function renderStats() {
    var st = loadStats(), html = '', any = false;
    for (var l = 1; l <= 6; l++) {
      var r = st[l]; if (!r || !(r.w + r.l + r.d)) continue;
      any = true;
      html += '<dt>Niveau ' + LEVEL_NAMES[l] + '</dt><dd>' + r.w + ' V - ' + r.d + ' N - ' + r.l + ' D</dd>';
    }
    $('stats').innerHTML = any ? html : '<dt>Aucune partie terminée pour l\'instant.</dt><dd></dd>';
  }

  // ---------- Computer player: Web Worker with main-thread fallback ----------

  var ai = (function () {
    var worker = null, broken = false, pending = null, seq = 0;
    function start() {
      if (broken || worker) return;
      try {
        worker = new Worker('ai-worker.js');
        worker.onmessage = function (e) {
          if (pending && e.data.id === pending.id) { var p = pending; pending = null; p.resolve(e.data.res); }
        };
        worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fail(); };
      } catch (e) { fail(); }
    }
    function fail() {
      broken = true;
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
      worker = null;
      if (pending) { var p = pending; pending = null; runHere(p); }
    }
    function runHere(p) {
      // fallback: same search on the page, with a shorter budget so the page never stalls long
      setTimeout(function () {
        if (p.cancelled) return;
        var o = Object.assign({}, p.opts);
        if (!o.ms || o.ms > 900) o.ms = 900;
        p.resolve(E.think(p.st, o));
      }, 30);
    }
    function think(st, opts) {
      cancel(); start();
      return new Promise(function (resolve) {
        var p = { id: ++seq, st: st, opts: opts, resolve: resolve };
        if (broken || !worker) { runHere(p); return; }
        pending = p;
        try { worker.postMessage({ id: p.id, st: st, opts: opts }); } catch (e) { fail(); }
      });
    }
    function cancel() {
      if (!pending) return;
      pending.cancelled = true; pending = null;
      if (worker) { worker.terminate(); worker = null; }
    }
    return { think: think, cancel: cancel, usesWorker: function () { return !broken && !!worker; } };
  })();

  // ---------- Game state ----------

  var game = null;   // {st, mode, level, moves, hist, over, token, snaps, undos, hints, starter, result}
  var disp = null;   // drawn pits and stores {b, s}; counters show cnt
  var cnt = null;    // live counters {b, s}
  var ind = [0, 0];  // turn lights
  var anim = null;
  var busy = true, thinking = false;
  var hover = -1, cursor = -1, armed = -1;
  var hintPit = -1, hintAt = 0;
  var lastPlayed = [-1, -1];
  var sessionGames = [];
  var lastStarter = 1, started = false, overlayKind = '';

  var soundsLoaded = false;
  // WAVE_1..7 of the original: 1 seeds picked up, 2 end of the sowing, 3 seed dropped,
  // 4 store lighting up after a capture, 5 end of the game, 6 menu click / new game, 7 pit captured.
  function sfx(n) { if (soundsLoaded) Lehcim.play('w' + n); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setStatus(t, cls) { $('statusText').textContent = t; $('status').className = 'status' + (cls ? ' ' + cls : ''); }
  function setSub(t) { $('substatus').textContent = t || ''; }
  function setThinking(on) { thinking = on; $('spin').hidden = !on; }
  function toast(text, ms) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }
  function emptyView() { return { b: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0] }; }
  function copyView(st) { return { b: st.b.slice(), s: st.s.slice() }; }

  function snapshot() {
    return { st: E.clone(game.st), hist: game.hist.slice(), n: game.moves.length, lastPlayed: lastPlayed.slice() };
  }

  function newGame() {
    ai.cancel();
    hideOverlay();
    anim = null;
    var starter = settings.starter === 2 ? 1 - lastStarter : settings.starter;
    lastStarter = starter;
    game = { st: E.newState(starter), mode: settings.mode, level: settings.level, moves: [], hist: [], over: false,
             token: {}, snaps: [], undos: 0, hints: 0, starter: starter, result: null };
    game.moves.header = { mode: game.mode, level: game.level };
    sessionGames.push(game.moves);
    disp = copyView(game.st); cnt = copyView(game.st); ind = [0, 0];
    lastPlayed = [-1, -1]; hintPit = -1; armed = -1;
    started = true;
    setSub('');
    sfx(6);
    renderPanel();
    nextTurn(game.token, false);
  }

  function alive(token) { return game && game.token === token && !game.over; }

  // passed: the other player had no seeds, the same side plays again
  function nextTurn(token, passed) {
    if (!alive(token)) return;
    var st = game.st;
    renderPanel();
    if (passed) toast(st.turn === 0 ? "L'ordinateur n'a plus de graines : tu rejoues." : "Tu n'as plus de graines : l'ordinateur rejoue.");
    if (st.turn === 1) {
      busy = true;
      setStatus("L'ordinateur réfléchit..."); setThinking(true); setSub('');
      var t0 = Date.now(), minWait = SPEED[settings.speed] ? 350 : 120;
      ai.think(E.clone(st), { level: game.level, mode: game.mode, hist: game.hist.slice() }).then(function (res) {
        if (!alive(token)) return;
        sleep(Math.max(0, minWait - (Date.now() - t0))).then(function () {
          if (!alive(token)) return;
          setThinking(false);
          setSub(describeSearch(res));
          ind = [0, 1];
          startMove(res.move, token);
        });
      });
    } else {
      game.snaps.push(snapshot());
      busy = false; setThinking(false);
      var mustFeed = E.sideSum(st.b, 1) === 0;
      setStatus(mustFeed ? "A toi : tu dois nourrir l'ordinateur." : 'A toi de jouer.', 'good');
      updatePreview();
      renderPanel();
    }
  }

  function fmtNodes(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  }
  function describeSearch(res) {
    if (!res) return '';
    if (res.original) return "L'ordinateur a joué comme l'original (" + [0, 1, 3, 5, 7, 9][game.level] + ' demi-coup' + (game.level > 1 ? 's' : '') + ').';
    if (!res.depth) return 'Coup unique.';
    var v = res.score, txt;
    if (v > E.WIN / 2) txt = 'gain forcé en vue';
    else if (v < -E.WIN / 2) txt = 'perte forcée en vue';
    else txt = Math.abs(v) < 8 ? 'position équilibrée' : 'il pense avoir ' + Math.abs(v / 16).toFixed(1).replace('.', ',') + ' graines ' + (v > 0 ? "d'avance" : 'de retard');
    return 'Réflexion du Maître : ' + res.depth + ' demi-coups, ' + fmtNodes(res.nodes) + ' positions, ' + txt + '.';
  }

  // ---------- The original animation: a ring carries the seeds (8 px per tick) ----------

  function startMove(pit, token) {
    busy = true; hover = -1; armed = -1; hintPit = -1; cursor = -1;
    $('preview').textContent = '';
    var st = game.st, side = st.turn, p = pitXY(pit);
    lastPlayed[side] = pit;
    setStatus(side === 1 ? "L'ordinateur joue la case " + E.LETTERS[pit] + '.' : 'Tu joues la case ' + E.LETTERS[pit] + '.');
    var wb = st.b.slice();
    anim = { token: token, side: side, origin: pit, idx: pit, seeds: wb[pit], x: p.x, y: p.y, phase: 'pick', k: 0,
             captured: false, wb: wb, ws: st.s.slice(), after: null, t: 0, gain: 0 };
    wb[pit] = 0; cnt.b[pit] = 0;   // counter at 0 at once, the pit is redrawn by the ring
    renderPanel();
    if (!SPEED[settings.speed]) { while (anim && anim.token === token) tick(true); }
  }

  function aligned(a) { return (a.x - 64) % 64 === 0 && (a.y === 70 || a.y === 134); }
  function capturable(a) {
    var n = a.wb[a.idx];
    return (n === 2 || n === 3) && (a.side === 0 ? a.y === 70 : a.y === 134);
  }
  function step(a) {
    if (a.y === 134) { if (a.x !== 448) a.x += 8; else a.y -= 8; }
    else if (a.y !== 70) { if (a.x === 448) a.y -= 8; else a.y += 8; }
    else { if (a.x !== 128) a.x -= 8; else a.y += 8; }
  }

  function tick(silent) {
    var a = anim, b = a.wb;
    if (!alive(a.token)) { anim = null; return; }
    if (a.phase === 'pick') {
      if (++a.k === 5) { a.k = 0; a.phase = 'sow'; if (!silent) sfx(1); }
      return;
    }
    if (a.phase === 'sow') {
      if (aligned(a)) {
        if (a.idx === a.origin) disp.b[a.idx] = b[a.idx];
        else { b[a.idx]++; a.seeds--; disp.b[a.idx] = cnt.b[a.idx] = b[a.idx]; if (!silent) sfx(3); }
        a.idx = (a.idx + 1) % 12;
      }
      if (a.seeds > 0) step(a);
      else { a.idx = (a.idx + 11) % 12; a.phase = capturable(a) ? 'capture' : 'end'; }
      return;
    }
    if (a.phase === 'capture') {
      if (aligned(a)) {
        if (!silent) sfx(7);
        var n = b[a.idx], keep = (!game.mode && E.sideSum(b, 1 - a.side) - n === 0) ? 1 : 0;
        a.ws[a.side] += n - keep; a.gain += n - keep; b[a.idx] = keep; disp.b[a.idx] = cnt.b[a.idx] = keep;
        cnt.s[a.side] = a.ws[a.side];
        a.idx = (a.idx + 11) % 12;
      }
      var limit = a.side === 0 ? 448 : 128;
      if (capturable(a) && a.x !== limit) a.x += a.side === 0 ? 8 : -8;
      else { a.phase = 'end'; a.captured = true; }
      return;
    }
    if (a.phase === 'end') {
      if (a.k === 0) {
        if (!silent) sfx(2);
        a.after = E.afterMove({ b: b.slice(), s: a.ws.slice(), turn: a.side }, game.mode, game.hist);
        if (a.after.gather.length) {
          a.captured = true;
          disp.b = a.after.st.b.slice(); cnt = copyView(a.after.st);
        }
        renderPanel();
      }
      if (a.captured && a.k === 5 && !silent) sfx(4);
      a.k++;
      if (a.k === 5) disp.s = a.after.st.s.slice();
      if (a.k === 6) { anim = null; moveDone(a); }
    }
  }

  function moveDone(a) {
    game.moves.push(E.LETTERS[a.origin]);
    var end = a.after;
    if (a.gain > 0) toast((a.side === 0 ? 'Tu prends ' : "L'ordinateur prend ") + a.gain + ' graine' + (a.gain > 1 ? 's' : '') + '.', 1800);
    game.st = end.st;
    disp = copyView(end.st); cnt = copyView(end.st);
    if (end.over) { finish(end); return; }
    if (end.st.turn === 0) ind = [1, 0];
    nextTurn(game.token, end.st.turn === a.side);
  }

  function finish(end) {
    busy = true; game.over = true; setThinking(false);
    sfx(5);
    var res = end.result, title = ['Tu as gagné!', 'Tu as perdu...', 'Ex-aequo'][res === -1 ? 2 : res];
    var text = end.repeated ? 'Position déjà jouée' : ['Bravo', 'Dommage', 'Peut mieux faire'][res === -1 ? 2 : res];
    game.result = res === 0 ? 'w' : (res === 1 ? 'l' : 'd');
    addStat(game.level, game.result, 1);
    var why;
    if (end.repeated) why = 'Position répétée avec moins de 7 graines : chacun ramasse les graines de son côté.';
    else if (end.gather.length) why = 'Un camp est vide : le joueur qui vient de jouer ramasse les graines de son côté.';
    else if (!game.mode && end.st.s[0] <= 24 && end.st.s[1] <= 24) why = 'Il reste moins de 7 graines : la partie est nulle (règles usuelles).';
    else why = 'Plus de 24 graines gagnées.';
    setStatus(title + ' - ' + text, res === 0 ? 'good' : (res === 1 ? 'bad' : '')); setSub(why);
    renderPanel();
    showSummary(title, text, end.st.s, why);
  }

  function abandon() {
    if (!game || game.over || !started) return;
    ai.cancel(); anim = null;
    game.over = true; busy = true; game.token = {}; setThinking(false);
    sfx(6);
    addStat(game.level, 'l', 1); game.result = 'l';
    setStatus('Partie abandonnée.'); setSub('');
    // as in the original: the board is emptied
    disp = emptyView(); cnt = emptyView(); ind = [0, 0]; lastPlayed = [-1, -1];
    renderPanel();
    showStart();
  }

  // Back to the previous position where it was the player's turn.
  function undo() {
    if (!game || !started) return;
    var snaps = game.snaps;
    if (!snaps.length) return;
    if (!game.over && !busy && game.st.turn === 0) {
      if (snaps.length < 2) { toast('Rien à annuler.'); return; }
      snaps.pop();
    }
    var sn = snaps[snaps.length - 1];
    ai.cancel(); anim = null;
    if (game.over && game.result) addStat(game.level, game.result, -1);
    game.result = null;
    game.token = {}; game.over = false;
    game.st = E.clone(sn.st); game.hist = sn.hist.slice();
    game.moves.length = sn.n;
    lastPlayed = sn.lastPlayed.slice();
    disp = copyView(game.st); cnt = copyView(game.st); ind = [1, 0];
    hintPit = -1; armed = -1;
    game.undos++;
    snaps.pop(); // nextTurn pushes it again
    hideOverlay(); setSub('');
    toast('Coup annulé.', 1500);
    nextTurn(game.token, false);
  }

  function hint() {
    if (!game || game.over || busy || game.st.turn !== 0) return;
    var token = game.token;
    busy = true; setThinking(true); setStatus('Je cherche un bon coup pour toi...');
    game.hints++;
    ai.think(E.clone(game.st), { level: 6, ms: 700, mode: game.mode, hist: game.hist.slice() }).then(function (res) {
      if (!alive(token)) return;
      busy = false; setThinking(false);
      setStatus('A toi de jouer.', 'good');
      hintPit = res.move; hintAt = performance.now();
      var pv = E.preview(game.st, res.move, game.mode, game.hist);
      var msg = 'Indice : joue la case ' + E.LETTERS[res.move] + (pv.gain ? ' (tu prends ' + pv.gain + ')' : '') + '.';
      toast(msg, 3500); setSub(msg);
      renderPanel();
    });
  }

  // ---------- Overlay ----------

  function showOverlay(html) {
    overlay.innerHTML = '<div class="card-in">' + html + '</div>'; overlay.hidden = false;
    var b = overlay.querySelector('button'); if (b) b.focus({ preventScroll: true });
  }
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; overlayKind = ''; }
  function showStart() {
    overlayKind = 'start';
    showOverlay('<h2>Awélé</h2><p>Sème les graines d\'une de tes 6 cases (en bas). Si ta dernière graine tombe chez l\'ordinateur sur une case qui a alors 2 ou 3 graines, tu les prends. Le premier à plus de 24 graines gagne.</p>' +
      '<p class="tiny">' + (settings.mode ? 'Règles de tournoi' : 'Règles usuelles') + ' - niveau ' + LEVEL_NAMES[settings.level] + ' - ' + (settings.starter === 1 ? "l'ordinateur commence" : (settings.starter === 2 ? 'chacun son tour' : 'tu commences')) + '</p>' +
      '<div class="btns"><button class="btn primary" data-act="play">▶ Nouvelle partie</button><button class="btn" data-act="settings">Réglages</button><button class="btn" data-act="help">Règles</button></div>');
  }
  function showSummary(title, text, s, reason) {
    var n0 = 0, n1 = 0;
    game.moves.forEach(function (m) { if (m === m.toUpperCase()) n0++; else n1++; });
    var extra = [];
    if (game.undos) extra.push(game.undos + ' annulation' + (game.undos > 1 ? 's' : ''));
    if (game.hints) extra.push(game.hints + ' indice' + (game.hints > 1 ? 's' : ''));
    showOverlay('<h2>' + title + '</h2><p class="txt">' + text + '</p>' +
      '<div class="big" aria-label="Toi ' + s[0] + ', ordinateur ' + s[1] + '">' + s[0] + ' - ' + s[1] + '</div><p class="tiny">Toi - Ordinateur</p>' +
      '<p class="tiny">' + reason + '</p>' +
      '<p class="tiny">' + (n0 + n1) + ' coups (' + n0 + ' pour toi), niveau ' + LEVEL_NAMES[game.level] + ', ' + (game.mode ? 'règles de tournoi' : 'règles usuelles') +
      (extra.length ? ', ' + extra.join(', ') : '') + '.</p>' +
      '<div class="btns"><button class="btn primary" data-act="play">Rejouer</button>' +
      (game.snaps.length ? '<button class="btn" data-act="undo">↶ Annuler</button>' : '') +
      '<button class="btn" data-act="close">Voir le plateau</button></div>');
  }
  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var a = b.dataset.act;
    if (a === 'play') newGame();
    else if (a === 'settings') openSettings();
    else if (a === 'help') $('help').showModal();
    else if (a === 'undo') undo();
    else if (a === 'close') hideOverlay();
  });

  // ---------- Side panel ----------

  function renderPanel() {
    if (!cnt) return;
    $('s0').textContent = cnt.s[0]; $('s1').textContent = cnt.s[1];
    $('bar0').style.width = Math.min(100, cnt.s[0] / 25 * 100) + '%';
    $('bar1').style.width = Math.min(100, cnt.s[1] / 25 * 100) + '%';
    var turn = game && !game.over && started ? (anim ? anim.side : game.st.turn) : -1;
    $('sc0').classList.toggle('turn', turn === 0); $('sc1').classList.toggle('turn', turn === 1);
    var mv = $('moves');
    if (game && started) {
      var src = game.starter === 0 ? 'tu as commencé' : "l'ordinateur a commencé";
      $('meta').textContent = (game.mode ? 'Règles de tournoi' : 'Règles usuelles') + ' - niveau ' + LEVEL_NAMES[game.level] + ' - ' + src + '.';
      if (!game.moves.length) mv.innerHTML = '<span class="empty">Aucun coup joué.</span>';
      else mv.innerHTML = game.moves.map(function (m, i) {
        return '<span class="' + (m === m.toUpperCase() ? 'p0' : 'p1') + (i === game.moves.length - 1 ? ' last' : '') + '"><small>' + (i + 1) + '</small>' + m + '</span>';
      }).join('');
      mv.scrollTop = mv.scrollHeight;
    } else {
      $('meta').textContent = 'Pas de partie en cours.';
      mv.innerHTML = '<span class="empty">Aucun coup joué.</span>';
    }
    $('logText').textContent = logText();
    var canUndo = game && started && game.snaps.length && (game.over || busy || game.snaps.length > 1);
    $('undo').disabled = !canUndo;
    $('hint').disabled = !(game && started && !game.over && !busy && game.st.turn === 0);
    $('abandon').disabled = !(game && !game.over && started);
  }

  function legalNow() { return (!busy && game && started && !game.over && game.st.turn === 0) ? E.legalMoves(game.st, game.mode) : []; }
  function activePit() {
    var legal = legalNow(), i = armed >= 0 ? armed : (hover >= 0 ? hover : cursor);
    return legal.indexOf(i) >= 0 ? i : -1;
  }
  function updatePreview() {
    var el = $('preview'), i = activePit();
    if (i < 0 || !settings.preview) { el.textContent = ''; return; }
    var pv = E.preview(game.st, i, game.mode, game.hist);
    var t = 'Case <b>' + E.LETTERS[i] + '</b> : ' + pv.n + ' graine' + (pv.n > 1 ? 's' : '') + ', la dernière tombe en <b>' + E.LETTERS[pv.last] + '</b>';
    t += pv.gain ? ', tu prends <b>' + pv.gain + '</b> graine' + (pv.gain > 1 ? 's' : '') : ', pas de prise';
    if (pv.repeated) t += ", position déjà jouée : la partie s'arrête";
    else if (pv.gathered) t += ', puis tu ramasses tes ' + pv.gathered + ' graines';
    else if (pv.again) t += ", l'ordinateur n'aura plus de graines : tu rejoueras";
    t += '.';
    if (armed === i) t += ' Touche encore pour jouer.';
    el.innerHTML = t;
  }

  // ---------- Game log (AwParties.txt, format of the original) ----------

  var NL = '\r\n';
  function logText() {
    var t = "---------Jeu d'AWELE----------------------> par Lehcim Noil " + NL + NL +
      'Enregistrement des parties jouées à la dernière session.' + NL +
      'Attention, elles seront effacées à la session suivante !' + NL + NL +
      'Chaque lettre correspond à une case selon la convention suivante:' + NL +
      "  Pour l'ordinateur: f e d c b a" + NL +
      '  Pour le joueur:    A B C D E F' + NL;
    sessionGames.forEach(function (m, n) {
      t += NL + NL + 'Partie ' + (n + 1) + (m.header.mode ? '  - Mode Tournoi' : '  - Règles usuelles') +
        '  - Niveau ' + m.header.level + NL + m.map(function (l) { return l + '.'; }).join('');
    });
    return t;
  }
  $('logDownload').addEventListener('click', function () {
    var t = logText(), bytes = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); bytes[i] = c < 256 ? c : 63; }
    var url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
    var a = document.createElement('a'); a.href = url; a.download = 'AwParties.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  $('logCopy').addEventListener('click', function () {
    var t = logText().replace(/\r\n/g, '\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('Parties copiées.'); }, function () { toast('Copie impossible.'); });
    } else toast('Copie impossible.');
  });

  // ---------- Drawing ----------

  var sheet = null, keyed = null;
  function blit(src, r, x, y) { g.drawImage(src, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); }
  // A pit as the original draws it: tile, band of 3 small holes, up to 11 green balls,
  // one red ball in a hole per 11 seeds.
  function drawPit(i, n) {
    var p = pitXY(i), hy = i < 6 ? p.y + 64 : p.y - 20;
    blit(sheet, SPR.pit, p.x, p.y);
    blit(sheet, SPR.holes, p.x, hy);
    if (!n) return;
    var reds = Math.floor((n - 1) / 11), l = LAY.PIT[(n - 1) % 11 + 1], k;
    for (k = 0; k < reds && k < 3; k++) blit(keyed, SPR.red, p.x + 10 + 14 * k, hy + 2);
    for (k = 0; k < l.length; k += 2) blit(keyed, SPR.green, p.x + l[k], p.y + l[k + 1]);
  }
  function drawStore(s, n) {
    var q = STORE_XY[s], l = LAY.STORE[Math.min(n, 48)];
    blit(sheet, SPR.store, q.x, q.y);
    for (var k = 0; k < l.length; k += 2) blit(keyed, SPR.green, q.x + l[k], q.y + l[k + 1]);
  }
  function badge(x, y, text, bg, fg) {
    g.font = 'bold 10px system-ui, Arial, sans-serif';
    var w = Math.max(14, g.measureText(text).width + 7);
    g.fillStyle = bg; g.beginPath();
    if (g.roundRect) g.roundRect(x - w / 2, y - 7, w, 14, 7); else g.rect(x - w / 2, y - 7, w, 14);
    g.fill();
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5);
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (!sheet) return;
    // run the original 40 ms timer (faster with the speed setting)
    if (anim) {
      var per = TICK / (SPEED[settings.speed] || 1);
      if (!anim.t) anim.t = now;
      var guard = 0;
      while (anim && now - anim.t >= per && guard++ < 200) { anim.t += per; tick(false); }
    }
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    g.imageSmoothingEnabled = false;
    blit(sheet, [0, 0, 640, 400], 0, 0);
    if (!disp) return;
    var legal = legalNow(), act = activePit();
    var pv = (act >= 0 && settings.preview) ? E.preview(game.st, act, game.mode, game.hist) : null;

    for (var i = 0; i < 12; i++) drawPit(i, disp.b[i]);
    drawStore(0, disp.s[0]); drawStore(1, disp.s[1]);
    blit(sheet, ind[0] ? SPR.lit : SPR.unlit, IND_XY[0].x, IND_XY[0].y);
    blit(sheet, ind[1] ? SPR.lit : SPR.unlit, IND_XY[1].x, IND_XY[1].y);

    if (!anim) {
      // last move of each side: faint ring (a frame of the original ring)
      for (var s = 0; s < 2; s++) if (lastPlayed[s] >= 0 && lastPlayed[s] !== act) { var lp0 = pitXY(lastPlayed[s]); blit(keyed, SPR.ring(4), lp0.x, lp0.y); }
      if (act >= 0) { var ap = pitXY(act); blit(keyed, SPR.ring(0), ap.x, ap.y); }
      else if (hintPit >= 0 && legal.indexOf(hintPit) >= 0) {
        var ph = Math.floor((now - hintAt) / 160) % 6, hp = pitXY(hintPit);
        blit(keyed, SPR.ring(ph < 3 ? ph : 5 - ph), hp.x, hp.y);
      }
    }
    if (pv) {
      var lp = pitXY(pv.last);
      g.save();
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.setLineDash([4, 3]);
      g.lineDashOffset = -now / 60;
      g.beginPath(); g.arc(lp.x + 32, lp.y + 32, 27, 0, Math.PI * 2); g.stroke();
      g.restore();
      pv.caps.forEach(function (c) {
        var cp = pitXY(c.pit);
        g.fillStyle = 'rgba(220,30,30,0.3)';
        g.beginPath(); g.arc(cp.x + 32, cp.y + 32, 26, 0, Math.PI * 2); g.fill();
        badge(cp.x + 32, cp.y + 10, '+' + (c.n - c.keep), '#c62020', '#fff');
      });
    }
    var a = anim;
    if (a) {
      var fr = a.phase === 'pick' ? 5 - a.k : (a.phase === 'end' ? Math.min(a.k, 5) : 0);
      if (a.phase === 'end' && a.captured && a.k <= 5) blit(keyed, SPR.storeLit(a.k % 3), STORE_XY[a.side].x, STORE_XY[a.side].y);
      blit(keyed, SPR.ring(fr), a.x, a.y);
    }
    if (settings.counts && started) {
      for (var j = 0; j < 12; j++) {
        var pp = pitXY(j);
        badge(pp.x + 54, j < 6 ? pp.y + 56 : pp.y + 8, String(disp.b[j]), 'rgba(16,32,90,0.85)', '#fff');
      }
    }
    if (game && started) {
      // texts of the original: banner and counters of the lower panel
      g.textBaseline = 'top'; g.textAlign = 'left';
      g.font = '13.5px Arial, Helvetica, sans-serif';
      g.fillStyle = '#930103'; g.fillText(game.mode ? 'Mode Tournoi' : 'Règles usuelles', 130, 12);
      g.fillStyle = '#020000'; g.fillText('Niveau', 291, 13);
      g.font = 'bold 14px Arial, Helvetica, sans-serif';
      g.fillText(game.level === 6 ? 'M' : String(game.level), 341, 11);
      g.font = '13.5px Arial, Helvetica, sans-serif'; g.fillStyle = '#000';
      for (var c2 = 0; c2 < 12; c2++) {
        var v = cnt.b[c2], dx = v < 10 ? 4 : 0;
        g.fillText(String(v), (c2 < 6 ? (c2 + 1) * 64 + 88 : (12 - c2) * 64 + 88) + dx - 1, c2 < 6 ? 325 : 289);
      }
      g.fillText(String(cnt.s[0]), 531 + (cnt.s[0] < 10 ? 4 : 0), 307);
      g.fillText(String(cnt.s[1]), 91 + (cnt.s[1] < 10 ? 4 : 0), 307);
      // letters of the player's pits (keyboard keys)
      g.font = 'bold 9px Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.textBaseline = 'middle'; g.textAlign = 'center';
      for (var pk = 0; pk < 6; pk++) { var px = pitXY(pk); g.fillText(E.LETTERS[pk], px.x + 9, px.y + 56); }
    }
  }

  // ---------- Fit the canvas in the stage ----------

  function fit() {
    var stage = $('stage'), w = stage.clientWidth;
    var top = stage.getBoundingClientRect().top + window.scrollY;
    var wide = window.innerWidth > 900;
    var maxH = wide ? Math.max(260, window.innerHeight - Math.max(top, 64) - 24) : 1e9;
    var cw = Math.min(w, maxH * 1.6, 1280);
    canvas.style.width = Math.floor(cw) + 'px';
    canvas.style.height = Math.floor(cw / 1.6) + 'px';
  }
  window.addEventListener('resize', fit);

  // ---------- Input ----------

  function pitAt(e) {
    var pos = Lehcim.canvasPos(canvas, e);
    pos.x /= SCALE; pos.y /= SCALE;
    for (var i = 0; i < 6; i++) {
      var p = pitXY(i), dx = pos.x - (p.x + 32), dy = pos.y - (p.y + 32);
      if (dx * dx + dy * dy <= 31 * 31) return i;
    }
    return -1;
  }
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var h = pitAt(e);
    if (h !== hover) { hover = h; updatePreview(); }
    canvas.style.cursor = legalNow().indexOf(hover) >= 0 ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', function () { hover = -1; updatePreview(); });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (!game || !started || game.over || game.st.turn !== 0) return;
    if (busy) { if (thinking) toast("Patiente, l'ordinateur réfléchit."); return; }
    var i = pitAt(e);
    if (i < 0) { armed = -1; updatePreview(); return; }
    tryPlay(i, e.pointerType === 'touch' && settings.confirm);
  });
  function tryPlay(i, needConfirm) {
    if (E.legalMoves(game.st, game.mode).indexOf(i) < 0) {
      armed = -1; updatePreview();
      toast(game.st.b[i] === 0 ? 'Cette case est vide.' : "Ce coup laisserait l'ordinateur sans graines : choisis une case qui le nourrit.");
      return;
    }
    if (needConfirm && armed !== i) { armed = i; updatePreview(); return; }
    ind = [1, 0];
    startMove(i, game.token);
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    var tag = (e.target && e.target.tagName) || '', key = e.key;
    if (tag === 'BUTTON' && (key === 'Enter' || key === ' ')) return;
    if (key === 'n' || key === 'N') { askNewGame(); return; }
    if (key === 'u' || key === 'U') { undo(); return; }
    if (key === 'i' || key === 'I') { hint(); return; }
    if (!game || !started || game.over || busy || game.st.turn !== 0) return;
    var idx = '123456'.indexOf(key);
    if (idx < 0 && key.length === 1) idx = 'abcdef'.indexOf(key.toLowerCase());
    if (key.length === 1 && idx >= 0) { e.preventDefault(); tryPlay(idx, false); return; }
    var legal = E.legalMoves(game.st, game.mode);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      var dir = key === 'ArrowRight' ? 1 : -1, c = cursor < 0 ? (dir > 0 ? -1 : 6) : cursor;
      for (var n = 0; n < 6; n++) { c = (c + dir + 6) % 6; if (legal.indexOf(c) >= 0) break; }
      cursor = c; hover = -1; updatePreview();
      return;
    }
    if ((key === 'Enter' || key === ' ') && cursor >= 0) { e.preventDefault(); tryPlay(cursor, false); }
  });

  function askNewGame() {
    if (game && started && !game.over && game.moves.length >= 4) {
      Lehcim.message('Commencer une nouvelle partie ?\nLa partie en cours sera comptée comme perdue.', ['Nouvelle partie', 'Continuer']).then(function (r) {
        if (r === 0) { addStat(game.level, 'l', 1); game.over = true; newGame(); }
      });
    } else newGame();
  }
  $('new').addEventListener('click', askNewGame);
  $('abandon').addEventListener('click', function () {
    Lehcim.message('Abandonner la partie ?', ['Abandonner', 'Continuer']).then(function (r) { if (r === 0) abandon(); });
  });
  $('undo').addEventListener('click', undo);
  $('hint').addEventListener('click', hint);

  // ---------- Settings dialog ----------

  function syncSettingsUI() {
    document.querySelectorAll('#settings .seg').forEach(function (seg) {
      var key = seg.dataset.set;
      seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.v === settings[key])); });
    });
    document.querySelectorAll('#settings input[type=checkbox]').forEach(function (c) { c.checked = !!settings[c.dataset.set]; });
  }
  function openSettings() { syncSettingsUI(); $('settings').showModal(); }
  $('settingsBtn').addEventListener('click', openSettings);
  var GAME_KEYS = { mode: 1, level: 1, starter: 1 };
  function onSetting(key) {
    saveSettings(); syncSettingsUI(); sfx(6);
    if (GAME_KEYS[key]) {
      if (game && started && !game.moves.length && !game.over && !anim) { sessionGames.pop(); newGame(); }
      else if (game && started && !game.over) toast('Réglage pris en compte à la prochaine partie.');
      else if (overlayKind === 'start') showStart();
    }
    updatePreview();
  }
  document.querySelectorAll('#settings .seg').forEach(function (seg) {
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      settings[seg.dataset.set] = +b.dataset.v; onSetting(seg.dataset.set);
    });
  });
  document.querySelectorAll('#settings input[type=checkbox]').forEach(function (c) {
    c.addEventListener('change', function () { settings[c.dataset.set] = c.checked ? 1 : 0; onSetting(c.dataset.set); });
  });

  // ---------- Start ----------

  Lehcim.initPage();
  var muteBtn = document.querySelector('[data-mute]');
  function muteIcon() { muteBtn.textContent = Lehcim.isMuted() ? '🔇' : '🔊'; muteBtn.setAttribute('aria-label', Lehcim.isMuted() ? 'Son coupé (activer)' : 'Son activé (couper)'); }
  muteBtn.addEventListener('click', muteIcon); muteIcon();

  function loadSounds() {
    if (soundsLoaded) return; soundsLoaded = true;
    var m = {}; for (var i = 1; i <= 7; i++) m['w' + i] = '../assets/sounds/' + i + '.wav';
    Lehcim.loadSounds(m);
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSounds, { once: true }); });

  renderStats();
  fit();
  setStatus('Prêt à jouer.'); setSub('Choisis tes réglages puis lance la partie.');
  // no game at start, as in the original: empty board behind the start screen
  disp = emptyView(); cnt = emptyView();
  game = { st: E.newState(0), mode: settings.mode, level: settings.level, moves: [], hist: [], over: true, token: {}, snaps: [], undos: 0, hints: 0, starter: 0 };
  Promise.all([Lehcim.loadSheet('../assets/sheet.png', null), Lehcim.loadSheet('../assets/sheet.png', KEY)])
    .then(function (s) { sheet = s[0]; keyed = s[1]; renderPanel(); showStart(); fit(); });
  requestAnimationFrame(draw);

  // test hook (automated checks only)
  window.__awele = {
    get game() { return game; }, get busy() { return busy; }, get thinking() { return thinking; }, get anim() { return anim; },
    usesWorker: function () { return ai.usesWorker(); }, logText: logText, settings: settings
  };
})();
