/*
 * KevGame - rules engine and computer player (no drawing, no DOM).
 * Plain script: defines the global KevEngine (also exported for node tests).
 *
 * The pool is a grid of 21 x 13 cells of 24 px (the water of the original
 * 600x408 background starts at x=48, y=48). The fish and the worm move from
 * cell to cell (smoothly, 6 animation frames per cell), cannot cross walls,
 * and the fish catches the worm when they overlap.
 *
 * Directions: 0 = up, 1 = right, 2 = down, 3 = left.
 * Sides: 0 = left player ("gauche"), 1 = right player ("droite").
 * Round 1: left = fish, right = worm. Round 2: roles swapped.
 *
 * The engine produces "events" (strings + data) that the page turns into
 * sounds and visual effects.
 */
(function (root) {
  'use strict';

  var COLS = 21, ROWS = 13;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  var CFG = {
    roundTime: 90,      // the fish must catch the worm in less than 90 s
    fishCell: 0.28,     // seconds to swim one cell
    wormCell: 0.28,
    airTime: 30,        // full air -> suffocation, in seconds
    breathRate: 0.7,    // air refilled per second inside a bubble zone
    wallPieces: 3,      // one wall = 3 buoys / balloons side by side
    maxWalls: 3,        // walls that can be stored
    chargeTime: 15,     // a firecracker stays usable for 15 s ("récemment")
    buoyDelay: [5, 9],  // respawn delay of the blinking buoy
    petardDelay: [7, 12],
    catchDist: 14       // px
  };

  // Bubble zones (cells where the animals breathe).
  var ZONES = [[3, 2], [17, 2], [3, 10], [17, 10]];

  function idx(x, y) { return y * COLS + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }

  // ---------- Round state ----------

  function newAnimal(side, kind, x, y, dir) {
    return {
      side: side, kind: kind, cx: x, cy: y, nx: x, ny: y, prog: 0, moving: false,
      dir: dir, turnFrom: -1, air: 1, walls: 0, charge: 0, alive: true,
      inZone: false, animT: 0
    };
  }

  // round: 0 or 1. rng: function returning [0,1).
  function newRound(round, rng) {
    var fishSide = round === 0 ? 0 : 1;
    var L = newAnimal(0, fishSide === 0 ? 'fish' : 'worm', 1, 6, 1);
    var R = newAnimal(1, fishSide === 1 ? 'fish' : 'worm', COLS - 2, 6, 3);
    var st = {
      round: round, t: 0, over: false, result: null,
      animals: [L, R],
      walls: new Array(COLS * ROWS).fill(null), // {type, born}
      zoneAt: new Array(COLS * ROWS).fill(-1),
      buoy: null, petard: null,                 // {x, y, born}
      buoyTimer: 2 + rng() * 2, petardTimer: 4 + rng() * 3,
      events: [], rng: rng
    };
    ZONES.forEach(function (z, i) { st.zoneAt[idx(z[0], z[1])] = i; });
    return st;
  }

  function fish(st) { return st.animals[0].kind === 'fish' ? st.animals[0] : st.animals[1]; }
  function worm(st) { return st.animals[0].kind === 'worm' ? st.animals[0] : st.animals[1]; }
  function cellTime(a) { return a.kind === 'fish' ? CFG.fishCell : CFG.wormCell; }

  function solid(st, x, y) { return !inside(x, y) || !!st.walls[idx(x, y)]; }

  // Pixel position of an animal (top-left of its 24x24 sprite, pool coordinates).
  function pos(a) {
    return { x: (a.cx + (a.nx - a.cx) * a.prog) * 24, y: (a.cy + (a.ny - a.cy) * a.prog) * 24 };
  }
  // The cell the animal is mostly in.
  function nearCell(a) { return a.moving && a.prog >= 0.5 ? [a.nx, a.ny] : [a.cx, a.cy]; }

  function occupied(st, x, y) {
    return st.animals.some(function (a) { return (a.cx === x && a.cy === y) || (a.nx === x && a.ny === y); });
  }

  // ---------- Walls and demolition ----------

  // "La construction d'un mur est faite derrière l'animal": 3 pieces across the
  // cell behind the animal.
  function buildWall(st, a) {
    if (!a.alive || a.walls <= 0) return false;
    var c = nearCell(a), d = a.dir, bx = c[0] - DX[d], by = c[1] - DY[d];
    var px = DY[d] !== 0 ? 1 : 0, py = DX[d] !== 0 ? 1 : 0, placed = 0;
    [0, -1, 1].forEach(function (k) {
      var x = bx + px * k, y = by + py * k;
      if (!inside(x, y) || st.walls[idx(x, y)] || st.zoneAt[idx(x, y)] >= 0 || occupied(st, x, y)) return;
      if (st.buoy && st.buoy.x === x && st.buoy.y === y) return;
      if (st.petard && st.petard.x === x && st.petard.y === y) return;
      st.walls[idx(x, y)] = { type: Math.floor(st.rng() * 6), born: st.t };
      st.events.push({ e: 'piece', x: x, y: y });
      placed++;
    });
    if (!placed) return false;
    a.walls--;
    st.events.push({ e: 'wall', side: a.side });
    return true;
  }

  // "La destruction se fait devant": 2 rows of 3 cells in front of the animal.
  function demolish(st, a) {
    if (!a.alive || a.charge <= 0) return false;
    var c = nearCell(a), d = a.dir;
    var px = DY[d] !== 0 ? 1 : 0, py = DX[d] !== 0 ? 1 : 0, n = 0;
    for (var dep = 1; dep <= 2; dep++) {
      for (var k = -1; k <= 1; k++) {
        var x = c[0] + DX[d] * dep + px * k, y = c[1] + DY[d] * dep + py * k;
        if (!inside(x, y)) continue;
        var w = st.walls[idx(x, y)];
        st.events.push({ e: 'boom', x: x, y: y, wall: w ? w.type : -1 });
        if (w) { st.walls[idx(x, y)] = null; n++; }
      }
    }
    a.charge = 0;
    st.events.push({ e: 'demolish', side: a.side, n: n });
    return true;
  }

  // ---------- Bonuses ----------

  function freeCell(st) {
    for (var tries = 0; tries < 200; tries++) {
      var x = Math.floor(st.rng() * COLS), y = Math.floor(st.rng() * ROWS);
      if (st.walls[idx(x, y)] || st.zoneAt[idx(x, y)] >= 0 || occupied(st, x, y)) continue;
      if ((st.buoy && st.buoy.x === x && st.buoy.y === y) || (st.petard && st.petard.x === x && st.petard.y === y)) continue;
      var tooClose = st.animals.some(function (a) { return Math.abs(a.cx - x) + Math.abs(a.cy - y) < 3; });
      if (tooClose) continue;
      return { x: x, y: y, born: st.t };
    }
    return null;
  }

  function pickBonuses(st, a) {
    var c = nearCell(a);
    if (st.buoy && st.buoy.x === c[0] && st.buoy.y === c[1]) {
      a.walls = Math.min(CFG.maxWalls, a.walls + 1);
      st.events.push({ e: 'pick', what: 'buoy', side: a.side, x: c[0], y: c[1] });
      st.buoy = null;
      st.buoyTimer = CFG.buoyDelay[0] + st.rng() * (CFG.buoyDelay[1] - CFG.buoyDelay[0]);
    }
    if (st.petard && st.petard.x === c[0] && st.petard.y === c[1]) {
      a.charge = CFG.chargeTime;
      st.events.push({ e: 'pick', what: 'petard', side: a.side, x: c[0], y: c[1] });
      st.petard = null;
      st.petardTimer = CFG.petardDelay[0] + st.rng() * (CFG.petardDelay[1] - CFG.petardDelay[0]);
    }
  }

  // ---------- Movement ----------

  // want: direction wanted by the player/AI when the animal reaches a cell (-1 = stop).
  function moveAnimal(st, a, want, dt) {
    a.animT += dt;
    var ct = cellTime(a), left = dt;
    var guard = 0;
    while (left > 0 && guard++ < 4) {
      if (!a.moving) {
        var d = typeof want === 'function' ? want() : want;
        if (d < 0) return;
        var tx = a.cx + DX[d], ty = a.cy + DY[d];
        if (d !== a.dir) { a.turnFrom = a.dir; a.dir = d; } else a.turnFrom = -1;
        if (solid(st, tx, ty)) return;
        a.nx = tx; a.ny = ty; a.moving = true; a.prog = 0;
      }
      var need = (1 - a.prog) * ct;
      if (left < need) { a.prog += left / ct; left = 0; }
      else {
        left -= need; a.cx = a.nx; a.cy = a.ny; a.prog = 0; a.moving = false;
        pickBonuses(st, a);
      }
    }
  }

  // ---------- One tick ----------

  // wants: [wantLeft, wantRight], each a direction or a function returning one.
  function step(st, dt, wants) {
    if (st.over) return;
    st.t += dt;
    var f = fish(st), w = worm(st);

    st.animals.forEach(function (a, i) { moveAnimal(st, a, wants[i], dt); });

    // air
    st.animals.forEach(function (a) {
      var c = nearCell(a), z = st.zoneAt[idx(c[0], c[1])] >= 0;
      if (z && !a.inZone) st.events.push({ e: 'breath', side: a.side, x: c[0], y: c[1] });
      a.inZone = z;
      if (z) a.air = Math.min(1, a.air + CFG.breathRate * dt);
      else a.air -= dt / CFG.airTime;
      if (a.charge > 0) a.charge = Math.max(0, a.charge - dt);
    });

    // bonuses
    if (!st.buoy) { st.buoyTimer -= dt; if (st.buoyTimer <= 0) { st.buoy = freeCell(st); if (!st.buoy) st.buoyTimer = 1; } }
    if (!st.petard) { st.petardTimer -= dt; if (st.petardTimer <= 0) { st.petard = freeCell(st); if (!st.petard) st.petardTimer = 1; } }

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
    if (st.t >= CFG.roundTime) { st.t = CFG.roundTime; return endRound(st, w.side, 'time'); }
  }

  function endRound(st, winner, how) {
    st.over = true;
    // times are kept in tenths of a second so that equal times can really happen
    st.result = { winner: winner, how: how, time: Math.round(st.t * 10) / 10 };
    st.events.push({ e: 'end', how: how, winner: winner });
  }

  // ---------- Final result (original messages) ----------

  var NAMES = ['gauche', 'droite'];
  function fmt(t) { return String(t).replace('.', ',') + ' s'; }

  // results: [r1, r2] as returned in st.result. Returns {winner, text}.
  function matchResult(r) {
    var a = r[0].winner, b = r[1].winner;
    if (a >= 0 && a === b) return { winner: a, text: NAMES[a] + ' a gagné les 2 manches .' };
    if (a < 0 && b < 0) return { winner: -1, text: 'Ex-aequo dans les 2 manches .C\'est rare !' };
    if (a >= 0 && b < 0) {
      return { winner: a, text: 'Première manche gagnée par ' + NAMES[a] + '.Ex-aequo dans la seconde.\n' + NAMES[a] + ' a donc gagné la partie .' };
    }
    if (a < 0 && b >= 0) {
      return { winner: b, text: 'Ex-aequo dans la première manche .' + NAMES[b] + ' a gagné la seconde\n' + NAMES[b] + ' a donc gagné la partie .' };
    }
    // each won one round: the fastest takes the match
    var ta = r[0].time, tb = r[1].time;
    var head = NAMES[a] + ' a gagné la première manche en ' + fmt(ta) + ', ' + NAMES[b] + ' la seconde en ' + fmt(tb) + '.\n';
    if (ta === tb) return { winner: -1, text: head + 'Chacun a gagné sa manche dans le même temps !\npersonne n\'a donc gagné la partie .Faites en une autre !' };
    var w = ta < tb ? a : b;
    return { winner: w, text: head + NAMES[w] + ' a donc gagné la partie .' };
  }

  function roundText(st) {
    var r = st.result, f = fish(st), w = worm(st);
    var role = function (a) { return (a.kind === 'fish' ? 'le poisson' : 'le ver') + ' (' + NAMES[a.side] + ')'; };
    switch (r.how) {
      case 'catch': return cap(role(f)) + ' a attrapé ' + role(w) + ' en ' + fmt(r.time) + '.';
      case 'time': return cap(role(f)) + ' n\'a pas attrapé ' + role(w) + ' en 90 secondes : ' + NAMES[w.side] + ' gagne la manche.';
      case 'air': {
        var dead = f.alive ? w : f, other = f.alive ? f : w;
        return cap(role(dead)) + ' a manqué d\'air : ' + NAMES[other.side] + ' gagne la manche en ' + fmt(r.time) + '.';
      }
      default: return 'Les deux animaux ont manqué d\'air en même temps : ex-aequo !';
    }
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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
  function downhill(st, dist, x, y, ignoreWalls) {
    var best = -1, bd = dist[idx(x, y)];
    if (bd <= 0) return -1;
    for (var d = 0; d < 4; d++) {
      var nx = x + DX[d], ny = y + DY[d];
      if (!inside(nx, ny) || (!ignoreWalls && st.walls[idx(nx, ny)])) continue;
      var v = dist[idx(nx, ny)];
      if (v >= 0 && v < bd) { bd = v; best = d; }
    }
    return best;
  }

  // AI memory per side (kept outside the round state).
  function newBrain(level) { return { level: level, breathing: false, wander: -1 }; }

  // Called each tick for a computer-controlled animal: may build/demolish, and
  // returns a function giving the direction to take when on a cell.
  function aiThink(st, me, brain) {
    var other = st.animals[1 - me.side];
    var expert = brain.level === 1;
    return function () {
      var x = me.cx, y = me.cy, d;
      var oc = other.moving ? [other.nx, other.ny] : [other.cx, other.cy];
      var myD = bfs(st, x, y, false);

      // 1. breathing
      var bestZ = -1, zd = 1e9;
      ZONES.forEach(function (z, i) {
        var v = myD[idx(z[0], z[1])];
        if (v < 0) return;
        if (me.kind === 'worm') { // avoid zones guarded by the fish
          var fd = Math.abs(oc[0] - z[0]) + Math.abs(oc[1] - z[1]);
          if (fd < v && me.air > 0.25) v += 12;
        }
        if (v < zd) { zd = v; bestZ = i; }
      });
      var need = (zd * cellTime(me) + 2) / CFG.airTime * (expert ? 1.25 : 1.6);
      if (st.zoneAt[idx(x, y)] >= 0) {
        var danger = me.kind === 'worm' && Math.abs(oc[0] - x) + Math.abs(oc[1] - y) <= 3 && me.air > 0.35;
        if (me.air < (expert ? 0.95 : 0.85) && !danger) return -1; // stay and breathe
        brain.breathing = false;
      } else if (bestZ >= 0 && (me.air < need || brain.breathing)) {
        brain.breathing = true;
        var zdist = bfs(st, ZONES[bestZ][0], ZONES[bestZ][1], false);
        d = downhill(st, zdist, x, y, false);
        if (d >= 0) return d;
      } else if (bestZ < 0 && me.air < 0.6) {
        // zones walled off: go through the walls with a firecracker
        var r = goThrough(st, me, ZONES[0][0], ZONES[0][1]);
        if (r >= -1) return r;
      }

      // beginner: some random moves
      if (!expert && st.rng() < 0.18) return randomDir(st, x, y);

      // 2. bonuses close by
      var bonuses = [st.buoy && me.walls < CFG.maxWalls ? st.buoy : null, st.petard && me.charge < 3 ? st.petard : null];
      for (var b = 0; b < 2; b++) {
        var bo = bonuses[b];
        if (!bo) continue;
        var bd = myD[idx(bo.x, bo.y)];
        var od = Math.abs(oc[0] - bo.x) + Math.abs(oc[1] - bo.y);
        var ok = me.kind === 'fish' ? bd >= 0 && bd <= 3 : bd >= 0 && bd <= 6 && od > bd + 3;
        if (ok) {
          d = downhill(st, bfs(st, bo.x, bo.y, false), x, y, false);
          if (d >= 0) return d;
        }
      }

      // 3. chase or flee
      if (me.kind === 'fish') {
        var tx = expert ? oc[0] : other.cx, ty = expert ? oc[1] : other.cy;
        var td = bfs(st, tx, ty, false);
        d = downhill(st, td, x, y, false);
        var through = bfs(st, tx, ty, true);
        if ((d < 0 || td[idx(x, y)] > through[idx(x, y)] + 6) && me.charge > 0) {
          var g = goThrough(st, me, tx, ty);
          if (g >= 0) return g;
        }
        if (d >= 0) return d;
        if (me.charge <= 0 && st.petard && myD[idx(st.petard.x, st.petard.y)] > 0) {
          return downhill(st, bfs(st, st.petard.x, st.petard.y, false), x, y, false);
        }
        return randomDir(st, x, y);
      }
      return flee(st, me, other, oc, expert);
    };
  }

  // Move towards (tx,ty) ignoring walls, demolishing the wall ahead.
  function goThrough(st, me, tx, ty) {
    var dist = bfs(st, tx, ty, true), d = downhill(st, dist, me.cx, me.cy, true);
    if (d < 0) return -2;
    var nx = me.cx + DX[d], ny = me.cy + DY[d];
    if (st.walls[idx(nx, ny)]) {
      if (me.charge <= 0) return -2;
      me.dir = d; demolish(st, me);
    }
    return d;
  }

  function randomDir(st, x, y) {
    var opts = [];
    for (var d = 0; d < 4; d++) if (!solid(st, x + DX[d], y + DY[d])) opts.push(d);
    return opts.length ? opts[Math.floor(st.rng() * opts.length)] : -1;
  }

  // Worm: pick the neighbour cell that keeps the largest area it can reach
  // before the fish (a Voronoi-like count), plus distance from the fish.
  function flee(st, me, f, fc, expert) {
    var fd = bfs(st, fc[0], fc[1], false);
    var ratio = CFG.wormCell / CFG.fishCell;
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
          if (fd[i] < 0 || md[i] * ratio + 1 < fd[i]) area++;
        }
        s += area;
      }
      if (df <= 1) s -= 500;
      if (d < 0) s -= 3;
      s += st.rng() * (expert ? 0.5 : 3);
      if (s > bs) { bs = s; best = d; }
    }
    // wall behind when the fish follows
    var dist = Math.abs(fc[0] - me.cx) + Math.abs(fc[1] - me.cy);
    if (me.walls > 0 && dist <= 4 && dist >= 2) {
      var vx = fc[0] - me.cx, vy = fc[1] - me.cy;
      if (vx * DX[me.dir] + vy * DY[me.dir] < 0) buildWall(st, me);
    }
    // stuck in a small pocket: blow up what is ahead
    if (me.charge > 0 && best >= 0 && fd[idx(me.cx, me.cy)] <= 3) {
      var ax = me.cx + DX[me.dir], ay = me.cy + DY[me.dir];
      if (inside(ax, ay) && st.walls[idx(ax, ay)]) demolish(st, me);
    }
    return best;
  }

  var KevEngine = {
    COLS: COLS, ROWS: ROWS, DX: DX, DY: DY, CFG: CFG, ZONES: ZONES, NAMES: NAMES,
    newRound: newRound, step: step, pos: pos, nearCell: nearCell, fish: fish, worm: worm,
    buildWall: buildWall, demolish: demolish, matchResult: matchResult, roundText: roundText,
    newBrain: newBrain, aiThink: aiThink, bfs: bfs, idx: idx
  };
  root.KevEngine = KevEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = KevEngine;
})(typeof window !== 'undefined' ? window : this);
