/*
 * Stack - browser port of Lehcim Noil's "Jeu STACK" (Windows 3.x).
 * Marbles appear at the top of a board seen from above and roll down.
 * Pyramid "doors" (one per row, moved with the mouse) deflect them; they
 * pile up at the bottom. The "chose" crawls right to left in the lane just
 * above the piles and is destroyed when it hits a marble (3 lives).
 * A marble landing on a marble of the same colour vanishes with it.
 * One point per marble that appears. Uses the original sprites and sounds.
 */
(function () {
  'use strict';

  // ---------- Layout (canvas 640x480) ----------

  var W = 640, H = 480;
  var CELL = 20, COLS = 20;
  var FX = 40, FY = 40, FW = COLS * CELL, FB = 460;   // playfield x 40..440, y 40..460
  var DOOR_TOPS = [70, 125, 180, 235];                 // one door (40x40) per row
  var LANE_Y = 320;                                    // lane of the "chose" (stack row 6)
  var LANE_ROW = 6;                                    // stack index that lies in the lane
  var MAX_STACK = 8;                                   // stack rows 0..7 (row 7 just under the doors)
  var CHOSE_W = 146, CHOSE_H = 24;
  var TUNNEL = 100;                                    // hidden distance between two passes
  var PANEL = { x: 468, y: 22, s: 2 };

  function stackY(k) { return FB - CELL - CELL * k; }  // top y of stack row k
  function colX(c) { return FX + c * CELL; }

  // ---------- Sprite sheet rectangles (assets/sheet.png, key colour 250,250,250) ----------

  var KEY = [250, 250, 250];
  var SPR = {
    marble: function (color, f) { return [520 + 40 * color + (f >= 18 ? 20 : 0), (f % 18) * 20, 20, 20]; },
    chose: function (f) { return [320, f * 24, CHOSE_W, 24]; },          // 18 frames
    burst: function (f) { return [493, Math.round(f * 360 / 13), 27, 28]; }, // 13 frames, orange burst
    dust: function (f) { return [466, Math.round(f * 360 / 13), 27, 28]; },  // 13 frames, white dust
    ghost: function (f) { return [520 + 20 * f, 360, 20, 20]; },           // 4 frames, fading trace
    hole: [760, 360, 20, 20],
    door: [19, 250, 49, 49],         // pyramid + shadow
    doorLeft: [0, 200, 61, 49],      // with motion studs on the right (moving left)
    doorRight: [2, 250, 66, 49],     // with motion studs on the left (moving right), door at +17
    grate: [0, 300, 49, 33],
    panel: [160, 220, 84, 124],
    floor: function (i) { return [160 + 40 * (i % 4), 40 * ((i >> 2) % 2), 40, 40]; },
    outer: function (i) { return [40 * (i % 4), 40 + 40 * ((i >> 2) % 2), 40, 40]; },
    hbar: function (i) { return [40 * (i % 2), 120, 40, 20]; },
    vbar: function (i) { return [12 * (i % 6), 160, 10, 40]; }
  };
  var NCOLORS = 7;

  // ---------- Sounds (resource numbers of the original .exe, uses guessed) ----------

  var SND = {
    appear: 1, land: [4, 5, 6], door: 12, roll: 5, match: 9, crash: 3, life: 14,
    level: 17, over: 11, start: 15, fast: 10
  };

  // ---------- DOM ----------

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var levelSel = document.getElementById('level');
  var musicSel = document.getElementById('music');
  var sheet = null;

  var scores = Lehcim.highScores('stack', [
    { name: 'Pro', score: 350 }, { name: 'Expert', score: 300 }, { name: 'Amateur', score: 250 },
    { name: 'Junior', score: 150 }, { name: 'Gros Mauvais', score: 100 }
  ]);

  try { var m = localStorage.getItem('lehcim.stack.music'); if (m === '0') musicSel.value = '0'; } catch (e) { /* ignore */ }
  try { var l = localStorage.getItem('lehcim.stack.level'); if (l) levelSel.value = l; } catch (e) { /* ignore */ }

  // ---------- Game state ----------

  var G = {
    state: 'idle',      // idle | play | over
    paused: false,
    score: 0, lives: 3, level: 1, startLevel: 1,
    stacks: [],         // stacks[c] = [{color, frame}] bottom first
    marbles: [],        // moving marbles
    doors: [],          // {top, col, x, target, stepT}
    fx: [],             // visual effects
    chose: { x: 0, alive: true, deadT: 0, frame: 0, ft: 0 },
    spawnT: 0, fast: false, time: 0
  };

  function rnd(n) { return Math.floor(Math.random() * n); }
  function nColors() { return Math.min(NCOLORS, 2 + G.level); }
  function spawnInterval() { return Math.max(0.6, 2.6 - 0.2 * (G.level - 1)); }
  function fallSpeed() { return 70 + 10 * G.level; }
  function choseBase() { return 1 + Math.floor((G.level - 1) / 2); }
  function choseSpeed() { return (26 + 6 * choseBase()) * (G.fast ? 4 : 1); }

  function newGame() {
    G.startLevel = parseInt(levelSel.value, 10) || 1;
    G.level = G.startLevel;
    G.score = (G.startLevel - 1) * 50;
    G.lives = 3;
    G.stacks = []; for (var c = 0; c < COLS; c++) G.stacks.push([]);
    G.marbles = []; G.fx = [];
    var start = [9, 3, 14, 7];
    G.doors = DOOR_TOPS.map(function (t, i) { return { top: t, col: start[i], x: colX(start[i]), target: start[i], stepT: 0 }; });
    G.chose = { x: FX + FW, alive: true, deadT: 0, frame: 0, ft: 0, grace: 0 };
    G.spawnT = 0.6; G.state = 'play'; G.paused = false;
    Lehcim.play(SND.start);
    if (musicSel.value === '1') Lehcim.playMidi('assets/music.mid', { loop: true }); else Lehcim.stopMusic();
    updateStatus();
  }

  function updateStatus() {
    if (G.state === 'play') statusEl.textContent = G.paused ? 'Pause' : 'Score : ' + G.score + '  -  Vies : ' + G.lives;
    else if (G.state === 'over') statusEl.textContent = 'Partie terminée - Score : ' + G.score;
    else statusEl.textContent = '';
  }

  // ---------- Marbles ----------

  function spawnMarble() {
    // prefer a column whose pile is not already too high
    var col = rnd(COLS), tries = 0;
    while (G.stacks[col].length >= LANE_ROW && tries++ < 6) col = rnd(COLS);
    G.marbles.push({ col: col, x: colX(col), y: FY, color: rnd(nColors()), state: 'appear', t: 0, dist: 0 });
    G.score++;
    var lv = Math.min(9, 1 + Math.floor(G.score / 50));
    if (lv > G.level) { G.level = lv; Lehcim.play(SND.level, 0.6); }
    Lehcim.play(SND.appear, 0.4);
    updateStatus();
  }

  function doorUnder(m) {
    // door whose top row the marble is entering, and whose cells contain its column
    for (var i = 0; i < G.doors.length; i++) {
      var d = G.doors[i];
      if (m.col === d.col || m.col === d.col + 1) return i;
    }
    return -1;
  }

  function stepMarble(m, dt) {
    var v = fallSpeed();
    if (m.state === 'appear') {
      m.t += dt;
      if (m.t >= 0.45) { m.state = 'fall'; m.t = 0; }
      return;
    }
    if (m.state === 'roll') {
      var d = G.doors[m.door];
      m.t += v * dt / 40;
      if (m.t >= 1) { m.t = 1; }
      m.x = colX(m.from) + (colX(m.to) - colX(m.from)) * m.t;
      m.y = d.top - CELL + 40 * m.t;
      m.dist += v * dt * 1.2;
      if (m.t >= 1) { m.col = m.to; m.x = colX(m.to); m.state = 'fall'; }
      return;
    }
    // falling
    var ny = m.y + v * dt;
    m.dist += v * dt;
    // doors: entering a door row from above
    for (var i = 0; i < G.doors.length; i++) {
      var dr = G.doors[i], yy = dr.top - CELL;
      if (m.y < yy + 0.001 && ny >= yy && (m.col === dr.col || m.col === dr.col + 1)) {
        var to = m.col === dr.col ? dr.col - 1 : dr.col + 2;
        if (to < 0) to = dr.col + 2;
        if (to >= COLS) to = dr.col - 1;
        m.state = 'roll'; m.door = i; m.from = m.col; m.to = to; m.t = 0; m.y = yy;
        Lehcim.play(SND.roll, 0.35);
        return;
      }
    }
    // landing on the pile
    var st = G.stacks[m.col], h = st.length, top = stackY(h);
    if (ny >= top) {
      if (h >= MAX_STACK) { // no more room: the marble bursts
        m.dead = true; addFx('burst', m.x - 3, top - 4); Lehcim.play(SND.crash, 0.5); return;
      }
      if (h > 0 && st[h - 1].color === m.color) { // same colour: both vanish
        var other = st.pop();
        m.dead = true;
        addFx('vanish', m.x, top, m.color, m.dist);
        addFx('vanish', m.x, stackY(h - 1), other.color, other.frame * 4);
        Lehcim.play(SND.match, 0.7);
        return;
      }
      st.push({ color: m.color, frame: Math.floor(m.dist / 4) % 36 });
      m.dead = true;
      Lehcim.play(SND.land[rnd(3)], 0.6);
      return;
    }
    m.y = ny;
  }

  // ---------- Doors ----------

  function doorBlocked(i, newCol) {
    var d = G.doors[i];
    if (newCol < 0 || newCol > COLS - 2) return true;
    for (var k = 0; k < G.marbles.length; k++) {
      var m = G.marbles[k];
      if (m.state === 'roll' && m.door === i) return true; // a marble is rolling on it
      // a marble beside the door, at the same height, in the cell the door would take
      if (m.y + CELL > d.top - CELL + 1 && m.y < d.top + 40) {
        var c0 = Math.floor((m.x - FX) / CELL), c1 = Math.ceil((m.x - FX) / CELL);
        if (c0 === newCol || c0 === newCol + 1 || c1 === newCol || c1 === newCol + 1) {
          if (m.state !== 'roll' || m.door !== i) return true;
        }
      }
    }
    return false;
  }

  function stepDoors(dt) {
    G.doors.forEach(function (d, i) {
      var tx = colX(d.col);
      if (d.x !== tx) {
        var s = 240 * dt;
        d.x = Math.abs(tx - d.x) <= s ? tx : d.x + (tx > d.x ? s : -s);
      }
      if (d.target === d.col || d.x !== tx) return;
      d.stepT -= dt;
      if (d.stepT > 0) return;
      var nc = d.col + (d.target > d.col ? 1 : -1);
      if (doorBlocked(i, nc)) { d.target = d.col; return; }
      d.col = nc; d.stepT = 0.02;
      Lehcim.play(SND.door, 0.5);
    });
  }

  function clickAt(p) {
    if (G.state !== 'play' || G.paused) return;
    if (p.x < FX || p.x >= FX + FW) return;
    var c = Math.floor((p.x - FX) / CELL);
    for (var i = 0; i < G.doors.length; i++) {
      var d = G.doors[i];
      if (p.y >= d.top - 10 && p.y < d.top + 50) {
        if (c < d.col) d.target = c;
        else if (c > d.col + 1) d.target = Math.min(COLS - 2, c - 1);
        return;
      }
    }
  }

  // ---------- The "chose" ----------

  function hitChose(cx, cy, marbleColor, removeFn) {
    var ch = G.chose;
    ch.alive = false; ch.deadT = 0;
    G.lives--;
    addFx('burst', cx - 3, cy - 4);
    for (var k = 0; k < 5; k++) addFx('dust', ch.x + 8 + k * 28, LANE_Y - 4, null, 0, k * 0.07);
    if (removeFn) removeFn();
    Lehcim.play(SND.crash, 0.8);
    setTimeout(function () { Lehcim.play(SND.life, 0.5); }, 250);
    updateStatus();
  }

  function stepChose(dt) {
    var ch = G.chose;
    if (!ch.alive) {
      ch.deadT += dt;
      if (ch.deadT >= 1.8) {
        if (G.lives <= 0) { gameOver(); return; }
        ch.alive = true; ch.x = FX + FW; ch.grace = 1.5;
      }
      return;
    }
    ch.ft += dt * (G.fast ? 3 : 1);
    if (ch.ft > 0.07) { ch.ft = 0; ch.frame = (ch.frame + 1) % 18; }
    ch.x -= choseSpeed() * dt;
    // after leaving on the left, the chose spends a while in the tunnel before coming back
    if (ch.x + CHOSE_W < FX - TUNNEL) ch.x = FX + FW;
    var x0 = ch.x + 3, x1 = ch.x + CHOSE_W - 3;
    if (ch.grace > 0) { ch.grace -= dt; return; }   // just back from the tunnel: blinking, untouchable
    if (x1 < FX || x0 > FX + FW) return;
    // a pile reaching into the lane
    for (var c = 0; c < COLS; c++) {
      var st = G.stacks[c];
      if (st.length > LANE_ROW && colX(c) + 17 > x0 && colX(c) + 3 < x1) {
        hitChose(colX(c), LANE_Y, st[LANE_ROW].color, (function (s) { return function () { s.splice(LANE_ROW, 1); }; })(st));
        return;
      }
    }
    // a marble falling through the lane
    for (var k = 0; k < G.marbles.length; k++) {
      var m = G.marbles[k];
      if (m.dead || m.state === 'appear') continue;
      // only the body counts here (the thin feelers at both ends let marbles pass)
      if (m.y + CELL > LANE_Y + 4 && m.y < LANE_Y + CELL - 4 && m.x + 17 > ch.x + 20 && m.x + 3 < ch.x + 126) {
        hitChose(m.x, m.y, m.color, function () { m.dead = true; });
        return;
      }
    }
  }

  // ---------- Effects ----------

  function addFx(type, x, y, color, dist, delay) {
    G.fx.push({ type: type, x: x, y: y, color: color, dist: dist || 0, t: -(delay || 0) });
  }

  function stepFx(dt) {
    G.fx.forEach(function (f) { f.t += dt; });
    G.fx = G.fx.filter(function (f) {
      if (f.type === 'vanish') return f.t < 0.62;
      return f.t < 13 * 0.06;
    });
  }

  // ---------- Game over / high scores ----------

  function gameOver() {
    G.state = 'over';
    G.fast = false;
    Lehcim.stopMusic();
    Lehcim.play(SND.over, 0.7);
    updateStatus();
    setTimeout(function () {
      var p = Promise.resolve();
      if (scores.qualifies(G.score)) {
        p = Lehcim.prompt('Tu fais partie des meilleurs! Ecris ton nom (14 lettres maximum)', 14).then(function (name) {
          scores.add(name.slice(0, 14), G.score);
        });
      }
      p.then(function () {
        var txt = 'La partie est terminée.\nScore : ' + G.score + '\n\nMEILLEURS SCORES\n' +
          scores.list().map(function (s, i) { return (i + 1) + '. ' + s.name + '  -  ' + s.score; }).join('\n');
        return Lehcim.message(txt);
      });
    }, 1200);
  }

  // ---------- Main loop ----------

  function update(dt) {
    G.time += dt;
    stepFx(dt);
    if (G.state !== 'play' || G.paused) return;
    stepDoors(dt);
    if (G.chose.alive) {
      G.spawnT -= dt;
      if (G.spawnT <= 0) { spawnMarble(); G.spawnT = spawnInterval() * (0.75 + Math.random() * 0.5); }
    }
    G.marbles.forEach(function (m) { if (!m.dead) stepMarble(m, dt); });
    stepChose(dt);
    G.marbles = G.marbles.filter(function (m) { return !m.dead; });
  }

  // ---------- Rendering ----------

  function spr(r, x, y, w, h) { g.drawImage(sheet, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), w || r[2], h || r[3]); }

  var bgCanvas = null;
  function buildBackground() {
    bgCanvas = document.createElement('canvas'); bgCanvas.width = W; bgCanvas.height = H;
    var b = bgCanvas.getContext('2d');
    var i, j, r;
    for (j = 0; j < H; j += 40) for (i = 0; i < W; i += 40) {
      r = SPR.outer((i / 40 * 7 + j / 40 * 3) % 8); b.drawImage(sheet, r[0], r[1], 40, 40, i, j, 40, 40);
    }
    b.save(); b.beginPath(); b.rect(FX, FY, FW, FB - FY); b.clip();
    for (j = FY; j < FB; j += 40) for (i = FX; i < FX + FW; i += 40) {
      r = SPR.floor((i / 40 * 5 + j / 40 * 3) % 8); b.drawImage(sheet, r[0], r[1], 40, 40, i, j, 40, 40);
    }
    b.restore();
    // lane: a slightly darker band where the chose crawls
    b.fillStyle = 'rgba(0,0,0,0.35)'; b.fillRect(FX, LANE_Y - 2, FW, CHOSE_H);
    // walls
    for (i = FX - 10, j = 0; i < FX + FW + 10; i += 40, j++) {
      r = SPR.hbar(j); b.drawImage(sheet, r[0], r[1], 40, 20, i, FY - 20, Math.min(40, FX + FW + 10 - i), 20);
      b.drawImage(sheet, r[0], r[1], 40, 20, i, FB, Math.min(40, FX + FW + 10 - i), 20);
    }
    for (j = FY, i = 0; j < FB; j += 40, i++) {
      r = SPR.vbar(i); b.drawImage(sheet, r[0], r[1], 10, 40, FX - 10, j, 10, 40);
      r = SPR.vbar(i + 3); b.drawImage(sheet, r[0], r[1], 10, 40, FX + FW, j, 10, 40);
    }
    // tunnel grates where the chose leaves and comes back
    r = SPR.grate;
    b.drawImage(sheet, r[0], r[1], 40, 25, 0, LANE_Y - 2, 40, 25);
    b.drawImage(sheet, r[0], r[1], 40, 25, FX + FW, LANE_Y - 2, 40, 25);
    // score panel, scaled x2
    r = SPR.panel; b.imageSmoothingEnabled = false;
    b.drawImage(sheet, r[0], r[1], r[2], r[3], PANEL.x, PANEL.y, r[2] * PANEL.s, r[3] * PANEL.s);
  }

  function drawMarble(color, dist, x, y, scale) {
    var f = Math.floor(dist / 4) % 36;
    var r = SPR.marble(color, f);
    if (scale == null || scale === 1) spr(r, x, y);
    else { var s = CELL * scale; spr(r, x + (CELL - s) / 2, y + (CELL - s) / 2, s, s); }
  }

  function render() {
    g.imageSmoothingEnabled = false;
    g.drawImage(bgCanvas, 0, 0);
    g.save(); g.beginPath(); g.rect(FX, FY, FW, FB - FY); g.clip();

    // piles
    G.stacks.forEach(function (st, c) {
      st.forEach(function (b, k) { drawMarble(b.color, b.frame * 4, colX(c), stackY(k)); });
    });
    // doors
    G.doors.forEach(function (d) {
      var tx = colX(d.col);
      if (d.x > tx + 0.5) spr(SPR.doorLeft, d.x, d.top);
      else if (d.x < tx - 0.5) spr(SPR.doorRight, d.x - 17, d.top);
      else spr(SPR.door, d.x, d.top);
    });
    // moving marbles
    G.marbles.forEach(function (m) {
      if (m.state === 'appear') {
        var p = Math.min(1, m.t / 0.45);
        spr(SPR.hole, m.x, m.y);
        drawMarble(m.color, 0, m.x, m.y, 0.2 + 0.8 * p);
      } else drawMarble(m.color, m.dist, m.x, m.y);
    });
    // the chose
    var ch = G.chose;
    if (G.state !== 'idle' && ch.alive && !(ch.grace > 0 && Math.floor(G.time * 10) % 2)) spr(SPR.chose(ch.frame), ch.x, LANE_Y - 2);
    // effects
    G.fx.forEach(function (f) {
      if (f.t < 0) return;
      if (f.type === 'vanish') {
        if (f.t < 0.3) drawMarble(f.color, f.dist, f.x, f.y, 1 - f.t / 0.3);
        else spr(SPR.ghost(Math.min(3, Math.floor((f.t - 0.3) / 0.08))), f.x, f.y);
      } else {
        var k = Math.min(12, Math.floor(f.t / 0.06));
        spr(f.type === 'burst' ? SPR.burst(k) : SPR.dust(k), f.x, f.y);
      }
    });
    g.restore();

    drawPanel();
    drawScores();
    drawOverlay();
  }

  function drawPanel() {
    var s = PANEL.s, x = PANEL.x + 52 * s, vals;
    if (G.state === 'idle') vals = [levelSel.value, '3', '-', '-'];
    else vals = [G.level, G.lives, choseBase() * (G.fast ? 4 : 1), G.score];
    g.font = 'bold 22px Georgia, "Times New Roman", serif';
    g.textBaseline = 'middle'; g.textAlign = 'left';
    [33, 53, 73, 93].forEach(function (ry, i) {
      var y = PANEL.y + ry * s;
      g.fillStyle = 'rgba(255,255,240,0.55)'; g.fillText(String(vals[i]), x + 1, y + 1);
      g.fillStyle = '#2b1c08'; g.fillText(String(vals[i]), x, y);
    });
  }

  function drawScores() {
    var x = 470, y = 286, w = 164, h = 170;
    g.fillStyle = 'rgba(10,10,20,0.72)'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#a8a499'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffd34d'; g.font = 'bold 13px Tahoma, Verdana, sans-serif'; g.textAlign = 'center';
    g.fillText('MEILLEURS SCORES', x + w / 2, y + 22);
    g.font = '13px Tahoma, Verdana, sans-serif';
    scores.list().forEach(function (e, i) {
      var yy = y + 50 + i * 24;
      g.fillStyle = '#e8e8f0'; g.textAlign = 'left'; g.fillText(e.name, x + 10, yy);
      g.textAlign = 'right'; g.fillText(String(e.score), x + w - 10, yy);
    });
    g.textAlign = 'left';
  }

  function drawOverlay() {
    var text = null;
    if (G.state === 'idle') text = 'Cliquez sur « Nouvelle partie »';
    else if (G.paused) text = 'Pause - appuyez sur P';
    else if (G.state === 'over') text = 'La partie est terminée';
    if (!text) return;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(FX, 200, FW, 50);
    g.fillStyle = '#ffd34d'; g.font = 'bold 18px Tahoma, Verdana, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, FX + FW / 2, 225);
    g.textAlign = 'left';
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    clickAt(Lehcim.canvasPos(canvas, e));
  });

  function setFast(on) {
    if (on && !G.fast && G.state === 'play' && !G.paused) Lehcim.play(SND.fast, 0.4);
    G.fast = !!on && G.state === 'play';
  }
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) setFast(true); }
    else if (e.key === 'p' || e.key === 'P') { togglePause(); }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); setFast(false); }
  });
  var fastBtn = document.getElementById('fast');
  fastBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); setFast(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    fastBtn.addEventListener(ev, function () { setFast(false); });
  });
  fastBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function togglePause() {
    if (G.state !== 'play') return;
    G.paused = !G.paused; G.fast = false;
    updateStatus();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && G.state === 'play' && !G.paused) togglePause();
  });
  window.addEventListener('blur', function () { G.fast = false; });

  document.getElementById('new').addEventListener('click', function (e) { e.target.blur(); newGame(); });
  document.getElementById('abandon').addEventListener('click', function (e) {
    e.target.blur();
    if (G.state !== 'play') return;
    G.lives = 0; G.chose.alive = false; G.chose.deadT = 99; gameOver();
  });
  levelSel.addEventListener('change', function () {
    try { localStorage.setItem('lehcim.stack.level', levelSel.value); } catch (e) { /* ignore */ }
    levelSel.blur();
  });
  musicSel.addEventListener('change', function () {
    try { localStorage.setItem('lehcim.stack.music', musicSel.value); } catch (e) { /* ignore */ }
    if (musicSel.value === '1' && G.state === 'play') Lehcim.playMidi('assets/music.mid', { loop: true });
    else Lehcim.stopMusic();
    musicSel.blur();
  });

  // ---------- Start ----------

  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  var sounds = {};
  for (var i = 1; i <= 17; i++) sounds[i] = 'assets/sounds/' + i + '.wav';
  // load the sounds on the first gesture (an AudioContext cannot start before)
  var soundsLoaded = false;
  ['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () {
      if (soundsLoaded) return;
      soundsLoaded = true; Lehcim.loadSounds(sounds);
    }, true);
  });
  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    buildBackground();
    G.stacks = []; for (var c = 0; c < COLS; c++) G.stacks.push([]);
    G.doors = DOOR_TOPS.map(function (t, k) { var c0 = [9, 3, 14, 7][k]; return { top: t, col: c0, x: colX(c0), target: c0, stepT: 0 }; });
    updateStatus();
    requestAnimationFrame(frame);
  });

  // test hook
  window.__stack = { G: G, newGame: newGame, clickAt: clickAt, spawnMarble: spawnMarble, update: update, stepMarble: stepMarble };
})();
