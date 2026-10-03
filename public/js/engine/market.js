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

  // ---- player interest ----------------------------------------------------------------------------------------------------
  // Game parameters (not real data): how attractive the user club is and how demanding a player is.
  const PRESTIGE_BASE = { 1: 78, 2: 62, 3: 46 };
  const ORIGIN_DEMAND = { ARG: 0, Brasil: 6, Uruguay: 0, Paraguay: 0, Colombia: 2, Chile: 0, Europa: 18, 'América': 8 };
  const FAME_DEMAND = { 2: 16, 3: 50 };
  const INTEREST_YES = 5;          // score at or above: the player accepts
  const INTEREST_MAYBE = -10;      // score at or above: the player may accept (deterministic per season)
  const STAR_RATING = 83;          // stars at or above: only the five grandes can try, and only as a long shot
  const STAR_MAX_CHANCE = 0.1;

  // Club prestige 20..100: size (tier), last season's table position and titles, and current continental cup.
  function prestigeOf(world, career) {
    const club = world.clubs[career.clubId];
    let score = PRESTIGE_BASE[club.tier] || 46;
    const last = career.history[career.history.length - 1];
    if (last) {
      score += U.clamp((15 - last.annualPos) * 0.8, -10, 10);
      score += Math.min(10, last.titles.length * 5);
    }
    const q = world.qualified || {};
    if ((q.libertadores || []).indexOf(club.id) >= 0) score += 8;
    else if ((q.sudamericana || []).indexOf(club.id) >= 0) score += 4;
    return Math.round(U.clamp(score, 20, 100));
  }

  // How demanding a player is about his next club: quality, fame, league of origin and personal situation.
  function demandOf(world, career, player, fromClub) {
    const region = regionOf(fromClub);
    let demand = (player.rating - 60) * 2.2 + (FAME_DEMAND[player.fame] || 0) + (ORIGIN_DEMAND[region] || 0);
    if (region === 'ARG') demand += ((world.clubs[career.clubId].tier || 3) - (fromClub.tier || 3)) * 8;
    if (player.nat === 'ba' && region !== 'ARG' && player.age >= 31) demand -= 12; // veterans like coming home
    if (player.age >= 34) demand -= 6;
    return demand;
  }

  // { level: 'yes'|'maybe'|'no', label, chance } for a player considering a move to the user club.
  function interestOf(world, career, player, fromClub, prestige) {
    const star = player.rating >= STAR_RATING;
    if (star && world.clubs[career.clubId].tier !== 1) return { level: 'no', label: 'Solo escucha a un grande', chance: 0 };
    const p = prestige != null ? prestige : prestigeOf(world, career);
    const score = p - demandOf(world, career, player, fromClub);
    if (star && score >= INTEREST_MAYBE) {
      const chance = U.clamp((score - INTEREST_MAYBE) / (INTEREST_YES - INTEREST_MAYBE), 0.03, STAR_MAX_CHANCE);
      return { level: 'maybe', label: 'Muy difícil', chance: chance };
    }
    if (score >= INTEREST_YES) return { level: 'yes', label: 'Interesado', chance: 1 };
    if (score >= INTEREST_MAYBE) {
      const chance = U.clamp((score - INTEREST_MAYBE) / (INTEREST_YES - INTEREST_MAYBE), 0.1, 0.9);
      return { level: 'maybe', label: 'Lo duda', chance: chance };
    }
    return { level: 'no', label: 'No le interesa', chance: 0 };
  }

  // Deterministic decision for a doubtful player, so retrying in the same pre-season gives the same answer.
  function decides(career, player, interest) {
    if (interest.level !== 'maybe') return interest.level === 'yes';
    return U.hash01(player.id + ':' + career.seasonIndex) < interest.chance;
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

  // filters: { q, pos, region, interested (hide players who would refuse) }. Sorted by rating; `items` is cut to SEARCH_LIMIT, `total` is the full match count.
  function search(world, career, f) {
    const filters = f || {};
    const q = filters.q ? U.norm(filters.q) : '';
    const items = [];
    const prestige = prestigeOf(world, career);
    const refused = (career.pre && career.pre.refused) || {};
    marketClubs(world, career).forEach(function (club) {
      const region = regionOf(club);
      if (filters.region && filters.region !== region) return;
      club.players.forEach(function (p) {
        if (p.loan) return;
        if (filters.pos && p.pos !== filters.pos) return;
        if (q && U.norm(p.name).indexOf(q) < 0 && U.norm(club.name).indexOf(q) < 0) return;
        const interest = refused[p.id] ? { level: 'no', label: 'Rechazó tu oferta', chance: 0 } : interestOf(world, career, p, club, prestige);
        if (filters.interested && interest.level === 'no') return;
        items.push({ player: p, club: club, region: region, price: priceOf(p, club), interest: interest });
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
    STAR_RATING: STAR_RATING,
    STAR_MAX_CHANCE: STAR_MAX_CHANCE,
    regionOf: regionOf,
    priceOf: priceOf,
    prestigeOf: prestigeOf,
    interestOf: interestOf,
    decides: decides,
    aiBuyers: aiBuyers,
    search: search,
    transfer: transfer,
    returnLoans: returnLoans
  };
})(window.EM = window.EM || {});
