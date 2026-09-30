// ELMANAGER engine: the five pre-season tasks (decision, sell, loan, sign, formation) and the state the hub reads.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const S = EM.Squad;
  const M = EM.Market;

  const TASKS = ['preSeason', 'sell', 'loan', 'sign', 'formation'];
  const SPONSOR_ATTEMPTS = 3;

  function userClub(game) { return game.world.clubs[game.career.clubId]; }
  function fail(message, code) { return { ok: false, message: message, code: code || null }; }

  // ---- pre-season decision (sponsor / coach / academy / stadium) --------------------------------------------------
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

  // The event type rotates every season and starts at a different point for each club.
  function buildDecisionEvent(club, seasonIndex) {
    const h = U.hashStr(club.id);
    const type = EVENT_TYPES[(h + seasonIndex) % 4];
    if (type === 'sponsor') {
      return {
        type: type, title: 'Sponsor de camiseta', done: false, attemptsLeft: SPONSOR_ATTEMPTS, result: null,
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

  function findOpt(list, id) { return list.filter(function (o) { return o.id === id; })[0] || null; }

  function recomputeMods(career) {
    const m = career.mods;
    m.total = U.round1(m.coach + m.academy + m.stadium + m.level);
  }

  function finishDecision(career, result) {
    career.decisionEvent.done = true;
    career.decisionEvent.result = result;
    career.tasks.preSeason = true;
  }

  // Sponsor: one pitch per call (3 attempts); a success pays the fee. Other events apply the chosen option.
  function chooseDecision(game, optionId) {
    const career = game.career;
    const ev = career.decisionEvent;
    const err = gate(game, 'preSeason');
    if (err) return err;
    if (ev.done) return fail('Ya resolviste la decisión de esta pretemporada.');
    const opt = findOpt(ev.options, optionId);
    if (!opt) return fail('Opción inexistente.');

    if (ev.type === 'sponsor') {
      const success = U.careerRng(career).chance(opt.prob / 100);
      ev.attemptsLeft -= 1;
      if (success) {
        career.budget = U.round1(career.budget + opt.fee);
        finishDecision(career, { success: true, name: opt.name, fee: opt.fee });
      } else if (ev.attemptsLeft <= 0) {
        finishDecision(career, { success: false });
      }
      return { ok: true, kind: 'sponsor', success: success, attemptsLeft: ev.attemptsLeft, done: ev.done, name: opt.name, fee: opt.fee };
    }

    if (opt.cost > career.budget + 1e-9) return fail('No alcanza el presupuesto.', 'budget');
    career.budget = U.round1(career.budget - opt.cost);
    if (ev.type === 'coach') {
      career.mods.coach = opt.strengthMod;
      if (!opt.incumbent) userClub(game).coach = opt.name;
    } else if (ev.type === 'academy') {
      career.mods.academy = opt.strengthMod;
      career.academyLevel = Math.min(5, career.academyLevel + opt.level);
    } else {
      career.mods.stadium = opt.strengthMod;
    }
    recomputeMods(career);
    finishDecision(career, { optionId: opt.id, name: opt.name, cost: opt.cost });
    return { ok: true, kind: ev.type, done: true, name: opt.name };
  }

  // ---- task plumbing --------------------------------------------------------------------------------------------------
  function newPre() { return { sales: {}, loans: {}, signings: {} }; }

  function isUnlocked(career, key) {
    const i = TASKS.indexOf(key);
    return i <= 0 || !!career.tasks[TASKS[i - 1]];
  }

  // null when the task can be worked on, otherwise a failure result.
  function gate(game, key) {
    const career = game.career;
    if (career.phase !== 'preseason') return fail('La pretemporada ya terminó.');
    if (!isUnlocked(career, key)) return fail('Primero completá la tarea anterior.');
    return null;
  }

  // After the squad changes: drop departed players from the XI; an incomplete XI must be confirmed again.
  function squadChanged(game) {
    const club = userClub(game);
    S.cleanLineup(game.career, club);
    if (!S.isComplete(game.career, club)) game.career.tasks.formation = false;
  }

  function unique(ids) { return ids.filter(function (id, i) { return ids.indexOf(id) === i; }); }

  function findIn(club, id) { return club.players.filter(function (p) { return p.id === id; })[0] || null; }

  // Players the sell / loan sheets list: the original squad (no signings, no players already sent away
  // by the other task) plus the ones already selected in that task, so a selection can be undone.
  function outgoingCandidates(game, recordKey, otherKey) {
    const pre = game.career.pre;
    const club = userClub(game);
    const base = club.players.filter(function (p) { return !pre.signings[p.id]; });
    const chosen = Object.keys(pre[recordKey]).map(function (id) {
      const found = S.findPlayer(game.world, id);
      return found ? found.player : null;
    }).filter(Boolean);
    return base.concat(chosen).filter(function (p) { return !pre[otherKey][p.id]; });
  }

  function sellCandidates(game) { return outgoingCandidates(game, 'sales', 'loans'); }
  function loanCandidates(game) { return outgoingCandidates(game, 'loans', 'sales'); }

  // Shared by sell and loan: `ids` is the full selection; new ones leave, dropped ones come back.
  function setOutgoing(game, task, ids, opts) {
    const err = gate(game, task);
    if (err) return err;
    const career = game.career;
    const world = game.world;
    const club = userClub(game);
    const record = career.pre[opts.record];
    const selection = unique(ids);
    if (selection.length > opts.limit) return fail('Podés elegir hasta ' + opts.limit + ' jugadores.', 'limit');

    const leaving = [];
    for (let i = 0; i < selection.length; i++) {
      const id = selection[i];
      if (record[id]) continue;
      const p = findIn(club, id);
      if (!p || career.pre.signings[id]) return fail('Jugador inválido.');
      leaving.push(p);
    }
    const returning = Object.keys(record).filter(function (id) { return selection.indexOf(id) < 0; });

    const money = U.sum(leaving, opts.income) - U.sum(returning, function (id) { return opts.refund(record[id]); });
    if (career.budget + money < -1e-9) return fail('No podés deshacer esa operación: ya gastaste esa plata.', 'budget');
    if (returning.length > leaving.length && club.players.length + returning.length - leaving.length > M.MAX_SQUAD) return fail('El plantel superaría el máximo de ' + M.MAX_SQUAD + ' jugadores.', 'squad');

    returning.forEach(function (id) {
      const holder = S.getClub(world, record[id].to);
      const p = findIn(holder, id);
      if (p) { M.transfer(p, holder, club); opts.onReturn(p); }
      delete record[id];
    });
    const rng = U.careerRng(career);
    leaving.forEach(function (p) {
      const target = rng.pick(M.aiBuyers(world, career));
      M.transfer(p, club, target);
      record[p.id] = opts.onLeave(p, target);
    });
    career.budget = U.round1(career.budget + money);
    career.tasks[task] = true;
    squadChanged(game);
    return { ok: true, count: selection.length, money: U.round1(money) };
  }

  // Sell up to 8 players at their value to random Liga Profesional clubs (the player really moves there).
  function sellPlayers(game, ids) {
    return setOutgoing(game, 'sell', ids, {
      record: 'sales', limit: M.SELL_LIMIT,
      income: function (p) { return p.value; },
      refund: function (rec) { return rec.fee; },
      onLeave: function (p, target) { return { to: target.id, fee: p.value }; },
      onReturn: function () {}
    });
  }

  // Loan up to 5 players out for the season; they come back at the next pre-season.
  function loanPlayers(game, ids) {
    return setOutgoing(game, 'loan', ids, {
      record: 'loans', limit: M.LOAN_LIMIT,
      income: function () { return 0; },
      refund: function () { return 0; },
      onLeave: function (p, target) {
        p.loan = { from: game.career.clubId, until: game.career.seasonIndex };
        return { to: target.id };
      },
      onReturn: function (p) { p.loan = null; }
    });
  }

  function signPlayer(game, playerId) {
    const err = gate(game, 'sign');
    if (err) return err;
    const career = game.career;
    const club = userClub(game);
    const found = S.findPlayer(game.world, playerId);
    if (!found || found.club.id === club.id || found.club.division === 'PN' || found.player.loan) return fail('El jugador ya no está disponible.');
    if (club.players.length >= M.MAX_SQUAD) return fail('El plantel está completo (máximo ' + M.MAX_SQUAD + ').', 'squad');
    const price = M.priceOf(found.player, found.club);
    if (price > career.budget + 1e-9) return fail('No alcanza el presupuesto.', 'budget');
    if (found.club.division && found.club.players.length <= M.SELLER_MIN_SQUAD) return fail(found.club.name + ' no quiere quedarse sin plantel.', 'seller');
    const pre = career.pre;
    pre.refused = pre.refused || {};
    if (pre.refused[playerId]) return fail(found.player.name + ' ya rechazó tu oferta esta pretemporada.', 'refused');
    const interest = M.interestOf(game.world, career, found.player, found.club);
    if (!M.decides(career, found.player, interest)) {
      pre.refused[playerId] = true;
      return fail(found.player.name + ' rechazó la oferta: busca un club con más prestigio.', 'refused');
    }
    M.transfer(found.player, found.club, club);
    career.budget = U.round1(career.budget - price);
    career.pre.signings[playerId] = { from: found.club.id, price: price };
    return { ok: true, price: price };
  }

  // Undo a signing made in this pre-season: the player goes back to his club and the money is refunded.
  function unsignPlayer(game, playerId) {
    const err = gate(game, 'sign');
    if (err) return err;
    const career = game.career;
    const club = userClub(game);
    const rec = career.pre.signings[playerId];
    const p = findIn(club, playerId);
    if (!rec || !p) return fail('Ese fichaje no se puede deshacer.');
    M.transfer(p, club, S.getClub(game.world, rec.from));
    career.budget = U.round1(career.budget + rec.price);
    delete career.pre.signings[playerId];
    squadChanged(game);
    return { ok: true, refund: rec.price };
  }

  function confirmSigning(game) {
    const err = gate(game, 'sign');
    if (err) return err;
    game.career.tasks.sign = true;
    return { ok: true };
  }

  function signedPlayers(game) {
    const club = userClub(game);
    const signings = game.career.pre.signings;
    return club.players.filter(function (p) { return signings[p.id]; }).map(function (p) {
      return { player: p, price: signings[p.id].price, from: S.getClub(game.world, signings[p.id].from) };
    });
  }

  function search(game, filters) { return M.search(game.world, game.career, filters); }

  // ---- lineup ------------------------------------------------------------------------------------------------------------------
  function setFormation(game, name) {
    const err = gate(game, 'formation');
    if (err) return err;
    if (!EM.Positions.FORMATIONS[name]) return fail('Formación inexistente.');
    const lineup = game.career.lineup;
    if (lineup.formation !== name) { lineup.formation = name; lineup.slots = {}; }
    game.career.tasks.formation = false;
    return { ok: true };
  }

  function assignSlot(game, slotId, playerId) {
    const err = gate(game, 'formation');
    if (err) return err;
    const lineup = game.career.lineup;
    const slot = EM.Positions.slotsOf(lineup.formation).filter(function (s) { return s.id === slotId; })[0];
    if (!slot || !findIn(userClub(game), playerId)) return fail('Posición o jugador inválido.');
    S.setSlot(lineup, slotId, playerId);
    game.career.tasks.formation = false;
    return { ok: true };
  }

  function clearSlot(game, slotId) {
    const err = gate(game, 'formation');
    if (err) return err;
    delete game.career.lineup.slots[slotId];
    game.career.tasks.formation = false;
    return { ok: true };
  }

  // Tries every formation with its best XI and keeps the strongest one (replaces the current lineup).
  function autoFill(game) {
    const err = gate(game, 'formation');
    if (err) return err;
    const players = userClub(game).players;
    let best = null;
    EM.Positions.FORMATION_NAMES.forEach(function (name) {
      const xi = S.bestXI(players, name);
      if (!best || xi.strength > best.strength) best = xi;
    });
    const lineup = game.career.lineup;
    lineup.formation = best.formation;
    lineup.slots = {};
    Object.keys(best.slots).forEach(function (slotId) { lineup.slots[slotId] = best.slots[slotId].id; });
    game.career.tasks.formation = false;
    return { ok: true, formation: best.formation, strength: U.round1(best.strength) };
  }

  function confirmFormation(game) {
    const err = gate(game, 'formation');
    if (err) return err;
    if (!S.isComplete(game.career, userClub(game))) return fail('Faltan jugadores en el equipo titular.');
    game.career.tasks.formation = true;
    return { ok: true };
  }

  // ---- state for the UI ---------------------------------------------------------------------------------------------------------
  function canSimulate(game) {
    const career = game.career;
    return career.phase === 'preseason' && TASKS.every(function (k) { return career.tasks[k]; }) &&
      S.isComplete(career, userClub(game)) && userClub(game).players.length >= M.MIN_SQUAD;
  }

  function taskState(game) {
    const career = game.career;
    const pre = career.pre;
    const tasks = {};
    let current = null;
    TASKS.forEach(function (k) {
      tasks[k] = { key: k, done: !!career.tasks[k], unlocked: isUnlocked(career, k) };
      if (!current && !career.tasks[k]) current = k;
    });
    return {
      order: TASKS, tasks: tasks, current: current,
      doneCount: TASKS.filter(function (k) { return career.tasks[k]; }).length, total: TASKS.length,
      squadSize: userClub(game).players.length, budget: career.budget,
      counts: { sold: Object.keys(pre.sales).length, loaned: Object.keys(pre.loans).length, signed: Object.keys(pre.signings).length },
      decision: career.decisionEvent, formation: career.lineup.formation,
      canSimulate: canSimulate(game)
    };
  }

  // Competitions of the season, last season's record and the budget / rollover notes for the hub panel.
  function seasonInfo(game) {
    const career = game.career;
    const season = game.season;
    const user = career.clubId;
    const competitions = [
      { key: 'apertura', name: 'Apertura' },
      { key: 'clausura', name: 'Clausura' },
      { key: 'copaArgentina', name: 'Copa Argentina' }
    ];
    ['libertadores', 'sudamericana'].forEach(function (k) {
      if (season.userCups.indexOf(k) < 0) return;
      const cup = season.cups[k];
      competitions.push({ key: k, name: cup.name, phase2: !!(cup.slot && cup.slot.arg === user) });
    });
    return {
      year: career.year, index: career.seasonIndex + 1, total: career.maxSeasons,
      competitions: competitions,
      last: career.history.length ? career.history[career.history.length - 1] : null,
      breakdown: career.budgetBreakdown, rollover: career.rollover
    };
  }

  EM.PreSeason = {
    TASKS: TASKS,
    SPONSOR_ATTEMPTS: SPONSOR_ATTEMPTS,
    userClub: userClub,
    fail: fail,
    newPre: newPre,
    buildDecisionEvent: buildDecisionEvent,
    taskState: taskState,
    seasonInfo: seasonInfo,
    chooseDecision: chooseDecision,
    sellCandidates: sellCandidates,
    loanCandidates: loanCandidates,
    sellPlayers: sellPlayers,
    loanPlayers: loanPlayers,
    search: search,
    signPlayer: signPlayer,
    unsignPlayer: unsignPlayer,
    confirmSigning: confirmSigning,
    signedPlayers: signedPlayers,
    setFormation: setFormation,
    assignSlot: assignSlot,
    clearSlot: clearSlot,
    autoFill: autoFill,
    confirmFormation: confirmFormation,
    canSimulate: canSimulate
  };
})(window.EM = window.EM || {});
