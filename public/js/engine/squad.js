// ELMANAGER engine: squad helpers (best XI, user lineup) and world lookups.
(function (EM) {
  'use strict';

  const P = EM.Positions;

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

  // -> { player, club } or null.
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

  // Best rating*fit player for a slot among `candidates`, skipping ids in `used`.
  function bestFor(slot, candidates, used) {
    let best = null;
    let bestScore = -1;
    candidates.forEach(function (p) {
      if (used[p.id]) return;
      const s = slotScore(p, slot);
      if (s > bestScore) { bestScore = s; best = p; }
    });
    return best;
  }

  // Greedy: GK first, then DEF, MID, FWD; each slot takes the best rating*fit available player.
  function bestXI(players, formationName) {
    const used = {};
    const slots = {};
    orderedSlots(formationName).forEach(function (slot) {
      const best = bestFor(slot, players, used);
      if (best) { used[best.id] = true; slots[slot.id] = best; }
    });
    return { slots: slots, formation: formationName, strength: strengthOf(slots, formationName) };
  }

  function xiList(slotsMap, formationName) {
    return P.slotsOf(formationName).map(function (s) { return slotsMap[s.id]; }).filter(Boolean);
  }

  // The user's XI: lineup starters; any slot left empty (player gone) is filled with the best available.
  function userXI(career, club) {
    const lineup = career.lineup;
    const formation = lineup.formation;
    const byId = {};
    club.players.forEach(function (p) { byId[p.id] = p; });
    const used = {};
    const slotsMap = {};
    const missing = [];

    P.slotsOf(formation).forEach(function (slot) {
      const p = byId[lineup.slots[slot.id]];
      if (p && !used[p.id]) { slotsMap[slot.id] = p; used[p.id] = true; }
      else missing.push(slot);
    });
    missing.forEach(function (slot) {
      const pick = bestFor(slot, club.players, used);
      if (pick) { used[pick.id] = true; slotsMap[slot.id] = pick; }
    });

    const mods = career.mods || {};
    return {
      xi: xiList(slotsMap, formation),
      slots: slotsMap,
      strength: strengthOf(slotsMap, formation) + (mods.total || 0)
    };
  }

  // ---- lineup editing -------------------------------------------------------------------
  // Puts a player in a slot; swaps with the previous occupant if he already starts elsewhere.
  function setSlot(lineup, slotId, playerId) {
    const old = lineup.slots[slotId] || null;
    Object.keys(lineup.slots).forEach(function (k) {
      if (lineup.slots[k] === playerId && k !== slotId) {
        if (old) lineup.slots[k] = old; else delete lineup.slots[k];
      }
    });
    lineup.slots[slotId] = playerId;
    return lineup;
  }

  // Fills only the empty slots with the best players left.
  function fillEmpty(career, club) {
    const lineup = career.lineup;
    const used = {};
    Object.keys(lineup.slots).forEach(function (k) { used[lineup.slots[k]] = true; });
    orderedSlots(lineup.formation).forEach(function (slot) {
      if (lineup.slots[slot.id]) return;
      const pick = bestFor(slot, club.players, used);
      if (pick) { used[pick.id] = true; lineup.slots[slot.id] = pick.id; }
    });
    return lineup;
  }

  // Drops ids of players who left the club.
  function cleanLineup(career, club) {
    const ids = {};
    club.players.forEach(function (p) { ids[p.id] = true; });
    const lineup = career.lineup;
    Object.keys(lineup.slots).forEach(function (k) { if (!ids[lineup.slots[k]]) delete lineup.slots[k]; });
    return lineup;
  }

  // True when every slot of the stored lineup holds a distinct squad player.
  function isComplete(career, club) {
    const byId = {};
    club.players.forEach(function (p) { byId[p.id] = true; });
    const lineup = career.lineup;
    const seen = {};
    return P.slotsOf(lineup.formation).every(function (slot) {
      const id = lineup.slots[slot.id];
      if (!id || !byId[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  EM.Squad = {
    getClub: getClub,
    findPlayer: findPlayer,
    removeFromSquad: removeFromSquad,
    bestXI: bestXI,
    xiList: xiList,
    userXI: userXI,
    setSlot: setSlot,
    fillEmpty: fillEmpty,
    cleanLineup: cleanLineup,
    isComplete: isComplete
  };
})(window.EM = window.EM || {});
