/*
 * Stack - "nouvelle version": page, input and rendering around engine.js.
 * Original sprites, sounds and music (../assets/), same rules; adds a side
 * panel HUD, countdown, pause, trajectory preview, drag / keyboard door
 * controls, touch controls, personal best and high-score card.
 */
(function () {
  'use strict';

  var SE = window.StackEngine, C = SE.C;
  var CELL = C.CELL, COLS = C.COLS, FX = C.FX, FY = C.FY, FW = C.FW, FB = C.FB;
  var LANE_Y = C.LANE_Y, LANE_ROW = C.LANE_ROW, MAX_STACK = C.MAX_STACK, CHOSE_W = C.CHOSE_W, CHOSE_H = C.CHOSE_H;
  var W = 480, H = 480;
  var colX = SE.colX, stackY = SE.stackY;

  // ---------- Sprites (assets/sheet.png, key colour 250,250,250) ----------

  var KEY = [250, 250, 250];
  var SPR = {
    marble: function (color, f) { return [520 + 40 * color + (f >= 18 ? 20 : 0), (f % 18) * 20, 20, 20]; },
    chose: function (f) { return [320, f * 24, CHOSE_W, 24]; },
    burst: function (f) { return [493, Math.round(f * 360 / 13), 27, 28]; },
    dust: function (f) { return [466, Math.round(f * 360 / 13), 27, 28]; },
    ghost: function (f) { return [520 + 20 * f, 360, 20, 20]; },
    hole: [760, 360, 20, 20],
    door: [19, 250, 49, 49],
    doorLeft: [0, 200, 61, 49],
    doorRight: [2, 250, 66, 49],
    grate: [0, 300, 49, 33],
    floor: function (i) { return [160 + 40 * (i % 4), 40 * ((i >> 2) % 2), 40, 40]; },
    outer: function (i) { return [40 * (i % 4), 40 + 40 * ((i >> 2) % 2), 40, 40]; },
    hbar: function (i) { return [40 * (i % 2), 120, 40, 20]; },
    vbar: function (i) { return [12 * (i % 6), 160, 10, 40]; }
  };
  var SND = { appear: 1, land: [4, 5, 6], door: 12, roll: 5, match: 9, crash: 3, life: 14, level: 17, over: 11, start: 15, fast: 10 };
  var MARBLE_RGB = ['#d33', '#36c', '#3a3', '#dd3', '#c3c', '#3cc', '#e83'];

  // ---------- DOM ----------

  function $(id) { return document.getElementById(id); }
  var canvas = $('game'), g = canvas.getContext('2d'), stage = $('stage'), overlay = $('overlay');
  var statusEl = $('status'), subEl = $('substatus'), toastsEl = $('toasts'), touchpad = $('touchpad');
  var hud = { score: $('hudScore'), level: $('hudLevel'), lives: $('hudLives'), speed: $('hudSpeed'), bar: $('hudBar'),
    next: $('hudNext'), best: $('hudBest'), pairs: $('hudPairs') };
  var pauseBtn = $('pauseBtn'), fastBtn = $('fastBtn');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Settings / storage ----------

  var SKEY = 'lehcim.stack.nv.settings', BKEY = 'lehcim.stack.nv.best';
  var S = { level: 1, music: true, path: true, countdown: true, seed: '', lastSeed: '' };
  try { var sv = JSON.parse(localStorage.getItem(SKEY)); if (sv) Object.keys(S).forEach(function (k) { if (k in sv) S[k] = sv[k]; }); } catch (e) { /* ignore */ }
  try { var lv0 = localStorage.getItem('lehcim.stack.level'); if (!localStorage.getItem(SKEY) && lv0) S.level = parseInt(lv0, 10) || 1; } catch (e) { /* ignore */ }
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  var best = 0;
  try { best = parseInt(localStorage.getItem(BKEY), 10) || 0; } catch (e) { /* ignore */ }
  function saveBest() { try { localStorage.setItem(BKEY, String(best)); } catch (e) { /* ignore */ } }

  var scores = Lehcim.highScores('stack', [
    { name: 'Pro', score: 350 }, { name: 'Expert', score: 300 }, { name: 'Amateur', score: 250 },
    { name: 'Junior', score: 150 }, { name: 'Gros Mauvais', score: 100 }
  ]);

  // ---------- Engine and UI state ----------

  var engine = SE.create({ onEvent: onEvent });
  var G = engine.G;
  var mode = 'idle';            // idle | countdown | play | paused | over
  var cd = 0;                   // countdown remaining (s)
  var sel = 1;                  // selected door (keyboard / touchpad)
  var selFlash = 0;             // highlight boost after a selection change
  var heldDir = 0;              // held arrow key / touch button
  var drag = null;              // pointer drag of a door
  var uiFx = [];                // floating texts
  var flash = 0;                // red flash after a crash
  var recordToast = false, prevBest = 0;
  var sheet = null, bgCanvas = null, scale = 1;

  // ---------- Toasts ----------

  function toast(text) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    toastsEl.appendChild(t);
    while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }
  function floatText(text, x, y, color) { uiFx.push({ text: text, x: x, y: y, color: color, t: 0 }); }
  function bump(el) { if (reduceMotion) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  // ---------- Engine events: sounds and feedback ----------

  function onEvent(type, a) {
    switch (type) {
      case 'spawn':
        Lehcim.play(SND.appear, 0.4);
        floatText('+1', a.x + 10, a.y + 4, '#ffd34d');
        bump(hud.score);
        if (!recordToast && prevBest > 0 && G.score > prevBest) { recordToast = true; toast('Nouveau record personnel !'); }
        break;
      case 'level':
        Lehcim.play(SND.level, 0.6);
        toast('Niveau ' + a + (SE.nColors(a) > SE.nColors(a - 1) ? ' - nouvelle couleur !' : ''));
        bump(hud.level);
        break;
      case 'roll': Lehcim.play(SND.roll, 0.35); break;
      case 'land': Lehcim.play(SND.land[Math.floor(Math.random() * 3)], 0.6); break;
      case 'match':
        Lehcim.play(SND.match, 0.7);
        floatText('Paire !', a.x + 10, a.y, '#7CFC9A');
        bump(hud.pairs);
        break;
      case 'burst': Lehcim.play(SND.crash, 0.5); break;
      case 'door': Lehcim.play(SND.door, 0.5); break;
      case 'crash':
        Lehcim.play(SND.crash, 0.8);
        setTimeout(function () { Lehcim.play(SND.life, 0.5); }, 250);
        floatText('-1 vie', a.x + 10, LANE_Y - 6, '#ff6b6b');
        flash = 0.35;
        if (!reduceMotion) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
        if (a.lives > 0) toast(a.lives === 1 ? 'Attention : dernière vie !' : 'Plus que ' + a.lives + ' vies');
        break;
      case 'over': gameOver(a); break;
    }
    updateHud();
  }

  // ---------- Game flow ----------

  function newGame() {
    closeOverlay();
    var seed = String(S.seed || '').trim() || String(Math.floor(Math.random() * 1e9));
    S.lastSeed = seed; saveSettings();
    engine.newGame({ seed: seed, level: S.level });
    prevBest = best; recordToast = false; uiFx = []; heldDir = 0; drag = null;
    Lehcim.play(SND.start);
    if (S.music) Lehcim.playMidi('../assets/music.mid', { loop: true }); else Lehcim.stopMusic();
    startCountdown(S.countdown ? 3 : 0);
    updateHud();
  }

  function startCountdown(sec) {
    if (sec > 0) { mode = 'countdown'; cd = sec; } else mode = 'play';
    syncControls();
  }

  function pause() {
    if (mode !== 'play' && mode !== 'countdown') return;
    mode = 'paused'; setFast(false); heldDir = 0;
    Lehcim.stopMusic();
    showOverlay('<h2>Pause</h2><p>La partie est suspendue.</p><div class="btns"><button class="btn primary" data-act="resume">Reprendre</button><button class="btn" data-act="new">Nouvelle partie</button></div><p><kbd>P</kbd> ou <kbd>Échap</kbd> pour reprendre</p>');
    syncControls();
  }
  function resume() {
    if (mode !== 'paused') return;
    closeOverlay();
    if (S.music) Lehcim.playMidi('../assets/music.mid', { loop: true });
    startCountdown(S.countdown ? 2 : 0);
  }
  function togglePause() { if (mode === 'paused') resume(); else pause(); }

  function abandon() {
    if (mode === 'idle' || mode === 'over') return;
    closeOverlay();
    engine.abandon();
  }

  function gameOver(a) {
    mode = 'over'; heldDir = 0; drag = null;
    Lehcim.stopMusic();
    Lehcim.play(SND.over, 0.7);
    var newBest = G.score > best;
    if (newBest) { best = G.score; saveBest(); }
    syncControls(); updateHud();
    setTimeout(function () {
      var p = Promise.resolve(null);
      if (scores.qualifies(G.score)) {
        p = Lehcim.prompt('Tu fais partie des meilleurs ! Ecris ton nom (14 lettres maximum)', 14).then(function (name) {
          scores.add(name.slice(0, 14), G.score);
          return G.score;
        });
      }
      p.then(function (mine) {
        renderScores(mine);
        if (mode !== 'over') return;
        showOverlay('<h2>Partie terminée</h2><p class="big">' + G.score + '</p><p>' +
          (newBest ? 'Nouveau record personnel !' : 'Record personnel : ' + best) + ' - niveau ' + G.level +
          ', ' + G.stats.matches + ' paire' + (G.stats.matches > 1 ? 's' : '') + '</p>' +
          '<div class="btns"><button class="btn primary" data-act="new">Rejouer</button><button class="btn" data-act="settings">Réglages</button></div>' +
          '<p style="font-size:13px">Graine de la partie : ' + escapeHtml(String(S.lastSeed)) + '</p>');
      });
    }, a && a.abandoned ? 300 : 1200);
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- Overlay ----------

  function showOverlay(html) {
    overlay.innerHTML = html; overlay.hidden = false;
    var b = overlay.querySelector('.btn.primary');
    if (b && !document.querySelector('dialog[open]')) b.focus({ preventScroll: true });
  }
  function closeOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    b.blur();
    if (act === 'new') newGame();
    else if (act === 'resume') resume();
    else if (act === 'settings') $('settings').showModal();
    else if (act === 'help') $('help').showModal();
  });
  function startScreen() {
    showOverlay('<h2>Stack</h2><p>Déplacez les portes pour guider les billes. Deux billes de même couleur s\'annulent. Protégez la « chose » qui traverse le couloir : 3 vies.</p>' +
      '<div class="keys"><span><kbd>↑</kbd><kbd>↓</kbd> <kbd>←</kbd><kbd>→</kbd></span><span>choisir / déplacer une porte</span>' +
      '<span>Souris / doigt</span><span>cliquer à côté d\'une porte, ou la faire glisser</span>' +
      '<span><kbd>Espace</kbd></span><span>accélérer la chose</span><span><kbd>P</kbd></span><span>pause</span></div>' +
      '<div class="btns"><button class="btn primary" data-act="new">Jouer</button><button class="btn" data-act="help">Règles</button></div>');
  }

  // ---------- HUD ----------

  var hudCache = {};
  function setText(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }

  function updateHud() {
    var playing = mode !== 'idle';
    var lvl = playing ? G.level : S.level;
    setText(hud.score, 's', String(playing ? G.score : 0));
    setText(hud.level, 'l', String(lvl));
    var lives = playing ? Math.max(0, G.lives) : 3;
    if (hudCache.lv !== lives) {
      hudCache.lv = lives;
      hud.lives.innerHTML = '♥♥♥'.slice(0, lives) + '<span class="off">' + '♥♥♥'.slice(0, 3 - lives) + '</span>';
      hud.lives.setAttribute('aria-label', lives + (lives > 1 ? ' vies' : ' vie'));
    }
    setText(hud.speed, 'v', String(SE.choseBase(lvl) * (G.fast && mode === 'play' ? 4 : 1)));
    var sc = playing ? G.score : (S.level - 1) * C.POINTS_PER_LEVEL;
    if (lvl >= C.MAX_LEVEL) { hud.bar.style.width = '100%'; setText(hud.next, 'n', 'Niveau maximum'); }
    else {
      var into = Math.min(C.POINTS_PER_LEVEL - 1, sc - (lvl - 1) * C.POINTS_PER_LEVEL), left = C.POINTS_PER_LEVEL - into;
      hud.bar.style.width = Math.max(0, Math.min(100, into / C.POINTS_PER_LEVEL * 100)) + '%';
      setText(hud.next, 'n', 'Niveau ' + (lvl + 1) + ' dans ' + left + ' bille' + (left > 1 ? 's' : ''));
    }
    setText(hud.best, 'b', String(Math.max(best, playing ? G.score : 0)));
    setText(hud.pairs, 'p', String(playing ? G.stats.matches : 0));
    var st, sub;
    if (mode === 'idle') { st = 'Prêt'; sub = 'Appuyez sur « Nouvelle partie ».'; }
    else if (mode === 'countdown') { st = 'Attention...'; sub = 'La partie commence.'; }
    else if (mode === 'paused') { st = 'Pause'; sub = 'P ou Échap pour reprendre.'; }
    else if (mode === 'over') { st = 'Partie terminée'; sub = 'Score : ' + G.score; }
    else { st = G.fast ? 'En jeu - accéléré' : 'En jeu'; sub = 'Porte choisie : ' + (sel + 1) + ' - graine ' + S.lastSeed; }
    setText(statusEl, 'st', st); setText(subEl, 'sub', sub);
    statusEl.className = 'status' + (mode === 'over' ? ' bad' : (mode === 'play' ? ' good' : ''));
  }

  function syncControls() {
    var active = mode === 'play' || mode === 'countdown' || mode === 'paused';
    pauseBtn.disabled = !active;
    pauseBtn.setAttribute('aria-pressed', mode === 'paused' ? 'true' : 'false');
    pauseBtn.textContent = mode === 'paused' ? '▶ Reprendre' : '⏸ Pause';
    fastBtn.disabled = !active;
    updateHud();
  }

  function renderScores(mine) {
    var ol = $('hsList'); ol.innerHTML = '';
    var marked = false;
    scores.list().forEach(function (e) {
      var li = document.createElement('li');
      var a = document.createElement('span'); a.textContent = e.name;
      var b = document.createElement('span'); b.textContent = e.score;
      li.appendChild(a); li.appendChild(b);
      if (mine != null && !marked && e.score === mine) { li.className = 'me'; marked = true; }
      ol.appendChild(li);
    });
  }

  // ---------- Doors: selection, keyboard, drag ----------

  function select(i) { sel = Math.max(0, Math.min(C.DOOR_TOPS.length - 1, i)); selFlash = 0.6; updateHud(); }
  function nudge(dir) {
    if (mode !== 'play' && mode !== 'countdown') return;
    var d = G.doors[sel], base = d.target !== d.col ? d.target : d.col, t = base + dir;
    if (Math.abs(t - d.col) <= 1) engine.setDoorTarget(sel, t);
    selFlash = 0.6;
  }
  function stepHeld() {
    if (mode !== 'play') return;
    // a door held by the pointer keeps pushing towards it (after a blocked move)
    if (drag && drag.want != null) {
      var dd = G.doors[drag.i];
      if (dd.target === dd.col && dd.col !== drag.want) engine.setDoorTarget(drag.i, drag.want);
    }
    if (!heldDir) return;
    var d = G.doors[sel];
    if (d.target === d.col) engine.setDoorTarget(sel, d.col + heldDir);
  }

  function setFast(on) {
    on = !!on && mode === 'play';
    if (on && !G.fast) Lehcim.play(SND.fast, 0.4);
    engine.setFast(on);
    fastBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    updateHud();
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (mode !== 'play' && mode !== 'countdown') return;
    var p = pos(e), i = engine.doorAt(p.y);
    if (i < 0 || p.x < FX - 10 || p.x > FX + FW + 10) return;
    select(i);
    if (mode === 'play') engine.clickAt(p);
    drag = { i: i, x0: e.clientX, moved: false, id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id || mode !== 'play') return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 6) return;
    drag.moved = true;
    drag.want = Math.max(0, Math.min(COLS - 2, Math.round((pos(e).x - FX - CELL) / CELL)));
    if (G.doors[drag.i].target !== drag.want) engine.setDoorTarget(drag.i, drag.want);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { drag = null; });
  });

  function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'); }
  var DIRS = { ArrowLeft: -1, a: -1, A: -1, q: -1, Q: -1, ArrowRight: 1, d: 1, D: 1 };
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]') || typing(e)) return;
    var active = mode === 'play' || mode === 'countdown';
    var k = e.key;
    if (e.code === 'Space' || k === ' ') {
      if (active || mode === 'paused') { e.preventDefault(); if (!e.repeat) setFast(true); }
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') { if (active || mode === 'paused') { e.preventDefault(); togglePause(); } return; }
    if (k === 't' || k === 'T') { setPath(!S.path); toast(S.path ? 'Trajectoires affichées' : 'Trajectoires masquées'); return; }
    if (k === 'Enter' && (mode === 'idle' || mode === 'over') && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); newGame(); return; }
    if (!active) return;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'z' || k === 'Z') { e.preventDefault(); select(sel - 1); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); select(sel + 1); }
    else if (k >= '1' && k <= '4') select(parseInt(k, 10) - 1);
    else if (DIRS[k]) { e.preventDefault(); if (!e.repeat) { heldDir = DIRS[k]; nudge(heldDir); } }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space' || e.key === ' ') { setFast(false); return; }
    if (DIRS[e.key] && heldDir === DIRS[e.key]) heldDir = 0;
  });
  window.addEventListener('blur', function () { setFast(false); heldDir = 0; });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  // hold buttons (accelerate, touchpad arrows)
  function holdButton(el, down, up) {
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); down(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { el.addEventListener(ev, up); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); down(); } });
    el.addEventListener('keyup', function (e) { if (e.key === 'Enter') up(); });
  }
  holdButton(fastBtn, function () { setFast(true); }, function () { setFast(false); });
  touchpad.querySelectorAll('[data-tp]').forEach(function (b) {
    var a = b.getAttribute('data-tp');
    if (a === 'fast') holdButton(b, function () { setFast(true); }, function () { setFast(false); });
    else if (a === 'left' || a === 'right') {
      var dir = a === 'left' ? -1 : 1;
      holdButton(b, function () { heldDir = dir; nudge(dir); }, function () { if (heldDir === dir) heldDir = 0; });
    } else if (a === 'up' || a === 'down') b.addEventListener('click', function () { select(sel + (a === 'up' ? -1 : 1)); });
    else if (a === 'pause') b.addEventListener('click', function () { togglePause(); });
  });
  pauseBtn.addEventListener('click', function () { togglePause(); pauseBtn.blur(); });
  $('new').addEventListener('click', function (e) { e.currentTarget.blur(); newGame(); });

  // ---------- Settings dialog ----------

  var optLevel = $('optLevel'), optMusic = $('optMusic'), optPath = $('optPath'), optPath2 = $('optPath2');
  var optCountdown = $('optCountdown'), optSeed = $('optSeed');
  function syncSettingsUi() {
    optLevel.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-v') === S.level)); });
    optMusic.checked = !!S.music; optPath.checked = optPath2.checked = !!S.path;
    optCountdown.checked = !!S.countdown; optSeed.value = S.seed || '';
  }
  function setPath(on) { S.path = !!on; saveSettings(); syncSettingsUi(); }
  optLevel.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.level = +b.getAttribute('data-v'); saveSettings(); syncSettingsUi(); updateHud();
  });
  optMusic.addEventListener('change', function () {
    S.music = optMusic.checked; saveSettings();
    if (S.music && (mode === 'play' || mode === 'countdown')) Lehcim.playMidi('../assets/music.mid', { loop: true });
    else Lehcim.stopMusic();
  });
  optPath.addEventListener('change', function () { setPath(optPath.checked); optPath.blur(); });
  optPath2.addEventListener('change', function () { setPath(optPath2.checked); });
  optCountdown.addEventListener('change', function () { S.countdown = optCountdown.checked; saveSettings(); });
  optSeed.addEventListener('input', function () { S.seed = optSeed.value.trim(); saveSettings(); });
  $('seedLast').addEventListener('click', function () { S.seed = String(S.lastSeed || ''); saveSettings(); syncSettingsUi(); });
  $('settingsBtn').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (mode === 'play' || mode === 'countdown') pause();
    syncSettingsUi(); $('settings').showModal();
  });
  document.querySelector('[data-help]').addEventListener('click', function () { if (mode === 'play' || mode === 'countdown') pause(); });

  // ---------- Rendering ----------

  function spr(r, x, y, w, h) { g.drawImage(sheet, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), w || r[2], h || r[3]); }

  function buildBackground() {
    bgCanvas = document.createElement('canvas'); bgCanvas.width = W; bgCanvas.height = H;
    var b = bgCanvas.getContext('2d'), i, j, r;
    for (j = 0; j < H; j += 40) for (i = 0; i < W; i += 40) {
      r = SPR.outer((i / 40 * 7 + j / 40 * 3) % 8); b.drawImage(sheet, r[0], r[1], 40, 40, i, j, 40, 40);
    }
    b.save(); b.beginPath(); b.rect(FX, FY, FW, FB - FY); b.clip();
    for (j = FY; j < FB; j += 40) for (i = FX; i < FX + FW; i += 40) {
      r = SPR.floor((i / 40 * 5 + j / 40 * 3) % 8); b.drawImage(sheet, r[0], r[1], 40, 40, i, j, 40, 40);
    }
    b.restore();
    b.fillStyle = 'rgba(0,0,0,0.35)'; b.fillRect(FX, LANE_Y - 2, FW, CHOSE_H);
    for (i = FX - 10, j = 0; i < FX + FW + 10; i += 40, j++) {
      r = SPR.hbar(j); b.drawImage(sheet, r[0], r[1], 40, 20, i, FY - 20, Math.min(40, FX + FW + 10 - i), 20);
      b.drawImage(sheet, r[0], r[1], 40, 20, i, FB, Math.min(40, FX + FW + 10 - i), 20);
    }
    for (j = FY, i = 0; j < FB; j += 40, i++) {
      r = SPR.vbar(i); b.drawImage(sheet, r[0], r[1], 10, 40, FX - 10, j, 10, 40);
      r = SPR.vbar(i + 3); b.drawImage(sheet, r[0], r[1], 10, 40, FX + FW, j, 10, 40);
    }
    r = SPR.grate;
    b.drawImage(sheet, r[0], r[1], 40, 25, 0, LANE_Y - 2, 40, 25);
    b.drawImage(sheet, r[0], r[1], 40, 25, FX + FW, LANE_Y - 2, 40, 25);
  }

  // average colour of each marble sprite, for the trajectory lines
  function sampleColors() {
    try {
      var rowW = 40 * C.NCOLORS, tmp = document.createElement('canvas');
      tmp.width = rowW; tmp.height = 20;
      var tc = tmp.getContext('2d', { willReadFrequently: true });
      tc.drawImage(sheet, 520, 0, rowW, 20, 0, 0, rowW, 20);
      var all = tc.getImageData(0, 0, rowW, 20).data;
      for (var k = 0; k < C.NCOLORS; k++) {
        var rr = 0, gg = 0, bb = 0, n = 0;
        for (var y = 5; y < 15; y++) for (var x = 40 * k + 5; x < 40 * k + 15; x++) {
          var i = (y * rowW + x) * 4;
          if (all[i + 3] > 0) { rr += all[i]; gg += all[i + 1]; bb += all[i + 2]; n++; }
        }
        if (n) {
          var m = Math.max(rr, gg, bb) / n, f = m > 0 ? Math.min(2, 235 / m) : 1;
          MARBLE_RGB[k] = 'rgb(' + Math.round(rr / n * f) + ',' + Math.round(gg / n * f) + ',' + Math.round(bb / n * f) + ')';
        }
      }
    } catch (e) { /* file:// origin: keep the default palette */ }
  }

  function drawMarble(color, dist, x, y, sc) {
    var r = SPR.marble(color, Math.floor(dist / 4) % 36);
    if (sc == null || sc === 1) spr(r, x, y);
    else { var s = CELL * sc; spr(r, x + (CELL - s) / 2, y + (CELL - s) / 2, s, s); }
  }

  function drawPaths() {
    g.save();
    g.lineWidth = 2; g.lineJoin = 'round';
    g.setLineDash([4, 4]);
    g.lineDashOffset = reduceMotion ? 0 : -G.time * 24;
    G.marbles.forEach(function (m) {
      if (m.dead) return;
      var p = engine.predictPath(m), pts = p.points, st = G.stacks[p.col], h = p.height;
      g.strokeStyle = MARBLE_RGB[m.color]; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(pts[0][0] + 10, pts[0][1] + 10);
      for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + 10, pts[i][1] + 10);
      g.stroke();
      var end = pts[pts.length - 1], ex = end[0] + 10, ey = end[1] + 10;
      g.setLineDash([]);
      if (h >= MAX_STACK) {
        g.strokeStyle = '#ff4d4d'; g.globalAlpha = 1;
        g.beginPath(); g.moveTo(ex - 6, ey + 14); g.lineTo(ex + 6, ey + 26); g.moveTo(ex + 6, ey + 14); g.lineTo(ex - 6, ey + 26); g.stroke();
      } else {
        g.globalAlpha = 0.35; drawMarble(m.color, 0, end[0], end[1]);
        var match = h > 0 && st[h - 1].color === m.color;
        if (match || h >= LANE_ROW) {
          g.globalAlpha = 1; g.strokeStyle = match ? '#5cff7a' : '#ff4d4d';
          g.beginPath(); g.arc(ex, match ? ey + CELL : ey, 11, 0, Math.PI * 2); g.stroke();
        }
      }
      g.setLineDash([4, 4]);
    });
    g.restore();
  }

  function drawSelection() {
    if (mode !== 'play' && mode !== 'countdown') return;
    var d = G.doors[sel]; if (!d) return;
    g.save();
    g.fillStyle = 'rgba(255,211,77,' + (0.05 + selFlash * 0.12).toFixed(3) + ')';
    g.fillRect(FX, d.top - 10, FW, 60);
    if (d.target !== d.col) {
      g.strokeStyle = 'rgba(255,211,77,0.8)'; g.lineWidth = 2; g.setLineDash([3, 3]);
      g.strokeRect(colX(d.target) + 1, d.top + 1, 38, 38);
    }
    g.restore();
  }

  function render() {
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(bgCanvas, 0, 0);
    g.save(); g.beginPath(); g.rect(FX, FY, FW, FB - FY); g.clip();
    G.stacks.forEach(function (st, c) { st.forEach(function (b, k) { drawMarble(b.color, b.frame * 4, colX(c), stackY(k)); }); });
    drawSelection();
    if (S.path && mode !== 'idle' && mode !== 'over') drawPaths();
    G.doors.forEach(function (d) {
      var tx = colX(d.col);
      if (d.x > tx + 0.5) spr(SPR.doorLeft, d.x, d.top);
      else if (d.x < tx - 0.5) spr(SPR.doorRight, d.x - 17, d.top);
      else spr(SPR.door, d.x, d.top);
    });
    G.marbles.forEach(function (m) {
      if (m.state === 'appear') {
        var p = Math.min(1, m.t / C.APPEAR_T);
        spr(SPR.hole, m.x, m.y);
        drawMarble(m.color, 0, m.x, m.y, 0.2 + 0.8 * p);
      } else drawMarble(m.color, m.dist, m.x, m.y);
    });
    var ch = G.chose;
    if (mode !== 'idle' && ch.alive && !(ch.grace > 0 && Math.floor(G.time * 10) % 2)) spr(SPR.chose(ch.frame), ch.x, LANE_Y - 2);
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
    if (flash > 0) { g.fillStyle = 'rgba(255,40,40,' + (flash * 0.6).toFixed(3) + ')'; g.fillRect(FX, FY, FW, FB - FY); }
    g.restore();
    drawSelectionArrowsOnTop();
    // floating texts
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 14px system-ui, sans-serif';
    uiFx.forEach(function (f) {
      var life = 0.9, a = 1 - f.t / life, dy = reduceMotion ? 0 : -24 * f.t / life;
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillText(f.text, f.x + 1, f.y + dy + 1);
      g.fillStyle = f.color; g.fillText(f.text, f.x, f.y + dy);
    });
    g.globalAlpha = 1;
    if (mode === 'countdown') {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(FX, FY, FW, FB - FY);
      var n = Math.ceil(cd), frac = cd - Math.floor(cd), s = reduceMotion ? 1 : 1 + 0.4 * frac;
      g.save(); g.translate(W / 2, H / 2 - 10); g.scale(s, s);
      g.font = 'bold 96px system-ui, sans-serif'; g.fillStyle = '#ffd34d'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0); g.restore();
      g.font = 'bold 16px system-ui, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
      g.fillText('Préparez vos portes !', W / 2, H / 2 + 60);
    }
    g.textAlign = 'left';
  }
  // arrows on the side walls, outside the playfield clip
  function drawSelectionArrowsOnTop() {
    if (mode !== 'play' && mode !== 'countdown') return;
    var d = G.doors[sel]; if (!d) return;
    var y = d.top + 20;
    g.fillStyle = 'rgba(255,211,77,' + (0.6 + Math.min(0.4, selFlash)).toFixed(3) + ')';
    g.beginPath(); g.moveTo(FX - 12, y - 9); g.lineTo(FX - 1, y); g.lineTo(FX - 12, y + 9); g.fill();
    g.beginPath(); g.moveTo(FX + FW + 12, y - 9); g.lineTo(FX + FW + 1, y); g.lineTo(FX + FW + 12, y + 9); g.fill();
  }

  // ---------- Main loop ----------

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    uiFx.forEach(function (f) { f.t += dt; });
    uiFx = uiFx.filter(function (f) { return f.t < 0.9; });
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (selFlash > 0) selFlash = Math.max(0, selFlash - dt);
    if (mode === 'countdown') {
      cd -= dt; engine.advanceFx(dt);
      if (cd <= 0) { mode = 'play'; syncControls(); }
    } else if (mode === 'play') {
      stepHeld();
      engine.advance(dt);
      updateHud();
    } else engine.advanceFx(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Canvas fit (crisp: backing store at device resolution) ----------

  function fit() {
    var w = stage.clientWidth;
    var top = stage.getBoundingClientRect().top + window.scrollY;
    var tp = getComputedStyle(touchpad).display !== 'none' ? touchpad.offsetHeight + 8 : 0;
    var avail = window.innerHeight - top - tp - 16;
    var size = Math.floor(Math.min(w, Math.max(260, avail)));
    if (size >= W * 2) size = Math.floor(size / W) * W;
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
    scale = canvas.width / W;
    if (sheet) render();
  }
  window.addEventListener('resize', fit);

  // ---------- Start ----------

  Lehcim.initPage();
  // mute button: icon + label that can be hidden on narrow screens
  document.querySelectorAll('[data-mute]').forEach(function (b) {
    function wrap() {
      if (b.querySelector('.lbl')) return;
      var t = b.textContent, i = t.indexOf(' ');
      if (i < 0) return;
      b.innerHTML = '<span aria-hidden="true">' + t.slice(0, i) + '</span><span class="lbl">' + t.slice(i) + '</span>';
      b.setAttribute('aria-label', Lehcim.isMuted() ? 'Son coupé (activer)' : 'Son actif (couper)');
    }
    wrap();
    new MutationObserver(wrap).observe(b, { childList: true, characterData: true, subtree: true });
  });
  var sounds = {};
  for (var i = 1; i <= 17; i++) sounds[i] = '../assets/sounds/' + i + '.wav';
  var soundsLoaded = false;
  ['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (soundsLoaded) return; soundsLoaded = true; Lehcim.loadSounds(sounds); }, true);
  });
  syncSettingsUi(); renderScores(null); syncControls(); fit();
  startScreen();
  Lehcim.loadSheet('../assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    buildBackground(); sampleColors(); fit();
    requestAnimationFrame(frame);
  });

  // test hook
  window.__stack = { engine: engine, G: G, newGame: newGame, pause: pause, resume: resume, abandon: abandon,
    select: select, nudge: nudge, mode: function () { return mode; }, skipCountdown: function () { cd = 0; } };
})();
