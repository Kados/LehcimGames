/*
 * Agora - browser port of Lehcim Noil's Windows 3.x game.
 * Player against the computer on a terraced 6x6 wooden board drawn in 3D
 * with the original wood textures (canvas 2D, texture mapping by triangles).
 * Rules and AI live in rules.js (AgoraRules).
 *
 * The view, the board and the timings were measured on the original program:
 * visible area 598x375 of a 640x400 picture, camera 44.5 degrees above the board,
 * outer ring 3 piece thicknesses above the middle ring, itself 2 above the centre.
 *
 * Sections: assets, camera / projection, drawing, animations, game flow, input,
 * setup ("Nouvelle Position"), intro.
 */
(function () {
  'use strict';

  var R = window.AgoraRules, N = R.N, LEVEL = R.LEVEL;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var statusEl = document.getElementById('status');
  var A = 'assets/';

  // ---------- Assets ----------

  var tex = {}, sheet = null, stars = null, title = null;
  var TEX_IDS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 35, 36, 38];
  // Text sprites of 39.png (key colour rgb(250,250,250)) and where the original draws them.
  var SPR = {
    over: [908, 246, 286, 27, 178, 186],                  // PARTIE TERMINEE
    yourTurn: [925, 292, 243, 26, 195, 192],              // A TOI DE JOUER
    incomplete1: [912, 321, 258, 21, 182, 181], incomplete2: [1004, 341, 193, 17, 274, 201], // UNE PILE EST INCOMPLETE. / TERMINE LA !
    impossible1: [912, 362, 210, 17, 182, 182], impossible2: [1040, 381, 150, 17, 310, 201]  // POSITION IMPOSSIBLE ! / RECOMMENCE ...
  };
  // Intro frames (300x80 each, drawn at 170,160): text dissolving, dots, then the AGORA logo.
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

  // ---------- Geometry (unit = one square) ----------

  var TH = 0.128;                 // piece thickness (the levels are multiples of it)
  var PS = 0.38;                  // half size of a piece
  var BASE_H = 0.8;               // depth of the wooden base below the outer ring
  var LIGHT = norm([-0.3, 0, 1]); // horizontal light direction for side shading (front faces are the lightest)
  function cellX(i) { return (i % N) - 2.5; }
  function cellZ(i) { return ((i / N) | 0) - 2.5; }
  function floorY(i) { return (LEVEL[i] - 5) * TH; }
  var sqTex = [];                 // texture (id + half) of each square: light outer ring, darker towards the centre
  (function () {
    var seed = 11;
    for (var i = 0; i < N * N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var base = LEVEL[i] === 5 ? 6 : LEVEL[i] === 2 ? 9 : 12;
      sqTex.push({ id: base + (seed >> 8) % 3, half: (seed >> 4) & 1 });
    }
  })();

  // ---------- Camera / projection ----------

  var DEG = Math.PI / 180, STEP = 2 * Math.PI / 256;   // one key press turns the view by 1/256 of a turn
  var PITCH0 = 44.5 * DEG, PITCH_MAX = 88 * DEG;
  var cam = { yaw: 0, pitch: PITCH0, dist: 13.25, look: 0.76, pivot: -0.5, f: 1036, cx: 320, cy: 200 };
  var xf = null;                  // board transform during the intro fly-in: {ang, dx, dy, dz}
  var eye, fwd, right, up;
  // The view turns around a vertical axis a little behind the centre of the board
  // (cam.pivot), as in the original where the board slides aside while turning.
  function setupCamera() {
    var sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), cp = Math.cos(cam.pitch);
    var lz = cam.look - cam.pivot;
    var L = [lz * sy, 0, cam.pivot + lz * cy];
    eye = [L[0] + cam.dist * cp * sy, cam.dist * Math.sin(cam.pitch), L[2] + cam.dist * cp * cy];
    fwd = norm([L[0] - eye[0], L[1] - eye[1], L[2] - eye[2]]);
    right = norm(cross(fwd, [0, 1, 0]));
    up = cross(right, fwd);
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
  function toWorld(x, y, z) {
    if (!xf) return [x, y, z];
    var c = Math.cos(xf.ang), s = Math.sin(xf.ang);
    return [x * c + z * s + xf.dx, y + xf.dy, -x * s + z * c + xf.dz];
  }
  function proj(x, y, z) {
    var w = toWorld(x, y, z), dx = w[0] - eye[0], dy = w[1] - eye[1], dz = w[2] - eye[2];
    var cz = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    if (cz < 0.05) cz = 0.05;
    var cx = dx * right[0] + dy * right[1] + dz * right[2];
    var cy = dx * up[0] + dy * up[1] + dz * up[2];
    return { x: cam.cx + cam.f * cx / cz, y: cam.cy - cam.f * cy / cz };
  }
  function distTo(x, z) { var w = toWorld(x, 0, z); return Math.hypot(w[0] - eye[0], w[2] - eye[2]); }
  // Is a face with outward normal n (board coordinates) through point p seen from the eye?
  function facing(p, n) {
    var w = toWorld(p[0], p[1], p[2]), a = xf ? xf.ang : 0, c = Math.cos(a), s = Math.sin(a);
    var nw = [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
    return nw[0] * (eye[0] - w[0]) + nw[1] * (eye[1] - w[1]) + nw[2] * (eye[2] - w[2]) > 0;
  }

  // ---------- Texture mapping ----------

  // Draws the source rectangle of img onto a projected quad (TL, TR, BR, BL), as two affine triangles.
  function texQuad(img, s, P) {
    if (!img) return;
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
    // clip a slightly enlarged triangle to hide seams
    var gx = (d0.x + d1.x + d2.x) / 3, gy = (d0.y + d1.y + d2.y) / 3;
    ctx.save();
    ctx.beginPath();
    [d0, d1, d2].forEach(function (p, i) {
      var vx = p.x - gx, vy = p.y - gy, l = Math.hypot(vx, vy) || 1, k = (l + 0.7) / l;
      if (i) ctx.lineTo(gx + vx * k, gy + vy * k); else ctx.moveTo(gx + vx * k, gy + vy * k);
    });
    ctx.closePath(); ctx.clip();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  // Shade 0 (light) .. n-1 (dark) of a vertical face with outward normal (nx, nz).
  function shade(nx, nz, n) {
    var d = nx * LIGHT[0] + nz * LIGHT[2]; // -1..1
    return Math.max(0, Math.min(n - 1, Math.floor((1 - d) / 2 * n)));
  }
  function topQuad(x0, x1, z0, z1, y) { return [proj(x0, y, z0), proj(x1, y, z0), proj(x1, y, z1), proj(x0, y, z1)]; }

  // ---------- Board ----------

  var DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // (dx, dz) of the four sides: back, front, left, right
  function neighbourY(i, d) {
    var r = ((i / N) | 0) + d[1], c = (i % N) + d[0];
    if (r < 0 || r >= N || c < 0 || c >= N) return -BASE_H;
    return floorY(r * N + c);
  }
  // A vertical wall on side d of square i, from y0 up to y1.
  function drawWall(i, d, y0, y1) {
    var x = cellX(i), z = cellZ(i);
    var ax, az, bx, bz; // wall ends, seen from outside: a = left end, b = right end
    if (d[1] < 0) { ax = x + 0.5; az = z - 0.5; bx = x - 0.5; bz = z - 0.5; }
    else if (d[1] > 0) { ax = x - 0.5; az = z + 0.5; bx = x + 0.5; bz = z + 0.5; }
    else if (d[0] < 0) { ax = x - 0.5; az = z - 0.5; bx = x - 0.5; bz = z + 0.5; }
    else { ax = x + 0.5; az = z + 0.5; bx = x + 0.5; bz = z - 0.5; }
    if (!facing([(ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2], [d[0], 0, d[1]])) return;
    var img, src, k = (i % N + ((i / N) | 0)) % 4;
    if (y0 <= -BASE_H + 1e-6) { img = tex[15 + shade(d[0], d[1], 4)]; src = [(k % 6) * 160, 0, 160, 16]; }       // base side
    else { img = tex[19 + shade(d[0], d[1], 4)]; src = [k * 128, 0, 128, 16]; }                                   // steps between the levels
    texQuad(img, src, [proj(ax, y1, az), proj(bx, y1, bz), proj(bx, y0, bz), proj(ax, y0, az)]);
  }
  function drawSquare(i, mark) {
    var y = floorY(i), x = cellX(i), z = cellZ(i);
    DIRS.forEach(function (d) { var yn = neighbourY(i, d); if (yn < y - 1e-6) drawWall(i, d, yn, y); });
    var t = sqTex[i], img = tex[t.id], src = [t.half * 128, 0, 128, 64];
    if (mark === 'sel') { img = tex[33]; src = [0, 0, 128, 64]; }
    else if (mark === 'hover') { img = tex[32]; src = [0, 0, 128, 64]; }
    texQuad(img, src, topQuad(x - 0.5, x + 0.5, z - 0.5, z + 0.5, y));
  }

  // ---------- Pieces ----------

  var SIDE_W = [28, 29, 30], SIDE_B = [35, 36, 38]; // side textures, light to dark
  // A piece: centre (x, y, z), colour c (colour of its upper face), optional rotation
  // `rot` (radians) around the horizontal axis (ax, 0, az).
  function drawPiece(x, y, z, c, rot, ax, az) {
    var u = [PS, 0, 0], v = [0, TH / 2, 0], w = [0, 0, PS];
    if (rot) {
      var k = [ax, 0, az], co = Math.cos(rot), si = Math.sin(rot);
      var rv = function (a) { // Rodrigues rotation of a around unit axis k
        var kxa = cross(k, a), kd = k[0] * a[0] + k[1] * a[1] + k[2] * a[2];
        return [a[0] * co + kxa[0] * si + k[0] * kd * (1 - co), a[1] * co + kxa[1] * si + k[1] * kd * (1 - co), a[2] * co + kxa[2] * si + k[2] * kd * (1 - co)];
      };
      u = rv(u); v = rv(v); w = rv(w);
    }
    function P(a, b, cc) { return proj(x + a * u[0] + b * v[0] + cc * w[0], y + a * u[1] + b * v[1] + cc * w[1], z + a * u[2] + b * v[2] + cc * w[2]); }
    // a face is seen when its outward normal (half-axis vector h, sign s) points to the eye
    function vis(h, s) { return facing([x + h[0] * s, y + h[1] * s, z + h[2] * s], [h[0] * s, h[1] * s, h[2] * s]); }
    function side(h, s, Q) {
      if (!vis(h, s)) return;
      var n = norm(h);
      texQuad(tex[(c ? SIDE_B : SIDE_W)[shade(n[0] * s, n[2] * s, 3)]], [0, 0, 256, 10], Q);
    }
    side(w, 1, [P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1), P(-1, -1, 1)]);
    side(w, -1, [P(1, 1, -1), P(-1, 1, -1), P(-1, -1, -1), P(1, -1, -1)]);
    side(u, 1, [P(1, 1, 1), P(1, 1, -1), P(1, -1, -1), P(1, -1, 1)]);
    side(u, -1, [P(-1, 1, -1), P(-1, 1, 1), P(-1, -1, 1), P(-1, -1, -1)]);
    // upper face in the piece's colour; the lower face (seen while it turns over) in the other one
    if (vis(v, 1)) texQuad(tex[c ? 31 : 27], [0, 0, 128, 64], [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)]);
    else if (vis(v, -1)) texQuad(tex[c ? 27 : 31], [0, 0, 128, 64], [P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), P(-1, -1, -1)]);
  }
  // A whole stack (colours bottom -> top) standing on square i, raised by `lift`.
  function drawStack(i, s, lift, from) {
    var x = cellX(i), z = cellZ(i), y = floorY(i) + (lift || 0);
    for (var k = from || 0; k < s.length; k++) drawPiece(x, y + (k + 0.5) * TH, z, s[k]);
  }

  // ---------- Game state ----------

  var pos = R.initial(0);
  var human = 0;              // colour of the player (the starter has white)
  var level = 1;
  var phase = 'title';        // title | intro | drop | play | anim | think | setup | over
  var hover = -1, sel = -1, selPrison = false, dragging = false, prisonToggle = false;
  var anim = null;            // current move animation
  var drop = null;            // pieces leaving / falling on the board at the start of a game
  var banner = null;          // sprites shown over the board: [names], until (ms) or null
  var showYourTurn = false;   // "A TOI DE JOUER" after a "Nouvelle Position"
  var playedIntro = false;
  var setupStacks = null, setupCount = 0;
  var lastStacks = null;      // stacks of the previous game (they fly away at the next start)

  function stacksOf(p) { var s = []; for (var i = 0; i < N * N; i++) s.push(p.stack(i)); return s; }
  function inGame() { return phase === 'play' || phase === 'think' || phase === 'anim' || phase === 'drop' || phase === 'intro'; }

  // ---------- Drawing ----------

  function draw(now) {
    setupCamera();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (phase === 'title') { if (title) ctx.drawImage(title, 0, 0); return; }
    if (phase === 'intro' && drawIntro(now)) return;
    if (stars) ctx.drawImage(stars, 0, 0); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    drawBoard(now);
    drawOverlay(now);
  }

  function drawBoard(now) {
    var stacks = setupStacks || (drop ? drop.stacks(now) : stacksOf(pos));
    var order = [];
    for (var i = 0; i < N * N; i++) order.push(i);
    order.sort(function (a, b) { return distTo(cellX(b), cellZ(b)) - distTo(cellX(a), cellZ(a)); });
    var st = anim ? animState(now) : null;
    var flying = drop ? drop.flying(now) : [];
    // free-flying pieces are drawn after the square they are above (or the one they come from)
    var after = {};
    function attach(sq, fn) { (after[sq] = after[sq] || []).push(fn); }
    if (st) st.extra.forEach(function (e) { attach(e.sq, e.draw); });
    flying.forEach(function (f) { attach(f.sq, function () { drawPiece(f.x, f.y, f.z, f.c, f.rot, 1, 0); }); });
    order.forEach(function (i) {
      var mark = i === sel ? 'sel' : (i === hover && (phase === 'play' || phase === 'setup' || phase === 'think' || phase === 'anim')) ? 'hover' : null;
      drawSquare(i, mark);
      var s = stacks[i];
      if (st && st.stacks[i]) st.stacks[i]();
      else drawStack(i, s);
      if (after[i]) after[i].forEach(function (fn) { fn(); });
    });
  }

  function sprite(r) { if (sheet) ctx.drawImage(sheet, r[0], r[1], r[2], r[3], r[4], r[5], r[2], r[3]); }

  function drawOverlay(now) {
    if (phase === 'over') sprite(SPR.over);
    if (showYourTurn && phase === 'play' && pos.side === human) sprite(SPR.yourTurn);
    if (banner) {
      if (banner.until && now > banner.until) { var f = banner.done; banner = null; if (f) f(); }
      else banner.spr.forEach(function (n) { sprite(SPR[n]); });
    }
  }

  // ---------- Animations ----------

  // Move animation: the piece jumps (turning over once in the air) to its target.
  // Captures: the taken pieces first jump up and turn over (they change colour).
  // Prisoner: the target stack rises, the piece slides under it, the stack comes down.
  // Revolution / pieces left in minority: those pieces turn over where they are.
  function startMove(m) {
    var f = R.mFrom(m), t = R.mTo(m), kind = R.mKind(m), after = pos.clone(), info = {};
    R.play(after, m, info);
    var a = { m: m, kind: kind, from: f, to: t, c: pos.col[f], before: stacksOf(pos), after: stacksOf(after), info: info, t0: performance.now(), steps: [] };
    var flipT = kind === R.CAPTURE ? 650 : 0, jump = kind === R.PRISON ? 900 : 650;
    a.steps.push({ name: 'flipTarget', d: flipT });
    a.steps.push({ name: 'jump', d: jump });
    a.steps.push({ name: 'flipAfter', d: (info.revolt || info.lost) ? 650 : 0 });
    a.dur = a.steps.reduce(function (s, x) { return s + x.d; }, 0);
    anim = a;
    sel = -1; dragging = false;
    phase = 'anim';
    Lehcim.play('pick', 0.5);
  }
  function stepAt(a, t) {
    var acc = 0;
    for (var k = 0; k < a.steps.length; k++) {
      var s = a.steps[k];
      if (t < acc + s.d) return { name: s.name, u: (t - acc) / s.d };
      acc += s.d;
    }
    return { name: 'end', u: 1 };
  }
  function ease(u) { return u * u * (3 - 2 * u); }
  // Returns {stacks: {sq: drawFn}, extra: [{sq, draw}]} for the current frame.
  function animState(now) {
    var a = anim, s = stepAt(a, now - a.t0), out = { stacks: {}, extra: [] };
    var bf = a.before, x0 = cellX(a.from), z0 = cellZ(a.from), x1 = cellX(a.to), z1 = cellZ(a.to);
    var dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz), axX = -dz / dl, axZ = dx / dl; // turning axis
    var fromRest = bf[a.from].slice(0, bf[a.from].length - 1);
    var yFrom = floorY(a.from) + (bf[a.from].length - 0.5) * TH;
    if (s.name === 'flipTarget') {
      // the opponent pieces of the target stack jump up and turn over
      var tgt = bf[a.to], u = s.u, hgt = Math.sin(Math.PI * u) * 1.6;
      out.stacks[a.to] = function () {
        tgt.forEach(function (c, k) {
          var cc = c === a.c ? c : (u < 0.5 ? c : a.c), rot = c === a.c ? 0 : Math.PI * u;
          // the piece is drawn with its final colour once past half a turn
          drawPiece(x1, floorY(a.to) + (k + 0.5) * TH + hgt * (1 + k * 0.15), z1, rot > Math.PI / 2 ? 1 - cc : cc, rot > Math.PI / 2 ? rot - Math.PI : rot, 1, 0);
        });
      };
      return out;
    }
    if (s.name === 'jump') {
      var u2 = s.u;
      out.stacks[a.from] = function () { drawStack(a.from, fromRest); };
      if (a.kind === R.PRISON) {
        // the target stack goes up, the piece slides in at floor level, the stack comes down
        var tg = bf[a.to], lift, px, pz, py;
        if (u2 < 0.4) { var v = ease(u2 / 0.4); lift = v * TH * 1.6; px = x0 + dx * 0.45 * v; pz = z0 + dz * 0.45 * v; py = yFrom + Math.sin(Math.PI * v) * 0.6 + (floorY(a.to) + TH / 2 - yFrom) * v; }
        else if (u2 < 0.75) { var w2 = ease((u2 - 0.4) / 0.35); lift = TH * 1.6; px = x0 + dx * (0.45 + 0.55 * w2); pz = z0 + dz * (0.45 + 0.55 * w2); py = floorY(a.to) + TH / 2; }
        else { var w3 = ease((u2 - 0.75) / 0.25); lift = TH * (1.6 - 0.6 * w3); px = x1; pz = z1; py = floorY(a.to) + TH / 2; }
        out.stacks[a.to] = function () { drawPiece(px, py, pz, a.c); drawStack(a.to, tg, lift); };
        if (u2 < 0.75) { out.stacks[a.to] = function () { drawStack(a.to, tg, lift); }; out.extra.push({ sq: u2 < 0.4 ? a.from : a.to, draw: function () { drawPiece(px, py, pz, a.c); } }); }
        return out;
      }
      var e = ease(u2), tgt2 = a.kind === R.CAPTURE ? a.after[a.to].slice(0, a.after[a.to].length - 1) : bf[a.to];
      var yTo = floorY(a.to) + (tgt2.length + 0.5) * TH;
      var hop = 0.9 + Math.max(0, yTo - yFrom) * 0.6;
      var mx = x0 + dx * e, mz = z0 + dz * e, my = yFrom + (yTo - yFrom) * e + Math.sin(Math.PI * u2) * hop;
      out.stacks[a.to] = function () { drawStack(a.to, tgt2); };
      out.extra.push({ sq: e < 0.5 ? a.from : a.to, draw: function () { drawPiece(mx, my, mz, a.c, 2 * Math.PI * e, axX, axZ); } });
      return out;
    }
    if (s.name === 'flipAfter') {
      // revolution (target) or pieces left in minority (source) turn over in place
      var sq = a.info.revolt ? a.to : a.from, fin = a.after[sq], u3 = s.u;
      var old = a.info.revolt ? bf[a.to].concat([]) : fromRest;
      if (a.info.revolt) old = [a.c].concat(bf[a.to]);
      out.stacks[sq] = function () {
        old.forEach(function (c, k) {
          var changes = c !== fin[k], rot = changes ? Math.PI * u3 : 0, cc = changes && rot > Math.PI / 2 ? fin[k] : c;
          drawPiece(cellX(sq), floorY(sq) + (k + 0.5) * TH + (changes ? Math.sin(Math.PI * u3) * 0.5 : 0), cellZ(sq), cc, rot > Math.PI / 2 ? rot - Math.PI : rot, 1, 0);
        });
      };
      if (sq !== a.to) out.stacks[a.to] = function () { drawStack(a.to, a.after[a.to]); };
      else out.stacks[a.from] = function () { drawStack(a.from, a.after[a.from]); };
      return out;
    }
    out.stacks[a.from] = function () { drawStack(a.from, a.after[a.from]); };
    out.stacks[a.to] = function () { drawStack(a.to, a.after[a.to]); };
    return out;
  }

  // Start of a game: the pieces of the previous game fly away, then the new pieces fall on the board.
  function startDrop(oldStacks, then) {
    var t0 = performance.now(), newStacks = stacksOf(pos), leave = [], fall = [];
    var k = 0, i, j;
    if (oldStacks) for (i = 0; i < N * N; i++) for (j = 0; j < oldStacks[i].length; j++) leave.push({ sq: i, k: j, c: oldStacks[i][j], t0: t0 + ((i / N) | 0) * 60 });
    var leaveEnd = leave.length ? t0 + 5 * 60 + 450 + 400 : t0;
    for (i = 0; i < N * N; i++) for (j = 0; j < newStacks[i].length; j++) { fall.push({ sq: i, k: j, c: newStacks[i][j], t0: leaveEnd + (k % 4) * 40 }); k++; }
    var end = leaveEnd + 3 * 40 + 450;
    drop = {
      end: end, then: then,
      stacks: function (now) { // pieces resting on the board
        var s = []; for (var q = 0; q < N * N; q++) s.push([]);
        leave.forEach(function (p) { if (now < p.t0) s[p.sq].push(p.c); });
        fall.forEach(function (p) { if (now >= p.t0 + 450) s[p.sq].push(p.c); });
        return s;
      },
      flying: function (now) {
        var out = [];
        leave.forEach(function (p) {
          var u = (now - p.t0) / 450; if (u < 0 || u >= 1) return;
          out.push({ sq: p.sq, x: cellX(p.sq), z: cellZ(p.sq), y: floorY(p.sq) + (p.k + 0.5) * TH + u * u * 6, c: p.c, rot: 0 });
        });
        fall.forEach(function (p) {
          var u = (now - p.t0) / 450; if (u < 0 || u >= 1) return;
          out.push({ sq: p.sq, x: cellX(p.sq), z: cellZ(p.sq), y: floorY(p.sq) + (p.k + 0.5) * TH + (1 - u) * (1 - u) * 6, c: p.c, rot: 0 });
        });
        return out;
      }
    };
    phase = phase === 'intro' ? 'intro' : 'drop';
  }

  // ---------- Game flow ----------

  function setStatus(t) { statusEl.textContent = t; }

  function newGame(p) {
    human = starterSel.value === 'human' ? 0 : 1;
    var old = lastStacks;
    sel = -1; anim = null; banner = null; setupStacks = null; showYourTurn = false;
    if (p) { pos = p; pos.side = 0; showYourTurn = true; phase = 'play'; lastStacks = stacksOf(pos); nextTurn(); return; }
    pos = R.initial(human); pos.side = 0;
    setStatus('');
    if (!playedIntro) { playedIntro = true; startIntro(); return; }
    startDrop(old, function () { lastStacks = stacksOf(pos); nextTurn(); });
  }

  function nextTurn() {
    var ms = R.moves(pos);
    if (!ms.length) { endGame(1 - pos.side === human); return; }
    if (pos.side === human) {
      phase = 'play';
      setStatus('A toi de jouer (' + (human === 0 ? 'blancs' : 'noirs') + ')');
    } else {
      phase = 'think';
      setStatus("L'ordinateur réfléchit...");
      setTimeout(function () {
        if (phase !== 'think') return;
        var m = R.think(pos, level);
        startMove(m);
      }, 80);
    }
  }

  function msgBox(caption, text) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      var h = document.createElement('h2'); h.textContent = caption; d.appendChild(h);
      var p = document.createElement('p'); p.textContent = text; d.appendChild(p);
      var row = document.createElement('div'); row.className = 'row';
      var b = document.createElement('button'); b.textContent = 'OK'; row.appendChild(b); d.appendChild(row);
      b.addEventListener('click', function () { d.close(); });
      d.addEventListener('close', function () { d.remove(); resolve(); });
      document.body.appendChild(d); d.showModal(); b.focus();
    });
  }

  function endGame(humanWon) {
    phase = 'ended'; sel = -1; showYourTurn = false;
    lastStacks = stacksOf(pos);
    setStatus(humanWon ? 'Tu as gagné !' : 'Tu as perdu...');
    Lehcim.play(humanWon ? 'win' : 'lose');
    msgBox(humanWon ? 'Tu as gagné!' : 'Tu as perdu...', humanWon ? 'Bravo' : 'Dommage').then(function () { phase = 'over'; });
  }

  function finishMove() {
    var a = anim, kind = a.kind;
    anim = null;
    R.play(pos, a.m, {});
    lastStacks = stacksOf(pos);
    if (kind === R.CAPTURE) Lehcim.play('capture'); else if (kind === R.PRISON) Lehcim.play('prison'); else Lehcim.play('drop');
    if (a.info.revolt || a.info.lost) Lehcim.play('revolt');
    nextTurn();
  }

  // ---------- Input ----------

  // Squares under the canvas point (px, py), nearest first: those whose column
  // (floor square up to the top of its stack) contains the point.
  function pickAll(px, py) {
    setupCamera();
    var order = [], out = [];
    for (var i = 0; i < N * N; i++) order.push(i);
    order.sort(function (a, b) { return distTo(cellX(a), cellZ(a)) - distTo(cellX(b), cellZ(b)); });
    var stacks = setupStacks || stacksOf(pos);
    for (var k = 0; k < order.length; k++) {
      var sq = order[k], x = cellX(sq), z = cellZ(sq), y0 = floorY(sq), y1 = y0 + stacks[sq].length * TH;
      var pts = [];
      [y0, y1].forEach(function (y) { topQuad(x - 0.5, x + 0.5, z - 0.5, z + 0.5, y).forEach(function (p) { pts.push(p); }); });
      if (inPoly(px, py, hull(pts))) out.push(sq);
    }
    return out;
  }
  function pick(px, py) { var l = pickAll(px, py); return l.length ? l[0] : -1; }
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
  // `to` is a list of candidate squares (under the pointer, nearest first).
  function tryMove(to, prison) {
    for (var k = 0; k < to.length; k++) {
      var m = to[k] === sel ? -1 : findMove(sel, to[k], prison);
      if (m >= 0) { setPrisonToggle(false); showYourTurn = false; startMove(m); return true; }
    }
    return false;
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = Lehcim.canvasPos(canvas, e);
    if (phase === 'title') { newGameClick(); return; }
    var under = pickAll(p.x, p.y), sq = under.length ? under[0] : -1; hover = sq;
    var rightBtn = e.button === 2;
    if (phase === 'setup') { setupClick(sq, rightBtn || prisonToggle ? 1 : 0); return; }
    if (phase !== 'play' || sq < 0) return;
    var prison = rightBtn || prisonToggle;
    // second click of a click-click move (touch screens)
    if (sel >= 0 && sq !== sel) {
      if (tryMove(under, prison || selPrison)) return;
    }
    if (pos.col[sq] === human && canStart(sq, prison)) {
      sel = sq; selPrison = prison; dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else sel = -1;
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = Lehcim.canvasPos(canvas, e);
    hover = phase === 'title' || phase === 'intro' ? -1 : pick(p.x, p.y);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    var p = Lehcim.canvasPos(canvas, e), under = pickAll(p.x, p.y), sq = under.length ? under[0] : -1;
    if (phase !== 'play' || sel < 0 || sq < 0) return;
    if (tryMove(under, selPrison)) return;
    if (sq !== sel) sel = -1; // released on the piece itself: stay selected (click-click mode)
  });
  canvas.addEventListener('pointerleave', function () { if (!dragging) hover = -1; });

  // Arrows: turn around the board (one 256th of a turn per key press, up to half a turn
  // each way) and lean over it (up to a view from above).
  function rotate(dy, dp) {
    if (phase !== 'play' && phase !== 'think' && phase !== 'anim' && phase !== 'ended' && phase !== 'over') return;
    cam.yaw = Math.max(-Math.PI, Math.min(Math.PI, cam.yaw + dy * STEP));
    cam.pitch = Math.max(PITCH0, Math.min(PITCH_MAX, cam.pitch + dp * STEP));
  }
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var k = e.key;
    if (k === 'ArrowLeft') rotate(-1, 0); else if (k === 'ArrowRight') rotate(1, 0);
    else if (k === 'ArrowUp') rotate(0, 1); else if (k === 'ArrowDown') rotate(0, -1);
    else if (k === 'Escape') { sel = -1; return; }
    else return;
    e.preventDefault();
  });
  // view buttons (touch screens): keep turning while pressed
  [['rotL', -1, 0], ['rotR', 1, 0], ['tiltU', 0, 1], ['tiltD', 0, -1]].forEach(function (b) {
    var el = document.getElementById(b[0]), timer = null;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); stop(); rotate(b[1], b[2]); timer = setInterval(function () { rotate(b[1], b[2]); }, 40); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, stop); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });

  var prisonBtn = document.getElementById('prison');
  function setPrisonToggle(v) { prisonToggle = v; prisonBtn.classList.toggle('on', v); if (sel >= 0 && !dragging) selPrison = v; }
  prisonBtn.addEventListener('click', function () { setPrisonToggle(!prisonToggle); prisonBtn.blur(); });

  // ---------- Menu ----------

  function busy() { msgBox('Partie en cours', "Abandonne d'abord"); }
  function newGameClick() {
    if (inGame()) { busy(); return; }
    newGame();
  }
  document.getElementById('new').addEventListener('click', function (e) { e.currentTarget.blur(); newGameClick(); });
  document.getElementById('resign').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (phase === 'play' || phase === 'think' || phase === 'anim') {
      if (anim) { R.play(pos, anim.m, {}); anim = null; }
      lastStacks = stacksOf(pos); sel = -1; showYourTurn = false;
      phase = 'over'; setStatus('');
    }
  });
  var levelSel = document.getElementById('level');
  try { var lv = localStorage.getItem('lehcim.agora.level'); if (lv) levelSel.value = lv; } catch (e) { /* ignore */ }
  level = +levelSel.value;
  levelSel.addEventListener('change', function () { level = +levelSel.value; try { localStorage.setItem('lehcim.agora.level', levelSel.value); } catch (e) { /* ignore */ } levelSel.blur(); });
  var starterSel = document.getElementById('starter'), starterVal = starterSel.value;
  starterSel.addEventListener('change', function () {
    starterSel.blur();
    if (inGame()) { starterSel.value = starterVal; busy(); return; }
    starterVal = starterSel.value;
  });
  document.getElementById('howto').addEventListener('click', function (e) { e.currentTarget.blur(); document.getElementById('howtoDlg').showModal(); });

  // ---------- Nouvelle Position ----------

  document.getElementById('setup').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (inGame()) { busy(); return; }
    startSetup();
  });
  function startSetup() {
    human = starterSel.value === 'human' ? 0 : 1;
    setupStacks = []; for (var i = 0; i < N * N; i++) setupStacks.push([]);
    setupCount = 0; sel = -1; anim = null; drop = null; banner = null; showYourTurn = false;
    phase = 'setup';
    setStatus('Clic gauche : pièce blanche, clic droit : pièce noire');
  }
  // Segments of a stack (bottom -> top): 'ok', 'incomplete' (prisoners in majority) or 'bad' (3 segments).
  function stackState(s) {
    if (!s.length) return 'ok';
    var c = s[s.length - 1], k = s.length - 1, t = 0;
    while (k >= 0 && s[k] === c) { t++; k--; }
    var b = k + 1;
    for (; k >= 0; k--) if (s[k] === c) return 'bad';
    return b > t ? 'incomplete' : 'ok';
  }
  function anyIncomplete() { return setupStacks.some(function (s) { return stackState(s) === 'incomplete'; }); }
  function setupClick(sq, c) {
    if (sq < 0 || (banner && banner.until)) return;
    var s = setupStacks[sq].concat([c]);
    if (stackState(s) === 'bad') return;        // a third layer is refused
    setupStacks[sq] = s; setupCount++;
    Lehcim.play('drop', 0.5);
    banner = anyIncomplete() ? { spr: ['incomplete1', 'incomplete2'] } : null;
    if (setupCount < 16) return;
    if (anyIncomplete()) {
      banner = { spr: ['impossible1', 'impossible2'], until: performance.now() + 1100, done: startSetup };
      Lehcim.play('bad', 0.6);
      return;
    }
    var p = R.Pos.fromStacks(setupStacks, 0);
    setupStacks = null;
    newGame(p);
  }

  // ---------- Intro (first game): "LEHCIM NOIL PRESENTE" dissolves into the AGORA logo,
  // the board flies in from the sky, its pieces fly off and the real ones fall ----------

  var introT0 = 0;
  function startIntro() {
    introT0 = performance.now();
    phase = 'intro';
    Lehcim.play('intro');
  }
  function frameAt(t) {
    if (t < 1600) return 0;
    if (t < 2200) return 1 + Math.min(8, Math.floor((t - 1600) / 67));
    if (t < 2500) return 10 + Math.min(4, Math.floor((t - 2200) / 60));
    return 15 + Math.floor((t - 2500) / 150) % 3;
  }
  // Draws the title part of the intro; returns true when the board must not be drawn yet.
  function drawIntro(now) {
    var t = now - introT0;
    if (t < 3600) {
      if (title) ctx.drawImage(title, 0, 0);
      var f = FRAMES[frameAt(t)];
      if (sheet) ctx.drawImage(sheet, f[0], f[1], 300, 80, 170, 160, 300, 80);
      if (t > 3200) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, (t - 3200) / 400) + ')'; ctx.fillRect(0, 0, W, H); }
      return true;
    }
    if (t < 4600) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (t > 3900 && stars) { ctx.globalAlpha = Math.min(1, (t - 3900) / 700); ctx.drawImage(stars, 0, 0); ctx.globalAlpha = 1; }
      return true;
    }
    // board flying in (4.6 s -> 8.2 s), carrying 16 white pieces
    if (t < 8200) {
      var u = (t - 4600) / 3600, e = 1 - Math.pow(1 - u, 3);
      xf = { ang: (1 - e) * 1.1, dx: (1 - e) * 9, dy: (1 - e) * 2, dz: -(1 - e) * 14 };
    } else xf = null;
    return false;
  }
  function introBoardStacks() {
    return stacksOf(pos).map(function (st) { return st.map(function () { return 0; }); });
  }

  // ---------- Main loop ----------

  function loop(now) {
    if (phase === 'intro') {
      var t = now - introT0;
      if (t >= 4600 && t < 8200) {
        // during the fly-in the board shows the starting squares occupied by white pieces
        drop = { stacks: introBoardStacks, flying: function () { return []; } };
      } else if (t >= 8200 && (!drop || !drop.end)) {
        startDrop(introBoardStacks(), function () { lastStacks = stacksOf(pos); nextTurn(); });
      }
    }
    if (drop && drop.end && now >= drop.end) { var f = drop.then; drop = null; xf = null; if (f) f(); }
    if (anim && now - anim.t0 >= anim.dur) finishMove();
    draw(now);
    requestAnimationFrame(loop);
  }

  Lehcim.initPage();
  Lehcim.fitCanvas(canvas);
  setStatus('Chargement...');
  // sounds are decoded after the first user gesture (browser autoplay policy)
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  Promise.all([
    Promise.all(TEX_IDS.map(function (id) { return Lehcim.loadImage(A + id + '.png').then(function (im) { tex[id] = im; }); })),
    Lehcim.loadSheet(A + '39.png', [250, 250, 250]).then(function (s) { sheet = s; }),
    Lehcim.loadImage(A + '40.png').then(function (im) { stars = im; }),
    Lehcim.loadImage(A + '42.png').then(function (im) { title = im; })
  ]).then(function () {
    setStatus('');
    phase = 'title';
    requestAnimationFrame(loop);
  }).catch(function (e) { setStatus('Erreur de chargement'); console.error(e); });

  // For automated tests.
  window.AgoraGame = {
    state: function () { return { phase: phase, side: pos.side, human: human, sel: sel, result: statusEl.textContent, key: pos.key(), setupCount: setupCount }; },
    pos: function () { return pos; },
    pick: function (x, y) { return pick(x, y); },
    screenOf: function (sq, y) { setupCamera(); return proj(cellX(sq), floorY(sq) + (y || 0), cellZ(sq)); },
    topOf: function (sq) { setupCamera(); return proj(cellX(sq), floorY(sq) + pos.height(sq) * TH, cellZ(sq)); },
    skipIntro: function () { playedIntro = true; newGame(); },
    setLevel: function (l) { level = l; },
    rotate: rotate
  };
})();
