// ELMANAGER engine: squad helpers (best XI, user lineup, needs) and world lookups.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const P = EM.Positions;

  const BENCH_SIZE = 7;
  const LINE_RANK = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

  // ---- world lookups ----------------------------------------------------------------
  // Any club that can hold players: domestic (LP + Primera Nacional) or foreign market club.
  function getClub(world, id) {
    if (world.clubs[id]) return world.clubs[id];
    for (let i = 0; i < world.foreignClubs.length; i++) {
      if (world.foreignClubs[i].id === id) return world.foreignClubs[i];
    }
    return null;
  }

  // -> { player, club } (club null for a free agent) or null.
  function findPlayer(world, playerId) {
    const ids = Object.keys(world.clubs);
    for (let i = 0; i < ids.length; i++) {
      const c = world.clubs[ids[i]];
      for (let j = 0; j < c.players.length; j++) if (c.players[j].id === playerId) return { player: c.players[j], club: c };
    }
    for (let i = 0; i < world.foreignClubs.length; i++) {
      const c = world.foreignClubs[i];
      for (let j = 0; j < c.players.length; j++) if (c.players[j].id === playerId) return { player: c.players[j], club: c };
    }
    for (let j = 0; j < world.freeAgents.length; j++) {
      if (world.freeAgents[j].id === playerId) return { player: world.freeAgents[j], club: null };
    }
    return null;
  }

  function removeFromSquad(club, playerId) {
    const i = club.players.findIndex(function (p) { return p.id === playerId; });
    return i >= 0 ? club.players.splice(i, 1)[0] : null;
  }

  // ---- XI selection ------------------------------------------------------------------
  function orderedSlots(formationName) {
    return P.slotsOf(formationName).map(function (s, i) { return { slot: s, i: i }; })
      .sort(function (a, b) {
        return (LINE_RANK[P.line(a.slot.type)] - LINE_RANK[P.line(b.slot.type)]) || (a.i - b.i);
      }).map(function (e) { return e.slot; });
  }

  function slotScore(player, slot) {
    return player.rating * P.fit(player.pos, slot.type);
  }

  function strengthOf(slotsMap, formationName) {
    const slots = P.slotsOf(formationName);
    let total = 0;
    slots.forEach(function (s) {
      const p = slotsMap[s.id];
      if (p) total += slotScore(p, s);
    });
    return total / slots.length;
  }

  // Greedy: GK first, then DEF, MID, FWD; each slot takes the best rating*fit available player.
  function bestXI(players, formationName) {
    let pool = players.filter(function (p) { return !(p.injury > 0); });
    if (pool.length < 11) pool = players.slice();
    const used = {};
    const slots = {};
    orderedSlots(formationName).forEach(function (slot) {
      let best = null;
      let bestScore = -1;
      pool.forEach(function (p) {
        if (used[p.id]) return;
        const s = slotScore(p, slot);
        if (s > bestScore) { bestScore = s; best = p; }
      });
      if (best) { used[best.id] = true; slots[slot.id] = best; }
    });
    return { slots: slots, formation: formationName, strength: strengthOf(slots, formationName) };
  }

  function xiList(slotsMap, formationName) {
    return P.slotsOf(formationName).map(function (s) { return slotsMap[s.id]; }).filter(Boolean);
  }

  // The user's XI: lineup starters, with injured/missing ones auto-replaced (bench first, then squad).
  function userXI(career, club) {
    const lineup = career.lineup;
    const formation = lineup.formation;
    const byId = {};
    club.players.forEach(function (p) { byId[p.id] = p; });
    const used = {};
    const slotsMap = {};
    const missing = [];
    const replaced = [];

    P.slotsOf(formation).forEach(function (slot) {
      const p = byId[lineup.slots[slot.id]];
      if (p && !(p.injury > 0) && !used[p.id]) { slotsMap[slot.id] = p; used[p.id] = true; }
      else missing.push({ slot: slot, out: p || null });
    });

    function bestFor(slot, candidates) {
      let best = null;
      let bestScore = -1;
      candidates.forEach(function (p) {
        if (!p || used[p.id] || p.injury > 0) return;
        const s = slotScore(p, slot);
        if (s > bestScore) { bestScore = s; best = p; }
      });
      return best;
    }

    const bench = (lineup.bench || []).map(function (id) { return byId[id]; });
    missing.forEach(function (m) {
      let pick = bestFor(m.slot, bench) || bestFor(m.slot, club.players);
      if (!pick) pick = club.players.filter(function (p) { return !used[p.id]; })[0] || null; // everyone hurt: play injured
      if (pick) {
        used[pick.id] = true;
        slotsMap[m.slot.id] = pick;
        replaced.push({ slotId: m.slot.id, out: m.out, in: pick });
      }
    });

    const mods = career.mods || {};
    return {
      xi: xiList(slotsMap, formation),
      slots: slotsMap,
      strength: strengthOf(slotsMap, formation) + (mods.total || 0),
      replaced: replaced
    };
  }

  // ---- lineup editing -------------------------------------------------------------------
  // Fills career.lineup with the best XI, a 7-player bench and a captain.
  function autoLineup(career, club, formationName) {
    const lineup = career.lineup;
    const formation = formationName || lineup.formation || '4-3-3';
    const xi = bestXI(club.players, formation);
    const slots = {};
    const used = {};
    Object.keys(xi.slots).forEach(function (k) { slots[k] = xi.slots[k].id; used[xi.slots[k].id] = true; });

    const rest = club.players.filter(function (p) { return !used[p.id] && !(p.injury > 0); })
      .sort(function (a, b) { return b.rating - a.rating; });
    const bench = [];
    const picked = {};
    function take(pred, n) {
      for (let i = 0; i < rest.length && n > 0; i++) {
        if (!picked[rest[i].id] && pred(rest[i])) { picked[rest[i].id] = true; bench.push(rest[i].id); n--; }
      }
    }
    take(function (p) { return p.pos === 'GK'; }, 1);
    ['DEF', 'MID', 'FWD'].forEach(function (ln) { take(function (p) { return P.line(p.pos) === ln; }, 2); });
    take(function () { return true; }, BENCH_SIZE - bench.length);

    let captainId = lineup.captainId;
    if (!captainId || !used[captainId]) {
      const starters = Object.keys(xi.slots).map(function (k) { return xi.slots[k]; });
      starters.sort(function (a, b) { return (b.rating + (b.age >= 26 ? 3 : 0)) - (a.rating + (a.age >= 26 ? 3 : 0)); });
      captainId = starters.length ? starters[0].id : null;
    }
    career.lineup = { formation: formation, slots: slots, bench: bench, captainId: captainId };
    return career.lineup;
  }

  // Puts a player in a slot; swaps with the previous occupant if he already starts elsewhere.
  function setSlot(lineup, slotId, playerId) {
    const old = lineup.slots[slotId] || null;
    Object.keys(lineup.slots).forEach(function (k) {
      if (lineup.slots[k] === playerId && k !== slotId) {
        if (old) lineup.slots[k] = old; else delete lineup.slots[k];
      }
    });
    const bi = lineup.bench.indexOf(playerId);
    if (bi >= 0) {
      if (old && old !== playerId) lineup.bench[bi] = old; else lineup.bench.splice(bi, 1);
    }
    lineup.slots[slotId] = playerId;
    return lineup;
  }

  // Moves a starter to the bench (or adds a squad player to it). False if the bench is full.
  function toBench(lineup, playerId) {
    Object.keys(lineup.slots).forEach(function (k) { if (lineup.slots[k] === playerId) delete lineup.slots[k]; });
    if (lineup.bench.indexOf(playerId) >= 0) return true;
    if (lineup.bench.length >= BENCH_SIZE) return false;
    lineup.bench.push(playerId);
    return true;
  }

  function removeFromBench(lineup, playerId) {
    lineup.bench = lineup.bench.filter(function (id) { return id !== playerId; });
  }

  // Drops ids of players who left the club.
  function cleanLineup(career, club) {
    const ids = {};
    club.players.forEach(function (p) { ids[p.id] = true; });
    const lineup = career.lineup;
    Object.keys(lineup.slots).forEach(function (k) { if (!ids[lineup.slots[k]]) delete lineup.slots[k]; });
    lineup.bench = lineup.bench.filter(function (id) { return ids[id]; });
    if (lineup.captainId && !ids[lineup.captainId]) lineup.captainId = null;
    return lineup;
  }

  // { complete, missingSlots, injuredStarters, captainOk } for the stored lineup (no auto-replacement).
  function checkLineup(career, club) {
    const byId = {};
    club.players.forEach(function (p) { byId[p.id] = p; });
    const lineup = career.lineup;
    const missingSlots = [];
    const injuredStarters = [];
    const seen = {};
    P.slotsOf(lineup.formation).forEach(function (slot) {
      const p = byId[lineup.slots[slot.id]];
      if (!p || seen[p.id]) missingSlots.push(slot.id);
      else { seen[p.id] = true; if (p.injury > 0) injuredStarters.push(p.id); }
    });
    return {
      complete: missingSlots.length === 0 && injuredStarters.length === 0,
      missingSlots: missingSlots,
      injuredStarters: injuredStarters,
      captainOk: !!(lineup.captainId && byId[lineup.captainId])
    };
  }

  // ---- squad analysis -----------------------------------------------------------------------
  const NEED_GROUPS = [
    { label: 'Arquero', min: 2, positions: ['GK'] },
    { label: 'Defensor central', min: 3, positions: ['CB'] },
    { label: 'Lateral izquierdo', min: 2, positions: ['LB', 'LWB'] },
    { label: 'Lateral derecho', min: 2, positions: ['RB', 'RWB'] },
    { label: 'Mediocampista', min: 4, positions: ['CDM', 'CM', 'CAM'] },
    { label: 'Extremo o delantero', min: 4, positions: ['LM', 'RM', 'LW', 'RW', 'ST', 'CF'] }
  ];

  function needs(club) {
    const out = [];
    const players = club.players;
    NEED_GROUPS.forEach(function (g) {
      const n = players.filter(function (p) { return g.positions.indexOf(p.pos) >= 0; }).length;
      if (n < g.min) {
        out.push(n === 0 ? 'Falta profundidad: no hay ' + g.label : 'Falta profundidad: solo ' + n + ' ' + g.label);
      }
    });
    const keepers = players.filter(function (p) { return p.pos === 'GK'; });
    if (keepers.length && U.avg(keepers, function (p) { return p.age; }) >= 33) out.push('Arqueros envejecidos');
    if (players.length && U.avg(players, function (p) { return p.age; }) >= 29.5) out.push('Plantel envejecido');
    if (players.length < 18) out.push('Plantel corto: faltan ' + (18 - players.length) + ' jugadores para llegar a 18');
    if (players.length > 32) out.push('Plantel excedido: sobran ' + (players.length - 32) + ' jugadores');
    return out;
  }

  function summary(club) {
    const players = club.players;
    return {
      count: players.length,
      avgRating: U.round1(U.avg(players, function (p) { return p.rating; })),
      avgAge: U.round1(U.avg(players, function (p) { return p.age; })),
      injured: players.filter(function (p) { return p.injury > 0; }).length
    };
  }

  EM.Squad = {
    BENCH_SIZE: BENCH_SIZE,
    getClub: getClub,
    findPlayer: findPlayer,
    removeFromSquad: removeFromSquad,
    bestXI: bestXI,
    xiList: xiList,
    userXI: userXI,
    autoLineup: autoLineup,
    setSlot: setSlot,
    toBench: toBench,
    removeFromBench: removeFromBench,
    cleanLineup: cleanLineup,
    checkLineup: checkLineup,
    needs: needs,
    summary: summary
  };
})(window.EM = window.EM || {});
