/*
 * KevGame - rules engine and computer player (no drawing, no DOM).
 * Plain script: defines the global KevEngine (also exported for node tests).
 *
 * Measured on the original running under Wine (see the verification notes):
 * - the pool is a grid of 21 x 13 cells of 24 px (the water of the 600x408
 *   background starts at x=48, y=48); the game runs on a 50 ms timer (one
 *   "tick"); the fish and the worm both swim 4 px per tick (one cell in 6
 *   ticks = 0.3 s), only while their key is held, and always stop on a cell;
 * - round 1: left = worm (starts in cell 1,1), right = fish (cell 19,1);
 *   round 2: the roles are swapped, the start cells stay the same;
 * - air: 60 units, minus 1 every 10 ticks (30 s); it goes straight back to 60
 *   as soon as the animal is in the cell of one of the 2 bubble zones; each
 *   zone moves to a random neighbouring cell every 36 ticks (1.8 s);
 * - walls: the worm can lay 4 of them, the fish 7; one wall = one buoy or
 *   balloon in the cell behind the animal; the blinking buoy refills that
 *   stock to its maximum;
 * - demolitions: 3 per round; a lit firecracker is put on the wall just in
 *   front of the animal, it explodes 1 s later; a firecracker picked up in the
 *   pool refills the stock to 3;
 * - a blinking buoy appears at 0 s, 30 s, 60 s, a firecracker at 15 s, 45 s,
 *   75 s; each stays 7.5 s;
 * - 5 to 11 random buoys/balloons are already in the pool (columns 2-18,
 *   rows 1-11) when a round starts;
 * - the fish wins if it touches the worm, or if the worm runs out of air; the
 *   worm wins if the fish runs out of air or after 90 s; if both run out of air
 *   together nobody wins the round.
 *
 * Directions: 0 = up, 1 = right, 2 = down, 3 = left.
 * Sides: 0 = left player ("gauche"), 1 = right player ("droite").
 *
 * The engine produces "events" that the page turns into sounds and effects.
 */
(function (root) {
  'use strict';

  var COLS = 21, ROWS = 13;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  var CFG = {
    tick: 0.05,          // s, Timer1.Interval = 50 ms
    speed: 4,            // px per tick (both animals)
    roundTicks: 1800,    // 90 s
    airMax: 60, airTicks: 10,
    zoneTicks: 36,       // a bubble zone moves every 1.8 s
    walls: { worm: 4, fish: 7 },
    booms: 3,
    fuseTicks: 20, blastTicks: 4,
    bonusEvery: 300, bonusLife: 150,
    catchDist: 16        // px (Manhattan distance between the two sprites)
  };
  var STARTS = [[1, 1], [19, 1]];
  var ZONE_STARTS = [[0, 6], [20, 6]];

  function idx(x, y) { return y * COLS + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
  function rnd(rng, n) { return Math.floor(rng() * n); }

  // ---------- Round state ----------

  function newAnimal(side, kind) {
    return {
      side: side, kind: kind, cx: STARTS[side][0], cy: STARTS[side][1], prog: 0, moving: false,
      dir: 0, prevDir: -1, turnT: 0, air: CFG.airMax, airT: 0,
      walls: CFG.walls[kind], booms: CFG.booms, alive: true, animT: 0
    };
  }

  // round: 0 or 1. rng: function returning [0,1).
  function newRound(round, rng) {
    var L = newAnimal(0, round === 0 ? 'worm' : 'fish');
    var R = newAnimal(1, round === 0 ? 'fish' : 'worm');
    var st = {
      round: round, ticks: 0, over: false, result: null,
      animals: [L, R],
      walls: new Array(COLS * ROWS).fill(null), // {type, born, fuse}
      zones: ZONE_STARTS.map(function (z) { return { x: z[0], y: z[1] }; }),
      bonus: null,                             // {kind: 'buoy'|'petard', x, y, born}
      events: [], rng: rng
    };
    // obstacles already in the pool
    var n = 5 + rnd(rng, 7);
    for (var tries = 0; n > 0 && tries < 500; tries++) {
      var x = 2 + rnd(rng, 17), y = 1 + rnd(rng, 11);
      if (st.walls[idx(x, y)]) continue;
      st.walls[idx(x, y)] = { type: rnd(rng, 6), born: -99, fuse: 0 };
      n--;
    }
    spawnBonus(st);
    return st;
  }

  function fish(st) { return st.animals[0].kind === 'fish' ? st.animals[0] : st.animals[1]; }
  function worm(st) { return st.animals[0].kind === 'worm' ? st.animals[0] : st.animals[1]; }
  function solid(st, x, y) { return !inside(x, y) || !!st.walls[idx(x, y)]; }

  // Pixel position of an animal (top-left of its 24x24 sprite, pool coordinates).
  function pos(a) {
    var p = a.moving ? a.prog : 0;
    return { x: a.cx * 24 + DX[a.dir] * p, y: a.cy * 24 + DY[a.dir] * p };
  }
  // The cell the animal is mostly in.
  function nearCell(a) {
    return a.moving && a.prog >= 12 ? [a.cx + DX[a.dir], a.cy + DY[a.dir]] : [a.cx, a.cy];
  }
  // The cell the animal is heading to (its own cell when it stands still).
  function destCell(a) { return a.moving ? [a.cx + DX[a.dir], a.cy + DY[a.dir]] : [a.cx, a.cy]; }

  function animalOn(st, x, y) {
    return st.animals.some(function (a) {
      var c = nearCell(a), d = destCell(a);
      return a.alive && ((c[0] === x && c[1] === y) || (d[0] === x && d[1] === y) || (a.cx === x && a.cy === y));
    });
  }

  // ---------- Walls and demolition ----------

  // "La construction d'un mur est faite derrière l'animal": one buoy or balloon
  // in the cell it is leaving (or, standing still, the cell behind it).
  function buildWall(st, a) {
    if (!a.alive || st.over || a.walls <= 0) return false;
    var x, y;
    if (a.moving) { x = a.cx; y = a.cy; } else { x = a.cx - DX[a.dir]; y = a.cy - DY[a.dir]; }
    if (!inside(x, y) || st.walls[idx(x, y)]) return false;
    var other = st.animals[1 - a.side], oc = nearCell(other), od = destCell(other);
    if ((oc[0] === x && oc[1] === y) || (od[0] === x && od[1] === y)) return false;
    if (a.moving ? false : animalOn(st, x, y)) return false;
    st.walls[idx(x, y)] = { type: rnd(st.rng, 6), born: st.ticks, fuse: 0 };
    a.walls--;
    st.events.push({ e: 'wall', side: a.side, x: x, y: y });
    return true;
  }

  // "La destruction se fait devant": a lit firecracker on the wall just in
  // front of the animal.
  function demolish(st, a) {
    if (!a.alive || st.over || a.booms <= 0) return false;
    var c = destCell(a), x = c[0] + DX[a.dir], y = c[1] + DY[a.dir];
    if (!inside(x, y)) return false;
    var w = st.walls[idx(x, y)];
    if (!w || w.fuse) return false;
    w.fuse = st.ticks;
    a.booms--;
    st.events.push({ e: 'fuse', side: a.side, x: x, y: y });
    return true;
  }

  function updateFuses(st) {
    for (var i = 0; i < st.walls.length; i++) {
      var w = st.walls[i];
      if (w && w.fuse && st.ticks - w.fuse >= CFG.fuseTicks) {
        st.walls[i] = null;
        st.events.push({ e: 'boom', x: i % COLS, y: Math.floor(i / COLS), type: w.type });
      }
    }
  }

  // ---------- Bonuses ----------

  function spawnBonus(st) {
    var kind = Math.floor(st.ticks / CFG.bonusEvery) % 2 ? 'petard' : 'buoy';
    for (var tries = 0; tries < 300; tries++) {
      var x = rnd(st.rng, COLS), y = rnd(st.rng, ROWS);
      if (st.walls[idx(x, y)] || animalOn(st, x, y)) continue;
      st.bonus = { kind: kind, x: x, y: y, born: st.ticks };
      return;
    }
    st.bonus = null;
  }

  function pickBonus(st, a) {
    var b = st.bonus, c = nearCell(a);
    if (!b || b.x !== c[0] || b.y !== c[1]) return;
    if (b.kind === 'buoy') a.walls = CFG.walls[a.kind];
    else a.booms = CFG.booms;
    st.events.push({ e: 'pick', what: b.kind, side: a.side, x: b.x, y: b.y });
    st.bonus = null;
  }

  // ---------- Movement ----------

  // want: direction held by the player/AI (-1 = none), read when the animal is on a cell.
  function moveAnimal(st, a, want) {
    a.animT++;
    if (a.turnT > 0) a.turnT--;
    if (!a.moving) {
      var d = typeof want === 'function' ? want() : want;
      if (d < 0) return;
      if (d !== a.dir) { a.prevDir = a.dir; a.dir = d; a.turnT = 6; }
      if (solid(st, a.cx + DX[d], a.cy + DY[d])) return;
      a.moving = true; a.prog = 0;
    }
    a.prog += CFG.speed;
    if (a.prog >= 24) {
      a.cx += DX[a.dir]; a.cy += DY[a.dir]; a.prog = 0; a.moving = false;
    }
  }

  // ---------- One tick ----------

  // wants: [wantLeft, wantRight], each a direction or a function returning one.
  function step(st, wants) {
    if (st.over) return;
    st.ticks++;
    var f = fish(st), w = worm(st);

    st.animals.forEach(function (a, i) { moveAnimal(st, a, wants[i]); pickBonus(st, a); });
    updateFuses(st);

    // bubble zones wander
    if (st.ticks % CFG.zoneTicks === 0) {
      st.zones.forEach(function (z) {
        var opts = [];
        for (var d = 0; d < 4; d++) if (inside(z.x + DX[d], z.y + DY[d])) opts.push(d);
        var k = opts[rnd(st.rng, opts.length)];
        z.x += DX[k]; z.y += DY[k];
      });
    }

    // bonuses: one every 15 s, alternately a buoy and a firecracker, for 7.5 s
    if (st.bonus && st.ticks - st.bonus.born >= CFG.bonusLife) st.bonus = null;
    if (st.ticks % CFG.bonusEvery === 0) spawnBonus(st);

    // air
    st.animals.forEach(function (a) {
      var c = nearCell(a);
      var inZone = st.zones.some(function (z) { return z.x === c[0] && z.y === c[1]; });
      if (inZone) {
        if (a.air < CFG.airMax) st.events.push({ e: 'breath', side: a.side, x: c[0], y: c[1] });
        a.air = CFG.airMax; a.airT = 0;
      } else if (++a.airT >= CFG.airTicks) { a.airT = 0; a.air--; }
    });

    // end of the round
    var pf = pos(f), pw = pos(w);
    if (Math.abs(pf.x - pw.x) + Math.abs(pf.y - pw.y) < CFG.catchDist) {
      w.alive = false;
      return endRound(st, f.side, 'catch');
    }
    var fDead = f.air <= 0, wDead = w.air <= 0;
    if (fDead || wDead) {
      if (fDead) { f.alive = false; f.air = 0; }
      if (wDead) { w.alive = false; w.air = 0; }
      return endRound(st, fDead && wDead ? -1 : (fDead ? w.side : f.side), fDead && wDead ? 'both' : 'air');
    }
    if (st.ticks >= CFG.roundTicks) { f.alive = false; return endRound(st, w.side, 'time'); }
  }

  function secondsLeft(st) { return Math.max(0, 90 - Math.floor(st.ticks / 20)); }

  function endRound(st, winner, how) {
    st.over = true;
    // the original counts whole seconds ("gauche a gagné en 30 secondes .")
    st.result = { winner: winner, how: how, time: Math.floor(st.ticks / 20) };
    st.events.push({ e: 'end', how: how, winner: winner });
  }

  // ---------- Messages of the original (message box caption + text) ----------

  var NAMES = ['gauche', 'droite'];

  function roundMessage(r) {
    if (r.winner < 0) return { caption: 'Personne n\'a gagné !', text: 'La première manche est terminée' };
    return { caption: NAMES[r.winner] + ' a gagné en ' + r.time + ' secondes .', text: 'La première manche est terminée .' };
  }

  // results: [r1, r2]. Returns {winner, caption, text}.
  function matchResult(r) {
    var a = r[0].winner, b = r[1].winner;
    if (a >= 0 && a === b) return { winner: a, caption: NAMES[a] + ' a gagné les 2 manches .', text: NAMES[a] + ' a donc gagné la partie .' };
    if (a < 0 && b < 0) return { winner: -1, caption: 'Ex-aequo dans les 2 manches .C\'est rare !', text: 'personne n\'a donc gagné la partie .Faites en une autre !' };
    if (a >= 0 && b < 0) return { winner: a, caption: 'Première manche gagnée par ' + NAMES[a] + '.Ex-aequo dans la seconde.', text: NAMES[a] + ' a donc gagné la partie .' };
    if (a < 0 && b >= 0) return { winner: b, caption: 'Ex-aequo dans la première manche .' + NAMES[b] + ' a gagné la seconde', text: NAMES[b] + ' a donc gagné la partie .' };
    // each won one round: the fastest takes the match
    var ta = r[0].time, tb = r[1].time;
    if (ta === tb) return { winner: -1, caption: 'Chacun a gagné sa manche dans le même temps !', text: 'Partie nulle.' };
    var w = ta < tb ? a : b;
    return { winner: w, caption: NAMES[a] + ' a gagné en ' + ta + ' secondes , ' + NAMES[b] + ' en ' + tb + ' secondes .', text: NAMES[w] + ' a donc gagné la partie .' };
  }

  // ---------- Computer player ----------

  // Breadth-first distances from (x, y). ignoreWalls: walls cost nothing (for
  // planning a demolition). Returns Int16Array (-1 = unreachable).
  function bfs(st, x, y, ignoreWalls) {
    var dist = new Int16Array(COLS * ROWS).fill(-1), q = [idx(x, y)], h = 0;
    dist[q[0]] = 0;
    while (h < q.length) {
      var i = q[h++], cx = i % COLS, cy = (i - cx) / COLS;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (!inside(nx, ny)) continue;
        var j = idx(nx, ny);
        if (dist[j] >= 0 || (!ignoreWalls && st.walls[j])) continue;
        dist[j] = dist[i] + 1; q.push(j);
      }
    }
    return dist;
  }

  // Direction from (x,y) that goes down the distance map (towards its origin).
  // When several directions are as good, the one along the longer side of
  // the way to (tx, ty) comes first (no zigzag mirroring the prey).
  function downhill(st, dist, x, y, ignoreWalls, tx, ty) {
    var best = -1, bd = dist[idx(x, y)];
    if (bd <= 0) return -1;
    var order = [0, 1, 2, 3];
    if (tx !== undefined && Math.abs(tx - x) > Math.abs(ty - y)) order = [1, 3, 0, 2];
    for (var k = 0; k < 4; k++) {
      var d = order[k];
      var nx = x + DX[d], ny = y + DY[d];
      if (!inside(nx, ny) || (!ignoreWalls && st.walls[idx(nx, ny)])) continue;
      var v = dist[idx(nx, ny)];
      if (v >= 0 && v < bd) { bd = v; best = d; }
    }
    return best;
  }

  // Greedy step towards (tx, ty) without planning (beginner level).
  function greedy(st, me, tx, ty) {
    var dx = tx - me.cx, dy = ty - me.cy, opts = [];
    if (Math.abs(dx) >= Math.abs(dy)) { if (dx) opts.push(dx > 0 ? 1 : 3); if (dy) opts.push(dy > 0 ? 2 : 0); }
    else { if (dy) opts.push(dy > 0 ? 2 : 0); if (dx) opts.push(dx > 0 ? 1 : 3); }
    for (var i = 0; i < opts.length; i++) if (!solid(st, me.cx + DX[opts[i]], me.cy + DY[opts[i]])) return opts[i];
    return randomDir(st, me.cx, me.cy);
  }

  function randomDir(st, x, y) {
    var opts = [];
    for (var d = 0; d < 4; d++) if (!solid(st, x + DX[d], y + DY[d])) opts.push(d);
    return opts.length ? opts[rnd(st.rng, opts.length)] : -1;
  }

  // AI memory per side (kept outside the round state).
  function newBrain(level) { return { level: level, loop: 0 }; }

  // Nearest bubble zone by path (or -1) and its distance map.
  function nearestZone(st, myD) {
    var best = -1, bd = 1e9;
    st.zones.forEach(function (z, i) {
      var v = myD[idx(z.x, z.y)];
      if (v >= 0 && v < bd) { bd = v; best = i; }
    });
    return { i: best, d: bd };
  }

  // Called each tick for a computer-controlled animal: may build/demolish, and
  // returns a function giving the direction to take when on a cell.
  function aiThink(st, me, brain) {
    var other = st.animals[1 - me.side];
    var expert = brain.level === 1;
    return function () {
      var x = me.cx, y = me.cy, d;
      var oc = destCell(other);
      var myD = bfs(st, x, y, false);
      var zn = nearestZone(st, myD);

      // 1. breathing (6 ticks per cell, 10 ticks per unit of air)
      var margin = expert ? 14 : 10;
      var needAir = zn.i >= 0 && me.air <= zn.d * 0.6 + margin;
      if (me.kind === 'worm' && !expert && me.air <= 42) needAir = zn.i >= 0;
      if (me.kind === 'fish' && !expert) needAir = me.air <= 12;
      if (needAir && zn.i >= 0) {
        var z = st.zones[zn.i];
        d = expert ? downhill(st, bfs(st, z.x, z.y, false), x, y, false) : greedy(st, me, z.x, z.y);
        if (d >= 0) return d;
      } else if (zn.i < 0 && me.air < 30 && me.booms > 0) {
        // walled in: blow up the way to a zone
        var r = goThrough(st, me, st.zones[0].x, st.zones[0].y);
        if (r >= 0) return r;
      }

      // 2. bonuses close by (not when the fish is about to bite)
      var b = st.bonus;
      if (b && ((b.kind === 'buoy' && me.walls < CFG.walls[me.kind]) || (b.kind === 'petard' && me.booms < CFG.booms))) {
        var bd = myD[idx(b.x, b.y)], od = Math.abs(oc[0] - b.x) + Math.abs(oc[1] - b.y);
        if (bd >= 0 && bd <= (me.kind === 'fish' ? 3 : 6) && (me.kind === 'fish' || od > bd + 2)) {
          d = downhill(st, bfs(st, b.x, b.y, false), x, y, false);
          if (d >= 0) return d;
        }
      }

      // 3. chase or flee
      if (me.kind === 'fish') {
        if (!expert) {
          // beginner: aims roughly, hesitates near its prey
          var near = Math.abs(oc[0] - x) + Math.abs(oc[1] - y) <= 3;
          if (st.rng() < (near ? 0.6 : 0.3)) return randomDir(st, x, y);
          return greedy(st, me, oc[0], oc[1]);
        }
        var td = bfs(st, oc[0], oc[1], false);
        d = downhill(st, td, x, y, false, oc[0], oc[1]);
        var through = bfs(st, oc[0], oc[1], true);
        if ((d < 0 || td[idx(x, y)] > through[idx(x, y)] + 6) && me.booms > 0) {
          var g = goThrough(st, me, oc[0], oc[1]);
          if (g >= 0) return g;
        }
        return d >= 0 ? d : randomDir(st, x, y);
      }
      return flee(st, me, other, oc, expert, brain);
    };
  }

  // Move towards (tx,ty) ignoring walls, demolishing the wall ahead.
  function goThrough(st, me, tx, ty) {
    var dist = bfs(st, tx, ty, true), d = downhill(st, dist, me.cx, me.cy, true, tx, ty);
    if (d < 0) return -1;
    var nx = me.cx + DX[d], ny = me.cy + DY[d], w = st.walls[idx(nx, ny)];
    if (w) {
      if (me.booms <= 0) return -1;
      if (!w.fuse) { me.dir = d; demolish(st, me); }
      return -1; // wait for the explosion
    }
    return d;
  }

  // Worm. Beginner: swims in small loops while the fish is far, runs away
  // when it comes near. Confirmed: keeps the largest area it reaches before
  // the fish, and lays walls behind itself when followed.
  var LOOP = [1, 2, 3, 0];
  function flee(st, me, f, fc, expert, brain) {
    var fd = bfs(st, fc[0], fc[1], false);
    var far = fd[idx(me.cx, me.cy)];
    if (far < 0) far = 99;
    if (!expert && far > 7) {
      var d0 = LOOP[brain.loop++ % 4];
      return solid(st, me.cx + DX[d0], me.cy + DY[d0]) ? randomDir(st, me.cx, me.cy) : d0;
    }
    var best = -1, bs = -1e9;
    for (var d = -1; d < 4; d++) {
      var nx = me.cx + (d < 0 ? 0 : DX[d]), ny = me.cy + (d < 0 ? 0 : DY[d]);
      if (solid(st, nx, ny)) continue;
      var df = fd[idx(nx, ny)];
      if (df < 0) df = 99;
      var s = df * 4;
      if (expert) {
        var md = bfs(st, nx, ny, false), area = 0;
        for (var i = 0; i < md.length; i++) {
          if (md[i] < 0) continue;
          if (fd[i] < 0 || md[i] + 1 < fd[i]) area++;
        }
        s += area;
      }
      if (df <= 1) s -= 500;
      if (d < 0) s -= 3;
      s += st.rng() * (expert ? 0.5 : 3);
      if (s > bs) { bs = s; best = d; }
    }
    // wall behind when the fish follows
    if (me.walls > 0 && far <= 4 && far >= 2 && (expert || st.rng() < 0.3)) {
      var vx = fc[0] - me.cx, vy = fc[1] - me.cy;
      if (vx * DX[me.dir] + vy * DY[me.dir] < 0) buildWall(st, me);
    }
    // stuck in a small pocket: blow up what is ahead
    if (me.booms > 0 && far <= 3) {
      var ax = me.cx + DX[me.dir], ay = me.cy + DY[me.dir];
      if (inside(ax, ay) && st.walls[idx(ax, ay)]) demolish(st, me);
    }
    return best;
  }

  var KevEngine = {
    COLS: COLS, ROWS: ROWS, DX: DX, DY: DY, CFG: CFG, NAMES: NAMES,
    newRound: newRound, step: step, pos: pos, nearCell: nearCell, fish: fish, worm: worm,
    buildWall: buildWall, demolish: demolish, matchResult: matchResult, roundMessage: roundMessage,
    secondsLeft: secondsLeft, newBrain: newBrain, aiThink: aiThink, bfs: bfs, idx: idx
  };
  root.KevEngine = KevEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = KevEngine;
})(typeof window !== 'undefined' ? window : this);
