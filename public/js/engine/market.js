// ELMANAGER engine: transfer market primitives (pricing, search, moving players, loan returns).
// Players MOVE between squads, so the world stays consistent. Money is USD millions, 1 decimal.
// The pre-season task rules (limits, undo, budget) live in career.js.
(function (EM) {
  'use strict';

  const U = EM.Util;
  const S = EM.Squad;

  const MAX_SQUAD = 30;            // user squad cap
  const MIN_SQUAD = 14;            // squad needed to simulate
  const SELL_LIMIT = 8;
  const LOAN_LIMIT = 5;
  const SELLER_MIN_SQUAD = 16;     // AI clubs refuse to sell below this
  const AI_MAX_SQUAD = 34;         // AI clubs stop buying above this
  const SEARCH_LIMIT = 80;
  const TIER_MULT = { 1: 1.35, 2: 1.15, 3: 1.0 };
  const REGIONS = ['ARG', 'Brasil', 'Uruguay', 'Paraguay', 'Colombia', 'Chile', 'Europa', 'América'];

  function regionOf(club) { return club.division === 'LP' ? 'ARG' : (club.region || 'Europa'); }

  // Price to buy a player from `club`.
  function priceOf(player, club) {
    return Math.max(0.1, U.round1(player.value * (TIER_MULT[club.tier] || 1)));
  }

  // Clubs the user can buy from: the other Liga Profesional clubs plus the foreign pool.
  function marketClubs(world, career) {
    const domestic = world.leagueIds.filter(function (id) { return id !== career.clubId; }).map(function (id) { return world.clubs[id]; });
    return domestic.concat(world.foreignClubs);
  }

  // Clubs that can receive a sold / loaned player (other Liga Profesional clubs).
  function aiBuyers(world, career) {
    const all = world.leagueIds.filter(function (id) { return id !== career.clubId; }).map(function (id) { return world.clubs[id]; });
    const room = all.filter(function (c) { return c.players.length < AI_MAX_SQUAD; });
    return room.length ? room : all;
  }

  // filters: { q, pos, region }. Sorted by rating; `items` is cut to SEARCH_LIMIT, `total` is the full match count.
  function search(world, career, f) {
    const filters = f || {};
    const q = filters.q ? U.norm(filters.q) : '';
    const items = [];
    marketClubs(world, career).forEach(function (club) {
      const region = regionOf(club);
      if (filters.region && filters.region !== region) return;
      club.players.forEach(function (p) {
        if (p.loan) return;
        if (filters.pos && p.pos !== filters.pos) return;
        if (q && U.norm(p.name).indexOf(q) < 0 && U.norm(club.name).indexOf(q) < 0) return;
        items.push({ player: p, club: club, region: region, price: priceOf(p, club) });
      });
    });
    items.sort(function (a, b) { return (b.player.rating - a.player.rating) || (b.player.value - a.player.value) || (a.player.id < b.player.id ? -1 : 1); });
    return { items: items.slice(0, SEARCH_LIMIT), total: items.length };
  }

  // Moves a player from one club to another (the origin may be any club).
  function transfer(player, from, to) {
    S.removeFromSquad(from, player.id);
    player.clubId = to.id;
    if (to.players.some(function (p) { return p.number === player.number; })) player.number = EM.Players.freeNumber(to.players);
    to.players.push(player);
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
      if (origin) transfer(e.p, e.holder, origin);
    });
    return back.map(function (e) { return e.p; });
  }

  EM.Market = {
    MAX_SQUAD: MAX_SQUAD,
    MIN_SQUAD: MIN_SQUAD,
    SELL_LIMIT: SELL_LIMIT,
    LOAN_LIMIT: LOAN_LIMIT,
    SELLER_MIN_SQUAD: SELLER_MIN_SQUAD,
    AI_MAX_SQUAD: AI_MAX_SQUAD,
    REGIONS: REGIONS,
    regionOf: regionOf,
    priceOf: priceOf,
    aiBuyers: aiBuyers,
    search: search,
    transfer: transfer,
    returnLoans: returnLoans
  };
})(window.EM = window.EM || {});
