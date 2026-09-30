// ELMANAGER engine: single-match simulation (Poisson goals, scorers, penalties).
(function (EM) {
  'use strict';

  const U = EM.Util;

  // Game parameters (not real data).
  const HOME_ADVANTAGE = 2.5;
  const BASE_GOALS = 1.3;

  const SCORER_WEIGHT = { FWD: 3, MID: 1.4, DEF: 0.35, GK: 0.02 };
  const ASSIST_WEIGHT = { FWD: 1.5, MID: 2, DEF: 0.6, GK: 0.05 };

  function poisson(rng, lambda) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > limit && k < 11);
    return k - 1;
  }

  function lineOf(player) {
    return EM.Positions.line(player.pos);
  }

  function pickScorer(rng, xi) {
    return rng.weighted(xi, function (p) { return SCORER_WEIGHT[lineOf(p)] * (p.rating / 70); });
  }

  function pickAssist(rng, xi, scorer) {
    if (!rng.chance(0.75)) return null;
    const others = xi.filter(function (p) { return p.id !== scorer.id; });
    if (!others.length) return null;
    return rng.weighted(others, function (p) { return ASSIST_WEIGHT[lineOf(p)] * (p.rating / 70); });
  }

  function goalEvents(rng, count, side, xi) {
    const events = [];
    for (let i = 0; i < count; i++) {
      const min = rng.int(1, 90);
      const ev = { min: min, side: side, playerId: null, playerName: null, assistId: null, type: 'goal' };
      // Occasional stoppage-time goal: min stays 90 and `extra` holds the added minutes.
      if (min === 90 || rng.chance(0.05)) { ev.min = 90; ev.extra = rng.int(1, 5); }
      if (xi && xi.length) {
        const scorer = pickScorer(rng, xi);
        ev.playerId = scorer.id;
        ev.playerName = scorer.name;
        const assist = pickAssist(rng, xi, scorer);
        ev.assistId = assist ? assist.id : null;
      }
      events.push(ev);
    }
    return events;
  }

  // Penalty shoot-out. sa / sb are the strengths of side A (h) and side B (a).
  function penalties(rng, sa, sb) {
    const pa = U.clamp(0.75 + (sa - sb) * 0.005, 0.55, 0.92);
    const pb = U.clamp(0.75 + (sb - sa) * 0.005, 0.55, 0.92);
    let h = 0;
    let a = 0;
    for (let i = 0; i < 5; i++) {
      if (rng.chance(pa)) h++;
      if (rng.chance(pb)) a++;
    }
    let guard = 0;
    while (h === a) {
      const kh = rng.chance(pa);
      const ka = rng.chance(pb);
      if (kh) h++;
      if (ka) a++;
      if (++guard > 30 && h === a) { if (rng.chance(0.5)) h++; else a++; }
    }
    return { h: h, a: a };
  }

  // side = { clubId, strength, xi: [player] | null }.
  // opts = { neutral, knockout, rng }. ctx is accepted for API symmetry (unused).
  function simulate(ctx, home, away, opts) {
    const o = opts || {};
    const rng = o.rng;
    const diff = home.strength - away.strength + (o.neutral ? 0 : HOME_ADVANTAGE);
    const expHome = U.clamp(BASE_GOALS + diff / 18, 0.2, 4.2);
    const expAway = U.clamp(BASE_GOALS - diff / 18, 0.2, 4.2);
    const hg = poisson(rng, expHome);
    const ag = poisson(rng, expAway);

    const events = goalEvents(rng, hg, 'home', home.xi).concat(goalEvents(rng, ag, 'away', away.xi));
    events.sort(function (x, y) { return (x.min - y.min) || ((x.extra || 0) - (y.extra || 0)); });

    let pens = null;
    let winner = hg > ag ? 'home' : (ag > hg ? 'away' : 'draw');
    if (winner === 'draw' && o.knockout) {
      pens = penalties(rng, home.strength, away.strength);
      winner = pens.h > pens.a ? 'home' : 'away';
    }
    return { hg: hg, ag: ag, events: events, pens: pens, winner: winner };
  }

  EM.Match = {
    HOME_ADVANTAGE: HOME_ADVANTAGE,
    simulate: simulate,
    penalties: penalties
  };
})(window.EM = window.EM || {});
