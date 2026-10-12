/*
 * Shared helpers for the LehcimGames browser ports.
 * Plain script (no modules) so the games also run when opened from disk.
 * Exposes a single global: Lehcim.
 */
(function () {
  'use strict';

  // ---------- Images ----------

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Cannot load ' + url)); };
      img.src = url;
    });
  }

  // Loads a sprite sheet and turns every pixel of the key colour transparent.
  // key: [r,g,b] or null (no transparency). Returns a canvas usable with drawImage.
  // Note: getImageData needs http(s); when opened from file:// the sheet is drawn
  // without transparency instead of failing.
  function loadSheet(url, key) {
    return loadImage(url).then(function (img) {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (key) {
        try {
          var d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
          for (var i = 0; i < p.length; i += 4) {
            if (p[i] === key[0] && p[i + 1] === key[1] && p[i + 2] === key[2]) p[i + 3] = 0;
          }
          ctx.putImageData(d, 0, 0);
        } catch (e) { console.warn('Colour key skipped (file:// origin?)', e); }
      }
      return c;
    });
  }

  // Reads the colour of one pixel of an image/canvas (useful to find the key colour).
  function pixel(src, x, y) {
    var c = document.createElement('canvas'); c.width = 1; c.height = 1;
    var ctx = c.getContext('2d'); ctx.drawImage(src, x, y, 1, 1, 0, 0, 1, 1);
    var p = ctx.getImageData(0, 0, 1, 1).data; return [p[0], p[1], p[2]];
  }

  // drawImage shortcut for a rectangle of a sheet.
  function blit(ctx, sheet, sx, sy, w, h, dx, dy, dw, dh) {
    ctx.drawImage(sheet, sx, sy, w, h, Math.round(dx), Math.round(dy), dw || w, dh || h);
  }

  // ---------- Audio ----------

  var audioCtx = null;
  var muted = false;
  try { muted = localStorage.getItem('lehcim.muted') === '1'; } catch (e) { /* ignore */ }

  function ctx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  // Browsers only allow audio after a user gesture.
  ['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { ctx(); }, { once: true, capture: true });
  });

  var buffers = {};
  function loadSound(name, url) {
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      var ac = ctx(); if (!ac) return null;
      return new Promise(function (res) { ac.decodeAudioData(ab, res, function () { res(null); }); });
    }).then(function (buf) { buffers[name] = buf; return buf; }).catch(function () { buffers[name] = null; });
  }
  // sounds: {name: url}. Resolves when all are loaded (failures are ignored).
  function loadSounds(map) {
    return Promise.all(Object.keys(map).map(function (k) { return loadSound(k, map[k]); }));
  }
  function play(name, volume) {
    if (muted) return;
    var ac = ctx(), buf = buffers[name];
    if (!ac || !buf) return;
    var src = ac.createBufferSource(); src.buffer = buf;
    var g = ac.createGain(); g.gain.value = volume == null ? 0.7 : volume;
    src.connect(g).connect(ac.destination); src.start();
  }

  // ---------- Tiny MIDI player (Web Audio oscillators) ----------

  function parseMidi(ab) {
    var d = new DataView(ab), pos = 0;
    function u32() { var v = d.getUint32(pos); pos += 4; return v; }
    function u16() { var v = d.getUint16(pos); pos += 2; return v; }
    function u8() { return d.getUint8(pos++); }
    function vlq() { var v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }
    u32(); u32(); u16(); var ntr = u16(), div = u16();
    var events = [];
    for (var t = 0; t < ntr; t++) {
      while (u32() !== 0x4d54726b) { pos += u32(); } // seek "MTrk"
      var len = u32(), end = pos + len, tick = 0, status = 0;
      while (pos < end) {
        tick += vlq();
        var b = d.getUint8(pos);
        if (b & 0x80) { status = b; pos++; }
        var type = status & 0xf0, ch = status & 0x0f;
        if (status === 0xff) {
          var mt = u8(), ml = vlq();
          if (mt === 0x51) events.push({ tick: tick, tempo: (d.getUint8(pos) << 16) | (d.getUint8(pos + 1) << 8) | d.getUint8(pos + 2) });
          pos += ml;
        } else if (status === 0xf0 || status === 0xf7) { pos += vlq(); }
        else if (type === 0x90 || type === 0x80) {
          var note = u8(), vel = u8();
          events.push({ tick: tick, ch: ch, note: note, on: type === 0x90 && vel > 0, vel: vel });
        } else if (type === 0xc0 || type === 0xd0) { pos += 1; }
        else { pos += 2; }
      }
      pos = end;
    }
    events.sort(function (a, b) { return a.tick - b.tick; });
    // convert ticks to seconds
    var tempo = 500000, last = 0, sec = 0;
    events.forEach(function (e) { sec += (e.tick - last) * tempo / 1e6 / div; last = e.tick; e.t = sec; if (e.tempo) tempo = e.tempo; });
    var notes = [], open = {};
    events.forEach(function (e) {
      if (e.note == null) return;
      var k = e.ch + ':' + e.note;
      if (e.on) { open[k] = e; }
      else if (open[k]) { notes.push({ t: open[k].t, dur: Math.max(0.05, e.t - open[k].t), note: e.note, ch: e.ch, vel: open[k].vel }); delete open[k]; }
    });
    return { notes: notes, length: sec };
  }

  var music = null; // {stop}
  function playMidi(url, opts) {
    opts = opts || {};
    stopMusic();
    var token = {}; music = token;
    fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
      if (music !== token) return;
      var song = parseMidi(ab), ac = ctx(); if (!ac) return;
      var master = ac.createGain(); master.gain.value = muted ? 0 : (opts.volume || 0.12); master.connect(ac.destination);
      token.master = master; token.nodes = [];
      var start = ac.currentTime + 0.1, idx = 0, loopStart = start;
      function schedule() {
        if (music !== token) return;
        var now = ac.currentTime;
        while (idx < song.notes.length && loopStart + song.notes[idx].t < now + 1.0) {
          var n = song.notes[idx++], t0 = loopStart + n.t;
          if (t0 < now) continue;
          if (n.ch === 9) { // percussion: short noise-like click
            var o = ac.createOscillator(), g = ac.createGain();
            o.type = 'square'; o.frequency.value = 80 + (n.note % 12) * 40;
            g.gain.setValueAtTime(0.25 * n.vel / 127, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
            o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.1);
          } else {
            var osc = ac.createOscillator(), env = ac.createGain();
            osc.type = n.ch % 3 === 0 ? 'triangle' : (n.ch % 3 === 1 ? 'square' : 'sawtooth');
            osc.frequency.value = 440 * Math.pow(2, (n.note - 69) / 12);
            var v = 0.3 * n.vel / 127 * (osc.type === 'triangle' ? 1.6 : 0.5), end = t0 + Math.min(n.dur, 2);
            env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(v, t0 + 0.01);
            env.gain.setValueAtTime(v, Math.max(t0 + 0.01, end - 0.03)); env.gain.linearRampToValueAtTime(0, end);
            osc.connect(env).connect(master); osc.start(t0); osc.stop(end + 0.01);
          }
        }
        if (idx >= song.notes.length && opts.loop !== false) { idx = 0; loopStart += song.length + 0.5; }
        token.timer = setTimeout(schedule, 250);
      }
      schedule();
    }).catch(function (e) { console.warn('MIDI', e); });
  }
  function stopMusic() {
    if (!music) return;
    clearTimeout(music.timer);
    if (music.master) { try { music.master.disconnect(); } catch (e) { /* ignore */ } }
    music = null;
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('lehcim.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    if (music && music.master) music.master.gain.value = muted ? 0 : 0.12;
    document.querySelectorAll('[data-mute]').forEach(function (b) { b.textContent = muteLabel(b); });
  }
  function isMuted() { return muted; }
  // Icon-only buttons (class "icon") get just the speaker, others get "Son" too.
  function muteLabel(b) {
    var icon = muted ? '🔇' : '🔊';
    if (b.classList.contains('icon')) return icon;
    return icon + ' Son';
  }

  // ---------- Page frame: toolbar, help dialog, messages ----------

  // Wires the standard page: buttons with data-help / data-mute / data-about,
  // <dialog id="help"> and <dialog id="about">.
  function initPage() {
    document.querySelectorAll('[data-mute]').forEach(function (b) {
      b.textContent = muteLabel(b);
      b.addEventListener('click', function () { setMuted(!muted); b.blur(); });
    });
    [['data-help', 'help'], ['data-about', 'about']].forEach(function (p) {
      document.querySelectorAll('[' + p[0] + ']').forEach(function (b) {
        b.addEventListener('click', function () { var d = document.getElementById(p[1]); if (d) d.showModal(); b.blur(); });
      });
    });
    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    });
  }

  // Shows a modal message; resolves when closed. buttons: ['OK'] -> resolves with index.
  function message(text, buttons) {
    buttons = buttons || ['OK'];
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      var p = document.createElement('p'); p.textContent = text; d.appendChild(p);
      var row = document.createElement('div'); row.className = 'row';
      buttons.forEach(function (label, i) {
        var b = document.createElement('button'); b.textContent = label;
        b.addEventListener('click', function () { d.close(); d.remove(); resolve(i); });
        row.appendChild(b);
      });
      d.appendChild(row); document.body.appendChild(d); d.showModal();
      d.querySelector('button').focus();
    });
  }

  // Asks for a name (high scores). Resolves with the string (or '' if cancelled).
  function prompt(text, maxLen) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog'); d.className = 'msg';
      d.innerHTML = '<form method="dialog"><p></p><input maxlength="' + (maxLen || 14) + '" autocomplete="off"><div class="row"><button>OK</button></div></form>';
      d.querySelector('p').textContent = text;
      var input = d.querySelector('input');
      d.addEventListener('close', function () { var v = input.value.trim(); d.remove(); resolve(v); });
      document.body.appendChild(d); d.showModal(); input.focus();
    });
  }

  // ---------- High scores (localStorage) ----------

  function highScores(game, defaults) {
    var key = 'lehcim.' + game + '.scores';
    function load() {
      try { var v = JSON.parse(localStorage.getItem(key)); if (Array.isArray(v) && v.length) return v; } catch (e) { /* ignore */ }
      return defaults.slice();
    }
    return {
      list: load,
      qualifies: function (score) { var l = load(); return score > l[l.length - 1].score; },
      add: function (name, score) {
        var l = load(); l.push({ name: name || '???', score: score });
        l.sort(function (a, b) { return b.score - a.score; }); l = l.slice(0, defaults.length);
        try { localStorage.setItem(key, JSON.stringify(l)); } catch (e) { /* ignore */ }
        return l;
      }
    };
  }

  // Scales a fixed-size canvas to fit its container while keeping crisp pixels.
  function fitCanvas(canvas) {
    function fit() {
      var wrap = canvas.parentElement, w = wrap.clientWidth;
      var maxH = window.innerHeight - canvas.getBoundingClientRect().top + window.scrollY - 16;
      var s = Math.min(w / canvas.width, Math.max(200, maxH) / canvas.height);
      if (s > 1) s = Math.floor(s * 2) / 2 || 1;
      canvas.style.width = Math.floor(canvas.width * s) + 'px';
      canvas.style.height = Math.floor(canvas.height * s) + 'px';
    }
    window.addEventListener('resize', fit); fit();
    return fit;
  }

  // Converts a mouse/touch event to canvas pixel coordinates.
  function canvasPos(canvas, e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height };
  }

  window.Lehcim = {
    loadImage: loadImage, loadSheet: loadSheet, pixel: pixel, blit: blit,
    loadSounds: loadSounds, play: play, playMidi: playMidi, stopMusic: stopMusic,
    setMuted: setMuted, isMuted: isMuted,
    initPage: initPage, message: message, prompt: prompt,
    highScores: highScores, fitCanvas: fitCanvas, canvasPos: canvasPos
  };
})();
