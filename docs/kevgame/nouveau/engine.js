/*
 * KevGame (nouvelle version) - rules engine and computer player (no drawing,
 * no DOM). Plain script: defines the global KevEngine (also exported for node
 * tests). Same rules as ../engine.js; the computer player is improved:
 *  - one table of settings per level (LEVELS) and a third level, "Expert";
 *  - bug fixes: walled-off zones (nearest zone through the walls, fetch a
 *    firecracker), random tie-break in downhill;
 *  - expert fish: guards the zone the worm will need, tops up its air, builds
 *    walls that shrink the worm's space; expert worm: 3-ply search, safe breaths;
 *  - seeded random numbers (mulberry32) for replayable AI-vs-AI rounds.
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

  // results: [r1, r2] as returned in st.result. names: optional display names
  // per side (default: 'gauche', 'droite'). Returns {winner, text}.
  function matchResult(r, names) {
    var N = names || NAMES;
    var a = r[0].winner, b = r[1].winner;
    if (a >= 0 && a === b) return { winner: a, text: N[a] + ' a gagné les 2 manches .' };
    if (a < 0 && b < 0) return { winner: -1, text: 'Ex-aequo dans les 2 manches .C\'est rare !' };
    if (a >= 0 && b < 0) {
      return { winner: a, text: 'Première manche gagnée par ' + N[a] + '.Ex-aequo dans la seconde.\n' + N[a] + ' a donc gagné la partie .' };
    }
    if (a < 0 && b >= 0) {
      return { winner: b, text: 'Ex-aequo dans la première manche .' + N[b] + ' a gagné la seconde\n' + N[b] + ' a donc gagné la partie .' };
    }
    // each won one round: the fastest takes the match
    var ta = r[0].time, tb = r[1].time;
    var head = N[a] + ' a gagné la première manche en ' + fmt(ta) + ', ' + N[b] + ' la seconde en ' + fmt(tb) + '.\n';
    if (ta === tb) return { winner: -1, text: head + 'Chacun a gagné sa manche dans le même temps !\npersonne n\'a donc gagné la partie .Faites en une autre !' };
    var w = ta < tb ? a : b;
    return { winner: w, text: head + N[w] + ' a donc gagné la partie .' };
  }

  function roundText(st, names) {
    var N = names || NAMES;
    var r = st.result, f = fish(st), w = worm(st);
    var role = function (a) { return (a.kind === 'fish' ? 'le poisson' : 'le ver') + ' (' + N[a.side] + ')'; };
    switch (r.how) {
      case 'catch': return cap(role(f)) + ' a attrapé ' + role(w) + ' en ' + fmt(r.time) + '.';
      case 'time': return cap(role(f)) + ' n\'a pas attrapé ' + role(w) + ' en 90 secondes : ' + N[w.side] + ' gagne la manche.';
      case 'air': {
        var dead = f.alive ? w : f, other = f.alive ? f : w;
        return cap(role(dead)) + ' a manqué d\'air : ' + N[other.side] + ' gagne la manche en ' + fmt(r.time) + '.';
      }
      default: return 'Les deux animaux ont manqué d\'air en même temps : ex-aequo !';
    }
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Seeded random numbers ----------

  // mulberry32: tiny, fast, good enough for a game. Same seed = same sequence,
  // so a round driven by the computer on both sides is replayed identically
  // (with the fixed time step of the page).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Computer player: one table for all the level settings ----------

  var LEVELS = [
    { name: 'Débutant',
      random: 0.18,        // share of random moves
      airMargin: 1.6,      // safety factor on the air needed to reach a zone
      leaveAir: 0.85,      // leaves the bubble zone at this air level
      fishTarget: 'cur',   // fish aims at the cell the worm leaves
      fleeNoise: 3, territory: false, search: false, zoneFear: 'manhattan',
      fishPlan: false, fishWalls: false, buoyRange: 3 },
    { name: 'Confirmé',
      random: 0, airMargin: 1.25, leaveAir: 0.95,
      fishTarget: 'next',  // the cell the worm swims to
      fleeNoise: 0.5, territory: true, search: false, zoneFear: 'manhattan',
      fishPlan: false, fishWalls: false, buoyRange: 3 },
    { name: 'Expert',
      random: 0, airMargin: 1.2, leaveAir: 0.95,
      fishTarget: 'next',
      fleeNoise: 0.3, territory: true,
      search: true,        // worm: 3-ply search (worm, fish, worm) on territory
      zoneFear: 'bfs',     // worm: real fish distances to judge a guarded zone
      breathSmart: true, safeLead: 3,   // worm: tops up its air whenever a zone is safe
      fishPlan: true,      // fish: guards the zone the worm will need, tops up its own air
      chaseGap: 2,         // fish: plain chase when this close
      guardSlack: 2,       // fish: guards a zone it reaches at most 2 cells after the worm
      guardAir: 1.1,       // ... when the worm has less air than this
      closeWin: 12, closeBy: 3, // ... unless the gap shrank by 3 cells over its last 12 decisions
      fishWalls: true,     // fish: builds walls that shrink the worm's space
      buoyRange: 6 }
  ];

  // ---------- Distance maps ----------

  // Breadth-first distances from (x, y). ignoreWalls: walls cost nothing (for
  // planning a demolition). Returns Int16Array (-1 = unreachable).
  var queue = new Int16Array(COLS * ROWS);
  function bfs(st, x, y, ignoreWalls) {
    var dist = new Int16Array(COLS * ROWS).fill(-1), h = 0, t = 0, walls = st.walls;
    if (!inside(x, y)) return dist;
    queue[t++] = idx(x, y); dist[queue[0]] = 0;
    while (h < t) {
      var i = queue[h++], cx = i % COLS, cy = (i - cx) / COLS, di = dist[i] + 1;
      if (cy > 0 && dist[i - COLS] < 0 && (ignoreWalls || !walls[i - COLS])) { dist[i - COLS] = di; queue[t++] = i - COLS; }
      if (cx < COLS - 1 && dist[i + 1] < 0 && (ignoreWalls || !walls[i + 1])) { dist[i + 1] = di; queue[t++] = i + 1; }
      if (cy < ROWS - 1 && dist[i + COLS] < 0 && (ignoreWalls || !walls[i + COLS])) { dist[i + COLS] = di; queue[t++] = i + COLS; }
      if (cx > 0 && dist[i - 1] < 0 && (ignoreWalls || !walls[i - 1])) { dist[i - 1] = di; queue[t++] = i - 1; }
    }
    return dist;
  }

  // Direction from (x,y) that goes down the distance map (towards its origin).
  // Equal neighbours are drawn at random (the original always kept the first
  // one in the order up, right, down, left: the fish always preferred going up).
  function downhill(st, dist, x, y, ignoreWalls) {
    var bd = dist[idx(x, y)];
    if (bd <= 0) return -1;
    var opts = [], best = bd;
    for (var d = 0; d < 4; d++) {
      var nx = x + DX[d], ny = y + DY[d];
      if (!inside(nx, ny) || (!ignoreWalls && st.walls[idx(nx, ny)])) continue;
      var v = dist[idx(nx, ny)];
      if (v < 0 || v > best) continue;
      if (v < best) { best = v; opts = [d]; } else if (v < bd) opts.push(d);
    }
    if (!opts.length) return -1;
    return opts.length === 1 ? opts[0] : opts[Math.floor(st.rng() * opts.length)];
  }

  // Cells where an animal at distances `md` arrives before one at `od`
  // (a Voronoi-like territory); ratio = my cell time / its cell time.
  function territory(md, od, ratio) {
    var area = 0;
    for (var i = 0; i < md.length; i++) {
      if (md[i] < 0) continue;
      if (od[i] < 0 || md[i] * ratio + 1 < od[i]) area++;
    }
    return area;
  }

  // AI memory per side (kept outside the round state).
  function newBrain(level) {
    var L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level | 0))];
    return { level: level | 0, L: L, breathing: false, guard: -1 };
  }

  function targetCell(a) { return a.moving ? [a.nx, a.ny] : [a.cx, a.cy]; }

  // Air the animal needs to swim `cells` cells and breathe, with a margin.
  function airNeed(a, cells, margin) { return (cells * cellTime(a) + 2) / CFG.airTime * margin; }

  // Called each tick for a computer-controlled animal: may build/demolish, and
  // returns a function giving the direction to take when on a cell.
  function aiThink(st, me, brain) {
    var other = st.animals[1 - me.side];
    var L = brain.L || LEVELS[brain.level] || LEVELS[0];
    return function () {
      var x = me.cx, y = me.cy, d;
      var oc = targetCell(other);
      var myD = bfs(st, x, y, false);
      var od = null; // other's distances, computed on demand
      function otherD() { return od || (od = bfs(st, oc[0], oc[1], false)); }

      // 1. breathing
      var smart = L.breathSmart && me.kind === 'worm';
      if (smart && st.zoneAt[idx(x, y)] < 0) {
        d = smartBreath(st, me, myD, otherD(), L);
        if (d >= 0) return d;
      }
      if (L.fishPlan && me.kind === 'fish' && st.zoneAt[idx(x, y)] < 0 && me.air < 0.7) {
        // expert fish: tops up its air while the worm is out of reach (in a
        // zone or far away), so that it is not forced to let go later
        var gapNow = myD[idx(oc[0], oc[1])];
        if (other.inZone || gapNow < 0 || gapNow >= 9) {
          var fz = -1, fzd = 7;
          ZONES.forEach(function (z, i) { var v = myD[idx(z[0], z[1])]; if (v >= 0 && v < fzd) { fzd = v; fz = i; } });
          if (fz >= 0) {
            d = downhill(st, bfs(st, ZONES[fz][0], ZONES[fz][1], false), x, y, false);
            if (d >= 0) return d;
          }
        }
      }
      var bestZ = -1, zd = 1e9;
      ZONES.forEach(function (z, i) {
        var v = myD[idx(z[0], z[1])];
        if (v < 0) return;
        if (me.kind === 'worm' && me.air > 0.25) { // avoid zones guarded by the fish
          var fd = L.zoneFear === 'bfs' ? otherD()[idx(z[0], z[1])] : Math.abs(oc[0] - z[0]) + Math.abs(oc[1] - z[1]);
          if (fd >= 0 && (L.zoneFear === 'bfs' ? fd <= v + 1 : fd < v)) v += 12;
        }
        if (v < zd) { zd = v; bestZ = i; }
      });
      var need = airNeed(me, zd, L.airMargin);
      if (st.zoneAt[idx(x, y)] >= 0) {
        var danger = me.kind === 'worm' && (smart ? otherD()[idx(x, y)] <= 3 && me.air > 0.25 : Math.abs(oc[0] - x) + Math.abs(oc[1] - y) <= 3 && me.air > 0.35);
        // expert fish: leaves the zone at once to catch a worm passing by
        if (L.fishPlan && me.kind === 'fish' && me.air > 0.4 && myD[idx(oc[0], oc[1])] <= 3) danger = true;
        if (me.air < L.leaveAir && !danger) return -1; // stay and breathe
        brain.breathing = false;
      } else if (bestZ >= 0 && !smart && (me.air < need || brain.breathing)) {
        brain.breathing = true;
        var zdist = bfs(st, ZONES[bestZ][0], ZONES[bestZ][1], false);
        d = downhill(st, zdist, x, y, false);
        if (d >= 0) return d;
      } else if (bestZ < 0) {
        // All the zones are walled off. Bug fix: aim at the zone that is the
        // closest through the walls (not always ZONES[0]); and without a
        // firecracker go and fetch one instead of swimming on until suffocation.
        var thr = bfs(st, x, y, true), nz = -1, nd = 1e9;
        ZONES.forEach(function (z, i) { var v = thr[idx(z[0], z[1])]; if (v >= 0 && v < nd) { nd = v; nz = i; } });
        if (nz >= 0 && me.air < Math.max(0.6, airNeed(me, nd + 6, L.airMargin))) {
          if (me.charge > 0) {
            var r = goThrough(st, me, ZONES[nz][0], ZONES[nz][1]);
            if (r >= 0) return r;
          } else if (st.petard && myD[idx(st.petard.x, st.petard.y)] > 0) {
            d = downhill(st, bfs(st, st.petard.x, st.petard.y, false), x, y, false);
            if (d >= 0) return d;
          } else {
            // no firecracker in reach: wait against the wall that is the
            // closest to the zone, ready to blow it up
            var r2 = approachWall(st, me, ZONES[nz][0], ZONES[nz][1]);
            if (r2 >= -1 && me.kind === 'fish') return r2;
            if (r2 >= -1 && Math.abs(oc[0] - x) + Math.abs(oc[1] - y) > 4) return r2;
          }
        }
      }

      // beginner: some random moves
      if (L.random && st.rng() < L.random) return randomDir(st, x, y);

      // 2. bonuses close by
      var bonuses = [st.buoy && me.walls < CFG.maxWalls ? st.buoy : null, st.petard && me.charge < 3 ? st.petard : null];
      for (var b = 0; b < 2; b++) {
        var bo = bonuses[b];
        if (!bo) continue;
        var bd = myD[idx(bo.x, bo.y)];
        var ob = Math.abs(oc[0] - bo.x) + Math.abs(oc[1] - bo.y);
        var ok;
        if (me.kind === 'fish') {
          var range = b === 0 ? L.buoyRange : 3, far = Math.abs(oc[0] - x) + Math.abs(oc[1] - y) > 6;
          ok = bd >= 0 && (bd <= 3 || (bd <= range && far));
        } else ok = bd >= 0 && bd <= 6 && ob > bd + 3;
        if (ok) {
          d = downhill(st, bfs(st, bo.x, bo.y, false), x, y, false);
          if (d >= 0) return d;
        }
      }

      // 3. chase or flee
      if (me.kind === 'fish') {
        if (L.fishPlan) {
          if (L.fishWalls && me.walls > 0) fishWall(st, me, other, oc);
          d = fishPlan(st, me, other, oc, myD, otherD(), brain);
          if (d !== -3) return d; // -1 = stay on the guarded zone
        }
        return chase(st, me, other, oc, myD, L);
      }
      if (L.search) return fleeSearch(st, me, other, oc, otherD(), L);
      return flee(st, me, other, oc, L, otherD());
    };
  }

  // Expert worm: breathe when it is safe, not only when it must. A zone is
  // safe when the worm gets there well before the fish. When the air is short,
  // pick the reachable zone with the best lead on the fish.
  function smartBreath(st, me, myD, fd, L) {
    var ratio = CFG.wormCell / CFG.fishCell, zmin = 1e9, best = -1, bs = -1e9, lead = -1e9;
    ZONES.forEach(function (z, i) {
      var zi = idx(z[0], z[1]), v = myD[zi];
      if (v < 0) return;
      if (v < zmin) zmin = v;
      if (airNeed(me, v, 1.05) > me.air) return;      // cannot make it
      var f = fd[zi] < 0 ? 99 : fd[zi], margin = f - v * ratio;
      var s = margin * 2 - v * 0.5;
      if (s > bs) { bs = s; best = i; lead = margin; }
    });
    if (zmin === 1e9) return -2;
    var forced = me.air < airNeed(me, zmin, L.airMargin);
    if (best < 0) { // nothing reachable in time: try the nearest anyway
      if (!forced) return -2;
      ZONES.forEach(function (z, i) { if (myD[idx(z[0], z[1])] === zmin) best = i; });
    } else if (!forced && !(me.air < 0.75 && lead >= L.safeLead + (me.air - 0.35) * 10)) return -2;
    return downhill(st, bfs(st, ZONES[best][0], ZONES[best][1], false), me.cx, me.cy, false);
  }

  // Plain chase (beginner and confirmed fish, and the expert one at close range).
  function chase(st, me, other, oc, myD, L) {
    var x = me.cx, y = me.cy, d;
    var tx = L.fishTarget === 'cur' ? other.cx : oc[0], ty = L.fishTarget === 'cur' ? other.cy : oc[1];
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

  // Expert fish. Returns a direction, -1 to stay, or -3 to leave the decision
  // to the plain chase (when close to the worm, or when no zone is worth guarding).
  function fishPlan(st, me, w, wc, myD, wD, brain) {
    var L = brain.L;
    var x = me.cx, y = me.cy;
    var gap = myD[idx(wc[0], wc[1])];
    brain.guard = -1;
    if (gap < 0) return -3;      // cut off from the worm: plain chase handles it
    if (gap <= L.chaseGap) return -3; // close: plain chase (intercepts the next cell)
    // a worm that lets the fish come closer (a weak one) is simply chased
    var h = brain.gaps || (brain.gaps = []);
    h.push(gap); if (h.length > L.closeWin) h.shift();
    if (L.closeWin && h.length === L.closeWin && gap <= h[0] - L.closeBy) return -3;
    var ratio = CFG.wormCell / CFG.fishCell;
    // Which zone will the worm go to? Model: the zone where it has the best
    // lead on the fish (what a careful worm, or player, does). The fish swims
    // there when it can arrive about as soon as the worm: the worm then finds
    // no safe zone and its air keeps going down.
    var wz = -1, ws = -1e9, wzReal = 0;
    ZONES.forEach(function (z, i) {
      var zi = idx(z[0], z[1]), v = wD[zi], f = myD[zi];
      if (v < 0) return;
      var sc = ((f < 0 ? 99 : f) - v * ratio) * 2 - v * 0.5;
      if (sc > ws) { ws = sc; wz = i; wzReal = v; }
    });
    if (!w.inZone && wz >= 0 && w.air < L.guardAir) {
      var z = ZONES[wz];
      if (x === z[0] && y === z[1]) { brain.guard = wz; return -1; } // stay (and breathe)
      if (myD[idx(z[0], z[1])] <= wzReal + L.guardSlack) {
        brain.guard = wz;
        var dz = downhill(st, bfs(st, z[0], z[1], false), x, y, false);
        if (dz >= 0) return dz;
      }
    }

    return -3;
  }

  // Expert fish: build a wall behind itself when it shrinks the worm's space
  // or lengthens its way to the air, without walling the fish off.
  function fishWall(st, me, w, wc) {
    if (me.moving) return;
    var cells = wallCells(st, me);
    if (!cells.length) return;
    var before = bfs(st, wc[0], wc[1], false);
    cells.forEach(function (i) { st.walls[i] = { type: 0, born: st.t }; });
    var after = bfs(st, wc[0], wc[1], false);
    cells.forEach(function (i) { st.walls[i] = null; });
    if (after[idx(me.cx, me.cy)] < 0) return;   // would wall the fish off
    var r0 = 0, r1 = 0;
    for (var i = 0; i < before.length; i++) { if (before[i] >= 0) r0++; if (after[i] >= 0) r1++; }
    var z0 = 99, z1 = 99;
    ZONES.forEach(function (z) {
      var a = before[idx(z[0], z[1])], b = after[idx(z[0], z[1])];
      if (a >= 0) z0 = Math.min(z0, a);
      if (b >= 0) z1 = Math.min(z1, b);
    });
    var gain = (r0 - r1) + (w.air < 0.5 ? 3 * (Math.min(z1, 40) - Math.min(z0, 40)) : 0);
    if (gain >= 12) buildWall(st, me);
  }

  // The cells buildWall would fill (without building).
  function wallCells(st, a) {
    var c = nearCell(a), d = a.dir, bx = c[0] - DX[d], by = c[1] - DY[d];
    var px = DY[d] !== 0 ? 1 : 0, py = DX[d] !== 0 ? 1 : 0, out = [];
    [0, -1, 1].forEach(function (k) {
      var x = bx + px * k, y = by + py * k;
      if (!inside(x, y) || st.walls[idx(x, y)] || st.zoneAt[idx(x, y)] >= 0 || occupied(st, x, y)) return;
      if (st.buoy && st.buoy.x === x && st.buoy.y === y) return;
      if (st.petard && st.petard.x === x && st.petard.y === y) return;
      out.push(idx(x, y));
    });
    return out;
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

  // Like goThrough without a firecracker: swim along the through-walls path
  // and stop (facing it) at the first wall.
  function approachWall(st, me, tx, ty) {
    var dist = bfs(st, tx, ty, true), d = downhill(st, dist, me.cx, me.cy, true);
    if (d < 0) return -2;
    if (st.walls[idx(me.cx + DX[d], me.cy + DY[d])]) { me.dir = d; return -1; }
    return d;
  }

  function randomDir(st, x, y) {
    var opts = [];
    for (var d = 0; d < 4; d++) if (!solid(st, x + DX[d], y + DY[d])) opts.push(d);
    return opts.length ? opts[Math.floor(st.rng() * opts.length)] : -1;
  }

  // Worm (beginner, confirmed): pick the neighbour cell that keeps the largest
  // area it can reach before the fish (a Voronoi-like count), plus distance.
  function flee(st, me, f, fc, L, fd) {
    var ratio = CFG.wormCell / CFG.fishCell;
    var best = -1, bs = -1e9;
    for (var d = -1; d < 4; d++) {
      var nx = me.cx + (d < 0 ? 0 : DX[d]), ny = me.cy + (d < 0 ? 0 : DY[d]);
      if (solid(st, nx, ny)) continue;
      var df = fd[idx(nx, ny)];
      if (df < 0) df = 99;
      var s = df * 4;
      if (L.territory) s += territory(bfs(st, nx, ny, false), fd, ratio);
      if (df <= 1) s -= 500;
      if (d < 0) s -= 3;
      s += st.rng() * L.fleeNoise;
      if (s > bs) { bs = s; best = d; }
    }
    wormTools(st, me, fc, fd, best);
    return best;
  }

  // Worm walls and firecracker (all levels, rules of the original).
  function wormTools(st, me, fc, fd, best) {
    var dist = Math.abs(fc[0] - me.cx) + Math.abs(fc[1] - me.cy);
    if (me.walls > 0 && dist <= 4 && dist >= 2) {
      var vx = fc[0] - me.cx, vy = fc[1] - me.cy;
      if (vx * DX[me.dir] + vy * DY[me.dir] < 0) buildWall(st, me);
    }
    if (me.charge > 0 && best >= 0 && fd[idx(me.cx, me.cy)] <= 3) {
      var ax = me.cx + DX[me.dir], ay = me.cy + DY[me.dir];
      if (inside(ax, ay) && st.walls[idx(ax, ay)]) demolish(st, me);
    }
  }

  // Value of a position for the worm (worm on cell wi, fish on cell fi), used
  // by both 3-ply searches: territory (cells the worm reaches first), distance
  // to the fish and bubble zones the worm reaches first.
  function searchCtx(st, airLow) {
    var ratio = CFG.wormCell / CFG.fishCell, cache = {};
    function dist(i) { return cache[i] || (cache[i] = bfs(st, i % COLS, (i - i % COLS) / COLS, false)); }
    function moves(i, stay) {
      var x = i % COLS, y = (i - x) / COLS, out = stay ? [i] : [];
      for (var d = 0; d < 4; d++) if (!solid(st, x + DX[d], y + DY[d])) out.push(idx(x + DX[d], y + DY[d]));
      return out;
    }
    function leaf(wi, fi) {
      var fd = dist(fi), df = fd[wi];
      if (df < 0) df = 60;
      if (df <= 1) return -1000 + df;
      var md = dist(wi), s = df * 4 + territory(md, fd, ratio);
      // zones the worm reaches first are worth a lot when the air goes down
      ZONES.forEach(function (z) {
        var zi = idx(z[0], z[1]);
        if (md[zi] >= 0 && (fd[zi] < 0 || md[zi] * ratio + 1 < fd[zi])) s += airLow ? 30 - Math.min(md[zi], 25) : 6;
      });
      return s;
    }
    return { dist: dist, moves: moves, leaf: leaf };
  }

  // Expert worm: 3-ply search. The worm picks a move, the fish answers with
  // the move that hurts the worm most, the worm picks its best second move.
  function fleeSearch(st, me, f, fc, fd0, L) {
    var S = searchCtx(st, me.air < 0.45), fi0 = idx(fc[0], fc[1]);
    var best = -1, bs = -1e9;
    for (var d = -1; d < 4; d++) {
      var nx = me.cx + (d < 0 ? 0 : DX[d]), ny = me.cy + (d < 0 ? 0 : DY[d]);
      if (solid(st, nx, ny)) continue;
      var w1 = idx(nx, ny), s;
      if (fd0[w1] >= 0 && fd0[w1] <= 1) s = -2000;
      else {
        var worst = 1e9, fm = S.moves(fi0, true);
        for (var a = 0; a < fm.length; a++) {
          var f1 = fm[a];
          if (f1 === w1) { worst = -1500; break; }
          var wm = S.moves(w1, true), b2 = -1e9;
          for (var c = 0; c < wm.length; c++) b2 = Math.max(b2, S.leaf(wm[c], f1));
          if (b2 < worst) worst = b2;
        }
        s = worst;
      }
      if (d < 0) s -= 3;
      s += st.rng() * L.fleeNoise;
      if (s > bs) { bs = s; best = d; }
    }
    wormTools(st, me, fc, fd0, best);
    return best;
  }

  var KevEngine = {
    COLS: COLS, ROWS: ROWS, DX: DX, DY: DY, CFG: CFG, ZONES: ZONES, NAMES: NAMES, LEVELS: LEVELS,
    newRound: newRound, step: step, pos: pos, nearCell: nearCell, fish: fish, worm: worm,
    buildWall: buildWall, demolish: demolish, matchResult: matchResult, roundText: roundText,
    newBrain: newBrain, aiThink: aiThink, bfs: bfs, idx: idx, downhill: downhill,
    mulberry32: mulberry32, territory: territory
  };
  root.KevEngine = KevEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = KevEngine;
})(typeof window !== 'undefined' ? window : this);
