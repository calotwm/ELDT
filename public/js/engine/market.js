// ELMANAGER engine: transfer market (search, negotiation, loans, offers, contracts).
// Transfers are only allowed while career.window is 'pre' or 'mid'. Players MOVE between squads,
// so the world stays consistent (a seller loses the player). Money is USD millions, 1 decimal.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const S = EM.Squad;

  const MAX_SQUAD = 32;
  const MIN_SQUAD = 18;
  const MAX_ATTEMPTS = 3;
  const MAX_LOANS_IN = 4;          // game parameter: concurrent loans into the user squad
  const SELLER_MIN_SQUAD = 16;     // AI clubs refuse to sell below this
  const TIER_MULT = { 1: 1.35, 2: 1.15, 3: 1.0 };
  const REGIONS = ['ARG', 'ASC', 'Brasil', 'Uruguay', 'Europa', 'América', 'Libre'];

  function windowOpen(career) { return career.window === 'pre' || career.window === 'mid'; }

  function regionOf(club) {
    if (!club) return 'Libre';
    if (club.division === 'LP') return 'ARG';
    if (club.division === 'PN') return 'ASC';
    return club.region || 'Europa';
  }

  function isDomestic(club) { return !!club && !!club.division; }

  // Price to buy a player from `club` (null = free agent, priced 0).
  function priceOf(player, club) {
    if (!club) return 0;
    return Math.max(0.1, U.round1(player.value * (TIER_MULT[club.tier] || 1)));
  }

  // Free agents ask for a signing bonus of 10% of their value.
  function costOf(player, club) {
    return club ? priceOf(player, club) : Math.max(0.1, U.round1(player.value * 0.1));
  }

  function inBestXI(club, playerId) {
    if (!isDomestic(club)) return false;
    const b = S.bestXI(club.players, '4-3-3');
    return Object.keys(b.slots).some(function (k) { return b.slots[k].id === playerId; });
  }

  function canAfford(career, amount) { return career.budget + 1e-9 >= amount; }

  function userClub(world, career) { return world.clubs[career.clubId]; }

  function result(ok, message, extra) { return Object.assign({ ok: ok, message: message }, extra || {}); }

  // ---- search ---------------------------------------------------------------------------------
  // filters: { q, pos, line, region, maxPrice, age (max age) }. Sorted by rating, limited to 80.
  function search(world, career, f) {
    const filters = f || {};
    const q = filters.q ? U.norm(filters.q) : '';
    const maxAge = filters.maxAge != null ? filters.maxAge : filters.age;
    const items = [];

    function consider(player, club) {
      if (player.loan) return;
      const region = regionOf(club);
      const price = costOf(player, club);
      if (filters.region && filters.region !== region) return;
      if (filters.pos && player.pos !== filters.pos) return;
      if (filters.line && EM.Positions.line(player.pos) !== filters.line) return;
      if (filters.maxPrice != null && price > filters.maxPrice) return;
      if (maxAge != null && player.age > maxAge) return;
      if (q && U.norm(player.name).indexOf(q) < 0) return;
      items.push({ player: player, club: club, region: region, price: price, free: !club });
    }

    Object.keys(world.clubs).forEach(function (id) {
      if (id === career.clubId) return;
      world.clubs[id].players.forEach(function (p) { consider(p, world.clubs[id]); });
    });
    world.foreignClubs.forEach(function (c) { c.players.forEach(function (p) { consider(p, c); }); });
    world.freeAgents.forEach(function (p) { consider(p, null); });

    items.sort(function (a, b) { return (b.player.rating - a.player.rating) || (b.player.value - a.player.value); });
    return items.slice(0, 80);
  }

  // ---- moving players ----------------------------------------------------------------------------
  function detach(world, playerId) {
    const found = S.findPlayer(world, playerId);
    if (!found) return null;
    if (found.club) S.removeFromSquad(found.club, playerId);
    else world.freeAgents.splice(world.freeAgents.indexOf(found.player), 1);
    return found;
  }

  function attachToUser(world, career, player, contract) {
    const club = userClub(world, career);
    player.clubId = club.id;
    player.contract = contract;
    player.listed = null;
    if (club.players.some(function (p) { return p.number === player.number; })) player.number = EM.Players.freeNumber(club.players);
    club.players.push(player);
  }

  function logTransfer(career, entry) {
    if (!career.transfers) career.transfers = [];
    career.transfers.unshift(Object.assign({ date: career.today }, entry));
    if (career.transfers.length > 30) career.transfers.length = 30;
  }

  // ---- buying ------------------------------------------------------------------------------------------
  function checkBuy(world, career, found, cost) {
    if (!windowOpen(career)) return 'El mercado de pases está cerrado.';
    if (!found) return 'El jugador ya no está disponible.';
    if (found.club && found.club.id === career.clubId) return 'Ese jugador ya es de tu club.';
    if (found.player.loan) return 'Ese jugador está cedido y no se puede comprar.';
    if (userClub(world, career).players.length >= MAX_SQUAD) return 'El plantel está completo (máximo ' + MAX_SQUAD + ').';
    if (!canAfford(career, cost)) return 'No alcanza el presupuesto.';
    return null;
  }

  // Offer for a player. Returns { ok, accepted, message, attemptsLeft, blocked }.
  function negotiate(world, career, playerId, offer, years) {
    const found = S.findPlayer(world, playerId);
    const price = found ? costOf(found.player, found.club) : 0;
    const paying = found && !found.club ? price : Math.max(0, offer);
    const err = checkBuy(world, career, found, paying);
    if (err) return result(false, err, { accepted: false, blocked: true });
    const seller = found.club;
    if (isDomestic(seller) && seller.players.length <= SELLER_MIN_SQUAD) {
      return result(false, seller.name + ' no quiere quedarse sin plantel.', { accepted: false, blocked: true });
    }
    const used = career.negotiations[playerId] || 0;
    if (used >= MAX_ATTEMPTS) return result(false, 'Se agotaron los intentos de negociación por este jugador.', { accepted: false, blocked: true, attemptsLeft: 0 });

    let prob;
    if (!seller) prob = 0.9;
    else {
      prob = U.clamp(0.1 + (offer / price - 0.85) / 0.3 * 0.85, 0.03, 0.95);
      if (inBestXI(seller, playerId)) prob = Math.max(0.03, prob - 0.15);
    }
    career.negotiations[playerId] = used + 1;
    const left = MAX_ATTEMPTS - used - 1;
    const accepted = U.careerRng(career).chance(prob);
    if (!accepted) {
      return result(true, 'La oferta fue rechazada.', { accepted: false, attemptsLeft: left, probability: prob });
    }
    const name = found.player.name;
    detach(world, playerId);
    attachToUser(world, career, found.player, U.clamp(years || 3, 1, 5));
    EM.Career.credit(career, -paying, 'Fichaje de ' + name, career.today);
    logTransfer(career, { type: seller ? 'signing' : 'free', playerId: playerId, name: name, other: seller ? seller.name : 'Libre', fee: paying });
    EM.Career.addNews(career, {
      date: career.today, type: 'transfer', title: name + ' llega al club',
      body: seller ? 'Desde ' + seller.name + ' por ' + U.formatMoney(paying) + '.' : 'Firmó como jugador libre (prima de ' + U.formatMoney(paying) + ').'
    });
    return result(true, name + ' firmó con el club.', { accepted: true, attemptsLeft: left, fee: paying, probability: prob });
  }

  function loanFee(player) { return Math.max(0.1, U.round1(player.value * 0.1)); }

  function loansIn(world, career) {
    return userClub(world, career).players.filter(function (p) { return p.loan && p.loan.from !== career.clubId; }).length;
  }

  // Loan a player in: only players outside their club's best XI (any foreign player).
  function loanIn(world, career, playerId) {
    const found = S.findPlayer(world, playerId);
    if (found && !found.club) return result(false, 'Un jugador libre se ficha, no se pide prestado.');
    const fee = found ? loanFee(found.player) : 0;
    const err = checkBuy(world, career, found, fee);
    if (err) return result(false, err);
    if (inBestXI(found.club, playerId)) return result(false, found.club.name + ' no cede a un titular.');
    if (loansIn(world, career) >= MAX_LOANS_IN) return result(false, 'Ya tenés ' + MAX_LOANS_IN + ' préstamos activos.');
    if (isDomestic(found.club) && found.club.players.length <= SELLER_MIN_SQUAD) return result(false, found.club.name + ' no quiere quedarse sin plantel.');
    const name = found.player.name;
    const from = found.club.id;
    detach(world, playerId);
    attachToUser(world, career, found.player, found.player.contract);
    found.player.loan = { from: from, until: career.seasonIndex };
    EM.Career.credit(career, -fee, 'Préstamo de ' + name, career.today);
    logTransfer(career, { type: 'loanIn', playerId: playerId, name: name, other: found.club.name, fee: fee });
    EM.Career.addNews(career, { date: career.today, type: 'transfer', title: name + ' llega a préstamo', body: 'Cedido por ' + found.club.name + ' hasta fin de temporada.' });
    return result(true, name + ' llega a préstamo.', { fee: fee });
  }

  // ---- selling ---------------------------------------------------------------------------------------------
  function listPlayer(world, career, playerId, kind) {
    const p = userClub(world, career).players.filter(function (x) { return x.id === playerId; })[0];
    if (!p) return result(false, 'El jugador no pertenece al club.');
    p.listed = kind === 'transfer' || kind === 'loan' ? kind : null;
    return result(true, p.listed ? 'Jugador en la lista de ' + (p.listed === 'transfer' ? 'transferibles' : 'cedibles') + '.' : 'Jugador retirado de la lista.');
  }

  function domesticAiClubs(world, career) {
    return Object.keys(world.clubs).filter(function (id) { return id !== career.clubId; }).sort().map(function (id) { return world.clubs[id]; });
  }

  // 1-3 offers for a listed player, deterministic for the current window (same call, same offers).
  function offersFor(world, career, playerId) {
    const club = userClub(world, career);
    const p = club.players.filter(function (x) { return x.id === playerId; })[0];
    if (!p || !p.listed) return [];
    const rng = U.createRng(U.hashStr(playerId + '|' + career.seasonIndex + '|' + (career.window || 'x')));
    const userStrength = S.bestXI(club.players, '4-3-3').strength;
    let pool;
    if (p.listed === 'transfer') {
      pool = domesticAiClubs(world, career).filter(function (c) { return c.players.length < MAX_SQUAD; }).concat(world.foreignClubs);
    } else {
      pool = domesticAiClubs(world, career).filter(function (c) {
        return c.players.length < MAX_SQUAD && S.bestXI(c.players, '4-3-3').strength < userStrength;
      }).concat(world.foreignClubs.filter(function (c) { return c.tier === 3; }));
    }
    const n = Math.min(pool.length, rng.int(1, 3));
    const chosen = [];
    while (chosen.length < n) {
      const c = rng.pick(pool);
      if (chosen.indexOf(c) < 0) chosen.push(c);
    }
    const bonus = { 1: 0.08, 2: 0.03, 3: 0 };
    return chosen.map(function (c, i) {
      const fee = p.listed === 'transfer'
        ? U.round1(p.value * Math.min(1.2, rng.float(0.75, 1.12) + (bonus[c.tier] || 0)))
        : U.round1(p.value * rng.float(0, 0.08));
      return { id: playerId + ':' + i, kind: p.listed, clubId: c.id, clubName: c.name, region: regionOf(c), fee: fee };
    });
  }

  function moveOut(world, career, player, target) {
    const club = userClub(world, career);
    S.removeFromSquad(club, player.id);
    player.listed = null;
    player.clubId = target.id;
    target.players.push(player);
    S.cleanLineup(career, club);
  }

  function acceptOffer(world, career, playerId, offerId) {
    if (!windowOpen(career)) return result(false, 'El mercado de pases está cerrado.');
    const offer = offersFor(world, career, playerId).filter(function (o) { return o.id === offerId; })[0];
    if (!offer) return result(false, 'La oferta ya no está vigente.');
    const club = userClub(world, career);
    const p = club.players.filter(function (x) { return x.id === playerId; })[0];
    const target = S.getClub(world, offer.clubId);
    moveOut(world, career, p, target);
    if (offer.kind === 'transfer') {
      p.contract = Math.max(p.contract, 2);
      EM.Career.credit(career, offer.fee, 'Venta de ' + p.name, career.today);
      logTransfer(career, { type: 'sale', playerId: playerId, name: p.name, other: target.name, fee: offer.fee });
      EM.Career.addNews(career, { date: career.today, type: 'transfer', title: p.name + ' se va a ' + target.name, body: 'Venta por ' + U.formatMoney(offer.fee) + '.' });
    } else {
      p.loan = { from: career.clubId, until: career.seasonIndex };
      EM.Career.credit(career, offer.fee, 'Préstamo de ' + p.name, career.today);
      logTransfer(career, { type: 'loanOut', playerId: playerId, name: p.name, other: target.name, fee: offer.fee });
      EM.Career.addNews(career, { date: career.today, type: 'transfer', title: p.name + ' sale a préstamo', body: 'Jugará en ' + target.name + ' hasta fin de temporada.' });
    }
    return result(true, p.name + (offer.kind === 'transfer' ? ' fue vendido.' : ' fue cedido a préstamo.'), { fee: offer.fee });
  }

  // Immediate sale at 70% of value to a random domestic club.
  function quickSell(world, career, playerId) {
    if (!windowOpen(career)) return result(false, 'El mercado de pases está cerrado.');
    const club = userClub(world, career);
    const p = club.players.filter(function (x) { return x.id === playerId; })[0];
    if (!p) return result(false, 'El jugador no pertenece al club.');
    if (p.loan) return result(false, 'No se puede vender a un jugador cedido.');
    const buyers = domesticAiClubs(world, career).filter(function (c) { return c.players.length < MAX_SQUAD; });
    const target = U.careerRng(career).pick(buyers);
    const fee = U.round1(p.value * 0.7);
    moveOut(world, career, p, target);
    EM.Career.credit(career, fee, 'Venta rápida de ' + p.name, career.today);
    logTransfer(career, { type: 'sale', playerId: playerId, name: p.name, other: target.name, fee: fee });
    EM.Career.addNews(career, { date: career.today, type: 'transfer', title: p.name + ' se va a ' + target.name, body: 'Venta rápida por ' + U.formatMoney(fee) + '.' });
    return result(true, p.name + ' fue vendido.', { fee: fee });
  }

  // ---- contracts ------------------------------------------------------------------------------------------------
  function renewCost(player, years) { return U.round1(player.value * 0.2 * years); }

  function renew(career, player, years) {
    if (player.contract > 2) return result(false, 'El contrato todavía es largo: se renueva cuando quedan 2 años o menos.');
    if (player.age >= 34 && years > 1) return result(false, 'A partir de los 34 años solo se renueva por 1 año.');
    if (years > 3 && player.age >= 31) return result(false, 'No se firman más de 3 años a jugadores de 31 o más.');
    if (years < 1 || years > 5) return result(false, 'Duración inválida.');
    const cost = renewCost(player, years);
    if (!canAfford(career, cost)) return result(false, 'No alcanza el presupuesto.');
    player.contract = Math.min(5, player.contract + years);
    EM.Career.credit(career, -cost, 'Renovación de ' + player.name, career.today);
    return result(true, 'Contrato de ' + player.name + ' renovado.', { cost: cost });
  }

  function releaseCost(player) { return U.round1(player.contract * player.value * 0.15); }

  function release(world, career, playerId) {
    const club = userClub(world, career);
    const p = club.players.filter(function (x) { return x.id === playerId; })[0];
    if (!p) return result(false, 'El jugador no pertenece al club.');
    if (p.loan) return result(false, 'Un jugador a préstamo vuelve a su club a fin de temporada.');
    const cost = releaseCost(p);
    if (!canAfford(career, cost)) return result(false, 'No alcanza para pagar la indemnización.');
    S.removeFromSquad(club, playerId);
    p.clubId = null;
    p.contract = 0;
    p.listed = null;
    world.freeAgents.push(p);
    S.cleanLineup(career, club);
    EM.Career.credit(career, -cost, 'Rescisión de ' + p.name, career.today);
    logTransfer(career, { type: 'release', playerId: playerId, name: p.name, other: 'Libre', fee: cost });
    return result(true, p.name + ' quedó libre.', { cost: cost });
  }

  // Loans end with the season: players go back to the club that lent them.
  function returnLoans(world, career) {
    const holders = Object.keys(world.clubs).map(function (id) { return world.clubs[id]; }).concat(world.foreignClubs);
    const back = [];
    holders.forEach(function (c) {
      c.players.forEach(function (p) {
        if (p.loan && p.loan.until <= career.seasonIndex) back.push({ p: p, holder: c });
      });
    });
    back.forEach(function (e) {
      const origin = S.getClub(world, e.p.loan.from);
      e.p.loan = null;
      if (!origin) return;
      S.removeFromSquad(e.holder, e.p.id);
      e.p.clubId = origin.id;
      origin.players.push(e.p);
    });
    S.cleanLineup(career, userClub(world, career));
    return back.length;
  }

  EM.Market = {
    MAX_SQUAD: MAX_SQUAD,
    MIN_SQUAD: MIN_SQUAD,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    MAX_LOANS_IN: MAX_LOANS_IN,
    REGIONS: REGIONS,
    windowOpen: windowOpen,
    regionOf: regionOf,
    priceOf: priceOf,
    costOf: costOf,
    loanFee: loanFee,
    renewCost: renewCost,
    releaseCost: releaseCost,
    canAfford: canAfford,
    search: search,
    negotiate: negotiate,
    loanIn: loanIn,
    listPlayer: listPlayer,
    offersFor: offersFor,
    acceptOffer: acceptOffer,
    quickSell: quickSell,
    renew: renew,
    release: release,
    returnLoans: returnLoans
  };
})(window.EM = window.EM || {});
