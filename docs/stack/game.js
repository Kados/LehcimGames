/*
 * Stack - browser port of Lehcim Noil's "Jeu STACK" (Windows 3.x).
 * Page, menus, input, timer and sounds around engine.js (simulation and
 * drawing rebuilt from the original program). Same menus as the original:
 * Nouvelle Partie, Niveau, Abandon, Musique, Règles du jeu, A propos de ...
 * Additions of this port: pause (P), mute button, "Accélérer" button for
 * touch screens.
 */
(function () {
  'use strict';

  var SS = window.StackSim;
  var KEY = [250, 250, 250];

  // ---------- DOM ----------

  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var newBtn = document.getElementById('new'), levelBtn = document.getElementById('levelBtn');
  var abandonBtn = document.getElementById('abandon'), musicBtn = document.getElementById('musicBtn');
  var fastBtn = document.getElementById('fast');
  var sheet = null, bg = null;

  var DEFAULTS = [
    { name: 'Pro', score: 350 }, { name: 'Expert', score: 300 }, { name: 'Amateur', score: 250 },
    { name: 'Junior', score: 150 }, { name: 'Gros Mauvais', score: 100 }
  ];
  var scores = Lehcim.highScores('stack', DEFAULTS);
  // The original inserts a score above equal ones (score >= 5th qualifies).
  function qualifies(score) { var l = scores.list(); return score >= l[l.length - 1].score; }
  function addScore(name, score) {
    var l = scores.list(), i = 0;
    while (i < l.length && l[i].score > score) i++;
    l.splice(i, 0, { name: name || '???', score: score });
    l = l.slice(0, DEFAULTS.length);
    try { localStorage.setItem('lehcim.stack.scores', JSON.stringify(l)); } catch (e) { /* ignore */ }
  }

  var opt = { level: 1, music: true };
  try { var l0 = parseInt(localStorage.getItem('lehcim.stack.level'), 10); if (l0 >= 1 && l0 <= 5) opt.level = l0; } catch (e) { /* ignore */ }
  try { if (localStorage.getItem('lehcim.stack.music') === '0') opt.music = false; } catch (e) { /* ignore */ }

  // ---------- Simulation ----------

  var sim = SS.create({
    random: Math.random,
    onSound: function (n) { Lehcim.play(n, n === SS.SND.over ? 0.8 : 0.6); },
    onEvent: function (type) {
      if (type === 'finished') finished();
      updateUi();
    }
  });
  var S = sim.S;
  var screen = 'black';     // black (before the first game) | bg (after Abandon) | game
  var paused = false, acc = 0, cursor = null, fastHeld = false, showTable = false;

  function newGame() {
    if (S.playing) return;            // the original ignores it during a game
    if (document.querySelector('dialog[open]')) return;
    Lehcim.play(SS.SND.bip, 0.6);
    sim.newGame(opt.level);
    screen = 'game'; paused = false; acc = 0; showTable = false;
    if (opt.music) Lehcim.playMidi('assets/music.mid', { loop: true }); else Lehcim.stopMusic();
    updateUi();
  }

  function abandon() {
    if (!S.playing) return;
    Lehcim.play(SS.SND.bip, 0.6);
    sim.abandon();
    Lehcim.stopMusic();
    screen = 'bg'; paused = false;
    updateUi();
  }

  // end of the final animation: high score entry, then the score table on the board
  function finished() {
    Lehcim.stopMusic();
    paused = false; fastHeld = false;
    var p = Promise.resolve();
    if (qualifies(S.score)) {
      p = Lehcim.prompt('Tu fais partie des meilleurs! Ecris ton nom(14 lettres maximum)', 14).then(function (name) {
        addScore(name.slice(0, 14), S.score);
      });
    }
    p.then(function () { showTable = true; updateUi(); });
  }

  function togglePause() {
    if (!S.playing) return;
    paused = !paused; fastHeld = false;
    updateUi();
  }

  function updateUi() {
    var playing = S.playing;
    levelBtn.disabled = playing; musicBtn.disabled = playing;
    newBtn.disabled = playing; abandonBtn.disabled = !playing;
    canvas.classList.toggle('play', playing && !paused && !S.over);
    if (screen === 'black') statusEl.textContent = 'Cliquez sur « Nouvelle Partie »';
    else if (paused) statusEl.textContent = 'Pause (P pour reprendre)';
    else if (S.done || screen === 'bg') statusEl.textContent = '';
    else statusEl.textContent = '';
  }

  // ---------- Timer (40 ms ticks, as the original SetTimer) ----------

  function update(dt) {
    if (!S.playing || paused) { acc = 0; return; }
    acc += Math.min(0.25, dt);
    while (acc >= SS.TICK) {
      if (fastHeld) sim.boost();      // held button = key repeat
      sim.tick();
      acc -= SS.TICK;
      if (!S.playing) { acc = 0; break; }
    }
  }

  // ---------- Rendering ----------

  function render() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (screen === 'black' || !sheet) { g.fillStyle = '#000'; g.fillRect(0, 0, SS.W, SS.H); return; }
    if (screen === 'bg') { g.drawImage(bg, 0, 0); return; }
    SS.render(g, sheet, bg, sim, {
      cursor: S.playing && !paused && (!S.over || S.worm.counter < 53) ? cursor : null,
      scores: S.done && showTable ? scores.list() : null
    });
    if (paused && S.playing) {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, SS.W, SS.H);
      g.fillStyle = '#ffd34d'; g.font = 'bold 22px Tahoma, Verdana, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Pause - appuyez sur P', canvas.width / 2, canvas.height / 2);
      g.textAlign = 'left';
    }
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (e.button !== 0 || paused) return;
    var p = Lehcim.canvasPos(canvas, e);
    sim.click(Math.floor(p.x), Math.floor(p.y));
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') { cursor = null; return; }
    var p = Lehcim.canvasPos(canvas, e);
    cursor = { x: Math.floor(p.x), y: Math.floor(p.y) };
  });
  canvas.addEventListener('pointerleave', function () { cursor = null; });

  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!paused) sim.boost();     // every key repeat renews the burst, as in the original
    } else if (e.key === 'p' || e.key === 'P') togglePause();
  });

  fastBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); if (!paused) { fastHeld = true; sim.boost(); } });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    fastBtn.addEventListener(ev, function () { fastHeld = false; });
  });
  fastBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && S.playing && !paused) togglePause();
  });
  window.addEventListener('blur', function () { fastHeld = false; });

  newBtn.addEventListener('click', function (e) { e.currentTarget.blur(); newGame(); });
  abandonBtn.addEventListener('click', function (e) { e.currentTarget.blur(); abandon(); });

  // ---------- Menus and dialogs ----------

  function radios(name) { return Array.prototype.slice.call(document.querySelectorAll('input[name="' + name + '"]')); }
  levelBtn.addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (S.playing) return;
    radios('lvl').forEach(function (r) { r.checked = +r.value === opt.level; });
    document.getElementById('levelDlg').showModal();
  });
  radios('lvl').forEach(function (r) {
    r.addEventListener('change', function () {
      Lehcim.play(SS.SND.bip, 0.6);
      opt.level = +r.value;
      try { localStorage.setItem('lehcim.stack.level', String(opt.level)); } catch (err) { /* ignore */ }
    });
  });
  musicBtn.addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (S.playing) return;
    radios('mus').forEach(function (r) { r.checked = (r.value === '1') === opt.music; });
    document.getElementById('musicDlg').showModal();
  });
  radios('mus').forEach(function (r) {
    r.addEventListener('change', function () {
      Lehcim.play(SS.SND.bip, 0.6);
      opt.music = r.value === '1';
      try { localStorage.setItem('lehcim.stack.music', opt.music ? '1' : '0'); } catch (err) { /* ignore */ }
    });
  });
  document.getElementById('rulesBtn').addEventListener('click', function (e) {
    e.currentTarget.blur(); Lehcim.play(SS.SND.bip, 0.6);
    if (S.playing && !paused) togglePause();
    document.getElementById('help').showModal();
  });
  document.getElementById('aboutBtn').addEventListener('click', function (e) {
    e.currentTarget.blur(); Lehcim.play(SS.SND.bip, 0.6);
    if (S.playing && !paused) togglePause();
    document.getElementById('about').showModal();
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
  updateUi();
  requestAnimationFrame(frame);
  Lehcim.loadSheet('assets/sheet.png', KEY).then(function (s) {
    sheet = s;
    bg = document.createElement('canvas'); bg.width = SS.W; bg.height = SS.H;
    var bctx = bg.getContext('2d'); bctx.fillStyle = '#000'; bctx.fillRect(0, 0, SS.W, SS.H);
    SS.buildBackground(bctx, sheet, Math.random);
  });

  // test hook
  window.__stack = { sim: sim, S: S, newGame: newGame, abandon: abandon, togglePause: togglePause, opt: opt,
    screen: function () { return screen; } };
})();
