/*
 * Stack - "nouvelle version": page, input and rendering around engine.js.
 * Same rules, sprites, sounds and music as the original (../engine.js does
 * the simulation and the drawing of the board); adds a side panel HUD,
 * countdown, pause, trajectory preview, keyboard and touch controls for the
 * bars, personal best and high-score card.
 */
(function () {
  'use strict';

  var SE = window.StackEngine, SS = SE.Sim;
  var W = SS.W, H = SS.H;
  var KEY = [250, 250, 250];
  var MARBLE_RGB = ['#f39a1d', '#7fa6d8', '#c9c08a', '#e070e0', '#2fbfa8', '#ff5a6a', '#b8d63a'];
  var COLOR_NAMES = ['orange', 'bleue', 'kaki', 'rose', 'turquoise', 'rouge', 'verte'];

  // ---------- DOM ----------

  function $(id) { return document.getElementById(id); }
  var canvas = $('game'), g = canvas.getContext('2d'), stage = $('stage'), overlay = $('overlay');
  var statusEl = $('status'), subEl = $('substatus'), toastsEl = $('toasts'), touchpad = $('touchpad');
  var hud = { score: $('hudScore'), level: $('hudLevel'), lives: $('hudLives'), speed: $('hudSpeed'), bar: $('hudBar'),
    next: $('hudNext'), colors: $('hudColors'), best: $('hudBest'), pairs: $('hudPairs') };
  var pauseBtn = $('pauseBtn'), fastBtn = $('fastBtn');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Settings / storage ----------

  var SKEY = 'lehcim.stack.nv.settings', BKEY = 'lehcim.stack.nv.best';
  var S0 = { level: 1, music: true, path: true, countdown: true, seed: '', lastSeed: '' };
  var opt = {};
  Object.keys(S0).forEach(function (k) { opt[k] = S0[k]; });
  try { var sv = JSON.parse(localStorage.getItem(SKEY)); if (sv) Object.keys(opt).forEach(function (k) { if (k in sv) opt[k] = sv[k]; }); } catch (e) { /* ignore */ }
  opt.level = Math.max(1, Math.min(5, parseInt(opt.level, 10) || 1));
  function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(opt)); } catch (e) { /* ignore */ } }
  var best = 0;
  try { best = parseInt(localStorage.getItem(BKEY), 10) || 0; } catch (e) { /* ignore */ }
  function saveBest() { try { localStorage.setItem(BKEY, String(best)); } catch (e) { /* ignore */ } }

  var DEFAULTS = [
    { name: 'Pro', score: 350 }, { name: 'Expert', score: 300 }, { name: 'Amateur', score: 250 },
    { name: 'Junior', score: 150 }, { name: 'Gros Mauvais', score: 100 }
  ];
  var scores = Lehcim.highScores('stack', DEFAULTS);
  function qualifies(score) { var l = scores.list(); return score >= l[l.length - 1].score; }
  function addScore(name, score) {
    var l = scores.list(), i = 0;
    while (i < l.length && l[i].score > score) i++;
    l.splice(i, 0, { name: name || '???', score: score });
    l = l.slice(0, DEFAULTS.length);
    try { localStorage.setItem('lehcim.stack.scores', JSON.stringify(l)); } catch (e) { /* ignore */ }
  }

  // ---------- Engine and UI state ----------

  var engine = SE.create({ onEvent: onEvent, onSound: function (n) { Lehcim.play(n, n === SS.SND.over ? 0.8 : 0.6); } });
  var S = engine.S;
  var mode = 'idle';            // idle | countdown | play | paused | over
  var cd = 0;                   // countdown remaining (s)
  var sel = 6;                  // selected bar (1..6, keyboard / touchpad)
  var selFlash = 0;
  var heldDir = 0;              // held arrow key / touch button
  var fastHeld = false;
  var drag = null;              // pointer drag along a bar row
  var uiFx = [];                // floating texts
  var flash = 0;                // red flash after a crash
  var recordToast = false, prevBest = 0;
  var sheet = null, bgCanvas = null, scale = 1, time = 0;

  // ---------- Toasts ----------

  function toast(text) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    toastsEl.appendChild(t);
    while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2200);
  }
  function floatText(text, x, y, color) { uiFx.push({ text: text, x: x, y: y, color: color, t: 0 }); }
  function bump(el) { if (reduceMotion) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  // ---------- Engine events: feedback ----------

  function onEvent(type, a) {
    switch (type) {
      case 'spawn':
        floatText('+1', SS.DROP_X + 10, 44, '#ffd34d');
        bump(hud.score);
        if (!recordToast && prevBest > 0 && S.score > prevBest) { recordToast = true; toast('Nouveau record personnel !'); }
        break;
      case 'vitesse': bump(hud.speed); toast('Vitesse ' + a + ' : les billes arrivent plus souvent'); break;
      case 'color': toast('Nouvelle couleur : bille ' + COLOR_NAMES[a - 1]); bump(hud.colors); break;
      case 'speed': toast('La chose change d\'allure'); break;
      case 'match':
        floatText('Paire !', SS.colX(a.col) + 10, SS.COL_Y - 20 * (S.cols[a.col].h + 1), '#7CFC9A');
        bump(hud.pairs);
        break;
      case 'crash':
        floatText('-1 vie', a.x + 12, SS.CHOSE_Y - 8, '#ff6b6b');
        flash = 0.35;
        if (!reduceMotion) { stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake'); }
        if (a.lives > 0) toast(a.lives === 1 ? 'Attention : dernière vie !' : 'Plus que ' + a.lives + ' vies');
        break;
      case 'over': Lehcim.stopMusic(); break;
      case 'finished': gameOver(); break;
    }
    updateHud();
  }

  // ---------- Game flow ----------

  function newGame() {
    closeOverlay();
    var seed = String(opt.seed || '').trim() || String(Math.floor(Math.random() * 1e9));
    opt.lastSeed = seed; saveSettings();
    engine.newGame({ seed: seed, level: opt.level });
    prevBest = best; recordToast = false; uiFx = []; heldDir = 0; drag = null; fastHeld = false;
    Lehcim.play(SS.SND.bip, 0.6);
    if (opt.music) Lehcim.playMidi('../assets/music.mid', { loop: true }); else Lehcim.stopMusic();
    startCountdown(opt.countdown ? 3 : 0);
    updateHud();
  }

  function startCountdown(sec) {
    if (sec > 0) { mode = 'countdown'; cd = sec; } else mode = 'play';
    syncControls();
  }

  function pause() {
    if (mode !== 'play' && mode !== 'countdown') return;
    mode = 'paused'; fastHeld = false; heldDir = 0;
    Lehcim.stopMusic();
    showOverlay('<h2>Pause</h2><p>La partie est suspendue.</p><div class="btns"><button class="btn primary" data-act="resume">Reprendre</button><button class="btn" data-act="abandon">Abandonner</button></div><p><kbd>P</kbd> ou <kbd>Échap</kbd> pour reprendre</p>');
    syncControls();
  }
  function resume() {
    if (mode !== 'paused') return;
    closeOverlay();
    if (opt.music && !S.over) Lehcim.playMidi('../assets/music.mid', { loop: true });
    startCountdown(opt.countdown ? 2 : 0);
  }
  function togglePause() { if (mode === 'paused') resume(); else pause(); }

  function abandon() {
    if (mode === 'idle' || mode === 'over') return;
    closeOverlay();
    engine.abandon();
    Lehcim.stopMusic();
    mode = 'idle';
    syncControls();
    startScreen();
  }

  function gameOver() {
    mode = 'over'; heldDir = 0; drag = null; fastHeld = false;
    Lehcim.stopMusic();
    var newBest = S.score > best;
    if (newBest) { best = S.score; saveBest(); }
    syncControls(); updateHud();
    var p = Promise.resolve(null);
    if (qualifies(S.score)) {
      p = Lehcim.prompt('Tu fais partie des meilleurs ! Ecris ton nom (14 lettres maximum)', 14).then(function (name) {
        addScore(name.slice(0, 14), S.score);
        return S.score;
      });
    }
    p.then(function (mine) {
      renderScores(mine);
      if (mode !== 'over') return;
      showOverlay('<h2>Partie terminée</h2><p class="big">' + S.score + '</p><p>' +
        (newBest ? 'Nouveau record personnel !' : 'Record personnel : ' + best) + ' - vitesse ' + S.vitesse +
        ', ' + engine.stats.matches + ' paire' + (engine.stats.matches > 1 ? 's' : '') + '</p>' +
        '<div class="btns"><button class="btn primary" data-act="new">Rejouer</button><button class="btn" data-act="settings">Réglages</button></div>' +
        '<p style="font-size:13px">Graine de la partie : ' + escapeHtml(String(opt.lastSeed)) + '</p>');
    });
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
    else if (act === 'abandon') abandon();
    else if (act === 'settings') $('settings').showModal();
    else if (act === 'help') $('help').showModal();
  });
  function startScreen() {
    showOverlay('<h2>Stack</h2><p>Les billes tombent du distributeur à travers un triangle de clous. Déplacez les 6 petites barres pour choisir leur chemin, faites tomber une bille sur une bille de même couleur pour les effacer, et protégez la « chose » qui traverse le couloir : 3 vies.</p>' +
      '<div class="keys"><span><kbd>↑</kbd><kbd>↓</kbd> <kbd>←</kbd><kbd>→</kbd></span><span>choisir / déplacer une barre</span>' +
      '<span>Souris / doigt</span><span>toucher à gauche ou à droite d\'une barre, sur sa ligne</span>' +
      '<span><kbd>Espace</kbd></span><span>accélérer la chose</span><span><kbd>P</kbd></span><span>pause</span></div>' +
      '<div class="btns"><button class="btn primary" data-act="new">Jouer</button><button class="btn" data-act="help">Règles</button></div>');
  }

  // ---------- HUD ----------

  var hudCache = {};
  function setText(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }

  function updateHud() {
    var playing = mode !== 'idle';
    var lvl = playing ? S.startLevel : opt.level;
    var score = playing ? S.score : (opt.level - 1) * 10;
    var vit = playing ? S.vitesse : opt.level;
    setText(hud.score, 's', String(score));
    setText(hud.level, 'l', String(lvl));
    var lives = playing ? Math.max(0, S.chose.lives) : 3;
    if (hudCache.lv !== lives) {
      hudCache.lv = lives;
      hud.lives.innerHTML = '♥♥♥'.slice(0, lives) + '<span class="off">' + '♥♥♥'.slice(0, 3 - lives) + '</span>';
      hud.lives.setAttribute('aria-label', lives + (lives > 1 ? ' vies' : ' vie'));
    }
    setText(hud.speed, 'v', String(vit));
    var interval = playing ? S.interval : 60 - opt.level;
    if (interval <= 10) { hud.bar.style.width = '100%'; setText(hud.next, 'n', 'Cadence maximale : une bille toutes les 0,4 s'); }
    else {
      var into = score % 10, left = 10 - into;
      hud.bar.style.width = (into * 10) + '%';
      setText(hud.next, 'n', 'Vitesse ' + (vit + 1) + ' dans ' + left + ' bille' + (left > 1 ? 's' : '') +
        ' (une bille toutes les ' + (interval * 0.04).toFixed(2).replace('.', ',') + ' s)');
    }
    var nc = playing ? S.nColors : opt.level + 2;
    setText(hud.colors, 'c', nc + ' / 7');
    setText(hud.best, 'b', String(Math.max(best, playing ? S.score : 0)));
    setText(hud.pairs, 'p', String(playing ? engine.stats.matches : 0));
    var st, sub;
    if (mode === 'idle') { st = 'Prêt'; sub = 'Appuyez sur « Nouvelle partie ».'; }
    else if (mode === 'countdown') { st = 'Attention...'; sub = 'La partie commence.'; }
    else if (mode === 'paused') { st = 'Pause'; sub = 'P ou Échap pour reprendre.'; }
    else if (mode === 'over' || S.over) { st = 'Partie terminée'; sub = 'Score : ' + S.score; }
    else { st = 'En jeu'; sub = 'Barre choisie : ' + sel + ' - graine ' + opt.lastSeed; }
    setText(statusEl, 'st', st); setText(subEl, 'sub', sub);
    statusEl.className = 'status' + (mode === 'over' || S.over ? ' bad' : (mode === 'play' ? ' good' : ''));
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

  // ---------- Bars: selection, keyboard, pointer ----------

  function canAct() { return mode === 'play' && !S.over; }
  function select(r) { sel = Math.max(1, Math.min(6, r)); selFlash = 0.6; updateHud(); }
  function nudge(dir) {
    selFlash = 0.6;
    if (!canAct()) return;
    var b = S.bars[sel];
    if (b.state !== 2) return;            // still sliding: wait for the end of the step
    if (!engine.canMove(sel, dir)) { selFlash = 1; return; }
    engine.moveBar(sel, dir);
  }
  // held arrow / drag: one step as soon as the bar is free again
  function beforeTick() {
    if (fastHeld) engine.boost();
    if (heldDir && S.bars[sel].state === 2 && engine.canMove(sel, heldDir)) engine.moveBar(sel, heldDir);
    if (drag && drag.want != null) {
      var b = S.bars[drag.r];
      if (b.state === 2) {
        if (drag.want < b.x - 6 && engine.canMove(drag.r, -1)) engine.moveBar(drag.r, -1);
        else if (drag.want > b.x + 18 && engine.canMove(drag.r, 1)) engine.moveBar(drag.r, 1);
      }
    }
  }

  function setFast(on) {
    fastHeld = !!on && canAct();
    if (fastHeld) engine.boost();
    fastBtn.setAttribute('aria-pressed', fastHeld ? 'true' : 'false');
  }

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function rowAt(y) {
    for (var r = 1; r <= 6; r++) { var by = SS.barY(r); if (by + 12 >= y && by - 12 < y) return r; }
    // touch: rows are small on a phone, accept a little more around the triangle
    if (y > 36 && y <= 48) return 1;
    if (y > 192 && y <= 204) return 6;
    return 0;
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (mode !== 'play' && mode !== 'countdown') return;
    var p = pos(e), r = rowAt(p.y);
    if (!r) return;
    select(r);
    if (canAct()) engine.click(Math.floor(p.x), SS.barY(r));
    drag = { r: r, id: e.pointerId, want: null, x0: e.clientX };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.want == null && Math.abs(e.clientX - drag.x0) < 8) return;
    drag.want = pos(e).x;
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
      if (active || mode === 'paused') { e.preventDefault(); if (canAct()) engine.boost(); }
      return;
    }
    if (k === 'p' || k === 'P' || k === 'Escape') { if (active || mode === 'paused') { e.preventDefault(); togglePause(); } return; }
    if (k === 't' || k === 'T') { setPath(!opt.path); toast(opt.path ? 'Trajectoires affichées' : 'Trajectoires masquées'); return; }
    if (k === 'Enter' && (mode === 'idle' || mode === 'over') && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); newGame(); return; }
    if (!active) return;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'z' || k === 'Z') { e.preventDefault(); select(sel - 1); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); select(sel + 1); }
    else if (k >= '1' && k <= '6') select(parseInt(k, 10));
    else if (DIRS[k]) { e.preventDefault(); if (!e.repeat) { heldDir = DIRS[k]; nudge(heldDir); } }
  });
  window.addEventListener('keyup', function (e) {
    if (DIRS[e.key] && heldDir === DIRS[e.key]) heldDir = 0;
  });
  window.addEventListener('blur', function () { fastHeld = false; heldDir = 0; });
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
      holdButton(b, function () { nudge(dir); heldDir = dir; }, function () { if (heldDir === dir) heldDir = 0; });
    } else if (a === 'up' || a === 'down') b.addEventListener('click', function () { select(sel + (a === 'up' ? -1 : 1)); });
    else if (a === 'pause') b.addEventListener('click', function () { togglePause(); });
  });
  pauseBtn.addEventListener('click', function () { togglePause(); pauseBtn.blur(); });
  $('new').addEventListener('click', function (e) { e.currentTarget.blur(); newGame(); });

  // ---------- Settings dialog ----------

  var optLevel = $('optLevel'), optMusic = $('optMusic'), optPath = $('optPath'), optPath2 = $('optPath2');
  var optCountdown = $('optCountdown'), optSeed = $('optSeed');
  function syncSettingsUi() {
    optLevel.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-v') === opt.level)); });
    optMusic.checked = !!opt.music; optPath.checked = optPath2.checked = !!opt.path;
    optCountdown.checked = !!opt.countdown; optSeed.value = opt.seed || '';
  }
  function setPath(on) { opt.path = !!on; saveSettings(); syncSettingsUi(); }
  optLevel.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    opt.level = +b.getAttribute('data-v'); saveSettings(); syncSettingsUi(); updateHud();
  });
  optMusic.addEventListener('change', function () {
    opt.music = optMusic.checked; saveSettings();
    if (opt.music && (mode === 'play' || mode === 'countdown') && !S.over) Lehcim.playMidi('../assets/music.mid', { loop: true });
    else Lehcim.stopMusic();
  });
  optPath.addEventListener('change', function () { setPath(optPath.checked); optPath.blur(); });
  optPath2.addEventListener('change', function () { setPath(optPath2.checked); });
  optCountdown.addEventListener('change', function () { opt.countdown = optCountdown.checked; saveSettings(); });
  optSeed.addEventListener('input', function () { opt.seed = optSeed.value.trim(); saveSettings(); });
  $('seedLast').addEventListener('click', function () { opt.seed = String(opt.lastSeed || ''); saveSettings(); syncSettingsUi(); });
  $('settingsBtn').addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (mode === 'play' || mode === 'countdown') pause();
    syncSettingsUi(); $('settings').showModal();
  });
  document.querySelector('[data-help]').addEventListener('click', function () { if (mode === 'play' || mode === 'countdown') pause(); });

  // ---------- Rendering ----------

  function drawTree(node, color, alpha) {
    var p = node.pts;
    g.strokeStyle = color; g.globalAlpha = alpha;
    g.beginPath(); g.moveTo(p[0][0] + 10, p[0][1] + 10);
    for (var i = 1; i < p.length; i++) g.lineTo(p[i][0] + 10, p[i][1] + 10);
    g.stroke();
    if (node.fork) {
      // a pin without a bar next to it: the original draws the side at random
      var f = p[p.length - 1];
      g.globalAlpha = Math.max(0.5, alpha);
      g.fillStyle = '#fff'; g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', f[0] + 10, f[1] + 2);
      drawTree(node.fork[0], color, alpha * 0.6);
      drawTree(node.fork[1], color, alpha * 0.6);
      return;
    }
    var e = node.end;
    if (!e) return;
    g.setLineDash([]);
    g.globalAlpha = Math.max(0.45, alpha);
    var cx = e.x + 10, cy = e.y + 10;
    if (e.match) { g.strokeStyle = '#5cff7a'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.stroke(); }
    else if (e.deadly) {
      g.strokeStyle = '#ff4d4d'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx - 7, cy - 7); g.lineTo(cx + 7, cy + 7); g.moveTo(cx + 7, cy - 7); g.lineTo(cx - 7, cy + 7); g.stroke();
    } else { g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 2; g.setLineDash([4, 4]);
  }

  function drawPaths() {
    g.save();
    g.lineWidth = 2; g.lineJoin = 'round';
    g.setLineDash([4, 4]);
    g.lineDashOffset = reduceMotion ? 0 : -time * 24;
    S.marbles.forEach(function (m) { drawTree(engine.predict(m), MARBLE_RGB[m.c], 0.9); });
    if (S.marbles.length > 0) drawTree(engine.predictNext(), MARBLE_RGB[S.next], 0.35);
    g.restore();
    g.globalAlpha = 1; g.setLineDash([]);
  }

  function drawSelection() {
    if (mode !== 'play' && mode !== 'countdown') return;
    if (S.over) return;
    var b = S.bars[sel]; if (!b) return;
    var y = b.y;
    g.save();
    g.fillStyle = 'rgba(255,211,77,' + (0.10 + selFlash * 0.15).toFixed(3) + ')';
    g.fillRect(118, y - 12, 212, 24);
    g.fillStyle = 'rgba(255,211,77,' + (0.6 + Math.min(0.4, selFlash)).toFixed(3) + ')';
    g.beginPath(); g.moveTo(112, y - 7); g.lineTo(121, y + 3); g.lineTo(112, y + 13); g.fill();
    g.beginPath(); g.moveTo(336, y - 7); g.lineTo(327, y + 3); g.lineTo(336, y + 13); g.fill();
    g.restore();
  }

  function render() {
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.imageSmoothingEnabled = false;
    if (!sheet) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; }
    if (mode === 'idle') { g.drawImage(bgCanvas, 0, 0); return; }
    SS.render(g, sheet, bgCanvas, engine.sim, { panel: true });
    drawSelection();
    if (opt.path && !S.over && (mode === 'play' || mode === 'countdown' || mode === 'paused')) drawPaths();
    if (flash > 0) { g.fillStyle = 'rgba(255,40,40,' + (flash * 0.5).toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
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
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, W, H);
      var n = Math.ceil(cd), frac = cd - Math.floor(cd), s = reduceMotion ? 1 : 1 + 0.4 * frac;
      g.save(); g.translate(W / 2, H / 2 - 10); g.scale(s, s);
      g.font = 'bold 96px system-ui, sans-serif'; g.fillStyle = '#ffd34d'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 0, 0); g.restore();
      g.font = 'bold 16px system-ui, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
      g.fillText('Placez vos barres !', W / 2, H / 2 + 60);
    }
    g.textAlign = 'left';
  }

  // ---------- Main loop ----------

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts; time += dt;
    uiFx.forEach(function (f) { f.t += dt; });
    uiFx = uiFx.filter(function (f) { return f.t < 0.9; });
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (selFlash > 0) selFlash = Math.max(0, selFlash - dt);
    if (mode === 'countdown') {
      cd -= dt;
      if (cd <= 0) { mode = 'play'; syncControls(); }
    } else if (mode === 'play') {
      engine.advance(dt, beforeTick);
      updateHud();
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Canvas fit (crisp: backing store at device resolution) ----------

  function fit() {
    var w = stage.clientWidth;
    var top = stage.getBoundingClientRect().top + window.scrollY;
    var tp = getComputedStyle(touchpad).display !== 'none' ? touchpad.offsetHeight + 8 : 0;
    var avail = window.innerHeight - top - tp - 16;
    var cssW = Math.floor(Math.min(w, Math.max(200, avail) * W / H));
    if (cssW >= W * 2) cssW = Math.floor(cssW / W) * W;
    var cssH = Math.round(cssW * H / W);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
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
    bgCanvas = document.createElement('canvas'); bgCanvas.width = W; bgCanvas.height = H;
    var b = bgCanvas.getContext('2d'); b.fillStyle = '#000'; b.fillRect(0, 0, W, H);
    SS.buildBackground(b, sheet, Math.random);
    fit();
    requestAnimationFrame(frame);
  });

  // test hook
  window.__stack = { engine: engine, S: S, newGame: newGame, pause: pause, resume: resume, abandon: abandon,
    select: select, nudge: nudge, mode: function () { return mode; }, skipCountdown: function () { cd = 0; } };
})();
