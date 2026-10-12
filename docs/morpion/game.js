/*
 * Morpion - browser port of Lehcim Noil's five-in-a-row scoring game.
 * Player (grey marbles) against the computer (orange marbles), as in the original.
 * Rules engine and computer player live in engine.js (MorpionEngine).
 * Everything is drawn on a 400x320 canvas from the original sheet:
 *   left 400x320 = painted background (with "Niveau" and "Score" boxes),
 *   right column = board tiles, marbles, level digits,
 *   "Patience ! / Je réfléchis ..." block, "BIEN" animation.
 * Behaviour checked against the original running under Wine:
 *   - no board until "Nouvelle partie"; the board is centred in the left 320x320 square;
 *   - the computer always plays orange, its first marble goes on (N/2-1, N/2-1);
 *   - while it thinks, "Patience ! Je réfléchis ..." is shown at (320,120);
 *   - its marble then falls from above the board down its column (100 px/s);
 *   - each scored line is crossed out by a straight red line, 3 px wide;
 *   - during a game, Nouvelle partie / Plateau / Niveau / Qui commence do nothing;
 *     Abandonner clears the board at once (impossible while the computer thinks);
 *   - end of game: message "Bravo" (Tu as gagné!), "Dommage" (Tu as perdu...)
 *     or "Peut mieux faire" (Ex-aequo); the board stays on screen.
 */
(function () {
  'use strict';

  var CELL = 20;
  var KEY = [250, 250, 250];         // colour key of the sheet (near-white)
  var BOARD_AREA = 320;              // board is centred in the left 320x320 square
  var FALL_SPEED = 100;              // px per second, measured on the original
  var PLAYER = 1, COMPUTER = 2;

  // Sprite rectangles in sheet.png (measured)
  var SPR = {
    bg: [0, 0, 400, 320],
    tile: function (i, j) { return [400 + 20 * (i % 4), 20 * (j % 2), 20, 20]; }, // 8 board tiles
    marble: [null, [480, 20, 20, 20], [480, 0, 20, 20]],                     // 1 player grey, 2 computer orange
    digit: function (k) { return [400 + 20 * (k - 1), 40, 20, 20]; },        // "1".."5"
    thinking: [400, 80, 80, 40],                                             // "Patience !" + "Je réfléchis ..."
    bien: function (k) { return [480, 60 + 20 * k, 32, 20]; }                // 13 frames
  };
  // Where things go on the background (client coordinates of the original)
  var POS = {
    digit: [370, 0], thinking: [320, 120], bien: [346, 250],
    score: [[0, 0], [380, 67], [342, 67]]   // player = grey box (right), computer = orange box (left)
  };

  var canvas = document.getElementById('game'), g2 = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var sizeSel = document.getElementById('size'), levelSel = document.getElementById('level'), firstSel = document.getElementById('first');
  var newBtn = document.getElementById('new'), giveUpBtn = document.getElementById('giveup');
  var sheet = null;

  // ---------- State ----------

  var game = null;          // MorpionEngine.Game, null = no board on screen
  var N = 8, ox = 0, oy = 0;
  var phase = 'idle';       // 'idle' (no board), 'play', 'over'
  var turn = PLAYER;
  var thinking = false;     // computer searching ("Patience !" shown)
  var fall = null;          // falling computer marble {c, x, y0, y1, t0}
  var bienStart = -1;
  var token = 0;            // invalidates pending computer moves after an abandon

  function pref(k, def) { try { return localStorage.getItem('lehcim.morpion.' + k) || def; } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem('lehcim.morpion.' + k, v); } catch (e) { /* ignore */ } }

  function level() { return +levelSel.value; }
  function busy() { return thinking || !!fall; }

  function newGame() {
    if (phase === 'play') return;          // the original ignores "Nouvelle Partie" during a game
    token++;
    N = +sizeSel.value;
    game = new MorpionEngine.Game(N);
    ox = oy = (BOARD_AREA - N * CELL) >> 1;
    phase = 'play'; turn = +firstSel.value;
    thinking = false; fall = null; bienStart = -1;
    updateUi();
    if (turn === COMPUTER) computerTurn();
  }

  function clearBoard() {
    token++;
    game = null; phase = 'idle'; thinking = false; fall = null; bienStart = -1;
    updateUi();
  }

  function updateUi() {
    var playing = phase === 'play';
    // like the original menus: inactive during a game
    newBtn.disabled = playing; sizeSel.disabled = playing; levelSel.disabled = playing; firstSel.disabled = playing;
    giveUpBtn.disabled = !playing;
    var s;
    if (phase === 'idle') s = 'Clique sur "Nouvelle partie"';
    else if (phase === 'over') s = 'Partie terminée';
    else if (busy()) s = "L'ordinateur réfléchit...";
    else s = 'A toi de jouer';
    statusEl.textContent = s;
  }

  // ---------- Moves ----------

  function place(c, p) {
    var rec = game.play(c, p);
    Lehcim.play('drop');
    if (rec.scored.length) {
      if (p === PLAYER) { Lehcim.play('point'); bienStart = performance.now(); }
      else Lehcim.play('cpu');
    }
    return rec;
  }

  // After each move: end of game, or next turn.
  function next() {
    if (game.over()) { endGame(); return; }
    turn = 3 - turn;
    updateUi();
    if (turn === COMPUTER) computerTurn();
  }

  function computerTurn() {
    var my = token;
    thinking = true; updateUi();
    // let the "Patience !" frame show, then search (time-bounded), then let the marble fall
    setTimeout(function () {
      if (my !== token) return;
      var t0 = performance.now(), L = MorpionEngine.LEVELS[level()];
      var c = game.bestMove(COMPUTER, level());
      var wait = Math.max(0, (game.moves === 0 ? 150 : L.wait) - (performance.now() - t0));
      setTimeout(function () {
        if (my !== token) return;
        thinking = false;
        if (c < 0) { next(); return; }
        var i = c % N, j = Math.floor(c / N);
        fall = { c: c, x: ox + i * CELL, y0: oy - CELL, y1: oy + j * CELL, t0: performance.now(), token: my };
        updateUi();
      }, wait);
    }, 40);
  }

  function landed() {
    var c = fall.c;
    fall = null;
    place(c, COMPUTER);
    next();
  }

  function endGame() {
    phase = 'over'; updateUi();
    var a = game.score[PLAYER], b = game.score[COMPUTER], title, text;
    if (a > b) { title = 'Tu as gagné!'; text = 'Bravo'; Lehcim.play('end'); }
    else if (a < b) { title = 'Tu as perdu...'; text = 'Dommage'; Lehcim.play('cpu'); }
    else { title = 'Ex-aequo'; text = 'Peut mieux faire'; Lehcim.play('end'); }
    var d = document.getElementById('end');
    document.getElementById('end-title').textContent = title;
    document.getElementById('end-text').textContent = text;
    setTimeout(function () { if (phase === 'over' && !d.open) d.showModal(); }, 300);
  }

  function cellAt(e) {
    var p = Lehcim.canvasPos(canvas, e);
    var i = Math.floor((p.x - ox) / CELL), j = Math.floor((p.y - oy) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (phase !== 'play' || busy() || turn !== PLAYER) return;
    var c = cellAt(e);
    if (c < 0 || game.board[c]) return;
    place(c, PLAYER);
    next();
  });

  // ---------- Toolbar ----------

  newBtn.addEventListener('click', function (e) { e.currentTarget.blur(); newGame(); });
  giveUpBtn.addEventListener('click', function (e) {
    e.currentTarget.blur();
    // "quand l'ordinateur réfléchit, il est impossible d'abandonner"
    if (phase !== 'play' || busy()) return;
    clearBoard();
  });
  sizeSel.addEventListener('change', function () {
    setPref('size', sizeSel.value); sizeSel.blur();
    if (phase === 'over') clearBoard();   // the original clears the finished board
  });
  firstSel.addEventListener('change', function () { setPref('first', firstSel.value); firstSel.blur(); });
  levelSel.addEventListener('change', function () { setPref('level', levelSel.value); levelSel.blur(); });

  // ---------- Drawing ----------

  function blit(r, x, y) { g2.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, r[2], r[3]); }

  // Red line through the 5 cells of window w, from the outer edge of the first
  // cell to the outer edge of the last one (corner to corner for diagonals).
  function drawLine(w) {
    var a = game.wCells[w * 5], b = game.wCells[w * 5 + 4], d = game.wDir[w];
    var ax = ox + (a % N) * CELL, ay = oy + Math.floor(a / N) * CELL;
    var bx = ox + (b % N) * CELL, by = oy + Math.floor(b / N) * CELL;
    g2.fillStyle = g2.strokeStyle = '#ff0000';
    if (d === 0) { g2.fillRect(ax, ay + 9, bx - ax + CELL, 3); return; }
    if (d === 1) { g2.fillRect(ax + 9, ay, 3, by - ay + CELL); return; }
    g2.lineWidth = 2.2; g2.lineCap = 'butt';
    g2.beginPath();
    if (d === 2) { g2.moveTo(ax, ay); g2.lineTo(bx + CELL, by + CELL); }   // "\"
    else { g2.moveTo(ax + CELL, ay); g2.lineTo(bx, by + CELL); }            // "/"
    g2.stroke();
  }

  function draw(now) {
    blit(SPR.bg, 0, 0);
    blit(SPR.digit(level()), POS.digit[0], POS.digit[1]);
    if (!game) return;
    var i, j, c;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      c = j * N + i;
      var x = ox + i * CELL, y = oy + j * CELL;
      blit(SPR.tile(i, j), x, y);
      if (game.board[c]) blit(SPR.marble[game.board[c]], x, y);
    }
    for (var k = 0; k < game.lines.length; k++) drawLine(game.lines[k].w);
    // scores in the two boxes (orange = computer, grey = player)
    g2.font = 'bold 13px Arial, Helvetica, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillStyle = '#000';
    for (var p = 1; p <= 2; p++) g2.fillText(String(game.score[p]), POS.score[p][0], POS.score[p][1]);
    if (thinking) blit(SPR.thinking, POS.thinking[0], POS.thinking[1]);
    // computer marble falling down its column
    if (fall) {
      var fy = fall.y0 + (now - fall.t0) * FALL_SPEED / 1000;
      if (fy >= fall.y1) { fy = fall.y1; if (fall.token === token) landed(); else fall = null; }
      if (fall) blit(SPR.marble[COMPUTER], fall.x, Math.round(fy));
    }
    // "BIEN" when the player scores
    if (bienStart >= 0) {
      var f = Math.floor((now - bienStart) / 110);
      if (f > 12) bienStart = -1; else blit(SPR.bien(f), POS.bien[0], POS.bien[1]);
    }
  }

  function loop(now) { if (sheet) draw(now); requestAnimationFrame(loop); }

  // ---------- Start ----------

  Lehcim.initPage();
  sizeSel.value = pref('size', '8'); levelSel.value = pref('level', '1'); firstSel.value = pref('first', '1');
  if (!sizeSel.value) sizeSel.value = '8';
  if (!levelSel.value) levelSel.value = '1';
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
  updateUi();
  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    requestAnimationFrame(loop);
  });

  // for tests
  window.Morpion = { state: function () { return { game: game, phase: phase, turn: turn, thinking: thinking, fall: fall, N: N, ox: ox, oy: oy }; } };
})();
