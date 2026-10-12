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
 *   cols 12-17 rows 10-15 = rising bubbles; cols 18-19 = splash and ripples;
 *   col 20 = the grinning face / the king; cols 21-24 = the worm dying,
 *   col 25 = the fish dying, rows 8-16 = a cross rising;
 *   row 16 = "stop", "c'est", "fini" signs, blue buoys and firecracker icons.
 */
(function () {
  'use strict';

  var K = window.KevEngine;
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

  // ---------- Options ----------
  function loadOpt(k, def) { try { var v = localStorage.getItem('lehcim.kevgame.' + k); return v == null ? def : v; } catch (e) { return def; } }
  function saveOpt(k, v) { try { localStorage.setItem('lehcim.kevgame.' + k, v); } catch (e) { /* ignore */ } }
  modeSel.value = loadOpt('mode', '1');
  levelSel.value = loadOpt('level', '0');
  modeSel.addEventListener('change', function () { saveOpt('mode', modeSel.value); levelSel.disabled = modeSel.value !== '1'; modeSel.blur(); updateStatus(); });
  levelSel.addEventListener('change', function () { saveOpt('level', levelSel.value); levelSel.blur(); });
  levelSel.disabled = modeSel.value !== '1';

  // ---------- Match state ----------
  var phase = 'idle';   // idle, ready, play, dying, signs, wait, over
  var phaseT = 0;       // time spent in the current phase
  var st = null;        // round state (engine)
  var results = [];
  var ai = [null, null];// brains of computer players (null = human)
  var effects = [];     // visual effects {k, x, y, t, type}
  var match = null;     // final result
  var clock = 0;        // global animation time

  function onePlayer() { return modeSel.value === '1'; }
  function sideName(s) { return s === 0 && ai[0] ? 'ORDINATEUR' : (s === 0 ? 'GAUCHE' : 'DROITE'); }

  function newGame() {
    results = []; match = null;
    ai = [onePlayer() ? K.newBrain(+levelSel.value) : null, null];
    Lehcim.playMidi('assets/music.mid', { loop: true });
    startRound(0);
  }

  function startRound(r) {
    st = K.newRound(r, Math.random);
    if (ai[0]) ai[0] = K.newBrain(ai[0].level);
    effects = []; held = [[], []]; pointer = null;
    setPhase('ready');
  }

  function setPhase(p) { phase = p; phaseT = 0; updateStatus(); }

  function abandon() {
    if (phase === 'idle' || phase === 'over') return;
    st = null; Lehcim.stopMusic(); setPhase('idle');
  }

  function updateStatus() {
    var t;
    if (!st || phase === 'idle') t = onePlayer() ? 'Un joueur' : 'Deux joueurs';
    else if (phase === 'over') t = 'Partie terminée';
    else t = 'Manche ' + (st.round + 1) + '/2 - poisson : ' + K.NAMES[K.fish(st).side];
    statusEl.textContent = t;
  }

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
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now; clock += dt; phaseT += dt;
    update(dt);
    if (sheet) draw();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    effects = effects.filter(function (f) { f.t += dt; return f.t < f.dur; });
    if (phase === 'ready' && phaseT > 2) setPhase('play');
    else if (phase === 'play') {
      var wants = [0, 1].map(function (s) {
        return ai[s] ? K.aiThink(st, st.animals[s], ai[s]) : function () { return humanDir(s); };
      });
      K.step(st, dt, wants);
      handleEvents();
      if (st.over) setPhase('dying');
      if (Math.floor(st.t) !== Math.floor(st.t - dt)) updateStatus();
    } else if (phase === 'dying' && phaseT > 2.2) setPhase('signs');
    else if (phase === 'signs' && phaseT > 2.8) endOfRound();
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
          if (e.wall >= 0) addFx('unbuild', e.x * 24, e.y * 24, 0.3, { type: e.wall });
          addFx('boom', e.x * 24, e.y * 24, 0.55);
          break;
        case 'demolish': snd(6); break;
        case 'pick': snd(8); addFx('ring', e.x * 24 + 12, e.y * 24 + 12, 0.45); break;
        case 'breath': snd(e.side === 0 ? 1 : 2, 0.6); addFx('ring', e.x * 24 + 12, e.y * 24 + 12, 0.45); break;
        case 'end': {
          if (e.how === 'catch') {
            var p = K.pos(K.worm(st));
            addFx('splash', p.x + 12, p.y + 12, 0.6);
            snd(7);
          } else if (e.how === 'time') snd(4);
          else snd(5);
          break;
        }
      }
    });
    st.events.length = 0;
  }

  function endOfRound() {
    setPhase('wait');
    results.push(st.result);
    var txt = K.roundText(st);
    if (st.round === 0) {
      Lehcim.message('La première manche est terminée .\n' + txt + '\n\nLes rôles sont maintenant inversés.', ['Manche suivante']).then(function () {
        if (phase === 'wait') startRound(1);
      });
    } else {
      match = K.matchResult(results);
      Lehcim.stopMusic();
      setPhase('over');
      Lehcim.message('La seconde manche est terminée .\n' + txt + '\n\n' + match.text);
    }
  }

  // ---------- Drawing ----------
  function spr(c, r, x, y) { g.drawImage(sheet, 600 + 24 * c, 24 * r, 24, 24, Math.round(x), Math.round(y), 24, 24); }
  function sprPool(c, r, x, y) { spr(c, r, OX + x, OY + y); }
  function sprBig(c, r, x, y, s) { g.drawImage(sheet, 600 + 24 * c, 24 * r, 24, 24, Math.round(x), Math.round(y), 24 * s, 24 * s); }

  function text(s, x, y, size, align, color) {
    g.font = 'bold ' + size + 'px Verdana, Tahoma, sans-serif';
    g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.lineWidth = Math.max(2, size / 5); g.strokeStyle = '#000'; g.lineJoin = 'round';
    g.strokeText(s, x, y);
    g.fillStyle = color || '#fff'; g.fillText(s, x, y);
  }

  function draw() {
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet, 0, 0, 600, 408, 0, 0, 600, 408);
    if (!st || phase === 'idle') { drawIdle(); return; }
    drawZones();
    drawBonuses();
    drawWalls();
    st.animals.forEach(drawAnimal);
    drawEffects();
    drawPanels();
    drawOverlay();
  }

  function drawIdle() {
    // the grinning face appears then makes faces
    var f = Math.floor(clock * 6) % 30, r = f < 3 ? f : 3 + (f % 11);
    sprBig(20, r, 300 - 48, 150, 4);
    text('KevGame', 300, 100, 30, 'center', '#ffd34d');
    text('Le poisson et le ver', 300, 270, 16);
    text('Cliquez sur « Nouvelle partie »', 300, 300, 14);
  }

  function drawZones() {
    K.ZONES.forEach(function (z, i) {
      // light patch so that the bubble zones are easy to spot
      var zx = OX + z[0] * 24 + 12, zy = OY + z[1] * 24 + 12;
      var grad = g.createRadialGradient(zx, zy, 4, zx, zy, 20);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(zx - 20, zy - 20, 40, 40);
      var f = Math.floor(clock * 8 + i * 2) % 6;
      sprPool(12 + f, 10 + (i * 2 + Math.floor(clock * 8 / 6)) % 6, z[0] * 24, z[1] * 24);
    });
  }

  function drawBonuses() {
    if (st.buoy) sprPool(17 + Math.floor(clock * 5) % 2, 16, st.buoy.x * 24, st.buoy.y * 24); // blinking buoy
    if (st.petard) {
      var f = Math.floor(clock * 10) % 15;
      sprPool(13 + f % 5, 6 + Math.floor(f / 5), st.petard.x * 24, st.petard.y * 24);
    }
  }

  function drawWalls() {
    for (var y = 0; y < K.ROWS; y++) {
      for (var x = 0; x < K.COLS; x++) {
        var w = st.walls[K.idx(x, y)];
        if (!w) continue;
        var f = Math.min(4, Math.floor((st.t - w.born) / 0.07)); // appearing animation
        sprPool(13 + f, w.type, x * 24, y * 24);
      }
    }
  }

  // Turning rows: 3 rows per new direction, for the old directions
  // new+1, new+2 (half-turn) and new+3 (measured on the fish frames).
  function turnRow(a) {
    return 4 + 3 * a.dir + (a.turnFrom - a.dir + 3) % 4;
  }

  function drawAnimal(a) {
    var p = K.pos(a), base = a.kind === 'fish' ? 6 : 0;
    if (!a.alive) {
      var t = phase === 'play' || phase === 'dying' ? phaseT : 9;
      if (a.kind === 'worm' && st.result.how === 'catch') {
        if (t < 0.25) return; // swallowed: splash only
        drawCross(p, t - 0.6);
        return;
      }
      var dieFrames = a.kind === 'worm' ? 8 : 5, df = Math.floor(t / 0.12);
      if (df < dieFrames) { sprPool(a.kind === 'worm' ? 21 + a.dir : 25, df, p.x, p.y); return; }
      drawCross(p, t - dieFrames * 0.12);
      return;
    }
    var f, r = a.dir;
    if (a.moving) {
      f = Math.min(5, Math.floor(a.prog * 6));
      if (a.turnFrom >= 0) r = turnRow(a);
    } else {
      f = Math.floor(a.animT * (a.kind === 'fish' ? 6 : 3)) % 6;
    }
    // out of air soon: blink
    if (a.air < 0.2 && phase === 'play' && Math.floor(clock * 6) % 2) return;
    sprPool(base + f, r, p.x, p.y);
  }

  function drawCross(p, t) {
    if (t < 0) return;
    sprPool(21, 8 + Math.min(8, Math.floor(t / 0.1)), p.x, p.y);
  }

  // ripples: irregular rectangles of the sheet (cols 18-19)
  var RINGS = [[1047, 158, 20, 20], [1042, 201, 28, 28], [1039, 245, 36, 37]];
  function drawEffects() {
    effects.forEach(function (f) {
      var k;
      if (f.k === 'boom') {
        k = Math.min(3, Math.floor(f.t / f.dur * 4));
        sprPool(14 + k, 9, f.x, f.y);
      } else if (f.k === 'unbuild') {
        k = Math.min(4, Math.floor(f.t / f.dur * 5));
        sprPool(17 - k, f.type, f.x, f.y);
      } else if (f.k === 'ring') {
        var rr = RINGS[Math.min(2, Math.floor(f.t / f.dur * 3))];
        g.drawImage(sheet, rr[0], rr[1], rr[2], rr[3], Math.round(OX + f.x - rr[2] / 2), Math.round(OY + f.y - rr[3] / 2), rr[2], rr[3]);
      } else if (f.k === 'splash') {
        k = Math.min(2, Math.floor(f.t / f.dur * 3));
        g.drawImage(sheet, 1032, 48 * k, 48, 48, Math.round(OX + f.x - 24), Math.round(OY + f.y - 24), 48, 48);
      }
    });
  }

  // Sides of the pool: walls left (under the life buoy), lit firecracker,
  // air gauge in the white label of the O2 bottle, names and roles on top.
  var GAUGES = [[60, 378], [518, 378]];
  function drawPanels() {
    st.animals.forEach(function (a) {
      var x = a.side === 0 ? 12 : 564;
      for (var i = 0; i < a.walls; i++) spr(17, 16, x, 150 + i * 22);
      if (a.charge > 0) {
        var f = Math.floor(clock * 10) % 15;
        if (a.charge > 3 || Math.floor(clock * 6) % 2) spr(13 + f % 5, 6 + Math.floor(f / 5), x, 266);
        g.fillStyle = '#000'; g.fillRect(x, 293, 24, 4);
        g.fillStyle = '#ffd200'; g.fillRect(x, 293, Math.round(24 * a.charge / K.CFG.chargeTime), 4);
      }
      var gx = GAUGES[a.side][0], gy = GAUGES[a.side][1], h = Math.round(19 * Math.max(0, a.air));
      g.fillStyle = '#2a3346'; g.fillRect(gx, gy, 16, 19);
      var low = a.air < 0.25;
      g.fillStyle = low ? (Math.floor(clock * 6) % 2 ? '#ff3030' : '#ffb0b0') : '#8fe4ff';
      g.fillRect(gx, gy + 19 - h, 16, h);
      var lx = a.side === 0 ? 8 : 592, al = a.side === 0 ? 'left' : 'right';
      text(sideName(a.side), lx, 13, 11, al);
      text(a.kind === 'fish' ? 'poisson' : 'ver', lx, 29, 12, al, a.kind === 'fish' ? '#d8d0ff' : '#ffffff');
    });
    // time display (seconds left)
    var left = Math.max(0, Math.ceil(K.CFG.roundTime - st.t));
    g.font = 'bold 11px Verdana, Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = left <= 10 && Math.floor(clock * 4) % 2 ? '#d00000' : '#4a2000';
    g.fillText(String(left), 299.5, 30);
    text('Manche ' + (st.round + 1), 344, 30, 11, 'left', '#ffd34d');
  }

  // "stop" -> "c'est" -> "fini" signs (row 16, cols 0-14).
  function drawOverlay() {
    var cx = OX + 21 * 12, cy = OY + 13 * 12;
    if (phase === 'ready') {
      text('Manche ' + (st.round + 1), cx, cy - 40, 28, 'center', '#ffd34d');
      var f = K.fish(st), w = K.worm(st);
      text('Poisson : ' + sideName(f.side).toLowerCase() + '   -   Ver : ' + sideName(w.side).toLowerCase(), cx, cy, 15);
      text(phaseT < 1 ? 'Prêts ?' : 'Partez !', cx, cy + 36, 18);
    } else if (phase === 'signs' || phase === 'wait') {
      var k = Math.min(14, Math.floor(phaseT * 7));
      if (phase === 'wait') k = 13;
      sprBig(k, 16, cx - 48, cy - 48, 4);
    } else if (phase === 'over' && match) {
      if (match.winner >= 0) {
        var r = Math.floor(clock * 2) % 2 ? 14 : 15;
        sprBig(20, r, cx - 48, cy - 70, 4);
        text(K.NAMES[match.winner] + ' a gagné la partie !', cx, cy + 50, 20, 'center', '#ffd34d');
      } else {
        sprBig(20, 3 + Math.floor(clock * 6) % 11, cx - 48, cy - 70, 4);
        text('Personne n\'a gagné', cx, cy + 50, 20, 'center', '#ffd34d');
      }
      text('« Nouvelle partie » pour rejouer', cx, cy + 80, 13);
    }
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
    newGame: newGame
  };
})();
