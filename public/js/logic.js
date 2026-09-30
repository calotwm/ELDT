// Pure game logic: pricing, pre-season events, XI strength, season simulation.
// No DOM access here so it can be unit-tested headlessly (Node + vm).
// Loaded as a classic script; exposes window.GameLogic.
(function (global) {
  'use strict';

  var POS_META = global.POS_META || {};

  // ---- constants ----------------------------------------------------------
  var TIER_DEFAULT_BUDGET = { 1: 40, 2: 20, 3: 10 };
  var MAX_BUDGET = 60;
  var MAX_SQUAD_SIZE = 30;
  var MIN_SQUAD_TO_SIMULATE = 14;
  var SELL_LIMIT = 8;
  var LOAN_LIMIT = 5;
  var SPONSOR_ATTEMPTS = 3;

  var TIER_PRICE_MULTIPLIER = { 1: 1.35, 2: 1.15, 3: 1.0 };

  function posLine(pos) {
    return (POS_META[pos] || {}).line || 'MID';
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function formatMoney(v) {
    var n = round1(v);
    return 'US$ ' + n.toFixed(1) + 'M';
  }

  function defaultBudgetForTier(tier) {
    return TIER_DEFAULT_BUDGET[tier] || 15;
  }

  // ---- position fit ---------------------------------------------------------
  // How well a player performs in a slot that is not his exact position.
  function posFitMultiplier(playerPos, slotType) {
    if (playerPos === slotType) return 1.0;
    var pg = posLine(playerPos);
    var sg = posLine(slotType);
    if (pg === 'GK' || sg === 'GK') return 0.05; // keeper mismatch is severe
    if (pg === sg) return 0.9; // same line, different role (e.g. CB in a CB slot pairing, or RB as LB)
    var adjacent =
      (pg === 'DEF' && sg === 'MID') ||
      (pg === 'MID' && sg === 'DEF') ||
      (pg === 'MID' && sg === 'FWD') ||
      (pg === 'FWD' && sg === 'MID');
    if (adjacent) return 0.55;
    return 0.2; // e.g. defender pushed to striker
  }

  // ---- transfer pricing -------------------------------------------------
  function buyPriceForPlayer(player, sellerClub) {
    var mult = TIER_PRICE_MULTIPLIER[sellerClub && sellerClub.tier] || 1.0;
    return round1(player.value * mult);
  }

  // ---- pre-season events --------------------------------------------------
  var SPONSOR_POOL = [
    { id: 'pampa', name: 'Grupo Pampa Energía', fee: 4.5, prob: 55 },
    { id: 'surco', name: 'Surco Neumáticos', fee: 2.8, prob: 68 },
    { id: 'delrio', name: 'Cervecería Del Río', fee: 6.5, prob: 38 },
    { id: 'nortex', name: 'Nortex Seguros', fee: 3.6, prob: 60 }
  ];

  var COACH_POOL = [
    { id: 'keep', label: 'Continuidad', strengthMod: 0, cost: 0 },
    { id: 'a', name: 'Rubén Maggiolo', strengthMod: 1.5, cost: 1.2 },
    { id: 'b', name: 'Esteban Vidoz', strengthMod: -0.5, cost: 0.4 },
    { id: 'c', name: 'Facundo Herrero', strengthMod: 3, cost: 2.5 }
  ];

  function hashClub(club) {
    var s = club.id || club.slug || '';
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Deterministic per club so a club always sees the same kind of event.
  function getPreSeasonEvent(club) {
    var variant = hashClub(club) % 4;
    if (variant === 0) {
      var pool = SPONSOR_POOL.map(function (s) {
        return {
          id: s.id,
          name: s.name,
          fee: s.fee,
          prob: clamp(s.prob + ((hashClub(club) + s.fee * 10) % 15) - 7, 20, 80)
        };
      });
      return { type: 'sponsor', title: 'Sponsor de camiseta', options: pool };
    }
    if (variant === 1) {
      var candidates = [
        COACH_POOL[0],
        { id: COACH_POOL[1].id, name: COACH_POOL[1].name, strengthMod: COACH_POOL[1].strengthMod, cost: COACH_POOL[1].cost },
        { id: COACH_POOL[2].id, name: COACH_POOL[2].name, strengthMod: COACH_POOL[2].strengthMod, cost: COACH_POOL[2].cost },
        { id: COACH_POOL[3].id, name: COACH_POOL[3].name, strengthMod: COACH_POOL[3].strengthMod, cost: COACH_POOL[3].cost }
      ];
      candidates[0] = { id: 'keep', name: club.coach, strengthMod: 0, cost: 0, incumbent: true };
      return { type: 'coach', title: 'Cuerpo técnico', options: candidates };
    }
    if (variant === 2) {
      return {
        type: 'academy',
        title: 'Inversión en las inferiores',
        options: [
          { id: 'skip', name: 'No invertir', cost: 0, strengthMod: 0 },
          { id: 'basic', name: 'Plan básico', cost: 1.5, strengthMod: 0.8 },
          { id: 'full', name: 'Plan integral', cost: 3.5, strengthMod: 2 }
        ]
      };
    }
    return {
      type: 'stadium',
      title: 'Refacción del estadio',
      options: [
        { id: 'skip', name: 'Posponer obras', cost: 0, strengthMod: 0 },
        { id: 'partial', name: 'Obra parcial', cost: 2, strengthMod: 0.6 },
        { id: 'full', name: 'Obra completa', cost: 4.5, strengthMod: 1.6 }
      ]
    };
  }

  function attemptSponsorPitch(sponsorOption) {
    var success = Math.random() * 100 < sponsorOption.prob;
    return { success: success, fee: sponsorOption.fee };
  }

  // ---- squad strength ------------------------------------------------------
  function buildXIEntries(formation, slottedPlayers) {
    return formation.slots
      .map(function (slot) {
        var player = slottedPlayers[slot.id];
        if (!player) return null;
        return { slot: slot, player: player, fit: posFitMultiplier(player.pos, slot.type) };
      })
      .filter(Boolean);
  }

  // Average effective rating of a full XI (11 filled slots expected).
  function computeXIStrength(xiEntries, strengthMod) {
    if (!xiEntries.length) return 0;
    var sum = xiEntries.reduce(function (acc, e) {
      return acc + e.player.rating * e.fit;
    }, 0);
    return sum / xiEntries.length + (strengthMod || 0);
  }

  // For AI-controlled clubs: best 11 ratings, no formation logic needed.
  function bestXIStrength(club) {
    var sorted = club.players.slice().sort(function (a, b) {
      return b.rating - a.rating;
    });
    var xi = sorted.slice(0, 11);
    if (!xi.length) return 50;
    return xi.reduce(function (a, p) { return a + p.rating; }, 0) / xi.length;
  }

  // ---- match / season simulation --------------------------------------------
  function poissonRandom(lambda) {
    var L = Math.exp(-lambda);
    var k = 0;
    var p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L && k < 12);
    return k - 1;
  }

  function simulateMatch(strengthHome, strengthAway) {
    var diff = strengthHome - strengthAway;
    var base = 1.3;
    var expHome = clamp(base + diff / 18, 0.2, 4.2);
    var expAway = clamp(base - diff / 18, 0.2, 4.2);
    return [poissonRandom(expHome), poissonRandom(expAway)];
  }

  function createTableRow(club) {
    return {
      clubId: club.id,
      name: club.name,
      shortName: club.shortName,
      tier: club.tier,
      colors: club.colors,
      isUser: false,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0
    };
  }

  function applyResult(row, gf, ga) {
    row.played++;
    row.goalsFor += gf;
    row.goalsAgainst += ga;
    if (gf > ga) { row.won++; row.points += 3; }
    else if (gf === ga) { row.drawn++; row.points += 1; }
    else { row.lost++; }
  }

  function sortTable(rows) {
    return rows.slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      var gdA = a.goalsFor - a.goalsAgainst;
      var gdB = b.goalsFor - b.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.name.localeCompare(b.name);
    });
  }

  // Round-robin single leg: every club plays every other club once.
  function simulateSeason(clubs, userClubId, userStrength) {
    var rows = {};
    var strengths = {};
    clubs.forEach(function (c) {
      rows[c.id] = createTableRow(c);
      rows[c.id].isUser = c.id === userClubId;
      strengths[c.id] = c.id === userClubId ? userStrength : bestXIStrength(c);
    });

    var ids = clubs.map(function (c) { return c.id; });
    var userGoals = 0;

    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = ids[i], b = ids[j];
        var homeFirst = (i + j) % 2 === 0;
        var home = homeFirst ? a : b;
        var away = homeFirst ? b : a;
        var homeAdvantage = 2.5;
        var res = simulateMatch(strengths[home] + homeAdvantage, strengths[away]);
        applyResult(rows[home], res[0], res[1]);
        applyResult(rows[away], res[1], res[0]);
        if (home === userClubId) userGoals += res[0];
        if (away === userClubId) userGoals += res[1];
      }
    }

    var table = sortTable(Object.keys(rows).map(function (k) { return rows[k]; }));
    var userPosition = table.findIndex(function (r) { return r.clubId === userClubId; }) + 1;
    return { table: table, userPosition: userPosition, userGoalsScored: userGoals };
  }

  function gradeForPosition(position, totalClubs) {
    if (position === 1) return { label: 'Campeón', tone: 'gold' };
    if (position <= 6) return { label: 'Copa Libertadores', tone: 'good' };
    if (position <= 12) return { label: 'Copa Sudamericana', tone: 'good' };
    if (position <= totalClubs - (totalClubs >= 24 ? 6 : 4)) return { label: 'Mitad de tabla', tone: 'neutral' };
    return { label: 'Zona de descenso', tone: 'bad' };
  }

  // Distribute the team's season goals across the XI's attacking-minded players,
  // weighted by rating so stronger forwards/mids are more likely top scorers.
  function estimateTopScorer(xiEntries, totalGoals) {
    if (!xiEntries.length || totalGoals <= 0) return null;
    var attackWeight = function (pos) {
      var line = posLine(pos);
      if (line === 'FWD') return 3;
      if (line === 'MID') return 1.4;
      if (line === 'DEF') return 0.3;
      return 0.05;
    };
    var pool = xiEntries.map(function (e) {
      return { player: e.player, weight: attackWeight(e.player.pos) * (e.player.rating / 70) };
    });
    var totalWeight = pool.reduce(function (s, p) { return s + p.weight; }, 0) || 1;
    var best = null;
    pool.forEach(function (p) {
      var goals = Math.round((p.weight / totalWeight) * totalGoals * (0.7 + Math.random() * 0.6));
      if (!best || goals > best.goals) best = { player: p.player, goals: goals };
    });
    return best;
  }

  global.GameLogic = {
    TIER_DEFAULT_BUDGET: TIER_DEFAULT_BUDGET,
    MAX_BUDGET: MAX_BUDGET,
    MAX_SQUAD_SIZE: MAX_SQUAD_SIZE,
    MIN_SQUAD_TO_SIMULATE: MIN_SQUAD_TO_SIMULATE,
    SELL_LIMIT: SELL_LIMIT,
    LOAN_LIMIT: LOAN_LIMIT,
    SPONSOR_ATTEMPTS: SPONSOR_ATTEMPTS,
    posLine: posLine,
    formatMoney: formatMoney,
    defaultBudgetForTier: defaultBudgetForTier,
    posFitMultiplier: posFitMultiplier,
    buyPriceForPlayer: buyPriceForPlayer,
    getPreSeasonEvent: getPreSeasonEvent,
    attemptSponsorPitch: attemptSponsorPitch,
    buildXIEntries: buildXIEntries,
    computeXIStrength: computeXIStrength,
    bestXIStrength: bestXIStrength,
    poissonRandom: poissonRandom,
    simulateMatch: simulateMatch,
    simulateSeason: simulateSeason,
    gradeForPosition: gradeForPosition,
    estimateTopScorer: estimateTopScorer
  };
})(typeof window !== 'undefined' ? window : this);
