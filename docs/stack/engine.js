/*
 * Stack - simulation and drawing of Lehcim Noil's "Jeu STACK" (Windows 3.x),
 * rebuilt from the original STACK.EXE (Borland Pascal + WinG): same 40 ms
 * timer tick, same integer coordinates (640x400 WinG buffer), same rules.
 *
 *  - Marbles leave the dispenser at (210,16) and fall 4 px per tick through a
 *    triangle of pins (6 rows). On each pin row the marble goes left or right
 *    by 12 px (5-tick roll): a movable bar ("porte") next to it decides the
 *    side, otherwise it is random. 6 bars, one per row, move 24 px per click.
 *  - Below the pins the marble crosses the lane of the "chose" and lands in
 *    one of 7 columns. Same colour on top: both vanish. A column of 7 marbles
 *    reaches the lane.
 *  - Every 10 points: one tick less between marbles (min 10), "Vitesse" + 1,
 *    one more colour (max 7). Every 30 points the chose changes look.
 *
 * No DOM in the simulation (runs in node); render() and buildBackground()
 * draw with a canvas 2D context and the sprite sheet (assets/sheet.png).
 * Used by the original port (game.js) and by the new version (nouveau/).
 */
(function (root) {
  'use strict';

  var TICK = 0.04;                 // SetTimer(hwnd, 0xFE, 40, nil)
  var W = 640, H = 400;            // WinG buffer
  var ROWS = 6, NCOLS = 7;
  var DROP_X = 210, DROP_Y = 16;   // new marble
  var CHOSE_X = 576, CHOSE_Y = 230;
  var COL_X0 = 138, COL_Y = 384;   // column c: x = 138 + 24c, marble k at y = 384 - 20k
  var BLOCK_NONE = 50;

  // sound numbers = WAVE resources of STACK.EXE (assets/sounds/N.wav)
  var SND = { land: 1, match: 2, crash: 3, pins: [6, 4, 5], clear: 7, bar: 10, over: 11, bip: 12 };
  var BOOST_SND = [17, 9, 15, 17, 9];   // by chose look 1..5

  function barBase(r) { return 162 + 12 * (6 - r); }
  function barY(r) { return 60 + 24 * (r - 1); }
  function colX(c) { return COL_X0 + 24 * c; }

  function create(opts) {
    opts = opts || {};
    var rand = opts.random || Math.random;
    var emit = opts.onEvent || function () {};
    var sound = opts.onSound || function () {};
    function Random(n) { return Math.floor(rand() * n) % n; }

    var S = {
      playing: false,     // timer running ([0x66])
      over: false,        // lives exhausted, end animation ([0x4c])
      done: false,        // end animation finished (score table shown)
      startLevel: 1,      // "Niveau" ([0x60])
      vitesse: 1,         // "Vitesse" ([0x61])
      score: 0, interval: 59, nColors: 3, next: 0, counter: 0,
      bars: [], marbles: [], cols: [],
      chose: { lives: 3, speed: 1, pending: 0 },
      worm: {},
      boostReq: false,
      ticks: 0
    };

    // ---------- objects ----------

    function resetBar(r) {
      var b = S.bars[r] || (S.bars[r] = { r: r });
      var base = barBase(r);
      b.x = base; b.y = barY(r); b.min = base - 24; b.max = base + 24 * (r - 1);
      b.state = 2; b.sub = 0; b.blocked = BLOCK_NONE;
      b.pos = barPos(b);
    }
    function barPos(b) { return Math.floor((b.x + 24 - 160 - 12 * (6 - b.r)) / 24); }

    function resetChose() {
      var ch = S.chose;
      ch.w = 24; ch.h = 24; ch.srcX = 344 + (ch.speed - 1) * 24;
      ch.x = CHOSE_X; ch.y = CHOSE_Y; ch.frame = 0;
      ch.hit = 0; ch.lo = 0; ch.hi = 0; ch.dying = 0; ch.dead = 0; ch.boost = 0;
      ch.puff = 0; ch.puffX = 0; ch.puffY = 0; ch.puffFrame = 0; ch.puffSub = 0; ch.puffVar = 0;
    }
    function resetCols() {
      for (var c = 0; c < NCOLS; c++) S.cols[c] = { x: colX(c), h: 0, colors: [], vanish: 0, vframe: 0, clear: 0 };
    }
    function resetWorm() { S.worm = { x: CHOSE_X, y: CHOSE_Y, frame: 0, counter: 0 }; }

    // E49: a new board (start of the game and after each lost life)
    function resetBoard() {
      S.over = false; S.next = 0;
      for (var r = 1; r <= ROWS; r++) resetBar(r);
      resetChose();
      S.boostReq = false;
      resetWorm();
      S.marbles = [];
      S.counter = 0;
      resetCols();
    }

    function newGame(level) {
      S.startLevel = Math.max(1, Math.min(5, level | 0 || 1));
      S.chose.lives = 3; S.chose.speed = 1;
      resetBoard();
      S.score = (S.startLevel - 1) * 10;
      S.vitesse = S.startLevel;
      S.interval = 60 - S.vitesse;
      S.nColors = S.startLevel + 2;
      S.playing = true; S.done = false; S.ticks = 0;
    }

    function abandon() { S.playing = false; S.over = false; S.done = false; }

    // ---------- bars ----------

    function barUpdate(b) {
      b.pos = barPos(b);
      if (b.state === 0) {
        if (b.x === b.max) { b.state = 2; return; }
        b.x += 12;
        if (b.sub === 0) { sound(SND.bar); emit('bar', b.r); }
        b.pos++;
        if (++b.sub === 2) { b.sub = 0; b.state = 2; }
      } else if (b.state === 1) {
        if (b.x === b.min) { b.state = 2; return; }
        b.x -= 12;
        if (b.sub === 0) { sound(SND.bar); emit('bar', b.r); b.pos--; }
        if (++b.sub === 2) { b.sub = 0; b.state = 2; }
      }
    }

    // left click at (mx, my): the bar of that row slides one step towards the mouse
    function click(mx, my) {
      if (!S.playing || S.over) return 0;
      var hitRow = 0;
      for (var r = 1; r <= ROWS; r++) {
        var b = S.bars[r];
        if (b.y + 12 >= my && b.y - 12 < my) {
          if (b.x - 4 >= mx) { if (b.blocked !== b.pos - 1) b.state = 1; hitRow = r; }
          else if (b.x + 16 < mx) { if (b.blocked !== b.pos + 1) b.state = 0; hitRow = r; }
        }
      }
      return hitRow;
    }
    // same thing for a bar chosen by number (keyboard / touch helpers)
    function moveBar(r, dir) {
      var b = S.bars[r]; if (!b) return;
      click(dir < 0 ? b.x - 4 : b.x + 17, b.y);
    }
    function canMove(r, dir) {
      var b = S.bars[r]; if (!b) return false;
      var p = b.pos + (dir < 0 ? -1 : 1);
      return b.blocked !== p && (dir < 0 ? b.x > b.min : b.x < b.max);
    }

    // ---------- marbles ----------

    function newMarble(c) {
      return { x: DROP_X, y: DROP_Y, c: c, srcX: 520 + 40 * c, frame: 13, state: 0, sub: 0, dir: 0, g: 0, row: 0, col: 0, alive: true };
    }

    function marbleUpdate(m) {
      var ch = S.chose;
      if (m.state === 0) {
        m.frame = (m.frame + 1) % 16;
        m.y += 4;
        m.col = Math.floor((m.x - COL_X0) / 24);
        var col = S.cols[m.col];
        if (m.y <= COL_Y && Math.floor((COL_Y - m.y) / 20) === col.h) {
          m.alive = false;
          if (col.h > 0 && col.colors[col.h] === m.c) {
            sound(SND.match); col.h--; col.vanish = 1; col.vframe = 0;
            emit('match', { col: m.col, c: m.c });
          } else {
            sound(SND.land); col.h++; col.colors[col.h] = m.c;
            emit('land', { col: m.col, c: m.c, h: col.h });
          }
          return;
        }
        // in the lane: tell the chose where it must not be
        if (((ch.y - 20) & 0xffff) < m.y && m.y + 4 < ch.y + 24) {
          ch.hit = 1;
          var d = ch.y + 24 - m.y, k;
          if (d <= 8) k = 8;
          else if (d <= 12 || m.y + 20 - ch.y <= 4) k = 4;
          else k = 0;
          ch.lo = m.x - 20 + k;
          ch.hi = m.x + 20 - k;
        }
        // pin rows: y = 40, 64, ..., 160
        if (m.y + 20 < 60) { m.row = 0; return; }
        if ((m.y - 40) % 24 !== 0) return;
        m.row = (m.y - 40) / 24 + 1;
        if (m.row > 1 && m.row <= 7) S.bars[m.row - 1].blocked = BLOCK_NONE;
        if (m.row > 6) return;
        sound(SND.pins[Random(3)]);
        m.g = Math.floor((m.x + 8 + 24 - 158 - 12 * (6 - m.row)) / 24);
        m.state = 1; m.sub = 0;
        var bar = S.bars[m.row];
        if (bar.pos === m.g) m.dir = 1;              // bar on the right: go left
        else if (bar.pos + 1 === m.g) m.dir = 0;     // bar on the left: go right
        else m.dir = Random(2);
        m.srcX += 20;
        if (m.dir === 0) { m.frame = 0; bar.blocked = m.g; } else { m.frame = 5; bar.blocked = m.g - 1; }
        emit('pin', { row: m.row, dir: m.dir });
      } else {
        // 5-tick roll round the pin: 12 px sideways, 12 px down
        m.sub++; m.frame++;
        var s = m.dir === 0 ? 1 : -1;
        switch (m.sub) {
          case 1: m.x += 4 * s; break;
          case 2: m.x += 3 * s; m.y += 2; break;
          case 3: m.x += 3 * s; m.y += 3; break;
          case 4: m.x += 2 * s; m.y += 3; break;
          default: m.y += 4;
        }
        if (m.sub === 5) { m.state = 0; m.frame = 0; m.srcX -= 20; }
      }
      if (m.y > 385) { m.y = 0; m.x = DROP_X; }
    }

    // ---------- the "chose" ----------

    function explode(ch) {
      sound(SND.crash);
      ch.lives--; ch.dying = 1;
      ch.srcX = Random(2) === 0 ? 464 : ch.w + 464 + 4;
      ch.w += 4; ch.h += 4; ch.frame = 0;
      emit('crash', { lives: ch.lives, x: ch.x, y: ch.y });
    }

    function choseUpdate(inFlight) {
      var ch = S.chose;
      if (ch.dying === 0) {
        ch.frame = (ch.frame + 1) % 18;
        if (ch.hit === 1 && ch.x > ch.lo && ch.x < ch.hi) {
          ch.x -= 4; ch.y -= 4;
          explode(ch);
        }
        ch.hit = 0;
        if (ch.x > COL_X0 && ch.x - 142 >= 0) {
          var c = Math.floor((ch.x - 142) / 24);
          if (c <= 6 && S.cols[c].h >= 7) {
            explode(ch);
            ch.x = S.cols[c].x + 16;
          }
        }
        if (ch.dying !== 0) return;
        if (S.boostReq) {
          if (!ch.puff) {
            ch.puffX = ch.x + 12; ch.puffY = ch.y + 6; ch.puff = 1; ch.puffFrame = 0; ch.puffSub = 0;
            sound(BOOST_SND[ch.speed - 1]);
          }
          S.boostReq = false;
          ch.boost = 12;
        }
        if (ch.boost > 0) { ch.boost--; ch.x -= 12; } else ch.x -= 4;
        if (ch.x < 25) {
          ch.x = CHOSE_X;
          if (ch.pending === 1) {
            ch.srcX += ch.w; ch.pending = 0; ch.speed++;
            ch.puffVar = ch.speed === 1 ? 0 : (ch.speed === 3 || ch.speed === 5 ? 16 : 8);
            emit('speed', ch.speed);
          }
        }
      } else {
        ch.dying = (ch.dying + 1) & 0xff;
        if (ch.dying % 2 === 0) ch.frame++;
        if (ch.frame === 14) {
          ch.frame = 13;
          if (inFlight === 0) {
            if (S.cols[0].clear === 1) sound(SND.clear);
            for (var k = 0; k < NCOLS; k++) S.cols[k].clear++;
            if (S.cols[0].clear === 8) ch.dead = 1; else ch.y = 0;
          } else ch.y = 0;
        }
      }
    }

    function boost() { if (S.playing && !S.over) S.boostReq = true; }

    // ---------- spawning and levels ----------

    function spawn() {
      S.marbles.push(newMarble(S.next));
      S.next = Random(S.nColors);
      S.counter = 0;
      S.score++;
      emit('spawn', { score: S.score });
      if (S.score % 10 === 0 && S.interval > 10) {
        S.interval--; S.vitesse++;
        if (S.nColors < 7) { S.nColors++; emit('color', S.nColors); }
        emit('vitesse', S.vitesse);
        if (S.chose.speed < 5 && S.score % 30 === 0) S.chose.pending = 1;
      }
    }

    // ---------- animations advanced by the paint of the original ----------

    function paintAdvance() {
      var ch = S.chose;
      if (ch.puff) { ch.puffSub++; if (ch.puffSub % 2 === 0) ch.puffFrame++; if (ch.puffFrame === 12) ch.puff = 0; }
      for (var c = 0; c < NCOLS; c++) {
        var col = S.cols[c];
        if (col.vanish) { col.vframe++; if (col.vframe === 4) { col.vframe = 0; col.vanish = 0; } }
      }
    }

    // ---------- one timer tick (40 ms) ----------

    function tick() {
      if (!S.playing) return;
      S.ticks++;
      if (S.over) {
        var w = S.worm;
        if (w.counter < 54) {
          w.counter++; w.frame++;
          if (w.counter < 24) { w.frame %= 6; w.x -= 4; }
          else if (w.counter >= 30) { if (w.frame === 18) w.frame = 12; w.x += 4; }
        } else {
          S.playing = false; S.done = true;
          emit('finished', { score: S.score });
        }
        return;
      }
      if (S.ticks > 1) paintAdvance();
      for (var r = 1; r <= ROWS; r++) barUpdate(S.bars[r]);
      var ch = S.chose;
      if (!ch.dead) {
        choseUpdate(S.marbles.length);
        for (var i = 0; i < S.marbles.length; i++) marbleUpdate(S.marbles[i]);
        S.marbles = S.marbles.filter(function (m) { return m.alive; });
        S.counter++;
        if (S.counter >= S.interval && ch.dying === 0) spawn();
      } else if (ch.lives === 0) {
        sound(SND.over);
        S.over = true;
        emit('over', { score: S.score });
      } else {
        resetBoard();
        emit('reset', { lives: ch.lives });
      }
    }

    resetCols();
    for (var r0 = 1; r0 <= ROWS; r0++) resetBar(r0);
    resetChose(); resetWorm();

    return {
      S: S, newGame: newGame, tick: tick, click: click, moveBar: moveBar, canMove: canMove,
      boost: boost, abandon: abandon,
      // exposed for tests and for the trajectory preview of the new version
      barPos: barPos, marbleUpdate: marbleUpdate
    };
  }

  // ---------- background (E6: random tiles, built once per run) ----------

  // Calls blit(sx, sy, w, h, dx, dy) in the order of the original.
  function backgroundOps(random, blit) {
    function R(n) { return Math.floor(random() * n) % n; }
    var i, j, r;
    // dark outer tiles
    for (i = 0; i <= 15; i++) for (j = 0; j <= 9; j++) { var a = R(4), b = R(2); blit(160 + 40 * a, 40 * b, 40, 40, 40 * i, 40 * j); }
    // horizontal wall pieces outside the board
    for (j = 1; j <= 14; j++) {
      if (j !== 1 && j < 9) continue;
      r = R(3); blit(40 * r, 130, 40, 10, 40 * j, 0);
      r = R(3); blit(40 * r, 130, 40, 10, 40 * j, 280);
      r = R(3); blit(40 * r, 120, 40, 10, 40 * j, 390);
      r = R(3); blit(40 * r, 120, 40, 10, 40 * j, 190);
    }
    // vertical wall pieces
    for (j = 0; j <= 9; j++) {
      if (j <= 4 || j === 7 || j === 8) {
        r = R(3); blit(24 * r + 12, 160, 12, 40, 0, 40 * j + 10);
        r = R(3); blit(24 * r + 12, 160, 12, 40, 320, 40 * j + 10);
        r = R(3); blit(24 * r, 160, 12, 40, 630, 40 * j + 10);
        r = R(3); blit(24 * r, 160, 12, 40, 110, 40 * j + 10);
      } else if (j === 9) {
        r = R(3); blit(24 * r + 12, 160, 12, 40, 0, 40 * j);
        r = R(3); blit(24 * r + 12, 160, 12, 40, 320, 40 * j);
        r = R(3); blit(24 * r, 160, 12, 40, 630, 40 * j);
        r = R(3); blit(24 * r, 160, 12, 40, 110, 40 * j);
      }
    }
    // corners
    [[0, 0, 160], [320, 0, 160], [0, 280, 160], [320, 280, 160],
      [80, 0, 190], [600, 0, 190], [600, 280, 190], [80, 280, 190],
      [0, 390, 180], [0, 190, 180], [320, 190, 180], [320, 390, 180],
      [600, 390, 170], [80, 390, 170], [80, 190, 170], [600, 190, 170]].forEach(function (p) { blit(72, p[2], 40, 10, p[0], p[1]); });
    // floor of the board and of the lane, pyramids, dispenser and score panel
    for (j = 0; j <= 9; j++) {
      var full = !(j <= 4 || j >= 7), i0 = full ? 0 : 3, i1 = full ? 15 : 7;
      for (i = i0; i <= i1; i++) { var t = R(4), u = R(3); blit(40 * t, 40 * u, 40, 40, 40 * i, 40 * j); }
      blit(0, 200, 60, 50, 10, 220);
      blit(0, 250, 68, 50, 556, 220);
      blit(0, 300, 48, 33, 201, 12);
      blit(160, 220, 84, 124, 440, 20);
    }
    // pins with their shadow
    for (i = 0; i <= 5; i++) for (j = 0; j <= i + 2; j++) blit(60, 200, 8, 8, 158 + (5 - i) * 12 + (j - 1) * 24, 60 + 24 * i);
  }

  function buildBackground(ctx, sheet, random) {
    backgroundOps(random || Math.random, function (sx, sy, w, h, dx, dy) { ctx.drawImage(sheet, sx, sy, w, h, dx, dy, w, h); });
  }

  // ---------- drawing (WM_PAINT of the original) ----------

  var PANEL_FONT = 'bold 15px "Times New Roman", Times, serif';
  var BOX_FONT = '13px Arial, Helvetica, sans-serif';

  // opts: { cursor: {x, y} or null, panel: true, scores: [{name, score}] (score table) }
  function render(g, sheet, bg, sim, opts) {
    opts = opts || {};
    var S = sim.S, ch = S.chose;
    function spr(sx, sy, w, h, dx, dy) { g.drawImage(sheet, sx, sy, w, h, Math.round(dx), Math.round(dy), w, h); }
    g.imageSmoothingEnabled = false;
    g.drawImage(bg, 0, 0);
    var r, c, k;
    if (S.over || S.done) {
      for (r = 1; r <= ROWS; r++) spr(74, 200, 24, 7, S.bars[r].x, S.bars[r].y);
      spr(320, S.worm.frame * 24, 24, 24, S.worm.x, S.worm.y);
      spr(0, 210, 40, 24, 575, 230);
    } else {
      // chose and its puff of smoke
      spr(ch.srcX, ch.frame * ch.h, ch.w, ch.h, ch.x, ch.y);
      if (ch.puff) spr(ch.puffFrame * 16, 344 + ch.puffVar, 16, 8, ch.puffX, ch.puffY);
      spr(0, 210, 40, 24, 575, 230);
      spr(16, 210, 24, 24, 26, 230);
      // marbles with their shadow
      S.marbles.forEach(function (m) {
        spr(760, 360, 20, 20, m.x + 4, m.y + 4);
        spr(m.srcX, m.frame * 20, 20, 20, m.x, m.y);
      });
      // pin heads
      for (r = 0; r <= 5; r++) for (k = 0; k <= r + 2; k++) spr(68, 200, 4, 4, 158 + (5 - r) * 12 + (k - 1) * 24, 60 + 24 * r);
      for (r = 1; r <= ROWS; r++) spr(74, 200, 24, 7, S.bars[r].x, S.bars[r].y);
      // dispenser grate, then the next marble while marbles are falling
      spr(9, 304, 24, 20, DROP_X, DROP_Y);
      if (S.marbles.length > 0) spr(520 + 40 * S.next, 0, 20, 20, DROP_X, 14);
      // columns
      for (c = 0; c < NCOLS; c++) {
        var col = S.cols[c];
        for (k = col.h; k >= 1; k--) {
          var y = COL_Y - k * 20;
          if (col.clear === 0) {
            spr(760, 360, 20, 20, col.x + 4, y + 4);
            spr(520 + 40 * col.colors[k], 0, 20, 20, col.x, y);
          } else spr(160 + 20 * (col.clear - 1), 80 + 20 * col.colors[k], 20, 20, col.x, y);
        }
        if (col.vanish) spr(520 + 20 * col.vframe, 360, 20, 40, col.x, COL_Y - (col.h + 2) * 20);
        spr(60, 208, 16, 10, col.x + 6, COL_Y);
      }
    }
    if (opts.panel !== false) {
      g.font = PANEL_FONT; g.fillStyle = '#380000'; g.textBaseline = 'top'; g.textAlign = 'left';
      g.fillText(String(S.startLevel), 489, 42);
      g.fillText(String(ch.lives), 476, 62);
      g.fillText(String(S.vitesse), 489, 82);
      g.fillText(String(S.score), 482, 102);
    }
    if (S.done && opts.scores) {
      g.fillStyle = '#fff'; g.fillRect(130, 180, 178, 204);
      g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(130.5, 180.5, 177, 203);
      g.font = BOX_FONT; g.fillStyle = '#300000'; g.textBaseline = 'top';
      g.fillText('La partie est terminée.', 145, 190);
      g.fillText('MEILLEURS SCORES', 150, 220);
      g.fillText('Nom du joueur', 140, 245);
      g.fillText('Score', 263, 245);
      opts.scores.slice(0, 5).forEach(function (e, i) {
        g.fillText(String(e.name), 140, 270 + 20 * i);
        g.fillText(String(e.score), 263, 270 + 20 * i);
      });
    }
    if (opts.cursor && opts.cursor.x < 620 && opts.cursor.y < 380) spr(112, 160, 20, 20, opts.cursor.x, opts.cursor.y);
  }

  var api = {
    create: create, buildBackground: buildBackground, backgroundOps: backgroundOps, render: render,
    TICK: TICK, W: W, H: H, ROWS: ROWS, NCOLS: NCOLS, SND: SND, BOOST_SND: BOOST_SND,
    barBase: barBase, barY: barY, colX: colX, COL_Y: COL_Y, DROP_X: DROP_X, DROP_Y: DROP_Y, CHOSE_Y: CHOSE_Y
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StackSim = api;
})(this);
