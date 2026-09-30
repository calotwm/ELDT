// ELMANAGER engine: player model (value, potential, yearly development, youth intake).
(function (EM) {
  'use strict';

  const U = EM.Util;

  // ---- value ------------------------------------------------------------------
  // Ported from scripts/scrape.mjs so re-computed values stay consistent with the data.
  const POSITION_VALUE = {
    GK: 0.65, CB: 0.85, LB: 0.8, RB: 0.8, LWB: 0.8, RWB: 0.8,
    CDM: 0.95, CM: 1, CAM: 1.1, LM: 1, RM: 1, LW: 1.1, RW: 1.1, CF: 1.15, ST: 1.2
  };
  const FAME_VALUE_BONUS = { 3: 6, 2: 3 };

  function ageValueFactor(age) {
    if (age <= 19) return 1.1;
    if (age <= 21) return 1.25;
    if (age <= 25) return 1.15;
    if (age <= 27) return 1;
    if (age <= 29) return 0.75;
    if (age <= 31) return 0.5;
    if (age <= 33) return 0.3;
    return 0.15;
  }

  // Exponential over rating: 60 -> ~0.8M, 70 -> ~3M, 80 -> ~11M (before modifiers).
  function computeValue(rating, age, pos, fame) {
    const base = 0.8 * Math.exp((rating - 60) * 0.13);
    let value = Math.max(0.2, base * ageValueFactor(age) * (POSITION_VALUE[pos] || 1));
    if (fame && FAME_VALUE_BONUS[fame]) value += FAME_VALUE_BONUS[fame] * (age >= 35 ? 0.5 : 1);
    return Math.max(0.2, U.round1(value));
  }

  // ---- initialisation -----------------------------------------------------------
  function potentialBonus(age, name) {
    const h = U.hash01(name + '#potential');
    if (age <= 19) return 8 + Math.floor(h * 9);   // 8..16
    if (age <= 21) return 5 + Math.floor(h * 8);   // 5..12
    if (age <= 24) return 1 + Math.floor(h * 6);   // 1..6
    return 0;
  }

  // Deterministic from the name so a re-scraped roster keeps the same hidden values.
  function initPlayer(p, clubId, rng) {
    const h = U.hash01(p.name + '#contract');
    let contract = 1 + Math.floor(h * 3);
    if (p.age <= 24 || p.rating >= 74) contract += 1;
    p.clubId = clubId;
    p.potential = Math.min(92, p.rating + potentialBonus(p.age, p.name));
    p.contract = U.clamp(contract, 1, 4);
    p.injury = 0;
    p.listed = null;
    p.loan = null;
    p.youth = false;
    p.captain = false;
    p.season = { apps: 0, goals: 0, assists: 0 };
    p.career = { apps: 0, goals: 0, assists: 0, seasons: 0 };
    return p;
  }

  // ---- development -----------------------------------------------------------------
  // Yearly progression. opts.loanBonus: a youngster (<=23) who played on loan gets +1 extra.
  function develop(p, rng, opts) {
    p.age += 1;
    const room = Math.max(0, p.potential - p.rating);
    let delta;
    if (p.age <= 21) delta = Math.min(rng.int(1, 5), room);
    else if (p.age <= 25) delta = Math.min(rng.int(0, 2), room);
    else if (p.age <= 29) delta = rng.int(-1, 1);
    else if (p.age <= 32) delta = rng.int(-3, 0);
    else delta = rng.int(-5, -1);
    if (opts && opts.loanBonus && p.age <= 23 && room > delta) delta += 1;
    p.rating = U.clamp(p.rating + delta, 45, 92);
    if (p.age >= 26 || p.potential < p.rating) p.potential = p.rating;
    p.value = computeValue(p.rating, p.age, p.pos, p.fame);
    return p;
  }

  function shouldRetire(p) {
    return p.age >= 38 || (p.age >= 35 && p.rating < 66);
  }

  // ---- youth ---------------------------------------------------------------------------
  // Generated youth players are procedural content: the real future academy
  // graduates of each club cannot be sourced, so names and ratings are invented.
  const FIRST_NAMES = ['Lucas', 'Mateo', 'Thiago', 'Santiago', 'Benjamín', 'Joaquín', 'Facundo', 'Nicolás',
    'Franco', 'Tomás', 'Agustín', 'Bautista', 'Ignacio', 'Lautaro', 'Julián', 'Matías', 'Ezequiel', 'Gonzalo',
    'Emiliano', 'Valentín', 'Federico', 'Maximiliano', 'Bruno', 'Ramiro', 'Alan', 'Kevin', 'Braian', 'Leandro',
    'Gastón', 'Cristian', 'Diego', 'Martín', 'Sebastián', 'Axel', 'Nahuel', 'Lisandro', 'Hernán', 'Rodrigo',
    'Ciro', 'Dante'];
  const LAST_NAMES = ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez',
    'García', 'Sánchez', 'Romero', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta',
    'Benítez', 'Medina', 'Herrera', 'Suárez', 'Aguirre', 'Giménez', 'Gutiérrez', 'Castro', 'Ortiz', 'Silva',
    'Molina', 'Rojas', 'Núñez', 'Luna', 'Cabrera', 'Ríos', 'Morales', 'Ledesma', 'Vega', 'Paz', 'Ibáñez', 'Farías'];

  const YOUTH_POSITIONS = [
    ['GK', 8], ['CB', 18], ['LB', 6], ['RB', 6], ['CDM', 8], ['CM', 12], ['CAM', 8],
    ['LM', 2], ['RM', 2], ['LW', 6], ['RW', 6], ['ST', 14], ['CF', 4]
  ];

  function freeNumber(players) {
    const used = {};
    players.forEach(function (p) { used[p.number] = true; });
    for (let n = 2; n < 100; n++) if (!used[n]) return n;
    return 99;
  }

  // quality 0..5 (academy level): raises the rating ceiling and the potential range.
  function generateYouth(clubId, rng, quality) {
    const q = quality || 0;
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const pos = rng.weighted(YOUTH_POSITIONS, function (e) { return e[1]; })[0];
    const rating = rng.int(50, 58 + q * 3);
    const age = rng.int(17, 19);
    const p = {
      id: 'gen-' + Math.floor(rng.next() * 1e9).toString(36) + Math.floor(rng.next() * 1e9).toString(36),
      name: first + ' ' + last,
      shortName: last,
      pos: pos,
      nat: 'ba',
      age: age,
      number: 0,
      rating: rating,
      value: computeValue(rating, age, pos),
      goals: 0,
      assists: 0,
      generated: true
    };
    initPlayer(p, clubId, rng);
    p.potential = Math.min(88, rating + rng.int(8, 18 + q * 2));
    p.contract = rng.int(2, 4);
    p.youth = true;
    return p;
  }

  EM.Players = {
    computeValue: computeValue,
    initPlayer: initPlayer,
    develop: develop,
    shouldRetire: shouldRetire,
    generateYouth: generateYouth,
    freeNumber: freeNumber
  };
})(window.EM = window.EM || {});
