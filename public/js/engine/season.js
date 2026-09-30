// ELMANAGER engine: season calendar and match-day simulation.
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
  const INJURY_CHANCE = 0.018;

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
      cursor: 0,
      lastDate: null,
      scorers: {},
      paid: {},
      userCups: []
    };
    let cal = [];
    cal = cal.concat(leagueMatchdays(season, season.torneos.apertura));
    cal.push(newMatchday(season.year + '-06-26', 'window', 'window', 'Mercado de pases de mitad de año'));
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

  function firstUnplayed(season) {
    for (let i = season.cursor; i < season.calendar.length; i++) {
      if (!season.calendar[i].played) { season.cursor = i; return i; }
    }
    season.cursor = season.calendar.length;
    return -1;
  }

  function userMatchOf(md, userId) {
    if (!md.matches) return null;
    for (let i = 0; i < md.matches.length; i++) {
      if (md.matches[i].home === userId || md.matches[i].away === userId) return md.matches[i];
    }
    return null;
  }

  function torneoUserAlive(torneo, userId) {
    const po = torneo.playoffs;
    if (!po.stage) {
      const z = L.zoneTable(torneo, torneo.table[userId].zone);
      return z.findIndex(function (r) { return r.clubId === userId; }) < 8;
    }
    let alive = false;
    let seen = false;
    L.PLAYOFF_STAGES.forEach(function (st) {
      po.ties[st].forEach(function (t) {
        if (t.home === userId || t.away === userId) { seen = true; alive = t.winner === null || t.winner === userId; }
      });
    });
    return seen && alive;
  }

  // Could the user play in this (unresolved) match day? Optimistic for rounds not built yet.
  function userAliveIn(season, md) {
    const user = season.userClubId;
    if (md.comp === 'apertura' || md.comp === 'clausura') return torneoUserAlive(season.torneos[md.comp], user);
    const cup = season.cups[md.comp];
    if (!cup || cup.out[user] || cup.stage[user] === undefined) return false;
    if (md.stage === 'grupos') return !!C.groupOf(cup, user);
    const info = (cup.kind === 'copaArgentina' ? C.CA_ROUNDS : C.CONT_ROUNDS)[md.round];
    return C.stageRank(cup, cup.stage[user]) >= C.stageRank(cup, info.stage);
  }

  // Next match day (from the cursor) in which the user plays, or may still play.
  function nextUserMatchday(season) {
    const user = season.userClubId;
    for (let i = firstUnplayed(season); i >= 0 && i < season.calendar.length; i++) {
      const md = season.calendar[i];
      if (md.played) continue;
      if (md.comp === 'window') return md;
      if (md.matches ? userMatchOf(md, user) : userAliveIn(season, md)) return md;
    }
    return null;
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
      return { clubId: id, strength: u.strength, xi: u.xi, replaced: u.replaced, user: true };
    }
    const club = world.clubs[id];
    if (club) {
      const f = C.formationFor(id);
      const b = EM.Squad.bestXI(club.players, f);
      return { clubId: id, strength: b.strength, xi: EM.Squad.xiList(b.slots, f) };
    }
    return { clubId: id, strength: world.cupTeams[id].strength, xi: null };
  }

  // ---- stats, injuries, news -------------------------------------------------------------------------------
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

  function rollInjuries(ctx, date, rng) {
    const club = ctx.world.clubs[ctx.career.clubId];
    const lineup = EM.Squad.userXI(ctx.career, club);
    club.players.forEach(function (p) { if (p.injury > 0) p.injury -= 1; });
    lineup.xi.forEach(function (p) {
      if (rng.chance(INJURY_CHANCE)) {
        p.injury = rng.int(1, 4);
        EM.Career.addNews(ctx.career, {
          date: date, type: 'injury', title: p.name + ' se lesionó',
          body: 'Estará ' + p.injury + (p.injury === 1 ? ' partido' : ' partidos') + ' afuera.'
        });
      }
    });
  }

  function scoreLine(world, m) {
    let s = teamName(world, m.home) + ' ' + m.hg + '-' + m.ag + ' ' + teamName(world, m.away);
    if (m.pens) s += ' (pen. ' + m.pens.h + '-' + m.pens.a + ')';
    return s;
  }

  function teamName(world, id) { return C.teamInfo(world, id).name; }

  function compLabel(md) { return md.label; }

  // ---- prizes ---------------------------------------------------------------------------------------------------
  function pay(ctx, key, tag, amount, label, date) {
    const paid = ctx.season.paid;
    if (paid[key + ':' + tag] || !amount) return;
    paid[key + ':' + tag] = true;
    EM.Career.credit(ctx.career, amount, label, date);
  }

  function settlePrizes(ctx, date) {
    const user = ctx.career.clubId;
    const season = ctx.season;
    ['apertura', 'clausura'].forEach(function (k) {
      const t = season.torneos[k];
      if (!t.done) return;
      if (t.champion === user) pay(ctx, k, 'champion', TITLE_PRIZES.torneo.champion, 'Premio por el título del ' + COMP_NAMES[k], date);
      else if (t.runnerUp === user) pay(ctx, k, 'runnerUp', TITLE_PRIZES.torneo.runnerUp, 'Premio por la final del ' + COMP_NAMES[k], date);
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
          pay(ctx, k, st, prizes[st], COMP_NAMES[k] + ': ' + st.toLowerCase(), date);
        }
      });
      if (cup.done) {
        if (cup.champion === user) pay(ctx, k, 'champion', TITLE_PRIZES[k].champion, COMP_NAMES[k] + ': campeón', date);
        else if (cup.runnerUp === user) pay(ctx, k, 'runnerUp', TITLE_PRIZES[k].runnerUp, COMP_NAMES[k] + ': subcampeón', date);
      }
    });
  }

  // ---- playing --------------------------------------------------------------------------------------------------------
  const CHAMPION_OF = {
    apertura: 'del Apertura', clausura: 'del Clausura', libertadores: 'de la Copa Libertadores',
    sudamericana: 'de la Copa Sudamericana', copaArgentina: 'de la Copa Argentina'
  };

  function announceChampion(ctx, md, key, championId) {
    EM.Career.addNews(ctx.career, {
      date: md.date, type: 'title',
      title: teamName(ctx.world, championId) + ' campeón ' + CHAMPION_OF[key] + ' ' + ctx.season.year,
      body: championId === ctx.career.clubId ? 'Tu club levantó el trofeo.' : 'Se consagró en ' + md.label + '.'
    });
  }

  // News for the user when a continental group stage ends.
  function groupsNews(ctx, md, cup) {
    const user = ctx.career.clubId;
    if (!C.groupOf(cup, user)) return;
    const name = COMP_NAMES[cup.key];
    let title;
    let body;
    if (!cup.out[user]) {
      title = 'Clasificados a ' + (cup.stage[user] === 'Playoffs' ? 'los playoffs' : 'los octavos') + ' de la ' + name;
      body = 'El equipo avanzó desde la fase de grupos.';
    } else if (cup.key === 'libertadores') {
      const third = C.rankedGroup(C.groupOf(cup, user))[2].clubId === user;
      title = third ? 'Pasan a los playoffs de la Sudamericana' : 'Eliminados en la fase de grupos de la Libertadores';
      body = third ? 'Terminaron terceros y juegan la Sudamericana.' : 'El equipo terminó último en su grupo.';
    } else {
      title = 'Eliminados en la fase de grupos de la Sudamericana';
      body = 'El equipo no consiguió clasificar.';
    }
    EM.Career.addNews(ctx.career, { date: md.date, type: 'cup', title: title, body: body });
  }

  function recordLeague(ctx, md, m, res, out) {
    const season = ctx.season;
    const torneo = season.torneos[m.comp];
    if (md.stage === 'regular') {
      L.applyResult(torneo.table[m.home], m.hg, m.ag);
      L.applyResult(torneo.table[m.away], m.ag, m.hg);
      return;
    }
    const tie = torneo.playoffs.ties[md.round].filter(function (t) { return t.id === m.tieId; })[0];
    tie.hg = m.hg; tie.ag = m.ag; tie.pens = m.pens;
    tie.winner = res.winner === 'home' ? m.home : m.away;
    const loser = tie.winner === m.home ? m.away : m.home;
    out.decided.push({ winner: tie.winner, loser: loser, round: md.round, comp: m.comp });
    if (md.round === 'final') {
      torneo.champion = tie.winner;
      torneo.runnerUp = loser;
      torneo.done = true;
      announceChampion(ctx, md, m.comp, tie.winner);
    }
  }

  function recordCup(ctx, md, m, out, strengthFn) {
    const season = ctx.season;
    const cup = season.cups[m.comp];
    const rng = out.rng;
    const wasDone = cup.groupsDone;
    const rec = C.recordMatch(ctx.world, cup, m, rng, strengthFn);
    if (!wasDone && cup.groupsDone) groupsNews(ctx, md, cup);
    if (rec.decided) out.decided.push({ winner: rec.winner, loser: rec.loser, round: rec.round, comp: m.comp });
    if (cup.groupsDone && (m.comp === 'libertadores' || m.comp === 'sudamericana')) {
      C.buildSudPlayoffs(season.cups.libertadores, season.cups.sudamericana);
    }
    if (rec.decided && cup.done) announceChampion(ctx, md, m.comp, cup.champion);
  }

  function userElimination(ctx, md, d) {
    const world = ctx.world;
    if (d.loser !== ctx.career.clubId) return;
    const name = COMP_NAMES[d.comp];
    const isFinal = d.round === 'final' || d.round === 'r1';
    const league = d.comp === 'apertura' || d.comp === 'clausura';
    EM.Career.addNews(ctx.career, {
      date: md.date, type: 'cup',
      title: (isFinal ? 'Subcampeones ' : 'Eliminados ') + (isFinal ? CHAMPION_OF[d.comp] : 'de ' + (league ? 'los playoffs del ' + name : 'la ' + name)),
      body: (isFinal ? 'El equipo perdió la final ante ' : 'El equipo quedó afuera ante ') + teamName(world, d.winner) + '.'
    });
  }

  // Plays a whole match day. Returns { userMatch | null, results }.
  function playMatchday(ctx, md) {
    const world = ctx.world;
    const career = ctx.career;
    const season = ctx.season;
    const user = career.clubId;
    if (md.played) return { userMatch: userMatchOf(md, user), results: md.matches || [] };
    if (md.comp === 'window') {
      md.played = true;
      season.lastDate = md.date;
      career.today = md.date;
      return { userMatch: null, results: [] };
    }
    const rng = U.careerRng(career);
    const matches = resolveMatchday(ctx, md);
    const cache = {};
    function side(id) { return cache[id] || (cache[id] = sideFor(ctx, id)); }
    const strengthFn = function (id) { return side(id).strength; };
    const out = { decided: [], rng: rng };
    let userMatch = null;
    let bigResult = null;

    matches.forEach(function (m) {
      const sides = { home: side(m.home), away: side(m.away) };
      const res = EM.Match.simulate(ctx, sides.home, sides.away, { neutral: m.neutral, knockout: m.knockout, rng: rng });
      m.hg = res.hg; m.ag = res.ag; m.pens = res.pens; m.events = res.events;
      applyPlayerStats(season, m, sides);
      if (m.comp === 'apertura' || m.comp === 'clausura') recordLeague(ctx, md, m, res, out);
      else recordCup(ctx, md, m, out, strengthFn);
      m.played = true;
      if (m.home === user || m.away === user) userMatch = m;
      if (md.stage === 'regular' && Math.abs(m.hg - m.ag) >= 5 && !bigResult) bigResult = m;
    });
    md.played = true;
    season.lastDate = md.date;
    career.today = md.date;

    if (bigResult && bigResult !== userMatch) {
      EM.Career.addNews(career, { date: md.date, type: 'result', title: 'Goleada: ' + scoreLine(world, bigResult), body: md.label + '.' });
    }
    out.decided.forEach(function (d) { userElimination(ctx, md, d); });
    if (userMatch) {
      const mine = userMatch.home === user ? userMatch.hg - userMatch.ag : userMatch.ag - userMatch.hg;
      const pensWon = userMatch.pens ? ((userMatch.home === user ? userMatch.pens.h > userMatch.pens.a : userMatch.pens.a > userMatch.pens.h)) : null;
      const verdict = mine > 0 ? 'Victoria' : (mine < 0 ? 'Derrota' : (pensWon === null ? 'Empate' : (pensWon ? 'Victoria por penales' : 'Derrota por penales')));
      EM.Career.addNews(career, { date: md.date, type: 'result', title: verdict + ': ' + scoreLine(world, userMatch), body: compLabel(md) + '.' });
      rollInjuries(ctx, md.date, rng);
    }
    settlePrizes(ctx, md.date);
    return { userMatch: userMatch, results: matches };
  }

  // ---- advancing ------------------------------------------------------------------------------------------------------------
  // Plays every match day up to and including the next one where the user plays.
  // Stops at the mid-year window marker (career.window becomes 'mid'); the next call closes it.
  function advanceToNextUserMatch(ctx) {
    const career = ctx.career;
    const season = ctx.season;
    const seqBefore = career.newsSeq || 0;
    const summary = { played: [], userMatch: null, userMatchday: null, windowOpened: false, seasonOver: false, news: [] };

    if (career.window === 'mid') {
      career.window = null;
      const w = season.calendar.filter(function (md) { return md.comp === 'window' && !md.played; })[0];
      if (w) { w.played = true; season.lastDate = w.date; career.today = w.date; }
    }
    for (;;) {
      const idx = firstUnplayed(season);
      if (idx < 0) break;
      const md = season.calendar[idx];
      if (md.comp === 'window') {
        career.window = 'mid';
        career.negotiations = {};
        summary.windowOpened = true;
        summary.userMatchday = md;
        break;
      }
      const r = playMatchday(ctx, md);
      summary.played.push({ id: md.id, date: md.date, label: md.label });
      if (r.userMatch) { summary.userMatch = r.userMatch; summary.userMatchday = md; break; }
    }
    summary.seasonOver = isSeasonOver(season);
    summary.news = career.news.filter(function (n) { return n.seq > seqBefore; });
    return summary;
  }

  // Quick option: plays the rest of the season (closing the mid-year window on the way).
  function simulateToEndOfSeason(ctx) {
    let count = 0;
    while (!isSeasonOver(ctx.season) && count < 400) {
      advanceToNextUserMatch(ctx);
      count++;
    }
    return { seasonOver: isSeasonOver(ctx.season) };
  }

  // The user's next fixture for the dashboard: { md, match, home, tentative, window } or null.
  function describeNext(ctx) {
    const season = ctx.season;
    const user = ctx.career.clubId;
    const first = firstUnplayed(season);
    for (let i = first; i >= 0 && i < season.calendar.length; i++) {
      const md = season.calendar[i];
      if (md.played) continue;
      if (md.comp === 'window') return { md: md, match: null, window: true };
      if (!md.matches) {
        if (i === first) resolveMatchday(ctx, md);
        else if (userAliveIn(season, md)) return { md: md, match: null, tentative: true };
        else continue;
      }
      const m = userMatchOf(md, user);
      if (m) return { md: md, match: m, home: m.home === user };
    }
    return null;
  }

  // Top scorers of the two torneos, best first.
  function topScorers(season, n) {
    return Object.keys(season.scorers).map(function (id) { return Object.assign({ playerId: id }, season.scorers[id]); })
      .sort(function (a, b) { return (b.goals - a.goals) || (a.name < b.name ? -1 : 1); }).slice(0, n || 10);
  }

  EM.Season = {
    COMP_NAMES: COMP_NAMES,
    createSeason: createSeason,
    resolveMatchday: resolveMatchday,
    playMatchday: playMatchday,
    nextUserMatchday: nextUserMatchday,
    advanceToNextUserMatch: advanceToNextUserMatch,
    simulateToEndOfSeason: simulateToEndOfSeason,
    isSeasonOver: isSeasonOver,
    describeNext: describeNext,
    userMatchOf: userMatchOf,
    topScorers: topScorers
  };
})(window.EM = window.EM || {});
