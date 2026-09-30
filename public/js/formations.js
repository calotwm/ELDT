// Formation layouts and position metadata for Director Deportivo AR.
// Pure data module, no DOM access. Loaded as a classic script (exposes window.FORMATIONS / window.POS_META).
(function () {
  'use strict';

  // Position -> tactical line, used for chip coloring and grouping logic.
  var POS_META = {
    GK: { line: 'GK', label: 'PT' },
    CB: { line: 'DEF', label: 'DFC' },
    LB: { line: 'DEF', label: 'LI' },
    RB: { line: 'DEF', label: 'LD' },
    LWB: { line: 'DEF', label: 'CAI' },
    RWB: { line: 'DEF', label: 'CAD' },
    CDM: { line: 'MID', label: 'MCD' },
    CM: { line: 'MID', label: 'MC' },
    CAM: { line: 'MID', label: 'MCO' },
    LM: { line: 'MID', label: 'MI' },
    RM: { line: 'MID', label: 'MD' },
    LW: { line: 'FWD', label: 'EI' },
    RW: { line: 'FWD', label: 'ED' },
    ST: { line: 'FWD', label: 'DC' }
  };

  // Coordinates are percentages on a vertical pitch (0,0 = top-left, GK near the top).
  var FORMATIONS = {
    '4-3-3': {
      slots: [
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
      ]
    },
    '4-4-2': {
      slots: [
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
        { id: 'st2', type: 'ST', x: 62, y: 86 }
      ]
    },
    '4-2-3-1': {
      slots: [
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
      ]
    },
    '3-5-2': {
      slots: [
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
      ]
    },
    '5-3-2': {
      slots: [
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
      ]
    }
  };

  window.POS_META = POS_META;
  window.FORMATIONS = FORMATIONS;
})();
