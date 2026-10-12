/*
 * KevGame (nouvelle version) - rules engine and computer player (no drawing,
 * no DOM). Plain script: defines the global KevEngine (also exported for node
 * tests).
 *
 * The rules are those of the original, measured frame by frame under Wine
 * (same as ../engine.js):
 * - the pool is a grid of 21 x 13 cells of 24 px; the game runs on ticks of
 *   50 ms (Timer1); both animals swim 4 px per tick (one cell in 6 ticks =
 *   0.3 s) while their key is held, and always stop on a cell;
 * - round 1: left = worm (cell 1,1), right = fish (cell 19,1), both facing up;
 *   round 2: roles swapped; 5 to 11 random buoys/balloons in columns 2-18,
 *   rows 1-11 at the start of each round;
 * - air: 60 units, minus 1 every 10 ticks (30 s); back to 60 at once in the
 *   cell of one of the 2 bubble zones, which start at (0,6) and (20,6) and
 *   jump to a random neighbouring cell every 36 ticks (1.8 s);
 * - walls: the worm can lay 4, the fish 7, one buoy in the cell behind; the
 *   blinking buoy refills that stock to its maximum;
 * - demolitions: 3 per round, a lit firecracker on the wall just in front, it
 *   explodes 20 ticks (1 s) later; a firecracker picked up refills to 3;
 * - bonuses: blinking buoy at 0, 30, 60 s, firecracker at 15, 45, 75 s, each
 *   for 7.5 s; 90 s rounds; times kept in whole seconds.
 *
 * What is new here is the computer player:
 *  - one table of settings per level (LEVELS) and a third level, "Expert";
 *  - bug fixes: walled-off zones (nearest zone through the walls, fetch a
 *    firecracker), zones sitting on a wall, waiting for a lit firecracker
 *    instead of swimming away;
 *  - expert fish: guards the zone the worm will need, tops up its air, lays
 *    walls that shrink the worm's space; expert worm: 3-ply search, safe breaths;
 *  - seeded random numbers (mulberry32) for replayable AI-vs-AI rounds.
 *
 * Directions: 0 = up, 1 = right, 2 = down, 3 = left.
 * Sides: 0 = left player ("gauche"), 1 = right player ("droite").
 * The engine produces "events" that the page turns into sounds and effects.
 */
(function (root) {
  'use strict';

  var COLS = 21, ROWS = 13;
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  var CFG = {
    tick: 0.05,          // s, Timer1.Interval = 50 ms
    speed: 4,            // px per tick (both animals): 6 ticks = 0.3 s per cell
    cellTicks: 6,
    roundTicks: 1800,    // 90 s
    airMax: 60, airTicks: 10,
    zoneTicks: 36,       // a bubble zone moves every 1.8 s
    walls: { worm: 4, fish: 7 },
    booms: 3,
    fuseTicks: 20,       // lit firecracker: 1 s
    bonusEvery: 300, bonusLife: 150, // a bonus every 15 s, for 7.5 s
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
      dir: 0, prevDir: -1, turnT: 0, air: CFG.airMax, airT: 0, inZone: false,
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
    // buoys and balloons already in the pool
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

  // The cell where buildWall would put a buoy: the cell the animal is leaving,
  // or, standing still, the cell behind it. -1 if nothing can go there.
  function wallCell(st, a) {
    var x, y;
    if (a.moving) { x = a.cx; y = a.cy; } else { x = a.cx - DX[a.dir]; y = a.cy - DY[a.dir]; }
    if (!inside(x, y) || st.walls[idx(x, y)]) return -1;
    var other = st.animals[1 - a.side], oc = nearCell(other), od = destCell(other);
    if ((oc[0] === x && oc[1] === y) || (od[0] === x && od[1] === y)) return -1;
    if (!a.moving && animalOn(st, x, y)) return -1;
    return idx(x, y);
  }

  // "La construction d'un mur est faite derrière l'animal": one buoy or balloon.
  function buildWall(st, a) {
    if (!a.alive || st.over || a.walls <= 0) return false;
    var i = wallCell(st, a);
    if (i < 0) return false;
    st.walls[i] = { type: rnd(st.rng, 6), born: st.ticks, fuse: 0 };
    a.walls--;
    st.events.push({ e: 'wall', side: a.side, x: i % COLS, y: Math.floor(i / COLS) });
    return true;
  }

  // "La destruction se fait devant": a lit firecracker on the wall just in
  // front of the animal. Nothing happens (and nothing is counted) without a wall.
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
      if (solid(st, a.cx + DX[d], a.cy + DY[d])) return; // a key towards a wall only turns
      a.moving = true; a.prog = 0;
    }
    a.prog += CFG.speed;
    if (a.prog >= 24) {
      a.cx += DX[a.dir]; a.cy += DY[a.dir]; a.prog = 0; a.moving = false;
    }
  }

  // ---------- One tick (50 ms) ----------

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
    if (st.ticks % CFG.bonusEvery === 0 && st.ticks < CFG.roundTicks) spawnBonus(st);

    // air
    st.animals.forEach(function (a) {
      var c = nearCell(a);
      var inZone = st.zones.some(function (z) { return z.x === c[0] && z.y === c[1]; });
      a.inZone = inZone;
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

  function elapsed(st) { return Math.floor(st.ticks / 20); }
  function secondsLeft(st) { return Math.max(0, 90 - elapsed(st)); }

  function endRound(st, winner, how) {
    st.over = true;
    // the original counts whole seconds ("gauche a gagné en 30 secondes .")
    st.result = { winner: winner, how: how, time: elapsed(st) };
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

  // How a round ended, in plain words (for the round summary of this version).
  // names: display names per side.
  function roundText(st, names) {
    var N = names || NAMES, r = st.result, f = fish(st), w = worm(st);
    var role = function (a) { return (a.kind === 'fish' ? 'le poisson' : 'le ver') + ' (' + N[a.side] + ')'; };
    var s = function (t) { return t + (t > 1 ? ' secondes' : ' seconde'); };
    switch (r.how) {
      case 'catch': return cap(role(f)) + ' a attrapé ' + role(w) + ' en ' + s(r.time) + '.';
      case 'time': return cap(role(f)) + ' n\'a pas attrapé ' + role(w) + ' en 90 secondes : il explose, le ver est roi.';
      case 'air': {
        var dead = f.alive ? w : f;
        return cap(role(dead)) + ' a manqué d\'air au bout de ' + s(r.time) + '.';
      }
      default: return 'Les deux animaux ont manqué d\'air en même temps : personne ne gagne la manche.';
    }
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Seeded random numbers ----------

  // mulberry32: tiny, fast, good enough for a game. Same seed = same sequence,
  // so a round driven by the computer on both sides is replayed identically
  // (the game itself advances by fixed ticks of 50 ms).
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
  // Air is in units (60 = full, one unit every 0.5 s, a cell costs 0.6 unit).

  var LEVELS = [
    { name: 'Débutant',
      greedy: true,        // aims straight (no path finding) at zones and at the worm
      fishRandom: [0.3, 0.6], // fish: random moves far from / near (3 cells) the worm
      fishAir: 12,         // fish: only goes to breathe at 12 units ("ne va pas respirer")
      wormAir: 42,         // worm: goes to breathe at 42 units
      wormLoop: 7,         // worm: small loops while the fish is more than 7 cells away
      fleeNoise: 3, territory: false, wallChance: 0.3,
      search: false, fishPlan: false, fishWalls: false, bonusFish: 3, bonusWorm: 6 },
    { name: 'Confirmé',
      greedy: false, margin: 14, // breathes when air <= 0.6 x distance + 14
      fleeNoise: 0.5, territory: true, wallChance: 1,
      search: false, fishPlan: false, fishWalls: false, bonusFish: 3, bonusWorm: 6 },
    { name: 'Expert',
      greedy: false, margin: 12,
      fishMargin: 6,       // fish: breathes later (fewer breaks in the chase)
      horiz: true,         // ties on a perfect diagonal: horizontal first
      fleeNoise: 0.3, territory: true, wallChance: 1,
      search: true,        // worm: 3-ply search (worm, fish, worm) on territory
      breathSmart: true, safeLead: 3, topUp: 45, // worm: tops up whenever a zone is safe
      fishPlan: true,      // fish: guards the zone the worm will need, tops up its own air
      chaseGap: 2,         // fish: plain chase when this close
      guardSlack: 2,       // fish: guards a zone it reaches at most 2 cells after the worm
      guardAir: 36,        // ... when the worm has less air than this
      closeWin: 12, closeBy: 3, // ... unless the gap shrank by 3 cells over its last 12 decisions
      fishTopUp: 40,       // fish: tops up under 40 units while the worm is far or breathing
      fishWalls: true, wallGain: 12, // fish: lays walls that take 12 cells from the worm
      bonusFish: 6, bonusWorm: 6 }
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
  // Ties: the direction along the longer side of the way to (tx, ty) first
  // (otherwise a chasing fish mirrors the worm's zigzag without getting
  // closer). On a perfect diagonal, horiz = true prefers the horizontal axis
  // (the pool is wider than high; expert level); otherwise the first in the
  // order up, right, down, left, as in ../engine.js.
  function downhill(st, dist, x, y, ignoreWalls, tx, ty, horiz) {
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
    if (opts.length > 1 && tx !== undefined) {
      var ax = Math.abs(tx - x), ay = Math.abs(ty - y);
      if (ax !== ay || horiz) {
        var along = opts.filter(function (o) { return (DX[o] !== 0) === (ax > ay || (ax === ay && horiz)); });
        if (along.length) opts = along;
      }
    }
    return opts[0];
  }

  // Greedy step towards (tx, ty) without planning (beginner level).
  function greedy(st, me, tx, ty) {
    var dx = tx - me.cx, dy = ty - me.cy, opts = [];
    if (Math.abs(dx) >= Math.abs(dy)) { if (dx) opts.push(dx > 0 ? 1 : 3); if (dy) opts.push(dy > 0 ? 2 : 0); }
    else { if (dy) opts.push(dy > 0 ? 2 : 0); if (dx) opts.push(dx > 0 ? 1 : 3); }
    if (!opts.length) return -1;
    for (var i = 0; i < opts.length; i++) if (!solid(st, me.cx + DX[opts[i]], me.cy + DY[opts[i]])) return opts[i];
    return randomDir(st, me.cx, me.cy);
  }

  function randomDir(st, x, y) {
    var opts = [];
    for (var d = 0; d < 4; d++) if (!solid(st, x + DX[d], y + DY[d])) opts.push(d);
    return opts.length ? opts[rnd(st.rng, opts.length)] : -1;
  }

  // Cells where an animal at distances `md` arrives before one at `od`
  // (a Voronoi-like territory; both swim at the same speed).
  function territory(md, od) {
    var area = 0;
    for (var i = 0; i < md.length; i++) {
      if (md[i] < 0) continue;
      if (od[i] < 0 || md[i] + 1 < od[i]) area++;
    }
    return area;
  }

  // The cells to aim at to breathe. A zone can sit on a wall (zones go
  // everywhere): then the free neighbour that is the closest, where the animal
  // waits for the zone to jump. Bug fix: the first port aimed at the wall cell
  // itself and found the zone "unreachable".
  // Returns [{i: zone index, c: target cell index, d: my distance (-1 = none)}].
  function zoneTargets(st, myD) {
    return st.zones.map(function (z, k) {
      var c = idx(z.x, z.y);
      if (!st.walls[c]) return { i: k, c: c, d: myD[c] };
      var best = -1, bd = -1;
      for (var d = 0; d < 4; d++) {
        var nx = z.x + DX[d], ny = z.y + DY[d];
        if (!inside(nx, ny)) continue;
        var v = myD[idx(nx, ny)];
        if (v >= 0 && (bd < 0 || v < bd)) { bd = v; best = idx(nx, ny); }
      }
      return { i: k, c: best, d: bd };
    });
  }
  function nearestZone(zt) {
    var best = null;
    zt.forEach(function (z) { if (z.d >= 0 && (!best || z.d < best.d)) best = z; });
    return best;
  }
  function toward(st, c, x, y, L) {
    var tx = c % COLS, ty = (c - tx) / COLS;
    return downhill(st, bfs(st, tx, ty, false), x, y, false, tx, ty, L && L.horiz);
  }

  // AI memory per side (kept outside the round state).
  function newBrain(level) {
    var lv = Math.max(0, Math.min(LEVELS.length - 1, level | 0));
    return { level: lv, L: LEVELS[lv], loop: 0, guard: -1 };
  }

  // Called each tick for a computer-controlled animal: returns a function
  // giving the direction to take when the animal is on a cell (it may also lay
  // a wall or light a firecracker then).
  function aiThink(st, me, brain) {
    var other = st.animals[1 - me.side];
    var L = brain.L || LEVELS[brain.level] || LEVELS[0];
    return function () {
      var x = me.cx, y = me.cy, d;
      var oc = destCell(other);
      var myD = bfs(st, x, y, false);
      var od = null; // other's distances, computed on demand
      function otherD() { return od || (od = bfs(st, oc[0], oc[1], false)); }
      var zt = zoneTargets(st, myD), zn = nearestZone(zt);

      // 1. breathing (a cell costs 0.6 unit of air)
      if (L.breathSmart && me.kind === 'worm') {
        d = smartBreath(st, me, zt, otherD(), L);
        if (d >= -1) return d;
      } else if (zn) {
        var need;
        if (L.greedy) need = me.air <= (me.kind === 'worm' ? L.wormAir : L.fishAir);
        else need = me.air <= zn.d * 0.6 + (me.kind === 'fish' && L.fishMargin ? L.fishMargin : L.margin);
        // expert fish: tops up its air while the worm is out of reach (in a
        // zone or far away), so that it is not forced to let go later
        if (L.fishPlan && me.kind === 'fish' && me.air < L.fishTopUp && zn.d <= 7) {
          var gapNow = myD[idx(oc[0], oc[1])];
          if (other.inZone || gapNow < 0 || gapNow >= 9) need = true;
        }
        if (need) {
          if (zn.d === 0) return -1; // next to a zone sitting on a wall: wait for it
          var zc = zn.c, zx = zc % COLS, zy = (zc - zx) / COLS;
          d = L.greedy ? greedy(st, me, zx, zy) : toward(st, zc, x, y, L);
          if (d >= 0) return d;
        }
      }
      if (!zn) {
        // All the zones are walled off. Bug fix: aim at the zone that is the
        // closest through the walls (the first port always took zone 0); and
        // without a firecracker go and fetch one instead of swimming on.
        var thr = bfs(st, x, y, true), nz = null, nd = 1e9;
        st.zones.forEach(function (z) { var v = thr[idx(z.x, z.y)]; if (v >= 0 && v < nd) { nd = v; nz = z; } });
        if (nz && me.air < Math.max(36, nd * 0.6 + (L.margin || 14) + 6)) {
          if (me.booms > 0) {
            var r = goThrough(st, me, nz.x, nz.y, L);
            if (r >= -1) return r;
          } else if (st.bonus && st.bonus.kind === 'petard' && myD[idx(st.bonus.x, st.bonus.y)] > 0) {
            d = toward(st, idx(st.bonus.x, st.bonus.y), x, y, L);
            if (d >= 0) return d;
          } else {
            // no firecracker in reach: wait against the wall that is the
            // closest to the zone, ready for the next one (or for the zone)
            var r2 = approachWall(st, me, nz.x, nz.y, L);
            if (r2 >= -1 && (me.kind === 'fish' || Math.abs(oc[0] - x) + Math.abs(oc[1] - y) > 4)) return r2;
          }
        }
      }

      // 2. bonuses close by (the buoy refills the walls, the firecracker the demolitions)
      var b = st.bonus;
      if (b && ((b.kind === 'buoy' && me.walls < CFG.walls[me.kind]) || (b.kind === 'petard' && me.booms < CFG.booms))) {
        var bd = myD[idx(b.x, b.y)], ob = Math.abs(oc[0] - b.x) + Math.abs(oc[1] - b.y);
        var ok = me.kind === 'fish'
          ? bd >= 0 && (bd <= 3 || (bd <= L.bonusFish && Math.abs(oc[0] - x) + Math.abs(oc[1] - y) > 6))
          : bd >= 0 && bd <= L.bonusWorm && ob > bd + 2;
        if (ok && bd > 0) {
          d = toward(st, idx(b.x, b.y), x, y, L);
          if (d >= 0) return d;
        }
      }

      // 3. chase or flee
      if (me.kind === 'fish') {
        if (L.fishPlan) {
          if (L.fishWalls && me.walls > 0) fishWall(st, me, other, oc, L);
          d = fishPlan(st, me, other, oc, myD, otherD(), brain);
          if (d !== -3) return d; // -1 = stay on the guarded zone
        }
        return chase(st, me, oc, myD, L);
      }
      if (L.search) return fleeSearch(st, me, oc, otherD(), L, brain);
      return flee(st, me, oc, otherD(), L, brain);
    };
  }

  // Expert worm: breathe when it is safe, not only when it must. A zone is
  // safe when the worm gets there well before the fish. When the air is short,
  // pick the reachable zone with the best lead on the fish.
  // Returns a direction, -1 (stay) or -2 (no breathing now).
  function smartBreath(st, me, zt, fd, L) {
    var zmin = 1e9, best = null, bs = -1e9, lead = -1e9;
    zt.forEach(function (z) {
      if (z.d < 0) return;
      if (z.d < zmin) zmin = z.d;
      if (z.d * 0.6 + 2 > me.air) return;            // cannot make it
      var f = fd[z.c] < 0 ? 99 : fd[z.c], margin = f - z.d;
      var s = margin * 2 - z.d * 0.5;
      if (s > bs) { bs = s; best = z; lead = margin; }
    });
    if (zmin === 1e9) return -2;
    var forced = me.air <= zmin * 0.6 + L.margin;
    if (!best) { // nothing reachable in time: try the nearest anyway
      if (!forced) return -2;
      zt.forEach(function (z) { if (z.d === zmin) best = z; });
    } else if (!forced && !(me.air < L.topUp && lead >= L.safeLead + (me.air - 20) / 6)) return -2;
    if (best.d === 0) return st.zones[best.i].x === me.cx && st.zones[best.i].y === me.cy ? -2 : -1;
    var d = toward(st, best.c, me.cx, me.cy, L);
    return d >= 0 ? d : -2;
  }

  // Plain chase (beginner and confirmed fish, and the expert one at close range).
  function chase(st, me, oc, myD, L) {
    var x = me.cx, y = me.cy, d;
    if (L.greedy) {
      // beginner: aims roughly, hesitates near its prey
      var near = Math.abs(oc[0] - x) + Math.abs(oc[1] - y) <= 3;
      if (st.rng() < L.fishRandom[near ? 1 : 0]) return randomDir(st, x, y);
      return greedy(st, me, oc[0], oc[1]);
    }
    var td = bfs(st, oc[0], oc[1], false);
    d = downhill(st, td, x, y, false, oc[0], oc[1], L.horiz);
    var through = bfs(st, oc[0], oc[1], true);
    if ((d < 0 || td[idx(x, y)] > through[idx(x, y)] + 6) && me.booms > 0) {
      var g = goThrough(st, me, oc[0], oc[1], L);
      if (g >= -1) return g;
    }
    if (d >= 0) return d;
    // cut off and no demolition left: fetch a firecracker
    if (me.booms <= 0 && st.bonus && st.bonus.kind === 'petard' && myD[idx(st.bonus.x, st.bonus.y)] > 0) {
      return toward(st, idx(st.bonus.x, st.bonus.y), x, y, L);
    }
    return randomDir(st, x, y);
  }

  // Expert fish. Returns a direction, -1 to stay, or -3 to leave the decision
  // to the plain chase (when close to the worm, or when no zone is worth guarding).
  function fishPlan(st, me, w, wc, myD, wD, brain) {
    var L = brain.L;
    var gap = myD[idx(wc[0], wc[1])];
    brain.guard = -1;
    if (gap < 0 || gap <= L.chaseGap) return -3;
    // a worm that lets the fish come closer (a weak one) is simply chased
    var h = brain.gaps || (brain.gaps = []);
    h.push(gap); if (h.length > L.closeWin) h.shift();
    if (L.closeWin && h.length === L.closeWin && gap <= h[0] - L.closeBy) return -3;
    if (w.inZone || w.air >= L.guardAir) return -3;
    // Which zone will the worm go to? Model: the zone where it has the best
    // lead on the fish (what a careful worm, or player, does). The fish swims
    // there when it can arrive about as soon as the worm: the worm then finds
    // no safe zone and its air keeps going down.
    var wz = zoneTargets(st, wD), best = null, ws = -1e9;
    wz.forEach(function (z) {
      if (z.d < 0) return;
      var f = myD[z.c], sc = ((f < 0 ? 99 : f) - z.d) * 2 - z.d * 0.5;
      if (sc > ws) { ws = sc; best = z; }
    });
    if (!best) return -3;
    var zc = st.zones[best.i];
    if (me.cx === zc.x && me.cy === zc.y) { brain.guard = best.i; return -1; } // stay (and breathe)
    var mine = zoneTargets(st, myD)[best.i];
    if (mine.d >= 0 && mine.d <= best.d + L.guardSlack) {
      brain.guard = best.i;
      if (mine.d === 0) return -1;
      var dz = toward(st, mine.c, me.cx, me.cy, L);
      if (dz >= 0) return dz;
    }
    return -3;
  }

  // Expert fish: lay a wall behind itself when it shrinks the worm's space
  // or lengthens its way to the air, without walling the fish off.
  function fishWall(st, me, w, wc, L) {
    if (me.moving) return;
    var cell = wallCell(st, me);
    if (cell < 0) return;
    var before = bfs(st, wc[0], wc[1], false);
    st.walls[cell] = { type: 0, born: 0, fuse: 0 };
    var after = bfs(st, wc[0], wc[1], false);
    st.walls[cell] = null;
    if (after[idx(me.cx, me.cy)] < 0) return;   // would wall the fish off
    var r0 = 0, r1 = 0;
    for (var i = 0; i < before.length; i++) { if (before[i] >= 0) r0++; if (after[i] >= 0) r1++; }
    var z0 = 99, z1 = 99;
    st.zones.forEach(function (z) {
      var a = before[idx(z.x, z.y)], b = after[idx(z.x, z.y)];
      if (a >= 0) z0 = Math.min(z0, a);
      if (b >= 0) z1 = Math.min(z1, b);
    });
    var gain = (r0 - r1) + (w.air < 30 ? 3 * (Math.min(z1, 40) - Math.min(z0, 40)) : 0);
    if (gain >= L.wallGain) buildWall(st, me);
  }

  // Move towards (tx,ty) ignoring walls, lighting a firecracker on the wall
  // ahead. Returns a direction, -1 (wait for the explosion) or -2 (no way).
  function goThrough(st, me, tx, ty, L) {
    var dist = bfs(st, tx, ty, true), d = downhill(st, dist, me.cx, me.cy, true, tx, ty, L.horiz);
    if (d < 0) return -2;
    var w = st.walls[idx(me.cx + DX[d], me.cy + DY[d])];
    if (w) {
      if (w.fuse) { me.dir = d; return -1; }
      if (me.booms <= 0) return -2;
      me.dir = d; demolish(st, me);
      return -1;
    }
    return d;
  }

  // Like goThrough without a firecracker: swim along the through-walls path
  // and stop (facing it) at the first wall.
  function approachWall(st, me, tx, ty, L) {
    var dist = bfs(st, tx, ty, true), d = downhill(st, dist, me.cx, me.cy, true, tx, ty, L.horiz);
    if (d < 0) return -2;
    if (st.walls[idx(me.cx + DX[d], me.cy + DY[d])]) { me.dir = d; return -1; }
    return d;
  }

  // Worm (beginner, confirmed). Beginner: small loops near its corner while
  // the fish is far. Otherwise: the neighbour cell (or staying) that keeps
  // the fish far, plus, for the confirmed worm, the largest area it reaches
  // before the fish.
  var LOOP = [1, 2, 3, 0];
  function flee(st, me, fc, fd, L, brain) {
    var far = fd[idx(me.cx, me.cy)];
    if (far < 0) far = 99;
    if (L.wormLoop && far > L.wormLoop) {
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
      if (L.territory) s += territory(bfs(st, nx, ny, false), fd);
      if (df <= 1) s -= 500;
      if (d < 0) s -= 3;
      s += st.rng() * L.fleeNoise;
      if (s > bs) { bs = s; best = d; }
    }
    wormTools(st, me, fc, fd, far, L);
    return best;
  }

  // Worm walls and firecrackers (all levels): a buoy behind when the fish
  // follows at 2 to 4 cells, a firecracker on the wall ahead when cornered.
  function wormTools(st, me, fc, fd, far, L) {
    if (me.walls > 0 && far <= 4 && far >= 2 && (L.wallChance >= 1 || st.rng() < L.wallChance)) {
      var vx = fc[0] - me.cx, vy = fc[1] - me.cy;
      if (vx * DX[me.dir] + vy * DY[me.dir] < 0) buildWall(st, me);
    }
    if (me.booms > 0 && far <= 3) {
      var ax = me.cx + DX[me.dir], ay = me.cy + DY[me.dir];
      if (inside(ax, ay) && st.walls[idx(ax, ay)]) demolish(st, me);
    }
  }

  // Value of a position for the worm (worm on cell wi, fish on cell fi), used
  // by the 3-ply search: territory (cells the worm reaches first), distance to
  // the fish and bubble zones the worm reaches first.
  function searchCtx(st, airLow) {
    var cache = {};
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
      var md = dist(wi), s = df * 4 + territory(md, fd);
      // zones the worm reaches first are worth a lot when the air goes down
      zoneTargets(st, md).forEach(function (z) {
        if (z.d >= 0 && (fd[z.c] < 0 || z.d + 1 < fd[z.c])) s += airLow ? 30 - Math.min(z.d, 25) : 6;
      });
      return s;
    }
    return { dist: dist, moves: moves, leaf: leaf };
  }

  // Expert worm: 3-ply search. The worm picks a move, the fish answers with
  // the move that hurts the worm most, the worm picks its best second move.
  function fleeSearch(st, me, fc, fd0, L) {
    var S = searchCtx(st, me.air < 27), fi0 = idx(fc[0], fc[1]);
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
    var far = fd0[idx(me.cx, me.cy)];
    wormTools(st, me, fc, fd0, far < 0 ? 99 : far, L);
    return best;
  }

  var KevEngine = {
    COLS: COLS, ROWS: ROWS, DX: DX, DY: DY, CFG: CFG, NAMES: NAMES, LEVELS: LEVELS,
    newRound: newRound, step: step, pos: pos, nearCell: nearCell, destCell: destCell, fish: fish, worm: worm,
    buildWall: buildWall, demolish: demolish, matchResult: matchResult, roundMessage: roundMessage, roundText: roundText,
    elapsed: elapsed, secondsLeft: secondsLeft, newBrain: newBrain, aiThink: aiThink, bfs: bfs, idx: idx,
    downhill: downhill, mulberry32: mulberry32, territory: territory
  };
  root.KevEngine = KevEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = KevEngine;
})(typeof window !== 'undefined' ? window : this);
