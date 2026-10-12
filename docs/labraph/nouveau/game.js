/*
 * LabRaph (nouvelle version) - page, drawing and controls.
 * The game logic (original rules) lives in engine.js (LabEngine). The original sprites
 * and sounds come from ../assets/. Logic runs on the original fixed 50 ms tick.
 *
 * The engine always works in the landscape coordinates of the original (maze at the
 * top left, stone column and exit on the right). In portrait the whole play area is
 * drawn turned a quarter turn clockwise (exit at the bottom), and the arrows, the
 * touch cross and the swipes are turned back before reaching the engine.
 */
(function () {
  'use strict';

  var E = window.LabEngine;
  var U = E.U, R = E.R, D = E.D, L = E.L, DX = E.DX, DY = E.DY, TICK = E.TICK;
  var KEY = [184, 10, 70];             // colour key of both sheets
  var MW = E.MAZE_W, MH = E.MAZE_H;    // 560 x 400

  // Sprite tables of each zoom (tile size T), as in the original port.
  var ZOOMS = {
    40: { tileY: 0, growY: 216, ship: 400, fx: [160, 354], bullet: [168, 339, 8], glob: 0, snake: 500 },
    32: { tileY: 80, growY: 256, ship: 640, fx: [240, 232], bullet: [247, 218, 6], glob: 240, snake: 740 },
    20: { tileY: 144, growY: 288, ship: 800, fx: [340, 152], bullet: [344, 144, 4], glob: 400, snake: 900 },
    16: { tileY: 184, growY: 308, ship: 860, fx: [360, 88], bullet: [362, 82, 4], glob: 460, snake: 960 }
  };
  // Wall bits of a cell (1 top, 2 right, 4 bottom, 8 left) -> [col,row] in the tile rows.
  var TILE = {};
  [[5, 0, 0], [10, 1, 0], [3, 2, 0], [6, 3, 0], [12, 4, 0], [9, 5, 0], [8, 6, 0], [1, 7, 0], [2, 8, 0], [4, 9, 0],
   [0, 0, 1], [14, 1, 1], [7, 2, 1], [11, 3, 1], [13, 4, 1], [15, 5, 1]].forEach(function (t) { TILE[t[0]] = [t[1], t[2]]; });
  var T_CORNER = 6, T_BOTTOM = 7, T_STONE = 8, T_EXIT = 9;   // second tile row
  var ROW_EXPLODE = 16, ROW_WARP = 17, ROW_EGG = 16, ROW_DIE = 17, ROW_FACE = 18;
  var TURN_ROW = [[-1, 4, 5, 6], [9, -1, 7, 8], [11, 12, -1, 10], [13, 14, 15, -1]];  // [to][from]
  var PANEL = [920, 0, 60, 400], BARRIER = [101, 517, 28, 80];
  var BOXES = [['level', 72, '#4040ff'], ['lives', 123, '#ff2020'], ['globs', 178, '#ffff40'],
               ['bullets', 232, '#ff2020'], ['time', 288, '#e8d8a0'], ['score', 342, '#4060ff']];
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game'), g = canvas.getContext('2d'), stage = $('stage'), overlay = $('overlay');
  var maze, creatures, sheetsReady = false;

  // ---------- Settings and records (localStorage, never required) ----------

  var SKEY = 'lehcim.labraph.nv';
  var DEFAULTS = { preset: 'normal', startLevel: '1', orient: 'auto', seed: '', panel: true, countdown: true, exitMark: true, effects: true, music: true, assist: true, touch: false };
  function loadStore(k, def) {
    try { var v = JSON.parse(localStorage.getItem(SKEY + '.' + k)); if (v && typeof v === 'object') return v; } catch (e) { /* ignore */ }
    return def;
  }
  function saveStore(k, v) { try { localStorage.setItem(SKEY + '.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  var settings = Object.assign({}, DEFAULTS, loadStore('settings', {}));
  if (!E.PRESETS[settings.preset]) settings.preset = 'normal';
  var bests = loadStore('best', {});          // {preset: {score, level}}
  var daily = loadStore('daily', {});         // {date, score, level}
  var HS_DEFAULTS = [{ name: 'Pro', score: 60 }, { name: 'Expert', score: 48 }, { name: 'Amateur', score: 36 }, { name: 'Débutant', score: 24 }, { name: 'Gromové', score: 12 }];
  function table(preset) { return Lehcim.highScores('labraph-nv-' + preset, HS_DEFAULTS); }

  // ---------- State ----------

  var game = null;     // {level, lives, score, bullets, start, seed, attempt, preset, daily}
  var lv = null;       // current level (engine object)
  var demo = null;     // title screen demo level
  var mode = 'title';  // title | level | between | over
  var paused = false;
  var input = E.newInput();
  var LY = null;       // layout {portrait, panel, W, H, mw, mh}
  var popups = [], flash = 0, frameCount = 0, lastT = 0, music = null;

  // ---------- Layout ----------

  function wantPortrait() {
    if (settings.orient === 'port') return true;
    if (settings.orient === 'land') return false;
    return window.innerWidth < 700 && window.innerHeight > window.innerWidth;
  }
  function applyLayout(portrait) {
    var panel = !portrait && settings.panel;
    if (LY && LY.portrait !== portrait) { input.held = []; input.buffer = -1; }
    LY = { portrait: portrait, panel: panel, mw: portrait ? MH : MW, mh: portrait ? MW : MH };
    LY.W = LY.mw + (panel ? 60 : 0); LY.H = LY.mh;
    if (canvas.width !== LY.W || canvas.height !== LY.H) { canvas.width = LY.W; canvas.height = LY.H; }
    g.imageSmoothingEnabled = false;
    document.body.classList.toggle('mini', !panel);
    $('pad').classList.toggle('force', !!settings.touch);
    fit();
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
    if (settings.orient === 'auto' && wantPortrait() !== LY.portrait) applyLayout(wantPortrait());
    else fit();
  });
  // Screen direction (arrow, cross, swipe) -> direction in the engine.
  function toEngineDir(d) { return LY.portrait ? (d + 3) % 4 : d; }
  // Engine pixel position -> canvas position.
  function toScreen(x, y) { return LY.portrait ? { x: MH - y, y: x } : { x: x, y: y }; }
  function viewTransform() { if (LY.portrait) g.setTransform(0, 1, -1, 0, MH, 0); else g.setTransform(1, 0, 0, 1, 0, 0); }

  // ---------- Game flow ----------

  function levelCfg(forDemo) {
    if (forDemo) return { preset: 'normal', countdown: false, god: true };
    return { preset: game.preset, countdown: settings.countdown };
  }

  function newGame(isDaily) {
    stopMusic(); closeOverlay();
    var today = E.dailySeed();
    var preset = isDaily ? 'normal' : settings.preset;
    var start = isDaily ? 1 : parseInt(settings.startLevel, 10) || 1;
    var seed = isDaily ? 'J' + today : (settings.seed.trim() || E.randomSeedCode());
    applyLayout(wantPortrait());
    game = { level: start, lives: E.PRESETS[preset].lives, score: 0, bullets: 0, start: null, seed: seed, attempt: 0, preset: preset, daily: isDaily ? today : null, startLevel: start };
    demo = null; paused = false;
    $('chipPreset').textContent = isDaily ? 'Défi du jour' : E.PRESETS[preset].label;
    renderRecords();
    startLevel(true);
    if (isDaily) toast('Défi du jour ' + today + ' : les mêmes labyrinthes pour tout le monde.');
  }

  // isNew: false when the level is played again after a life lost.
  function startLevel(isNew) {
    closeOverlay();
    var prevT = lv ? lv.T : null;
    lv = E.createLevel(game, levelCfg(false), isNew !== false);
    input.buffer = -1; input.assist = !!settings.assist;
    popups = []; mode = 'level';
    setStatus('Niveau ' + game.level, levelLine(lv.p) + '. Détruis tous les globules jaunes.');
    updateSeedLine();
    if (prevT && prevT !== lv.T) toast('Labyrinthe de ' + lv.p.cols + ' x ' + lv.p.rows + ' cases');
  }
  function levelLine(p) {
    return p.globs + (p.globs > 1 ? ' globules, ' : ' globule, ') + p.snakes + (p.snakes > 1 ? ' serpents, ' : ' serpent, ') + p.time + ' s';
  }

  var LOST = {
    time: ['Temps écoulé', 'Pendant les 20 dernières secondes, les murs s\'effacent : repère ton chemin avant.'],
    snake: ['Tu es mort !', 'Les serpents suivent les couloirs et, à chaque carrefour, prennent la direction qui les rapproche de toi à vol d\'oiseau : un mur peut les égarer. Un oeuf qui s\'ouvre de loin cache un serpent.'],
    escape: ['Un globule s\'est sauvé', 'Un globule qui longe le mur finit par trouver la sortie : pense à la barrière (Entrée) quand il s\'en approche.']
  };
  function afterLifeLost(why) {
    var t = LOST[why] || LOST.snake;
    if (game.lives <= 0) { gameOver(t[0]); return; }
    game.attempt++;
    mode = 'between';
    showOverlay({
      cls: 'bad', title: t[0],
      lines: ['Il te reste ' + game.lives + (game.lives > 1 ? ' vies.' : ' vie.') + ' Le niveau recommence dans un nouveau labyrinthe, avec ' + game.start + (game.start > 1 ? ' balles.' : ' balle.'), t[1]],
      buttons: [['Continuer', function () { startLevel(false); }, true]]
    });
    setStatus(t[0], 'Vies restantes : ' + game.lives, 'bad');
  }

  function levelDone() {
    mode = 'between';
    var n = game.level, p = E.levelParams(n + 1, { preset: game.preset });
    var next = Math.min(E.MAX_BULLETS, game.bullets + p.bonus);
    var lines = ['Score : ' + game.score + ' · balles gardées : ' + game.bullets,
      'Niveau ' + (n + 1) + ' : ' + p.cols + ' x ' + p.rows + ' cases, ' + levelLine(p) + ', ' + next + (next > 1 ? ' balles.' : ' balle.')];
    showOverlay({ cls: 'good', title: 'Niveau ' + n + ' terminé', lines: lines, buttons: [['Niveau suivant', nextLevel, true]] });
    setStatus('Niveau ' + n + ' terminé !', 'Score : ' + game.score, 'good');
    updateBest();
  }
  function nextLevel() { game.level++; game.attempt = 0; startLevel(true); }

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
    stopMusic();
    mode = 'over';
    var sc = game.score, prevBest = game.daily ? (daily.date === game.daily ? daily.score : -1) : (bests[game.preset] ? bests[game.preset].score : -1);
    updateBest();
    var newRecord = sc > prevBest && sc > 0;
    setStatus('La partie est terminée.', 'Score : ' + sc, 'bad');
    var hs = table(game.preset), p;
    if (!game.daily && hs.qualifies(sc)) {
      // "BRAVO !" window of the original: the name field starts with "bip-bip".
      p = Lehcim.prompt('BRAVO ! Tu fais partie des meilleurs ! Ecris ton nom .\n( 14 caractères maximum )', 14)
        .then(function (name) { lastName = name.slice(0, 14) || 'bip-bip'; hs.add(lastName, sc); });
      var inp = document.querySelector('dialog.msg[open] input');
      if (inp) { inp.value = 'bip-bip'; inp.select(); }
    } else p = Promise.resolve();
    p.then(function () {
      renderRecords();
      var lines = [(text ? text + '. ' : '') + 'Score : ' + sc + ' · niveau atteint : ' + game.level];
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
    stopMusic(); closeOverlay();
    game = null; lv = null; mode = 'title'; paused = false;
    applyLayout(wantPortrait());
    newDemo();
    showTitle();
  }

  function newDemo() {
    var dg = { level: 1, lives: 1, score: 0, bullets: 0, start: null, seed: 'demo' + Math.floor(Math.random() * 1e6), attempt: 0 };
    demo = E.createLevel(dg, levelCfg(true), true);
    demo.limit = 1e6;
  }

  function togglePause(force) {
    if (!game || mode !== 'level') return;
    var p = force == null ? !paused : force;
    if (p === paused) return;
    paused = p;
    if (paused) {
      if (music) { try { music.pause(); } catch (e) { /* ignore */ } }
      showOverlay({ title: 'Pause', lines: ['Niveau ' + game.level + ' · score ' + game.score], buttons: [['Reprendre', function () { togglePause(false); }, true], ['Abandonner', abandon]], hint: 'P ou Échap pour reprendre' });
    } else {
      closeOverlay();
      if (music) { try { var pr = music.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* ignore */ } }
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
      lines: ['Détruis tous les globules jaunes (contact : 2 points, balle : 1 point), puis sors par la porte de la colonne de pierre avant la fin du temps. Gare aux serpents rouges !',
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
    el.appendChild(document.createTextNode(' · niveau ' + game.level + (game.attempt ? ', essai ' + (game.attempt + 1) : '') + ' · ' + lv.p.cols + ' x ' + lv.p.rows + ' · ' + lv.limit + ' s'));
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
    return { level: game.level, lives: game.lives, globs: E.globsLeft(lv), bullets: E.bulletsLeft(lv), time: E.timeLeft(lv), score: game.score };
  }
  function updateHud() {
    var v = hudValues();
    var key = v ? [v.level, v.lives, v.globs, v.bullets, v.time, v.score, lv.barrier.state, lv.nearExit, paused].join() : '-';
    if (key === hudCache) return;
    hudCache = key;
    document.querySelectorAll('[data-v]').forEach(function (el) { el.textContent = v ? v[el.getAttribute('data-v')] : '-'; });
    var warn = v && v.time <= E.DARK_TIME && lv.state === 'play';
    document.querySelectorAll('[data-w="time"]').forEach(function (el) { el.classList.toggle('warn', !!warn); });
    var bar = $('timebar');
    bar.firstElementChild.style.width = v ? Math.max(0, 100 * v.time / lv.limit) + '%' : '100%';
    bar.classList.toggle('dark', !!warn);
    var cb = $('chipBarrier'), ce = $('chipExit');
    if (!v) { cb.className = 'chip'; cb.textContent = 'Barrière prête'; ce.className = 'chip'; ce.textContent = 'Sortie fermée'; return; }
    var bs = lv.barrier.state;
    cb.className = 'chip' + (bs === 1 ? ' on' : bs === 2 ? ' off' : lv.nearExit ? ' alert' : '');
    cb.textContent = bs === 1 ? 'Barrière active' : bs === 2 ? 'Barrière utilisée' : lv.nearExit ? 'Barrière ! (Entrée)' : 'Barrière prête';
    var open = v.globs === 0 && (lv.state === 'play' || lv.end === 'win');
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
          setStatus('Plus aucun globule !', 'Sors par la porte de la colonne de pierre.', 'good');
          toast('Sortie ouverte : rejoins la porte !');
          break;
        case 'nearExit': if (l.barrier.state === 0) toast('Un globule approche de la sortie ! Entrée = barrière'); break;
        case 'dark': setStatus('20 dernières secondes', 'Les murs s\'effacent peu à peu.', 'bad'); break;
        case 'go': startMusic(l); setStatus('Niveau ' + game.level + ' : détruis tous les globules !', levelLine(l.p)); break;
        case 'ending':
          stopMusic();
          if (e.why !== 'win') {
            if (settings.effects) {
              flash = 1;
              if (!REDUCED) { canvas.classList.remove('shake'); void canvas.offsetWidth; canvas.classList.add('shake'); }
            }
            setStatus((LOST[e.why] || LOST.snake)[0], '', 'bad');
          } else setStatus('Niveau terminé !', '', 'good');
          break;
        case 'lost': afterLifeLost(e.why); break;
        case 'won': levelDone(); break;
      }
    });
  }

  // ---------- Sound ----------

  // Original WAVE resources and their use in the program.
  var SND = {
    barrier: '../assets/sounds/1.wav', ricochet1: '../assets/sounds/2.wav', ricochet2: '../assets/sounds/3.wav',
    snakeShot: '../assets/sounds/4.wav', death: '../assets/sounds/5.wav', glob: '../assets/sounds/6.wav',
    dark: '../assets/sounds/7.wav', shot: '../assets/sounds/8.wav', exit: '../assets/sounds/9.wav'
  };
  var soundsAsked = false;
  function askSounds() { if (!soundsAsked) { soundsAsked = true; Lehcim.loadSounds(SND); } }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, askSounds, { once: true, capture: true }); });
  // Music of a level: one of the two long sounds (10 or 11), looped until the level ends.
  function startMusic(l) {
    stopMusic();
    if (Lehcim.isMuted() || !settings.music) return;
    try {
      var which = l.seed != null ? 10 + (l.seed & 1) : (Math.random() < 0.5 ? 10 : 11);
      var a = new Audio('../assets/sounds/' + which + '.wav');
      a.loop = true; a.volume = 0.5; music = a;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () { /* autoplay refused */ });
    } catch (e) { /* ignore */ }
  }
  function stopMusic() {
    if (music) { try { music.pause(); } catch (e) { /* ignore */ } music = null; }
  }

  // ---------- Input ----------

  var KEYDIR = { ArrowUp: U, ArrowRight: R, ArrowDown: D, ArrowLeft: L };
  function dialogOpen() { return !!document.querySelector('dialog[open]'); }
  function playing() { return game && lv && mode === 'level' && !paused; }
  // d: direction on the screen.
  function press(d) { E.inputPress(lv, input, toEngineDir(d)); }
  function release(d) { E.inputRelease(input, toEngineDir(d)); }
  function doFire() {
    if (!playing() || lv.state !== 'play') return;
    if (!E.fire(lv)) toast('Plus de balles !', 1200);
  }
  function doBarrier() {
    if (!playing()) return;
    var r = E.putBarrier(lv);
    if (r === true) toast('Barrière : la sortie est fermée aux créatures pendant 3 secondes.', 1600);
    else if (r === 'used') toast('La barrière a déjà servi dans ce niveau.');
    else if (r === 'glob') toast('Trop tard : un globule est déjà dans la sortie.');
  }
  function isPivotKey(e) { return e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.key === 'Shift'; }

  window.addEventListener('keydown', function (e) {
    if (dialogOpen()) return;
    var k = e.key, onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (k in KEYDIR) { e.preventDefault(); if (!e.repeat) press(KEYDIR[k]); return; }
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

  // Maze, stone column (and stone row at zoom 32) and exit, drawn once per level on
  // an off-screen canvas in the original coordinates; the erased spots are added to it.
  function background(l) {
    var z = ZOOMS[l.T], T = l.T, m = l.maze, x, y;
    if (!l.bg) {
      l.bg = document.createElement('canvas'); l.bg.width = MW; l.bg.height = MH; l.bgDone = 0;
      var b = l.bg.getContext('2d');
      b.fillStyle = '#000'; b.fillRect(0, 0, MW, MH);
      var tile = function (col, row, dx, dy, h) { b.drawImage(maze, col * T, z.tileY + row * T, T, h || T, dx, dy, T, h || T); };
      for (y = 0; y < m.rows; y++) {
        for (x = 0; x < m.cols; x++) { var t = TILE[m.walls[y * m.cols + x]]; tile(t[0], t[1], x * T, y * T); }
        tile(y === m.exit.y ? T_EXIT : T_STONE, 1, m.cols * T, y * T);
      }
      var rest = MH - m.rows * T;
      if (rest > 0) {
        for (x = 0; x < m.cols; x++) tile(T_BOTTOM, 1, x * T, m.rows * T, rest);
        tile(T_CORNER, 1, m.cols * T, m.rows * T, rest);
      }
    }
    if (l.bgDone < l.eraseLog.length) {
      var bc = l.bg.getContext('2d');
      for (; l.bgDone < l.eraseLog.length; l.bgDone++) {
        var e = l.eraseLog[l.bgDone];
        bc.drawImage(maze, e[2] * T, z.growY, T, T, e[0] * T + T / 2, e[1] * T + T / 2, T, T);
      }
    }
    return l.bg;
  }

  function draw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    if (!sheetsReady) return;
    var l = lv || demo;
    if (l) {
      viewTransform();
      drawLevel(l, !lv);
      g.setTransform(1, 0, 0, 1, 0, 0);
      drawPopups();
      if (l.state === 'countdown') {
        var n = 3 - Math.floor((l.stateTick - 1) / 12);
        banner(n > 0 ? String(n) : 'Partez !', 'Niveau ' + l.game.level + ' · ' + levelLine(l.p));
      }
    }
    if (LY.panel) drawPanel();
    if (flash > 0) {
      g.fillStyle = 'rgba(255,40,40,' + (0.45 * flash).toFixed(3) + ')';
      g.fillRect(0, 0, LY.mw, LY.mh);
    }
  }

  function banner(big, small) {
    g.save();
    var cy = LY.mh / 2;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, cy - 40, LY.mw, small ? 80 : 60);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold italic 34px "Times New Roman", serif'; g.fillStyle = '#ffd34d';
    g.fillText(big, LY.mw / 2, cy - 10);
    if (small) { g.font = '15px "Times New Roman", serif'; g.fillStyle = '#fff'; g.fillText(small, LY.mw / 2, cy + 24); }
    g.restore();
  }

  // Draws a square sprite of size s centred on a pixel position.
  function spr(img, sx, sy, s, p) {
    g.drawImage(img, sx, sy, s, s, Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
  }
  function rowOf(o) { return o.turn ? TURN_ROW[o.turn.to][o.turn.from] : o.face; }
  function frameOf(l, o) { return o.turn ? Math.min(l.n - 1, o.turn.k) : (o.k > 0 ? o.k - 1 : o.anim % l.n); }
  function centre(l, c) { return c * l.T + l.T / 2; }

  function drawLevel(l, isDemo) {
    var z = ZOOMS[l.T], s = l.s;
    g.drawImage(background(l), 0, 0);
    if (settings.exitMark && !isDemo) drawExitMark(l);
    if (l.barrier.state === 1) drawBarrier(l);
    l.creatures.forEach(function (c) {
      var x0 = c.kind === 'glob' ? z.glob : z.snake, p = E.pos(l, c);
      if (c.state === 1) spr(creatures, x0, ROW_EGG * s, s, p);
      else if (c.state === 2) spr(creatures, x0 + c.t * s, ROW_EGG * s, s, p);
      else if (c.state === 3) spr(creatures, x0 + frameOf(l, c) * s, rowOf(c) * s, s, p);
      else if (c.state === 4) spr(creatures, x0 + c.t * s, ROW_FACE * s, s, p);
      else if (c.state === 5) spr(creatures, x0 + c.t * s, ROW_DIE * s, s, p);
    });
    l.bullets.forEach(function (b) {
      var bb = z.bullet, p = E.bulletPos(l, b);
      g.drawImage(maze, bb[0], bb[1], bb[2], bb[2], Math.round(p.x - bb[2] / 2), Math.round(p.y - bb[2] / 2), bb[2], bb[2]);
    });
    drawShip(l);
    l.fx.forEach(function (f) {
      // Bullet hitting a wall: rows 1..4 of the effect block = up, right, down, left.
      var off = (l.T - s) / 2, k = Math.min(l.n - 1, f.k);
      g.drawImage(maze, z.fx[0] + k * s, z.fx[1] + (1 + f.dir) * s, s, s,
        Math.round(centre(l, f.x) + DX[f.dir] * off - s / 2), Math.round(centre(l, f.y) + DY[f.dir] * off - s / 2), s, s);
    });
  }

  function drawShip(l) {
    var z = ZOOMS[l.T], s = l.s, sh = l.ship, p = E.pos(l, sh);
    if (sh.state === 4) { if (sh.anim < l.n - 1) spr(maze, z.ship + sh.anim * s, ROW_EXPLODE * s, s, p); return; }
    if (sh.state === 5) { if (sh.anim < l.n) spr(maze, z.ship + sh.anim * s, ROW_WARP * s, s, p); return; }
    spr(maze, z.ship + frameOf(l, sh) * s, rowOf(sh) * s, s, p);
  }

  // The barrier slides down over the exit opening, then up again.
  function drawBarrier(l) {
    var T = l.T, e = l.maze.exit, w = Math.round(T * BARRIER[2] / BARRIER[3]);
    var x = e.x * T - Math.round(w / 2), y = e.y * T - Math.round(l.barrier.slide * T / 6);
    g.drawImage(maze, BARRIER[0], BARRIER[1], BARRIER[2], BARRIER[3], x, y, w, T);
  }

  // Exit marker (new): green chevrons on the exit once every globule is destroyed,
  // red ones while a globule comes close to it and the barrier is still available.
  function drawExitMark(l) {
    if (l.state !== 'play') return;
    var e = l.maze.exit, T = l.T, open = E.globsLeft(l) === 0;
    if (!open && !(l.nearExit && l.barrier.state === 0)) return;
    var pulse = REDUCED ? 1 : 0.55 + 0.45 * Math.sin(frameCount / 6);
    g.save();
    g.translate(Math.round(centre(l, e.x)), Math.round(centre(l, e.y)));
    g.globalAlpha = pulse;
    g.fillStyle = open ? '#3dff7a' : '#ff3030';
    var w = Math.max(4, T * 0.22);
    for (var i = 0; i < 2; i++) {
      var ox = (i - 0.5) * w * 0.9;
      g.beginPath(); g.moveTo(ox - w * 0.4, -w); g.lineTo(ox + w * 0.5, 0); g.lineTo(ox - w * 0.4, w); g.lineTo(ox - w * 0.1, 0); g.closePath(); g.fill();
    }
    g.restore();
  }

  function drawPopups() {
    if (!popups.length) return;
    g.save(); g.textAlign = 'center'; g.font = 'bold 15px "Times New Roman", serif';
    popups.forEach(function (p) {
      var q = toScreen(p.x, p.y);
      g.globalAlpha = Math.max(0, 1 - p.k / 24);
      g.fillStyle = '#000'; g.fillText(p.text, q.x + 1, q.y - p.k + 1);
      g.fillStyle = p.color; g.fillText(p.text, q.x, q.y - p.k);
    });
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
      if (k === 'orient') applyLayout(wantPortrait());
    });
  });
  document.querySelectorAll('#settings input[type=checkbox]').forEach(function (c) {
    c.addEventListener('change', function () {
      var k = c.getAttribute('data-set');
      settings[k] = c.checked; saveStore('settings', settings);
      if (k === 'panel' || k === 'touch') applyLayout(LY.portrait);
      if (k === 'music') { if (!c.checked) stopMusic(); else if (lv && lv.state === 'play' && mode === 'level') startMusic(lv); }
      if (k === 'assist') input.assist = c.checked;
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
  muteBtn.addEventListener('click', function () {
    muteIcon();
    if (Lehcim.isMuted()) stopMusic(); else if (lv && lv.state === 'play' && mode === 'level' && !paused) startMusic(lv);
  });
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

  var demoInput = E.newInput();
  function step() {
    if (dialogOpen()) return;
    if (game && lv && mode !== 'title') {
      if (paused) return;
      E.step(lv, input);
      handleEvents(lv, false);
    } else if (demo) {
      if (demo.ship.k === 0) { var d = E.autopilotDir(demo); demoInput.held = d >= 0 ? [d] : []; }
      E.step(demo, demoInput);
      handleEvents(demo, true);
      if (demo.state === 'won' || demo.state === 'lost' || demo.tick > 2400) newDemo();
    }
    for (var i = popups.length - 1; i >= 0; i--) if (++popups[i].k > 24) popups.splice(i, 1);
    if (flash > 0) flash = Math.max(0, flash - 0.06);
  }

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
