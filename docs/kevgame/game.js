/*
 * KevGame - page, drawing, keyboard/touch input, sounds and match flow.
 * The rules and the computer player live in engine.js (global KevEngine).
 *
 * Canvas = the original 600x408 window: the swimming pool background is the
 * left part of assets/sheet.png, sprites are 24x24 cells of its right part
 * (cell (c, r) is at x = 600 + 24c, y = 24r):
 *   worm  cols 0-5, fish cols 6-11; rows 0-3 = swimming up/right/down/left,
 *         rows 4-15 = turning towards up/right/down/left (3 rows each);
 *   cols 12-17 rows 0-5 = a buoy or balloon appearing (col 17 = wall piece);
 *   cols 12-17 rows 6-9 = lit firecracker and its explosion;
 *   cols 12-17 rows 10-15 = the 36 frames of a bubble zone;
 *   cols 18-19 = the fish diving (48x48) and the ripples;
 *   col 20 = the fish's face (rows 3-13) and the king (rows 14-15);
 *   cols 21-24 = the worm dying, col 25 = the fish dying, rows 8-16 = a cross;
 *   row 16 cols 17-18 = the blinking buoy, cols 19-20 = the firecracker to pick up.
 * The game runs on fixed ticks of 50 ms like the original Timer1.
 */
(function () {
  'use strict';

  var K = window.KevEngine, TICK = K.CFG.tick;
  var canvas = document.getElementById('game'), g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var modeSel = document.getElementById('mode'), levelSel = document.getElementById('level');
  var sheet = null;
  var OX = 48, OY = 48; // pool origin in the background

  // ---------- Sounds ----------
  // Guessed from their length/shape: 1/2 short "gloup" (breathing), 3 wall,
  // 4 time is up, 5 suffocation, 6 explosion, 7 the worm is eaten, 8 bonus.
  var SND = {};
  for (var n = 1; n <= 8; n++) SND[n] = 'assets/sounds/' + n + '.wav';
  // decoded after the first user gesture (browsers refuse audio before)
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true }); });
  function snd(n, v) { Lehcim.play(String(n), v); }

  // ---------- Options (the original starts in "Un joueur contre l'ordinateur", "Niveau débutant") ----------
  function loadOpt(k, def) { try { var v = localStorage.getItem('lehcim.kevgame.' + k); return v == null ? def : v; } catch (e) { return def; } }
  function saveOpt(k, v) { try { localStorage.setItem('lehcim.kevgame.' + k, v); } catch (e) { /* ignore */ } }
  modeSel.value = loadOpt('mode', '1');
  levelSel.value = loadOpt('level', '0');
  modeSel.addEventListener('change', function () { saveOpt('mode', modeSel.value); levelSel.disabled = modeSel.value !== '1'; modeSel.blur(); updateStatus(); });
  levelSel.addEventListener('change', function () { saveOpt('level', levelSel.value); levelSel.blur(); if (ai[0]) ai[0].level = +levelSel.value; });
  levelSel.disabled = modeSel.value !== '1';

  // ---------- Match state ----------
  var phase = 'idle';   // idle, play, wait (message box of round 1), over, stopped
  var st = null;        // round state (engine)
  var results = [];
  var ai = [null, null];// brains of computer players (null = human)
  var effects = [];     // visual effects {k, x, y, t, dur}
  var endT = 0;         // ticks since the end of the round (animations)
  var clock = 0;        // global animation time (s)
  var acc = 0;          // time not yet turned into ticks

  function onePlayer() { return modeSel.value === '1'; }

  function newGame() {
    closeMsg();
    results = [];
    ai = [onePlayer() ? K.newBrain(+levelSel.value) : null, null];
    Lehcim.playMidi('assets/music.mid', { loop: true });
    startRound(0);
  }

  function startRound(r) {
    st = K.newRound(r, Math.random);
    if (ai[0]) ai[0] = K.newBrain(ai[0].level);
    effects = []; held = [[], []]; pointer = null; endT = 0; acc = 0;
    setPhase('play');
  }

  function setPhase(p) { phase = p; updateStatus(); }

  // "Abandonner" freezes the game where it is.
  function abandon() {
    if (phase !== 'play' && phase !== 'wait') return;
    closeMsg();
    Lehcim.stopMusic(); setPhase('stopped');
  }

  function updateStatus() {
    var t;
    if (!st || phase === 'idle') t = onePlayer() ? 'Un joueur contre l\'ordinateur' : 'Deux joueurs';
    else if (phase === 'over' || phase === 'stopped') t = 'Partie terminée';
    else t = 'Manche ' + (st.round + 1) + '/2 - poisson : ' + K.NAMES[K.fish(st).side] + ', ver : ' + K.NAMES[K.worm(st).side];
    statusEl.textContent = t;
  }

  // ---------- Message box with a caption, like the original MessageBox ----------
  var msgDlg = null;
  function showMsg(caption, text) {
    closeMsg();
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      var h = document.createElement('h2'); h.textContent = caption; d.appendChild(h);
      var p = document.createElement('p'); p.textContent = text; d.appendChild(p);
      var row = document.createElement('div'); row.className = 'row';
      var b = document.createElement('button'); b.textContent = 'OK';
      b.addEventListener('click', function () { closeMsg(); resolve(); });
      row.appendChild(b); d.appendChild(row);
      d.addEventListener('cancel', function (e) { e.preventDefault(); });
      document.body.appendChild(d); d.showModal(); b.focus();
      msgDlg = d;
    });
  }
  function closeMsg() { if (msgDlg) { msgDlg.close(); msgDlg.remove(); msgDlg = null; } }

  // ---------- Keyboard ----------
  // event.code = physical key, so Z/Q/S/D on AZERTY are W/A/S/D on QWERTY.
  var DIRKEYS = [
    { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 },
    { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }
  ];
  var WALLKEYS = [{ Digit1: 1, Numpad1: 1 }, { Space: 1 }];
  var BOOMKEYS = [{ Digit2: 1, Numpad2: 1 }, { AltRight: 1, AltGraph: 1, Enter: 1, NumpadEnter: 1, ControlRight: 1 }];
  var held = [[], []]; // stack of held directions per side

  // Which human side a key set drives (in 1 player mode both sets drive the right one).
  function sideOfSet(set) { return ai[0] ? 1 : set; }

  function gameKey(e) {
    for (var s = 0; s < 2; s++) {
      if (e.code in DIRKEYS[s] || e.code in WALLKEYS[s] || e.code in BOOMKEYS[s]) return s;
    }
    if (e.key === 'AltGraph') return 1;
    return -1;
  }

  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var set = gameKey(e);
    if (set < 0) return;
    e.preventDefault();
    var side = sideOfSet(set);
    if (e.code in DIRKEYS[set]) {
      var d = DIRKEYS[set][e.code], h = held[side], i = h.indexOf(d);
      if (i >= 0) h.splice(i, 1);
      h.push(d);
      return;
    }
    if (e.repeat || phase !== 'play' || !st) return;
    var a = st.animals[side];
    if (e.code in WALLKEYS[set]) K.buildWall(st, a);
    else K.demolish(st, a);
  });
  window.addEventListener('keyup', function (e) {
    var set = gameKey(e);
    if (set < 0 || !(e.code in DIRKEYS[set])) return;
    var side = sideOfSet(set), h = held[side], i = h.indexOf(DIRKEYS[set][e.code]);
    if (i >= 0) h.splice(i, 1);
  });
  window.addEventListener('blur', function () { held = [[], []]; });

  // ---------- Touch / mouse: hold the finger where the right animal should swim ----------
  var pointer = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (phase !== 'play') return;
    pointer = Lehcim.canvasPos(canvas, e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) { if (pointer) pointer = Lehcim.canvasPos(canvas, e); });
  ['pointerup', 'pointercancel'].forEach(function (ev) { canvas.addEventListener(ev, function () { pointer = null; }); });
  document.getElementById('tWall').addEventListener('click', function () { if (phase === 'play') K.buildWall(st, st.animals[1]); });
  document.getElementById('tBoom').addEventListener('click', function () { if (phase === 'play') K.demolish(st, st.animals[1]); });

  function humanDir(side) {
    var h = held[side];
    if (h.length) return h[h.length - 1];
    if (side === 1 && pointer) {
      var p = K.pos(st.animals[1]), vx = pointer.x - (OX + p.x + 12), vy = pointer.y - (OY + p.y + 12);
      if (Math.abs(vx) < 12 && Math.abs(vy) < 12) return -1;
      return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0);
    }
    return -1;
  }

  // ---------- Game loop ----------
  var last = 0;
  function frame(now) {
    var dt = Math.min(0.25, (now - last) / 1000 || 0);
    last = now; clock += dt;
    effects = effects.filter(function (f) { f.t += dt; return f.t < f.dur; });
    if (phase === 'play' || phase === 'wait' || phase === 'over') {
      acc += dt;
      while (acc >= TICK) { acc -= TICK; tick(); }
    }
    if (sheet) draw();
    requestAnimationFrame(frame);
  }

  function tick() {
    if (phase === 'play') {
      var wants = [0, 1].map(function (s) {
        return ai[s] ? K.aiThink(st, st.animals[s], ai[s]) : function () { return humanDir(s); };
      });
      K.step(st, wants);
      handleEvents();
      if (st.over) endOfRound();
      else if (st.ticks % 20 === 0) updateStatus();
    } else endT++; // the end of round animations go on behind the message box
  }

  function addFx(k, x, y, dur, extra) {
    var f = { k: k, x: x, y: y, t: 0, dur: dur };
    if (extra) for (var p in extra) f[p] = extra[p];
    effects.push(f);
  }

  function handleEvents() {
    st.events.forEach(function (e) {
      switch (e.e) {
        case 'wall': snd(3); break;
        case 'boom':
          snd(6);
          addFx('boom', e.x * 24, e.y * 24, 0.2);
          break;
        case 'pick': snd(8); break;
        case 'breath': snd(e.side === 0 ? 1 : 2, 0.6); break;
        case 'end':
          if (e.how === 'catch') snd(7);
          else if (e.how === 'time') snd(4);
          else snd(5);
          break;
      }
    });
    st.events.length = 0;
  }

  function endOfRound() {
    results.push(st.result);
    endT = 0;
    if (st.round === 0) {
      setPhase('wait');
      var m = K.roundMessage(st.result);
      showMsg(m.caption, m.text).then(function () { if (phase === 'wait') startRound(1); });
    } else {
      var match = K.matchResult(results);
      setPhase('over');
      showMsg(match.caption, match.text).then(function () {
        if (phase === 'over') { Lehcim.stopMusic(); setPhase('stopped'); }
      });
    }
  }

  // ---------- Drawing ----------
  function spr(c, r, x, y) { g.drawImage(sheet, 600 + 24 * c, 24 * r, 24, 24, Math.round(x), Math.round(y), 24, 24); }
  function sprPool(c, r, x, y) { spr(c, r, OX + x, OY + y); }

  function draw() {
    g.imageSmoothingEnabled = false;
    if (!st) { drawIdle(); return; }
    g.drawImage(sheet, 0, 0, 600, 408, 0, 0, 600, 408);
    drawZones();
    drawBonus();
    drawWalls();
    st.animals.forEach(drawAnimal);
    drawEffects();
    drawPanels();
  }

  // Before the first game the original window is black.
  function drawIdle() {
    g.fillStyle = '#000'; g.fillRect(0, 0, 600, 408);
    g.font = '13px Verdana, Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#666'; g.fillText('Nouvelle Partie', 300, 204);
  }

  function drawZones() {
    var f = st.ticks % 36;
    st.zones.forEach(function (z) { sprPool(12 + f % 6, 10 + Math.floor(f / 6), z.x * 24, z.y * 24); });
  }

  function drawBonus() {
    var b = st.bonus;
    if (!b) return;
    var blink = Math.floor((st.ticks - b.born) / 4) % 2;
    sprPool((b.kind === 'buoy' ? 17 : 19) + blink, 16, b.x * 24, b.y * 24);
  }

  function drawWalls() {
    for (var y = 0; y < K.ROWS; y++) {
      for (var x = 0; x < K.COLS; x++) {
        var w = st.walls[K.idx(x, y)];
        if (!w) continue;
        var f = Math.min(5, Math.floor((st.ticks - w.born) / 2)); // appearing animation
        sprPool(12 + f, w.type, x * 24, y * 24);
        if (w.fuse) { // lit firecracker on the wall (20 frames)
          var k = Math.min(19, st.ticks - w.fuse);
          sprPool(12 + k % 6, 6 + Math.floor(k / 6), x * 24, y * 24);
        }
      }
    }
  }

  // Turning rows: 3 rows per new direction, for the old directions
  // new+1, new+2 (half-turn) and new+3.
  function turnRow(a) { return 4 + 3 * a.dir + (a.prevDir - a.dir + 3) % 4; }

  function drawAnimal(a) {
    var p = K.pos(a), base = a.kind === 'fish' ? 6 : 0, r = st.result, t = endT;
    if (st.over) {
      var winner = r.winner === a.side;
      if (r.how === 'catch') {
        if (a.kind === 'worm') return;                     // swallowed
        var wp = K.pos(K.worm(st));
        if (t < 12) { splash(p, Math.floor(t / 4)); return; }
        if (t < 20) return;
        sprPool(20, t < 26 ? 3 : (t < 34 ? 6 + (t >> 2) % 2 : 3 + (t >> 3) % 3), wp.x, wp.y);
        return;
      }
      if (winner) { sprPool(20, 14 + (t >> 3) % 2, p.x, p.y); return; } // the king
      if (r.how === 'time') { // the fish explodes
        if (t < 8) sprPool(14 + (t >> 1), 9, p.x, p.y);
        return;
      }
      // out of air: fades away, then a cross rises
      var df = t >> 1, dieFrames = a.kind === 'worm' ? 8 : 5;
      if (df < dieFrames) sprPool(a.kind === 'worm' ? 21 + a.dir : 25, df, p.x, p.y);
      else sprPool(21, 8 + Math.min(8, df - dieFrames), p.x, p.y);
      return;
    }
    var f, row = a.dir;
    if (a.moving) f = Math.floor(a.prog / 4);
    else f = Math.floor(a.animT / (a.kind === 'fish' ? 3 : 2)) % 6;
    if (a.turnT > 0 && a.prevDir >= 0 && a.prevDir !== a.dir) { row = turnRow(a); f = 6 - a.turnT; }
    sprPool(base + f, row, p.x, p.y);
  }

  // The fish dives on the worm: 48x48 splash frames of columns 18-19.
  function splash(p, k) {
    g.drawImage(sheet, 1032, 48 * Math.min(2, k), 48, 48, Math.round(OX + p.x - 12), Math.round(OY + p.y - 12), 48, 48);
  }

  function drawEffects() {
    effects.forEach(function (f) {
      if (f.k === 'boom') {
        var k = Math.min(3, Math.floor(f.t / f.dur * 4));
        sprPool(14 + k, 9, f.x, f.y);
      }
    });
  }

  // Sides of the pool: number of walls in the life buoy, of demolitions on the
  // firecracker, air in the O2 bottle, seconds left in the "time" box.
  var NUMPOS = { walls: [[22, 116], [575, 116]], booms: [[20, 246], [578, 245]], air: [[69, 388], [527, 388]] };
  function num(v, x, y) {
    g.font = 'bold 13px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#000'; g.fillText(String(v), x, y + 1);
  }
  function drawPanels() {
    st.animals.forEach(function (a) {
      var s = a.side;
      num(a.walls, NUMPOS.walls[s][0], NUMPOS.walls[s][1]);
      num(a.booms, NUMPOS.booms[s][0], NUMPOS.booms[s][1]);
      if (st.over && st.result.winner >= 0 && st.result.winner !== a.side) {
        // the loser's bottle disappears (sand copied from the next tiles)
        var bx = s === 0 ? 50 : 506;
        g.drawImage(sheet, bx + (s === 0 ? 141 : -141), 362, 42, 45, bx, 362, 42, 45);
      } else num(a.air, NUMPOS.air[s][0], NUMPOS.air[s][1]);
    });
    num(K.secondsLeft(st), 299, 30);
  }

  // ---------- Page wiring ----------
  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  document.getElementById('new').addEventListener('click', function (e) { e.currentTarget.blur(); newGame(); });
  document.getElementById('abandon').addEventListener('click', function (e) { e.currentTarget.blur(); abandon(); });
  updateStatus();

  Lehcim.loadSheet('assets/sheet.png', [184, 10, 70]).then(function (s) {
    sheet = s;
    requestAnimationFrame(function (t) { last = t; frame(t); });
  });

  // For tests: read the state, let the computer play a side.
  window.KevGame = {
    get state() { return st; }, get phase() { return phase; }, get results() { return results; },
    setAI: function (side, level) { ai[side] = level == null ? null : K.newBrain(level); },
    newGame: newGame, closeMsg: function () { var b = msgDlg && msgDlg.querySelector('button'); if (b) b.click(); }
  };
})();
