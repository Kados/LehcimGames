/*
 * Awélé - browser port of Lehcim Noil's Windows 3.x game (2006).
 * You play the 6 bottom pits against the computer (rules in engine.js).
 * Drawing uses the original sheet (assets/sheet.png): background + board on the
 * left (640x400), pit/store tiles, highlight frames, balls and indicators on the right.
 * Seeds are not in the sheet: they are drawn as small yellow seeds like the one in
 * the original highlight sprite.
 */
(function () {
  'use strict';

  var E = window.AweleEngine;
  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var selMode = document.getElementById('mode'), selLevel = document.getElementById('level'),
      selStarter = document.getElementById('starter');

  // ---------- Sheet layout (measured on sheet.png) ----------

  var PIT = 64, KEY = [250, 250, 250];
  var SPR = {
    pit: [640, 0, 64, 64],           // empty pit tile
    store: [640, 64, 64, 128],       // empty store tile
    red: [642, 194, 12, 12],         // red ball
    green: [656, 192, 16, 16],       // green ball
    yellow: [640, 228, 20, 8],       // lit turn indicator
    flash: function (k) { return [704, k * 64, 64, 64]; },       // 6 frames: yellow ring fading
    storeLit: function (k) { return [768, k * 128, 64, 128]; }  // 3 frames: store lighting up
  };
  // Pit i -> top-left corner of its 64x64 tile on the board.
  function pitXY(i) {
    return i < 6 ? { x: 128 + 64 * i, y: 134 } : { x: 128 + 64 * (11 - i), y: 70 };
  }
  var STORE_XY = [{ x: 512, y: 70 }, { x: 64, y: 70 }];  // [player (right), computer (left)]
  var TURN_XY = [{ x: 572, y: 50 }, { x: 48, y: 50 }];   // black boxes next to "Joueur" / "Ordi."
  // Three small holes above (computer) / below (player) each pit.
  function holeXY(i, k) {
    var p = pitXY(i);
    return { x: p.x + 18 + 14 * k, y: (i < 6 ? 198 : 50) + 10 };
  }
  // Counter boxes of the lower panel (16x18 each).
  function countBox(i) {
    return i < 6 ? { x: 152 + 64 * i, y: 323 } : { x: 152 + 64 * (11 - i), y: 287 };
  }
  var STORE_BOX = [{ x: 532, y: 305 }, { x: 92, y: 305 }];
  var INFO_BOX = { x: 289, y: 11, w: 60, h: 16 };

  // ---------- Settings (the original kept them in Awele.tut) ----------

  var settings = { tournament: 0, level: 3, starter: 0 };
  try {
    var saved = JSON.parse(localStorage.getItem('lehcim.awele.settings'));
    if (saved) for (var k in settings) if (saved[k] != null) settings[k] = +saved[k];
  } catch (e) { /* ignore */ }
  selMode.value = settings.tournament; selLevel.value = settings.level; selStarter.value = settings.starter;
  function saveSettings() {
    try { localStorage.setItem('lehcim.awele.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ---------- Game state ----------

  var game = null;       // {st, tournament, level, moves, over, seen, token, entry}
  var disp = null;       // what is drawn: {b, s} updated seed by seed during animations
  var busy = true;       // animation or computer thinking: clicks ignored
  var hover = -1;
  var flashAt = {};      // pit -> time of the last seed drop (highlight frames)
  var storeAt = [0, 0];  // store -> time of the last capture
  var lastPlayed = [-1, -1], capMarks = [];
  var sessionGames = []; // games of this session, for the AwParties.txt log

  var soundsLoaded = false;
  function sfx(name, vol) { if (soundsLoaded) Lehcim.play(name, vol); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function setStatus(t) { statusEl.textContent = t; }

  function newGame() {
    var token = {};
    game = {
      st: E.newState(), tournament: !!settings.tournament, level: settings.level,
      moves: [], over: false, seen: {}, token: token
    };
    game.st.turn = settings.starter;
    game.entry = { tournament: game.tournament, level: game.level, moves: game.moves };
    sessionGames.push(game.entry);
    disp = { b: game.st.b.slice(), s: game.st.s.slice() };
    flashAt = {}; storeAt = [0, 0]; lastPlayed = [-1, -1]; capMarks = [];
    sfx('start');
    nextTurn(token);
  }

  function alive(token) { return game && game.token === token && !game.over; }

  // Starts the turn of the side to move (or ends the game).
  function nextTurn(token) {
    if (!alive(token)) return;
    var st = game.st;
    var end = E.checkEnd(st, game.tournament, game.seen);
    if (end) { finish(end, token); return; }
    game.seen[E.key(st)] = true;
    var moves = E.legalMoves(st);
    if (!moves.length) {
      // usual rules: a player without seeds passes his turn
      busy = true;
      setStatus(st.turn === 0 ? 'Tu ne peux pas jouer : tu passes ton tour.' : "L'ordinateur ne peut pas jouer : il passe son tour.");
      sfx('pass');
      sleep(1400).then(function () {
        if (!alive(token)) return;
        game.st = E.clone(st); game.st.turn = 1 - st.turn;
        nextTurn(token);
      });
      return;
    }
    if (st.turn === 1) {
      busy = true;
      setStatus("L'ordinateur réfléchit...");
      sleep(450).then(function () {
        if (!alive(token)) return;
        var m = E.bestMove(game.st, game.level, game.tournament, 900);
        playMove(m, token);
      });
    } else {
      busy = false;
      var mustFeed = E.sideSum(st.b, 1) === 0;
      setStatus(mustFeed ? "A toi : tu dois nourrir l'ordinateur." : 'A toi de jouer.');
    }
  }

  // Animates a move seed by seed, then the captures, then hands over.
  function playMove(pit, token) {
    busy = true; hover = -1;
    var st = game.st, p = st.turn, r = E.doMove(st, pit, game.tournament);
    var letter = E.LETTERS[pit];
    game.moves.push(letter);
    lastPlayed[p] = pit; capMarks = [];
    setStatus(p === 1 ? "L'ordinateur joue la case " + letter + '.' : 'Tu joues la case ' + letter + '.');
    var delay = r.path.length > 12 ? 110 : 170;
    var seq = Promise.resolve().then(function () {
      sfx('take');
      disp.b[pit] = 0;
      return sleep(delay + 60);
    });
    r.path.forEach(function (j) {
      seq = seq.then(function () {
        if (!alive(token)) return;
        disp.b[j]++; flashAt[j] = performance.now();
        sfx('seed', 0.8);
        return sleep(delay);
      });
    });
    seq = seq.then(function () { return sleep(r.caps.length ? 280 : 120); });
    r.caps.forEach(function (c, n) {
      seq = seq.then(function () {
        if (!alive(token)) return;
        var keep = (c.pit === r.leftOne) ? 1 : 0;   // usual rules: one seed left to the opponent
        disp.b[c.pit] = keep; disp.s[p] += c.n - keep;
        capMarks.push(c.pit); storeAt[p] = performance.now();
        sfx('capture');
        return sleep(380);
      });
    });
    seq.then(function () {
      if (!alive(token)) return;
      game.st = r.st;
      disp = { b: r.st.b.slice(), s: r.st.s.slice() };
      nextTurn(token);
    });
  }

  // End of game: tournament gathering animation, then the original messages.
  function finish(end, token) {
    busy = true; game.over = true;
    var seq = Promise.resolve();
    if (end.reason === 'repeat') {
      setStatus('Position déjà jouée');
      seq = seq.then(function () { sfx('pass'); return Lehcim.message('Position déjà jouée'); });
    }
    if (end.gather.length) {
      seq = seq.then(function () { return sleep(500); });
      end.gather.forEach(function (gt) {
        seq = seq.then(function () {
          if (game.token !== token) return;
          disp.b[gt.pit] = 0; disp.s[gt.to] += gt.n; storeAt[gt.to] = performance.now();
          sfx('seed');
          return sleep(220);
        });
      });
    }
    seq.then(function () {
      if (game.token !== token) return;
      game.st = end.st;
      disp = { b: end.st.b.slice(), s: end.st.s.slice() };
      var s = end.st.s, score = '\nJoueur ' + s[0] + ' - Ordi ' + s[1];
      var title, text;
      if (end.result === 0) { sfx('win'); title = 'Bravo'; text = 'Tu as gagné!'; }
      else if (end.result === 1) { sfx('lose'); title = 'Dommage'; text = 'Tu as perdu...'; }
      else { sfx('pass'); title = 'Peut mieux faire'; text = 'Ex-aequo'; }
      if (end.reason === 'small') text += '\nIl reste moins de 7 graines sur le jeu : la partie est nulle.';
      setStatus(title + ' - ' + text.split('\n')[0]);
      Lehcim.message(title + '\n' + text + score);
    });
  }

  function abandon() {
    if (!game || game.over) return;
    game.over = true; busy = true; game.token = {};
    sfx('lose');
    setStatus('Partie abandonnée - Tu as perdu...');
    disp = { b: game.st.b.slice(), s: game.st.s.slice() };
    Lehcim.message('Dommage\nTu as abandonné la partie.');
  }

  // ---------- Game log (AwParties.txt) ----------

  var NL = '\r\n';
  function logText() {
    var t = "---------Jeu d'AWELE----------------------> par Lehcim Noil " + NL + NL +
      'Enregistrement des parties jouées à la dernière session.' + NL +
      'Attention, elles seront effacées à la session suivante !' + NL + NL +
      'Chaque lettre correspond à une case selon la convention suivante:' + NL +
      "  Pour l'ordinateur: f e d c b a" + NL +
      '  Pour le joueur:    A B C D E F' + NL + NL;
    var n = 0;
    sessionGames.forEach(function (e) {
      if (!e.moves.length) return;   // games without any move are not listed
      n++;
      t += (n > 1 ? NL : '') + NL + 'Partie ' + n + '  - ' + (e.tournament ? 'Mode Tournoi' : 'Règles usuelles') +
        '  - Niveau ' + e.level + NL + e.moves.map(function (m) { return m + '.'; }).join('');
    });
    return t;
  }
  var logUrl = null;
  function showLog() {
    var t = logText();
    document.getElementById('logText').textContent = t;
    // Windows-1252 bytes like the original file (only Latin-1 characters are used).
    var bytes = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); bytes[i] = c < 256 ? c : 63; }
    if (logUrl) URL.revokeObjectURL(logUrl);
    logUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/plain' }));
    document.getElementById('log').showModal();
  }

  // ---------- Drawing ----------

  var sheet = null, keyed = null;

  function blit(src, r, x, y) { g.drawImage(src, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); }

  // One seed: yellow with a dark rim and a light spot (like the dot of the original sprite).
  function seed(x, y, r) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#ffff00'; g.fill();
    g.lineWidth = r > 3.5 ? 1.2 : 1; g.strokeStyle = '#3a2a00'; g.stroke();
    g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,230,0.9)'; g.fill();
  }

  // Seeds of a pit: sunflower pattern, so seeds keep their place when one is added.
  function drawPitSeeds(cx, cy, n) {
    var r = n <= 12 ? 4.5 : (n <= 22 ? 3.6 : 2.7), c = r * 1.22, ga = 2.39996;
    for (var i = 0; i < n; i++) {
      var rad = c * Math.sqrt(i + 0.5), a = i * ga;
      seed(cx + rad * Math.cos(a), cy + rad * Math.sin(a), r);
    }
  }
  // Seeds of a store: a pile filling the capsule-shaped store from the bottom.
  // Places are computed once for a given seed size (smaller seeds when it gets full).
  var storePlaces = {};
  function storeLayout(r) {
    if (storePlaces[r]) return storePlaces[r];
    var list = [], sp = r * 2.1, R = 23, top = 31, bottom = 97; // capsule: half circles centred at y 31 / 97
    for (var row = 0, y = 128 - 8 - r - 2; y > 8 + r; row++, y -= sp * 0.9) {
      var dy = y < top ? top - y : (y > bottom ? y - bottom : 0);
      var half = Math.sqrt(Math.max(0, R * R - dy * dy)) - r - 1;
      var k = Math.floor(2 * half / sp) + 1, x0 = 32 - (k - 1) * sp / 2 + (row % 2 ? 0.8 : -0.8);
      for (var c = 0; c < k; c++) list.push({ x: x0 + c * sp + ((list.length * 37) % 5 - 2) * 0.3, y: y + ((list.length * 53) % 5 - 2) * 0.3 });
    }
    return (storePlaces[r] = list);
  }
  function drawStoreSeeds(x, y, n) {
    var r = 4.3, pl = storeLayout(r);
    while (pl.length < n && r > 2) { r -= 0.3; pl = storeLayout(r); }
    for (var i = 0; i < n && i < pl.length; i++) seed(x + pl[i].x, y + pl[i].y, r);
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!sheet) return;
    var now = performance.now();
    blit(sheet, [0, 0, 640, 400], 0, 0);
    if (!disp) return;
    var legal = (!busy && game && !game.over && game.st.turn === 0) ? E.legalMoves(game.st) : [];

    // pits
    for (var i = 0; i < 12; i++) {
      var p = pitXY(i), age = now - (flashAt[i] || -1e9);
      if (age < 6 * 60) blit(keyed, SPR.flash(Math.floor(age / 60)), p.x, p.y);
      else if (i === hover && legal.indexOf(i) >= 0) blit(keyed, SPR.flash(0), p.x, p.y);
      drawPitSeeds(p.x + 32, p.y + 32, disp.b[i]);
    }
    // stores
    for (var s = 0; s < 2; s++) {
      var q = STORE_XY[s], sa = now - storeAt[s];
      if (sa < 700) blit(sheet, SPR.storeLit(sa < 120 || sa > 580 ? 0 : (sa < 240 || sa > 460 ? 1 : 2)), q.x, q.y);
      drawStoreSeeds(q.x, q.y, disp.s[s]);
    }
    // turn indicator
    if (game && !game.over) blit(sheet, SPR.yellow, TURN_XY[game.st.turn].x, TURN_XY[game.st.turn].y);
    // last move markers: green ball = pit just played, red balls = pits captured
    for (var pl = 0; pl < 2; pl++) if (lastPlayed[pl] >= 0) {
      var h = holeXY(lastPlayed[pl], 1); blit(keyed, SPR.green, h.x - 8, h.y - 8);
    }
    capMarks.forEach(function (c) {
      var a = holeXY(c, 0), b = holeXY(c, 2);
      blit(keyed, SPR.red, a.x - 6, a.y - 6); blit(keyed, SPR.red, b.x - 6, b.y - 6);
    });

    // lower panel: seed counters
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 11px Tahoma, Verdana, sans-serif'; g.fillStyle = '#10205a';
    for (var j = 0; j < 12; j++) {
      var cb = countBox(j); g.fillText(String(disp.b[j]), cb.x + 8, cb.y + 9.5);
    }
    for (var t = 0; t < 2; t++) g.fillText(String(disp.s[t]), STORE_BOX[t].x + 8, STORE_BOX[t].y + 9.5);
    // little letters of the log convention under the counters
    g.font = '9px Tahoma, Verdana, sans-serif'; g.fillStyle = '#c8d4f0';
    for (var l = 0; l < 12; l++) {
      var lb = countBox(l); g.fillText(E.LETTERS[l], lb.x - 8, lb.y + 9.5);
    }
    // info box: mode and level of the current game
    if (game) {
      g.font = 'bold 10px Tahoma, Verdana, sans-serif'; g.fillStyle = '#000080';
      g.fillText((game.tournament ? 'Tournoi' : 'Usuel') + ' - N' + game.level, INFO_BOX.x + INFO_BOX.w / 2, INFO_BOX.y + INFO_BOX.h / 2 + 0.5);
    }
  }

  // ---------- Input ----------

  function pitAt(e) {
    var pos = Lehcim.canvasPos(canvas, e);
    for (var i = 0; i < 6; i++) {
      var p = pitXY(i), dx = pos.x - (p.x + 32), dy = pos.y - (p.y + 32);
      if (dx * dx + dy * dy <= 30 * 30) return i;
    }
    return -1;
  }
  canvas.addEventListener('pointermove', function (e) {
    hover = pitAt(e);
    var ok = hover >= 0 && !busy && game && !game.over && E.legalMoves(game.st).indexOf(hover) >= 0;
    canvas.style.cursor = ok ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', function () { hover = -1; });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (busy || !game || game.over || game.st.turn !== 0) return;
    var i = pitAt(e);
    if (i < 0) return;
    if (E.legalMoves(game.st).indexOf(i) < 0) {
      sfx('bad', 0.5);
      setStatus(game.st.b[i] === 0 ? 'Cette case est vide.' : "Tu dois nourrir l'ordinateur : choisis une case qui lui donne des graines.");
      return;
    }
    playMove(i, game.token);
  });

  document.getElementById('new').addEventListener('click', function () { this.blur(); newGame(); });
  document.getElementById('abandon').addEventListener('click', function () { this.blur(); abandon(); });
  document.getElementById('logDownload').addEventListener('click', function () {
    if (!logUrl) return;
    var a = document.createElement('a'); a.href = logUrl; a.download = 'AwParties.txt';
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('games').addEventListener('click', function () { this.blur(); showLog(); });
  function onSetting() {
    settings.tournament = +selMode.value; settings.level = +selLevel.value; settings.starter = +selStarter.value;
    saveSettings();
    // a game not started yet takes the new settings at once
    if (game && !game.moves.length && !game.over) { sessionGames.pop(); newGame(); }
    else setStatus('Réglage pris en compte à la prochaine partie.');
  }
  [selMode, selLevel, selStarter].forEach(function (s) { s.addEventListener('change', onSetting); });

  // ---------- Start ----------

  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  // Sounds (guessed from their length): 6 = short click (seed drop), 3 = pick up,
  // 4 = capture, 5 = long jingle (win), 7 = lose, 2 = pass / draw, 1 = new game / refused click.
  // Loaded on the first click/key: browsers refuse to start audio before a user gesture.
  function loadSounds() {
    if (soundsLoaded) return; soundsLoaded = true;
    Lehcim.loadSounds({
      seed: 'assets/sounds/6.wav', take: 'assets/sounds/3.wav', capture: 'assets/sounds/4.wav',
      win: 'assets/sounds/5.wav', lose: 'assets/sounds/7.wav', pass: 'assets/sounds/2.wav',
      start: 'assets/sounds/1.wav', bad: 'assets/sounds/1.wav'
    });
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSounds, { once: true }); });
  Promise.all([Lehcim.loadSheet('assets/sheet.png', null), Lehcim.loadSheet('assets/sheet.png', KEY)])
    .then(function (s) { sheet = s[0]; keyed = s[1]; newGame(); });
  requestAnimationFrame(draw);

  // test hook (used by the automated checks only)
  window.__awele = { get game() { return game; }, get busy() { return busy; }, playMove: function (i) { playMove(i, game.token); }, logText: logText };
})();
