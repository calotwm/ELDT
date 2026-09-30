// ELMANAGER engine: career orchestrator (new game, pre-season, board, economy, season rollover).
// A game is plain JSON: { version, career, world, season }. World clubs own their players.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const L = EM.League;
  const C = EM.Cups;
  const S = EM.Squad;
  const P = EM.Players;

  const VERSION = 1;
  const MAX_SEASONS = 5;
  const FIRST_YEAR = 2027;

  // Game parameters (not real data), USD millions.
  const BASE_INCOME = { 1: 14, 2: 8, 3: 4 };
  const START_BUDGET = { 1: 40, 2: 20, 3: 10 };
  const ANNUAL_PRIZE = function (pos) { return pos === 1 ? 6 : (pos <= 6 ? 3 : (pos <= 12 ? 1.5 : 0.5)); };
  // Strength points knocked off the strength-only ascenso teams (tuning knob for upsets, 0 = data value).
  const ASCENSO_ADJUST = 0;

  // ---- objectives ------------------------------------------------------------------------------------
  const LEAGUE_OBJECTIVES = [
    { id: 'titulo', label: 'Ganar un título (torneo o liga)', level: 4 },
    { id: 'libertadores', label: 'Clasificar a la Libertadores', level: 3 },
    { id: 'copas', label: 'Clasificar a una copa internacional', level: 2 },
    { id: 'mitad', label: 'Terminar en la mitad superior (top 15)', level: 1 },
    { id: 'permanencia', label: 'Evitar el descenso', level: 0 }
  ];
  const CUP_OBJECTIVES = [
    { id: 'grupos', label: 'Pasar la fase de grupos', stage: 'Playoffs' },
    { id: 'cuartos', label: 'Llegar a cuartos de final', stage: 'Cuartos de final' },
    { id: 'semis', label: 'Llegar a semifinales', stage: 'Semifinales' },
    { id: 'final', label: 'Llegar a la final', stage: 'Final' },
    { id: 'campeon', label: 'Ser campeón', stage: 'Campeón' }
  ];
  const CA_OBJECTIVES = [
    { id: 'octavos', label: 'Llegar a octavos de final', stage: 'Octavos de final' },
    { id: 'cuartos', label: 'Llegar a cuartos de final', stage: 'Cuartos de final' },
    { id: 'semis', label: 'Llegar a semifinales', stage: 'Semifinales' },
    { id: 'campeon', label: 'Ser campeón', stage: 'Campeón' }
  ];

  function findOpt(list, id) { return list.filter(function (o) { return o.id === id; })[0] || null; }
  function levelOf(id) { const o = findOpt(LEAGUE_OBJECTIVES, id); return o ? o.level : 0; }

  // ---- money and news ----------------------------------------------------------------------------------
  // amount > 0 income, < 0 expense. Logged in career.finances (newest first).
  function credit(career, amount, label, date, tag) {
    career.budget = U.round1(career.budget + amount);
    const entry = { year: career.year, label: label, amount: U.round1(amount) };
    if (date) entry.date = date;
    if (tag) entry.tag = tag;
    career.finances.unshift(entry);
  }

  function addNews(career, item) {
    career.newsSeq = (career.newsSeq || 0) + 1;
    career.news.unshift({
      id: 'n' + career.newsSeq, seq: career.newsSeq, date: item.date || career.today, type: item.type,
      title: item.title, body: item.body || ''
    });
    if (career.news.length > 80) career.news.length = 80;
  }

  function userClub(game) { return game.world.clubs[game.career.clubId]; }

  // ---- world -------------------------------------------------------------------------------------------------
  function buildWorld(data) {
    const world = {
      clubs: {}, leagueIds: [], zones: { A: [], B: [] }, promedios: {},
      cupTeams: {}, cupPools: { libertadores: [], sudamericana: [] },
      foreignClubs: [], freeAgents: [], nacionalQueue: [], titles: {},
      qualified: null
    };
    data.clubs.forEach(function (raw) {
      const c = U.clone(raw);
      c.division = 'LP';
      c.players.forEach(function (p) { P.initPlayer(p, c.id); });
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

  // Oversized rosters release their weakest extras so the market starts with a few free agents.
  function seedFreeAgents(world, userId) {
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      if (id === userId || club.players.length <= 30) return;
      club.players.sort(function (a, b) { return b.rating - a.rating; });
      while (club.players.length > 30) {
        const p = club.players.pop();
        p.clubId = null; p.contract = 0;
        world.freeAgents.push(p);
      }
    });
  }

  // ---- board expectation ----------------------------------------------------------------------------------------
  function expectationFor(world, clubId) {
    const ranked = world.leagueIds.map(function (id) {
      return { id: id, s: S.bestXI(world.clubs[id].players, '4-3-3').strength };
    }).sort(function (a, b) { return b.s - a.s || (a.id < b.id ? -1 : 1); });
    const rank = ranked.findIndex(function (r) { return r.id === clubId; }) + 1;
    if (rank <= 4) return 'titulo';
    if (rank <= 10) return 'libertadores';
    if (rank <= 16) return 'copas';
    if (rank <= 23) return 'mitad';
    return 'permanencia';
  }

  // ---- pre-season decision ---------------------------------------------------------------------------------------------
  const SPONSOR_POOL = [
    { id: 'pampa', name: 'Grupo Pampa Energía', fee: 4.5, prob: 55 },
    { id: 'surco', name: 'Surco Neumáticos', fee: 2.8, prob: 68 },
    { id: 'delrio', name: 'Cervecería Del Río', fee: 6.5, prob: 38 },
    { id: 'nortex', name: 'Nortex Seguros', fee: 3.6, prob: 60 }
  ];
  const COACH_POOL = [
    { id: 'a', name: 'Rubén Maggiolo', strengthMod: 1.5, cost: 1.2 },
    { id: 'b', name: 'Esteban Vidoz', strengthMod: -0.5, cost: 0.4 },
    { id: 'c', name: 'Facundo Herrero', strengthMod: 3, cost: 2.5 }
  ];
  const EVENT_TYPES = ['sponsor', 'coach', 'academy', 'stadium'];

  function buildDecisionEvent(world, career) {
    const club = world.clubs[career.clubId];
    const h = U.hashStr(club.id);
    const type = EVENT_TYPES[(h + career.seasonIndex) % 4];
    if (type === 'sponsor') {
      return {
        type: type, title: 'Sponsor de camiseta', done: false, attemptsLeft: 3, result: null,
        options: SPONSOR_POOL.map(function (s) {
          return { id: s.id, name: s.name, fee: s.fee, prob: U.clamp(s.prob + (Math.floor(h + s.fee * 10) % 15) - 7, 20, 80) };
        })
      };
    }
    if (type === 'coach') {
      return {
        type: type, title: 'Cuerpo técnico', done: false, result: null,
        options: [{ id: 'keep', name: club.coach, strengthMod: 0, cost: 0, incumbent: true }].concat(COACH_POOL.map(function (c) { return Object.assign({}, c); }))
      };
    }
    if (type === 'academy') {
      return {
        type: type, title: 'Inversión en las inferiores', done: false, result: null,
        options: [
          { id: 'skip', name: 'No invertir', cost: 0, strengthMod: 0, level: 0 },
          { id: 'basic', name: 'Plan básico', cost: 1.5, strengthMod: 0.3, level: 1 },
          { id: 'full', name: 'Plan integral', cost: 3.5, strengthMod: 0.6, level: 2 }
        ]
      };
    }
    return {
      type: type, title: 'Refacción del estadio', done: false, result: null,
      options: [
        { id: 'skip', name: 'Posponer obras', cost: 0, strengthMod: 0 },
        { id: 'partial', name: 'Obra parcial', cost: 2, strengthMod: 0.6 },
        { id: 'full', name: 'Obra completa', cost: 4.5, strengthMod: 1.6 }
      ]
    };
  }

  function recomputeMods(career) {
    const m = career.mods;
    m.total = U.round1(m.coach + m.academy + m.stadium + m.cohesion + m.captain);
    return m;
  }

  function finishDecision(career, result) {
    career.decisionEvent.done = true;
    career.decisionEvent.result = result;
    career.preseason.decision = true;
  }

  // Sponsor: up to 3 pitches; a success pays the fee, running out of attempts ends the event with nothing.
  function pitchSponsor(game, optionId) {
    const career = game.career;
    const ev = career.decisionEvent;
    if (career.phase !== 'preseason' || ev.type !== 'sponsor' || ev.done) return { ok: false, message: 'No hay una propuesta de sponsor pendiente.' };
    const opt = findOpt(ev.options, optionId);
    if (!opt) return { ok: false, message: 'Sponsor inexistente.' };
    const success = U.careerRng(career).chance(opt.prob / 100);
    ev.attemptsLeft -= 1;
    if (success) {
      credit(career, opt.fee, 'Sponsor de camiseta: ' + opt.name, career.today);
      finishDecision(career, { success: true, sponsor: opt.name, fee: opt.fee });
      addNews(career, { type: 'board', title: 'Nuevo sponsor de camiseta', body: opt.name + ' aporta ' + U.formatMoney(opt.fee) + ' a las arcas del club.' });
    } else if (ev.attemptsLeft <= 0) {
      finishDecision(career, { success: false });
      addNews(career, { type: 'board', title: 'Sin sponsor de camiseta', body: 'Ninguna empresa aceptó la propuesta esta temporada.' });
    }
    return { ok: true, success: success, attemptsLeft: ev.attemptsLeft, done: ev.done };
  }

  // Coach / academy / stadium (and 'skip' for any event, including declining the sponsor).
  function chooseOption(game, optionId) {
    const career = game.career;
    const ev = career.decisionEvent;
    if (career.phase !== 'preseason' || ev.done) return { ok: false, message: 'No hay una decisión pendiente.' };
    if (optionId === 'skip' && ev.type === 'sponsor') {
      finishDecision(career, { success: false, declined: true });
      return { ok: true };
    }
    const opt = findOpt(ev.options, optionId);
    if (!opt || ev.type === 'sponsor') return { ok: false, message: 'Opción inexistente.' };
    if (!EM.Market.canAfford(career, opt.cost)) return { ok: false, message: 'No alcanza el presupuesto.' };
    if (opt.cost) credit(career, -opt.cost, ev.title + ': ' + opt.name, career.today);
    if (ev.type === 'coach') {
      career.mods.coach = opt.strengthMod;
      if (!opt.incumbent) {
        userClub(game).coach = opt.name;
        addNews(career, { type: 'board', title: opt.name + ' es el nuevo entrenador', body: 'Asume al frente del plantel.' });
      }
    } else if (ev.type === 'academy') {
      career.mods.academy = opt.strengthMod;
      career.academyLevel = Math.min(5, career.academyLevel + opt.level);
    } else {
      career.mods.stadium = opt.strengthMod;
    }
    recomputeMods(career);
    finishDecision(career, { optionId: opt.id, name: opt.name });
    return { ok: true };
  }

  // ---- friendlies --------------------------------------------------------------------------------------------------------
  function pickFriendlyOptions(world, career, rng) {
    const others = world.leagueIds.filter(function (id) { return id !== career.clubId; });
    const clubs = rng.shuffle(others.slice()).slice(0, 2).map(function (id) {
      const c = world.clubs[id];
      return { id: id, name: c.name, shortName: c.shortName, colors: c.colors, kind: 'club', strength: U.round1(C.strengthOf(world, id)) };
    });
    const foreign = Object.keys(world.cupTeams).filter(function (id) { return !world.cupTeams[id].ascenso; }).sort();
    const teams = rng.shuffle(foreign).slice(0, 2).map(function (id) {
      const t = world.cupTeams[id];
      return { id: id, name: t.name, shortName: t.shortName, colors: t.colors, kind: 'foreign', strength: t.strength };
    });
    return clubs.concat(teams);
  }

  function friendlyOptions(game) {
    const pre = game.career.preseason;
    return pre.friendlyOptions.map(function (o) {
      return Object.assign({ played: pre.friendlies.some(function (f) { return f.opponentId === o.id; }) }, o);
    });
  }

  function playFriendly(game, opponentId) {
    const career = game.career;
    const pre = career.preseason;
    const opt = findOpt(pre.friendlyOptions, opponentId);
    if (career.phase !== 'preseason') return { ok: false, message: 'Solo se juegan amistosos en la pretemporada.' };
    if (!opt) return { ok: false, message: 'Rival inexistente.' };
    if (pre.friendlies.length >= 3) return { ok: false, message: 'Ya jugaste los 3 amistosos posibles.' };
    if (pre.friendlies.some(function (f) { return f.opponentId === opponentId; })) return { ok: false, message: 'Ya jugaste contra ese rival.' };
    const rng = U.careerRng(career);
    const home = S.userXI(career, userClub(game));
    let away;
    const oc = game.world.clubs[opponentId];
    if (oc) {
      const f = C.formationFor(opponentId);
      const b = S.bestXI(oc.players, f);
      away = { clubId: opponentId, strength: b.strength, xi: S.xiList(b.slots, f) };
    } else {
      away = { clubId: opponentId, strength: game.world.cupTeams[opponentId].strength, xi: null };
    }
    const res = EM.Match.simulate(game, { clubId: career.clubId, strength: home.strength, xi: home.xi }, away, { neutral: true, knockout: false, rng: rng });
    const income = U.round1(rng.float(0.2, 0.6));
    career.mods.cohesion = U.round1(Math.min(1.2, career.mods.cohesion + 0.4));
    recomputeMods(career);
    credit(career, income, 'Amistoso vs ' + opt.name, career.today);
    const record = { opponentId: opponentId, name: opt.name, hg: res.hg, ag: res.ag, events: res.events, income: income };
    pre.friendlies.push(record);
    return { ok: true, friendly: record };
  }

  // ---- objectives ----------------------------------------------------------------------------------------------------------------
  // Options the UI can offer this pre-season.
  function objectiveOptions(game) {
    const season = game.season;
    const cupKey = season.userCups.length ? season.userCups[0] : null;
    return {
      expectation: game.career.expectation,
      league: LEAGUE_OBJECTIVES.map(function (o) { return { id: o.id, label: o.label, level: o.level }; }),
      cupKey: cupKey,
      cupName: cupKey ? season.cups[cupKey].name : null,
      cup: cupKey ? CUP_OBJECTIVES.map(function (o) { return { id: o.id, label: o.label }; }) : null,
      copaArgentina: CA_OBJECTIVES.map(function (o) { return { id: o.id, label: o.label }; })
    };
  }

  function setObjectives(game, o) {
    const career = game.career;
    const season = game.season;
    if (career.phase !== 'preseason') return { ok: false, message: 'Los objetivos se fijan en la pretemporada.' };
    const league = findOpt(LEAGUE_OBJECTIVES, o.league);
    if (!league) return { ok: false, message: 'Falta el objetivo de liga.' };
    const needCup = season.userCups.length > 0;
    if (needCup && !findOpt(CUP_OBJECTIVES, o.cup)) return { ok: false, message: 'Falta el objetivo de copa internacional.' };
    if (!findOpt(CA_OBJECTIVES, o.copaArgentina)) return { ok: false, message: 'Falta el objetivo de Copa Argentina.' };

    // Undo the effect of a previous choice made in this pre-season.
    const prev = career.objEffects;
    if (prev) {
      career.budget = U.round1(career.budget - prev.budget);
      career.confidence = U.clamp(career.confidence - prev.confidence, 0, 100);
      career.finances = career.finances.filter(function (f) { return f.tag !== 'objectives'; });
    }
    const base = BASE_INCOME[userClub(game).tier] || 4;
    if (!career.preseason.income) {
      credit(career, base, 'Ingresos base de la temporada ' + career.year, career.today);
      career.preseason.income = true;
    }
    const d = league.level - levelOf(career.expectation);
    const budget = d > 0 ? base * 0.15 * d : base * 0.2 * d;
    const confidence = d < 0 ? -10 : 0;
    if (budget) credit(career, budget, d > 0 ? 'La directiva refuerza el presupuesto por la ambición' : 'La directiva recorta el presupuesto por el objetivo', career.today, 'objectives');
    career.confidence = U.clamp(career.confidence + confidence, 0, 100);
    career.objEffects = { budget: U.round1(budget), confidence: confidence };
    career.objectives = { league: o.league, cup: needCup ? o.cup : null, copaArgentina: o.copaArgentina };
    career.preseason.objectives = true;
    return { ok: true, budgetChange: U.round1(budget), confidenceChange: confidence };
  }

  // ---- lineup helpers ------------------------------------------------------------------------------------------------------------------
  function setFormation(game, name) {
    if (!EM.Positions.FORMATIONS[name]) return { ok: false };
    S.autoLineup(game.career, userClub(game), name);
    return { ok: true, lineup: game.career.lineup };
  }

  function setCaptain(game, playerId) {
    const has = userClub(game).players.some(function (p) { return p.id === playerId; });
    if (!has) return { ok: false };
    game.career.lineup.captainId = playerId;
    return { ok: true };
  }

  // Checklist for the pre-season screen.
  function checkPreseason(game) {
    const career = game.career;
    const club = userClub(game);
    const chk = S.checkLineup(career, club);
    const reasons = [];
    if (!career.preseason.objectives) reasons.push('Falta fijar los objetivos con la directiva.');
    if (!career.preseason.decision) reasons.push('Falta resolver la decisión del club.');
    if (!chk.complete) reasons.push('El equipo titular no está completo o tiene lesionados.');
    if (!chk.captainOk) reasons.push('Falta elegir al capitán.');
    if (club.players.length < EM.Market.MIN_SQUAD) reasons.push('El plantel necesita al menos ' + EM.Market.MIN_SQUAD + ' jugadores.');
    if (club.players.length > EM.Market.MAX_SQUAD) reasons.push('El plantel supera el máximo de ' + EM.Market.MAX_SQUAD + ' jugadores.');
    career.preseason.tactics = chk.complete && chk.captainOk;
    return {
      ok: reasons.length === 0, reasons: reasons,
      objectives: career.preseason.objectives, decision: career.preseason.decision,
      tactics: career.preseason.tactics, squad: club.players.length >= EM.Market.MIN_SQUAD && club.players.length <= EM.Market.MAX_SQUAD
    };
  }

  function canStartSeason(game) {
    return checkPreseason(game).ok;
  }

  function startSeason(game) {
    const career = game.career;
    const chk = checkPreseason(game);
    if (career.phase !== 'preseason' || !chk.ok) return { ok: false, reasons: chk.reasons };
    const xi = S.userXI(career, userClub(game));
    career.mods.captain = xi.xi.some(function (p) { return p.id === career.lineup.captainId; }) ? 0.5 : 0;
    recomputeMods(career);
    career.phase = 'season';
    career.window = null;
    career.negotiations = {};
    return { ok: true };
  }

  // ---- new game ----------------------------------------------------------------------------------------------------------------------------
  function newPreseason(world, career, rng) {
    return { objectives: false, decision: false, income: false, friendlies: [], friendlyOptions: pickFriendlyOptions(world, career, rng), tactics: false };
  }

  function newGame(data, opts) {
    const o = opts || {};
    const world = buildWorld(data);
    const club = world.clubs[o.clubId];
    if (!club || club.division !== 'LP') throw new Error('Club inexistente: ' + o.clubId);
    const seed = o.seed != null ? o.seed >>> 0 : ((Date.now() ^ (Math.random() * 4294967296)) >>> 0);
    const career = {
      clubId: o.clubId, directorName: o.directorName || 'Director', seasonIndex: 0, year: FIRST_YEAR, maxSeasons: MAX_SEASONS,
      phase: 'preseason', window: 'pre',
      budget: o.startBudget != null ? o.startBudget : START_BUDGET[club.tier] || 10,
      confidence: 60,
      objectives: { league: null, cup: null, copaArgentina: null },
      expectation: 'mitad',
      lineup: { formation: '4-3-3', slots: {}, bench: [], captainId: null },
      mods: { coach: 0, academy: 0, stadium: 0, cohesion: 0, captain: 0, total: 0 },
      academyLevel: 0, preseason: null, decisionEvent: null,
      news: [], newsSeq: 0, history: [], finances: [], transfers: [], negotiations: {},
      sackedReason: null, objEffects: null, today: FIRST_YEAR + '-01-10', rngState: seed, summary: null
    };
    const rng = U.careerRng(career);
    seedFreeAgents(world, o.clubId);
    career.expectation = expectationFor(world, o.clubId);
    career.decisionEvent = buildDecisionEvent(world, career);
    career.preseason = newPreseason(world, career, rng);
    S.autoLineup(career, club, '4-3-3');
    const game = { version: VERSION, career: career, world: world, season: null };
    game.season = EM.Season.createSeason(world, career, rng);
    addNews(career, { type: 'board', title: 'Bienvenido a ' + club.name, body: 'La directiva espera: ' + findOpt(LEAGUE_OBJECTIVES, career.expectation).label.toLowerCase() + '.' });
    return game;
  }

  // ---- finishing a season -------------------------------------------------------------------------------------------------------------------------
  function addTitle(world, clubId, year, comp) {
    if (!clubId) return;
    if (!world.titles[clubId]) world.titles[clubId] = [];
    world.titles[clubId].push({ year: year, comp: comp });
  }

  // Best continental stage of the user this season ({key, stage}) or null.
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

  function leagueObjectiveMet(id, ctx) {
    const inList = function (list) { return list.indexOf(ctx.userId) >= 0; };
    if (id === 'titulo') return ctx.titlesWon.some(function (t) { return t === 'Apertura' || t === 'Clausura' || t === 'Campeón de Liga'; });
    if (ctx.relegated) return false;
    if (id === 'libertadores') return inList(ctx.qual.libertadores);
    if (id === 'copas') return inList(ctx.qual.libertadores) || inList(ctx.qual.sudamericana);
    if (id === 'mitad') return ctx.pos <= 15;
    return true; // permanencia
  }

  function evaluateObjectives(game, ctx) {
    const career = game.career;
    const season = game.season;
    const list = [];
    const exp = levelOf(career.expectation);
    const lo = findOpt(LEAGUE_OBJECTIVES, career.objectives.league);
    if (lo) {
      const met = leagueObjectiveMet(lo.id, ctx);
      const rel = lo.level - exp;
      list.push({ kind: 'league', id: lo.id, label: lo.label, met: met, delta: met ? U.clamp(20 + 2.5 * rel, 15, 25) : -U.clamp(27.5 - 3 * rel, 20, 35) });
    }
    const co = findOpt(CUP_OBJECTIVES, career.objectives.cup);
    if (co) {
      const cont = userContinental(season, ctx.userId);
      const cupCfg = season.cups.libertadores;
      const met = !!cont && C.stageRank(cupCfg, cont.stage) >= C.stageRank(cupCfg, co.stage);
      list.push({ kind: 'cup', id: co.id, label: co.label, met: met, delta: met ? 12 : -16 });
    }
    const ca = findOpt(CA_OBJECTIVES, career.objectives.copaArgentina);
    if (ca) {
      const cup = season.cups.copaArgentina;
      const met = C.stageRank(cup, cup.stage[ctx.userId]) >= C.stageRank(cup, ca.stage);
      list.push({ kind: 'copaArgentina', id: ca.id, label: ca.label, met: met, delta: met ? 10 : -12 });
    }
    return list;
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

  function finishSeason(game) {
    const world = game.world;
    const career = game.career;
    const season = game.season;
    if (career.phase !== 'season' || !EM.Season.isSeasonOver(season)) return { ok: false, message: 'La temporada todavía no terminó.' };
    const user = career.clubId;
    const year = career.year;
    const ap = season.torneos.apertura;
    const cl = season.torneos.clausura;
    const cups = season.cups;
    const annual = L.annualTable(ap, cl);
    const pos = annual.findIndex(function (r) { return r.clubId === user; }) + 1;
    const row = annual[pos - 1];

    L.pushPromedios(world, annual);
    const relegated = L.relegation(annual, function (id) { return L.promedio(world, id); });
    const qual = L.qualification({
      apertura: ap.champion, clausura: cl.champion, copaArgentinaChampion: cups.copaArgentina.champion,
      annual: annual, relegated: relegated
    });
    const leagueChamp = annual[0].clubId;

    addTitle(world, ap.champion, year, 'Apertura');
    addTitle(world, cl.champion, year, 'Clausura');
    addTitle(world, leagueChamp, year, 'Campeón de Liga');
    addTitle(world, cups.copaArgentina.champion, year, 'Copa Argentina');
    addTitle(world, cups.libertadores.champion, year, 'Copa Libertadores');
    addTitle(world, cups.sudamericana.champion, year, 'Copa Sudamericana');
    const titlesWon = [];
    if (ap.champion === user) titlesWon.push('Apertura');
    if (cl.champion === user) titlesWon.push('Clausura');
    if (leagueChamp === user) titlesWon.push('Campeón de Liga');
    if (cups.copaArgentina.champion === user) titlesWon.push('Copa Argentina');
    if (cups.libertadores.champion === user) titlesWon.push('Copa Libertadores');
    if (cups.sudamericana.champion === user) titlesWon.push('Copa Sudamericana');

    credit(career, ANNUAL_PRIZE(pos), 'Premio por la tabla anual (puesto ' + pos + ')', season.lastDate);

    const isRelegated = relegated.indexOf(user) >= 0;
    const ctx = { userId: user, pos: pos, qual: qual, relegated: isRelegated, titlesWon: titlesWon };
    const objectives = evaluateObjectives(game, ctx);
    let delta = titlesWon.length * 10;
    objectives.forEach(function (ob) { delta += ob.delta; });
    if (isRelegated) delta -= 25;
    career.confidence = U.clamp(Math.round(career.confidence + delta), 0, 100);

    const promoted = promoteAndRelegate(world, relegated);
    world.qualified = qual;

    if (isRelegated) career.sackedReason = 'Descenso';
    else if (career.confidence <= 0) career.sackedReason = 'La directiva decidió no continuar';

    const club = world.clubs[user];
    const top = club.players.slice().sort(function (a, b) { return b.season.goals - a.season.goals; })[0];
    const cont = userContinental(season, user);
    const record = {
      year: year, clubId: user, annualPos: pos, points: row.points,
      apertura: L.stageReached(ap, user), clausura: L.stageReached(cl, user),
      continental: cont, copaArgentina: cups.copaArgentina.stage[user],
      titles: titlesWon, topScorer: top && top.season.goals > 0 ? { name: top.name, goals: top.season.goals } : null,
      objectiveMet: objectives.length ? objectives[0].met : false, objectives: objectives,
      budgetEnd: career.budget, confidenceEnd: career.confidence
    };
    career.history.push(record);

    career.summary = {
      year: year, userPos: pos, userRow: row, titles: titlesWon, objectives: objectives, confidenceDelta: Math.round(delta),
      qualification: qual, relegated: relegated, promoted: promoted, relegatedUser: isRelegated,
      qualifiedLibertadores: qual.libertadores.indexOf(user) >= 0, qualifiedSudamericana: qual.sudamericana.indexOf(user) >= 0,
      champions: {
        apertura: ap.champion, clausura: cl.champion, liga: leagueChamp, copaArgentina: cups.copaArgentina.champion,
        libertadores: cups.libertadores.champion, sudamericana: cups.sudamericana.champion
      },
      topScorers: EM.Season.topScorers(season, 5),
      sacked: !!career.sackedReason, sackedReason: career.sackedReason
    };
    addNews(career, {
      date: season.lastDate, type: 'season', title: 'Temporada ' + year + ' finalizada',
      body: 'Terminaste ' + pos + '° en la tabla anual' + (titlesWon.length ? ' y ganaste: ' + titlesWon.join(', ') + '.' : '.')
    });
    if (career.sackedReason) {
      addNews(career, { date: season.lastDate, type: 'board', title: 'Fin del ciclo', body: career.sackedReason + '.' });
    }
    career.phase = 'review';
    career.window = null;
    return { ok: true, summary: career.summary };
  }

  // ---- next season --------------------------------------------------------------------------------------------------------------------------------------
  function allPlayers(world) {
    let all = [];
    Object.keys(world.clubs).forEach(function (id) { all = all.concat(world.clubs[id].players); });
    world.foreignClubs.forEach(function (c) { all = all.concat(c.players); });
    return all.concat(world.freeAgents);
  }

  function dropToFreeAgents(world, club, player) {
    S.removeFromSquad(club, player.id);
    player.clubId = null;
    player.contract = 0;
    player.listed = null;
    player.loan = null;
    world.freeAgents.push(player);
  }

  function rollContracts(game, rng) {
    const world = game.world;
    const career = game.career;
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      club.players.slice().forEach(function (p) {
        p.contract -= 1;
        if (p.contract > 0) return;
        if (id === career.clubId) {
          dropToFreeAgents(world, club, p);
          addNews(career, { type: 'transfer', title: p.name + ' se va libre', body: 'Terminó su contrato y no fue renovado.' });
        } else if (club.players.length > 24 && rng.chance(0.25)) {
          dropToFreeAgents(world, club, p);
        } else {
          p.contract = rng.int(2, 4); // AI clubs renew automatically
        }
      });
    });
  }

  function retire(game) {
    const world = game.world;
    const career = game.career;
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      club.players.slice().forEach(function (p) {
        if (!P.shouldRetire(p)) return;
        S.removeFromSquad(club, p.id);
        if (id === career.clubId) addNews(career, { type: 'transfer', title: p.name + ' se retira', body: 'Colgó los botines a los ' + p.age + ' años.' });
      });
    });
    world.foreignClubs.forEach(function (c) { c.players = c.players.filter(function (p) { return !P.shouldRetire(p); }); });
    world.freeAgents = world.freeAgents.filter(function (p) { return !P.shouldRetire(p); });
    world.freeAgents.sort(function (a, b) { return b.rating - a.rating; });
    if (world.freeAgents.length > 60) world.freeAgents.length = 60;
  }

  function youthIntake(game, rng) {
    const world = game.world;
    const career = game.career;
    Object.keys(world.clubs).forEach(function (id) {
      const club = world.clubs[id];
      if (id === career.clubId) {
        const n = 2 + career.academyLevel;
        const added = [];
        for (let i = 0; i < n && club.players.length < EM.Market.MAX_SQUAD; i++) {
          const y = P.generateYouth(id, rng, career.academyLevel);
          y.number = P.freeNumber(club.players);
          club.players.push(y);
          added.push(y.name);
        }
        if (added.length) addNews(career, { type: 'board', title: 'Llegan ' + added.length + ' juveniles de las inferiores', body: added.join(', ') + '.' });
        return;
      }
      while (club.players.length < 24) {
        const y = P.generateYouth(id, rng, 0);
        y.number = P.freeNumber(club.players);
        club.players.push(y);
      }
      if (club.players.length > 34) {
        club.players.sort(function (a, b) { return a.rating - b.rating; });
        while (club.players.length > 34) dropToFreeAgents(world, club, club.players[0]);
      }
    });
  }

  function startNextSeason(game) {
    const world = game.world;
    const career = game.career;
    if (career.phase !== 'review') return { ok: false, message: 'Primero hay que cerrar la temporada.' };
    if (career.sackedReason || career.seasonIndex + 1 >= career.maxSeasons) {
      career.phase = 'ended';
      career.window = null;
      addNews(career, { type: 'season', title: 'Fin de la carrera', body: career.sackedReason ? 'Tu ciclo terminó: ' + career.sackedReason + '.' : 'Completaste las ' + career.maxSeasons + ' temporadas.' });
      return { ok: true, ended: true };
    }
    const rng = U.careerRng(career);
    const loaned = {};
    allPlayers(world).forEach(function (p) { if (p.loan && p.loan.from === career.clubId) loaned[p.id] = true; });
    EM.Market.returnLoans(world, career);

    // Career stats: roll the finished season into the totals.
    allPlayers(world).forEach(function (p) {
      p.career.apps += p.season.apps; p.career.goals += p.season.goals; p.career.assists += p.season.assists;
      if (p.season.apps > 0) p.career.seasons += 1;
      p.season = { apps: 0, goals: 0, assists: 0 };
      p.injury = 0;
    });

    career.seasonIndex += 1;
    career.year += 1;
    rollContracts(game, rng);
    allPlayers(world).forEach(function (p) { P.develop(p, rng, { loanBonus: !!loaned[p.id] }); });
    retire(game);
    youthIntake(game, rng);
    C.drift(world, rng);

    const club = userClub(game);
    S.cleanLineup(career, club);
    career.mods = { coach: 0, academy: 0, stadium: 0, cohesion: 0, captain: 0, total: 0 };
    career.objectives = { league: null, cup: null, copaArgentina: null };
    career.objEffects = null;
    career.expectation = expectationFor(world, career.clubId);
    career.decisionEvent = buildDecisionEvent(world, career);
    career.preseason = newPreseason(world, career, rng);
    career.negotiations = {};
    career.window = 'pre';
    career.phase = 'preseason';
    career.today = career.year + '-01-10';
    career.summary = null;
    game.season = EM.Season.createSeason(world, career, rng);
    addNews(career, { type: 'season', title: 'Comienza la pretemporada ' + career.year, body: 'La directiva espera: ' + findOpt(LEAGUE_OBJECTIVES, career.expectation).label.toLowerCase() + '.' });
    return { ok: true, ended: false };
  }

  // ---- dashboard -------------------------------------------------------------------------------------------------------------------------------------------
  function currentTorneo(season) {
    const played = season.torneos.clausura.table[season.userClubId].played + (season.torneos.clausura.playoffs.stage ? 1 : 0);
    return played > 0 ? season.torneos.clausura : season.torneos.apertura;
  }

  function objectiveProgress(game) {
    const career = game.career;
    const season = game.season;
    const out = [];
    if (!career.objectives.league) return out;
    const annual = L.annualTable(season.torneos.apertura, season.torneos.clausura);
    const pos = annual.findIndex(function (r) { return r.clubId === career.clubId; }) + 1;
    const lo = findOpt(LEAGUE_OBJECTIVES, career.objectives.league);
    out.push({ kind: 'league', id: lo.id, label: lo.label, detail: 'Tabla anual: ' + pos + '°' });
    const co = findOpt(CUP_OBJECTIVES, career.objectives.cup);
    if (co) {
      const cont = userContinental(season, career.clubId);
      out.push({ kind: 'cup', id: co.id, label: co.label, detail: cont ? cont.name + ': ' + cont.stage : 'Sin participación' });
    }
    const ca = findOpt(CA_OBJECTIVES, career.objectives.copaArgentina);
    if (ca) out.push({ kind: 'copaArgentina', id: ca.id, label: ca.label, detail: 'Copa Argentina: ' + season.cups.copaArgentina.stage[career.clubId] });
    return out;
  }

  function activeCompetitions(game) {
    const season = game.season;
    const user = game.career.clubId;
    const out = [];
    ['apertura', 'clausura'].forEach(function (k) {
      const t = season.torneos[k];
      out.push({ key: k, name: t.name, stage: L.stageReached(t, user), done: t.done });
    });
    ['libertadores', 'sudamericana', 'copaArgentina'].forEach(function (k) {
      const cup = season.cups[k];
      if (cup.stage[user] === undefined) return;
      out.push({ key: k, name: cup.name, stage: cup.stage[user], out: !!cup.out[user], done: cup.done });
    });
    return out;
  }

  function getDashboard(game) {
    const career = game.career;
    const season = game.season;
    const world = game.world;
    const club = userClub(game);
    const torneo = currentTorneo(season);
    const zone = torneo.table[career.clubId].zone;
    const zt = L.zoneTable(torneo, zone);
    const annual = L.annualTable(season.torneos.apertura, season.torneos.clausura);
    const nxt = career.phase === 'season' || career.phase === 'preseason' ? EM.Season.describeNext(game) : null;
    let next = null;
    if (nxt) {
      const m = nxt.match;
      const oppId = m ? (m.home === career.clubId ? m.away : m.home) : null;
      next = {
        label: nxt.md.label, date: nxt.md.date, comp: nxt.md.comp, window: !!nxt.window, tentative: !!nxt.tentative,
        home: m ? m.home === career.clubId : null, neutral: m ? !!m.neutral : null,
        opponentId: oppId, opponent: oppId ? C.teamInfo(world, oppId) : null
      };
    }
    return {
      date: season.lastDate || career.today,
      phase: career.phase, window: career.window,
      next: next,
      torneo: { key: torneo.key, name: torneo.name, zone: zone, position: zt.findIndex(function (r) { return r.clubId === career.clubId; }) + 1, row: torneo.table[career.clubId] },
      annual: { position: annual.findIndex(function (r) { return r.clubId === career.clubId; }) + 1, row: annual.filter(function (r) { return r.clubId === career.clubId; })[0] },
      objectives: objectiveProgress(game),
      squad: Object.assign(S.summary(club), { needs: S.needs(club) }),
      budget: career.budget, confidence: career.confidence,
      transfers: (career.transfers || []).slice(0, 5),
      competitions: activeCompetitions(game)
    };
  }

  function getFinalSummary(game) {
    const career = game.career;
    return {
      seasons: career.history.length,
      history: career.history,
      titles: (game.world.titles[career.clubId] || []).slice(),
      sackedReason: career.sackedReason,
      budget: career.budget
    };
  }

  EM.Career = {
    VERSION: VERSION,
    LEAGUE_OBJECTIVES: LEAGUE_OBJECTIVES,
    CUP_OBJECTIVES: CUP_OBJECTIVES,
    CA_OBJECTIVES: CA_OBJECTIVES,
    BASE_INCOME: BASE_INCOME,
    newGame: newGame,
    userClub: userClub,
    credit: credit,
    addNews: addNews,
    objectiveOptions: objectiveOptions,
    setObjectives: setObjectives,
    pitchSponsor: pitchSponsor,
    chooseOption: chooseOption,
    friendlyOptions: friendlyOptions,
    playFriendly: playFriendly,
    setFormation: setFormation,
    setCaptain: setCaptain,
    checkPreseason: checkPreseason,
    canStartSeason: canStartSeason,
    startSeason: startSeason,
    finishSeason: finishSeason,
    startNextSeason: startNextSeason,
    getDashboard: getDashboard,
    getFinalSummary: getFinalSummary,
    recomputeMods: recomputeMods
  };
})(window.EM = window.EM || {});
