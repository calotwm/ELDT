// ELMANAGER engine: shared helpers (seeded RNG, math, formatting, ISO dates).
// DOM-free; runs in browsers and in Node (window = global).
(function (EM) {
  'use strict';

  // ---- hashing ----------------------------------------------------------------
  // FNV-1a 32 bit. hash01 matches the scraper's formula so values line up.
  function hashStr(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function hash01(str) {
    return (hashStr(str) % 10000) / 10000;
  }

  // ---- seeded RNG (mulberry32) --------------------------------------------------
  // The generator state lives in `holder.rngState`, so a game that passes its
  // `career` as holder keeps the state inside the saved JSON (deterministic saves).
  function createRng(seed, holder) {
    const st = holder || { rngState: seed >>> 0 };
    if (st.rngState == null) st.rngState = seed >>> 0;

    function next() {
      st.rngState = (st.rngState + 0x6d2b79f5) >>> 0;
      let t = st.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const rng = {
      seed: seed,
      next: next,
      int: function (a, b) { return a + Math.floor(next() * (b - a + 1)); },
      float: function (a, b) { return a + next() * (b - a); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      shuffle: function (arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
      // Weighted pick: items array + weight function.
      weighted: function (items, weightFn) {
        let total = 0;
        const ws = items.map(function (it) { const w = Math.max(0, weightFn(it)); total += w; return w; });
        if (total <= 0) return items[Math.floor(next() * items.length)];
        let r = next() * total;
        for (let i = 0; i < items.length; i++) {
          r -= ws[i];
          if (r < 0) return items[i];
        }
        return items[items.length - 1];
      }
    };
    return rng;
  }

  // RNG bound to the career: every draw is persisted in career.rngState.
  function careerRng(career) {
    return createRng(career.rngState, career);
  }

  // ---- math -------------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function sum(arr, fn) { return arr.reduce(function (a, x) { return a + (fn ? fn(x) : x); }, 0); }
  function avg(arr, fn) { return arr.length ? sum(arr, fn) / arr.length : 0; }

  // ---- misc ---------------------------------------------------------------------
  let uidCounter = 0;
  // Runtime-only ids (never persisted; persisted ids come from per-game counters).
  function uid(prefix) { uidCounter += 1; return (prefix || 'id') + '-' + uidCounter; }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Lowercase without accents, for search.
  function norm(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ---- formatting -----------------------------------------------------------------
  function formatMoney(v) {
    return 'US$ ' + round1(v).toFixed(1) + 'M';
  }

  const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function parseISO(iso) {
    const p = String(iso).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }

  function toISO(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }

  function weekday(iso) { return parseISO(iso).getUTCDay(); }

  // First date on/after (year, month, day) that falls on `wd` (0 = Sunday ... 6 = Saturday).
  function onOrAfter(year, month, day, wd) {
    const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return addDays(iso, (wd - weekday(iso) + 7) % 7);
  }

  // 'sáb 24 ene 2027'
  function formatDate(iso) {
    const d = parseISO(iso);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  EM.Util = {
    hashStr: hashStr,
    hash01: hash01,
    createRng: createRng,
    careerRng: careerRng,
    clamp: clamp,
    round1: round1,
    sum: sum,
    avg: avg,
    uid: uid,
    clone: clone,
    norm: norm,
    formatMoney: formatMoney,
    formatDate: formatDate,
    parseISO: parseISO,
    addDays: addDays,
    weekday: weekday,
    onOrAfter: onOrAfter
  };
})(window.EM = window.EM || {});
