// ELMANAGER engine: continental cups (Libertadores, Sudamericana) and Copa Argentina.
// Cup objects are plain JSON. Teams are referenced by id: domestic clubs live in world.clubs,
// foreign / strength-only teams live in world.cupTeams.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const L = EM.League;

  // ---- stages -----------------------------------------------------------------------------------
  const CONT_STAGES = ['Fase 2', 'Fase de grupos', 'Playoffs', 'Octavos de final', 'Cuartos de final', 'Semifinales', 'Final', 'Campeón'];
  const CA_STAGES = ['32avos de final', '16avos de final', 'Octavos de final', 'Cuartos de final', 'Semifinales', 'Final', 'Campeón'];

  function stageRank(cup, stage) {
    const list = cup.kind === 'copaArgentina' ? CA_STAGES : CONT_STAGES;
    const i = list.indexOf(stage);
    return i < 0 ? -1 : i;
  }

  // Continental knockout rounds: name of the stage reached when playing it and the stage after winning it.
  const CONT_ROUNDS = {
    fase2: { stage: 'Fase 2', next: 'Fase de grupos', legs: 2 },
    playoffs: { stage: 'Playoffs', next: 'Octavos de final', legs: 2 },
    octavos: { stage: 'Octavos de final', next: 'Cuartos de final', legs: 2 },
    cuartos: { stage: 'Cuartos de final', next: 'Semifinales', legs: 2 },
    semis: { stage: 'Semifinales', next: 'Final', legs: 2 },
    final: { stage: 'Final', next: 'Campeón', legs: 1 }
  };
  const CA_ROUNDS = {
    r32: { stage: '32avos de final', next: '16avos de final', legs: 1 },
    r16: { stage: '16avos de final', next: 'Octavos de final', legs: 1 },
    r8: { stage: 'Octavos de final', next: 'Cuartos de final', legs: 1 },
    r4: { stage: 'Cuartos de final', next: 'Semifinales', legs: 1 },
    r2: { stage: 'Semifinales', next: 'Final', legs: 1 },
    r1: { stage: 'Final', next: 'Campeón', legs: 1 }
  };
  const CA_ORDER = ['r32', 'r16', 'r8', 'r4', 'r2', 'r1'];
  const CONT_ORDER = ['octavos', 'cuartos', 'semis', 'final'];

  function roundsOf(cup) { return cup.kind === 'copaArgentina' ? CA_ROUNDS : CONT_ROUNDS; }

  // Group fixtures per fecha as [homeIdx, awayIdx]; fechas 4-6 mirror 1-3.
  const GROUP_FECHAS = [
    [[0, 1], [2, 3]], [[3, 0], [1, 2]], [[0, 2], [1, 3]],
    [[1, 0], [3, 2]], [[0, 3], [2, 1]], [[2, 0], [3, 1]]
  ];
  const OCTAVOS_SEEDS = [[1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]];
  const GROUP_LETTERS = 'ABCDEFGH';

  // Game parameter (not real data): strength of a Fase 2 rival by market tier.
  const FASE2_RIVAL_STRENGTH = { 1: 70, 2: 66, 3: 62 };
  const FASE2_RIVAL_COUNTRY = 'uy';

  // ---- team lookups ------------------------------------------------------------------------------------
  function formationFor(id) { return U.hash01(id) < 0.5 ? '4-3-3' : '4-4-2'; }

  // Strength of an AI-controlled team (best XI of the current squad, or the stored value).
  function strengthOf(world, id) {
    const club = world.clubs[id];
    if (club) return EM.Squad.bestXI(club.players, formationFor(id)).strength;
    return world.cupTeams[id] ? world.cupTeams[id].strength : 55;
  }

  function teamInfo(world, id) {
    const club = world.clubs[id];
    if (club) {
      return { id: id, name: club.name, shortName: club.shortName, colors: club.colors, country: 'ar', domestic: true };
    }
    const t = world.cupTeams[id];
    return { id: id, name: t.name, shortName: t.shortName, colors: t.colors, country: t.country, domestic: false, ascenso: !!t.ascenso };
  }

  function nameOf(world, id) { return teamInfo(world, id).name; }

  // Foreign / strength-only teams drift a little every season.
  function drift(world, rng) {
    Object.keys(world.cupTeams).forEach(function (id) {
      const t = world.cupTeams[id];
      if (t.ascenso) return;
      t.strength = U.round1(U.clamp(t.strength + rng.float(-1.5, 1.5), 55, 80));
    });
  }

  // ---- ties -------------------------------------------------------------------------------------------------
  // teams[0] hosts leg 1 and teams[1] hosts leg 2 (single-leg ties: teams[0] listed first).
  function newTie(id, teams, neutral) {
    return { id: id, teams: teams, neutral: !!neutral, legs: [], winner: null, pens: null };
  }

  function tieHost(tie, leg) { return tie.teams[(leg - 1) % 2]; }

  // ---- continental cups ------------------------------------------------------------------------------------------
  function emptyKo() { return { fase2: [], playoffs: [], octavos: [], cuartos: [], semis: [], final: [] }; }

  // Draw: 4 pots by strength, one team per pot in each group, avoiding same-country groups.
  function drawGroups(pots, countryOf, rng) {
    let best = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const groups = [[], [], [], [], [], [], [], []];
      let conflicts = 0;
      pots.forEach(function (pot, pi) {
        const order = rng.shuffle(pot.slice());
        const taken = {};
        order.forEach(function (id) {
          const open = [];
          groups.forEach(function (g, gi) { if (!taken[gi]) open.push(gi); });
          const clean = open.filter(function (gi) {
            return groups[gi].every(function (o) { return countryOf(o) !== countryOf(id); });
          });
          const pick = rng.pick(clean.length ? clean : open);
          if (!clean.length) conflicts++;
          taken[pick] = true;
          groups[pick].push(id);
        });
      });
      if (!best || conflicts < best.conflicts) best = { groups: groups, conflicts: conflicts };
      if (conflicts === 0) break;
    }
    return best.groups;
  }

  // teamIds: 32 ids. opts.slotTeam: id whose slot is contested in the Fase 2 (counts as Argentine for the draw).
  function buildContinental(world, key, name, teamIds, rng, opts) {
    const o = opts || {};
    const strength = {};
    teamIds.forEach(function (id) { strength[id] = strengthOf(world, id); });
    const sorted = teamIds.slice().sort(function (a, b) { return strength[b] - strength[a] || (a < b ? -1 : 1); });
    const pots = [0, 1, 2, 3].map(function (i) { return sorted.slice(i * 8, i * 8 + 8); });
    const countryOf = function (id) { return id === o.slotTeam ? 'ar' : teamInfo(world, id).country; };
    const drawn = drawGroups(pots, countryOf, rng);

    const cup = {
      key: key, name: name, kind: 'continental',
      teams: teamIds.slice(),
      groups: drawn.map(function (ids, gi) {
        const table = {};
        ids.forEach(function (id) { table[id] = L.newRow(id, GROUP_LETTERS[gi], nameOf(world, id)); });
        return { name: 'Grupo ' + GROUP_LETTERS[gi], teamIds: ids, table: table };
      }),
      stage: {}, out: {}, seed: {}, seedInfo: {},
      ko: emptyKo(),
      guests: [],          // Libertadores third places that drop into the Sudamericana playoffs
      groupsDone: false, groupsPlayed: 0,
      champion: null, runnerUp: null, done: false
    };
    teamIds.forEach(function (id) { cup.stage[id] = 'Fase de grupos'; });
    return cup;
  }

  // Libertadores: 5 direct Argentine clubs + 26 foreign teams + 1 slot. From the second season on the
  // sixth Argentine qualifier plays a two-leg Fase 2 against a Uruguayan club outside the group pool
  // (the data has no Fase 2 participants, so the rival is a market club; parameters are game values).
  function buildLibertadores(world, rng) {
    const q = world.qualified;
    const foreign = world.cupPools.libertadores.slice();
    const arg6 = q.libertadoresRepechaje;
    const direct = q.libertadores.filter(function (id) { return id !== arg6; });
    let rival = null;
    if (arg6) {
      const cands = world.foreignClubs.filter(function (c) {
        return c.region === 'Uruguay' && !world.cupTeams[c.id];
      }).sort(function (a, b) { return (b.tier - a.tier) || (a.id < b.id ? -1 : 1); });
      if (cands.length) {
        const c = cands[cands.length - 1 - rng.int(0, Math.min(3, cands.length - 1))];
        world.cupTeams[c.id] = { id: c.id, name: c.name, shortName: c.shortName, colors: c.colors, country: FASE2_RIVAL_COUNTRY, strength: FASE2_RIVAL_STRENGTH[c.tier] || 62 };
        rival = c.id;
      }
    }
    // Without a rival the sixth club simply takes the slot.
    const ids = direct.concat(foreign).concat(arg6 ? [arg6] : []);
    const cup = buildContinental(world, 'libertadores', 'Copa Libertadores', ids, rng, { slotTeam: rival ? arg6 : null });
    if (rival) {
      cup.stage[arg6] = 'Fase 2';
      cup.stage[rival] = 'Fase 2';
      cup.ko.fase2 = [newTie('lib-fase2-0', [arg6, rival], false)];
      cup.slot = { arg: arg6, rival: rival };
    }
    return cup;
  }

  function buildSudamericana(world, rng) {
    const ids = world.qualified.sudamericana.concat(world.cupPools.sudamericana);
    return buildContinental(world, 'sudamericana', 'Copa Sudamericana', ids, rng, {});
  }

  function groupOf(cup, id) {
    for (let i = 0; i < cup.groups.length; i++) if (cup.groups[i].teamIds.indexOf(id) >= 0) return cup.groups[i];
    return null;
  }

  // Specs of the group matches of one fecha (1-6).
  function groupSpecs(cup, fecha) {
    const specs = [];
    cup.groups.forEach(function (g) {
      GROUP_FECHAS[fecha - 1].forEach(function (p) {
        specs.push({ home: g.teamIds[p[0]], away: g.teamIds[p[1]], group: g.name, neutral: false });
      });
    });
    return specs;
  }

  function rankedGroup(group) { return L.sortRows(Object.keys(group.table).map(function (id) { return group.table[id]; })); }

  function seedRows(rows) {
    return rows.slice().sort(function (a, b) {
      return (b.points - a.points) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf) || (a.clubId < b.clubId ? -1 : 1);
    });
  }

  // Called once every group has played its 6 fechas.
  function closeGroups(cup) {
    cup.groupsDone = true;
    const winners = [];
    const runners = [];
    const thirds = [];
    cup.groups.forEach(function (g) {
      const r = rankedGroup(g);
      winners.push(r[0]); runners.push(r[1]); thirds.push(r[2]);
      r.slice(3).forEach(function (row) { cup.out[row.clubId] = true; });
    });
    function info(row, cat) { cup.seedInfo[row.clubId] = { points: row.points, gd: row.gf - row.ga, gf: row.gf, cat: cat }; }
    winners.forEach(function (r) { cup.stage[r.clubId] = 'Octavos de final'; info(r, 1); });
    if (cup.key === 'libertadores') {
      runners.forEach(function (r) { cup.stage[r.clubId] = 'Octavos de final'; info(r, 2); });
      cup.thirdRows = thirds.map(function (r) { return { clubId: r.clubId, points: r.points, gd: r.gf - r.ga, gf: r.gf }; });
      thirds.forEach(function (r) { cup.out[r.clubId] = true; });
    } else {
      runners.forEach(function (r) { cup.stage[r.clubId] = 'Playoffs'; info(r, 2); });
      thirds.forEach(function (r) { cup.out[r.clubId] = true; });
    }
  }

  // Once both group stages are over, the Libertadores thirds face the Sudamericana runners-up.
  function buildSudPlayoffs(lib, sud) {
    if (sud.ko.playoffs.length || !lib.groupsDone || !sud.groupsDone) return;
    const cmp = function (a, b) { return (b.points - a.points) || (b.gd - a.gd) || (b.gf - a.gf) || (a.id < b.id ? -1 : 1); };
    const runners = Object.keys(sud.seedInfo).filter(function (id) { return sud.seedInfo[id].cat === 2; })
      .map(function (id) { return Object.assign({ id: id }, sud.seedInfo[id]); }).sort(cmp);
    const thirds = lib.thirdRows.map(function (r) { return { id: r.clubId, points: r.points, gd: r.gd, gf: r.gf }; }).sort(cmp);
    sud.guests = thirds.map(function (t) { return t.id; });
    thirds.forEach(function (t) {
      sud.stage[t.id] = 'Playoffs';
      sud.seedInfo[t.id] = { points: t.points, gd: t.gd, gf: t.gf, cat: 2 };
    });
    // Best runner-up meets the worst third; the seeded side hosts the second leg.
    for (let i = 0; i < runners.length; i++) {
      const third = thirds[thirds.length - 1 - i];
      sud.ko.playoffs.push(newTie('sud-playoffs-' + i, [third.id, runners[i].id], false));
    }
  }

  // Builds the ties of a knockout round from the previous round (lazy, called when the round starts).
  function buildRound(cup, round) {
    if (cup.ko[round].length) return;
    if (cup.kind === 'copaArgentina' || round === 'fase2' || round === 'playoffs') return; // built elsewhere
    if (round === 'octavos') {
      const all = Object.keys(cup.seedInfo).filter(function (id) {
        return cup.stage[id] === 'Octavos de final' && !cup.out[id];
      }).map(function (id) { return Object.assign({ id: id }, cup.seedInfo[id]); });
      const cmp = function (a, b) { return (b.points - a.points) || (b.gd - a.gd) || (b.gf - a.gf) || (a.id < b.id ? -1 : 1); };
      const first = all.filter(function (t) { return t.cat === 1; }).sort(cmp);
      const second = all.filter(function (t) { return t.cat === 2; }).sort(cmp);
      const seeded = first.concat(second);
      seeded.forEach(function (t, i) { cup.seed[t.id] = i + 1; });
      OCTAVOS_SEEDS.forEach(function (pair, i) {
        // First leg at the worse seed.
        cup.ko.octavos.push(newTie('oct-' + cup.key + '-' + i, [seeded[pair[1] - 1].id, seeded[pair[0] - 1].id], false));
      });
    } else {
      const prev = CONT_ORDER[CONT_ORDER.indexOf(round) - 1];
      const ties = cup.ko[prev];
      for (let i = 0; i < ties.length; i += 2) {
        const a = ties[i].winner;
        const b = ties[i + 1].winner;
        const teams = round === 'final' ? [a, b] : (cup.seed[a] > cup.seed[b] ? [a, b] : [b, a]);
        cup.ko[round].push(newTie(round + '-' + cup.key + '-' + (i / 2), teams, round === 'final'));
      }
    }
    cup.ko[round].forEach(function (t) {
      t.teams.forEach(function (id) { cup.stage[id] = CONT_ROUNDS[round].stage; });
    });
  }

  // ---- Copa Argentina --------------------------------------------------------------------------------------------
  // 64 teams, single match on neutral ground. Entrants: the 30 LP clubs plus 34 ascenso teams
  // (Primera Nacional clubs with squads first, then strength-only teams from the data, strongest first).
  function buildCopaArgentina(world, rng) {
    const lp = world.leagueIds.slice();
    const pn = Object.keys(world.clubs).filter(function (id) { return world.clubs[id].division === 'PN'; });
    const only = Object.keys(world.cupTeams).filter(function (id) { return world.cupTeams[id].ascenso; })
      .sort(function (a, b) { return world.cupTeams[b].strength - world.cupTeams[a].strength; });
    const ascenso = pn.concat(only).slice(0, 64 - lp.length);
    const total = lp.length + ascenso.length;
    const byeCount = Math.max(0, 64 - total);

    const cup = {
      key: 'copaArgentina', name: 'Copa Argentina', kind: 'copaArgentina',
      teams: lp.concat(ascenso), ascenso: ascenso.slice(),
      stage: {}, out: {}, ko: { r32: [], r16: [], r8: [], r4: [], r2: [], r1: [] },
      champion: null, runnerUp: null, done: false
    };

    // Missing ascenso teams (data not available) are covered with byes for the strongest clubs.
    const byStrength = lp.slice().sort(function (a, b) { return strengthOf(world, b) - strengthOf(world, a); });
    const byes = byStrength.slice(0, byeCount);
    const lpPool = rng.shuffle(lp.filter(function (id) { return byes.indexOf(id) < 0; }));
    const ascPool = rng.shuffle(ascenso.slice());
    const pairs = [];
    while (lpPool.length && ascPool.length) pairs.push([lpPool.pop(), ascPool.pop()]);
    while (lpPool.length > 1) pairs.push([lpPool.pop(), lpPool.pop()]);
    while (ascPool.length > 1) pairs.push([ascPool.pop(), ascPool.pop()]);
    const ties = pairs.map(function (p, i) { return newTie('ca-r32-' + i, p, true); });
    byes.forEach(function (id, i) {
      const t = newTie('ca-r32-bye-' + i, [id], true);
      t.bye = true; t.winner = id;
      ties.push(t);
    });
    rng.shuffle(ties);
    ties.forEach(function (t, i) { t.id = 'ca-r32-' + i; });
    cup.ko.r32 = ties;
    ties.forEach(function (t) {
      t.teams.forEach(function (id) { cup.stage[id] = t.bye ? CA_ROUNDS.r32.next : CA_ROUNDS.r32.stage; });
    });
    return cup;
  }

  // Builds the next Copa Argentina round from the winners of the previous one.
  function buildCaRound(cup, round) {
    if (cup.ko[round].length) return;
    const prev = CA_ORDER[CA_ORDER.indexOf(round) - 1];
    const ties = cup.ko[prev];
    for (let i = 0; i < ties.length; i += 2) {
      cup.ko[round].push(newTie('ca-' + round + '-' + (i / 2), [ties[i].winner, ties[i + 1].winner], true));
    }
    cup.ko[round].forEach(function (t) { t.teams.forEach(function (id) { cup.stage[id] = CA_ROUNDS[round].stage; }); });
  }

  // ---- season entry -----------------------------------------------------------------------------------------------------
  function buildSeasonCups(world, rng) {
    return {
      libertadores: buildLibertadores(world, rng),
      sudamericana: buildSudamericana(world, rng),
      copaArgentina: buildCopaArgentina(world, rng)
    };
  }

  // ---- matchday resolution ---------------------------------------------------------------------------------------
  // Match specs for a calendar entry of a cup: { home, away, neutral, tieId?, leg?, round?, group? }.
  function matchSpecs(cup, md) {
    if (md.stage === 'grupos') return groupSpecs(cup, md.fecha);
    const round = md.round;
    if (cup.kind === 'copaArgentina') buildCaRound(cup, round);
    else buildRound(cup, round);
    const specs = [];
    cup.ko[round].forEach(function (t) {
      if (t.bye || t.winner) return;
      const leg = md.leg || 1;
      specs.push({
        home: cup.kind === 'copaArgentina' ? t.teams[0] : tieHost(t, leg),
        away: cup.kind === 'copaArgentina' ? t.teams[1] : tieHost(t, leg === 1 ? 2 : 1),
        neutral: t.neutral, tieId: t.id, leg: leg, round: round
      });
    });
    return specs;
  }

  // Marks a knockout tie as decided and moves the teams along.
  function decideTie(cup, round, tie, winner) {
    tie.winner = winner;
    const loser = tie.teams[0] === winner ? tie.teams[1] : tie.teams[0];
    const info = roundsOf(cup)[round];
    cup.stage[winner] = info.next;
    if (loser) cup.out[loser] = true;
    if (round === 'final' || round === 'r1') {
      cup.champion = winner;
      cup.runnerUp = loser;
      cup.done = true;
      cup.stage[winner] = 'Campeón';
      cup.stage[loser] = 'Final';
    }
    return loser;
  }

  function applyRepechaje(world, cup, tie) {
    const arg = cup.slot.arg;
    const rival = cup.slot.rival;
    if (tie.winner === arg) {
      cup.out[rival] = true;
      return;
    }
    // The rival takes the group slot of the sixth Argentine club.
    const g = groupOf(cup, arg);
    const idx = g.teamIds.indexOf(arg);
    g.teamIds[idx] = rival;
    delete g.table[arg];
    g.table[rival] = L.newRow(rival, g.name.slice(-1), nameOf(world, rival));
    const ti = cup.teams.indexOf(arg);
    if (ti >= 0) cup.teams[ti] = rival;
    cup.stage[rival] = 'Fase de grupos';
    delete cup.out[rival];
    cup.out[arg] = true;
    cup.stage[arg] = 'Fase 2';
  }

  // Records a played match into the cup. strengthFn(id) feeds tie-break penalties.
  // Returns { tie, decided, winner, loser } for knockout matches, {} for group matches.
  function recordMatch(world, cup, match, rng, strengthFn) {
    if (match.group) {
      const g = cup.groups.filter(function (x) { return x.name === match.group; })[0];
      L.applyResult(g.table[match.home], match.hg, match.ag);
      L.applyResult(g.table[match.away], match.ag, match.hg);
      cup.groupsPlayed++;
      if (cup.groupsPlayed === cup.groups.length * 12 && !cup.groupsDone) closeGroups(cup);
      return {};
    }
    const round = match.round;
    const tie = cup.ko[round].filter(function (t) { return t.id === match.tieId; })[0];
    const info = roundsOf(cup)[round];
    tie.legs[match.leg - 1] = { hg: match.hg, ag: match.ag };
    let winner = null;
    if (info.legs === 1) {
      winner = match.hg > match.ag ? match.home : (match.ag > match.hg ? match.away : (match.pens.h > match.pens.a ? match.home : match.away));
      if (match.pens) tie.pens = {};
      if (match.pens) { tie.pens[match.home] = match.pens.h; tie.pens[match.away] = match.pens.a; }
    } else if (match.leg === 2) {
      const l1 = tie.legs[0];
      const l2 = tie.legs[1];
      const g0 = l1.hg + l2.ag; // teams[0] hosted leg 1
      const g1 = l1.ag + l2.hg;
      if (g0 !== g1) winner = g0 > g1 ? tie.teams[0] : tie.teams[1];
      else {
        // No away goals rule: aggregate draw goes to penalties after leg 2 (host of leg 2 = teams[1]).
        const pens = EM.Match.penalties(rng, strengthFn(tie.teams[1]), strengthFn(tie.teams[0]));
        match.pens = pens;
        tie.pens = {};
        tie.pens[tie.teams[1]] = pens.h;
        tie.pens[tie.teams[0]] = pens.a;
        winner = pens.h > pens.a ? tie.teams[1] : tie.teams[0];
      }
    }
    if (!winner) return { tie: tie, decided: false };
    const loser = decideTie(cup, round, tie, winner);
    if (round === 'fase2') applyRepechaje(world, cup, tie);
    return { tie: tie, decided: true, winner: winner, loser: loser, round: round };
  }

  EM.Cups = {
    CONT_STAGES: CONT_STAGES,
    CA_STAGES: CA_STAGES,
    CONT_ROUNDS: CONT_ROUNDS,
    CA_ROUNDS: CA_ROUNDS,
    stageRank: stageRank,
    formationFor: formationFor,
    strengthOf: strengthOf,
    teamInfo: teamInfo,
    drift: drift,
    groupOf: groupOf,
    rankedGroup: rankedGroup,
    buildContinental: buildContinental,
    buildSeasonCups: buildSeasonCups,
    buildCopaArgentina: buildCopaArgentina,
    buildSudPlayoffs: buildSudPlayoffs,
    matchSpecs: matchSpecs,
    recordMatch: recordMatch,
    tieHost: tieHost
  };
})(window.EM = window.EM || {});
