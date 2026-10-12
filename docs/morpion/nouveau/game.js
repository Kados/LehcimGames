/*
 * Morpion (nouvelle version) - page logic.
 * Same game as ../game.js (Lehcim Noil's five-in-a-row scoring game), with the
 * original sprites and sounds, in the shared "nouvelle version" shell.
 * Rules as in the original (checked under Wine): the player always has the grey
 * marbles, the computer the orange ones whoever starts; boards 8-8 (default),
 * 10-10, 12-12; levels 1 (default) to 5; the computer's first marble goes on
 * (N/2-1, N/2-1); end messages "Bravo / Tu as gagné!", "Dommage / Tu as
 * perdu...", "Peut mieux faire / Ex-aequo"; scored lines crossed out by a
 * continuous red line. Additions of this version:
 *   - the computer searches in a Web Worker (ai-worker.js), with a fallback to
 *     the page when workers are unavailable (file://, old browsers, errors);
 *   - keyboard cursor, hover preview, confirm-tap on phones, last move,
 *     optional threat display, undo, hint, move history, end-of-game summary;
 *   - the board is drawn at the device resolution (crisp on any zoom) and the
 *     cells grow on small boards; on narrow screens only the board square of
 *     the original picture is shown, the panel moves to the side cards.
 */
(function () {
  'use strict';

  var E = window.MorpionEngine;
  var KEY = [250, 250, 250];         // colour key of the sheet (near-white)
  var BOARD_AREA = 320;              // board square of the original 400x320 picture
  var COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Sprite rectangles in ../assets/sheet.png (same as ../game.js)
  var SPR = {
    tile: function (i, j) { return [400 + 20 * (i % 4), 20 * (j % 2), 20, 20]; },
    marble: [null, [480, 20, 20, 20], [480, 0, 20, 20]],                     // 1 player grey, 2 computer orange
    digit: function (k) { return [400 + 20 * (k - 1), 40, 20, 20]; },
    patience: [400, 80, 80, 20],
    thinking: [400, 100, 80, 20],
    pendulum: function (k) { return [400 + 40 * (k % 2), 120 + 40 * (k >> 1), 40, 40]; },
    bien: function (k) { return [480, 60 + 20 * k, 32, 20]; }
  };
  var POS = {
    digit: [370, 0], patience: [320, 120], thinking: [320, 140], pendulum: [340, 160],
    // orange box (left) = computer, grey box (right) = player, as in the original
    bien: [346, 250], score: [[0, 0], [380, 67], [342, 67]], turn: [[0, 0], [370, 82], [332, 82]]
  };

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game'), g2 = canvas.getContext('2d'), stage = $('stage'), overlay = $('overlay');
  var pend = $('pendulum'), pg = pend.getContext('2d');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var sheet = null;

  // ---------- Settings ----------

  // defaults of the original: 8-8, level 1, the player starts
  var S = { size: 8, level: 1, first: 1, threats: 1, speed: 650, confirm: 'auto' };
  var SIZES = [8, 10, 12];
  var STORE = 'lehcim.morpion.nv2';
  try { var saved = JSON.parse(localStorage.getItem(STORE)); if (saved) for (var k in S) if (saved[k] != null) S[k] = saved[k]; } catch (e) { /* ignore */ }
  if (SIZES.indexOf(+S.size) < 0) S.size = 8;
  if (!(+S.level >= 1 && +S.level <= 5)) S.level = 1;
  function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function loadStats() { try { return JSON.parse(localStorage.getItem(STORE + '.stats')) || {}; } catch (e) { return {}; } }
  function saveStats(st) { try { localStorage.setItem(STORE + '.stats', JSON.stringify(st)); } catch (e) { /* ignore */ } }
  var lastStarter = 2;
  try { lastStarter = +localStorage.getItem(STORE + '.starter') || 2; } catch (e) { /* ignore */ }

  var LEVEL_TEXT = [
    '',
    'Niveau 1 (0.5s. dans l\'original) : il ne calcule pas à l\'avance, mais prend toujours un point et bloque toujours un 4.',
    'Niveau 2 (1s.) : il regarde un coup à l\'avance et suit les menaces de 4 qui en découlent.',
    'Niveau 3 (12s) : il calcule 3 demi-coups et suit les menaces de 4 jusqu\'au bout.',
    'Niveau 4 (25s) : il calcule 5 demi-coups (jusqu\'à 1,5 s de réflexion ici).',
    'Niveau 5 (1min40s) : le plus fort, il approfondit tant qu\'il a du temps (jusqu\'à 2,5 s ici).'
  ];

  // ---------- State ----------

  var game = null, N = 8, cs = 36, ox = 16, oy = 16;
  var history = [];                 // {c, p, rec, pts}
  var turn = 1, starter = 1, thinking = false, ended = false, started = false, gaveUp = false;
  var lastMove = -1, hover = -1, cursor = -1, showCursor = false, sel = -1;
  var hintCell = -1, hintUntil = 0, flashCell = -1, flashUntil = 0;
  var patienceUntil = 0, bienStart = -1, thinkStart = 0, lineFlash = [];
  var drops = {};                   // cell -> animation start
  var token = 0, hints = 0, undos = 0, startTime = 0, hintBusy = false;
  var full = true, LW = 400, scale = 1;

  // ---------- Computer player: Web Worker with fallback ----------

  var AI = (function () {
    var worker = null, failed = typeof Worker === 'undefined', pending = null, seq = 0;
    var mode = '';
    function spawn() {
      try {
        worker = new Worker('ai-worker.js');
        worker.onmessage = onMsg;
        worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); fail(); };
      } catch (e) { worker = null; failed = true; }
    }
    function fail() {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
      worker = null; failed = true;
      if (pending) { var p = pending; pending = null; clearTimeout(p.watch); runLocal(p); }
    }
    function onMsg(e) {
      var d = e.data;
      if (!pending || d.id !== pending.id) return;
      var p = pending; pending = null; clearTimeout(p.watch);
      if (d.error) { failed = true; runLocal(p); return; }
      mode = 'Web Worker';
      p.cb(d.c, d.info, mode);
    }
    function runLocal(p) {
      // main-thread fallback: legacy time budgets (the page freezes while searching)
      mode = 'page (secours)';
      setTimeout(function () {
        if (p.cancelled) return;
        var r = p.req, g = E.replay(r.n, r.moves), o = {};
        for (var k in r.opts) o[k] = r.opts[k];
        o.worker = false;
        if (o.time) o.time = Math.min(o.time, 1400);
        var c = g.bestMove(r.p, r.level, null, o);
        if (!p.cancelled) p.cb(c, g.lastInfo, mode);
      }, 40);
    }
    function search(req, cb) {
      cancel();
      var p = { id: ++seq, req: req, cb: cb, cancelled: false };
      current = p;
      if (!failed && !worker) spawn();
      if (worker) {
        pending = p;
        req.opts = req.opts || {}; req.opts.worker = true;
        var budget = req.opts.time || E.LEVELS[req.level].timeWorker || E.LEVELS[req.level].time;
        p.watch = setTimeout(fail, budget + 5000);
        try { worker.postMessage({ id: p.id, n: req.n, moves: req.moves, p: req.p, level: req.level, opts: req.opts }); }
        catch (e) { fail(); }
      } else runLocal(p);
    }
    var current = null;
    function cancel() {
      if (current) current.cancelled = true;
      current = null;
      if (pending) {
        clearTimeout(pending.watch); pending = null;
        if (worker) { worker.terminate(); worker = null; } // a fresh worker answers the next request
      }
    }
    return { search: search, cancel: cancel, mode: function () { return mode || (failed ? 'page (secours)' : 'Web Worker'); } };
  })();

  // ---------- Helpers ----------

  function name(c) { return COLS[c % N] + (Math.floor(c / N) + 1); }
  function toast(text, ms) {
    var box = $('toasts'), t = document.createElement('div');
    t.className = 'toast'; t.textContent = text; box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2600);
  }
  function playerMoves() { var k = 0; for (var i = 0; i < history.length; i++) if (history[i].p === 1) k++; return k; }
  function confirmMode(pointerType) {
    if (S.confirm === 'on') return true;
    if (S.confirm === 'off') return false;
    return pointerType !== 'mouse' && (coarse || pointerType === 'touch') && N >= 12;
  }

  // ---------- Game flow ----------

  function layoutBoard() {
    cs = Math.min(36, Math.floor(300 / N));
    ox = oy = (BOARD_AREA - N * cs) >> 1;
  }

  function newGame() {
    token++; AI.cancel();
    N = +S.size;
    game = new E.Game(N);
    layoutBoard();
    starter = +S.first === 3 ? 3 - lastStarter : +S.first;
    lastStarter = starter;
    try { localStorage.setItem(STORE + '.starter', String(starter)); } catch (e) { /* ignore */ }
    turn = starter; history = [];
    thinking = false; ended = false; gaveUp = false; started = true; hintBusy = false;
    lastMove = -1; sel = -1; hover = -1; hintCell = -1; bienStart = -1; lineFlash = []; drops = {};
    cursor = (N >> 1) * N + (N >> 1) - 1;
    hints = 0; undos = 0; startTime = Date.now();
    hideOverlay();
    refresh();
    if (turn === 2) computerTurn();
  }

  function place(c, p) {
    var rec = game.play(c, p);
    history.push({ c: c, p: p, rec: rec, pts: rec.scored.length });
    lastMove = c; sel = -1; hintCell = -1;
    drops[c] = performance.now();
    Lehcim.play('drop');
    if (rec.scored.length) {
      for (var i = 0; i < rec.scored.length; i++) lineFlash.push({ w: rec.scored[i], t: performance.now() });
      if (p === 1) {
        Lehcim.play('point'); bienStart = performance.now();
        toast(rec.scored.length > 1 ? 'BIEN ! +' + rec.scored.length + ' points' : 'BIEN ! +1 point');
      } else {
        Lehcim.play('cpu');
        toast("L'ordinateur marque " + (rec.scored.length > 1 ? rec.scored.length + ' points' : 'un point'));
      }
    }
  }

  function next() {
    if (game.over()) { endGame(); return; }
    turn = 3 - turn;
    if (turn === 2) computerTurn();
    refresh();
  }

  function computerTurn() {
    var my = token;
    thinking = true; thinkStart = performance.now(); refresh();
    var t0 = performance.now();
    AI.search({ n: N, moves: history.map(function (h) { return [h.c, h.p]; }), p: 2, level: +S.level }, function (c, info) {
      if (my !== token) return;
      showSearchInfo(info);
      var wait = Math.max(0, +S.speed - (performance.now() - t0));
      setTimeout(function () {
        if (my !== token) return;
        thinking = false;
        if (c >= 0 && !game.board[c]) place(c, 2);
        next();
      }, wait);
    });
  }

  function showSearchInfo(info) {
    $('infoMode').textContent = AI.mode();
    if (!info) return;
    if (!info.depth) { $('infoSearch').textContent = 'coup direct'; return; }
    var nodes = info.nodes + (info.qnodes || 0);
    var nTxt = nodes >= 1000 ? Math.round(nodes / 1000) + ' k' : String(nodes);
    $('infoSearch').textContent = 'prof. ' + info.depth + ', ' + nTxt + ' pos., ' + (info.ms / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  function humanPlay(c) {
    if (!game || ended || !started) return;
    if (thinking) { patience(); return; }
    if (turn !== 1 || c < 0 || game.board[c]) return;
    place(c, 1);
    next();
  }

  function patience() {
    var now = performance.now();
    if (now > patienceUntil) toast('Patience ! Je réfléchis...', 1500);
    patienceUntil = now + 1500;
  }

  function undo() {
    if (!game || !started) return;
    if (playerMoves() === 0) { toast('Rien à annuler'); return; }
    if (gaveUp) { toast('Partie abandonnée : lance une nouvelle partie'); return; }
    token++; AI.cancel(); thinking = false; hintBusy = false;
    var h;
    do { h = history.pop(); game.undo(h.rec); } while (h.p !== 1);
    // forget line animations of undone lines
    lineFlash = [];
    ended = false; turn = 1; undos++;
    lastMove = history.length ? history[history.length - 1].c : -1;
    cursor = h.c; sel = -1; hintCell = -1;
    hideOverlay();
    refresh();
    toast('Coup annulé');
  }

  function hint() {
    if (!game || !started || ended || hintBusy) return;
    if (thinking) { patience(); return; }
    if (turn !== 1) return;
    hintBusy = true; refresh();
    var my = token;
    AI.search({ n: N, moves: history.map(function (h) { return [h.c, h.p]; }), p: 1, level: 4, opts: { time: 800 } }, function (c) {
      hintBusy = false;
      if (my !== token || ended || turn !== 1) { refresh(); return; }
      if (c >= 0) {
        hints++; hintCell = c; hintUntil = performance.now() + 5000; cursor = c;
        toast('Indice : essaie la case ' + name(c));
      }
      refresh();
    });
  }

  function giveUp() {
    if (!game || !started || ended) return;
    if (thinking) { patience(); return; }
    if (playerMoves() === 0) { toast("La partie n'a pas commencé"); return; }
    Lehcim.message("Tout va s'effacer...\nVeux-tu vraiment abandonner ?", ['OUI', 'NON']).then(function (i) {
      if (i !== 0) return;
      gaveUp = true; endGame();
    });
  }

  function askNewGame() {
    if (!started || ended || playerMoves() === 0) { newGame(); return; }
    Lehcim.message('La partie en cours sera perdue.\nCommencer une nouvelle partie ?', ['OUI', 'NON']).then(function (i) { if (i === 0) newGame(); });
  }

  function endGame() {
    ended = true; thinking = false; token++; AI.cancel();
    var a = game.score[1], b = game.score[2], res;
    if (gaveUp) res = 'l';
    else res = a > b ? 'w' : a < b ? 'l' : 'd';
    var st = loadStats(), r = st[S.level] || (st[S.level] = { w: 0, d: 0, l: 0 });
    r[res]++; saveStats(st);
    if (res === 'w' || res === 'd') Lehcim.play('end'); else Lehcim.play('cpu');
    refresh();
    setTimeout(function () { showSummary(res); }, gaveUp ? 0 : 700);
  }

  // ---------- Overlay ----------

  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
  function showOverlay(html, focusSel) {
    overlay.innerHTML = html; overlay.hidden = false;
    var f = overlay.querySelector(focusSel || '.btn.primary');
    if (f) f.focus();
  }
  function bindOverlay(map) {
    Object.keys(map).forEach(function (id) { var b = overlay.querySelector('#' + id); if (b) b.addEventListener('click', map[id]); });
  }

  function showStart() {
    showOverlay(
      '<h2>Morpion</h2>' +
      '<p>Aligne 5 billes grises (en ligne, en colonne ou en diagonale) pour marquer un point. L\'ordinateur joue les orange, même quand il commence. ' +
      'La partie continue tant que quelqu\'un peut encore marquer : celui qui a le plus de points gagne.</p>' +
      '<p>Clique ou touche une case libre, ou utilise les flèches et Entrée.</p>' +
      '<div class="btns"><button class="btn primary" id="ovPlay">Jouer</button><button class="btn" id="ovSettings">Réglages</button><button class="btn" id="ovRules">Règles</button></div>');
    bindOverlay({ ovPlay: newGame, ovSettings: openSettings, ovRules: function () { $('help').showModal(); } });
  }

  function showSummary(res) {
    var a = game.score[1], b = game.score[2];
    // the original's end messages (MessageBox text / title)
    var title = gaveUp ? 'Partie abandonnée' : res === 'w' ? 'Bravo' : res === 'l' ? 'Dommage' : 'Peut mieux faire';
    var sub = gaveUp ? '' : res === 'w' ? 'Tu as gagné!' : res === 'l' ? 'Tu as perdu...' : 'Ex-aequo';
    var dur = Math.round((Date.now() - startTime) / 1000);
    var r = loadStats()[S.level] || { w: 0, d: 0, l: 0 };
    var nMoves = history.length;
    showOverlay(
      '<h2>' + title + '</h2>' +
      (sub ? '<p class="sub-title">' + sub + '</p>' : '') +
      '<div class="big" aria-label="Score : toi ' + a + ', ordinateur ' + b + '">' + a + ' - ' + b + '</div>' +
      (gaveUp ? '' : '<p>Plus personne ne peut progresser : la partie est terminée.</p>') +
      '<div class="sum">' +
      '<span>Coups joués</span><b>' + nMoves + '</b>' +
      '<span>Durée</span><b>' + Math.floor(dur / 60) + ' min ' + (dur % 60) + ' s</b>' +
      '<span>Indices / annulations</span><b>' + hints + ' / ' + undos + '</b>' +
      '<span>Bilan au niveau ' + S.level + '</span><b>' + r.w + ' V - ' + r.d + ' N - ' + r.l + ' D</b>' +
      '</div>' +
      '<div class="btns"><button class="btn primary" id="ovAgain">Rejouer</button><button class="btn" id="ovLook">Voir le plateau</button>' +
      (gaveUp ? '' : '<button class="btn" id="ovUndo">Annuler le dernier coup</button>') + '</div>');
    bindOverlay({ ovAgain: newGame, ovLook: function () { hideOverlay(); canvas.focus(); }, ovUndo: undo });
  }

  // ---------- Side panel ----------

  function refresh() {
    if (!game) return;
    var st = $('status'), sub = $('substatus');
    st.className = 'status';
    if (!started) { st.textContent = 'Prêt à jouer'; sub.textContent = ''; }
    else if (ended) {
      var a = game.score[1], b = game.score[2];
      st.textContent = gaveUp ? 'Partie abandonnée' : a > b ? 'Bravo, tu as gagné!' : a < b ? 'Dommage, tu as perdu...' : 'Ex-aequo';
      st.className = 'status ' + (!gaveUp && a > b ? 'good' : !gaveUp && a === b ? '' : 'bad');
      sub.textContent = 'Nouvelle partie pour rejouer.';
    } else if (thinking) { st.textContent = "L'ordinateur réfléchit..."; sub.textContent = 'Tu peux annuler ton coup en attendant.'; }
    else if (hintBusy) { st.textContent = 'À toi de jouer'; sub.textContent = "Je cherche un indice..."; }
    else {
      st.textContent = 'À toi de jouer';
      var c = showCursor ? cursor : sel >= 0 ? sel : hover;
      sub.textContent = sel >= 0 ? 'Case ' + name(sel) + ' : touche-la encore pour confirmer.' :
        c >= 0 ? 'Case ' + name(c) : (history.length ? 'Dernier coup : ' + name(lastMove) : 'Pose ta première bille.');
    }
    $('score1').textContent = game.score[1]; $('score2').textContent = game.score[2];
    $('sc1').classList.toggle('turn', started && !ended && turn === 1);
    $('sc2').classList.toggle('turn', started && !ended && turn === 2);
    $('undo').disabled = !started || playerMoves() === 0 || gaveUp;
    $('hint').disabled = !started || ended || thinking || turn !== 1 || hintBusy;
    $('giveup').disabled = !started || ended || playerMoves() === 0;
    $('infoSize').textContent = N + '-' + N + (+S.size !== N ? ' (puis ' + S.size + '-' + S.size + ')' : '');
    $('infoLevel').textContent = String(S.level);
    var r = loadStats()[S.level] || { w: 0, d: 0, l: 0 };
    $('infoRecord').textContent = r.w + ' V - ' + r.d + ' N - ' + r.l + ' D';
    renderHistory();
  }

  var historyShown = -1;
  function renderHistory() {
    if (historyShown === history.length) return;
    historyShown = history.length;
    var ol = $('history');
    ol.innerHTML = '';
    $('historyEmpty').hidden = history.length > 0;
    history.forEach(function (h, i) {
      var li = document.createElement('li');
      li.className = 'p' + h.p + (i === history.length - 1 ? ' last' : '');
      li.tabIndex = 0;
      li.innerHTML = '<span class="num">' + (i + 1) + '.</span><span>' + (h.p === 1 ? 'Toi' : 'Ordi') + ' ' + name(h.c) + '</span><span class="pts">' + (h.pts ? '+' + h.pts : '') + '</span>';
      li.title = 'Montrer la case ' + name(h.c);
      var show = function () { flashCell = h.c; flashUntil = performance.now() + 1600; };
      li.addEventListener('click', show);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
      ol.appendChild(li);
    });
    ol.scrollTop = ol.scrollHeight;
  }

  // ---------- Input ----------

  function cellAt(e) {
    var p = Lehcim.canvasPos(canvas, e);
    var x = p.x / scale, y = p.y / scale;
    var i = Math.floor((x - ox) / cs), j = Math.floor((y - oy) / cs);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (!game || !started) return;
    var c = cellAt(e);
    if (ended) return;
    if (thinking) { if (c >= 0) patience(); return; }
    if (c < 0 || turn !== 1 || game.board[c]) { sel = -1; refresh(); return; }
    showCursor = false;
    if (confirmMode(e.pointerType)) {
      if (sel !== c) { sel = c; cursor = c; refresh(); return; }
    }
    hover = e.pointerType === 'mouse' ? c : -1;
    humanPlay(c);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var c = cellAt(e);
    if (c !== hover) { hover = c; showCursor = false; refresh(); }
  });
  canvas.addEventListener('pointerleave', function () { hover = -1; refresh(); });

  document.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    var onBoard = t === canvas || t === document.body;
    var k = e.key;
    if (!overlay.hidden && (k === 'Enter' || k === ' ') && tag === 'BUTTON') return;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (!onBoard || !game || !overlay.hidden) return;
      e.preventDefault();
      if (!showCursor) { showCursor = true; if (cursor < 0) cursor = lastMove >= 0 ? lastMove : (N >> 1) * N + (N >> 1); }
      else {
        var x = cursor % N, y = Math.floor(cursor / N);
        if (k === 'ArrowLeft') x = (x + N - 1) % N;
        if (k === 'ArrowRight') x = (x + 1) % N;
        if (k === 'ArrowUp') y = (y + N - 1) % N;
        if (k === 'ArrowDown') y = (y + 1) % N;
        cursor = y * N + x;
      }
      hover = -1; refresh();
    } else if ((k === 'Enter' || k === ' ') && onBoard) {
      e.preventDefault();
      if (!overlay.hidden) { var b = overlay.querySelector('.btn.primary'); if (b) b.click(); return; }
      if (!showCursor) { showCursor = true; refresh(); return; }
      if (game && !game.board[cursor]) humanPlay(cursor);
    } else if (k === 'u' || k === 'U' || k === 'Backspace') {
      if (k === 'Backspace' && !onBoard) return;
      e.preventDefault(); undo();
    } else if (k === 'i' || k === 'I') { hint(); }
    else if (k === 'm' || k === 'M') { toggleThreats(); }
    else if (k === 'n' || k === 'N') { askNewGame(); }
  });

  function toggleThreats() {
    S.threats = S.threats ? 0 : 1; saveSettings(); syncSettings();
    toast(S.threats ? 'Menaces affichées' : 'Menaces cachées', 1400);
  }

  // ---------- Buttons / settings ----------

  $('new').addEventListener('click', askNewGame);
  $('undo').addEventListener('click', undo);
  $('hint').addEventListener('click', hint);
  $('giveup').addEventListener('click', giveUp);
  $('threatsQuick').addEventListener('change', function () { S.threats = this.checked ? (S.threats || 1) : 0; saveSettings(); syncSettings(); });
  function openSettings() { syncSettings(); $('settings').showModal(); }
  $('settingsBtn').addEventListener('click', openSettings);

  function syncSettings() {
    document.querySelectorAll('[data-setting]').forEach(function (seg) {
      var key = seg.getAttribute('data-setting');
      seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(String(S[key]) === b.getAttribute('data-v'))); });
    });
    $('threatsQuick').checked = !!+S.threats;
    $('levelHint').textContent = LEVEL_TEXT[S.level];
    refresh();
  }
  document.querySelectorAll('[data-setting]').forEach(function (seg) {
    var key = seg.getAttribute('data-setting');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var v = b.getAttribute('data-v');
      S[key] = /^\d+$/.test(v) ? +v : v;
      saveSettings(); syncSettings();
      if (key === 'size' || key === 'first') {
        if (!started) { N = +S.size; game = new E.Game(N); layoutBoard(); refresh(); }
        else if (!ended && playerMoves() === 0) newGame();
        else if (key === 'size' && +S.size !== N) toast('Le plateau ' + S.size + '-' + S.size + ' sera utilisé à la prochaine partie');
        else if (key === 'first') toast('Appliqué à la prochaine partie');
      }
      if (key === 'level' && started && !ended) toast('Niveau ' + S.level + (thinking ? ' (à partir du prochain coup)' : ''));
    });
  });

  // ---------- Drawing ----------

  function blitS(r, x, y, w, h) { g2.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, w || r[2], h || r[3]); }
  function cx(c) { return ox + (c % N) * cs; }
  function cy(c) { return oy + Math.floor(c / N) * cs; }

  function ring(c, color, width, inset) {
    g2.strokeStyle = color; g2.lineWidth = width;
    g2.beginPath(); g2.arc(cx(c) + cs / 2, cy(c) + cs / 2, cs / 2 - (inset || 1.5), 0, Math.PI * 2); g2.stroke();
  }

  // Red line through the 5 cells of window w: horizontal / vertical from the outer
  // edge of the first cell to the outer edge of the last one through the centres,
  // diagonal from corner to corner (like ../game.js).
  function drawLine(w) {
    var a = game.wCells[w * 5], b = game.wCells[w * 5 + 4], d = game.wDir[w];
    var ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b), lw = cs * 3 / 20;
    g2.fillStyle = g2.strokeStyle = '#ff0000';
    if (d === 0) { g2.fillRect(ax, ay + (cs - lw) / 2, bx - ax + cs, lw); return; }
    if (d === 1) { g2.fillRect(ax + (cs - lw) / 2, ay, lw, by - ay + cs); return; }
    g2.lineWidth = cs * 2.2 / 20; g2.lineCap = 'butt';
    g2.beginPath();
    if (d === 2) { g2.moveTo(ax, ay); g2.lineTo(bx + cs, by + cs); }   // "\"
    else { g2.moveTo(ax + cs, ay); g2.lineTo(bx, by + cs); }            // "/"
    g2.stroke();
  }

  function draw(now) {
    g2.setTransform(scale, 0, 0, scale, 0, 0);
    g2.imageSmoothingEnabled = false;
    g2.drawImage(sheet, 0, 0, LW, 320, 0, 0, LW, 320);
    var w = N * cs, i, j, c, x, y;
    g2.fillStyle = 'rgba(40,20,20,0.55)'; g2.fillRect(ox - 3, oy - 3, w + 6, w + 6);
    g2.fillStyle = '#6e3845'; g2.fillRect(ox - 1, oy - 1, w + 2, w + 2);
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      c = j * N + i; x = ox + i * cs; y = oy + j * cs;
      blitS(SPR.tile(i, j), x, y, cs, cs);
      var v = game.board[c];
      if (v) {
        var t0 = drops[c], k = 1;
        if (t0 && !reduced) {
          var t = (now - t0) / 170;
          if (t < 1) { k = 0.4 + 0.6 * (1 - Math.pow(1 - t, 3)) + 0.08 * Math.sin(t * Math.PI); }
          else delete drops[c];
        }
        var s = cs * k, d = (cs - s) / 2;
        blitS(SPR.marble[v], x + d, y + d, s, s);
      }
    }
    g2.imageSmoothingEnabled = true;
    // scored lines: one continuous pure red line, as in the original (3 px for
    // 20 px cells, scaled with the cells); new ones blink
    for (var m = 0; m < game.lines.length; m++) {
      var wi = game.lines[m].w, alpha = 1;
      for (var f = 0; f < lineFlash.length; f++) if (lineFlash[f].w === wi) {
        var lt = now - lineFlash[f].t;
        if (lt < 900 && !reduced) alpha = 0.35 + 0.65 * Math.abs(Math.cos(lt / 900 * Math.PI * 3));
      }
      g2.globalAlpha = alpha;
      drawLine(wi);
      g2.globalAlpha = 1;
    }
    var playing = started && !ended;
    // threats: rings where a point is one move away
    if (playing && +S.threats) {
      var pulse = reduced ? 1 : 0.65 + 0.35 * Math.sin(now / 220);
      if (+S.threats === 2) {
        [[1, 'rgba(60,200,90,0.9)'], [2, 'rgba(255,70,60,0.9)']].forEach(function (pc) {
          game.threeCellsOf(pc[0]).forEach(function (c3) {
            if (game.fourCnt[pc[0]][c3]) return;
            g2.fillStyle = pc[1];
            g2.beginPath(); g2.arc(cx(c3) + cs / 2, cy(c3) + cs / 2, Math.max(2, cs * 0.1), 0, Math.PI * 2); g2.fill();
          });
        });
      }
      g2.globalAlpha = pulse;
      game.fourCellsOf(1).forEach(function (c4) { ring(c4, '#34d058', Math.max(2, cs * 0.1)); });
      game.fourCellsOf(2).forEach(function (c4) { ring(c4, '#ff4436', Math.max(2, cs * 0.1), cs * 0.12); });
      g2.globalAlpha = 1;
    }
    // last move
    if (lastMove >= 0 && game.board[lastMove]) {
      g2.strokeStyle = game.board[lastMove] === 2 ? 'rgba(255,236,150,0.95)' : 'rgba(255,255,255,0.8)';
      g2.lineWidth = Math.max(1.5, cs * 0.07);
      g2.strokeRect(cx(lastMove) + 1, cy(lastMove) + 1, cs - 2, cs - 2);
    }
    // history flash
    if (flashCell >= 0 && now < flashUntil) {
      g2.strokeStyle = 'rgba(80,170,255,' + (reduced ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(now / 150))) + ')';
      g2.lineWidth = Math.max(2, cs * 0.12);
      g2.strokeRect(cx(flashCell) + 1, cy(flashCell) + 1, cs - 2, cs - 2);
    }
    if (playing && turn === 1 && !thinking) {
      // hint
      if (hintCell >= 0 && now < hintUntil && !game.board[hintCell]) {
        g2.globalAlpha = reduced ? 0.7 : 0.45 + 0.35 * Math.abs(Math.sin(now / 300));
        g2.imageSmoothingEnabled = false; blitS(SPR.marble[1], cx(hintCell), cy(hintCell), cs, cs); g2.imageSmoothingEnabled = true;
        g2.globalAlpha = 1;
        ring(hintCell, '#5ac8fa', Math.max(2, cs * 0.1));
      }
      // preview: confirm selection, keyboard cursor or mouse hover
      var pv = sel >= 0 ? sel : showCursor ? cursor : hover;
      if (pv >= 0 && !game.board[pv]) {
        g2.globalAlpha = sel >= 0 ? 0.8 : 0.5;
        g2.imageSmoothingEnabled = false; blitS(SPR.marble[1], cx(pv), cy(pv), cs, cs); g2.imageSmoothingEnabled = true;
        g2.globalAlpha = 1;
      }
    }
    if (showCursor && cursor >= 0 && started && !ended) {
      g2.strokeStyle = '#ffffff'; g2.lineWidth = Math.max(2, cs * 0.09);
      g2.setLineDash([cs * 0.25, cs * 0.15]);
      g2.strokeRect(cx(cursor) + 1.5, cy(cursor) + 1.5, cs - 3, cs - 3);
      g2.setLineDash([]);
    }
    if (sel >= 0) {
      g2.strokeStyle = '#fff'; g2.lineWidth = Math.max(2, cs * 0.1);
      g2.strokeRect(cx(sel) + 1, cy(sel) + 1, cs - 2, cs - 2);
    }
    g2.imageSmoothingEnabled = false;
    if (full) {
      // the original panel: level digit, scores, whose turn, thinking pendulum
      blitS(SPR.digit(+S.level), POS.digit[0], POS.digit[1]);
      g2.font = 'bold 13px Arial, Helvetica, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillStyle = '#000';
      for (var p = 1; p <= 2; p++) g2.fillText(String(game.score[p]), POS.score[p][0], POS.score[p][1]);
      if (playing) blitS(SPR.marble[turn], POS.turn[turn][0], POS.turn[turn][1]);
      if (thinking) {
        // like the original: the whole "Patience ! / Je réfléchis ..." block while it thinks
        blitS(SPR.patience, POS.patience[0], POS.patience[1]);
        blitS(SPR.thinking, POS.thinking[0], POS.thinking[1]);
        blitS(SPR.pendulum(Math.floor((now - thinkStart) / 90) % 10), POS.pendulum[0], POS.pendulum[1]);
      }
      else if (now < patienceUntil) blitS(SPR.patience, POS.patience[0], POS.patience[1]);
    }
    if (bienStart >= 0) {
      var fr = Math.floor((now - bienStart) / 110);
      if (fr > 12) bienStart = -1;
      else if (full) blitS(SPR.bien(fr), POS.bien[0], POS.bien[1]);
      else blitS(SPR.bien(fr), (BOARD_AREA - 64) / 2, oy + N * cs / 2 - 20, 64, 40);
    }
    // mini pendulum in the status card
    pend.classList.toggle('on', thinking || hintBusy);
    if (thinking || hintBusy) {
      pg.clearRect(0, 0, 40, 40); pg.imageSmoothingEnabled = false;
      var pr = SPR.pendulum(Math.floor((now - thinkStart) / 90) % 10);
      pg.drawImage(sheet, pr[0], pr[1], 40, 40, 0, 0, 40, 40);
    }
  }

  function loop(now) { if (sheet && game) draw(now); requestAnimationFrame(loop); }

  // ---------- Fit the canvas to the stage (device-pixel crisp) ----------

  function fit() {
    var sw = stage.clientWidth;
    full = sw >= 520;
    LW = full ? 400 : BOARD_AREA;
    var narrow = window.innerWidth <= 900;
    var cssW = Math.min(sw, 820);
    if (!narrow) {
      var top = stage.getBoundingClientRect().top + window.scrollY;
      var maxH = Math.max(300, window.innerHeight - top - 24);
      cssW = Math.min(cssW, Math.floor(maxH * LW / 320));
    }
    var cssH = Math.round(cssW * 320 / LW);
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    scale = canvas.width / LW;
  }
  window.addEventListener('resize', fit);

  // ---------- Start ----------

  Lehcim.initPage();
  // the shared helper writes "🔊 Son" in the mute button: keep only the icon (the button has a label)
  document.querySelectorAll('[data-mute]').forEach(function (b) {
    var trim = function () { if (/ Son$/.test(b.textContent)) b.textContent = b.textContent.replace(' Son', ''); };
    trim();
    if (window.MutationObserver) new MutationObserver(trim).observe(b, { childList: true, characterData: true, subtree: true });
  });
  syncSettings();
  fit();
  var soundsLoaded = false;
  function loadSounds() {
    if (soundsLoaded) return;
    soundsLoaded = true;
    Lehcim.loadSounds({
      drop: '../assets/sounds/1.wav', point: '../assets/sounds/2.wav',
      cpu: '../assets/sounds/3.wav', end: '../assets/sounds/4.wav'
    });
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSounds, { once: true, capture: true }); });
  Lehcim.loadSheet('../assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    N = +S.size; game = new E.Game(N); layoutBoard();
    $('infoMode').textContent = AI.mode();
    refresh();
    showStart();
    requestAnimationFrame(loop);
  });

  // for tests
  window.Morpion = {
    state: function () { return { game: game, history: history, turn: turn, thinking: thinking, ended: ended, started: started, N: N, cs: cs, ox: ox, oy: oy, scale: scale, full: full, mode: AI.mode(), hintCell: hintCell }; },
    cellCenter: function (c) {
      var r = canvas.getBoundingClientRect(), k = r.width / LW;
      return { x: r.left + (cx(c) + cs / 2) * k, y: r.top + (cy(c) + cs / 2) * k };
    }
  };
})();
