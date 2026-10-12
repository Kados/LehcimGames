/*
 * Agora - browser port of Lehcim Noil's Windows 3.x game.
 * Player against the computer on a 6x6 wooden board drawn in perspective
 * with the original wood textures (canvas 2D, texture mapping by triangles).
 * Rules and AI live in rules.js (AgoraRules).
 *
 * Sections: assets, camera / projection, drawing, game flow, input, intro.
 */
(function () {
  'use strict';

  var R = window.AgoraRules, N = R.N;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var statusEl = document.getElementById('status');
  var A = 'assets/';

  // ---------- Assets ----------

  var tex = {}, sheet = null, bg = null;
  var TEX_IDS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
  // Text sprites of 39.png (key colour rgb(250,250,250)).
  var SPR = {
    over: [908, 246, 286, 27],      // PARTIE TERMINEE
    yourTurn: [925, 292, 243, 26],  // A TOI DE JOUER
    incomplete1: [912, 321, 258, 21], incomplete2: [1004, 341, 193, 17], // UNE PILE EST INCOMPLETE. / TERMINE LA !
    impossible1: [912, 362, 210, 17], impossible2: [1040, 381, 150, 17]  // POSITION IMPOSSIBLE ! / RECOMMENCE ...
  };
  // Intro frames (300x80 each): text dissolving, dots, then the AGORA logo.
  var FRAMES = [];
  (function () {
    var k;
    for (k = 0; k < 5; k++) FRAMES.push([0, 80 * k]);
    for (k = 0; k < 5; k++) FRAMES.push([300, 80 * k]);
    for (k = 0; k < 5; k++) FRAMES.push([600, 80 * k]);
    for (k = 0; k < 3; k++) FRAMES.push([900, 80 * k]);
  })();

  // ---------- Sounds (guesses from length/shape of the original WAVE resources) ----------
  var SND = { pick: A + 'sounds/3.wav', drop: A + 'sounds/6.wav', capture: A + 'sounds/13.wav', prison: A + 'sounds/7.wav',
    revolt: A + 'sounds/8.wav', bad: A + 'sounds/2.wav', intro: A + 'sounds/4.wav', win: A + 'sounds/11.wav', lose: A + 'sounds/12.wav' };

  // ---------- Camera / projection ----------

  var DEG = Math.PI / 180;
  var cam = { yaw: -25 * DEG, pitch: 48 * DEG, yawT: -25 * DEG, pitchT: 48 * DEG, dist: 13, f: 570, cx: W / 2, cy: 198 };
  var eye, fwd, right, up; // camera frame, updated by setupCamera()
  function setupCamera() {
    var cp = Math.cos(cam.pitch);
    eye = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw)];
    var target = [0, -0.3, 0];
    fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
    right = norm(cross(fwd, [0, 1, 0]));
    up = cross(right, fwd);
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
  function proj(x, y, z) {
    var dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
    var cz = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    var cx = dx * right[0] + dy * right[1] + dz * right[2];
    var cy = dx * up[0] + dy * up[1] + dz * up[2];
    return { x: cam.cx + cam.f * cx / cz, y: cam.cy - cam.f * cy / cz };
  }
  function distTo(x, z) { return Math.hypot(x - eye[0], z - eye[2]); }

  // ---------- Texture mapping ----------

  // Draws the source rectangle of img onto a projected quad (TL, TR, BR, BL), as two affine triangles.
  function texQuad(img, s, P) {
    var x0 = s[0], y0 = s[1], x1 = s[0] + s[2], y1 = s[1] + s[3];
    texTri(img, x0, y0, x1, y0, x0, y1, P[0], P[1], P[3]);
    texTri(img, x1, y1, x0, y1, x1, y0, P[2], P[3], P[1]);
  }
  function texTri(img, s0x, s0y, s1x, s1y, s2x, s2y, d0, d1, d2) {
    var den = (s1x - s0x) * (s2y - s0y) - (s2x - s0x) * (s1y - s0y);
    if (!den) return;
    var a = ((d1.x - d0.x) * (s2y - s0y) - (d2.x - d0.x) * (s1y - s0y)) / den;
    var c = ((d2.x - d0.x) * (s1x - s0x) - (d1.x - d0.x) * (s2x - s0x)) / den;
    var b = ((d1.y - d0.y) * (s2y - s0y) - (d2.y - d0.y) * (s1y - s0y)) / den;
    var d = ((d2.y - d0.y) * (s1x - s0x) - (d1.y - d0.y) * (s2x - s0x)) / den;
    var e = d0.x - a * s0x - c * s0y, f = d0.y - b * s0x - d * s0y;
    // clip slightly enlarged triangle to hide seams
    var gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
    ctx.save();
    ctx.beginPath();
    [d0, d1, d2].forEach(function (p, i) {
      var vx = p.x - gx, vy = p.y - gy, l = Math.hypot(vx, vy) || 1, k = (l + 0.8) / l;
      if (i) ctx.lineTo(gx + vx * k, gy + vy * k); else ctx.moveTo(gx + vx * k, gy + vy * k);
    });
    ctx.closePath(); ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  function polyPath(P) { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); for (var i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y); ctx.closePath(); }

  // ---------- Board geometry ----------

  var PH = 0.17, PS = 0.39;          // piece thickness, half size
  var BASE = 3.18, BASE_H = 0.55;    // half width of the wooden base, its thickness
  var LIGHT = norm([-0.55, 0, 0.83]); // horizontal light direction for side shading
  var sqTex = [];                    // texture (id + half) of each square
  function cellX(i) { return (i % N) - 2.5; }
  function cellZ(i) { return ((i / N) | 0) - 2.5; }
  (function () {
    var seed = 7;
    for (var i = 0; i < N * N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var r = (i / N) | 0, c = i % N, inner = r > 0 && r < 5 && c > 0 && c < 5;
      sqTex.push({ id: (inner ? 9 : 6) + (seed >> 8) % 3, half: (seed >> 4) & 1 });
    }
  })();
  // Shade 0 (light) .. n-1 (dark) of a vertical face with outward normal (nx, nz).
  function shade(nx, nz, n) {
    var d = nx * LIGHT[0] + nz * LIGHT[2]; // -1..1
    return Math.max(0, Math.min(n - 1, Math.floor((1 - d) / 2 * n)));
  }
  function faceVisible(px, pz, nx, nz) { return nx * (eye[0] - px) + nz * (eye[2] - pz) > 0; }

  // Draws a box [x0,x1]x[y0,y1]x[z0,z1]: visible sides then top.
  // sideTex(shadeIndex) -> [img, srcRect]; topTex -> [img, srcRect] (or null).
  function drawBox(x0, x1, y0, y1, z0, z1, sideTex, nShades, topTex) {
    var faces = [
      [0, -1, [x1, z0], [x0, z0]], // back (-z)
      [0, 1, [x0, z1], [x1, z1]],  // front (+z)
      [-1, 0, [x0, z0], [x0, z1]], // left (-x)
      [1, 0, [x1, z1], [x1, z0]]   // right (+x)
    ];
    faces.forEach(function (fc) {
      var mx = (fc[2][0] + fc[3][0]) / 2, mz = (fc[2][1] + fc[3][1]) / 2;
      if (!faceVisible(mx, mz, fc[0], fc[1])) return;
      var t = sideTex(shade(fc[0], fc[1], nShades));
      texQuad(t[0], t[1], [proj(fc[2][0], y1, fc[2][1]), proj(fc[3][0], y1, fc[3][1]), proj(fc[3][0], y0, fc[3][1]), proj(fc[2][0], y0, fc[2][1])]);
    });
    if (topTex) texQuad(topTex[0], topTex[1], topQuad(x0, x1, z0, z1, y1));
  }
  function topQuad(x0, x1, z0, z1, y) { return [proj(x0, y, z0), proj(x1, y, z0), proj(x1, y, z1), proj(x0, y, z1)]; }

  function pieceTop(c) { return [tex[c ? 31 : 27], [0, 0, 128, 64]]; }
  function pieceSide(c) { return function (s) { return [tex[(c ? 34 : 28) + s], [0, 0, 256, 10]]; }; }
  // One piece at (x, z), bottom at y.
  function drawPiece(x, z, y, c) {
    drawBox(x - PS, x + PS, y, y + PH, z - PS, z + PS, pieceSide(c), 3, pieceTop(c));
  }

  // ---------- Game state ----------

  var pos = R.initial();
  var human = 0;              // colour of the player (the starter has white)
  var level = 2;
  var phase = 'intro';        // intro | fly | play | anim | think | setup | over
  var hover = -1, sel = -1, selPrison = false, dragging = false, prisonToggle = false;
  var anim = null;            // current piece animation
  var flyers = null;          // pieces falling on the board at the start
  var banner = null;          // {spr:[...], until} temporary sprite message
  var floatText = null;       // {text, until}
  var history = {}, plies = 0, result = '';
  var setupStacks = null, setupCount = 0, setupOpen = -1;
  var lastMove = -1;

  function stacksOf(p) { var s = []; for (var i = 0; i < N * N; i++) s.push(p.stack(i)); return s; }

  // ---------- Drawing ----------

  var pickCols = []; // [{sq, polys}] nearest first, rebuilt every frame

  function draw(now) {
    // smooth camera
    cam.yaw += (cam.yawT - cam.yaw) * 0.2; cam.pitch += (cam.pitchT - cam.pitch) * 0.2;
    if (Math.abs(cam.yawT - cam.yaw) < 1e-4) cam.yaw = cam.yawT;
    if (Math.abs(cam.pitchT - cam.pitch) < 1e-4) cam.pitch = cam.pitchT;
    setupCamera();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    if (phase === 'intro') { drawIntro(now); return; }

    // wooden base
    drawBox(-BASE, BASE, -BASE_H, 0, -BASE, BASE, function (s) { return [tex[15 + s], [0, 0, 1024, 16]]; }, 4, [tex[6], [0, 0, 128, 64]]);

    var stacks = setupStacks || stacksOf(pos);
    var moveSet = sel >= 0 ? R.moves(pos, sel) : [];
    // squares
    for (var i = 0; i < N * N; i++) {
      var x = cellX(i), z = cellZ(i), t = sqTex[i];
      var id = t.id, src = [t.half * 128, 0, 128, 64];
      if (i === sel) { id = 33; src = [0, 0, 128, 64]; }
      else if (i === hover && phase !== 'over') { id = 32; src = [0, 0, 128, 64]; }
      texQuad(tex[id], src, topQuad(x - 0.49, x + 0.49, z - 0.49, z + 0.49, 0));
    }
    // last move marker and possible targets on the board level
    if (lastMove >= 0 && phase !== 'setup') { outlineSquare(R.mFrom(lastMove), 0, 'rgba(255,200,80,.55)', 1.5); }

    // columns sorted far to near
    var order = [];
    for (i = 0; i < N * N; i++) order.push(i);
    order.sort(function (a, b) { return distTo(cellX(b), cellZ(b)) - distTo(cellX(a), cellZ(a)); });
    var items = order.map(function (i) { return { sq: i, d: distTo(cellX(i), cellZ(i)) }; });
    // animated / falling pieces are separate items
    var mover = anim ? animState(now) : null;
    if (mover && !mover.under) items.push({ mover: mover, d: distTo(mover.x, mover.z) - 0.01 });
    if (flyers) flyers.forEach(function (f) { var st = flyerState(f, now); if (st) items.push({ mover: st, d: distTo(st.x, st.z) - 0.01 }); });
    items.sort(function (a, b) { return b.d - a.d; });

    pickCols = [];
    items.forEach(function (it) {
      if (it.mover) { drawPiece(it.mover.x, it.mover.z, it.mover.y, it.mover.c); return; }
      var i = it.sq, s = stacks[i], x = cellX(i), z = cellZ(i), lift = 0;
      if (flyers) s = s.slice(0, landedCount(i, now));
      if (anim && i === anim.from) s = s.slice(0, s.length - 1);
      if (mover && mover.under && i === anim.to) { drawPiece(mover.x, mover.z, 0, mover.c); lift = mover.lift; }
      for (var k = 0; k < s.length; k++) drawPiece(x, z, lift + k * PH, s[k]);
      var topY = lift + s.length * PH;
      if (s.length) {
        if (i === sel) fillTop(i, topY, 'rgba(255,255,255,.6)', '#fff');
        else if (i === hover && phase !== 'over') fillTop(i, topY, 'rgba(255,255,170,.28)', '#ffe060');
      }
      pickCols.unshift({ sq: i, h: topY });
    });
    // possible targets of the selected piece
    if (sel >= 0) moveSet.forEach(function (m) {
      var k = R.mKind(m), pr = k === R.PRISON;
      if (pr !== selPrison) return;
      var t = R.mTo(m);
      outlineSquare(t, stacks[t].length * PH, pr ? 'rgba(120,190,255,.95)' : 'rgba(120,255,120,.95)', 2);
    });

    drawOverlay(now);
  }
  function fillTop(i, y, fill, stroke) {
    var x = cellX(i), z = cellZ(i), P = topQuad(x - PS, x + PS, z - PS, z + PS, y);
    polyPath(P); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }
  function outlineSquare(i, y, color, w) {
    var x = cellX(i), z = cellZ(i), d = y ? PS + 0.03 : 0.45, P = topQuad(x - d, x + d, z - d, z + d, y);
    polyPath(P); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  function sprite(r, x, y) { if (sheet) ctx.drawImage(sheet, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); }

  function drawOverlay(now) {
    // AGORA logo (last intro frame) small, top left
    if (sheet) ctx.drawImage(sheet, 900, 160, 300, 80, 6, 4, 150, 40);
    // piece counts
    var c = setupStacks ? stackCounts(setupStacks) : R.counts(pos);
    ctx.font = 'bold 13px Tahoma, Verdana, sans-serif'; ctx.textBaseline = 'alphabetic';
    var lines = [
      ['Blancs' + (human === 0 ? ' (toi)' : ' (ordinateur)'), c.free[0], c.prisoners[0], '#ffe9d0'],
      ['Noirs' + (human === 1 ? ' (toi)' : ' (ordinateur)'), c.free[1], c.prisoners[1], '#e0a070']
    ];
    lines.forEach(function (l, k) {
      var y = H - 26 + k * 17;
      shadowText(l[0] + ' : ' + l[1] + ' libre' + (l[1] > 1 ? 's' : '') + ', ' + l[2] + ' prisonnier' + (l[2] > 1 ? 's' : ''), 10, y, l[3], 'left');
    });
    if (phase === 'setup') shadowText('Nouvelle position : ' + setupCount + ' / 16 pièces', W - 10, H - 9, '#fff', 'right');
    if (pos.side === human && phase === 'play' && !banner) sprite(SPR.yourTurn, (W - SPR.yourTurn[2]) / 2, 10);
    if (phase === 'over') {
      sprite(SPR.over, (W - SPR.over[2]) / 2, 8);
      shadowText(result, W / 2, 54, '#fff', 'center');
    }
    if (phase === 'think') shadowText("L'ordinateur réfléchit...", W - 10, H - 9, '#ccd', 'right');
    if (banner) {
      if (now > banner.until) { banner = null; if (bannerDone) { var f = bannerDone; bannerDone = null; f(); } }
      else {
        // two lines laid out as in the original sheet (second line shifted right)
        var r0 = banner.spr[0], bx = (W - r0[2]) / 2;
        banner.spr.forEach(function (r, k) { sprite(r, bx + r[0] - r0[0] + (k ? 30 : 0), 8 + r[1] - r0[1] + k * 3); });
      }
    }
    if (floatText) {
      if (now > floatText.until) floatText = null;
      else { ctx.font = 'bold 26px "Times New Roman", serif'; shadowText(floatText.text, W / 2, 80, '#ff5030', 'center'); }
    }
  }
  var bannerDone = null;
  // Counts of free pieces / prisoners from raw stacks (setup mode).
  function stackCounts(st) {
    var r = { free: [0, 0], prisoners: [0, 0] };
    st.forEach(function (s) { if (!s.length) return; var c = s[s.length - 1]; s.forEach(function (p) { if (p === c) r.free[p]++; else r.prisoners[p]++; }); });
    return r;
  }
  function shadowText(t, x, y, color, align) {
    ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillText(t, x + 1, y + 1); ctx.fillStyle = color; ctx.fillText(t, x, y);
  }

  // ---------- Animations ----------

  // Piece moving from anim.from to anim.to. Returns {x,y,z,c,under,lift}.
  function animState(now) {
    var t = Math.min(1, (now - anim.t0) / anim.dur), a = anim;
    var x0 = cellX(a.from), z0 = cellZ(a.from), x1 = cellX(a.to), z1 = cellZ(a.to);
    var y0 = (a.hFrom - 1) * PH;
    if (a.kind !== R.PRISON) {
      var y1 = a.hTo * PH, e = t * t * (3 - 2 * t);
      var hop = 0.7 + Math.max(0, y1 - y0) * 0.5;
      return { x: x0 + (x1 - x0) * e, z: z0 + (z1 - z0) * e, y: y0 + (y1 - y0) * e + Math.sin(Math.PI * t) * hop, c: a.c };
    }
    // prisoner: hop to the foot of the target stack, then slide under it
    var dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz), sx = x1 - dx / dl * 0.62, sz = z1 - dz / dl * 0.62;
    if (t < 0.55) {
      var u = t / 0.55, eu = u * u * (3 - 2 * u);
      return { x: x0 + (sx - x0) * eu, z: z0 + (sz - z0) * eu, y: y0 * (1 - eu) + Math.sin(Math.PI * u) * 0.5, c: a.c };
    }
    var v = (t - 0.55) / 0.45;
    var lift = Math.min(1, v * 2.5) * PH;
    return { x: sx + (x1 - sx) * v, z: sz + (z1 - sz) * v, y: 0, c: a.c, under: true, lift: lift };
  }

  // Start of game: the pieces fall from the sky (like the original).
  function startFly(p, then) {
    flyers = []; var k = 0, t0 = performance.now() + 200;
    for (var i = 0; i < N * N; i++) {
      var s = p.stack(i);
      for (var j = 0; j < s.length; j++) {
        flyers.push({ sq: i, level: j, c: s[j], t0: t0 + k * 110, dur: 650, ox: Math.sin(k * 2.1) * 3, oz: Math.cos(k * 1.7) * 3 - 2, landed: false });
        k++;
      }
    }
    flyersDone = then;
    phase = 'fly';
  }
  var flyersDone = null;
  function flyerState(f, now) {
    var t = (now - f.t0) / f.dur;
    if (t < 0 || t >= 1) return null;
    var e = 1 - (1 - t) * (1 - t);
    var x = cellX(f.sq), z = cellZ(f.sq), y = f.level * PH;
    return { x: x + f.ox * (1 - e), z: z + f.oz * (1 - e), y: y + 7 * (1 - e), c: f.c };
  }
  function landedCount(i, now) {
    var n = 0;
    flyers.forEach(function (f) { if (f.sq === i && now >= f.t0 + f.dur) n++; });
    return n;
  }
  function updateFlyers(now) {
    if (!flyers) return;
    var all = true;
    flyers.forEach(function (f) {
      if (now >= f.t0 + f.dur) { if (!f.landed) { f.landed = true; Lehcim.play('drop', 0.4); } }
      else all = false;
    });
    if (all) { flyers = null; var f = flyersDone; flyersDone = null; if (f) f(); }
  }

  // ---------- Game flow ----------

  function setStatus(t) { statusEl.textContent = t; }

  function newGame(p) {
    human = document.getElementById('starter').value === 'human' ? 0 : 1;
    pos = p || R.initial(); pos.side = 0;
    sel = -1; anim = null; banner = null; floatText = null; lastMove = -1; setupStacks = null;
    history = {}; plies = 0; result = '';
    history[pos.key()] = 1;
    if (p) { phase = 'play'; nextTurn(); return; }
    setStatus('');
    startFly(pos, nextTurn);
  }

  function nextTurn() {
    var ms = R.moves(pos);
    if (!ms.length) {
      var winner = 1 - pos.side;
      endGame(winner === human ? 'Bravo, tu as gagné !' : "L'ordinateur a gagné !", winner === human);
      return;
    }
    if ((history[pos.key()] || 0) >= 3) { endGame('Partie nulle (position répétée trois fois).', null); return; }
    if (plies >= 400) { endGame('Partie nulle (400 coups).', null); return; }
    if (pos.side === human) {
      phase = 'play';
      setStatus('A toi de jouer (' + (human === 0 ? 'blancs' : 'noirs') + ')');
    } else {
      phase = 'think';
      setStatus("L'ordinateur réfléchit...");
      setTimeout(function () {
        if (phase !== 'think') return;
        var m = R.think(pos, level);
        doMove(m);
      }, 60);
    }
  }

  function endGame(text, humanWon) {
    phase = 'over'; sel = -1; result = text; setStatus(text);
    if (humanWon === true) Lehcim.play('win'); else if (humanWon === false) Lehcim.play('lose');
  }

  function doMove(m) {
    var f = R.mFrom(m), t = R.mTo(m);
    anim = { from: f, to: t, kind: R.mKind(m), c: pos.col[f], hFrom: pos.height(f), hTo: pos.height(t), t0: performance.now(), dur: R.mKind(m) === R.PRISON ? 750 : 520, move: m };
    sel = -1; dragging = false;
    phase = 'anim';
    Lehcim.play('pick', 0.5);
  }
  function finishMove() {
    var m = anim.move, info = {}, kind = R.mKind(m);
    anim = null;
    R.play(pos, m, info);
    lastMove = m; plies++;
    var k = pos.key(); history[k] = (history[k] || 0) + 1;
    if (kind === R.CAPTURE) Lehcim.play('capture'); else if (kind === R.PRISON) Lehcim.play('prison'); else Lehcim.play('drop');
    if (info.revolt) { floatText = { text: 'C\'est la révolution !', until: performance.now() + 1600 }; Lehcim.play('revolt'); }
    else if (info.lost) { floatText = { text: 'Les prisonniers reprennent la pile !', until: performance.now() + 1600 }; Lehcim.play('revolt'); }
    nextTurn();
  }

  // ---------- Input ----------

  function pick(px, py) {
    for (var k = 0; k < pickCols.length; k++) {
      var c = pickCols[k], x = cellX(c.sq), z = cellZ(c.sq);
      if (inPoly(px, py, topQuad(x - 0.5, x + 0.5, z - 0.5, z + 0.5, 0))) return c.sq;
      if (c.h > 0) {
        var pts = [];
        [0, c.h].forEach(function (y) { topQuad(x - PS, x + PS, z - PS, z + PS, y).forEach(function (p) { pts.push(p); }); });
        if (inPoly(px, py, hull(pts))) return c.sq;
      }
    }
    return -1;
  }
  function inPoly(x, y, P) {
    var inside = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      if (((P[i].y > y) !== (P[j].y > y)) && (x < (P[j].x - P[i].x) * (y - P[i].y) / (P[j].y - P[i].y) + P[i].x)) inside = !inside;
    }
    return inside;
  }
  function hull(pts) { // monotone chain
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], hi = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], pts[i]) <= 0) hi.pop(); hi.push(pts[i]); }
    lo.pop(); hi.pop(); return lo.concat(hi);
  }

  function findMove(from, to, prison) {
    var ms = R.moves(pos, from);
    for (var k = 0; k < ms.length; k++) {
      var m = ms[k];
      if (R.mTo(m) === to && (R.mKind(m) === R.PRISON) === prison) return m;
    }
    return -1;
  }
  function canStart(sq, prison) {
    return R.moves(pos, sq).some(function (m) { return (R.mKind(m) === R.PRISON) === prison; });
  }
  function tryMove(to, prison) {
    var m = findMove(sel, to, prison);
    if (m >= 0) { setPrisonToggle(false); doMove(m); return true; }
    return false;
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = Lehcim.canvasPos(canvas, e);
    if (phase === 'intro') { endIntro(); return; }
    var sq = pick(p.x, p.y); hover = sq;
    var right = e.button === 2;
    if (phase === 'setup') { setupClick(sq, right ? 1 : 0); return; }
    if (phase !== 'play' || sq < 0) return;
    var prison = right || prisonToggle;
    // second click of a click-click move
    if (sel >= 0 && sq !== sel) {
      if (tryMove(sq, prison || selPrison)) return;
    }
    if (pos.col[sq] === human) {
      if (canStart(sq, prison)) {
        sel = sq; selPrison = prison; dragging = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        Lehcim.play('pick', 0.4);
      } else { sel = -1; Lehcim.play('bad', 0.4); }
    } else sel = -1;
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = Lehcim.canvasPos(canvas, e);
    hover = phase === 'intro' ? -1 : pick(p.x, p.y);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    var p = Lehcim.canvasPos(canvas, e), sq = pick(p.x, p.y);
    if (phase !== 'play' || sel < 0 || sq === sel || sq < 0) return; // stay selected: click-click mode
    if (!tryMove(sq, selPrison)) { sel = -1; Lehcim.play('bad', 0.4); }
  });
  canvas.addEventListener('pointerleave', function () { if (!dragging) hover = -1; });

  function rotate(dy, dp) {
    cam.yawT += dy * 15 * DEG;
    cam.pitchT = Math.max(18 * DEG, Math.min(89 * DEG, cam.pitchT + dp * 6 * DEG));
  }
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var k = e.key;
    if (k === 'ArrowLeft') rotate(1, 0); else if (k === 'ArrowRight') rotate(-1, 0);
    else if (k === 'ArrowUp') rotate(0, 1); else if (k === 'ArrowDown') rotate(0, -1);
    else if (k === 'Escape') { sel = -1; return; }
    else return;
    e.preventDefault();
  });
  [['rotL', 1, 0], ['rotR', -1, 0], ['tiltU', 0, 1], ['tiltD', 0, -1]].forEach(function (b) {
    document.getElementById(b[0]).addEventListener('click', function (e) { rotate(b[1], b[2]); e.currentTarget.blur(); });
  });

  var prisonBtn = document.getElementById('prison');
  function setPrisonToggle(v) { prisonToggle = v; prisonBtn.classList.toggle('on', v); if (sel >= 0 && !dragging) selPrison = v; }
  prisonBtn.addEventListener('click', function () { setPrisonToggle(!prisonToggle); prisonBtn.blur(); });

  document.getElementById('new').addEventListener('click', function (e) { e.currentTarget.blur(); if (phase === 'intro') endIntro(true); else newGame(); });
  document.getElementById('resign').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (phase === 'play' || phase === 'think' || phase === 'anim') { anim = null; endGame("Tu as abandonné. L'ordinateur a gagné !", false); }
  });
  var levelSel = document.getElementById('level');
  try { var lv = localStorage.getItem('lehcim.agora.level'); if (lv) levelSel.value = lv; } catch (e) { /* ignore */ }
  level = +levelSel.value;
  levelSel.addEventListener('change', function () { level = +levelSel.value; try { localStorage.setItem('lehcim.agora.level', levelSel.value); } catch (e) { /* ignore */ } levelSel.blur(); });
  document.getElementById('starter').addEventListener('change', function (e) {
    e.currentTarget.blur();
    if (phase !== 'setup' && phase !== 'intro') Lehcim.message('Le changement sera pris en compte à la prochaine partie (celui qui commence a les blancs).');
  });

  // ---------- Nouvelle position ----------

  document.getElementById('setup').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (phase === 'intro') endIntro(false);
    startSetup();
  });
  function startSetup() {
    human = document.getElementById('starter').value === 'human' ? 0 : 1;
    setupStacks = []; for (var i = 0; i < N * N; i++) setupStacks.push([]);
    setupCount = 0; setupOpen = -1; sel = -1; anim = null; flyers = null; lastMove = -1; banner = null; floatText = null; result = '';
    phase = 'setup';
    setStatus('Clic gauche : pièce blanche, clic droit : pièce noire');
  }
  // Stack state: 'ok', 'incomplete' (prisoners in majority, more pieces of the top colour needed) or 'bad'.
  function stackState(s) {
    if (!s.length) return 'ok';
    if (!R.Pos.fromStacks([s])) {
      var c = s[s.length - 1], k = s.length - 1, t = 0;
      while (k >= 0 && s[k] === c) { t++; k--; }
      for (var j = k; j >= 0; j--) if (s[j] === c) return 'bad';
      return 'incomplete';
    }
    return 'ok';
  }
  function setupClick(sq, c) {
    if (sq < 0 || banner) return;
    if (setupOpen >= 0 && sq !== setupOpen) {
      banner = { spr: [SPR.incomplete1, SPR.incomplete2], until: performance.now() + 1800 };
      Lehcim.play('bad', 0.5); return;
    }
    setupStacks[sq].push(c); setupCount++;
    Lehcim.play('drop', 0.5);
    var st = stackState(setupStacks[sq]);
    setupOpen = st === 'incomplete' ? sq : -1;
    if (st === 'bad' || (setupCount >= 16 && st !== 'ok')) { impossible(); return; }
    if (setupCount >= 16) {
      var p = R.Pos.fromStacks(setupStacks, 0);
      if (!p) { impossible(); return; }
      newGame(p);
    }
  }
  function impossible() {
    banner = { spr: [SPR.impossible1, SPR.impossible2], until: performance.now() + 2000 };
    Lehcim.play('bad', 0.6);
    bannerDone = startSetup;
  }

  // ---------- Intro: "LEHCIM NOIL PRESENTE" dissolves into the AGORA logo ----------

  var introT0 = 0, introDone = false;
  function frameAt(t) {
    // hold the title, then 16 quick frames, then the logo sparkles
    if (t < 1400) return 0;
    var k = Math.floor((t - 1400) / 110);
    if (k < 14) return 1 + k;
    return 15 + Math.floor((t - 1400 - 14 * 110) / 160) % 3;
  }
  function drawIntro(now) {
    var t = now - introT0, f = FRAMES[frameAt(t)];
    if (sheet) ctx.drawImage(sheet, f[0], f[1], 300, 80, (W - 450) / 2, 110, 450, 120);
    ctx.font = '13px Tahoma, Verdana, sans-serif';
    if (t > 3600) shadowText('Clique pour commencer', W / 2, 300, '#ccd', 'center');
    if (t > 5200) endIntro();
  }
  function endIntro(start) {
    if (introDone) return;
    introDone = true;
    if (start === false) return;
    newGame();
  }

  // ---------- Main loop ----------

  function loop(now) {
    if (anim && now - anim.t0 >= anim.dur) finishMove();
    updateFlyers(now);
    draw(now);
    requestAnimationFrame(loop);
  }

  Lehcim.initPage();
  setStatus('Chargement...');
  // sounds are decoded after the first user gesture (browser autoplay policy)
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  Promise.all([
    Promise.all(TEX_IDS.map(function (id) { return Lehcim.loadImage(A + id + '.png').then(function (im) { tex[id] = im; }); })),
    Lehcim.loadSheet(A + '39.png', [250, 250, 250]).then(function (s) { sheet = s; }),
    Lehcim.loadImage(A + '40.png').then(function (im) { bg = im; })
  ]).then(function () {
    setStatus('');
    introT0 = performance.now();
    phase = 'intro';
    requestAnimationFrame(loop);
  }).catch(function (e) { setStatus('Erreur de chargement'); console.error(e); });

  // For automated tests.
  window.AgoraGame = {
    state: function () { return { phase: phase, side: pos.side, human: human, sel: sel, plies: plies, result: result, key: pos.key(), setupCount: setupCount }; },
    pos: function () { return pos; },
    pick: function (x, y) { return pick(x, y); },
    screenOf: function (sq, y) { setupCamera(); return proj(cellX(sq), y || 0, cellZ(sq)); },
    topOf: function (sq) { setupCamera(); return proj(cellX(sq), pos.height(sq) * PH, cellZ(sq)); },
    skipIntro: function () { endIntro(); },
    setLevel: function (l) { level = l; }
  };
})();
