// ELMANAGER engine: position metadata, formations (GK at the bottom) and position fit.
(function (EM) {
  'use strict';

  const META = {
    GK: { line: 'GK', short: 'ARQ', name: 'Arquero' },
    CB: { line: 'DEF', short: 'DFC', name: 'Defensor central' },
    LB: { line: 'DEF', short: 'LI', name: 'Lateral izquierdo' },
    RB: { line: 'DEF', short: 'LD', name: 'Lateral derecho' },
    LWB: { line: 'DEF', short: 'CI', name: 'Carrilero izquierdo' },
    RWB: { line: 'DEF', short: 'CD', name: 'Carrilero derecho' },
    CDM: { line: 'MID', short: 'MCD', name: 'Mediocampista defensivo' },
    CM: { line: 'MID', short: 'MC', name: 'Mediocampista' },
    CAM: { line: 'MID', short: 'MO', name: 'Mediocampista ofensivo' },
    LM: { line: 'MID', short: 'VI', name: 'Volante izquierdo' },
    RM: { line: 'MID', short: 'VD', name: 'Volante derecho' },
    LW: { line: 'FWD', short: 'EI', name: 'Extremo izquierdo' },
    RW: { line: 'FWD', short: 'ED', name: 'Extremo derecho' },
    ST: { line: 'FWD', short: 'DEL', name: 'Delantero' },
    CF: { line: 'FWD', short: 'SD', name: 'Segundo delantero' }
  };

  const LINE_NAMES = { GK: 'Arqueros', DEF: 'Defensores', MID: 'Mediocampistas', FWD: 'Delanteros' };
  const LINE_ORDER = ['GK', 'DEF', 'MID', 'FWD'];

  // Coordinates are percentages on a vertical pitch: (0,0) top-left, GK at the bottom.
  // They are the old top-down layouts flipped with y' = 100 - y.
  function flip(slots) {
    return slots.map(function (s) { return { id: s.id, type: s.type, x: s.x, y: 100 - s.y }; });
  }

  const FORMATIONS = {
    '4-3-3': { slots: flip([
      { id: 'gk', type: 'GK', x: 50, y: 8 },
      { id: 'lb', type: 'LB', x: 15, y: 27 },
      { id: 'cb1', type: 'CB', x: 36, y: 23 },
      { id: 'cb2', type: 'CB', x: 64, y: 23 },
      { id: 'rb', type: 'RB', x: 85, y: 27 },
      { id: 'cm1', type: 'CM', x: 28, y: 50 },
      { id: 'cdm', type: 'CDM', x: 50, y: 47 },
      { id: 'cm2', type: 'CM', x: 72, y: 50 },
      { id: 'lw', type: 'LW', x: 18, y: 78 },
      { id: 'st', type: 'ST', x: 50, y: 86 },
      { id: 'rw', type: 'RW', x: 82, y: 78 }
    ]) },
    '4-4-2': { slots: flip([
      { id: 'gk', type: 'GK', x: 50, y: 8 },
      { id: 'lb', type: 'LB', x: 15, y: 27 },
      { id: 'cb1', type: 'CB', x: 36, y: 23 },
      { id: 'cb2', type: 'CB', x: 64, y: 23 },
      { id: 'rb', type: 'RB', x: 85, y: 27 },
      { id: 'lm', type: 'LM', x: 14, y: 53 },
      { id: 'cm1', type: 'CM', x: 38, y: 50 },
      { id: 'cm2', type: 'CM', x: 62, y: 50 },
      { id: 'rm', type: 'RM', x: 86, y: 53 },
      { id: 'st1', type: 'ST', x: 38, y: 86 },
      { id: 'st2', type: 'CF', x: 62, y: 86 }
    ]) },
    '4-2-3-1': { slots: flip([
      { id: 'gk', type: 'GK', x: 50, y: 8 },
      { id: 'lb', type: 'LB', x: 15, y: 27 },
      { id: 'cb1', type: 'CB', x: 36, y: 23 },
      { id: 'cb2', type: 'CB', x: 64, y: 23 },
      { id: 'rb', type: 'RB', x: 85, y: 27 },
      { id: 'cdm1', type: 'CDM', x: 37, y: 45 },
      { id: 'cdm2', type: 'CDM', x: 63, y: 45 },
      { id: 'lw', type: 'LW', x: 18, y: 68 },
      { id: 'cam', type: 'CAM', x: 50, y: 65 },
      { id: 'rw', type: 'RW', x: 82, y: 68 },
      { id: 'st', type: 'ST', x: 50, y: 86 }
    ]) },
    '3-5-2': { slots: flip([
      { id: 'gk', type: 'GK', x: 50, y: 8 },
      { id: 'cb1', type: 'CB', x: 30, y: 22 },
      { id: 'cb2', type: 'CB', x: 50, y: 19 },
      { id: 'cb3', type: 'CB', x: 70, y: 22 },
      { id: 'lwb', type: 'LWB', x: 10, y: 46 },
      { id: 'cm1', type: 'CM', x: 35, y: 49 },
      { id: 'cdm', type: 'CDM', x: 50, y: 53 },
      { id: 'cm2', type: 'CM', x: 65, y: 49 },
      { id: 'rwb', type: 'RWB', x: 90, y: 46 },
      { id: 'st1', type: 'ST', x: 38, y: 86 },
      { id: 'st2', type: 'ST', x: 62, y: 86 }
    ]) },
    '5-3-2': { slots: flip([
      { id: 'gk', type: 'GK', x: 50, y: 8 },
      { id: 'lwb', type: 'LWB', x: 10, y: 31 },
      { id: 'cb1', type: 'CB', x: 30, y: 24 },
      { id: 'cb2', type: 'CB', x: 50, y: 20 },
      { id: 'cb3', type: 'CB', x: 70, y: 24 },
      { id: 'rwb', type: 'RWB', x: 90, y: 31 },
      { id: 'cm1', type: 'CM', x: 30, y: 53 },
      { id: 'cdm', type: 'CDM', x: 50, y: 56 },
      { id: 'cm2', type: 'CM', x: 70, y: 53 },
      { id: 'st1', type: 'ST', x: 38, y: 86 },
      { id: 'st2', type: 'ST', x: 62, y: 86 }
    ]) }
  };

  const FORMATION_NAMES = Object.keys(FORMATIONS);

  function line(pos) { return (META[pos] || {}).line || 'MID'; }

  // Pairs that are nearly interchangeable (different line or role, small penalty).
  const SIBLINGS = { LB: 'LWB', LWB: 'LB', RB: 'RWB', RWB: 'RB', LM: 'LW', LW: 'LM', RM: 'RW', RW: 'RM', ST: 'CF', CF: 'ST' };

  // How well a player performs in a slot that is not his exact position.
  function fit(playerPos, slotType) {
    if (playerPos === slotType) return 1.0;
    if (playerPos === 'GK' || slotType === 'GK') return 0.05;
    if (SIBLINGS[playerPos] === slotType) return 0.95;
    const pl = line(playerPos);
    const sl = line(slotType);
    if (pl === sl) return 0.9;
    const adjacent = (pl === 'DEF' && sl === 'MID') || (pl === 'MID' && sl === 'DEF') ||
      (pl === 'MID' && sl === 'FWD') || (pl === 'FWD' && sl === 'MID');
    return adjacent ? 0.55 : 0.2;
  }

  function slotsOf(formationName) {
    return (FORMATIONS[formationName] || FORMATIONS['4-3-3']).slots;
  }

  EM.Positions = {
    META: META,
    LINE_NAMES: LINE_NAMES,
    LINE_ORDER: LINE_ORDER,
    FORMATIONS: FORMATIONS,
    FORMATION_NAMES: FORMATION_NAMES,
    line: line,
    fit: fit,
    slotsOf: slotsOf
  };
})(window.EM = window.EM || {});
