// ELMANAGER engine: game orchestrator. One game = plain JSON { version, career, world, season }.
// A season is: five pre-season tasks (preseason.js) -> simulateSeason (whole calendar) -> review -> nextSeason.
// EM.Career is the public API: it re-exports the pre-season task functions.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const L = EM.League;
  const C = EM.Cups;
  const S = EM.Squad;
  const P = EM.Players;
  const M = EM.Market;
  const Pre = EM.PreSeason;

  const VERSION = 2;
  const MAX_SEASONS = 5;
  const FIRST_YEAR = 2027;
  const TASKS = Pre.TASKS;
  const MAX_START_BUDGET = 60;

  // Game parameters (not real data), USD millions.
  const BASE_INCOME = { 1: 14, 2: 8, 3: 4 };
  const START_BUDGET = { 1: 40, 2: 20, 3: 10 };
  // Difficulty: flat team-strength bonus for the user's XI and a multiplier on money (start budget and season income).
  // Measured with autofilled XIs: a mid club finishes ~5 places above its strength rank with +1.5, ~7 with +3.
  const DIFFICULTIES = [
    { id: 'easy', label: 'Fácil', bonus: 3, money: 1.25 },
    { id: 'normal', label: 'Normal', bonus: 1.5, money: 1 },
    { id: 'hard', label: 'Difícil', bonus: 0, money: 1 }
  ];
  const DEFAULT_DIFFICULTY = 'normal';

  function difficultyOf(id) {
    return DIFFICULTIES.filter(function (d) { return d.id === id; })[0] || DIFFICULTIES[1];
  }
  const ANNUAL_PRIZE = function (pos) { return pos === 1 ? 6 : (pos <= 6 ? 3 : (pos <= 12 ? 1.5 : 0.5)); };
  // Strength points knocked off the strength-only ascenso teams (tuning knob for upsets, 0 = data value).
  const ASCENSO_ADJUST = 0;

  const userClub = Pre.userClub;
  const fail = Pre.fail;
  function defaultBudget(tier) { return START_BUDGET[tier] || 15; }

  // ---- world -------------------------------------------------------------------------------------------------
  function buildWorld(data, userId) {
    const world = {
      clubs: {}, leagueIds: [], zones: { A: [], B: [] }, promedios: {},
      cupTeams: {}, cupPools: { libertadores: [], sudamericana: [] },
      foreignClubs: [], nacionalQueue: [], qualified: null
    };
    data.clubs.forEach(function (raw) {
      const c = U.clone(raw);
      c.division = 'LP';
      c.players.forEach(function (p) { P.initPlayer(p, c.id); });
      if (c.id !== userId && c.players.length > M.MAX_SQUAD) {
        c.players.sort(function (a, b) { return b.rating - a.rating; });
        c.players.length = M.MAX_SQUAD; // oversized AI rosters lose their weakest extras
      }
      world.clubs[c.id] = c;
      world.leagueIds.push(c.id);
    });
    data.promotionPool.forEach(function (raw) {
      const c = U.clone(raw);
      c.division = 'PN';
      c.players.forEach(function (p) { P.initPlayer(p, c.id); });
      world.clubs[c.id] = c;
      world.nacionalQueue.push(c.id);
    });
    world.zones = { A: data.league.zones.A.slice(), B: data.league.zones.B.slice() };
    world.promedios = L.initPromedios(data.league.promedios || {}, world.leagueIds);
    data.foreignClubs.forEach(function (raw) {
      const c = U.clone(raw);
      c.players.forEach(function (p) { P.initPlayer(p, c.id); });
      world.foreignClubs.push(c);
    });
    ['libertadores', 'sudamericana'].forEach(function (k) {
      data.cups[k].teams.forEach(function (t) {
        world.cupTeams[t.id] = { id: t.id, name: t.name, shortName: t.shortName, colors: t.colors, country: t.country, strength: t.strength };
        world.cupPools[k].push(t.id);
      });
    });
    const ca = data.cups.copaArgentina;
    if (ca) {
      ca.teams.forEach(function (t) {
        if (world.clubs[t.id]) return; // clubs with squads play with their real squad
        world.cupTeams[t.id] = { id: t.id, name: t.name, shortName: t.shortName, colors: t.colors, country: 'ar', strength: U.round1(t.strength - ASCENSO_ADJUST), ascenso: true };
      });
    }
    world.qualified = {
      libertadores: data.cups.libertadores.argentineTeams.slice(),
      libertadoresRepechaje: null,
      sudamericana: data.cups.sudamericana.argentineTeams.slice()
    };
    return world;
  }

  // ---- new game -------------------------------------------------------------------------------------------------------------------
  function newGame(data, opts) {
    const o = opts || {};
    const world = buildWorld(data, o.clubId);
    const club = world.clubs[o.clubId];
    if (!club || club.division !== 'LP') throw new Error('Club inexistente: ' + o.clubId);
    const seed = o.seed != null ? o.seed >>> 0 : ((Date.now() ^ (Math.random() * 4294967296)) >>> 0);
    const diff = difficultyOf(o.difficulty || DEFAULT_DIFFICULTY);
    const career = {
      clubId: o.clubId, directorName: o.directorName || 'Director', seasonIndex: 0, year: FIRST_YEAR, maxSeasons: MAX_SEASONS,
      phase: 'preseason', difficulty: diff.id,
      budget: U.round1(U.clamp(o.startBudget != null ? o.startBudget : defaultBudget(club.tier), 0, MAX_START_BUDGET) * diff.money),
      lineup: { formation: '4-3-3', slots: {} },
      mods: { coach: 0, academy: 0, stadium: 0, level: diff.bonus, total: diff.bonus },
      academyLevel: 0, tasks: {}, pre: Pre.newPre(), decisionEvent: null,
      seasonPrizes: 0, budgetBreakdown: null, rollover: null,
      history: [], summary: null, endReason: null, rngState: seed
    };
    TASKS.forEach(function (k) { career.tasks[k] = false; });
    career.decisionEvent = Pre.buildDecisionEvent(club, 0);
    const game = { version: VERSION, career: career, world: world, season: null };
    game.season = EM.Season.createSeason(world, career, U.careerRng(career));
    return game;
  }

  // ---- finishing a season -----------------------------------------------------------------------------------------------------------
  // Best continental stage of the user this season ({key, name, stage}) or null.
  function userContinental(season, userId) {
    let best = null;
    ['libertadores', 'sudamericana'].forEach(function (k) {
      const stage = season.cups[k].stage[userId];
      if (stage === undefined || (season.userCups.indexOf(k) < 0 && season.cups[k].guests.indexOf(userId) < 0)) return;
      if (!best || C.stageRank(season.cups[k], stage) > C.stageRank(season.cups[k], best.stage)) {
        best = { key: k, name: season.cups[k].name, stage: stage };
      }
    });
    return best;
  }

  function promoteAndRelegate(world, relegated) {
    const promoted = world.nacionalQueue.splice(0, 2);
    relegated.forEach(function (rid, i) {
      const pid = promoted[i];
      ['A', 'B'].forEach(function (z) {
        const zi = world.zones[z].indexOf(rid);
        if (zi >= 0) world.zones[z][zi] = pid;
      });
      world.leagueIds[world.leagueIds.indexOf(rid)] = pid;
      world.clubs[rid].division = 'PN';
      world.clubs[pid].division = 'LP';
      world.promedios[pid] = [];
      world.nacionalQueue.push(rid);
    });
    return promoted;
  }

  function torneoSummary(torneo, user) {
    const zone = torneo.table[user].zone;
    return {
      zone: zone, pos: L.zoneTable(torneo, zone).findIndex(function (r) { return r.clubId === user; }) + 1,
      stage: L.stageReached(torneo, user), champion: torneo.champion
    };
  }

  function continentalSummary(world, season, user) {
    const cont = userContinental(season, user);
    if (!cont) return null;
    const cup = season.cups[cont.key];
    const group = C.groupOf(cup, user);
    return Object.assign({
      champion: cup.champion, phase2: !!(cup.slot && cup.slot.arg === user),
      group: group ? { name: group.name, rows: C.rankedGroup(group) } : null
    }, cont);
  }

  function finishSeason(game) {
    const world = game.world;
    const career = game.career;
    const season = game.season;
    if (career.phase !== 'preseason' || !EM.Season.isSeasonOver(season)) return fail('La temporada todavía no terminó.');
    const user = career.clubId;
    const year = career.year;
    const ap = season.torneos.apertura;
    const cl = season.torneos.clausura;
    const ca = season.cups.copaArgentina;
    const annual = L.annualTable(ap, cl);
    const pos = annual.findIndex(function (r) { return r.clubId === user; }) + 1;
    const row = annual[pos - 1];

    L.pushPromedios(world, annual);
    const relegated = L.relegation(annual, function (id) { return L.promedio(world, id); });
    const qual = L.qualification({
      apertura: ap.champion, clausura: cl.champion, copaArgentinaChampion: ca.champion, annual: annual, relegated: relegated
    });
    const leagueChamp = annual[0].clubId;
    const champions = {
      apertura: ap.champion, clausura: cl.champion, liga: leagueChamp, copaArgentina: ca.champion,
      libertadores: season.cups.libertadores.champion, sudamericana: season.cups.sudamericana.champion
    };
    const titleNames = [
      ['apertura', 'Apertura'], ['clausura', 'Clausura'], ['liga', 'Campeón de Liga'], ['copaArgentina', 'Copa Argentina'],
      ['libertadores', 'Copa Libertadores'], ['sudamericana', 'Copa Sudamericana']
    ];
    const titles = titleNames.filter(function (t) { return champions[t[0]] === user; }).map(function (t) { return t[1]; });

    const annualPrize = ANNUAL_PRIZE(pos);
    career.seasonPrizes = U.round1(career.seasonPrizes + annualPrize);
    const isRelegated = relegated.indexOf(user) >= 0;
    const promoted = promoteAndRelegate(world, relegated);
    world.qualified = qual;

    const top = userClub(game).players.slice().sort(function (a, b) { return b.season.goals - a.season.goals; })[0];
    const topScorer = top && top.season.goals > 0 ? { name: top.name, goals: top.season.goals } : null;
    const continental = continentalSummary(world, season, user);
    const careerOver = isRelegated || career.seasonIndex + 1 >= career.maxSeasons;

    career.summary = {
      year: year, annualPos: pos, annualRow: row, titles: titles, champions: champions,
      apertura: torneoSummary(ap, user), clausura: torneoSummary(cl, user),
      copaArgentina: { stage: ca.stage[user], champion: ca.champion, runnerUp: ca.runnerUp },
      continental: continental, qualification: qual, relegated: relegated, promoted: promoted,
      relegatedUser: isRelegated, careerOver: careerOver, topScorer: topScorer,
      prizes: career.seasonPrizes, annualPrize: annualPrize,
      next: isRelegated ? null : (qual.libertadores.indexOf(user) >= 0 ? 'libertadores' : (qual.sudamericana.indexOf(user) >= 0 ? 'sudamericana' : null)),
      nextPhase2: !isRelegated && qual.libertadoresRepechaje === user && qual.libertadores.indexOf(user) >= 0
    };
    career.history.push({
      year: year, annualPos: pos, points: row.points, apertura: career.summary.apertura.stage, clausura: career.summary.clausura.stage,
      continental: continental ? { name: continental.name, stage: continental.stage } : null,
      copaArgentina: ca.stage[user], titles: titles, relegated: isRelegated
    });
    career.phase = 'review';
    return { ok: true, summary: career.summary };
  }

  // Plays the whole calendar and closes the season. Returns { ok, summary }.
  function simulateSeason(game) {
    if (!Pre.canSimulate(game)) return fail('Completá las tareas y el equipo titular antes de simular.');
    EM.Season.simulateAll(game);
    return finishSeason(game);
  }

  // ---- next season -----------------------------------------------------------------------------------------------------------------------
  function allPlayers(world) {
    let all = [];
    Object.keys(world.clubs).forEach(function (id) { all = all.concat(world.clubs[id].players); });
    world.foreignClubs.forEach(function (c) { all = all.concat(c.players); });
    return all;
  }

  // Retired players leave the game; returns the names that retired from the user's club.
  function retire(game) {
    const world = game.world;
    const mine = [];
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      club.players.filter(P.shouldRetire).forEach(function (p) {
        S.removeFromSquad(club, p.id);
        if (id === game.career.clubId) mine.push(p.name);
      });
    });
    world.foreignClubs.forEach(function (c) { c.players = c.players.filter(function (p) { return !P.shouldRetire(p); }); });
    return mine;
  }

  // User club: 2 + academy level juniors. AI clubs: topped up to 24, trimmed to 34.
  function youthIntake(game, rng) {
    const world = game.world;
    const career = game.career;
    const mine = [];
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      if (id === career.clubId) {
        const n = 2 + career.academyLevel;
        for (let i = 0; i < n && club.players.length < M.MAX_SQUAD; i++) {
          const y = P.generateYouth(id, rng, career.academyLevel);
          y.number = P.freeNumber(club.players);
          club.players.push(y);
          mine.push(y.name);
        }
        return;
      }
      while (club.players.length < 24) {
        const y = P.generateYouth(id, rng, 0);
        y.number = P.freeNumber(club.players);
        club.players.push(y);
      }
      if (club.players.length > M.AI_MAX_SQUAD) {
        club.players.sort(function (a, b) { return b.rating - a.rating; });
        club.players.length = M.AI_MAX_SQUAD;
      }
    });
    return mine;
  }

  function nextSeason(game) {
    const world = game.world;
    const career = game.career;
    if (career.phase !== 'review') return fail('Primero hay que cerrar la temporada.');
    if (career.summary.careerOver) {
      career.phase = 'ended';
      career.endReason = career.summary.relegatedUser ? 'relegation' : 'complete';
      return { ok: true, ended: true };
    }
    const rng = U.careerRng(career);
    const loaned = {};
    allPlayers(world).forEach(function (p) { if (p.loan && p.loan.from === career.clubId) loaned[p.id] = true; });
    const back = M.returnLoans(world, career).filter(function (p) { return loaned[p.id]; }).map(function (p) { return p.name; });

    allPlayers(world).forEach(function (p) { p.season = { apps: 0, goals: 0, assists: 0 }; });
    const club = userClub(game);
    const diff = difficultyOf(career.difficulty);
    const base = U.round1((BASE_INCOME[club.tier] || 4) * diff.money);
    const prizes = U.round1(career.seasonPrizes * diff.money);
    career.seasonIndex += 1;
    career.year += 1;
    allPlayers(world).forEach(function (p) { P.develop(p, rng, { loanBonus: !!loaned[p.id] }); });
    const retired = retire(game);
    const youth = youthIntake(game, rng);
    C.drift(world, rng);

    career.budgetBreakdown = {
      year: career.year, leftover: career.budget, base: base, prizes: prizes,
      total: U.round1(career.budget + base + prizes)
    };
    career.budget = career.budgetBreakdown.total;
    career.seasonPrizes = 0;
    career.rollover = { retired: retired, youth: youth, loansBack: back };

    S.cleanLineup(career, club);
    career.mods = { coach: 0, academy: 0, stadium: 0, level: diff.bonus, total: diff.bonus };
    TASKS.forEach(function (k) { career.tasks[k] = false; });
    career.pre = Pre.newPre();
    career.decisionEvent = Pre.buildDecisionEvent(club, career.seasonIndex);
    career.summary = null;
    career.phase = 'preseason';
    game.season = EM.Season.createSeason(world, career, rng);
    return { ok: true, ended: false };
  }

  function getFinalSummary(game) {
    const career = game.career;
    const history = career.history;
    return {
      seasons: history.length, history: history, endReason: career.endReason,
      titles: history.reduce(function (n, h) { return n + h.titles.length; }, 0),
      budget: career.budget
    };
  }

  EM.Career = Object.assign({}, Pre, {
    VERSION: VERSION,
    MAX_START_BUDGET: MAX_START_BUDGET,
    DIFFICULTIES: DIFFICULTIES,
    DEFAULT_DIFFICULTY: DEFAULT_DIFFICULTY,
    difficultyOf: difficultyOf,
    defaultBudget: defaultBudget,
    newGame: newGame,
    simulateSeason: simulateSeason,
    nextSeason: nextSeason,
    getFinalSummary: getFinalSummary
  });
})(window.EM = window.EM || {});
