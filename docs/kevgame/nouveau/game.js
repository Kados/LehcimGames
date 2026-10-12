/*
 * KevGame (nouvelle version) - page, drawing, input, sounds and match flow.
 * The rules and the computer player live in engine.js (global KevEngine).
 *
 * Canvas = the original 600x408 window drawn with the original sprite sheet
 * (see ../game.js for the sheet layout). New in this version: fixed time step
 * (0.02 s) and seeded random numbers, countdown, pause, side panel (timer, air
 * gauges, walls, firecracker, results, records), touch pad, input buffering,
 * round summaries.
 */
(function () {
  'use strict';

  var K = window.KevEngine;
  var canvas = document.getElementById('game'), g = canvas.getContext('2d');
  var stage = document.getElementById('stage'), overlay = document.getElementById('overlay');
  var $ = function (id) { return document.getElementById(id); };
  var sheet = null;
  var OX = 48, OY = 48;     // pool origin in the background
  var STEP = 0.02;          // fixed simulation step (s)
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

  // ---------- Sounds ----------
  // 1/2 breathing, 3 wall, 4 time is up, 5 suffocation, 6 explosion, 7 worm eaten, 8 bonus.
  var SND = {};
  for (var n = 1; n <= 8; n++) SND[n] = '../assets/sounds/' + n + '.wav';
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true }); });
  function snd(k, v) { Lehcim.play(String(k), v); }

  // ---------- Options (localStorage) ----------
  var PREFIX = 'lehcim.kevgame.nv.';
  function loadOpt(k, def) { try { var v = localStorage.getItem(PREFIX + k); return v == null ? def : v; } catch (e) { return def; } }
  function saveOpt(k, v) { try { localStorage.setItem(PREFIX + k, v); } catch (e) { /* ignore */ } }
  var opts = {
    mode: loadOpt('mode', '1'), level: loadOpt('level', '1'),
    music: loadOpt('music', '1') === '1', countdown: loadOpt('countdown', '1') === '1', seed: loadOpt('seed', '')
  };

  function segInit(id, key) {
    var seg = $(id);
    function show() { seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === opts[key])); }); }
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      opts[key] = b.dataset.v; saveOpt(key, opts[key]); show(); refreshIdle();
    });
    show();
  }
  segInit('segMode', 'mode');
  segInit('segLevel', 'level');
  $('optMusic').checked = opts.music;
  $('optMusic').addEventListener('change', function () {
    opts.music = this.checked; saveOpt('music', opts.music ? '1' : '0');
    if (!opts.music) Lehcim.stopMusic(); else if (phase !== 'idle' && phase !== 'over') Lehcim.playMidi('../assets/music.mid', { loop: true });
  });
  $('optCountdown').checked = opts.countdown;
  $('optCountdown').addEventListener('change', function () { opts.countdown = this.checked; saveOpt('countdown', opts.countdown ? '1' : '0'); });
  $('optSeed').value = opts.seed;
  $('optSeed').addEventListener('input', function () { opts.seed = this.value.replace(/[^0-9]/g, ''); this.value = opts.seed; saveOpt('seed', opts.seed); });
  $('seedLast').addEventListener('click', function () { if (seed != null) { opts.seed = String(seed); $('optSeed').value = opts.seed; saveOpt('seed', opts.seed); } });
  $('settingsBtn').addEventListener('click', function () { if (phase === 'play' || phase === 'countdown') setPaused(true); $('settings').showModal(); });

  // ---------- Match state ----------
  var phase = 'idle';   // idle, countdown, play, dying, signs, summary, over
  var phaseT = 0;
  var paused = false;
  var st = null, results = [], stats = [], match = null;
  var ai = [null, null];   // computer brains (null = human)
  var effects = [], floats = [];
  var clock = 0, acc = 0, seed = null, level = 1, onePlayer = true;
  var lowAirWarned = [false, false];

  function names() { return onePlayer ? ['l\'ordinateur', 'le joueur'] : ['gauche', 'droite']; }
  function shortName(s) { return onePlayer ? (s === 0 ? 'Ordinateur' : 'Vous') : (s === 0 ? 'Gauche' : 'Droite'); }
  function human(s) { return !ai[s]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function capLines(t) { return t.split('\n').map(cap).join('\n'); }

  function newGame() {
    onePlayer = opts.mode === '1';
    level = +opts.level;
    seed = opts.seed ? (+opts.seed >>> 0) : Math.floor(Math.random() * 1e9);
    results = []; stats = []; match = null;
    ai = [onePlayer ? K.newBrain(level) : null, null];
    paused = false;
    if (opts.music) Lehcim.playMidi('../assets/music.mid', { loop: true });
    startRound(0);
    renderResults();
  }

  function startRound(r) {
    st = K.newRound(r, K.mulberry32(seed + r * 7919));
    if (ai[0]) ai[0] = K.newBrain(level);
    if (ai[1]) ai[1] = K.newBrain(ai[1].level);
    effects = []; floats = []; held = [[], []]; buf = [null, null]; pointer = null; acc = 0;
    lowAirWarned = [false, false];
    stats[r] = [0, 1].map(function () { return { breaths: 0, walls: 0, booms: 0, bonus: 0 }; });
    setPhase(opts.countdown ? 'countdown' : 'play');
    hideOverlay();
    drawIcons();
    updatePanel(true);
  }

  function setPhase(p) { phase = p; phaseT = 0; updateStatus(); }

  function abandon() {
    if (phase === 'idle' || phase === 'over') return;
    st = null; paused = false; Lehcim.stopMusic(); setPhase('idle'); showIdle();
    toast('Partie abandonnée');
  }

  function setPaused(p) {
    if (p && !(phase === 'play' || phase === 'countdown')) return;
    if (paused === p) return;
    paused = p;
    $('pauseBtn').setAttribute('aria-pressed', String(p));
    $('pauseBtn').textContent = p ? 'Reprendre' : 'Pause';
    if (p) {
      held = [[], []]; pointer = null;
      showOverlay('<h2>Pause</h2><p>La partie est arrêtée. Le temps ne compte pas.</p>' +
        '<div class="btns"><button class="btn primary" id="ovResume">Reprendre</button><button class="btn" id="ovQuit">Abandonner</button></div>' +
        '<p class="sub hide-s"><kbd>P</kbd> ou <kbd>Échap</kbd> pour reprendre</p>');
      $('ovResume').addEventListener('click', function () { setPaused(false); });
      $('ovQuit').addEventListener('click', abandon);
      $('ovResume').focus();
    } else {
      hideOverlay();
      // a short countdown to get ready again
      if (phase === 'play' && opts.countdown) { resumeT = 1; }
    }
    updateStatus();
  }
  var resumeT = 0;

  // ---------- Status and side panel ----------
  function roleText(a) { return a.kind === 'fish' ? 'poisson' : 'ver'; }

  function updateStatus() {
    var s = '', sub = '';
    if (!st || phase === 'idle') {
      s = 'KevGame';
      sub = (opts.mode === '1' ? 'Contre l\'ordinateur, niveau ' + K.LEVELS[+opts.level].name.toLowerCase() : 'Deux joueurs') + '. Appuyez sur « Nouvelle partie ».';
    } else if (phase === 'over') {
      s = 'Partie terminée'; sub = match ? overTitle() : '';
    } else {
      var f = K.fish(st), w = K.worm(st);
      if (paused) s = 'Pause';
      else if (onePlayer) s = 'Manche ' + (st.round + 1) + '/2 : vous êtes le ' + roleText(st.animals[1]);
      else s = 'Manche ' + (st.round + 1) + '/2';
      if (onePlayer) {
        sub = st.animals[1].kind === 'worm' ? 'Fuyez le poisson pendant 90 s et allez respirer dans les bulles.' : 'Attrapez le ver avant la fin du temps, sans oublier de respirer.';
      } else {
        sub = 'Poisson : ' + shortName(f.side).toLowerCase() + ' - ver : ' + shortName(w.side).toLowerCase() + '.';
      }
    }
    $('status').textContent = s;
    $('substatus').textContent = sub;
  }

  var panelCache = {};
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function updatePanel(force) {
    var t = st ? st.t : 0, left = Math.max(0, Math.ceil(K.CFG.roundTime - t));
    setText($('roundTitle'), st ? 'Manche ' + (st.round + 1) + ' sur 2' : 'Manche');
    setText($('timeLeft'), String(left));
    $('timer').classList.toggle('hurry', !!st && left <= 10 && phase === 'play');
    var tw = (st ? Math.max(0, 1 - t / K.CFG.roundTime) * 100 : 100).toFixed(1) + '%';
    if (panelCache.tw !== tw || force) { $('timeBar').style.width = tw; panelCache.tw = tw; }
    for (var s = 0; s < 2; s++) {
      var el = $('pl' + s), a = st ? st.animals[s] : null;
      el.classList.toggle('me', onePlayer ? s === 1 : false);
      setText(el.querySelector('.n'), shortName(s));
      setText(el.querySelector('.r'), a ? (a.kind === 'fish' ? 'Poisson' : 'Ver') + (ai[s] ? ' - ' + K.LEVELS[ai[s].level].name.toLowerCase() : '') : '-');
      var air = a ? Math.max(0, a.air) : 1;
      setText(el.querySelector('.airv'), Math.round(air * 100) + ' %');
      var bar = el.querySelector('.bar.air');
      bar.classList.toggle('low', air < 0.25);
      var aw = (air * 100).toFixed(0) + '%';
      if (bar.firstChild.style.width !== aw) bar.firstChild.style.width = aw;
      var walls = a ? a.walls : 0, wtxt = '';
      for (var i = 0; i < K.CFG.maxWalls; i++) wtxt += i < walls ? '●' : '○';
      setText(el.querySelector('.walls'), wtxt);
      var ch = a ? a.charge : 0;
      setText(el.querySelector('.pv'), ch > 0 ? Math.ceil(ch) + ' s' : '-');
      var pw = (ch / K.CFG.chargeTime * 100).toFixed(0) + '%';
      var pb = el.querySelector('.bar.petard > i');
      if (pb.style.width !== pw) pb.style.width = pw;
    }
  }

  function drawIcons() {
    if (!sheet) return;
    for (var s = 0; s < 2; s++) {
      var c = $('pl' + s).querySelector('canvas'), x = c.getContext('2d');
      x.clearRect(0, 0, 24, 24); x.imageSmoothingEnabled = false;
      var kind = st ? st.animals[s].kind : (s === 0 ? 'fish' : 'worm');
      x.drawImage(sheet, 600 + 24 * (kind === 'fish' ? 6 : 0), 24 * (s === 0 ? 1 : 3), 24, 24, 0, 0, 24, 24);
    }
  }

  function fmtT(t) { return String(t).replace('.', ',') + ' s'; }

  function renderResults() {
    var el = $('results');
    if (!results.length) {
      el.innerHTML = '<span class="muted">Aucune manche jouée.</span>' + (seed != null ? '<span class="muted">Graine : ' + seed + '</span>' : '');
      return;
    }
    var html = '';
    results.forEach(function (r, i) {
      var who = r.winner < 0 ? 'ex aequo' : shortName(r.winner);
      var how = { catch: 'ver attrapé', time: 'temps écoulé', air: 'manque d\'air', both: 'les deux sans air' }[r.how];
      html += '<div><b>Manche ' + (i + 1) + '</b> : ' + who + ' (' + how + ', ' + fmtT(r.time) + ')</div>';
    });
    if (match) html += '<div><b>' + (match.winner < 0 ? 'Personne n\'a gagné' : shortName(match.winner) + (onePlayer && match.winner === 1 ? ' avez gagné' : ' a gagné')) + '</b></div>';
    html += '<span class="muted">Graine : ' + seed + '</span>';
    el.innerHTML = html;
  }

  // Records (one-player mode): wins / losses / draws per level, fastest catch as the fish.
  function loadRec() { try { return JSON.parse(localStorage.getItem(PREFIX + 'records')) || {}; } catch (e) { return {}; } }
  function saveRec(r) { try { localStorage.setItem(PREFIX + 'records', JSON.stringify(r)); } catch (e) { /* ignore */ } }
  function renderRecords() {
    var r = loadRec(), html = '';
    K.LEVELS.forEach(function (L, i) {
      var x = r[i] || { w: 0, l: 0, d: 0 };
      html += '<div>' + L.name + ' : <b>' + x.w + '</b> victoire' + (x.w > 1 ? 's' : '') + ', ' + x.l + ' défaite' + (x.l > 1 ? 's' : '') + (x.d ? ', ' + x.d + ' nul' + (x.d > 1 ? 's' : '') : '') +
        (x.best ? '<br><span class="muted">Ver attrapé le plus vite : ' + fmtT(x.best) + '</span>' : '') + '</div>';
    });
    $('records').innerHTML = html + '<span class="muted">Parties contre l\'ordinateur.</span>';
  }

  // ---------- Overlay ----------
  function showOverlay(html) { overlay.innerHTML = html; overlay.hidden = false; }
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }

  function showIdle() {
    var lv = K.LEVELS[+opts.level].name.toLowerCase();
    showOverlay('<h2>KevGame</h2><p class="big">Le poisson et le ver</p>' +
      '<ul><li>Le <b>poisson</b> doit attraper le <b>ver</b> en moins de 90 secondes.</li>' +
      '<li>Les deux doivent respirer dans les <b>zones à bulles</b> avant de manquer d\'air.</li>' +
      '<li>Une <b>bouée</b> clignotante donne un mur (posé derrière soi), un <b>pétard</b> fait sauter les murs devant soi.</li>' +
      '<li>2 manches, les rôles s\'inversent : le plus rapide à gagner sa manche l\'emporte.</li></ul>' +
      '<p id="ovMode">' + (opts.mode === '1' ? 'Contre l\'ordinateur (niveau ' + lv + ') : vous êtes le joueur de droite.' : 'Deux joueurs sur le même clavier.') + '</p>' +
      '<div class="btns"><button class="btn primary" id="ovPlay">Jouer</button><button class="btn" id="ovSet">Réglages</button><button class="btn" id="ovHelp">Règles</button></div>');
    $('ovPlay').addEventListener('click', function () { newGame(); });
    $('ovSet').addEventListener('click', function () { $('settings').showModal(); });
    $('ovHelp').addEventListener('click', function () { $('help').showModal(); });
  }
  function refreshIdle() { if (phase === 'idle') { showIdle(); updateStatus(); } }

  function statTable(r) {
    var s = stats[r], rows = [['Respirations', 'breaths'], ['Murs construits', 'walls'], ['Démolitions', 'booms'], ['Bonus ramassés', 'bonus']];
    var html = '<table><tr><th></th><th>' + shortName(0) + ' (' + (r === 0 ? 'poisson' : 'ver') + ')</th><th>' + shortName(1) + ' (' + (r === 0 ? 'ver' : 'poisson') + ')</th></tr>';
    rows.forEach(function (x) { html += '<tr><td>' + x[0] + '</td><td>' + s[0][x[1]] + '</td><td>' + s[1][x[1]] + '</td></tr>'; });
    return html + '</table>';
  }

  function showSummary() {
    var r = st.result, title;
    if (r.winner < 0) title = 'Ex aequo';
    else if (onePlayer) title = r.winner === 1 ? 'Manche gagnée !' : 'Manche perdue';
    else title = shortName(r.winner) + ' gagne la manche';
    showOverlay('<h2>' + title + '</h2><p>' + capLines(K.roundText(st, names())) + '</p>' + '<div class="hide-s">' + statTable(st.round) + '</div>' +
      '<p class="hide-s">Les rôles sont maintenant inversés' + (onePlayer ? ' : vous serez le ' + (st.animals[1].kind === 'fish' ? 'ver' : 'poisson') + '.' : '.') + '</p>' +
      '<div class="btns"><button class="btn primary" id="ovNext">Manche suivante</button></div>');
    $('ovNext').addEventListener('click', function () { startRound(1); });
    $('ovNext').focus();
  }

  function overTitle() {
    if (match.winner < 0) return 'Personne n\'a gagné';
    if (onePlayer) return match.winner === 1 ? 'Vous avez gagné !' : 'L\'ordinateur a gagné';
    return shortName(match.winner) + ' a gagné la partie !';
  }
  function showOver() {
    var title = overTitle();
    // the king (winner) or the grinning face (nobody), from the original sheet
    var face = '<canvas id="ovFace" width="24" height="24" style="width:72px;height:72px;image-rendering:pixelated" aria-hidden="true"></canvas>';
    showOverlay('<div class="hide-s">' + face + '</div><h2>' + title + '</h2><p style="white-space:pre-line">' + capLines(match.text) + '</p>' + '<div class="hide-s">' + statTable(1) + '</div>' +
      '<div class="btns"><button class="btn primary" id="ovAgain">Rejouer</button><button class="btn" id="ovSet2">Réglages</button></div>');
    var fc = $('ovFace').getContext('2d');
    fc.imageSmoothingEnabled = false;
    fc.drawImage(sheet, 600 + 24 * 20, 24 * (match.winner >= 0 ? 15 : 3), 24, 24, 0, 0, 24, 24);
    $('ovAgain').addEventListener('click', function () { newGame(); });
    $('ovSet2').addEventListener('click', function () { $('settings').showModal(); });
    $('ovAgain').focus();
  }

  // ---------- Toasts and floating texts ----------
  function toast(msg) {
    var box = $('toasts'), t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function floatText(txt, x, y, color) { floats.push({ txt: txt, x: x, y: y, t: 0, color: color || '#fff' }); }

  // ---------- Keyboard ----------
  var DIRKEYS = [
    { KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 },
    { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }
  ];
  var WALLKEYS = [{ Digit1: 1, Numpad1: 1 }, { Space: 1 }];
  var BOOMKEYS = [{ Digit2: 1, Numpad2: 1 }, { AltRight: 1, AltGraph: 1, Enter: 1, NumpadEnter: 1, ControlRight: 1 }];
  var held = [[], []];      // stack of held directions per side
  var buf = [null, null];   // buffered direction {d, t}: a short press is kept until the next cell

  function sideOfSet(set) { return ai[0] ? 1 : set; }
  function gameKey(e) {
    for (var s = 0; s < 2; s++) if (e.code in DIRKEYS[s] || e.code in WALLKEYS[s] || e.code in BOOMKEYS[s]) return s;
    if (e.key === 'AltGraph') return 1;
    return -1;
  }
  function press(side, d) {
    var h = held[side], i = h.indexOf(d);
    if (i >= 0) h.splice(i, 1);
    h.push(d);
    buf[side] = { d: d, t: clock };
  }
  function release(side, d) { var h = held[side], i = h.indexOf(d); if (i >= 0) h.splice(i, 1); }
  function action(side, wall) {
    if (phase !== 'play' || paused || !st || ai[side]) return;
    var a = st.animals[side];
    if (wall) { if (!K.buildWall(st, a)) toast(a.walls ? 'Pas de place pour un mur ici' : 'Pas de mur en réserve : passez sur une bouée'); }
    else if (!K.demolish(st, a)) toast('Pas de pétard : passez sur un pétard allumé');
  }

  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (phase === 'play' || phase === 'countdown') { setPaused(!paused); e.preventDefault(); }
      return;
    }
    var set = gameKey(e);
    if (set < 0) return;
    var playing = (phase === 'play' || phase === 'countdown') && !paused;
    if (e.code in DIRKEYS[set]) {
      e.preventDefault();
      if (playing && !e.repeat) press(sideOfSet(set), DIRKEYS[set][e.code]);
      return;
    }
    if (!playing) return; // Enter / Space keep their usual meaning on the overlay buttons
    e.preventDefault();
    if (e.repeat) return;
    action(sideOfSet(set), e.code in WALLKEYS[set]);
  });
  window.addEventListener('keyup', function (e) {
    var set = gameKey(e);
    if (set < 0 || !(e.code in DIRKEYS[set])) return;
    release(sideOfSet(set), DIRKEYS[set][e.code]);
  });
  window.addEventListener('blur', function () { held = [[], []]; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) setPaused(true); });

  // ---------- Touch: d-pad, buttons, and "hold the finger where to swim" ----------
  document.querySelectorAll('#touchpad [data-dir]').forEach(function (b) {
    var d = +b.dataset.dir, down = false;
    function up() { if (!down) return; down = false; b.classList.remove('pressed'); release(1, d); }
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault(); askSounds();
      if (phase !== 'play' && phase !== 'countdown') return;
      down = true; b.classList.add('pressed'); press(1, d);
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { b.addEventListener(ev, up); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  function tapButton(id, fn) {
    var b = $(id);
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('pressed'); fn(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { b.addEventListener(ev, function () { b.classList.remove('pressed'); }); });
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } });
  }
  tapButton('tWall', function () { action(1, true); });
  tapButton('tBoom', function () { action(1, false); });
  tapButton('tPause', function () { setPaused(!paused); });

  var pointer = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (phase !== 'play' || paused) return;
    pointer = Lehcim.canvasPos(canvas, e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) { if (pointer) pointer = Lehcim.canvasPos(canvas, e); });
  ['pointerup', 'pointercancel'].forEach(function (ev) { canvas.addEventListener(ev, function () { pointer = null; }); });

  // Direction for a human animal when it is on a cell. A buffered press wins
  // (so a quick tap to turn at the next crossing is never lost); if the way is
  // blocked it is kept a little longer, like a corner in a maze game.
  function humanDir(side) {
    var a = st.animals[side], b = buf[side];
    if (b) {
      if (clock - b.t > 0.45) buf[side] = null;
      else {
        var nx = a.cx + K.DX[b.d], ny = a.cy + K.DY[b.d];
        var free = nx >= 0 && ny >= 0 && nx < K.COLS && ny < K.ROWS && !st.walls[K.idx(nx, ny)];
        if (free) { buf[side] = null; return b.d; }
      }
    }
    var h = held[side];
    if (h.length) return h[h.length - 1];
    if (side === 1 && pointer) {
      var p = K.pos(a), vx = pointer.x - (OX + p.x + 12), vy = pointer.y - (OY + p.y + 12);
      if (Math.abs(vx) < 12 && Math.abs(vy) < 12) return -1;
      return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0);
    }
    return -1;
  }

  // ---------- Game loop (fixed time step) ----------
  var last = 0, speed = 1;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (!paused) update(dt * speed);
    if (sheet) draw();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    clock += dt; phaseT += dt;
    effects = effects.filter(function (f) { f.t += dt; return f.t < f.dur; });
    floats = floats.filter(function (f) { f.t += dt; return f.t < 1; });
    if (phase === 'countdown') {
      if (phaseT >= 3) { setPhase('play'); snd(8, 0.5); }
      updatePanel();
      return;
    }
    if (phase === 'play') {
      if (resumeT > 0) { resumeT -= dt; return; }
      acc += dt;
      while (acc >= STEP && !st.over) {
        acc -= STEP;
        var wants = [0, 1].map(function (s) {
          return ai[s] ? K.aiThink(st, st.animals[s], ai[s]) : function () { return humanDir(s); };
        });
        K.step(st, STEP, wants);
        handleEvents();
      }
      updatePanel();
      if (st.over) { setPhase('dying'); return; }
      st.animals.forEach(function (a) {
        if (!human(a.side)) return;
        if (a.air < 0.25 && !a.inZone && !lowAirWarned[a.side]) {
          lowAirWarned[a.side] = true;
          toast((onePlayer ? 'Vous manquez' : shortName(a.side) + ' manque') + ' d\'air : vite, une zone à bulles !');
        }
        if (a.inZone) lowAirWarned[a.side] = false;
      });
    } else if (phase === 'dying' && phaseT > 2.2) setPhase('signs');
    else if (phase === 'signs' && phaseT > 2.8) endOfRound();
  }

  function addFx(k, x, y, dur, extra) {
    var f = { k: k, x: x, y: y, t: 0, dur: dur };
    if (extra) for (var p in extra) f[p] = extra[p];
    effects.push(f);
  }

  function handleEvents() {
    var S = stats[st.round];
    st.events.forEach(function (e) {
      switch (e.e) {
        case 'wall': snd(3); S[e.side].walls++; break;
        case 'boom':
          if (e.wall >= 0) addFx('unbuild', e.x * 24, e.y * 24, 0.3, { type: e.wall });
          addFx('boom', e.x * 24, e.y * 24, 0.55);
          break;
        case 'demolish': snd(6); S[e.side].booms++; break;
        case 'pick': {
          snd(8); S[e.side].bonus++;
          addFx('ring', e.x * 24 + 12, e.y * 24 + 12, 0.45);
          var a = st.animals[e.side];
          floatText(e.what === 'buoy' ? '+1 mur' : 'Pétard !', OX + e.x * 24 + 12, OY + e.y * 24, e.what === 'buoy' ? '#9fe8ff' : '#ffd34d');
          if (human(e.side)) toast((onePlayer ? '' : shortName(e.side) + ' - ') + (e.what === 'buoy' ? 'Bouée : un mur de plus (' + a.walls + '/' + K.CFG.maxWalls + ')' : 'Pétard : démolition possible pendant 15 s'));
          break;
        }
        case 'breath': snd(e.side === 0 ? 1 : 2, 0.6); S[e.side].breaths++; addFx('ring', e.x * 24 + 12, e.y * 24 + 12, 0.45); break;
        case 'end':
          if (e.how === 'catch') { var p = K.pos(K.worm(st)); addFx('splash', p.x + 12, p.y + 12, 0.6); snd(7); }
          else if (e.how === 'time') snd(4);
          else snd(5);
          break;
      }
    });
    st.events.length = 0;
  }

  function endOfRound() {
    results.push(st.result);
    renderResults();
    if (st.round === 0) { setPhase('summary'); showSummary(); return; }
    match = K.matchResult(results, names());
    Lehcim.stopMusic();
    setPhase('over');
    renderResults();
    var record = false;
    if (onePlayer) {
      var rec = loadRec(), x = rec[level] || { w: 0, l: 0, d: 0 };
      if (match.winner === 1) x.w++; else if (match.winner === 0) x.l++; else x.d++;
      // round 2: the player is the fish
      var r2 = results[1];
      if (r2.how === 'catch' && r2.winner === 1 && (!x.best || r2.time < x.best)) { x.best = r2.time; record = true; }
      rec[level] = x; saveRec(rec); renderRecords();
    }
    showOver();
    if (record) Lehcim.message('Nouveau record : vous avez attrapé le ver en ' + fmtT(results[1].time) + ' (niveau ' + K.LEVELS[level].name.toLowerCase() + ') !');
  }

  // ---------- Drawing ----------
  function spr(c, r, x, y) { g.drawImage(sheet, 600 + 24 * c, 24 * r, 24, 24, Math.round(x), Math.round(y), 24, 24); }
  function sprPool(c, r, x, y) { spr(c, r, OX + x, OY + y); }
  function sprBig(c, r, x, y, s) { g.drawImage(sheet, 600 + 24 * c, 24 * r, 24, 24, Math.round(x), Math.round(y), 24 * s, 24 * s); }
  function blink(rate) { return reduceMotion ? 1 : Math.floor(clock * rate) % 2; }

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
    if (!st || phase === 'idle') return; // the start overlay covers the pool
    drawZones();
    drawBonuses();
    drawWalls();
    st.animals.forEach(drawAnimal);
    drawEffects();
    drawPanels();
    drawFloats();
    drawOverlay();
  }

  function drawZones() {
    K.ZONES.forEach(function (z, i) {
      var zx = OX + z[0] * 24 + 12, zy = OY + z[1] * 24 + 12;
      var grad = g.createRadialGradient(zx, zy, 4, zx, zy, 20);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(zx - 20, zy - 20, 40, 40);
      var f = Math.floor(clock * 8 + i * 2) % 6;
      sprPool(12 + f, 10 + (i * 2 + Math.floor(clock * 8 / 6)) % 6, z[0] * 24, z[1] * 24);
      // the expert fish shows which zone it is guarding (a hint for the player)
      if (ai[0] && ai[0].guard === i && K.fish(st).side === 0 && phase === 'play') {
        g.strokeStyle = 'rgba(255,80,80,0.7)'; g.lineWidth = 2;
        g.beginPath(); g.arc(zx, zy, 15, 0, Math.PI * 2); g.stroke();
      }
    });
  }

  function drawBonuses() {
    if (st.buoy) sprPool(17 + Math.floor(clock * 5) % 2, 16, st.buoy.x * 24, st.buoy.y * 24);
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
        var f = Math.min(4, Math.floor((st.t - w.born) / 0.07));
        sprPool(13 + f, w.type, x * 24, y * 24);
      }
    }
  }

  function turnRow(a) { return 4 + 3 * a.dir + (a.turnFrom - a.dir + 3) % 4; }

  function drawAnimal(a) {
    var p = K.pos(a), base = a.kind === 'fish' ? 6 : 0;
    if (!a.alive) {
      var t = phase === 'dying' ? phaseT : 9;
      if (a.kind === 'worm' && st.result.how === 'catch') {
        if (t < 0.25) return;
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
    } else f = Math.floor(a.animT * (a.kind === 'fish' ? 6 : 3)) % 6;
    // during the countdown: show who is who
    if (phase === 'countdown' && human(a.side)) {
      var cx = OX + p.x + 12, cy = OY + p.y + 12, rr = 16 + (reduceMotion ? 0 : Math.sin(clock * 6) * 2);
      g.strokeStyle = '#ffd34d'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
      text(onePlayer ? 'VOUS' : shortName(a.side).toUpperCase(), cx, cy - 28, 12, 'center', '#ffd34d');
    }
    // out of air soon: red halo (and blinking, as in the original)
    if (a.air < 0.25 && phase === 'play') {
      g.fillStyle = 'rgba(255,40,40,' + (reduceMotion ? 0.35 : 0.25 + 0.2 * Math.sin(clock * 10)) + ')';
      g.beginPath(); g.arc(OX + p.x + 12, OY + p.y + 12, 15, 0, Math.PI * 2); g.fill();
      if (a.air < 0.12 && !reduceMotion && Math.floor(clock * 6) % 2) return;
    }
    sprPool(base + f, r, p.x, p.y);
  }

  function drawCross(p, t) {
    if (t < 0) return;
    sprPool(21, 8 + Math.min(8, Math.floor(t / 0.1)), p.x, p.y);
  }

  var RINGS = [[1047, 158, 20, 20], [1042, 201, 28, 28], [1039, 245, 36, 37]];
  function drawEffects() {
    effects.forEach(function (f) {
      var k;
      if (f.k === 'boom') { k = Math.min(3, Math.floor(f.t / f.dur * 4)); sprPool(14 + k, 9, f.x, f.y); }
      else if (f.k === 'unbuild') { k = Math.min(4, Math.floor(f.t / f.dur * 5)); sprPool(17 - k, f.type, f.x, f.y); }
      else if (f.k === 'ring') {
        var rr = RINGS[Math.min(2, Math.floor(f.t / f.dur * 3))];
        g.drawImage(sheet, rr[0], rr[1], rr[2], rr[3], Math.round(OX + f.x - rr[2] / 2), Math.round(OY + f.y - rr[3] / 2), rr[2], rr[3]);
      } else if (f.k === 'splash') {
        k = Math.min(2, Math.floor(f.t / f.dur * 3));
        g.drawImage(sheet, 1032, 48 * k, 48, 48, Math.round(OX + f.x - 24), Math.round(OY + f.y - 24), 48, 48);
      }
    });
  }

  function drawFloats() {
    floats.forEach(function (f) {
      g.globalAlpha = Math.max(0, 1 - f.t);
      text(f.txt, f.x, f.y - (reduceMotion ? 0 : f.t * 24), 13, 'center', f.color);
      g.globalAlpha = 1;
    });
  }

  // Sides of the pool (as in the original): walls under the life buoy, lit
  // firecracker, air gauge in the O2 bottle, names and roles on top.
  var GAUGES = [[60, 378], [518, 378]];
  function drawPanels() {
    st.animals.forEach(function (a) {
      var x = a.side === 0 ? 12 : 564;
      for (var i = 0; i < a.walls; i++) spr(17, 16, x, 150 + i * 22);
      if (a.charge > 0) {
        var f = Math.floor(clock * 10) % 15;
        if (a.charge > 3 || blink(6)) spr(13 + f % 5, 6 + Math.floor(f / 5), x, 266);
        g.fillStyle = '#000'; g.fillRect(x, 293, 24, 4);
        g.fillStyle = '#ffd200'; g.fillRect(x, 293, Math.round(24 * a.charge / K.CFG.chargeTime), 4);
      }
      var gx = GAUGES[a.side][0], gy = GAUGES[a.side][1], h = Math.round(19 * Math.max(0, a.air));
      g.fillStyle = '#2a3346'; g.fillRect(gx, gy, 16, 19);
      var low = a.air < 0.25;
      g.fillStyle = low ? (blink(6) ? '#ff3030' : '#ffb0b0') : '#8fe4ff';
      g.fillRect(gx, gy + 19 - h, 16, h);
      var lx = a.side === 0 ? 8 : 592, al = a.side === 0 ? 'left' : 'right';
      text(shortName(a.side).toUpperCase(), lx, 13, 11, al);
      text(a.kind === 'fish' ? 'poisson' : 'ver', lx, 29, 12, al, a.kind === 'fish' ? '#d8d0ff' : '#ffffff');
    });
    var left = Math.max(0, Math.ceil(K.CFG.roundTime - st.t));
    g.font = 'bold 11px Verdana, Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = left <= 10 && phase === 'play' && blink(4) ? '#d00000' : '#4a2000';
    g.fillText(String(left), 299.5, 30);
    text('Manche ' + (st.round + 1), 344, 30, 11, 'left', '#ffd34d');
  }

  function drawOverlay() {
    var cx = OX + 21 * 12, cy = OY + 13 * 12;
    if (phase === 'countdown') {
      var k = 3 - Math.floor(phaseT);
      text('Manche ' + (st.round + 1), cx, cy - 56, 26, 'center', '#ffd34d');
      if (onePlayer) {
        var me = st.animals[1];
        text('Vous êtes le ' + (me.kind === 'fish' ? 'POISSON' : 'VER'), cx, cy - 22, 18);
        text(me.kind === 'fish' ? 'Attrapez le ver !' : 'Fuyez le poisson et respirez !', cx, cy + 2, 13);
      } else {
        var f = K.fish(st), w = K.worm(st);
        text('Poisson : ' + shortName(f.side).toLowerCase() + '   -   Ver : ' + shortName(w.side).toLowerCase(), cx, cy - 16, 15);
      }
      var sz = reduceMotion ? 46 : 46 + (1 - (phaseT % 1)) * 16;
      text(String(Math.max(1, k)), cx, cy + 50, Math.round(sz), 'center', '#ffffff');
    } else if (phase === 'play' && (phaseT < 0.7 || resumeT > 0)) {
      text(resumeT > 0 ? 'Prêts ?' : 'Partez !', cx, cy, 30, 'center', '#ffd34d');
    } else if (phase === 'signs') {
      // "stop" -> "c'est" -> "fini" signs, then the king or the grinning face
      var s = Math.min(14, Math.floor(phaseT * 7));
      sprBig(s, 16, cx - 48, cy - 48, 4);
    }
  }

  // ---------- Canvas fit (nearest-neighbour scaling; half steps above 2x) ----------
  function fit() {
    var w = stage.clientWidth;
    var top = stage.getBoundingClientRect().top + window.scrollY;
    var maxH = Math.max(220, window.innerHeight - Math.min(top, 80) - 24);
    if (window.innerWidth <= 900) maxH = Math.max(220, window.innerHeight * 0.6);
    var s = Math.min(w / 600, maxH / 408);
    if (s > 2) s = Math.floor(s * 2) / 2; // large screens: exact half steps
    canvas.style.width = Math.floor(600 * s) + 'px';
    canvas.style.height = Math.floor(408 * s) + 'px';
  }
  window.addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);

  // ---------- Page wiring ----------
  Lehcim.initPage();
  fit();
  $('new').addEventListener('click', function () { newGame(); });
  $('abandon').addEventListener('click', abandon);
  $('pauseBtn').addEventListener('click', function () { setPaused(!paused); });
  $('settings').addEventListener('close', function () { refreshIdle(); });
  updateStatus(); updatePanel(true); renderRecords(); renderResults();
  showIdle();

  Lehcim.loadSheet('../assets/sheet.png', [184, 10, 70]).then(function (s) {
    sheet = s; drawIcons();
    requestAnimationFrame(function (t) { last = t; frame(t); });
  });

  // For tests: read the state, let the computer play a side, speed up time.
  window.KevGame = {
    get state() { return st; }, get phase() { return phase; }, get results() { return results; },
    get paused() { return paused; }, get seed() { return seed; },
    setAI: function (side, lvl) { ai[side] = lvl == null ? null : K.newBrain(lvl); },
    setSpeed: function (k) { speed = k; },
    newGame: newGame
  };
})();
