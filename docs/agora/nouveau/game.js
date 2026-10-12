/*
 * Agora (nouvelle version) - Lehcim Noil's Windows 3.x game, same rules and
 * same wooden textures, with a modern interface: side panel, undo, hint,
 * move history (A1-F6), camera presets, end of game summary.
 * The computer player (engine.js) runs in a Web Worker (ai-worker.js) and
 * falls back to the main thread when workers are not available (file://).
 *
 * Sections: settings, assets, camera / projection, drawing, game flow, AI,
 * input, side panel, intro, main loop.
 */
(function () {
  'use strict';

  var R = window.AgoraEngine, N = R.N;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var stage = document.getElementById('stage');
  var overlay = document.getElementById('overlay');
  var statusEl = document.getElementById('status'), subEl = document.getElementById('substatus');
  var A = '../assets/';
  var W = 640, H = 420, SCALE = 1;  // logical size of the drawing, backing store scale

  function $(id) { return document.getElementById(id); }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Settings (localStorage) ----------

  var KEY = 'lehcim.agora.nv';
  var settings = { level: 2, starter: 'human', speed: reduceMotion ? 'fast' : 'normal', coords: true, targets: true, info: false };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) for (var k in settings) if (sv[k] != null) settings[k] = sv[k]; } catch (e) { /* ignore */ }
  function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  function speedK() { return settings.speed === 'slow' ? 1.6 : settings.speed === 'fast' ? 0.5 : 1; }

  var record = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0] }; // wins, draws, losses per level
  try { var rv = JSON.parse(localStorage.getItem(KEY + '.record')); if (rv) record = rv; } catch (e) { /* ignore */ }
  function saveRecord() { try { localStorage.setItem(KEY + '.record', JSON.stringify(record)); } catch (e) { /* ignore */ } }

  // ---------- Assets ----------

  var tex = {}, sheet = null, bg = null;
  var TEX_IDS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
  var SPR = { // text sprites of 39.png
    over: [908, 246, 286, 27], yourTurn: [925, 292, 243, 26],
    incomplete1: [912, 321, 258, 21], incomplete2: [1004, 341, 193, 17],
    impossible1: [912, 362, 210, 17], impossible2: [1040, 381, 150, 17]
  };
  var FRAMES = [];
  (function () {
    var k;
    for (k = 0; k < 5; k++) FRAMES.push([0, 80 * k]);
    for (k = 0; k < 5; k++) FRAMES.push([300, 80 * k]);
    for (k = 0; k < 5; k++) FRAMES.push([600, 80 * k]);
    for (k = 0; k < 3; k++) FRAMES.push([900, 80 * k]);
  })();
  var SND = { pick: A + 'sounds/3.wav', drop: A + 'sounds/6.wav', capture: A + 'sounds/13.wav', prison: A + 'sounds/7.wav',
    revolt: A + 'sounds/8.wav', bad: A + 'sounds/2.wav', intro: A + 'sounds/4.wav', win: A + 'sounds/11.wav', lose: A + 'sounds/12.wav' };

  // ---------- Camera / projection ----------

  var DEG = Math.PI / 180;
  var VIEW0 = { yaw: -25 * DEG, pitch: 48 * DEG };
  var cam = { yaw: VIEW0.yaw, pitch: VIEW0.pitch, yawT: VIEW0.yaw, pitchT: VIEW0.pitch, dist: 13, f: 570, cx: W / 2, cy: 208 };
  var eye, fwd, right, up;
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

  // Responsive canvas: wider than tall on desktop, nearly square on phones;
  // the backing store follows devicePixelRatio so the 3D stays crisp.
  function fit() {
    var w = stage.clientWidth, narrow = w < 600;
    var aspect = narrow ? 0.82 : 0.64;
    var cssW = w, cssH = Math.round(w * aspect);
    if (!narrow) {
      var maxH = window.innerHeight - 100;
      if (cssH > maxH && maxH > 320) { cssH = maxH; cssW = Math.round(cssH / aspect); }
    }
    W = 640; H = Math.round(640 * aspect);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    SCALE = cssW / W * dpr;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    cam.cx = W / 2; cam.cy = H / 2 - (narrow ? 4 : 12);
    cam.f = narrow ? 720 : 630;
  }
  window.addEventListener('resize', fit);

  // ---------- Texture mapping ----------

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
    var gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
    ctx.save();
    ctx.beginPath();
    [d0, d1, d2].forEach(function (p, i) {
      var vx = p.x - gx, vy = p.y - gy, l = Math.hypot(vx, vy) || 1, k = (l + 0.8) / l;
      if (i) ctx.lineTo(gx + vx * k, gy + vy * k); else ctx.moveTo(gx + vx * k, gy + vy * k);
    });
    ctx.closePath(); ctx.clip();
    var S = SCALE;
    ctx.setTransform(a * S, b * S, c * S, d * S, e * S, f * S);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  function polyPath(P) { ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); for (var i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y); ctx.closePath(); }

  // ---------- Board geometry ----------

  var PH = 0.17, PS = 0.39;
  var BASE = 3.18, BASE_H = 0.55;
  var LIGHT = norm([-0.55, 0, 0.83]);
  var sqTex = [];
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
  function shade(nx, nz, n) {
    var d = nx * LIGHT[0] + nz * LIGHT[2];
    return Math.max(0, Math.min(n - 1, Math.floor((1 - d) / 2 * n)));
  }
  function faceVisible(px, pz, nx, nz) { return nx * (eye[0] - px) + nz * (eye[2] - pz) > 0; }
  function drawBox(x0, x1, y0, y1, z0, z1, sideTex, nShades, topTex) {
    var faces = [
      [0, -1, [x1, z0], [x0, z0]], [0, 1, [x0, z1], [x1, z1]],
      [-1, 0, [x0, z0], [x0, z1]], [1, 0, [x1, z1], [x1, z0]]
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
  function drawPiece(x, z, y, c) { drawBox(x - PS, x + PS, y, y + PH, z - PS, z + PS, pieceSide(c), 3, pieceTop(c)); }

  // ---------- Game state ----------

  var pos = R.initial();
  var human = 0;
  var phase = 'loading';     // loading | intro | start | fly | play | anim | think | setup | over
  var hover = -1, sel = -1, dragging = false, prisonMode = false, kbd = -1;
  var anim = null, flyers = null, flyersDone = null, banner = null, bannerDone = null, floatText = null;
  var lastMove = -1, hintMove = -1, result = '', overInfo = null;
  // Game record: snapshots[k] = position before ply k, plays[k] = {m, side, name, flags}.
  var snapshots = [], plays = [], repCount = {}, gameStart = 0, hintsUsed = 0, undosUsed = 0;
  var setupStacks = null, setupCount = 0, setupOpen = -1, setupColor = 0;
  var ambiguousTold = false;

  function stacksOf(p) { var s = []; for (var i = 0; i < N * N; i++) s.push(p.stack(i)); return s; }

  // ---------- Drawing ----------

  var pickCols = [];
  var COL_MOVE = 'rgba(80,230,95,.95)', COL_CAP = 'rgba(255,130,70,.98)', COL_PRI = 'rgba(100,175,255,.98)';

  function draw(now) {
    var k = reduceMotion ? 1 : 0.2;
    cam.yaw += (cam.yawT - cam.yaw) * k; cam.pitch += (cam.pitchT - cam.pitch) * k;
    if (Math.abs(cam.yawT - cam.yaw) < 1e-4) cam.yaw = cam.yawT;
    if (Math.abs(cam.pitchT - cam.pitch) < 1e-4) cam.pitch = cam.pitchT;
    setupCamera();
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = true;
    if (bg) { // cover
      var s = Math.max(W / 640, H / 400);
      ctx.drawImage(bg, (W - 640 * s) / 2, (H - 400 * s) / 2, 640 * s, 400 * s);
    } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    if (phase === 'intro' || phase === 'loading') { drawIntro(now); return; }

    drawBox(-BASE, BASE, -BASE_H, 0, -BASE, BASE, function (s) { return [tex[15 + s], [0, 0, 1024, 16]]; }, 4, [tex[6], [0, 0, 128, 64]]);
    if (settings.coords) drawCoords();

    var stacks = setupStacks || stacksOf(pos);
    var targets = {}; // square -> {move, cap, pri}
    if (sel >= 0 && settings.targets) R.moves(pos, sel).forEach(function (m) {
      var t = R.mTo(m), o = targets[t] || (targets[t] = {}), kd = R.mKind(m);
      if (kd === R.PRISON) o.pri = true; else if (kd === R.CAPTURE) o.cap = true; else o.move = true;
    });
    for (var i = 0; i < N * N; i++) {
      var x = cellX(i), z = cellZ(i), t = sqTex[i];
      var id = t.id, src = [t.half * 128, 0, 128, 64];
      if (i === sel) { id = 33; src = [0, 0, 128, 64]; }
      else if ((i === hover || i === kbd) && phase !== 'over') { id = 32; src = [0, 0, 128, 64]; }
      texQuad(tex[id], src, topQuad(x - 0.49, x + 0.49, z - 0.49, z + 0.49, 0));
    }
    if (lastMove >= 0 && phase !== 'setup' && !anim) {
      outlineSquare(R.mFrom(lastMove), 0, 'rgba(255,200,80,.7)', 2, true);
    }

    var order = [];
    for (i = 0; i < N * N; i++) order.push({ sq: i, d: distTo(cellX(i), cellZ(i)) });
    var mover = anim ? animState(now) : null;
    if (mover && !mover.under) order.push({ mover: mover, d: distTo(mover.x, mover.z) - 0.01 });
    if (flyers) flyers.forEach(function (f) { var st = flyerState(f, now); if (st) order.push({ mover: st, d: distTo(st.x, st.z) - 0.01 }); });
    order.sort(function (a, b) { return b.d - a.d; });

    pickCols = [];
    order.forEach(function (it) {
      if (it.mover) { drawPiece(it.mover.x, it.mover.z, it.mover.y, it.mover.c); return; }
      var i = it.sq, s = stacks[i], x = cellX(i), z = cellZ(i), lift = 0;
      if (flyers) s = s.slice(0, landedCount(i, now));
      if (anim && i === anim.from) s = s.slice(0, s.length - 1);
      if (mover && mover.under && i === anim.to) { drawPiece(mover.x, mover.z, 0, mover.c); lift = mover.lift; }
      for (var k = 0; k < s.length; k++) drawPiece(x, z, lift + k * PH, s[k]);
      var topY = lift + s.length * PH;
      if (s.length) {
        if (i === sel) fillTop(i, topY, 'rgba(255,255,255,.55)', '#fff');
        else if ((i === hover || i === kbd) && phase !== 'over') fillTop(i, topY, 'rgba(255,255,170,.28)', '#ffe060');
        if (lastMove >= 0 && i === R.mTo(lastMove) && phase !== 'setup' && !anim) outlineSquare(i, topY, 'rgba(255,200,80,.95)', 2.5);
      }
      pickCols.unshift({ sq: i, h: topY });
    });
    // targets of the selected piece
    Object.keys(targets).forEach(function (key) {
      var t = +key, o = targets[t], y = stacks[t].length * PH, dim = prisonMode ? !o.pri : false;
      if (o.pri && (o.cap || o.move)) {
        outlineSquare(t, y, prisonMode ? COL_PRI : (o.cap ? COL_CAP : COL_MOVE), 3);
        outlineSquare(t, y, prisonMode ? (o.cap ? COL_CAP : COL_MOVE) : COL_PRI, 1.5, false, 0.12);
      } else {
        ctx.globalAlpha = dim ? 0.45 : 1;
        outlineSquare(t, y, o.pri ? COL_PRI : o.cap ? COL_CAP : COL_MOVE, 3);
        ctx.globalAlpha = 1;
      }
    });
    if (hintMove >= 0 && phase === 'play') drawArrow(R.mFrom(hintMove), R.mTo(hintMove), stacks, now);
    if (kbd >= 0 && phase === 'play') outlineSquare(kbd, stacks[kbd].length * PH, 'rgba(255,255,255,.95)', 1.5, false, -0.05);
    drawOverlay(now);
  }
  function fillTop(i, y, fill, stroke) {
    var x = cellX(i), z = cellZ(i), P = topQuad(x - PS, x + PS, z - PS, z + PS, y);
    polyPath(P); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }
  function outlineSquare(i, y, color, w, board, inset) {
    var x = cellX(i), z = cellZ(i), d = (board || !y ? 0.45 : PS + 0.03) - (inset || 0), P = topQuad(x - d, x + d, z - d, z + d, y);
    polyPath(P); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }
  function drawArrow(f, t, stacks, now) {
    var a = proj(cellX(f), stacks[f].length * PH + 0.05, cellZ(f)), b = proj(cellX(t), stacks[t].length * PH + 0.05, cellZ(t));
    var pulse = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(now / 180);
    var ang = Math.atan2(b.y - a.y, b.x - a.x), L = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y); ctx.rotate(ang);
    ctx.globalAlpha = pulse; ctx.fillStyle = '#ffd84a'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(L - 14, -4); ctx.lineTo(L - 14, -10); ctx.lineTo(L, 0); ctx.lineTo(L - 14, 10); ctx.lineTo(L - 14, 4); ctx.lineTo(0, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawCoords() {
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    var zs = eye[2] >= 0 ? 1 : -1, xs = eye[0] >= 0 ? 1 : -1, D = 3.5;
    for (var k = 0; k < N; k++) {
      var p = proj(k - 2.5, 0, zs * D);
      shadowText('ABCDEF'.charAt(k), p.x, p.y, '#f3e2c4', 'center');
      var q = proj(xs * D, 0, k - 2.5);
      shadowText(String(N - k), q.x, q.y, '#f3e2c4', 'center');
    }
    ctx.textBaseline = 'alphabetic';
  }
  function sprite(r, x, y) { if (sheet) ctx.drawImage(sheet, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); }

  function drawOverlay(now) {
    if (sheet) ctx.drawImage(sheet, 900, 160, 300, 80, 6, 4, 150, 40);
    if (phase === 'setup') {
      ctx.font = 'bold 14px system-ui, sans-serif';
      shadowText('Nouvelle position : ' + setupCount + ' / 16 pièces', W - 10, H - 12, '#fff', 'right');
    }
    if (pos.side === human && phase === 'play' && !banner && plays.length < 2 && !overlayShown()) sprite(SPR.yourTurn, (W - SPR.yourTurn[2]) / 2, 10);
    if (phase === 'over') sprite(SPR.over, (W - SPR.over[2]) / 2, 8);
    if (phase === 'think') {
      ctx.font = 'bold 14px system-ui, sans-serif';
      var dots = '...'.slice(0, 1 + ((now / 350) | 0) % 3);
      shadowText("L'ordinateur réfléchit" + dots, W - 10, H - 12, '#dde', 'right');
    }
    if (banner) {
      if (now > banner.until) { banner = null; if (bannerDone) { var f = bannerDone; bannerDone = null; f(); } }
      else {
        var r0 = banner.spr[0], bx = (W - r0[2]) / 2;
        banner.spr.forEach(function (r, k) { sprite(r, bx + r[0] - r0[0] + (k ? 30 : 0), 8 + r[1] - r0[1] + k * 3); });
      }
    }
    if (floatText) {
      if (now > floatText.until) floatText = null;
      else {
        var a = Math.min(1, (floatText.until - now) / 300);
        ctx.globalAlpha = a; ctx.font = 'bold 26px "Times New Roman", serif';
        shadowText(floatText.text, W / 2, 80, '#ff5030', 'center'); ctx.globalAlpha = 1;
      }
    }
  }
  function shadowText(t, x, y, color, align) {
    ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillText(t, x + 1, y + 1); ctx.fillStyle = color; ctx.fillText(t, x, y);
  }

  // ---------- Animations ----------

  function animState(now) {
    var t = Math.min(1, (now - anim.t0) / anim.dur), a = anim;
    var x0 = cellX(a.from), z0 = cellZ(a.from), x1 = cellX(a.to), z1 = cellZ(a.to);
    var y0 = (a.hFrom - 1) * PH;
    if (a.kind !== R.PRISON) {
      var y1 = a.hTo * PH, e = t * t * (3 - 2 * t);
      var hop = 0.7 + Math.max(0, y1 - y0) * 0.5;
      return { x: x0 + (x1 - x0) * e, z: z0 + (z1 - z0) * e, y: y0 + (y1 - y0) * e + Math.sin(Math.PI * t) * hop, c: a.c };
    }
    var dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz), sx = x1 - dx / dl * 0.62, sz = z1 - dz / dl * 0.62;
    if (t < 0.55) {
      var u = t / 0.55, eu = u * u * (3 - 2 * u);
      return { x: x0 + (sx - x0) * eu, z: z0 + (sz - z0) * eu, y: y0 * (1 - eu) + Math.sin(Math.PI * u) * 0.5, c: a.c };
    }
    var v = (t - 0.55) / 0.45;
    return { x: sx + (x1 - sx) * v, z: sz + (z1 - sz) * v, y: 0, c: a.c, under: true, lift: Math.min(1, v * 2.5) * PH };
  }
  function startFly(p, then) {
    flyers = []; var k = 0, t0 = performance.now() + 150, step = 110 * speedK(), dur = 650 * Math.min(1, speedK());
    if (reduceMotion) { step = 0; dur = 1; }
    for (var i = 0; i < N * N; i++) {
      var s = p.stack(i);
      for (var j = 0; j < s.length; j++) {
        flyers.push({ sq: i, level: j, c: s[j], t0: t0 + k * step, dur: dur, ox: Math.sin(k * 2.1) * 3, oz: Math.cos(k * 1.7) * 3 - 2, landed: false });
        k++;
      }
    }
    flyersDone = then; phase = 'fly';
  }
  function flyerState(f, now) {
    var t = (now - f.t0) / f.dur;
    if (t < 0 || t >= 1) return null;
    var e = 1 - (1 - t) * (1 - t);
    return { x: cellX(f.sq) + f.ox * (1 - e), z: cellZ(f.sq) + f.oz * (1 - e), y: f.level * PH + 7 * (1 - e), c: f.c };
  }
  function landedCount(i, now) { var n = 0; flyers.forEach(function (f) { if (f.sq === i && now >= f.t0 + f.dur) n++; }); return n; }
  function updateFlyers(now) {
    if (!flyers) return;
    var all = true, sound = false;
    flyers.forEach(function (f) {
      if (now >= f.t0 + f.dur) { if (!f.landed) { f.landed = true; sound = true; } } else all = false;
    });
    if (sound) Lehcim.play('drop', 0.4);
    if (all) { flyers = null; var f = flyersDone; flyersDone = null; if (f) f(); }
  }

  // ---------- Game flow ----------

  function setStatus(t, cls, html) {
    if (html) statusEl.innerHTML = t; else statusEl.textContent = t;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }
  function sideName(c) { return c === 0 ? 'blancs' : 'noirs'; }

  function newGame(p) {
    cancelAI();
    hideOverlay(); hideChoice();
    human = settings.starter === 'human' ? 0 : 1;
    pos = p || R.initial(); pos.setSide(0);
    sel = -1; anim = null; banner = null; floatText = null; lastMove = -1; hintMove = -1; setupStacks = null; result = ''; overInfo = null;
    snapshots = []; plays = []; repCount = {}; hintsUsed = 0; undosUsed = 0;
    repCount[pos.key()] = 1;
    gameStart = Date.now();
    setPrisonMode(false);
    $('setupCard').hidden = true; $('playCard').hidden = false;
    resetAI();
    updatePanel();
    if (p) { phase = 'play'; nextTurn(); return; }
    setStatus('Mise en place...'); subEl.textContent = '';
    startFly(pos, nextTurn);
  }

  function legalCount() { return R.moves(pos).length; }

  function nextTurn() {
    hintMove = -1;
    updatePanel();
    if (!legalCount()) {
      var winner = 1 - pos.side;
      endGame(winner === human ? 'win' : 'loss', (winner === human ? "L'ordinateur" : 'Tu') + ' ne peu' + (winner === human ? 't' : 'x') + ' plus jouer.');
      return;
    }
    if ((repCount[pos.key()] || 0) >= 3) { endGame('draw', 'La même position est revenue trois fois.'); return; }
    if (plays.length >= R.MAX_PLIES) { endGame('draw', '400 coups ont été joués.'); return; }
    if (pos.side === human) {
      phase = 'play';
      setStatus('A toi de jouer (' + sideName(human) + ')');
      if (!settings.info || !lastInfo) subEl.textContent = plays.length ? 'Dernier coup : ' + plays[plays.length - 1].name : 'Choisis une de tes pièces.';
    } else {
      phase = 'think';
      setStatus('<span class="spin" aria-hidden="true"></span>L\'ordinateur réfléchit<span class="dots"></span>', '', true);
      subEl.textContent = 'Niveau ' + settings.level + (aiMode() === 'worker' ? '' : ' (calcul sur la page)');
      var t0 = Date.now();
      askAI(pos, settings.level, function (r) {
        if (phase !== 'think') return;
        lastInfo = r;
        var wait = Math.max(0, 280 - (Date.now() - t0)); // never reply instantly
        setTimeout(function () { if (phase === 'think') doMove(r.move); }, wait);
      });
    }
    updatePanel(); updateButtons();
  }

  function endGame(kind, reason) {
    cancelAI();
    phase = 'over'; sel = -1; hintMove = -1;
    var title = kind === 'win' ? 'Bravo, tu as gagné !' : kind === 'loss' ? "L'ordinateur a gagné !" : 'Partie nulle';
    result = title;
    setStatus(title, kind === 'win' ? 'good' : kind === 'loss' ? 'bad' : '');
    subEl.textContent = reason;
    if (kind === 'win') Lehcim.play('win'); else if (kind === 'loss') Lehcim.play('lose');
    var lv = settings.level;
    if (!record[lv]) record[lv] = [0, 0, 0];
    record[lv][kind === 'win' ? 0 : kind === 'draw' ? 1 : 2]++;
    saveRecord();
    overInfo = { kind: kind, title: title, reason: reason, duration: Date.now() - gameStart, level: lv };
    updatePanel(); updateButtons();
    setTimeout(function () { if (phase === 'over' && overInfo) showSummary(); }, reduceMotion ? 200 : 1300);
  }

  function doMove(m) {
    if (m < 0) return;
    var f = R.mFrom(m), t = R.mTo(m);
    if (pending && phase === 'play') cancelAI(); // a hint was being computed
    hideChoice();
    anim = { from: f, to: t, kind: R.mKind(m), c: pos.col[f], hFrom: pos.height(f), hTo: pos.height(t), t0: performance.now(),
      dur: (R.mKind(m) === R.PRISON ? 750 : 520) * speedK(), move: m };
    sel = -1; dragging = false; hintMove = -1;
    phase = 'anim';
    updateButtons();
    Lehcim.play('pick', 0.5);
  }
  function finishMove() {
    var m = anim.move, info = {}, kind = R.mKind(m), side = pos.side;
    anim = null;
    snapshots.push(pos.clone());
    R.play(pos, m, info);
    var name = R.moveName(m) + (info.revolt ? ' !' : '');
    plays.push({ m: m, side: side, name: name, revolt: !!info.revolt, lost: !!info.lost, capture: kind === R.CAPTURE });
    lastMove = m;
    var key = pos.key(); repCount[key] = (repCount[key] || 0) + 1;
    if (kind === R.CAPTURE) Lehcim.play('capture'); else if (kind === R.PRISON) Lehcim.play('prison'); else Lehcim.play('drop');
    if (info.revolt) { floatText = { text: "C'est la révolution !", until: performance.now() + 1600 }; Lehcim.play('revolt'); }
    else if (info.lost) { floatText = { text: 'Les prisonniers reprennent la pile !', until: performance.now() + 1600 }; Lehcim.play('revolt'); }
    if (side !== human && settings.info && lastInfo) showInfo(lastInfo, true);
    if ((repCount[key] || 0) === 2 && side !== human) toast('Attention : cette position est déjà apparue. Une troisième fois et la partie est nulle.');
    nextTurn();
  }

  // Undo: back to the last position where it was the player's turn.
  function undoMove() {
    if (!snapshots.length || phase === 'fly' || phase === 'setup' || phase === 'intro' || phase === 'start') return;
    if (anim && anim.c === human && phase === 'anim') { // own move still moving: just take it back
      anim = null; sel = -1; nextTurn(); return;
    }
    cancelAI(); anim = null; hideChoice(); hideOverlay();
    var undone = 0;
    while (snapshots.length) {
      var p = snapshots.pop(), pl = plays.pop();
      var key = pos.key(); repCount[key]--; if (!repCount[key]) delete repCount[key];
      pos = p; undone++;
      if (pl.side === human) break;
    }
    if (pos.side !== human) { // the computer started and only its move is left: replay from it
      nextTurnAfterUndo(); return;
    }
    if (phase === 'over') { // the record keeps the result, but the game goes on
      overInfo = null; result = '';
    }
    undosUsed++;
    lastMove = plays.length ? plays[plays.length - 1].m : -1;
    sel = -1; hintMove = -1; lastInfo = null;
    toast(undone > 1 ? 'Coups annulés : ' + undone : 'Coup annulé');
    nextTurn();
  }
  function nextTurnAfterUndo() { lastMove = plays.length ? plays[plays.length - 1].m : -1; sel = -1; nextTurn(); }

  // ---------- Computer player: Web Worker with main thread fallback ----------

  var worker = null, workerOK = false, reqId = 0, pending = null, lastInfo = null, watchdog = 0;
  function aiMode() { return worker && workerOK !== 'broken' ? 'worker' : 'main'; }
  function initWorker() {
    try {
      worker = new Worker('ai-worker.js');
      worker.onmessage = function (e) {
        workerOK = true;
        var d = e.data;
        if (!pending || d.id !== pending.id) return;
        var cb = pending.cb; pending = null; clearTimeout(watchdog);
        cb(d.result);
      };
      worker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        workerBroken();
      };
    } catch (e) { worker = null; }
  }
  function workerBroken() {
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; workerOK = 'broken';
    if (pending) { var p = pending; pending = null; runMain(p); }
  }
  function historyKeys() {
    var h = snapshots.map(function (p) { return [p.h1, p.h2]; });
    h.push([pos.h1, pos.h2]);
    return h;
  }
  // purpose: level 1..3 for the computer's move, or 'hint'.
  function askAI(p, level, cb) {
    var opts = { level: level === 'hint' ? 3 : level, history: historyKeys(), plies: plays.length };
    if (level === 'hint') { opts.timeMs = 900; opts.random = 0; }
    var req = { id: ++reqId, cb: cb, stacks: stacksOf(p), side: p.side, opts: opts };
    pending = req;
    if (aiMode() === 'worker') {
      worker.postMessage({ type: 'think', id: req.id, stacks: req.stacks, side: req.side, opts: opts });
      clearTimeout(watchdog);
      watchdog = setTimeout(function () { if (pending === req) workerBroken(); }, (opts.timeMs || R.LEVELS[opts.level].time) + 4000);
    } else runMain(req);
  }
  var mainEngine = null;
  function runMain(req) {
    pending = req;
    setTimeout(function () { // let the page paint the "thinking" state first
      if (pending !== req) return;
      if (!mainEngine) mainEngine = new R.Engine(18);
      var o = {}; for (var k in req.opts) o[k] = req.opts[k];
      o.mainThread = true; if (o.timeMs) o.timeMs = Math.min(o.timeMs, 600);
      var r = mainEngine.think(R.Pos.fromStacks(req.stacks, req.side), o);
      if (pending !== req) return;
      pending = null; req.cb(r);
    }, 30);
  }
  // A stale search would delay the next one: the busy worker is replaced.
  function cancelAI() {
    if (pending && aiMode() === 'worker') { try { worker.terminate(); } catch (e) { /* ignore */ } initWorker(); }
    pending = null; clearTimeout(watchdog);
    var hb = $('hint'); if (hb) hb.textContent = '💡 Indice';
  }
  function resetAI() { if (worker && workerOK !== 'broken') worker.postMessage({ type: 'reset' }); if (mainEngine) mainEngine.clear(); lastInfo = null; }

  function showInfo(r, own) {
    var sc = r.score > R.WIN / 2 ? 'gain forcé' : r.score < -R.WIN / 2 ? 'perte forcée' : (r.score > 0 ? '+' : '') + r.score;
    subEl.textContent = (own ? 'Analyse : ' : '') + 'profondeur ' + r.depth + ' (' + r.seldepth + ' avec les prises), ' +
      fmtNodes(r.nodes) + ' positions en ' + (r.ms / 1000).toFixed(1).replace('.', ',') + ' s, évaluation ' + sc +
      (r.pv && r.pv.length > 1 ? '. Suite prévue : ' + r.pv.slice(0, 4).map(R.moveName).join(' ') : '');
  }
  function fmtNodes(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : '' + n; }

  function hint() {
    if (phase !== 'play' || pos.side !== human) return;
    var hbtn = $('hint'); hbtn.disabled = true; hbtn.textContent = '💡 Calcul...';
    var key = pos.key();
    askAI(pos, 'hint', function (r) {
      hbtn.textContent = '💡 Indice'; updateButtons();
      if (phase !== 'play' || pos.key() !== key || r.move < 0) return;
      hintMove = r.move; hintsUsed++;
      sel = R.mFrom(r.move);
      toast('Indice : ' + R.moveName(r.move) + ' (' + kindText(R.mKind(r.move)) + ')');
      if (settings.info) showInfo(r);
    });
  }
  function kindText(k) { return ['déplacement', 'empilement', 'prise', 'prisonnier'][k]; }

  // ---------- Input ----------

  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
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
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], hi = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], pts[i]) <= 0) hi.pop(); hi.push(pts[i]); }
    lo.pop(); hi.pop(); return lo.concat(hi);
  }

  function movesTo(from, to) { return R.moves(pos, from).filter(function (m) { return R.mTo(m) === to; }); }
  function canStart(sq) { return pos.col[sq] === human && R.moves(pos, sq).length > 0; }
  // Plays from sel to `to`; forcePrison: right button. Returns true if a move was played or offered.
  function tryMove(to, forcePrison, screen) {
    var ms = movesTo(sel, to);
    if (!ms.length) return false;
    var pri = ms.filter(function (m) { return R.mKind(m) === R.PRISON; })[0];
    var other = ms.filter(function (m) { return R.mKind(m) !== R.PRISON; })[0];
    var m;
    if (pri != null && other != null) {
      if (forcePrison || prisonMode) m = pri;
      else if (screen) { showChoice(other, pri, screen); return true; }
      else m = other;
    } else m = pri != null ? pri : other;
    setPrisonMode(false);
    doMove(m);
    return true;
  }
  var choiceEl = $('choice'), choiceMoves = null;
  function showChoice(cap, pri, screen) {
    choiceMoves = [cap, pri];
    var r = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    var x = screen.x * r.width / W + r.left - sr.left, y = screen.y * r.height / H + r.top - sr.top;
    choiceEl.style.left = Math.max(90, Math.min(sr.width - 90, x)) + 'px';
    choiceEl.style.top = Math.max(60, y) + 'px';
    choiceEl.hidden = false;
    $('chCap').focus({ preventScroll: true });
    if (!ambiguousTold) { ambiguousTold = true; toast('Piles de même hauteur : tu peux prendre ou te constituer prisonnier.'); }
  }
  function hideChoice() { choiceEl.hidden = true; choiceMoves = null; }
  $('chCap').addEventListener('click', function () { if (choiceMoves && phase === 'play') { var m = choiceMoves[0]; hideChoice(); doMove(m); } });
  $('chPri').addEventListener('click', function () { if (choiceMoves && phase === 'play') { var m = choiceMoves[1]; hideChoice(); setPrisonMode(false); doMove(m); } });

  var camDrag = null;
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    var p = canvasPos(e);
    if (phase === 'intro') { endIntro(); return; }
    if (phase === 'loading') return;
    hideChoice();
    var sq = pick(p.x, p.y); hover = sq; kbd = -1;
    var rightBtn = e.button === 2;
    if (sq < 0 || phase === 'start' || phase === 'over' || phase === 'fly' || phase === 'think' || phase === 'anim') {
      // background (or not our turn): rotate the camera by dragging
      camDrag = { x: e.clientX, y: e.clientY, yaw: cam.yawT, pitch: cam.pitchT, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (sq < 0 && phase === 'play') sel = -1;
      return;
    }
    if (phase === 'setup') { setupClick(sq, rightBtn ? 1 : setupColor); return; }
    if (phase !== 'play') return;
    if (sel >= 0 && sq !== sel && tryMove(sq, rightBtn, p)) return;
    if (canStart(sq)) {
      if (rightBtn) setPrisonMode(true);
      sel = sq; dragging = true; hintMove = hintMove >= 0 && R.mFrom(hintMove) === sq ? hintMove : -1;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      Lehcim.play('pick', 0.4);
    } else {
      if (pos.col[sq] === human) { toast('Cette pièce ne peut pas bouger.'); Lehcim.play('bad', 0.4); }
      else if (sel >= 0) { Lehcim.play('bad', 0.4); }
      sel = -1;
    }
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = canvasPos(e);
    if (camDrag) {
      var dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) camDrag.moved = true;
      cam.yawT = camDrag.yaw - dx * 0.008;
      cam.pitchT = Math.max(18 * DEG, Math.min(89 * DEG, camDrag.pitch + dy * 0.006));
      cam.yaw = cam.yawT; cam.pitch = cam.pitchT;
      stage.classList.add('grab');
      return;
    }
    hover = phase === 'intro' ? -1 : pick(p.x, p.y);
  });
  function pointerEnd(e) {
    if (camDrag) { camDrag = null; stage.classList.remove('grab'); return; }
    if (!dragging) return;
    dragging = false;
    var p = canvasPos(e), sq = pick(p.x, p.y);
    if (phase !== 'play' || sel < 0 || sq === sel || sq < 0) return; // stays selected: tap then tap
    if (!tryMove(sq, e.button === 2, p)) { sel = -1; Lehcim.play('bad', 0.4); }
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', function () { camDrag = null; dragging = false; stage.classList.remove('grab'); });
  canvas.addEventListener('pointerleave', function () { if (!dragging && !camDrag) hover = -1; });
  canvas.addEventListener('wheel', function (e) {
    if (phase === 'intro') return;
    e.preventDefault();
    cam.pitchT = Math.max(18 * DEG, Math.min(89 * DEG, cam.pitchT - Math.sign(e.deltaY) * 4 * DEG));
  }, { passive: false });

  function rotate(dy, dp) {
    cam.yawT += dy * 15 * DEG;
    cam.pitchT = Math.max(18 * DEG, Math.min(89 * DEG, cam.pitchT + dp * 6 * DEG));
  }
  // Presets: the nearest equivalent yaw, so the camera turns the short way.
  function view(yaw, pitch) {
    var d = yaw - cam.yawT; d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.yawT += d; cam.pitchT = pitch;
  }
  var VIEWS = { vFront: [VIEW0.yaw, VIEW0.pitch], vTop: [0, 89 * DEG], vSide: [-90 * DEG, 38 * DEG], vOpp: [155 * DEG, 48 * DEG] };
  Object.keys(VIEWS).forEach(function (id) { $(id).addEventListener('click', function () { view(VIEWS[id][0], VIEWS[id][1]); }); });
  [['rotL', 1, 0], ['rotR', -1, 0], ['tiltU', 0, 1], ['tiltD', 0, -1]].forEach(function (b) {
    $(b[0]).addEventListener('click', function () { rotate(b[1], b[2]); });
  });

  // Keyboard: arrows move a cursor on the board (rows/columns as seen from the default view).
  function kbdAct() {
    if (kbd < 0) { kbd = sel >= 0 ? sel : 5 * N + 2; return; }
    if (phase === 'setup') { setupClick(kbd, setupColor); return; }
    if (phase !== 'play') return;
    if (choiceMoves) return;
    if (sel >= 0 && kbd !== sel) {
      var pt = proj(cellX(kbd), 0, cellZ(kbd));
      if (tryMove(kbd, false, pt)) return;
    }
    if (canStart(kbd)) { sel = sel === kbd ? -1 : kbd; Lehcim.play('pick', 0.4); }
    else { sel = -1; Lehcim.play('bad', 0.4); }
  }
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var k = e.key, tag = (e.target && e.target.tagName) || '';
    if (e.ctrlKey && (k === 'z' || k === 'Z')) { undoMove(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var onButton = tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'A';
    if (k.indexOf('Arrow') === 0) {
      if (e.shiftKey) {
        if (k === 'ArrowLeft') rotate(1, 0); else if (k === 'ArrowRight') rotate(-1, 0);
        else if (k === 'ArrowUp') rotate(0, 1); else rotate(0, -1);
      } else {
        if (phase === 'intro' || phase === 'start') return;
        if (kbd < 0) kbd = sel >= 0 ? sel : 5 * N + 2;
        else {
          var r = (kbd / N) | 0, c = kbd % N;
          if (k === 'ArrowLeft') c = Math.max(0, c - 1); else if (k === 'ArrowRight') c = Math.min(N - 1, c + 1);
          else if (k === 'ArrowUp') r = Math.max(0, r - 1); else r = Math.min(N - 1, r + 1);
          kbd = r * N + c;
        }
        subEl.textContent = 'Case ' + R.sqName(kbd) + describe(kbd);
      }
      e.preventDefault(); return;
    }
    if ((k === 'Enter' || k === ' ') && !onButton) {
      if (phase === 'intro') { endIntro(); e.preventDefault(); return; }
      kbdAct(); e.preventDefault(); return;
    }
    var lk = k.toLowerCase();
    if (k === 'Escape') { sel = -1; hideChoice(); kbd = -1; }
    else if (lk === 'p') setPrisonMode(!prisonMode);
    else if (lk === 'u') undoMove();
    else if (lk === 'h') hint();
    else if (lk === 'v') view(VIEWS.vFront[0], VIEWS.vFront[1]);
    else if (lk === 'n') startNew();
  });
  function describe(sq) {
    var s = pos.stack(sq);
    if (setupStacks) s = setupStacks[sq];
    if (!s.length) return ' : vide';
    var c = s[s.length - 1], top = 0; while (top < s.length && s[s.length - 1 - top] === c) top++;
    return ' : ' + top + ' ' + (c ? 'noir' : 'blanc') + (top > 1 ? 's' : '') + (s.length > top ? ' sur ' + (s.length - top) + ' prisonnier' + (s.length - top > 1 ? 's' : '') : '');
  }

  function setPrisonMode(v) {
    prisonMode = v;
    $('modePrison').setAttribute('aria-pressed', v ? 'true' : 'false');
    $('modeMove').setAttribute('aria-pressed', v ? 'false' : 'true');
  }
  $('modeMove').addEventListener('click', function () { setPrisonMode(false); });
  $('modePrison').addEventListener('click', function () { setPrisonMode(true); });
  $('undo').addEventListener('click', undoMove);
  $('hint').addEventListener('click', hint);
  $('resign').addEventListener('click', function () {
    if (phase !== 'play' && phase !== 'think' && phase !== 'anim') return;
    Lehcim.message('Abandonner la partie ?', ['Abandonner', 'Continuer']).then(function (i) {
      if (i === 0 && (phase === 'play' || phase === 'think' || phase === 'anim')) { anim = null; endGame('loss', 'Tu as abandonné.'); }
    });
  });
  function startNew() {
    if (phase === 'loading') return;
    if (phase === 'intro') introDone = true;
    newGame();
  }
  $('new').addEventListener('click', startNew);

  // ---------- Nouvelle position ----------

  $('setup').addEventListener('click', function () { if (phase === 'intro') introDone = true; startSetup(); });
  $('setupCancel').addEventListener('click', function () { newGame(); });
  function setSetupColor(c) {
    setupColor = c;
    $('setW').setAttribute('aria-pressed', c ? 'false' : 'true'); $('setB').setAttribute('aria-pressed', c ? 'true' : 'false');
  }
  $('setW').addEventListener('click', function () { setSetupColor(0); });
  $('setB').addEventListener('click', function () { setSetupColor(1); });
  function startSetup() {
    cancelAI(); hideOverlay(); hideChoice();
    human = settings.starter === 'human' ? 0 : 1;
    setupStacks = []; for (var i = 0; i < N * N; i++) setupStacks.push([]);
    setupCount = 0; setupOpen = -1; sel = -1; anim = null; flyers = null; lastMove = -1; banner = null; floatText = null; result = '';
    snapshots = []; plays = [];
    phase = 'setup';
    $('setupCard').hidden = false; $('playCard').hidden = true;
    setStatus('Pose les 16 pièces');
    subEl.textContent = 'Celui qui commence a les blancs (' + (human === 0 ? 'toi' : "l'ordinateur") + ').';
    updatePanel(); updateButtons();
  }
  function stackState(s) {
    if (!s.length) return 'ok';
    if (!R.Pos.fromStacks([s])) {
      var c = s[s.length - 1], k = s.length - 1;
      while (k >= 0 && s[k] === c) k--;
      for (var j = k; j >= 0; j--) if (s[j] === c) return 'bad';
      return 'incomplete';
    }
    return 'ok';
  }
  function setupClick(sq, c) {
    if (sq < 0 || banner) return;
    if (setupOpen >= 0 && sq !== setupOpen) {
      banner = { spr: [SPR.incomplete1, SPR.incomplete2], until: performance.now() + 1800 };
      toast('Une pile est incomplète : termine-la (en ' + R.sqName(setupOpen) + ').');
      Lehcim.play('bad', 0.5); return;
    }
    setupStacks[sq].push(c); setupCount++;
    Lehcim.play('drop', 0.5);
    var st = stackState(setupStacks[sq]);
    setupOpen = st === 'incomplete' ? sq : -1;
    updatePanel();
    if (st === 'bad' || (setupCount >= 16 && st !== 'ok')) { impossible(); return; }
    if (setupCount >= 16) {
      var p = R.Pos.fromStacks(setupStacks, 0);
      if (!p) { impossible(); return; }
      newGame(p);
    }
  }
  function impossible() {
    banner = { spr: [SPR.impossible1, SPR.impossible2], until: performance.now() + 2000 };
    toast('Position impossible : recommence.');
    Lehcim.play('bad', 0.6);
    bannerDone = startSetup;
  }

  // ---------- Side panel, overlay, toasts ----------

  function toast(text) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    var box = $('toasts'); box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function updatePanel() {
    var c;
    if (setupStacks) {
      c = { free: [0, 0], prisoners: [0, 0], stacks: [0, 0] };
      setupStacks.forEach(function (s) { if (!s.length) return; var tc = s[s.length - 1]; c.stacks[tc]++; s.forEach(function (p) { if (p === tc) c.free[p]++; else c.prisoners[p]++; }); });
    } else c = R.counts(pos);
    ['W', 'B'].forEach(function (L, side) {
      $('name' + L).textContent = (side ? 'Noirs' : 'Blancs') + (side === human ? ' (toi)' : ' (ordinateur)');
      $('free' + L).innerHTML = c.free[side] + ' <small>libre' + (c.free[side] > 1 ? 's' : '') + '</small>';
      $('det' + L).textContent = c.prisoners[side] + ' prisonnier' + (c.prisoners[side] > 1 ? 's' : '') + ', ' + c.stacks[side] + ' pile' + (c.stacks[side] > 1 ? 's' : '');
      $('p' + L).classList.toggle('turn', !setupStacks && (phase === 'play' || phase === 'think' || phase === 'anim' || phase === 'fly') && pos.side === side);
    });
    // history
    var ol = $('hist'); ol.innerHTML = '';
    for (var k = 0; k < plays.length; k += 2) {
      var li = document.createElement('li');
      var n = document.createElement('span'); n.className = 'n'; n.textContent = (k / 2 + 1) + '.';
      li.appendChild(n);
      for (var j = 0; j < 2; j++) {
        var s = document.createElement('span'); s.className = 'mv';
        var pl = plays[k + j];
        if (pl) { s.textContent = pl.name; if (k + j === plays.length - 1) s.classList.add('last'); s.title = (pl.side === human ? 'Toi' : 'Ordinateur') + ' : ' + kindText(R.mKind(pl.m)); }
        li.appendChild(s);
      }
      ol.appendChild(li);
    }
    $('histEmpty').hidden = plays.length > 0;
    ol.scrollTop = ol.scrollHeight;
    // record
    var rec = $('record'); rec.innerHTML = '';
    [1, 2, 3].forEach(function (lv) {
      var r = record[lv] || [0, 0, 0];
      var dt = document.createElement('dt'); dt.textContent = 'Niveau ' + lv + (lv === settings.level ? ' (actuel)' : '');
      var dd = document.createElement('dd'); dd.textContent = r[0] + ' V - ' + r[1] + ' N - ' + r[2] + ' D';
      dd.title = r[0] + ' victoires, ' + r[1] + ' nulles, ' + r[2] + ' défaites';
      rec.appendChild(dt); rec.appendChild(dd);
    });
  }
  function updateButtons() {
    var canUndo = snapshots.length > 0 && plays.some(function (p) { return p.side === human; }) && phase !== 'fly' && phase !== 'setup';
    $('undo').disabled = !canUndo;
    $('hint').disabled = !(phase === 'play' && pos.side === human) || !!pending;
    $('resign').disabled = !(phase === 'play' || phase === 'think' || phase === 'anim');
  }

  function overlayShown() { return !overlay.hidden; }
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
  function showOverlay(html) { overlay.innerHTML = html; overlay.hidden = false; var b = overlay.querySelector('.btn.primary'); if (b) b.focus({ preventScroll: true }); }

  function showStart() {
    phase = 'start';
    var lvNames = { 1: 'Débutant', 2: 'Moyen', 3: 'Fort' };
    showOverlay('<h2>Agora</h2><p>Déplace tes pions, prends les piles adverses ou glisse-toi dessous comme prisonnier. ' +
      'Gagne en privant l\'ordinateur de tout coup jouable.</p>' +
      '<p class="big">Niveau ' + settings.level + ' (' + lvNames[settings.level] + '), ' + (settings.starter === 'human' ? 'tu commences avec les blancs' : "l'ordinateur commence, tu as les noirs") + '.</p>' +
      '<div class="btnrow"><button class="btn primary" id="ovPlay">Jouer</button><button class="btn" id="ovSet">Réglages</button><button class="btn" id="ovHelp">Règles</button></div>');
    $('ovPlay').onclick = function () { newGame(); };
    $('ovSet').onclick = openSettings;
    $('ovHelp').onclick = function () { $('help').showModal(); };
    setStatus('Prêt à jouer'); subEl.textContent = 'Appuie sur « Jouer » pour commencer.';
    updatePanel(); updateButtons();
  }
  function showSummary() {
    var o = overInfo; if (!o) return;
    var mine = plays.filter(function (p) { return p.side === human; }), his = plays.filter(function (p) { return p.side !== human; });
    var cnt = function (l, f) { return l.filter(f).length; };
    var cap = function (p) { return p.capture; }, rev = function (p) { return p.revolt; };
    var mins = Math.floor(o.duration / 60000), secs = Math.round(o.duration / 1000) % 60;
    var c = R.counts(pos);
    showOverlay('<h2>' + o.title + '</h2><p>' + o.reason + '</p>' +
      '<dl class="stats">' +
      '<dt>Coups joués</dt><dd>' + plays.length + '</dd>' +
      '<dt>Tes prises / celles de l\'ordinateur</dt><dd>' + cnt(mine, cap) + ' / ' + cnt(his, cap) + '</dd>' +
      '<dt>Révolutions (toi / ordinateur)</dt><dd>' + cnt(mine, rev) + ' / ' + cnt(his, rev) + '</dd>' +
      '<dt>Pièces libres à la fin (toi / ordinateur)</dt><dd>' + c.free[human] + ' / ' + c.free[1 - human] + '</dd>' +
      '<dt>Indices, annulations</dt><dd>' + hintsUsed + ', ' + undosUsed + '</dd>' +
      '<dt>Durée, niveau</dt><dd>' + mins + ' min ' + (secs < 10 ? '0' : '') + secs + ' s, niv. ' + o.level + '</dd></dl>' +
      '<div class="btnrow"><button class="btn primary" id="ovAgain">Revanche</button><button class="btn" id="ovSwap">Changer de camp</button><button class="btn" id="ovLook">Voir le plateau</button></div>');
    $('ovAgain').onclick = function () { newGame(); };
    $('ovSwap').onclick = function () { settings.starter = settings.starter === 'human' ? 'cpu' : 'human'; saveSettings(); syncSettings(); newGame(); };
    $('ovLook').onclick = function () { hideOverlay(); toast('« Nouvelle partie » pour rejouer, « Annuler » pour reprendre la partie.'); };
  }

  // ---------- Settings dialog ----------

  function segInit(id, key, conv, onChange) {
    var seg = $(id);
    seg.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        settings[key] = conv(b.dataset.v); saveSettings(); syncSettings(); if (onChange) onChange();
      });
    });
  }
  function syncSettings() {
    [['levelSeg', 'level'], ['starterSeg', 'starter'], ['speedSeg', 'speed']].forEach(function (s) {
      $(s[0]).querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v) === String(settings[s[1]]) ? 'true' : 'false'); });
    });
    $('optCoords').checked = settings.coords; $('optTargets').checked = settings.targets; $('optInfo').checked = settings.info;
    if (phase === 'start') showStart();
    updatePanel();
  }
  segInit('levelSeg', 'level', Number, function () { toast('Niveau ' + settings.level + ' : effet immédiat.'); });
  segInit('starterSeg', 'starter', String, function () {
    if (phase !== 'start' && phase !== 'intro' && phase !== 'setup') toast('Pris en compte à la prochaine partie.');
  });
  segInit('speedSeg', 'speed', String);
  [['optCoords', 'coords'], ['optTargets', 'targets'], ['optInfo', 'info']].forEach(function (o) {
    $(o[0]).addEventListener('change', function (e) { settings[o[1]] = e.target.checked; saveSettings(); });
  });
  function openSettings() { $('settings').showModal(); }
  $('settingsBtn').addEventListener('click', openSettings);

  var muteBtn = $('mute');
  function syncMute() {
    var m = Lehcim.isMuted();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', m ? 'Remettre le son' : 'Couper le son');
  }
  muteBtn.addEventListener('click', function () { Lehcim.setMuted(!Lehcim.isMuted()); syncMute(); });

  // ---------- Intro: "LEHCIM NOIL PRESENTE" dissolves into the AGORA logo ----------

  var introT0 = 0, introDone = false;
  function frameAt(t) {
    if (t < 1400) return 0;
    var k = Math.floor((t - 1400) / 110);
    if (k < 14) return 1 + k;
    return 15 + Math.floor((t - 1400 - 14 * 110) / 160) % 3;
  }
  function drawIntro(now) {
    if (phase === 'loading') return;
    var t = now - introT0, f = FRAMES[frameAt(t)];
    var w = Math.min(450, W - 40), h = w * 80 / 300;
    if (sheet) ctx.drawImage(sheet, f[0], f[1], 300, 80, (W - w) / 2, H / 2 - h / 2 - 20, w, h);
    ctx.font = '14px system-ui, sans-serif';
    if (t > 3000) shadowText('Touche le plateau pour continuer', W / 2, H / 2 + h / 2 + 30, '#ccd', 'center');
    if (t > 4800) endIntro();
  }
  function endIntro() {
    if (introDone) { if (phase === 'intro') showStart(); return; }
    introDone = true;
    showStart();
  }

  // ---------- Main loop ----------

  function loop(now) {
    if (anim && now - anim.t0 >= anim.dur) finishMove();
    updateFlyers(now);
    draw(now);
    requestAnimationFrame(loop);
  }

  Lehcim.initPage();
  syncSettings(); syncMute(); setSetupColor(0);
  fit();
  initWorker();
  updatePanel(); updateButtons();
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  Promise.all([
    Promise.all(TEX_IDS.map(function (id) { return Lehcim.loadImage(A + id + '.png').then(function (im) { tex[id] = im; }); })),
    Lehcim.loadSheet(A + '39.png', [250, 250, 250]).then(function (s) { sheet = s; }),
    Lehcim.loadImage(A + '40.png').then(function (im) { bg = im; })
  ]).then(function () {
    setStatus('Bienvenue'); subEl.textContent = '';
    introT0 = performance.now();
    phase = 'intro';
    if (reduceMotion) endIntro();
    requestAnimationFrame(loop);
  }).catch(function (e) { setStatus('Erreur de chargement', 'bad'); console.error(e); });

  // For automated tests.
  window.AgoraGame = {
    state: function () { return { phase: phase, side: pos.side, human: human, sel: sel, plies: plays.length, result: result, key: pos.key(), setupCount: setupCount, ai: aiMode(), workerOK: workerOK, hint: hintMove, last: lastInfo }; },
    pos: function () { return pos; },
    topOf: function (sq) { setupCamera(); var p = proj(cellX(sq), pos.height(sq) * PH, cellZ(sq)); var r = canvas.getBoundingClientRect(); return { x: r.left + p.x * r.width / W, y: r.top + p.y * r.height / H }; },
    moves: function () { return R.moves(pos).map(function (m) { return [R.mFrom(m), R.mTo(m), R.mKind(m), R.moveName(m)]; }); },
    play: function (m) { if (phase === 'play') doMove(m); },
    skipIntro: function () { endIntro(); }
  };
})();
