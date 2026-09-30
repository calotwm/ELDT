// ELMANAGER engine: Liga Profesional structure (torneos, playoffs, annual table, promedios,
// relegation and continental qualification). Pure functions over plain JSON data.
(function (EM) {
  'use strict';

  const U = EM.Util;

  const PLAYOFF_STAGES = ['octavos', 'cuartos', 'semis', 'final'];
  const STAGE_NAMES = {
    octavos: 'Octavos de final',
    cuartos: 'Cuartos de final',
    semis: 'Semifinales',
    final: 'Final'
  };

  // ---- table rows ----------------------------------------------------------------------------
  function newRow(clubId, zone, name) {
    return { clubId: clubId, name: name || clubId, zone: zone || null, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, form: [] };
  }

  function applyResult(row, gf, ga) {
    row.played++;
    row.gf += gf;
    row.ga += ga;
    let r;
    if (gf > ga) { row.won++; row.points += 3; r = 'W'; }
    else if (gf === ga) { row.drawn++; row.points += 1; r = 'D'; }
    else { row.lost++; r = 'L'; }
    row.form.push(r);
    if (row.form.length > 5) row.form.shift();
  }

  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      const gdA = a.gf - a.ga;
      const gdB = b.gf - b.ga;
      if (gdB !== gdA) return gdB - gdA;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function zoneTable(torneo, zone) {
    return sortRows(Object.keys(torneo.table).map(function (id) { return torneo.table[id]; })
      .filter(function (r) { return r.zone === zone; }));
  }

  // ---- fixtures ----------------------------------------------------------------------------------
  // Circle method for an odd number of teams: n rounds, each team rests once.
  // Returns rounds of [homeId, awayId | null] pairs (null = the resting team).
  function roundRobinWithBye(ids) {
    const n = ids.length;
    const arr = ids.slice();
    arr.push(null);
    const half = arr.length / 2;
    const rounds = [];
    for (let r = 0; r < n; r++) {
      const pairs = [];
      for (let i = 0; i < half; i++) {
        const a = arr[i];
        const b = arr[arr.length - 1 - i];
        pairs.push(((r + i) % 2 === 0) ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      arr.splice(1, 0, arr.pop());
    }
    return rounds;
  }

  // 2026 format: two zones of 15, 15 zonal rounds (the resting team of each zone plays the
  // resting team of the other zone) plus a 16th "Fecha de clasicos" where every team meets
  // an interzonal rival it has not faced yet. reverse = true mirrors home and away (Clausura).
  function buildTorneo(key, name, zones, rng, reverse, nameOf) {
    const A = rng.shuffle(zones.A.slice());
    const B = rng.shuffle(zones.B.slice());
    const rrA = roundRobinWithBye(A);
    const rrB = roundRobinWithBye(B);
    const rounds = [];
    const used = {};
    const n = A.length;

    for (let r = 0; r < n; r++) {
      const round = [];
      let byeA = null;
      let byeB = null;
      rrA[r].forEach(function (p) { if (p[0] === null || p[1] === null) byeA = p[0] === null ? p[1] : p[0]; else round.push({ home: p[0], away: p[1] }); });
      rrB[r].forEach(function (p) { if (p[0] === null || p[1] === null) byeB = p[0] === null ? p[1] : p[0]; else round.push({ home: p[0], away: p[1] }); });
      round.push(r % 2 === 0 ? { home: byeA, away: byeB, interzonal: true } : { home: byeB, away: byeA, interzonal: true });
      used[byeA + '|' + byeB] = true;
      rounds.push(round);
    }

    // Fecha de clasicos: shift k so that no A[i]-B[(i+k)%n] pair already met.
    const start = rng.int(1, n - 1);
    let chosen = -1;
    for (let t = 0; t < n && chosen < 0; t++) {
      const k = (start + t) % n;
      let clash = false;
      for (let i = 0; i < n && !clash; i++) if (used[A[i] + '|' + B[(i + k) % n]]) clash = true;
      if (!clash) chosen = k;
    }
    if (chosen < 0) chosen = start;
    const last = [];
    for (let i = 0; i < n; i++) {
      last.push(i % 2 === 0 ? { home: A[i], away: B[(i + chosen) % n], interzonal: true } : { home: B[(i + chosen) % n], away: A[i], interzonal: true });
    }
    rounds.push(last);

    if (reverse) {
      rounds.forEach(function (round) {
        round.forEach(function (m) { const h = m.home; m.home = m.away; m.away = h; });
      });
    }

    const table = {};
    ['A', 'B'].forEach(function (z) {
      zones[z].forEach(function (id) { table[id] = newRow(id, z, nameOf ? nameOf(id) : id); });
    });

    return {
      key: key,
      name: name,
      zones: { A: zones.A.slice(), B: zones.B.slice() },
      rounds: rounds,
      table: table,
      playoffs: { stage: null, seeds: {}, ties: { octavos: [], cuartos: [], semis: [], final: [] } },
      champion: null,
      runnerUp: null,
      done: false
    };
  }

  // ---- playoffs -----------------------------------------------------------------------------------
  // Better seed = lower zone position, then more regular-phase points.
  function betterSeed(torneo, a, b) {
    const sa = torneo.playoffs.seeds[a];
    const sb = torneo.playoffs.seeds[b];
    if (sa.pos !== sb.pos) return sa.pos < sb.pos ? a : b;
    return sa.points >= sb.points ? a : b;
  }

  function makeTie(torneo, stage, index, x, y) {
    const home = betterSeed(torneo, x, y);
    return {
      id: torneo.key + '-' + stage + '-' + index,
      home: home,
      away: home === x ? y : x,
      neutral: stage === 'final',
      hg: null, ag: null, pens: null, winner: null
    };
  }

  // Top 8 of each zone: A1-B8, B4-A5, A2-B7, B3-A6, A3-B6, B2-A7, A4-B5, B1-A8.
  const OCTAVOS_PAIRS = [['A', 1, 'B', 8], ['B', 4, 'A', 5], ['A', 2, 'B', 7], ['B', 3, 'A', 6],
    ['A', 3, 'B', 6], ['B', 2, 'A', 7], ['A', 4, 'B', 5], ['B', 1, 'A', 8]];

  function buildPlayoffs(torneo) {
    const tables = { A: zoneTable(torneo, 'A'), B: zoneTable(torneo, 'B') };
    ['A', 'B'].forEach(function (z) {
      tables[z].forEach(function (row, i) { torneo.playoffs.seeds[row.clubId] = { pos: i + 1, points: row.points }; });
    });
    torneo.playoffs.ties.octavos = OCTAVOS_PAIRS.map(function (p, i) {
      return makeTie(torneo, 'octavos', i, tables[p[0]][p[1] - 1].clubId, tables[p[2]][p[3] - 1].clubId);
    });
    torneo.playoffs.stage = 'octavos';
    return torneo.playoffs.ties.octavos;
  }

  // Builds cuartos / semis / final from the winners of the previous stage (bracket order).
  function nextPlayoffRound(torneo) {
    const po = torneo.playoffs;
    const idx = PLAYOFF_STAGES.indexOf(po.stage);
    if (idx < 0 || idx >= PLAYOFF_STAGES.length - 1) return null;
    const prev = po.ties[po.stage];
    const stage = PLAYOFF_STAGES[idx + 1];
    const ties = [];
    for (let i = 0; i < prev.length; i += 2) ties.push(makeTie(torneo, stage, i / 2, prev[i].winner, prev[i + 1].winner));
    po.ties[stage] = ties;
    po.stage = stage;
    return ties;
  }

  // Furthest stage a club reached in a torneo (Spanish label).
  function stageReached(torneo, clubId) {
    const ties = torneo.playoffs.ties;
    let reached = 'Fase regular';
    PLAYOFF_STAGES.forEach(function (st) {
      ties[st].forEach(function (t) { if (t.home === clubId || t.away === clubId) reached = STAGE_NAMES[st]; });
    });
    if (torneo.champion === clubId) return 'Campeón';
    return reached;
  }

  // ---- annual table, promedios, relegation ---------------------------------------------------------
  // Sum of both regular phases (playoffs are not counted).
  function annualTable(apertura, clausura) {
    const rows = {};
    [apertura, clausura].forEach(function (t) {
      Object.keys(t.table).forEach(function (id) {
        const r = t.table[id];
        if (!rows[id]) rows[id] = newRow(id, null, r.name);
        const a = rows[id];
        a.played += r.played; a.won += r.won; a.drawn += r.drawn; a.lost += r.lost;
        a.gf += r.gf; a.ga += r.ga; a.points += r.points;
      });
    });
    return sortRows(Object.keys(rows).map(function (id) { return rows[id]; }));
  }

  // World promedios: id -> list of {points, played} blocks (one per season).
  function initPromedios(realPromedios, ids) {
    const out = {};
    ids.forEach(function (id) {
      const p = realPromedios[id];
      out[id] = p ? [0, 1, 2].map(function () { return { points: p.points / 3, played: p.played / 3 }; }) : [];
    });
    return out;
  }

  function promedio(world, id) {
    const blocks = (world.promedios[id] || []).slice(-3);
    const played = U.sum(blocks, function (b) { return b.played; });
    return played ? U.sum(blocks, function (b) { return b.points; }) / played : 0;
  }

  function pushPromedios(world, annualRows) {
    annualRows.forEach(function (r) {
      if (!world.promedios[r.clubId]) world.promedios[r.clubId] = [];
      world.promedios[r.clubId].push({ points: r.points, played: r.played });
    });
  }

  // First relegated = worst promedio; second = last of the annual table
  // (second to last if it is the same club).
  function relegation(annualSorted, promedioFn) {
    let worst = null;
    annualSorted.forEach(function (r) {
      const p = promedioFn(r.clubId);
      // '<=' walks the table top-down so a tie goes to the club lower in the annual table.
      if (!worst || p <= worst.p) worst = { id: r.clubId, p: p };
    });
    const last = annualSorted[annualSorted.length - 1].clubId;
    const second = last !== worst.id ? last : annualSorted[annualSorted.length - 2].clubId;
    return [worst.id, second];
  }

  // ---- continental qualification --------------------------------------------------------------------
  // 2026 rule: Libertadores ARG1 Apertura champion, ARG2 Clausura champion, ARG3 Copa Argentina
  // champion, then the best of the annual table until 6; the last club entering by the annual table
  // (ARG6) plays the Fase 2 repechaje. A repeated champion frees his slot for the annual table.
  // Sudamericana: next 6 of the annual table. Relegated clubs cannot qualify, except a Copa
  // Argentina champion (a second-division champion qualified in 2014).
  function qualification(o) {
    const relegated = {};
    (o.relegated || []).forEach(function (id) { relegated[id] = true; });
    const lib = [];
    function add(id, allowRelegated) {
      if (!id || lib.indexOf(id) >= 0 || lib.length >= 6) return false;
      if (relegated[id] && !allowRelegated) return false;
      lib.push(id);
      return true;
    }
    add(o.apertura);
    add(o.clausura);
    add(o.copaArgentinaChampion, true);
    const table = o.annual.map(function (r) { return r.clubId; });
    let lastFromTable = null;
    for (let i = 0; i < table.length && lib.length < 6; i++) if (add(table[i])) lastFromTable = table[i];
    const sud = [];
    for (let i = 0; i < table.length && sud.length < 6; i++) {
      if (lib.indexOf(table[i]) < 0 && !relegated[table[i]]) sud.push(table[i]);
    }
    return { libertadores: lib, libertadoresRepechaje: lastFromTable || lib[lib.length - 1] || null, sudamericana: sud };
  }

  EM.League = {
    PLAYOFF_STAGES: PLAYOFF_STAGES,
    STAGE_NAMES: STAGE_NAMES,
    newRow: newRow,
    applyResult: applyResult,
    sortRows: sortRows,
    zoneTable: zoneTable,
    buildTorneo: buildTorneo,
    buildPlayoffs: buildPlayoffs,
    nextPlayoffRound: nextPlayoffRound,
    stageReached: stageReached,
    annualTable: annualTable,
    initPromedios: initPromedios,
    promedio: promedio,
    pushPromedios: pushPromedios,
    relegation: relegation,
    qualification: qualification
  };
})(window.EM = window.EM || {});
