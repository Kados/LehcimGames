/*
 * Awélé - browser port of Lehcim Noil's Windows 3.x game.
 * You play the 6 bottom pits against the computer (rules and computer player in engine.js).
 * Everything follows AWELE.EXE: drawing with the original image bank (assets/sheet.png:
 * background + board 640x400 on the left, tiles and sprites on the right), seeds laid out
 * like the original (layouts.js), a "hand" ring that carries the seeds pit by pit at
 * 8 pixels per 40 ms tick, the same sounds at the same moments, the same menus and messages,
 * and the AwParties.txt game log.
 */
(function () {
  'use strict';

  var E = window.AweleEngine, LAY = window.AweleLayouts;
  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Sheet layout (AWELE.EXE coordinates) ----------

  var KEY = [250, 250, 250];
  var SPR = {
    pit: [640, 0, 64, 64], store: [640, 64, 64, 128],
    red: [640, 192, 16, 16], green: [656, 192, 16, 16],
    holes: [640, 208, 64, 20],
    lit: [640, 228, 20, 8], unlit: [640, 236, 20, 8],
    cursor: [640, 244, 16, 20],
    ring: function (k) { return [704, k * 64, 64, 64]; },       // 0 = full ring ... 5 = faintest
    storeLit: function (k) { return [768, k * 128, 64, 128]; }
  };
  function pitXY(i) { return i < 6 ? { x: 128 + 64 * i, y: 134 } : { x: 128 + 64 * (11 - i), y: 70 }; }
  var STORE_XY = [{ x: 512, y: 70 }, { x: 64, y: 70 }];   // [player (right), computer (left)]
  var IND_XY = [{ x: 572, y: 50 }, { x: 48, y: 50 }];     // "Joueur" / "Ordi." lights
  var TICK = 40;                                           // the original timer (ms)

  // ---------- Settings (the original keeps them in Awele.tut) ----------

  var settings = { mode: 1, level: 3, starter: 0 };        // as in the Awele.tut shipped with the game
  try {
    var saved = JSON.parse(localStorage.getItem('lehcim.awele.settings2'));
    if (saved) for (var k in settings) if (saved[k] != null) settings[k] = +saved[k];
  } catch (e) { /* ignore */ }
  function saveSettings() {
    try { localStorage.setItem('lehcim.awele.settings2', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------- Sounds (WAVE_1..7 of the original) ----------
  // 1 seeds picked up, 2 end of the sowing, 3 seed dropped, 4 store lighting up after a capture,
  // 5 end of the game, 6 menu click / new game, 7 pit captured.
  var soundsLoaded = false;
  function sfx(n) { if (soundsLoaded) Lehcim.play('w' + n); }
  function loadSounds() {
    if (soundsLoaded) return; soundsLoaded = true;
    var m = {}; for (var i = 1; i <= 7; i++) m['w' + i] = 'assets/sounds/' + i + '.wav';
    Lehcim.loadSounds(m);
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSounds, { once: true }); });

  // ---------- Game state ----------

  var game = null;          // null = no game (board empty, as after "Abandonner" or the end message)
  var anim = null;          // move being animated (timer running)
  var hist = [];            // tournament: boards with fewer than 7 seeds already seen
  var sessionGames = [];    // games of this session, for the AwParties.txt log
  var mouse = null;         // mouse position on the canvas (the game draws its own cursor)

  // What is drawn: pits and stores are only redrawn at the moments the original redraws them.
  var view = { b: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0], ind: [0, 0] };

  function inGame() { return !!game; }
  function updateMenus() {
    ['new', 'modeBtn', 'levelBtn', 'starterBtn'].forEach(function (id) { $(id).disabled = inGame(); });
    $('abandon').disabled = !inGame();
  }

  function newGame() {
    if (inGame()) return;
    sfx(6);
    game = { st: E.newState(settings.starter), mode: settings.mode, level: settings.level, moves: [], wait: false };
    hist = [];
    sessionGames.push(game.moves);
    game.moves.header = { mode: game.mode, level: game.level };
    view = { b: game.st.b.slice(), s: [0, 0], ind: [0, 0] };   // both lights off at the start
    updateMenus();
    if (game.st.turn === 1) computerTurn();
  }

  function reset() {
    game = null; anim = null;
    view = { b: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0], ind: [0, 0] };
    updateMenus();
  }

  function abandon() {
    if (!game || anim) return;       // ignored while seeds are moving
    sfx(6);
    reset();
  }

  function computerTurn() {
    game.wait = true;
    // the original thinks first, then lights "Ordi." and plays
    setTimeout(function () {
      if (!game) return;
      var m = E.bestMove(game.st, game.level, game.mode);
      if (m < 0) return;
      view.ind = [0, 1];
      startMove(m);
    }, 30);
  }

  function playerClick(i) {
    if (!game || anim || game.wait || game.st.turn !== 0) return;
    if (!game.st.b[i]) return;
    if (E.legalMoves(game.st, game.mode).indexOf(i) < 0) return;   // must feed the computer
    view.ind = [1, 0];
    startMove(i);
  }

  // Starts the animation of a move: seeds picked up, then carried pit by pit.
  function startMove(pit) {
    var st = game.st, side = st.turn, r = E.doMove(st, pit, game.mode);
    var p = pitXY(pit);
    anim = {
      side: side, origin: pit, idx: pit, seeds: st.b[pit], r: r,
      x: p.x, y: p.y, phase: 'pick', k: 0, captured: false, end: null
    };
    st.b[pit] = 0;              // the counters show it at once, the pit is redrawn by the ring
    game.wait = true;
  }

  // One 40 ms tick of the original timer.
  function tick() {
    var a = anim, st = game.st, b = st.b;
    if (a.phase === 'pick') {                       // ring appearing over the pit (5 frames)
      a.k++;
      if (a.k === 5) { a.k = 0; a.phase = 'sow'; sfx(1); }
      return;
    }
    if (a.phase === 'sow') {
      if (aligned(a)) {
        if (a.idx === a.origin) view.b[a.idx] = b[a.idx];
        else { b[a.idx]++; a.seeds--; view.b[a.idx] = b[a.idx]; sfx(3); }
        a.idx = (a.idx + 1) % 12;
      }
      if (a.seeds > 0) step(a);
      else {
        a.idx = (a.idx + 11) % 12;
        if (!capturable(a)) a.phase = 'end';
        else a.phase = 'capture';
      }
      return;
    }
    if (a.phase === 'capture') {
      if (aligned(a)) {
        sfx(7);
        var n = b[a.idx], keep = (!game.mode && E.sideSum(b, 1 - a.side) - n === 0) ? 1 : 0;
        st.s[a.side] += n - keep; b[a.idx] = keep; view.b[a.idx] = keep;
        a.idx = (a.idx + 11) % 12;
      }
      var limit = a.side === 0 ? 448 : 128;
      if (capturable(a) && a.x !== limit) a.x += a.side === 0 ? 8 : -8;
      else { a.phase = 'end'; a.captured = true; }
      return;
    }
    if (a.phase === 'end') {                        // ring fading out (6 frames), store lighting up
      if (a.k === 0) {
        sfx(2);
        if (game.mode) {
          st.turn = a.side;
          a.end = E.afterMove(st, game.mode, hist);
          if (a.end.gather.length) {
            a.captured = true;
            game.st.b = a.end.st.b.slice(); game.st.s = a.end.st.s.slice();
            for (var i = 0; i < 12; i++) view.b[i] = game.st.b[i];
          }
        }
      }
      if (a.captured && a.k === 5) sfx(4);
      a.k++;
      if (a.k === 5) view.s[a.side] = game.st.s[a.side];
      if (a.k === 6) { anim = null; moveDone(a); }
    }
  }
  function aligned(a) { return (a.x - 64) % 64 === 0 && (a.y === 70 || a.y === 134); }
  function capturable(a) {
    var n = game.st.b[a.idx];
    return (n === 2 || n === 3) && (a.side === 0 ? a.y === 70 : a.y === 134);
  }
  // The ring goes right on the bottom row, up on the right, left on the top row, down on the left.
  function step(a) {
    if (a.y === 134) { if (a.x !== 448) a.x += 8; else a.y -= 8; }
    else if (a.y !== 70) { if (a.x === 448) a.y -= 8; else a.y += 8; }
    else { if (a.x !== 128) a.x -= 8; else a.y += 8; }
  }

  // After the animation: log, end of the game, next turn.
  function moveDone(a) {
    game.moves.push(E.LETTERS[a.origin]);
    var st = game.st;
    st.turn = a.side;
    var end = a.end || E.afterMove(st, game.mode, hist);
    game.st = end.st;
    view.b = game.st.b.slice();
    if (end.over) { finish(end); return; }
    if (game.st.turn === 1) {
      computerTurn();             // "Ordi." lights up when it starts playing
    } else {
      view.ind = [1, 0];
      game.wait = false;
    }
  }

  function finish(end) {
    game.wait = true;
    sfx(5);
    var caption = ['Tu as gagné!', 'Tu as perdu...', 'Ex-aequo'][end.result === -1 ? 2 : end.result];
    var text = end.repeated ? 'Position déjà jouée' : ['Bravo', 'Dommage', 'Peut mieux faire'][end.result === -1 ? 2 : end.result];
    msgBox(caption, text).then(reset);
  }

  // Windows-like message box: caption in the title bar, text, OK.
  function msgBox(caption, text) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      var h = document.createElement('h2'); h.textContent = caption; d.appendChild(h);
      var p = document.createElement('p'); p.textContent = text; d.appendChild(p);
      var row = document.createElement('div'); row.className = 'row';
      var ok = document.createElement('button'); ok.textContent = 'OK'; row.appendChild(ok);
      d.appendChild(row); document.body.appendChild(d);
      function done() { d.close(); d.remove(); resolve(); }
      ok.addEventListener('click', done);
      d.addEventListener('cancel', function (e) { e.preventDefault(); done(); });
      d.showModal(); ok.focus();
    });
  }

  // ---------- Game log (AwParties.txt) ----------

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
  var logUrl = null;
  function showLog() {
    var t = logText();
    $('logText').textContent = t;
    var bytes = new Uint8Array(t.length);   // Windows-1252 like the original file
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); bytes[i] = c < 256 ? c : 63; }
    if (logUrl) URL.revokeObjectURL(logUrl);
    logUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
    $('log').showModal();
  }

  // ---------- Drawing ----------

  var sheet = null, keyed = null;
  function blit(src, r, x, y) { g.drawImage(src, r[0], r[1], r[2], r[3], x, y, r[2], r[3]); }

  function drawPit(i, n) {
    var p = pitXY(i);
    blit(sheet, SPR.pit, p.x, p.y);
    var hy = i < 6 ? p.y + 64 : p.y - 20;
    blit(sheet, SPR.holes, p.x, hy);
    if (!n) return;
    var reds = Math.floor((n - 1) / 11), l = LAY.PIT[(n - 1) % 11 + 1], k;
    for (k = 0; k < reds; k++) blit(keyed, SPR.red, p.x + 10 + 14 * k, hy + 2);
    for (k = 0; k < l.length; k += 2) blit(keyed, SPR.green, p.x + l[k], p.y + l[k + 1]);
  }
  function drawStore(s, n) {
    var q = STORE_XY[s], l = LAY.STORE[Math.min(n, 48)];
    blit(sheet, SPR.store, q.x, q.y);
    for (var k = 0; k < l.length; k += 2) blit(keyed, SPR.green, q.x + l[k], q.y + l[k + 1]);
  }
  function text(str, x, y, color) {
    g.fillStyle = color; g.fillText(str, x, y);
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!sheet) return;
    var now = performance.now();
    if (anim) {
      if (!anim.t) anim.t = now;
      var guard = 0;
      while (anim && now - anim.t >= TICK && guard++ < 50) { anim.t += TICK; tick(); }
    }

    blit(sheet, [0, 0, 640, 400], 0, 0);
    for (var i = 0; i < 12; i++) drawPit(i, view.b[i]);
    drawStore(0, view.s[0]); drawStore(1, view.s[1]);
    blit(sheet, view.ind[0] ? SPR.lit : SPR.unlit, IND_XY[0].x, IND_XY[0].y);
    blit(sheet, view.ind[1] ? SPR.lit : SPR.unlit, IND_XY[1].x, IND_XY[1].y);

    var a = anim;
    if (a) {
      var fr = a.phase === 'pick' ? 5 - a.k : (a.phase === 'end' ? Math.min(a.k, 5) : 0);
      if (a.phase === 'end' && a.captured && a.k <= 5) blit(keyed, SPR.storeLit(a.k % 3), STORE_XY[a.side].x, STORE_XY[a.side].y);
      blit(keyed, SPR.ring(fr), a.x, a.y);
    }

    if (game) {
      var st = game.st;
      // texts drawn by the original (TextOut, system font, dark red / black)
      g.font = '13.5px Arial, Helvetica, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
      text(game.mode ? 'Mode Tournoi' : 'Règles usuelles', 130, 12, '#930103');
      text('Niveau', 291, 13, '#020000');
      g.font = 'bold 14px Arial, Helvetica, sans-serif';
      text(String(game.level), 341, 11, '#020000');
      for (var j = 0; j < 12; j++) {
        var v = st.b[j], dx = v < 10 ? 4 : 0;
        text(String(v), (j < 6 ? (j + 1) * 64 + 88 : (12 - j) * 64 + 88) + dx - 1, j < 6 ? 325 : 289, '#000');
      }
      text(String(st.s[0]), 531 + (st.s[0] < 10 ? 4 : 0), 307, '#000');
      text(String(st.s[1]), 91 + (st.s[1] < 10 ? 4 : 0), 307, '#000');
      if (mouse && mouse.x < 624 && mouse.y < 380) blit(keyed, SPR.cursor, Math.round(mouse.x), Math.round(mouse.y));
    }
  }

  // ---------- Input ----------

  function setMouse(e) {
    if (e.pointerType !== 'mouse') { mouse = null; canvas.style.cursor = ''; return; }
    var pos = Lehcim.canvasPos(canvas, e);
    mouse = pos;
    canvas.style.cursor = (game && pos.x < 624 && pos.y < 380) ? 'none' : '';
  }
  canvas.addEventListener('pointermove', setMouse);
  canvas.addEventListener('pointerleave', function () { mouse = null; });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault(); setMouse(e);
    var pos = Lehcim.canvasPos(canvas, e);
    // the original click zone: inside the row of the player's pits
    if (pos.x > 128 && pos.x < 512 && pos.y > 134 && pos.y < 198) playerClick(Math.floor((pos.x - 64) / 64) - 1);
  });

  // Dialogs with radio buttons (Niveau, Qui Commence?, Mode), like the original ones.
  function radioDialog(id, value, apply) {
    var d = $(id);
    d.querySelectorAll('input[type=radio]').forEach(function (r) {
      r.checked = +r.value === value;
      r.onclick = function () { sfx(6); };
    });
    d.querySelector('.ok').onclick = function () {
      var c = d.querySelector('input[type=radio]:checked');
      if (c) apply(+c.value);
      saveSettings(); d.close();
    };
    d.showModal();
  }
  function btn(id, f) { $(id).addEventListener('click', function () { this.blur(); f(); }); }
  btn('new', newGame);
  btn('abandon', abandon);
  btn('levelBtn', function () { if (!inGame()) radioDialog('levelDlg', settings.level, function (v) { settings.level = v; }); });
  btn('starterBtn', function () { if (!inGame()) radioDialog('starterDlg', settings.starter, function (v) { settings.starter = v; }); });
  btn('modeBtn', function () { if (!inGame()) radioDialog('modeDlg', settings.mode, function (v) { settings.mode = v; }); });
  btn('games', showLog);
  $('logDownload').addEventListener('click', function () {
    if (!logUrl) return;
    var a = document.createElement('a'); a.href = logUrl; a.download = 'AwParties.txt';
    document.body.appendChild(a); a.click(); a.remove();
  });

  // ---------- Start ----------

  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  updateMenus();
  Promise.all([Lehcim.loadSheet('assets/sheet.png', null), Lehcim.loadSheet('assets/sheet.png', KEY)])
    .then(function (s) { sheet = s[0]; keyed = s[1]; });
  requestAnimationFrame(draw);

  // test hook (used by the automated checks only)
  window.__awele = {
    get game() { return game; }, get anim() { return anim; }, get view() { return view; },
    newGame: newGame, click: playerClick, logText: logText, settings: settings,
    setPosition: function (b, st) { game.st.b = b.slice(); game.st.s = st.slice(); view.b = b.slice(); view.s = st.slice(); }
  };
})();
