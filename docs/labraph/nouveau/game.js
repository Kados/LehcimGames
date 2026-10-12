/*
 * LabRaph (nouvelle version) - page, drawing and controls.
 * The game logic lives in engine.js (LabEngine). The original sprites and sounds
 * come from ../assets/. Logic runs on the original fixed 50 ms tick.
 */
(function () {
  'use strict';

  var E = window.LabEngine;
  var U = E.U, R = E.R, D = E.D, L = E.L, DX = E.DX, DY = E.DY, TICK = E.TICK;
  var KEY = [184, 10, 70];             // colour key of both sheets

  // One entry per tile size T (same tables as the original port).
  var ZOOMS = {
    40: { tileY: 0, growY: 216, s: 24, cols: 10, rot: 4, ship: 400, fx: [160, 354], bullet: [168, 339, 8], glob: 0, snake: 500 },
    32: { tileY: 80, growY: 256, s: 20, cols: 8, rot: 4, ship: 640, fx: [240, 232], bullet: [247, 218, 6], glob: 240, snake: 740 },
    20: { tileY: 144, growY: 288, s: 12, cols: 5, rot: 2, ship: 800, fx: [340, 152], bullet: [344, 144, 4], glob: 400, snake: 900 },
    16: { tileY: 184, growY: 308, s: 8, cols: 4, rot: 2, ship: 860, fx: [360, 88], bullet: [362, 82, 4], glob: 460, snake: 960 }
  };
  var TILE = {};
  [[5, 0, 0], [10, 1, 0], [3, 2, 0], [6, 3, 0], [12, 4, 0], [9, 5, 0], [8, 6, 0], [1, 7, 0], [2, 8, 0], [4, 9, 0],
   [0, 0, 1], [14, 1, 1], [7, 2, 1], [11, 3, 1], [13, 4, 1], [15, 5, 1]].forEach(function (t) { TILE[t[0]] = [t[1], t[2]]; });
  var TURN_CW = [9, 12, 15, 6], TURN_CCW = [11, 4, 5, 8];
  var ROW_EXPLODE = 16, ROW_WARP = 17, ROW_EGG = 16, ROW_DIE = 17, ROW_FACE = 18;
  var PANEL = [920, 0, 60, 400], BARRIER = [101, 517, 28, 80];
  var BOXES = [['level', 72, '#4040ff'], ['lives', 123, '#ff2020'], ['globs', 178, '#ffff40'],
               ['bullets', 232, '#ff2020'], ['time', 288, '#e8d8a0'], ['score', 342, '#4060ff']];
  var DARK_TICKS = E.DARK_TIME * 1000 / TICK;
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game'), g = canvas.getContext('2d'), stage = $('stage'), overlay = $('overlay');
  var maze, creatures, sheetsReady = false;

  // ---------- Settings and records (localStorage, never required) ----------

  var SKEY = 'lehcim.labraph.nv';
  var DEFAULTS = { preset: 'normal', startLevel: '1', orient: 'auto', seed: '', panel: true, countdown: true, exitMark: true, effects: true, darkSound: true, touch: false };
  function loadStore(k, def) {
    try { var v = JSON.parse(localStorage.getItem(SKEY + '.' + k)); if (v && typeof v === 'object') return v; } catch (e) { /* ignore */ }
    return def;
  }
  function saveStore(k, v) { try { localStorage.setItem(SKEY + '.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = Object.assign({}, DEFAULTS, loadStore('settings', {}));
  var bests = loadStore('best', {});          // {preset: {score, level}}
  var daily = loadStore('daily', {});         // {date, score, level}
  var HS_DEFAULTS = [{ name: 'Pro', score: 60 }, { name: 'Expert', score: 48 }, { name: 'Amateur', score: 36 }, { name: 'Débutant', score: 24 }, { name: 'Gromové', score: 12 }];
  function table(preset) { return Lehcim.highScores('labraph-nv-' + preset, HS_DEFAULTS); }

  // ---------- State ----------

  var game = null;     // {level, lives, score, bullets, seed, attempt, preset, daily}
  var lv = null;       // current level (engine object)
  var demo = null;     // title screen demo level
  var mode = 'title';  // title | level | between | over
  var paused = false;
  var input = E.newInput();
  var LY = null;       // layout {portrait, panel, W, H, mw, mh}
  var popups = [], flash = 0, frameCount = 0, lastT = 0, darkAudio = null;

  // ---------- Layout ----------

  function wantPortrait() {
    if (settings.orient === 'port') return true;
    if (settings.orient === 'land') return false;
    return window.innerWidth < 700 && window.innerHeight > window.innerWidth;
  }
  function applyLayout(portrait) {
    var panel = !portrait && settings.panel;
    LY = { portrait: portrait, panel: panel, mw: portrait ? 400 : 560, mh: portrait ? 560 : 400 };
    LY.W = LY.mw + (panel ? 60 : 0); LY.H = LY.mh;
    if (canvas.width !== LY.W || canvas.height !== LY.H) { canvas.width = LY.W; canvas.height = LY.H; }
    g.imageSmoothingEnabled = false;
    document.body.classList.toggle('mini', !panel);
    $('pad').classList.toggle('force', !!settings.touch);
    if (lv) placeLevel(lv);
    if (demo) placeLevel(demo);
    fit();
  }
  function placeLevel(l) {
    l.ox = Math.floor((LY.mw - l.maze.cols * l.T) / 2);
    l.oy = Math.floor((LY.mh - l.maze.rows * l.T) / 2);
    l.z = ZOOMS[l.T];
  }
  // Scales the canvas to the room left by the top bar, the compact HUD and the touch pad.
  function fit() {
    var col = stage.parentElement, w = col.clientWidth;
    var top = document.querySelector('.nv-top').offsetHeight;
    var mini = $('hudMini'), pad = $('pad');
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    col.classList.toggle('side-pad', !!(settings.touch || coarse));
    var extra = mini.offsetHeight ? mini.offsetHeight + 10 : 0;
    if (getComputedStyle(pad).display === 'contents') w -= $('dpad').offsetWidth + pad.querySelector('.tact').offsetWidth + 20;
    else if (pad.offsetHeight) extra += pad.offsetHeight + 10;
    var availH = window.innerHeight - top - extra - (window.innerWidth <= 900 ? 24 : 32);
    var s = Math.min(w / canvas.width, Math.max(180, availH) / canvas.height);
    if (s > 1) s = Math.floor(s * 4) / 4;
    canvas.style.width = Math.floor(canvas.width * s) + 'px';
    canvas.style.height = Math.floor(canvas.height * s) + 'px';
    canvas.classList.toggle('smooth', s < 1);   // pixelated downscaling would drop wall lines
  }
  window.addEventListener('resize', function () {
    if (mode === 'title' && settings.orient === 'auto' && wantPortrait() !== LY.portrait) { applyLayout(wantPortrait()); newDemo(); }
    else fit();
  });

  // ---------- Game flow ----------

  function levelCfg(forDemo) {
    var c = { preset: game && !forDemo ? game.preset : 'normal', portrait: LY.portrait, countdown: forDemo ? false : settings.countdown };
    if (forDemo) c.god = true;
    return c;
  }

  function newGame(isDaily) {
    stopDark(); closeOverlay();
    var today = E.dailySeed();
    var preset = isDaily ? 'normal' : settings.preset;
    var start = isDaily ? 1 : parseInt(settings.startLevel, 10) || 1;
    var seed = isDaily ? 'J' + today : (settings.seed.trim() || E.randomSeedCode());
    applyLayout(wantPortrait());
    game = { level: start, lives: E.PRESETS[preset].lives, score: 0, bullets: Math.min(E.MAX_BULLETS, start - 1), seed: seed, attempt: 0, preset: preset, daily: isDaily ? today : null, startLevel: start };
    demo = null; paused = false;
    $('chipPreset').textContent = isDaily ? 'Défi du jour' : E.PRESETS[preset].label;
    renderRecords();
    startLevel();
    if (isDaily) toast('Défi du jour ' + today + ' : les mêmes labyrinthes pour tout le monde.');
  }

  function startLevel() {
    closeOverlay();
    var prevT = lv ? lv.T : null;
    lv = E.createLevel(game, levelCfg(false));
    placeLevel(lv);
    input.buffer = -1;
    popups = []; mode = 'level';
    setStatus('Niveau ' + game.level, 'Temps alloué : ' + lv.time + ' s. Détruis tous les globules jaunes.');
    updateSeedLine();
    if (prevT && prevT !== lv.T) toast('Le labyrinthe s\'agrandit !');
  }

  function afterLifeLost(reason, text) {
    game.lives--; game.attempt++;
    if (game.lives <= 0) { gameOver(text); return; }
    mode = 'between';
    var help = reason === 'escape' ? 'Pense à la barrière (Entrée) quand un globule approche de la sortie.'
      : reason === 'time' ? 'Le temps est calculé sur le vrai trajet : va droit aux globules, sans détour.'
      : 'Les serpents volent par-dessus les murs : garde tes distances ou tire-leur dessus.';
    showOverlay({
      cls: 'bad', title: text,
      lines: ['Il te reste ' + game.lives + (game.lives > 1 ? ' vies.' : ' vie.') + ' Le niveau recommence dans un nouveau labyrinthe.', help],
      buttons: [['Continuer', startLevel, true]]
    });
    setStatus(text, 'Vies restantes : ' + game.lives, 'bad');
  }

  function levelDone() {
    mode = 'between';
    var n = game.level, left = Math.max(0, Math.ceil(lv.timeLeft * TICK / 1000));
    var grows = E.tileSize(n + 1) !== E.tileSize(n);
    var lines = ['Score : ' + game.score + ' · temps restant : ' + left + ' s'];
    if (grows) lines.push('Au prochain niveau, le labyrinthe s\'agrandit.');
    if (n + 1 === 16) lines.push('Au-delà du niveau 15, les globules apprennent à fuir ton vaisseau !');
    showOverlay({ cls: 'good', title: 'Bravo ! Niveau ' + n + ' réussi', lines: lines, buttons: [['Niveau suivant', nextLevel, true]] });
    setStatus('Niveau ' + n + ' réussi !', 'Score : ' + game.score, 'good');
    updateBest();
  }
  function nextLevel() { game.level++; game.attempt = 0; startLevel(); }

  function updateBest() {
    if (!game) return null;
    var rec = null;
    if (game.daily) {
      if (daily.date !== game.daily) daily = { date: game.daily, score: -1, level: 0 };
      if (game.score > daily.score) { daily.score = game.score; daily.level = game.level; rec = 'daily'; }
      saveStore('daily', daily);
    } else {
      var b = bests[game.preset] || { score: -1, level: 0 };
      if (game.score > b.score || (game.score === b.score && game.level > b.level)) { b = { score: game.score, level: game.level }; rec = 'best'; }
      bests[game.preset] = b; saveStore('best', bests);
    }
    renderRecords();
    return rec;
  }

  function gameOver(text) {
    stopDark();
    mode = 'over';
    var sc = game.score, prevBest = game.daily ? (daily.date === game.daily ? daily.score : -1) : (bests[game.preset] ? bests[game.preset].score : -1);
    updateBest();
    var newRecord = sc > prevBest && sc > 0;
    setStatus('La partie est terminée.', 'Score : ' + sc, 'bad');
    var hs = table(game.preset), p;
    if (!game.daily && hs.qualifies(sc)) {
      p = Lehcim.prompt((text ? text + '\n' : '') + 'Tu fais partie des meilleurs ! Ecris ton nom .\n( 14 caractères maximum )', 14)
        .then(function (name) { hs.add(name.slice(0, 14) || 'bip-bip', sc); lastName = name.slice(0, 14) || 'bip-bip'; });
    } else p = Promise.resolve();
    p.then(function () {
      renderRecords();
      var lines = [(text ? text + ' ' : '') + 'Score : ' + sc + ' · niveau atteint : ' + game.level];
      if (newRecord) lines.push(game.daily ? 'Nouveau record du défi du jour !' : 'Nouveau record personnel !');
      showOverlay({
        cls: 'bad', title: 'La partie est terminée',
        lines: lines,
        buttons: [['Rejouer', function () { newGame(!!game.daily); }, true], ['Défi du jour', function () { newGame(true); }], ['Menu', toTitle]]
      });
    });
  }
  var lastName = null;

  function abandon() {
    if (!game || mode === 'title' || mode === 'over') return;
    var wasPaused = paused; paused = true;
    Lehcim.message('Abandonner la partie en cours ?', ['Oui', 'Non']).then(function (i) {
      paused = wasPaused;
      if (i !== 0) return;
      paused = false; closeOverlay(); gameOver('');
    });
  }

  function toTitle() {
    stopDark(); closeOverlay();
    game = null; lv = null; mode = 'title'; paused = false;
    applyLayout(wantPortrait());
    newDemo();
    showTitle();
  }

  function newDemo() {
    var dg = { level: 3, lives: 1, score: 0, bullets: 0, seed: 'demo' + Math.floor(Math.random() * 1e6), attempt: 0 };
    demo = E.createLevel(dg, levelCfg(true));
    demo.timeLeft = 1e9;
    placeLevel(demo);
  }

  function togglePause(force) {
    if (!game || mode !== 'level') return;
    var p = force == null ? !paused : force;
    if (p === paused) return;
    paused = p;
    if (paused) {
      if (darkAudio) { try { darkAudio.pause(); } catch (e) { /* ignore */ } }
      showOverlay({ title: 'Pause', lines: ['Niveau ' + game.level + ' · score ' + game.score], buttons: [['Reprendre', function () { togglePause(false); }, true], ['Abandonner', abandon]], hint: 'P ou Échap pour reprendre' });
    } else {
      closeOverlay();
      if (darkAudio) { try { var pr = darkAudio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* ignore */ } }
    }
    updatePauseButtons();
  }
  function updatePauseButtons() {
    $('pauseBtn').textContent = paused ? '▶' : '⏸';
    $('pauseBtn').setAttribute('aria-label', paused ? 'Reprendre' : 'Pause');
    $('pauseBtn2').textContent = paused ? 'Reprendre' : 'Pause';
    var can = !!game && mode === 'level';
    $('pauseBtn').disabled = !can; $('pauseBtn2').disabled = !can; $('abandon').disabled = !game || mode === 'over';
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) togglePause(true); });
  window.addEventListener('blur', function () { input.held = []; input.pivot = false; if (mode === 'level' && lv && lv.state === 'play') togglePause(true); });

  // ---------- Overlay, status, toasts ----------

  var overlayShown = 0;
  function showOverlay(o) {
    overlay.innerHTML = '';
    overlay.className = 'overlay' + (o.cls ? ' ' + o.cls : '');
    if (o.big) { var b = document.createElement('div'); b.className = 'big'; b.textContent = o.big; overlay.appendChild(b); }
    if (o.title) { var h = document.createElement('h2'); h.textContent = o.title; overlay.appendChild(h); }
    (o.lines || []).forEach(function (t) { var p = document.createElement('p'); p.textContent = t; overlay.appendChild(p); });
    if (o.html) { var d = document.createElement('div'); d.innerHTML = o.html; overlay.appendChild(d); }
    var row = document.createElement('div'); row.className = 'btns';
    var first = null;
    (o.buttons || []).forEach(function (bt) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (bt[2] ? ' primary' : '');
      btn.textContent = bt[0];
      btn.addEventListener('click', function () { if (performance.now() - overlayShown < 350) return; bt[1](); });
      row.appendChild(btn);
      if (bt[2]) first = btn;
    });
    overlay.appendChild(row);
    if (o.hint) { var hh = document.createElement('p'); hh.className = 'hint'; hh.textContent = o.hint; overlay.appendChild(hh); }
    overlay.hidden = false; overlayShown = performance.now();
    if (first && !document.querySelector('dialog[open]')) first.focus({ preventScroll: true });
    overlay.primary = first;
  }
  function closeOverlay() { overlay.hidden = true; overlay.innerHTML = ''; overlay.primary = null; }

  function showTitle() {
    var rec = bests[settings.preset];
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    showOverlay({
      big: 'LabRaph',
      lines: ['Détruis tous les globules jaunes (contact : 2 points, balle : 1 point), puis sors du labyrinthe avant la fin du temps. Gare aux serpents rouges, qui volent par-dessus les murs !',
        touch ? 'Croix ou glissé du doigt : se déplacer · Tir · Barrière devant la sortie.' : 'Flèches : se déplacer · Espace : tirer · Entrée : barrière · W ou Maj : pivoter · P : pause.'],
      buttons: [['Jouer', function () { newGame(false); }, true], ['Défi du jour', function () { newGame(true); }], ['Règles', function () { $('help').showModal(); }]],
      hint: (E.PRESETS[settings.preset].label) + (rec ? ' · ton record : ' + rec.score + ' points (niveau ' + rec.level + ')' : '')
    });
  }

  function setStatus(main, sub, cls) {
    var s = $('status'); s.textContent = main; s.className = 'status' + (cls ? ' ' + cls : '');
    $('substatus').textContent = sub || '';
  }
  function toast(text, ms) {
    var box = $('toasts');
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2400);
  }

  function updateSeedLine() {
    var el = $('seedline');
    if (!game) { el.textContent = ''; return; }
    el.innerHTML = '';
    el.appendChild(document.createTextNode('Graine '));
    var c = document.createElement('code'); c.textContent = game.seed; el.appendChild(c);
    el.appendChild(document.createTextNode(' · niveau ' + game.level + (game.attempt ? ', essai ' + (game.attempt + 1) : '') + ' · temps alloué ' + lv.time + ' s'));
  }

  function renderRecords() {
    var preset = game && !game.daily ? game.preset : settings.preset;
    var b = bests[preset], today = E.dailySeed();
    var best = $('best'); best.innerHTML = '';
    function item(label, val) { var s = document.createElement('span'); s.textContent = label + ' '; var x = document.createElement('b'); x.textContent = val; s.appendChild(x); best.appendChild(s); }
    item('Record (' + E.PRESETS[preset].label + ') :', b ? b.score + ' pts, niv. ' + b.level : '-');
    item('Défi du jour :', daily.date === today && daily.score >= 0 ? daily.score + ' pts' : 'pas encore joué');
    var tb = $('hs').querySelector('tbody'); tb.innerHTML = '';
    table(preset).list().forEach(function (e) {
      var tr = document.createElement('tr'); if (e.name === lastName) tr.className = 'me';
      var a = document.createElement('td'); a.textContent = e.name;
      var c = document.createElement('td'); c.textContent = e.score;
      tr.appendChild(a); tr.appendChild(c); tb.appendChild(tr);
    });
  }

  // ---------- HUD ----------

  var hudCache = '';
  function hudValues() {
    if (!game || !lv) return null;
    return {
      level: game.level, lives: game.lives, globs: E.globsLeft(lv), bullets: game.bullets,
      time: Math.max(0, Math.ceil(lv.timeLeft * TICK / 1000)), score: game.score
    };
  }
  function updateHud() {
    var v = hudValues();
    var key = v ? [v.level, v.lives, v.globs, v.bullets, v.time, v.score, lv.barrierUsed, lv.barrier > 0, lv.nearExit, paused].join() : '-';
    if (key === hudCache) return;
    hudCache = key;
    document.querySelectorAll('[data-v]').forEach(function (el) { el.textContent = v ? v[el.getAttribute('data-v')] : '-'; });
    var warn = v && v.time <= E.DARK_TIME && lv.state === 'play';
    document.querySelectorAll('[data-w="time"]').forEach(function (el) { el.classList.toggle('warn', !!warn); });
    var bar = $('timebar');
    bar.firstElementChild.style.width = v ? Math.max(0, 100 * lv.timeLeft / lv.timeTotal) + '%' : '100%';
    bar.classList.toggle('dark', !!warn);
    var cb = $('chipBarrier'), ce = $('chipExit');
    if (!v) { cb.className = 'chip'; cb.textContent = 'Barrière prête'; ce.className = 'chip'; ce.textContent = 'Sortie fermée'; return; }
    cb.className = 'chip' + (lv.barrier > 0 ? ' on' : lv.barrierUsed ? ' off' : lv.nearExit ? ' alert' : '');
    cb.textContent = lv.barrier > 0 ? 'Barrière active' : lv.barrierUsed ? 'Barrière utilisée' : lv.nearExit ? 'Barrière ! (Entrée)' : 'Barrière prête';
    var open = v.globs === 0;
    ce.className = 'chip' + (open ? ' on' : '');
    ce.textContent = open ? 'Sortie ouverte' : 'Sortie fermée';
  }

  // ---------- Engine events ----------

  function handleEvents(l, isDemo) {
    var ev = l.events; l.events = [];
    if (isDemo) return;
    ev.forEach(function (e) {
      switch (e.type) {
        case 'sound': Lehcim.play(e.name); break;
        case 'points': popups.push({ x: e.x, y: e.y, text: '+' + e.points, k: 0, color: e.points === 2 ? '#ffe14d' : '#ffffff' }); break;
        case 'snakeKilled': popups.push({ x: e.x, y: e.y, text: 'Touché !', k: 0, color: '#ff8080' }); break;
        case 'allGlobs':
          setStatus('Tous les globules sont détruits !', 'Sors du labyrinthe par l\'ouverture du mur extérieur.', 'good');
          toast('Sortie ouverte : sors du labyrinthe !');
          break;
        case 'nearExit': if (!l.barrierUsed) toast('Un globule approche de la sortie ! Entrée = barrière'); break;
        case 'dark': startDark(); toast('Le labyrinthe devient invisible !'); break;
        case 'go': setStatus('Niveau ' + game.level + ' : détruis tous les globules !', 'Temps alloué : ' + l.time + ' s'); break;
        case 'dying':
          stopDark();
          if (settings.effects) {
            flash = 1;
            if (!REDUCED) { canvas.classList.remove('shake'); void canvas.offsetWidth; canvas.classList.add('shake'); }
          }
          setStatus(e.text, '', 'bad');
          break;
        case 'lost': afterLifeLost(e.reason, e.text); break;
        case 'won': stopDark(); levelDone(); break;
      }
    });
  }

  // ---------- Sound ----------

  var SND = {
    shot: '../assets/sounds/1.wav', escape: '../assets/sounds/2.wav', boom: '../assets/sounds/3.wav',
    barrier: '../assets/sounds/4.wav', eat: '../assets/sounds/5.wav', globShot: '../assets/sounds/6.wav',
    exit: '../assets/sounds/7.wav', snakeDie: '../assets/sounds/8.wav', egg: '../assets/sounds/9.wav'
  };
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  // The two long sounds accompany the last 20 seconds, when the maze is invisible.
  function startDark() {
    stopDark();
    if (Lehcim.isMuted() || !settings.darkSound) return;
    try {
      var a = new Audio('../assets/sounds/' + (game.level % 2 ? 10 : 11) + '.wav');
      a.volume = 0.6; darkAudio = a;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay refused */ });
    } catch (e) { /* ignore */ }
  }
  function stopDark() {
    if (darkAudio) { try { darkAudio.pause(); } catch (e) { /* ignore */ } darkAudio = null; }
  }

  // ---------- Input ----------

  var KEYDIR = { ArrowUp: U, ArrowRight: R, ArrowDown: D, ArrowLeft: L };
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }
  function playing() { return game && lv && mode === 'level' && !paused; }
  function press(d) { E.inputPress(lv, input, d); }
  function release(d) { E.inputRelease(input, d); }
  function doFire() { if (playing()) E.fire(lv); }
  function doBarrier() {
    if (!playing()) return;
    if (lv.barrierUsed && lv.state === 'play') toast('La barrière a déjà servi dans ce niveau.');
    else if (E.putBarrier(lv)) toast('Barrière : la sortie est bloquée 3 secondes.', 1600);
  }
  function isPivotKey(e) { return e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.key === 'Shift'; }

  window.addEventListener('keydown', function (e) {
    if (dialogOpen()) return;
    var k = e.key, onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (k in KEYDIR) { e.preventDefault(); press(KEYDIR[k]); return; }
    if (isPivotKey(e)) { input.pivot = true; if (k !== 'Shift') e.preventDefault(); return; }
    if (k === 'p' || k === 'P' || k === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (!overlay.hidden) {
        if (onButton && overlay.contains(document.activeElement)) return;       // native activation
        e.preventDefault();
        if (!e.repeat && overlay.primary && performance.now() - overlayShown > 350) overlay.primary.click();
        return;
      }
      if (onButton && !playing()) return;
      e.preventDefault();
      if (e.repeat) return;
      if (k === 'Enter') doBarrier(); else doFire();
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.key in KEYDIR) release(KEYDIR[e.key]);
    if (isPivotKey(e)) input.pivot = false;
  });

  // Touch pad: a single pointer drives the cross; sliding the finger changes direction.
  var dpad = $('dpad'), dpadDir = -1, dpadSpans = { 0: dpad.querySelector('.u'), 1: dpad.querySelector('.r'), 2: dpad.querySelector('.d'), 3: dpad.querySelector('.l') };
  function setDpad(d) {
    if (d === dpadDir) return;
    if (dpadDir >= 0) { release(dpadDir); dpadSpans[dpadDir].classList.remove('on'); }
    dpadDir = d;
    if (d >= 0) { press(d); dpadSpans[d].classList.add('on'); if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* ignore */ } } }
  }
  function dpadAt(e) {
    var r = dpad.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    if (x * x + y * y < 14 * 14) return dpadDir;           // dead zone: keep the current direction
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? R : L) : (y > 0 ? D : U);
  }
  dpad.addEventListener('pointerdown', function (e) { e.preventDefault(); try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } setDpad(dpadAt(e)); });
  dpad.addEventListener('pointermove', function (e) { if (dpadDir >= 0 || e.buttons) setDpad(dpadAt(e)); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { dpad.addEventListener(t, function () { setDpad(-1); }); });
  dpad.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.querySelectorAll('.tact [data-act]').forEach(function (b) {
    var act = b.getAttribute('data-act');
    function down(e) {
      e.preventDefault(); b.classList.add('on');
      if (act === 'fire') doFire(); else if (act === 'barrier') doBarrier(); else input.pivot = true;
    }
    function up() { b.classList.remove('on'); if (act === 'pivot') input.pivot = false; }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Keyboard activation of the on-screen buttons (click without a pointer).
    b.addEventListener('click', function (e) { if (e.detail === 0 && act !== 'pivot') { if (act === 'fire') doFire(); else doBarrier(); } });
  });

  // Swipe on the maze (touch): slide to steer, short tap to fire.
  var swipe = null;
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' || !playing()) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    swipe = { x: e.clientX, y: e.clientY, t: performance.now(), dir: -1, moved: false };
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!swipe) return;
    var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (dx * dx + dy * dy < 20 * 20) return;
    var d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? R : L) : (dy > 0 ? D : U);
    swipe.moved = true; swipe.x = e.clientX; swipe.y = e.clientY;
    if (d !== swipe.dir) { if (swipe.dir >= 0) release(swipe.dir); swipe.dir = d; press(d); }
  });
  function endSwipe() {
    if (!swipe) return;
    if (swipe.dir >= 0) release(swipe.dir);
    if (!swipe.moved && performance.now() - swipe.t < 250) doFire();
    swipe = null;
  }
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);

  // ---------- Drawing ----------

  function draw() {
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (!sheetsReady) return;
    var l = lv || demo;
    if (l) drawLevel(l, !lv);
    if (LY.panel) drawPanel();
    if (flash > 0) {
      g.fillStyle = 'rgba(255,40,40,' + (0.45 * flash).toFixed(3) + ')';
      g.fillRect(0, 0, LY.mw, LY.mh);
    }
  }

  function banner(l, big, small) {
    g.save();
    var cy = LY.mh / 2;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, cy - 40, LY.mw, small ? 80 : 60);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold italic 34px "Times New Roman", serif'; g.fillStyle = '#ffd34d';
    g.fillText(big, LY.mw / 2, cy - 10);
    if (small) { g.font = '15px "Times New Roman", serif'; g.fillStyle = '#fff'; g.fillText(small, LY.mw / 2, cy + 24); }
    g.restore();
  }

  var cur = null;   // level being drawn
  function cx2px(x) { return cur.ox + (x + 0.5) * cur.T; }
  function cy2px(y) { return cur.oy + (y + 0.5) * cur.T; }
  function spr(img, sx, sy, s, x, y) {
    g.drawImage(img, sx, sy, s, s, Math.round(cx2px(x) - s / 2), Math.round(cy2px(y) - s / 2), s, s);
  }

  function drawLevel(l, isDemo) {
    cur = l;
    var z = l.z, T = l.T, m = l.maze, s = z.s, x, y;
    var dark = E.isDark(l);
    var intro = l.state === 'intro';
    for (y = 0; y < m.rows; y++) for (x = 0; x < m.cols; x++) {
      var px = l.ox + x * T, py = l.oy + y * T;
      if (intro && l.stateTick < 10) {
        g.drawImage(maze, Math.min(4, l.stateTick >> 1) * T, z.growY, T, T, px, py, T, T);
      } else {
        var t = TILE[dark ? 0 : m.walls[y * m.cols + x]];
        g.drawImage(maze, t[0] * T, z.tileY + t[1] * T, T, T, px, py, T, T);
      }
    }
    if (intro) { banner(l, 'Niveau ' + l.game.level); return; }
    if (settings.exitMark && !isDemo) drawExitMark(l);
    if (l.barrier > 0) drawBarrier(l);
    l.eggs.forEach(function (e) {
      var col = e.open < 0 ? 0 : Math.min(z.cols - 2, e.open >> 1);
      spr(creatures, (e.kind === 'glob' ? z.glob : z.snake) + col * s, ROW_EGG * s, s, e.x, e.y);
    });
    l.globs.forEach(function (o) {
      var row = o.dir >= 0 ? o.dir : o.last;
      spr(creatures, z.glob + ((o.anim >> 1) % z.cols) * s, row * s, s, o.x, o.y);
    });
    l.bullets.forEach(function (b) {
      var bb = z.bullet;
      g.drawImage(maze, bb[0], bb[1], bb[2], bb[2], Math.round(cx2px(b.x) - bb[2] / 2), Math.round(cy2px(b.y) - bb[2] / 2), bb[2], bb[2]);
    });
    if (!l.shipDead && l.state !== 'won') drawShip(l);
    l.snakes.forEach(function (n) {
      spr(creatures, z.snake + ((n.anim >> 1) % z.cols) * s, n.face * s, s, n.x, n.y);
    });
    l.fx.forEach(function (f) { drawFx(l, f); });
    drawPopups();
    if (dark && (l.timeLeft >> 2) % 2 === 0 && l.timeLeft > DARK_TICKS - 40) {
      g.save(); g.font = 'bold 16px "Times New Roman", serif'; g.fillStyle = '#ff4040'; g.textAlign = 'center';
      g.fillText('Le labyrinthe devient invisible !', LY.mw / 2, 20); g.restore();
    }
    if (l.state === 'countdown') {
      var n = 3 - Math.floor((l.stateTick - 1) / 12);
      banner(l, n > 0 ? String(n) : 'Partez !', 'Niveau ' + l.game.level + ' · ' + l.time + ' s');
    }
  }

  // Exit marker: green chevrons once the exit is open, red pulse when a globule comes close.
  function drawExitMark(l) {
    var e = l.maze.exit, T = l.T, open = E.globsLeft(l) === 0 && l.barrier <= 0;
    if (!open && !l.nearExit) return;
    var pulse = REDUCED ? 1 : 0.55 + 0.45 * Math.sin(frameCount / 6);
    var px = cx2px(e.x) + DX[e.dir] * T * 0.18, py = cy2px(e.y) + DY[e.dir] * T * 0.18;
    g.save();
    g.translate(Math.round(px), Math.round(py));
    g.rotate((e.dir - U) * Math.PI / 2);         // chevron drawn pointing up = outwards
    g.globalAlpha = pulse;
    g.fillStyle = open ? '#3dff7a' : '#ff3030';
    var w = Math.max(5, T * 0.28);
    for (var i = 0; i < 2; i++) {
      var oy = -i * w * 0.7 + w * 0.6;
      g.beginPath(); g.moveTo(-w, oy); g.lineTo(0, oy - w * 0.8); g.lineTo(w, oy); g.lineTo(w * 0.6, oy + w * 0.25); g.lineTo(0, oy - w * 0.35); g.lineTo(-w * 0.6, oy + w * 0.25); g.closePath(); g.fill();
    }
    g.restore();
  }

  function drawPopups() {
    if (!popups.length) return;
    g.save(); g.textAlign = 'center'; g.font = 'bold 15px "Times New Roman", serif';
    popups.forEach(function (p) {
      g.globalAlpha = Math.max(0, 1 - p.k / 24);
      g.fillStyle = '#000'; g.fillText(p.text, cx2px(p.x) + 1, cy2px(p.y) - p.k + 1);
      g.fillStyle = p.color; g.fillText(p.text, cx2px(p.x), cy2px(p.y) - p.k);
    });
    g.restore();
  }

  function drawShip(l) {
    var z = l.z, s = z.s, sh = l.ship, pos = E.shipPos(l), sx, sy;
    if (l.state === 'exiting') {
      var k = Math.min(z.cols - 2, l.stateTick >> 1), d = l.maze.exit.dir;
      var ex = l.maze.exit.x + DX[d] * (l.stateTick / 30), ey = l.maze.exit.y + DY[d] * (l.stateTick / 30);
      g.save();
      g.translate(Math.round(cx2px(ex)), Math.round(cy2px(ey)));
      g.rotate((d - R) * Math.PI / 2);
      g.drawImage(maze, z.ship + k * s, ROW_WARP * s, s, s, -s / 2, -s / 2, s, s);
      g.restore();
      return;
    }
    if (sh.turn) {
      var cw = sh.turn.to === (sh.turn.from + 1) % 4;
      sy = (cw ? TURN_CW : TURN_CCW)[sh.turn.from] * s;
      sx = z.ship + Math.min(z.rot - 1, Math.floor(sh.turn.k * z.rot / 2)) * s;
    } else {
      sy = sh.face * s;
      sx = z.ship + ((sh.anim >> 1) % z.cols) * s;
    }
    spr(maze, sx, sy, s, pos.x, pos.y);
  }

  function drawFx(l, f) {
    var z = l.z, s = z.s, n = E.fxFrames(l, f), k = Math.min(n - 1, f.k >> 1);
    switch (f.kind) {
      case 'wall': {
        var off = (l.T - s) / 2 / l.T;
        g.drawImage(maze, z.fx[0] + k * s, z.fx[1] + (1 + f.dir) * s, s, s,
          Math.round(cx2px(f.x + DX[f.dir] * off) - s / 2), Math.round(cy2px(f.y + DY[f.dir] * off) - s / 2), s, s);
        break;
      }
      case 'globDie': spr(creatures, z.glob + k * s, ROW_DIE * s, s, f.x, f.y); break;
      case 'snakeDie': spr(creatures, z.snake + k * s, ROW_DIE * s, s, f.x, f.y); break;
      case 'shipBoom': spr(maze, z.ship + k * s, ROW_EXPLODE * s, s, f.x, f.y); break;
      case 'globFace': spr(creatures, z.glob + k * s, ROW_FACE * s, s, f.x, f.y); break;
      case 'snakeFace':
        if (f.k >= (z.cols - 1) * 2) spr(creatures, z.snake + Math.min(z.cols - 1, (f.k >> 1) - (z.cols - 1)) * s, ROW_FACE * s, s, f.x, f.y);
        break;
    }
  }

  function drawBarrier(l) {
    var e = l.maze.exit, T = l.T, h = Math.round(T * 1.2), w = Math.round(h * BARRIER[2] / BARRIER[3]);
    var px = cx2px(e.x) + DX[e.dir] * (T / 2 - w / 2), py = cy2px(e.y) + DY[e.dir] * (T / 2 - w / 2);
    g.save(); g.translate(Math.round(px), Math.round(py));
    if (e.dir === U || e.dir === D) g.rotate(Math.PI / 2);
    if (l.barrier > 15 || (l.barrier >> 1) % 2) g.drawImage(maze, BARRIER[0], BARRIER[1], BARRIER[2], BARRIER[3], -w / 2, -h / 2, w, h);
    g.restore();
  }

  // The original side panel, drawn on the canvas as in the Windows game.
  function drawPanel() {
    var X = LY.mw;
    g.drawImage(maze, PANEL[0], PANEL[1], PANEL[2], PANEL[3], X, 0, PANEL[2], PANEL[3]);
    var v = hudValues();
    if (!v) return;
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 13px "Times New Roman", serif';
    BOXES.forEach(function (b) {
      g.fillStyle = b[0] === 'time' && v.time <= E.DARK_TIME ? '#ff4040' : b[2];
      g.fillText(String(v[b[0]]), X + 32, b[1]);
    });
    g.restore();
  }

  // ---------- Settings dialog ----------

  function syncSettingsUI() {
    document.querySelectorAll('#settings .seg').forEach(function (seg) {
      var k = seg.getAttribute('data-set');
      seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-val') === String(settings[k]))); });
    });
    document.querySelectorAll('#settings input[type=checkbox]').forEach(function (c) { c.checked = !!settings[c.getAttribute('data-set')]; });
    $('seedInput').value = settings.seed || '';
  }
  document.querySelectorAll('#settings .seg').forEach(function (seg) {
    var k = seg.getAttribute('data-set');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      settings[k] = b.getAttribute('data-val'); saveStore('settings', settings); syncSettingsUI();
      if (k === 'preset') renderRecords();
      if (k === 'orient' && mode === 'title') { applyLayout(wantPortrait()); newDemo(); }
    });
  });
  document.querySelectorAll('#settings input[type=checkbox]').forEach(function (c) {
    c.addEventListener('change', function () {
      settings[c.getAttribute('data-set')] = c.checked; saveStore('settings', settings);
      if (c.getAttribute('data-set') === 'panel' || c.getAttribute('data-set') === 'touch') applyLayout(LY.portrait);
      if (c.getAttribute('data-set') === 'darkSound' && !c.checked) stopDark();
    });
  });
  $('seedInput').addEventListener('input', function () { settings.seed = this.value.trim().slice(0, 24); saveStore('settings', settings); });
  $('settingsBtn').addEventListener('click', function () {
    syncSettingsUI();
    if (mode === 'level') togglePause(true);
    $('settings').showModal();
  });
  $('settings').addEventListener('close', function () { if (mode === 'title') showTitle(); });

  // ---------- Buttons ----------

  $('new').addEventListener('click', function () {
    if (game && mode === 'level') {
      var was = paused; paused = true;
      Lehcim.message('Commencer une nouvelle partie ? La partie en cours sera perdue.', ['Oui', 'Non']).then(function (i) {
        paused = was; if (i === 0) newGame(false);
      });
    } else newGame(false);
  });
  $('pauseBtn').addEventListener('click', function () { togglePause(); });
  $('pauseBtn2').addEventListener('click', function () { togglePause(); });
  $('abandon').addEventListener('click', abandon);
  $('dailyBtn').addEventListener('click', function () {
    if (game && mode === 'level') {
      var was = paused; paused = true;
      Lehcim.message('Jouer le défi du jour ? La partie en cours sera perdue.', ['Oui', 'Non']).then(function (i) { paused = was; if (i === 0) newGame(true); });
    } else newGame(true);
  });
  document.querySelector('[data-help]').addEventListener('click', function () { if (mode === 'level') togglePause(true); });

  Lehcim.initPage();
  // The shared helper writes "Son" next to the icon: keep the icon only in the top bar.
  var muteBtn = document.querySelector('[data-mute]');
  function muteIcon() { muteBtn.textContent = Lehcim.isMuted() ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(!Lehcim.isMuted())); }
  muteBtn.addEventListener('click', function () { muteIcon(); if (Lehcim.isMuted()) stopDark(); });
  muteIcon();

  applyLayout(wantPortrait());
  renderRecords();
  updatePauseButtons();

  Promise.all([
    Lehcim.loadSheet('../assets/sheet-maze.png', KEY),
    Lehcim.loadSheet('../assets/sheet-creatures.png', KEY)
  ]).then(function (sh) {
    maze = sh[0]; creatures = sh[1]; sheetsReady = true;
  });
  newDemo();
  showTitle();

  // ---------- Main loop: logic every 50 ms, drawing on each animation frame ----------

  function step() {
    if (dialogOpen()) return;
    if (game && lv && mode !== 'title') {
      if (paused) return;
      E.step(lv, input);
      handleEvents(lv, false);
    } else if (demo) {
      var s = demo.ship;
      if (demo.state === 'play' && !s.turn && (s.dir < 0 || s.t + E.SHIP_SPEED >= 1)) {
        var d = E.autopilotDir(demo);
        demoInput.held = d >= 0 ? [d] : [];
      }
      E.step(demo, demoInput);
      handleEvents(demo, true);
      if (demo.state === 'won' || demo.state === 'lost' || demo.tick > 2400) newDemo();
    }
    for (var i = popups.length - 1; i >= 0; i--) if (++popups[i].k > 24) popups.splice(i, 1);
    if (flash > 0) flash = Math.max(0, flash - 0.06);
  }
  var demoInput = E.newInput();

  var acc = 0;
  function frame(now) {
    if (!lastT) lastT = now;
    acc += Math.min(500, now - lastT); lastT = now;
    while (acc >= TICK) { acc -= TICK; step(); }
    frameCount++;
    draw();
    updateHud();
    updatePauseButtons();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Hooks for automated tests.
  window.LabRaph = {
    get mode() { return mode; }, get level() { return lv; }, get game() { return game; }, get paused() { return paused; },
    get layout() { return LY; }, input: input,
    newGame: newGame, nextLevel: nextLevel, startLevel: startLevel, step: step, press: press, release: release,
    fire: doFire, barrier: doBarrier, togglePause: togglePause, engine: E
  };
})();
