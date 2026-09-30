// ELMANAGER engine: season calendar and match-day simulation (the whole season runs in one call).
// A season is plain JSON: torneos (Apertura, Clausura), cups, and a date-sorted calendar of match days.
// Knockout match days resolve their matches lazily, when every earlier match day has been played.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const L = EM.League;
  const C = EM.Cups;

  const COMP_NAMES = {
    apertura: 'Apertura', clausura: 'Clausura', libertadores: 'Libertadores',
    sudamericana: 'Sudamericana', copaArgentina: 'Copa Argentina'
  };
  const CUP_KEYS = ['libertadores', 'sudamericana', 'copaArgentina'];

  // Prize money is a game parameter (not real data), in USD millions, paid when a stage is reached.
  const STAGE_PRIZES = {
    libertadores: { 'Fase de grupos': 3, 'Octavos de final': 1.5, 'Cuartos de final': 2, 'Semifinales': 2.5 },
    sudamericana: { 'Fase de grupos': 1, 'Octavos de final': 0.6, 'Cuartos de final': 0.8, 'Semifinales': 1 },
    copaArgentina: { 'Octavos de final': 0.3, 'Cuartos de final': 0.5, 'Semifinales': 0.8 }
  };
  const TITLE_PRIZES = {
    libertadores: { champion: 6, runnerUp: 3 },
    sudamericana: { champion: 3, runnerUp: 1.5 },
    copaArgentina: { champion: 2, runnerUp: 0 },
    torneo: { champion: 3, runnerUp: 1 }
  };
  const SHORT_ROUND = {
    fase2: 'Fase 2', playoffs: 'Playoffs', octavos: 'Octavos', cuartos: 'Cuartos', semis: 'Semifinales', final: 'Final',
    r32: '32avos', r16: '16avos', r8: 'Octavos', r4: 'Cuartos', r2: 'Semifinales', r1: 'Final'
  };

  // ---- calendar ------------------------------------------------------------------------------------
  function newMatch(season, comp, home, away, extra) {
    season.seq += 1;
    const m = {
      id: season.year + '-m' + season.seq, comp: comp, home: home, away: away,
      hg: null, ag: null, pens: null, events: [], played: false
    };
    return Object.assign(m, extra || {});
  }

  function newMatchday(date, comp, stage, label, extra) {
    return Object.assign({ id: '', date: date, comp: comp, stage: stage, label: label, matches: null, played: false }, extra || {});
  }

  function leagueMatchdays(season, torneo) {
    const year = season.year;
    const isAp = torneo.key === 'apertura';
    const first = isAp ? U.onOrAfter(year, 1, 23, 6) : U.onOrAfter(year, 7, 10, 6);
    const name = COMP_NAMES[torneo.key];
    const out = [];
    torneo.rounds.forEach(function (round, i) {
      const md = newMatchday(U.addDays(first, 7 * i), torneo.key, 'regular', name + ' · Fecha ' + (i + 1), { fecha: i + 1 });
      md.matches = round.map(function (f) { return newMatch(season, torneo.key, f.home, f.away, { fecha: i + 1, interzonal: !!f.interzonal }); });
      out.push(md);
    });
    const lastSat = U.addDays(first, 7 * (torneo.rounds.length - 1));
    L.PLAYOFF_STAGES.forEach(function (st, i) {
      out.push(newMatchday(U.addDays(lastSat, 8 + 7 * i), torneo.key, 'playoffs', name + ' · ' + L.STAGE_NAMES[st], { round: st }));
    });
    return out;
  }

  function wed(year, m, d) { return U.onOrAfter(year, m, d, 3); }
  function sat(year, m, d) { return U.onOrAfter(year, m, d, 6); }

  function continentalMatchdays(season, cup) {
    const y = season.year;
    const name = COMP_NAMES[cup.key];
    const out = [];
    const isLib = cup.key === 'libertadores';
    if (cup.ko.fase2.length) {
      [[2, 9, 'ida', 1], [2, 16, 'vuelta', 2]].forEach(function (p) {
        out.push(newMatchday(wed(y, p[0], p[1]), cup.key, 'ko', name + ' · Fase 2 (' + p[2] + ')', { round: 'fase2', leg: p[3] }));
      });
    }
    [[3, 3], [3, 17], [4, 7], [4, 28], [5, 12], [5, 19]].forEach(function (p, i) {
      out.push(newMatchday(wed(y, p[0], p[1]), cup.key, 'grupos', name + ' · Grupos F' + (i + 1), { fecha: i + 1 }));
    });
    const legs = [
      ['playoffs', [7, 14], [7, 21]], ['octavos', [8, 11], [8, 18]], ['cuartos', [9, 15], [9, 22]], ['semis', [10, 13], [10, 20]]
    ];
    legs.forEach(function (r) {
      if (isLib && r[0] === 'playoffs') return;
      out.push(newMatchday(wed(y, r[1][0], r[1][1]), cup.key, 'ko', name + ' · ' + SHORT_ROUND[r[0]] + ' (ida)', { round: r[0], leg: 1 }));
      out.push(newMatchday(wed(y, r[2][0], r[2][1]), cup.key, 'ko', name + ' · ' + SHORT_ROUND[r[0]] + ' (vuelta)', { round: r[0], leg: 2 }));
    });
    out.push(newMatchday(isLib ? sat(y, 11, 27) : sat(y, 11, 20), cup.key, 'ko', name + ' · Final', { round: 'final', leg: 1 }));
    return out;
  }

  function copaArgentinaMatchdays(season) {
    const y = season.year;
    const dates = [[2, 24], [4, 21], [6, 16], [8, 25], [10, 6], [11, 10]];
    return ['r32', 'r16', 'r8', 'r4', 'r2', 'r1'].map(function (r, i) {
      return newMatchday(wed(y, dates[i][0], dates[i][1]), 'copaArgentina', 'ko', 'Copa Argentina · ' + SHORT_ROUND[r], { round: r });
    });
  }

  // Everything for one year: torneos, cups and the sorted calendar.
  function createSeason(world, career, rng) {
    const fixtureSeed = rng.int(1, 2147483646); // same seed so the Clausura mirrors the Apertura
    const nameFn = function (id) { return world.clubs[id].name; };
    const season = {
      year: career.year,
      userClubId: career.clubId,
      seq: 0,
      torneos: {
        apertura: L.buildTorneo('apertura', 'Apertura', world.zones, U.createRng(fixtureSeed), false, nameFn),
        clausura: L.buildTorneo('clausura', 'Clausura', world.zones, U.createRng(fixtureSeed), true, nameFn)
      },
      cups: C.buildSeasonCups(world, rng),
      calendar: [],
      scorers: {},
      paid: {},
      userCups: []
    };
    let cal = [];
    cal = cal.concat(leagueMatchdays(season, season.torneos.apertura));
    cal = cal.concat(leagueMatchdays(season, season.torneos.clausura));
    cal = cal.concat(continentalMatchdays(season, season.cups.libertadores));
    cal = cal.concat(continentalMatchdays(season, season.cups.sudamericana));
    cal = cal.concat(copaArgentinaMatchdays(season));
    season.calendar = cal.map(function (md, i) { md.order = i; return md; })
      .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : a.order - b.order); });
    season.calendar.forEach(function (md, i) { md.id = 'md' + (i + 1); delete md.order; });

    ['libertadores', 'sudamericana'].forEach(function (k) {
      if (season.cups[k].teams.indexOf(career.clubId) >= 0) season.userCups.push(k);
    });
    return season;
  }

  // ---- lookups ---------------------------------------------------------------------------------------
  function isSeasonOver(season) {
    return season.calendar.every(function (md) { return md.played; });
  }

  // ---- resolution of lazily built match days --------------------------------------------------------
  function tieMatches(season, torneo, comp, ties) {
    return ties.filter(function (t) { return !t.winner; }).map(function (t) {
      return newMatch(season, comp, t.home, t.away, { neutral: t.neutral, knockout: true, tieId: t.id });
    });
  }

  function resolveMatchday(ctx, md) {
    if (md.matches) return md.matches;
    const season = ctx.season;
    if (md.comp === 'apertura' || md.comp === 'clausura') {
      const torneo = season.torneos[md.comp];
      if (md.round === 'octavos') L.buildPlayoffs(torneo);
      else L.nextPlayoffRound(torneo);
      md.matches = tieMatches(season, torneo, md.comp, torneo.playoffs.ties[md.round]);
      md.matches.forEach(function (m) { m.round = md.round; });
      return md.matches;
    }
    const cup = season.cups[md.comp];
    const specs = C.matchSpecs(cup, md);
    md.matches = specs.map(function (s) {
      const single = cup.kind === 'copaArgentina' || md.round === 'final';
      return newMatch(season, md.comp, s.home, s.away, {
        neutral: s.neutral, knockout: !!s.tieId && single, tieId: s.tieId, leg: s.leg, round: s.round, group: s.group, fecha: md.fecha
      });
    });
    return md.matches;
  }

  // ---- sides ----------------------------------------------------------------------------------------------
  function sideFor(ctx, id) {
    const world = ctx.world;
    const career = ctx.career;
    if (id === career.clubId) {
      const u = EM.Squad.userXI(career, world.clubs[id]);
      return { clubId: id, strength: u.strength, xi: u.xi };
    }
    const club = world.clubs[id];
    if (club) {
      const f = C.formationFor(id);
      const b = EM.Squad.bestXI(club.players, f);
      return { clubId: id, strength: b.strength, xi: EM.Squad.xiList(b.slots, f) };
    }
    return { clubId: id, strength: world.cupTeams[id].strength, xi: null };
  }

  // ---- player stats -------------------------------------------------------------------------------
  function applyPlayerStats(season, m, sides) {
    const byId = {};
    [sides.home, sides.away].forEach(function (s) {
      (s.xi || []).forEach(function (p) { byId[p.id] = p; p.season.apps += 1; });
    });
    const league = m.comp === 'apertura' || m.comp === 'clausura';
    m.events.forEach(function (ev) {
      if (ev.playerId && byId[ev.playerId]) {
        byId[ev.playerId].season.goals += 1;
        if (league) {
          const clubId = ev.side === 'home' ? m.home : m.away;
          const sc = season.scorers[ev.playerId] || (season.scorers[ev.playerId] = { name: ev.playerName, clubId: clubId, goals: 0 });
          sc.goals += 1;
        }
      }
      if (ev.assistId && byId[ev.assistId]) byId[ev.assistId].season.assists += 1;
    });
  }

  // ---- prizes ---------------------------------------------------------------------------------------------------
  // Prize money accumulates in career.seasonPrizes and joins the budget at the next season.
  function pay(ctx, key, tag, amount) {
    const paid = ctx.season.paid;
    if (paid[key + ':' + tag] || !amount) return;
    paid[key + ':' + tag] = true;
    ctx.career.seasonPrizes = U.round1((ctx.career.seasonPrizes || 0) + amount);
  }

  function settlePrizes(ctx) {
    const user = ctx.career.clubId;
    const season = ctx.season;
    ['apertura', 'clausura'].forEach(function (k) {
      const t = season.torneos[k];
      if (!t.done) return;
      if (t.champion === user) pay(ctx, k, 'champion', TITLE_PRIZES.torneo.champion);
      else if (t.runnerUp === user) pay(ctx, k, 'runnerUp', TITLE_PRIZES.torneo.runnerUp);
    });
    CUP_KEYS.forEach(function (k) {
      const cup = season.cups[k];
      const stage = cup.stage[user];
      if (stage === undefined) return;
      const guest = cup.guests && cup.guests.indexOf(user) >= 0;
      const prizes = STAGE_PRIZES[k];
      Object.keys(prizes).forEach(function (st) {
        if (guest && C.stageRank(cup, st) < C.stageRank(cup, 'Octavos de final')) return;
        if (C.stageRank(cup, stage) >= C.stageRank(cup, st)) {
          // Group-stage money only once the groups have started.
          if (st === 'Fase de grupos' && !cup.groupsPlayed && k !== 'copaArgentina') return;
          pay(ctx, k, st, prizes[st]);
        }
      });
      if (cup.done) {
        if (cup.champion === user) pay(ctx, k, 'champion', TITLE_PRIZES[k].champion);
        else if (cup.runnerUp === user) pay(ctx, k, 'runnerUp', TITLE_PRIZES[k].runnerUp);
      }
    });
  }

  // ---- playing --------------------------------------------------------------------------------------------------------
  function recordLeague(md, m, res, torneo) {
    if (md.stage === 'regular') {
      L.applyResult(torneo.table[m.home], m.hg, m.ag);
      L.applyResult(torneo.table[m.away], m.ag, m.hg);
      return;
    }
    const tie = torneo.playoffs.ties[md.round].filter(function (t) { return t.id === m.tieId; })[0];
    tie.hg = m.hg; tie.ag = m.ag; tie.pens = m.pens;
    tie.winner = res.winner === 'home' ? m.home : m.away;
    if (md.round === 'final') {
      torneo.champion = tie.winner;
      torneo.runnerUp = tie.winner === m.home ? m.away : m.home;
      torneo.done = true;
    }
  }

  function recordCup(ctx, m, rng, strengthFn) {
    const season = ctx.season;
    const cup = season.cups[m.comp];
    C.recordMatch(ctx.world, cup, m, rng, strengthFn);
    if (cup.groupsDone && (m.comp === 'libertadores' || m.comp === 'sudamericana')) {
      C.buildSudPlayoffs(season.cups.libertadores, season.cups.sudamericana);
    }
  }

  // Plays a whole match day.
  function playMatchday(ctx, md) {
    if (md.played) return md.matches || [];
    const season = ctx.season;
    const rng = U.careerRng(ctx.career);
    const matches = resolveMatchday(ctx, md);
    const cache = {};
    function side(id) { return cache[id] || (cache[id] = sideFor(ctx, id)); }
    const strengthFn = function (id) { return side(id).strength; };

    matches.forEach(function (m) {
      const sides = { home: side(m.home), away: side(m.away) };
      const res = EM.Match.simulate(ctx, sides.home, sides.away, { neutral: m.neutral, knockout: m.knockout, rng: rng });
      m.hg = res.hg; m.ag = res.ag; m.pens = res.pens; m.events = res.events;
      applyPlayerStats(season, m, sides);
      if (m.comp === 'apertura' || m.comp === 'clausura') recordLeague(md, m, res, season.torneos[m.comp]);
      else recordCup(ctx, m, rng, strengthFn);
      m.played = true;
    });
    md.played = true;
    settlePrizes(ctx);
    return matches;
  }

  // Plays the whole calendar in date order (knockout rounds resolve when the earlier ones are done).
  function simulateAll(ctx) {
    ctx.season.calendar.forEach(function (md) { playMatchday(ctx, md); });
    return { seasonOver: isSeasonOver(ctx.season) };
  }

  // Top scorers of the two torneos, best first.
  function topScorers(season, n) {
    return Object.keys(season.scorers).map(function (id) { return Object.assign({ playerId: id }, season.scorers[id]); })
      .sort(function (a, b) { return (b.goals - a.goals) || (a.name < b.name ? -1 : 1); }).slice(0, n || 10);
  }

  EM.Season = {
    COMP_NAMES: COMP_NAMES,
    createSeason: createSeason,
    playMatchday: playMatchday,
    simulateAll: simulateAll,
    isSeasonOver: isSeasonOver,
    topScorers: topScorers
  };
})(window.EM = window.EM || {});
