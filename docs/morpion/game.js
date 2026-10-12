/*
 * Morpion - browser port of Lehcim Noil's five-in-a-row scoring game.
 * Player (orange marbles) against the computer (grey marbles).
 * Rules engine and computer player live in engine.js (MorpionEngine).
 * Everything is drawn on a 400x320 canvas from the original sheet:
 *   left 400x320 = painted background (with "Niveau" and "Score" boxes),
 *   right column = board tiles, marbles, level digits, line overlays,
 *   "Patience !" / "Je réfléchis ..." texts, pendulum and "BIEN" animations.
 */
(function () {
  'use strict';

  var CELL = 20;
  var KEY = [250, 250, 250];         // colour key of the sheet (near-white)
  var BOARD_AREA = 320;              // board is centred in the left 320x320 square

  // Sprite rectangles in sheet.png (measured)
  var SPR = {
    bg: [0, 0, 400, 320],
    tile: function (i, j) { return [400 + 20 * (i % 4), 20 * (j % 2), 20, 20]; }, // 8 board tiles
    marble: [null, [480, 0, 20, 20], [480, 20, 20, 20]],                     // 1 orange, 2 grey
    digit: function (k) { return [400 + 20 * (k - 1), 40, 20, 20]; },        // "1".."5"
    line: [[420, 60], [400, 60], [440, 60], [460, 60]],                      // per direction (- | \ /), 20x20
    patience: [400, 80, 80, 20],
    thinking: [400, 100, 80, 20],
    pendulum: function (k) { return [400 + 40 * (k % 2), 120 + 40 * (k >> 1), 40, 40]; }, // 10 frames
    bien: function (k) { return [480, 60 + 20 * k, 32, 20]; }                // 13 frames
  };
  // Where things go on the background
  var POS = {
    digit: [347, 14], patience: [320, 120], thinking: [320, 140], pendulum: [340, 160],
    bien: [346, 250], score: [[0, 0], [341, 67], [379, 67]], turn: [[0, 0], [331, 82], [369, 82]]
  };

  var canvas = document.getElementById('game'), g2 = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var sizeSel = document.getElementById('size'), levelSel = document.getElementById('level'), firstSel = document.getElementById('first');
  var sheet = null;

  // ---------- State ----------

  var game = null;          // MorpionEngine.Game
  var N = 10, ox = 0, oy = 0;
  var turn = 1;             // 1 = player, 2 = computer
  var thinking = false, ended = false;
  var lastMove = -1, hover = -1;
  var patienceUntil = 0, bienStart = -1, thinkStart = 0;
  var token = 0;            // invalidates pending computer moves after a new game

  function pref(k, def) { try { return localStorage.getItem('lehcim.morpion.' + k) || def; } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem('lehcim.morpion.' + k, v); } catch (e) { /* ignore */ } }

  function level() { return +levelSel.value; }

  function newGame() {
    token++;
    N = +sizeSel.value;
    game = new MorpionEngine.Game(N);
    ox = oy = (BOARD_AREA - N * CELL) >> 1;
    turn = +firstSel.value;
    thinking = false; ended = false; lastMove = -1; bienStart = -1;
    updateStatus();
    if (turn === 2) computerTurn();
  }

  function updateStatus() {
    var s;
    if (ended) s = 'Partie terminée';
    else if (thinking) s = "L'ordinateur réfléchit...";
    else s = 'A toi de jouer';
    statusEl.textContent = s + '  -  Joueur ' + game.score[1] + ' / Ordinateur ' + game.score[2];
  }

  // ---------- Moves ----------

  function place(c, p) {
    var rec = game.play(c, p);
    lastMove = c;
    Lehcim.play('drop');
    if (rec.scored.length) {
      if (p === 1) { Lehcim.play('point'); bienStart = performance.now(); }
      else Lehcim.play('cpu');
    }
    return rec;
  }

  // After each move: end of game, or next turn.
  function next() {
    if (game.over()) { endGame(); return; }
    turn = 3 - turn;
    if (turn === 2) computerTurn();
    updateStatus();
  }

  function computerTurn() {
    var my = token;
    thinking = true; thinkStart = performance.now(); updateStatus();
    // let the "Je réfléchis" frame show, then search (time-bounded), then play after a short pause
    setTimeout(function () {
      if (my !== token) return;
      var t0 = performance.now();
      var c = game.bestMove(2, level());
      var wait = Math.max(0, 650 - (performance.now() - t0));
      setTimeout(function () {
        if (my !== token) return;
        thinking = false;
        if (c >= 0) place(c, 2);
        next();
      }, wait);
    }, 60);
  }

  function endGame() {
    ended = true; updateStatus();
    var a = game.score[1], b = game.score[2], txt;
    if (a > b) { txt = 'Bravo, tu as gagné !'; Lehcim.play('end'); }
    else if (a < b) { txt = "L'ordinateur a gagné..."; Lehcim.play('cpu'); }
    else { txt = 'Match nul !'; Lehcim.play('end'); }
    setTimeout(function () {
      Lehcim.message('Plus personne ne peut progresser : la partie est terminée.\n\nJoueur : ' + a + ' point' + (a > 1 ? 's' : '') +
        '\nOrdinateur : ' + b + ' point' + (b > 1 ? 's' : '') + '\n\n' + txt);
    }, 400);
  }

  function cellAt(e) {
    var p = Lehcim.canvasPos(canvas, e);
    var i = Math.floor((p.x - ox) / CELL), j = Math.floor((p.y - oy) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (!game || ended) return;
    var c = cellAt(e);
    if (thinking) { if (c >= 0) patienceUntil = performance.now() + 1200; return; }
    if (c < 0 || turn !== 1 || game.board[c]) return;
    if (e.pointerType !== 'mouse') hover = -1;
    place(c, 1);
    next();
  });
  canvas.addEventListener('pointermove', function (e) { hover = e.pointerType === 'mouse' ? cellAt(e) : -1; });
  canvas.addEventListener('pointerleave', function () { hover = -1; });

  // ---------- Toolbar ----------

  function confirmGiveUp() {
    if (thinking) { patienceUntil = performance.now() + 1500; return Promise.resolve(false); }
    if (ended || game.moves === 0) return Promise.resolve(true);
    return Lehcim.message("Tout va s'effacer...\nVeux-tu vraiment abandonner ?", ['OUI', 'NON']).then(function (i) { return i === 0; });
  }

  document.getElementById('new').addEventListener('click', function (e) {
    e.currentTarget.blur();
    confirmGiveUp().then(function (ok) { if (ok) newGame(); });
  });
  document.getElementById('giveup').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (thinking) { patienceUntil = performance.now() + 1500; return; }
    if (ended || game.moves === 0) return;
    confirmGiveUp().then(function (ok) { if (ok) newGame(); });
  });
  // Board size / starter: immediate on an untouched board, otherwise for the next game.
  [sizeSel, firstSel].forEach(function (sel) {
    sel.addEventListener('change', function () {
      setPref(sel.id, sel.value); sel.blur();
      if (!thinking && (ended || game.moves === 0)) newGame();
    });
  });
  levelSel.addEventListener('change', function () { setPref('level', levelSel.value); levelSel.blur(); });

  // ---------- Drawing ----------

  function blit(r, x, y) { g2.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, r[2], r[3]); }

  function draw(now) {
    blit(SPR.bg, 0, 0);
    // board frame + tiles
    var w = N * CELL;
    g2.fillStyle = 'rgba(40,20,20,0.55)'; g2.fillRect(ox - 3, oy - 3, w + 6, w + 6);
    g2.fillStyle = '#6e3845'; g2.fillRect(ox - 1, oy - 1, w + 2, w + 2);
    var i, j, c;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      c = j * N + i;
      var x = ox + i * CELL, y = oy + j * CELL;
      blit(SPR.tile(i, j), x, y);
      if (game.board[c]) blit(SPR.marble[game.board[c]], x, y);
    }
    // last move marker
    if (lastMove >= 0 && !ended) {
      g2.strokeStyle = game.board[lastMove] === 2 ? 'rgba(255,240,180,0.9)' : 'rgba(110,56,69,0.6)';
      g2.lineWidth = 1;
      g2.strokeRect(ox + (lastMove % N) * CELL + 0.5, oy + Math.floor(lastMove / N) * CELL + 0.5, CELL - 1, CELL - 1);
    }
    // scored lines (red overlay through each of the 5 cells)
    for (var k = 0; k < game.lines.length; k++) {
      var wi = game.lines[k].w, d = game.wDir[wi], src = SPR.line[d];
      for (var m = 0; m < 5; m++) {
        c = game.wCells[wi * 5 + m];
        g2.drawImage(sheet, src[0], src[1], 20, 20, ox + (c % N) * CELL, oy + Math.floor(c / N) * CELL, 20, 20);
      }
    }
    // hover preview
    if (hover >= 0 && !thinking && !ended && turn === 1 && !game.board[hover]) {
      g2.globalAlpha = 0.45; blit(SPR.marble[1], ox + (hover % N) * CELL, oy + Math.floor(hover / N) * CELL); g2.globalAlpha = 1;
    }
    // side panel: level digit, scores, whose turn
    blit(SPR.digit(level()), POS.digit[0], POS.digit[1]);
    g2.font = 'bold 13px "Times New Roman", Times, serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillStyle = '#6e3845';
    for (var p = 1; p <= 2; p++) g2.fillText(String(game.score[p]), POS.score[p][0], POS.score[p][1]);
    if (!ended) blit(SPR.marble[turn], POS.turn[turn][0], POS.turn[turn][1]);
    // computer thinking: text + pendulum
    if (thinking) {
      blit(SPR.thinking, POS.thinking[0], POS.thinking[1]);
      blit(SPR.pendulum(Math.floor((now - thinkStart) / 90) % 10), POS.pendulum[0], POS.pendulum[1]);
    }
    if (now < patienceUntil) blit(SPR.patience, POS.patience[0], POS.patience[1]);
    // "BIEN" when the player scores
    if (bienStart >= 0) {
      var f = Math.floor((now - bienStart) / 110);
      if (f > 12) bienStart = -1; else blit(SPR.bien(f), POS.bien[0], POS.bien[1]);
    }
  }

  function loop(now) { if (sheet && game) draw(now); requestAnimationFrame(loop); }

  // ---------- Start ----------

  Lehcim.initPage();
  sizeSel.value = pref('size', '10'); levelSel.value = pref('level', '3'); firstSel.value = pref('first', '1');
  if (!sizeSel.value) sizeSel.value = '10';
  if (!levelSel.value) levelSel.value = '3';
  if (!firstSel.value) firstSel.value = '1';
  Lehcim.fitCanvas(canvas);
  // sounds are decoded after the first user gesture (browsers block audio before)
  var soundsLoaded = false;
  function loadSounds() {
    if (soundsLoaded) return;
    soundsLoaded = true;
    Lehcim.loadSounds({
      drop: 'assets/sounds/1.wav',   // short click: a marble is dropped
      point: 'assets/sounds/2.wav',  // player scores a line
      cpu: 'assets/sounds/3.wav',    // computer scores / wins
      end: 'assets/sounds/4.wav'     // end of game (player wins or draw)
    });
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, loadSounds, { once: true, capture: true }); });
  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    newGame();
    requestAnimationFrame(loop);
  });

  // for tests
  window.Morpion = { state: function () { return { game: game, turn: turn, thinking: thinking, ended: ended, N: N, ox: ox, oy: oy }; } };
})();
