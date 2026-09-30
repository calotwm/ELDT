// ELMANAGER headless engine test.
// Usage: node scripts/test-engine.mjs [seed]
// Plays full 5-season careers through the public API and asserts the invariants of the engine.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = Number(process.argv[2] ?? 20270101) >>> 0;

// ---- environment: fake window + localStorage --------------------------------------------------
global.window = global;
const memory = {};
Object.defineProperty(global, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (k in memory ? memory[k] : null),
    setItem: (k, v) => { memory[k] = String(v); },
    removeItem: (k) => { delete memory[k]; }
  }
});

require(path.join(root, 'public/data/clubs.js'));
for (const f of ['util', 'positions', 'players', 'match', 'squad', 'league', 'cups', 'season', 'market', 'preseason', 'career', 'save']) {
  require(path.join(root, 'public/js/engine', f + '.js'));
}
const EM = window.EM;
const DATA = window.LEAGUE_DATA;

// ---- tiny assertion framework ------------------------------------------------------------------
const failures = [];
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures.push(msg);
    if (failures.length <= 40) console.log('  FAIL: ' + msg);
  }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, expected ${b})`); }
function unique(arr) { return new Set(arr).size === arr.length; }

// ---- helpers ------------------------------------------------------------------------------------------
function clubStrengths() {
  return DATA.clubs
    .map((c) => ({ id: c.id, name: c.name, s: EM.Squad.bestXI(c.players.map((p) => ({ ...p, injury: 0 })), '4-3-3').strength }))
    .sort((a, b) => b.s - a.s);
}

function allSquadPlayers(world) {
  const list = [];
  for (const id of Object.keys(world.clubs)) for (const p of world.clubs[id].players) list.push({ p, where: id });
  for (const c of world.foreignClubs) for (const p of c.players) list.push({ p, where: c.id });
  return list;
}

function checkPlayerUniqueness(world, label) {
  const seen = new Map();
  let dup = 0;
  for (const { p, where } of allSquadPlayers(world)) {
    if (seen.has(p.id)) dup++;
    seen.set(p.id, where);
  }
  eq(dup, 0, `${label}: no player in two squads`);
  return seen;
}

function checkTorneo(t, label) {
  const rows = Object.values(t.table);
  eq(rows.length, 30, `${label}: 30 rows`);
  let gf = 0, ga = 0;
  for (const r of rows) {
    ok(r.points === 3 * r.won + r.drawn, `${label}: points = 3W + D for ${r.clubId}`);
    ok(r.played === r.won + r.drawn + r.lost, `${label}: played = W+D+L for ${r.clubId}`);
    eq(r.played, 16, `${label}: 16 fechas played by ${r.clubId}`);
    gf += r.gf; ga += r.ga;
  }
  eq(gf, ga, `${label}: goals for = goals against`);
  const played = t.rounds.flat().length;
  eq(played, 240, `${label}: 240 fixtures`);
  ok(t.champion && t.runnerUp && t.done, `${label}: has champion`);
}

function checkFixtures(t, label) {
  // every pair meets at most once per torneo; 14 zonal + 2 interzonal games per club
  const pairs = new Set();
  let dup = 0;
  const games = {};
  for (const round of t.rounds) {
    const inRound = new Set();
    for (const m of round) {
      const k = [m.home, m.away].sort().join('|');
      if (pairs.has(k)) dup++;
      pairs.add(k);
      ok(!inRound.has(m.home) && !inRound.has(m.away), `${label}: club twice in a fecha`);
      inRound.add(m.home); inRound.add(m.away);
      games[m.home] = (games[m.home] || 0) + 1;
      games[m.away] = (games[m.away] || 0) + 1;
    }
    eq(inRound.size, 30, `${label}: every club plays each fecha`);
  }
  eq(dup, 0, `${label}: no repeated pairing`);
  eq(Object.values(games).filter((n) => n === 16).length, 30, `${label}: 16 matches per club`);
}

function checkNoDoubleDates(season, label) {
  const byDate = {};
  for (const md of season.calendar) {
    for (const m of md.matches || []) {
      const key = md.date;
      byDate[key] = byDate[key] || {};
      for (const id of [m.home, m.away]) {
        ok(!byDate[key][id], `${label}: ${id} plays twice on ${md.date}`);
        byDate[key][id] = true;
      }
    }
  }
}

// ---- pre-season tasks, driven through the public API -------------------------------------------------
function cheapest(game, n, filters = {}) {
  const { items } = EM.Career.search(game, filters);
  return items.filter((i) => i.price <= game.career.budget).sort((a, b) => a.price - b.price).slice(0, n);
}

function doPreseason(game, label) {
  const { career, world } = game;
  const club = EM.Career.userClub(game);
  ok(!EM.Career.canSimulate(game), `${label}: cannot simulate before the tasks`);
  ok(!EM.Career.sellPlayers(game, []).ok, `${label}: sell is locked before the pre-season decision`);

  // decision (rotating event)
  const ev = career.decisionEvent;
  ok(['sponsor', 'coach', 'academy', 'stadium'].includes(ev.type), `${label}: decision type`);
  if (ev.type === 'sponsor') {
    let guard = 0;
    while (!ev.done && guard++ < 5) {
      const r = EM.Career.chooseDecision(game, ev.options[guard % ev.options.length].id);
      ok(r.ok && r.attemptsLeft >= 0, `${label}: sponsor pitch`);
    }
    ok(ev.done, `${label}: sponsor event resolved`);
  } else {
    const cheap = ev.options.find((o) => o.cost <= 2 && o.id !== 'keep') || ev.options[0];
    const r = EM.Career.chooseDecision(game, cheap.id);
    ok(r.ok, `${label}: decision ${ev.type} ${r.message || ''}`);
    ok(ev.done, `${label}: decision done`);
  }
  ok(!EM.Career.chooseDecision(game, ev.options[0].id).ok, `${label}: decision cannot be repeated`);
  ok(career.tasks.preSeason, `${label}: preSeason task done`);

  // sell: limit, real move to a Liga Profesional club, budget credit, undo
  const sellable = EM.Career.sellCandidates(game).sort((a, b) => a.rating - b.rating);
  ok(!EM.Career.sellPlayers(game, sellable.slice(0, EM.Market.SELL_LIMIT + 1).map((p) => p.id)).ok, `${label}: sell limit`);
  const picks = sellable.slice(0, 3);
  const cash = career.budget;
  const sold = EM.Career.sellPlayers(game, picks.map((p) => p.id));
  ok(sold.ok, `${label}: sell ${sold.message || ''}`);
  const worth = picks.reduce((n, p) => n + p.value, 0);
  ok(Math.abs(career.budget - (cash + worth)) < 0.2, `${label}: sold at value`);
  for (const p of picks) {
    const f = EM.Squad.findPlayer(world, p.id);
    ok(f && f.club.id !== club.id && world.leagueIds.includes(f.club.id), `${label}: sold player joined another LP club`);
    eq(p.clubId, f.club.id, `${label}: sold clubId updated`);
  }
  const undo = EM.Career.sellPlayers(game, picks.slice(0, 2).map((p) => p.id));
  ok(undo.ok && EM.Squad.findPlayer(world, picks[2].id).club.id === club.id, `${label}: undo sale brings the player back`);
  ok(career.tasks.sell, `${label}: sell done`);

  // loan: limit, loaned-out player marked and moved, exclusive with sale
  const loanable = EM.Career.loanCandidates(game).sort((a, b) => b.rating - a.rating);
  ok(loanable.every((p) => !career.pre.sales[p.id]), `${label}: sold players are not loan candidates`);
  ok(!EM.Career.loanPlayers(game, loanable.slice(0, EM.Market.LOAN_LIMIT + 1).map((p) => p.id)).ok, `${label}: loan limit`);
  const loanIds = loanable.filter((p) => p.age <= 23).slice(0, 2).map((p) => p.id);
  const lr = EM.Career.loanPlayers(game, loanIds);
  ok(lr.ok, `${label}: loan ${lr.message || ''}`);
  for (const id of loanIds) {
    const f = EM.Squad.findPlayer(world, id);
    ok(f.player.loan && f.player.loan.from === club.id && f.club.id !== club.id, `${label}: loaned player sits at another club`);
  }
  ok(career.tasks.loan, `${label}: loan done`);

  // sign: moves the player, charges the price, undo refunds
  ok(!EM.Career.signPlayer(game, picks[2].id).ok, `${label}: cannot sign a player of the own club`);
  const buys = cheapest(game, 2);
  ok(buys.length === 2, `${label}: cheap players exist`);
  const before = career.budget;
  const seller = buys[0].club;
  const sellerSize = seller.players.length;
  const sr = EM.Career.signPlayer(game, buys[0].player.id);
  ok(sr.ok, `${label}: sign ${sr.message || ''}`);
  eq(seller.players.length, sellerSize - 1, `${label}: seller lost the player`);
  ok(club.players.some((p) => p.id === buys[0].player.id), `${label}: buyer has the player`);
  ok(Math.abs(career.budget - (before - buys[0].price)) < 0.11, `${label}: price charged`);
  ok(EM.Career.signPlayer(game, buys[1].player.id).ok, `${label}: second signing`);
  const us = EM.Career.unsignPlayer(game, buys[0].player.id);
  ok(us.ok && seller.players.some((p) => p.id === buys[0].player.id), `${label}: unsign returns the player`);
  ok(Math.abs(career.budget - (before - buys[1].price)) < 0.11, `${label}: unsign refunds`);
  ok(!EM.Career.unsignPlayer(game, picks[2].id).ok, `${label}: only signings can be undone`);
  for (const rg of EM.Market.REGIONS) {
    const res = EM.Career.search(game, { region: rg });
    ok(res.items.every((i) => i.region === rg), `${label}: region filter ${rg}`);
  }
  ok(EM.Career.search(game, { q: 'MESSI' }).items.every((i) => EM.Util.norm(i.player.name).includes('messi') || EM.Util.norm(i.club.name).includes('messi')), `${label}: accent/case-insensitive search`);
  ok(EM.Career.confirmSigning(game).ok && career.tasks.sign, `${label}: sign done`);
  while (club.players.length < 18) {
    const c = cheapest(game, 1)[0];
    ok(!!c && EM.Career.signPlayer(game, c.player.id).ok, `${label}: top up the squad`);
    if (!c) break;
  }

  // formation: changing it clears the XI, autofill completes it, confirm requires a full XI
  const nextFormation = career.lineup.formation === '4-4-2' ? '4-3-3' : '4-4-2';
  ok(EM.Career.setFormation(game, nextFormation).ok && Object.keys(career.lineup.slots).length === 0, `${label}: formation change clears the XI`);
  ok(!EM.Career.confirmFormation(game).ok, `${label}: empty XI cannot be confirmed`);
  const gk = club.players.filter((p) => p.pos === 'GK')[0];
  ok(EM.Career.assignSlot(game, 'gk', gk.id).ok && career.lineup.slots.gk === gk.id, `${label}: assign slot`);
  ok(EM.Career.autoFill(game).ok, `${label}: autofill`);
  eq(career.lineup.slots.gk, gk.id, `${label}: autofill keeps manual picks`);
  ok(EM.Career.confirmFormation(game).ok && career.tasks.formation, `${label}: formation confirmed`);
  const swapA = career.lineup.slots.cb1;
  const swapB = career.lineup.slots.cb2;
  EM.Career.assignSlot(game, 'cb1', swapB);
  ok(career.lineup.slots.cb1 === swapB && career.lineup.slots.cb2 === swapA, `${label}: slot assignment swaps`);
  ok(!career.tasks.formation, `${label}: editing the XI asks for a new confirmation`);
  ok(EM.Career.confirmFormation(game).ok, `${label}: formation confirmed again`);
  ok(EM.Career.canSimulate(game), `${label}: ready to simulate`);
  const ts = EM.Career.taskState(game);
  eq(ts.doneCount, 5, `${label}: five tasks done`);
  return { loanIds, soldIds: picks.slice(0, 2).map((p) => p.id) };
}

// ---- one full career --------------------------------------------------------------------------------------
function playCareer(clubId, seed, tag) {
  const game = EM.Career.newGame(DATA, { clubId, directorName: 'Test', seed });
  const { career, world } = game;
  const summary = [];
  let prevQual = null;
  let roundTripDone = false;
  ok(game.version === 2, 'game version');
  ok(EM.Career.defaultBudget(1) === 40 && EM.Career.defaultBudget(3) === 10, 'tier default budgets');
  const startIds = new Set(allSquadPlayers(world).map((x) => x.p.id));
  ok(startIds.size > 1000, 'players loaded');

  for (let s = 0; s < career.maxSeasons; s++) {
    const label = `${tag} S${s + 1}`;
    eq(career.phase, 'preseason', `${label}: starts in preseason`);
    eq(career.year, 2027 + s, `${label}: year`);

    // cups of this season contain last season's qualifiers
    const season = game.season;
    if (prevQual) {
      for (const id of prevQual.libertadores) ok(season.cups.libertadores.teams.includes(id), `${label}: ${id} in Libertadores`);
      for (const id of prevQual.sudamericana) ok(season.cups.sudamericana.teams.includes(id), `${label}: ${id} in Sudamericana`);
      const userWasIn = prevQual.libertadores.includes(clubId) ? 'libertadores' : (prevQual.sudamericana.includes(clubId) ? 'sudamericana' : null);
      if (userWasIn) ok(season.userCups.includes(userWasIn), `${label}: qualified user plays ${userWasIn}`);
      else ok(season.userCups.length === 0, `${label}: not qualified -> no continental cup`);
      if (prevQual.libertadoresRepechaje) ok(!!season.cups.libertadores.slot, `${label}: Fase 2 present`);
    } else {
      eq(season.cups.libertadores.slot, undefined, `${label}: no Fase 2 in season 1`);
    }
    eq(season.cups.libertadores.teams.length, 32, `${label}: 32 Libertadores teams`);
    eq(season.cups.sudamericana.teams.length, 32, `${label}: 32 Sudamericana teams`);
    ok(unique(season.cups.libertadores.teams) && unique(season.cups.sudamericana.teams), `${label}: unique cup teams`);
    eq(season.cups.copaArgentina.teams.length, 64, `${label}: 64 Copa Argentina teams`);
    ok(unique(season.cups.copaArgentina.teams), `${label}: unique CA teams`);
    for (const g of season.cups.libertadores.groups.concat(season.cups.sudamericana.groups)) eq(g.teamIds.length, 4, `${label}: groups of 4`);
    checkFixtures(season.torneos.apertura, `${label} Apertura fixtures`);
    checkFixtures(season.torneos.clausura, `${label} Clausura fixtures`);
    const a0 = season.torneos.apertura.rounds[0][0];
    const c0 = season.torneos.clausura.rounds[0][0];
    ok(a0.home === c0.away && a0.away === c0.home, `${label}: Clausura mirrors Apertura`);
    ok(season.calendar.length > 60 && season.calendar.every((md) => md.comp !== 'window'), `${label}: calendar built without windows`);
    ok(season.calendar.every((md, i) => i === 0 || season.calendar[i - 1].date <= md.date), `${label}: calendar sorted by date`);

    // seasonInfo feeds the hub panel
    const info = EM.Career.seasonInfo(game);
    eq(info.index, s + 1, `${label}: seasonInfo index`);
    ok(info.competitions.length >= 3 && info.competitions.length <= 4, `${label}: seasonInfo competitions`);
    eq(info.competitions.some((c) => c.key === 'libertadores' || c.key === 'sudamericana'), season.userCups.length > 0, `${label}: seasonInfo cups`);

    const moves = doPreseason(game, label);
    checkPlayerUniqueness(world, label + ' tasks');

    // save roundtrip + determinism in the second season
    if (!roundTripDone && s === 1) {
      roundTripDone = true;
      ok(EM.Save.save(game), 'save works');
      ok(EM.Save.exists(), 'save exists');
      const loaded = EM.Save.load();
      ok(!!loaded, 'load works');
      eq(JSON.stringify(loaded), JSON.stringify(game), 'save -> JSON -> load roundtrip preserves the game');
      const a = JSON.parse(JSON.stringify(game));
      EM.Career.simulateSeason(a);
      EM.Career.simulateSeason(loaded);
      eq(JSON.stringify(a), JSON.stringify(loaded), 'loaded game simulates identically (deterministic RNG)');
      EM.Save.clear();
      ok(!EM.Save.exists(), 'clear works');
    }

    // ---- simulate the season in one call -------------------------------------------------------------
    const sim = EM.Career.simulateSeason(game);
    ok(sim.ok, `${label}: simulateSeason ${sim.message || ''}`);
    eq(career.phase, 'review', `${label}: review phase`);
    ok(EM.Season.isSeasonOver(game.season) && game.season.calendar.every((md) => md.played), `${label}: every match day played`);
    ok(!EM.Career.simulateSeason(game).ok, `${label}: cannot simulate twice`);
    ok(!EM.Career.signPlayer(game, EM.Career.search(game, {}).items[0].player.id).ok, `${label}: no transfers after the season`);

    let userLeagueMatches = 0;
    let userPlayoffMatches = 0;
    for (const md of game.season.calendar) {
      for (const m of md.matches || []) {
        if (m.home !== clubId && m.away !== clubId) continue;
        if (m.comp === 'apertura' || m.comp === 'clausura') {
          if (md.stage === 'regular') userLeagueMatches++; else userPlayoffMatches++;
        }
      }
    }
    eq(userLeagueMatches, 32, `${label}: user plays 32 regular league matches`);

    // ---- structural checks ---------------------------------------------------------------------
    const T = game.season.torneos;
    checkTorneo(T.apertura, `${label} Apertura`);
    checkTorneo(T.clausura, `${label} Clausura`);
    eq(T.apertura.playoffs.ties.octavos.length, 8, `${label}: 8 octavos ties`);
    eq(T.apertura.playoffs.ties.final.length, 1, `${label}: 1 final`);
    ok(T.apertura.playoffs.ties.final[0].neutral, `${label}: final on neutral ground`);
    for (const t of Object.values(T)) for (const st of ['octavos', 'cuartos', 'semis', 'final']) for (const tie of t.playoffs.ties[st]) ok(!!tie.winner, `${label}: playoff tie decided`);
    const userPlayoffTies = ['apertura', 'clausura'].reduce((n, k) => n + ['octavos', 'cuartos', 'semis', 'final'].reduce((m, st) => m + T[k].playoffs.ties[st].filter((t) => t.home === clubId || t.away === clubId).length, 0), 0);
    eq(userPlayoffMatches, userPlayoffTies, `${label}: user playoff matches match the bracket`);
    const cups = game.season.cups;
    for (const k of ['libertadores', 'sudamericana', 'copaArgentina']) {
      ok(cups[k].done && cups[k].champion && cups[k].runnerUp && cups[k].champion !== cups[k].runnerUp, `${label}: ${k} has a champion`);
      eq(cups[k].stage[cups[k].champion], 'Campeón', `${label}: ${k} champion stage`);
    }
    for (const cup of [cups.libertadores, cups.sudamericana]) {
      for (const g of cup.groups) {
        const rows = Object.values(g.table);
        eq(rows.length, 4, `${label}: group has 4 rows`);
        for (const r of rows) {
          eq(r.played, 6, `${label}: group team played 6`);
          ok(r.points === 3 * r.won + r.drawn, `${label}: group points`);
        }
      }
      eq(cup.ko.octavos.length, 8, `${label}: 8 octavos`);
      eq(cup.ko.cuartos.length, 4, `${label}: 4 cuartos`);
      eq(cup.ko.semis.length, 2, `${label}: 2 semis`);
      eq(cup.ko.final.length, 1, `${label}: 1 final`);
      for (const r of ['octavos', 'cuartos', 'semis']) for (const t of cup.ko[r]) eq(t.legs.length, 2, `${label}: two legs`);
    }
    eq(cups.sudamericana.ko.playoffs.length, 8, `${label}: 8 Sudamericana playoffs`);
    eq(cups.copaArgentina.ko.r32.length, 32, `${label}: 32 CA ties`);
    eq(cups.copaArgentina.ko.r1.length, 1, `${label}: CA final`);
    checkNoDoubleDates(game.season, label);
    checkPlayerUniqueness(world, label + ' end');
    if (cups.libertadores.slot) {
      const tie = cups.libertadores.ko.fase2[0];
      ok(!!tie.winner, `${label}: Fase 2 decided`);
      eq(tie.legs.length, 2, `${label}: Fase 2 two legs`);
    }

    // ---- results summary ---------------------------------------------------------------------------
    const sum = sim.summary;
    eq(sum.relegated.length, 2, `${label}: 2 relegated`);
    ok(unique(sum.relegated), `${label}: relegated unique`);
    eq(sum.promoted.length, 2, `${label}: 2 promoted`);
    eq(world.leagueIds.length, 30, `${label}: 30 league ids`);
    ok(unique(world.leagueIds), `${label}: league ids unique`);
    ok(sum.relegated.every((id) => world.clubs[id].division === 'PN' && !world.leagueIds.includes(id)), `${label}: relegated now in PN`);
    ok(sum.promoted.every((id) => world.clubs[id].division === 'LP' && world.leagueIds.includes(id)), `${label}: promoted now in LP`);
    eq(world.zones.A.length, 15, `${label}: zone A size`);
    eq(world.zones.B.length, 15, `${label}: zone B size`);
    ok(unique(world.zones.A.concat(world.zones.B)), `${label}: zones disjoint`);
    ok(world.zones.A.concat(world.zones.B).every((id) => world.leagueIds.includes(id)), `${label}: zones match league ids`);
    eq(Object.values(world.clubs).filter((c) => c.division === 'PN').length, 10, `${label}: 10 PN clubs`);
    eq(world.nacionalQueue.length, 10, `${label}: PN queue size`);
    const annual = EM.League.annualTable(T.apertura, T.clausura);
    eq(annual.length, 30, `${label}: annual table 30 rows`);
    for (const r of annual) eq(r.played, 32, `${label}: annual played 32`);
    const q = sum.qualification;
    eq(q.libertadores.length, 6, `${label}: 6 Libertadores`);
    eq(q.sudamericana.length, 6, `${label}: 6 Sudamericana`);
    ok(unique(q.libertadores.concat(q.sudamericana)), `${label}: qualifiers unique`);
    ok(q.libertadores.concat(q.sudamericana).every((id) => world.clubs[id] || world.cupTeams[id]), `${label}: qualifiers exist`);
    ok(q.libertadores.includes(T.apertura.champion) && q.libertadores.includes(T.clausura.champion), `${label}: torneo champions qualify`);
    ok(q.libertadores.includes(cups.copaArgentina.champion), `${label}: Copa Argentina champion qualifies`);
    eq(q.libertadoresRepechaje, q.libertadores[5], `${label}: ARG6 plays the repechaje`);
    ok(sum.relegated.every((id) => !q.libertadores.includes(id) || id === cups.copaArgentina.champion), `${label}: relegated clubs do not qualify`);
    ok(sum.relegated.every((id) => !q.sudamericana.includes(id)), `${label}: relegated clubs skip Sudamericana`);
    eq(sum.annualPos, annual.findIndex((r) => r.clubId === clubId) + 1, `${label}: summary annual position`);
    ok(sum.apertura.pos >= 1 && sum.apertura.pos <= 15 && sum.clausura.pos >= 1, `${label}: zone positions`);
    eq(sum.relegatedUser, sum.relegated.includes(clubId), `${label}: relegatedUser flag`);
    eq(sum.careerOver, sum.relegatedUser || s === 4, `${label}: careerOver flag`);
    eq(sum.continental === null, season.userCups.length === 0 && !cups.libertadores.guests.includes(clubId) && !cups.sudamericana.guests.includes(clubId), `${label}: continental summary`);
    if (sum.continental && sum.continental.group) eq(sum.continental.group.rows.length, 4, `${label}: continental group table`);
    ok(sum.prizes >= sum.annualPrize && sum.annualPrize > 0, `${label}: prizes accumulated`);
    const hist = career.history[career.history.length - 1];
    eq(hist.year, 2027 + s, `${label}: history year`);
    ok(Number.isFinite(career.budget) && career.budget >= 0, `${label}: budget finite and not negative (${career.budget})`);
    prevQual = { ...q };

    summary.push(
      `${label} ${career.year} | anual ${hist.annualPos}° ${hist.points}pts | Ap ${hist.apertura} | Cl ${hist.clausura} | ` +
      `${hist.continental ? hist.continental.name + ': ' + hist.continental.stage : 'sin copa int.'} | CA ${hist.copaArgentina} | ` +
      `títulos [${hist.titles.join(', ')}] | goleador ${sum.topScorer ? sum.topScorer.name + ' ' + sum.topScorer.goals : '-'} | ` +
      `caja ${career.budget} | campeones ${world.clubs[sum.champions.apertura].shortName}/${world.clubs[sum.champions.clausura].shortName}/` +
      `${(world.clubs[sum.champions.libertadores] || world.cupTeams[sum.champions.libertadores]).shortName}` +
      `${sum.relegatedUser ? ' | DESCENSO' : ''}`
    );

    // ---- next season ------------------------------------------------------------------------------------
    const budgetEnd = career.budget;
    const prizes = career.seasonPrizes;
    const nx = EM.Career.nextSeason(game);
    ok(nx.ok, `${label}: nextSeason`);
    if (career.phase === 'ended') {
      eq(career.history.length, s + 1, `${label}: ended after ${s + 1} seasons`);
      ok(career.endReason === (sum.relegatedUser ? 'relegation' : 'complete'), `${label}: end reason`);
      const fin = EM.Career.getFinalSummary(game);
      eq(fin.seasons, s + 1, `${label}: final summary seasons`);
      break;
    }
    eq(career.phase, 'preseason', `${label}: back to preseason`);
    eq(career.seasonIndex, s + 1, `${label}: season index advanced`);
    const club = EM.Career.userClub(game);
    const bd = career.budgetBreakdown;
    ok(Math.abs(bd.leftover - budgetEnd) < 0.05 && Math.abs(bd.prizes - prizes) < 0.05 && Math.abs(bd.total - career.budget) < 0.05, `${label}: budget = leftover + base + prizes`);
    ok(Math.abs(bd.total - (bd.leftover + bd.base + bd.prizes)) < 0.11, `${label}: budget breakdown adds up`);
    ok(Object.values(career.tasks).every((v) => v === false) && Object.keys(career.pre.sales).length === 0, `${label}: tasks reset`);
    for (const id of moves.loanIds) {
      const found = EM.Squad.findPlayer(world, id);
      ok(!found || !found.player.loan, `${label}: loan ended for ${id}`);
      if (found) eq(found.club.id, clubId, `${label}: loaned player returned`);
    }
    for (const id of moves.soldIds) {
      const found = EM.Squad.findPlayer(world, id);
      ok(!found || found.club.id !== clubId, `${label}: sold player did not come back`);
    }
    ok(club.players.every((p) => !p.loan), `${label}: no loans left`);
    checkPlayerUniqueness(world, `${label} rollover`);
    ok(Object.values(world.clubs).every((c) => c.id === clubId || (c.players.length >= 20 && c.players.length <= 36)), `${label}: AI squad sizes sane`);
    ok(allSquadPlayers(world).every(({ p }) => p.rating >= 45 && p.rating <= 92 && p.season.apps === 0), `${label}: ratings clamped, stats reset`);
    ok(allSquadPlayers(world).every(({ p }) => p.contract === undefined && p.injury === undefined), `${label}: no contracts or injuries`);
  }

  eq(career.phase, 'ended', `${tag}: career ended`);
  return { game, summary, seasons: career.history.length, relegated: career.endReason === 'relegation' };
}

// ---- Copa Argentina: how often does an ascenso club win? ------------------------------------------------------
function copaArgentinaRates(editions, seed) {
  const strengths = clubStrengths();
  const mid = strengths[14].id;
  const game = EM.Career.newGame(DATA, { clubId: mid, directorName: 'Test', seed });
  const { world, career } = game;
  const rng = EM.Util.careerRng(career);
  let asc = 0;
  const finalists = new Set();
  for (let e = 0; e < editions; e++) {
    game.season = EM.Season.createSeason(world, career, rng);
    for (const md of game.season.calendar.filter((m) => m.comp === 'copaArgentina')) EM.Season.playMatchday(game, md);
    const cup = game.season.cups.copaArgentina;
    ok(cup.done && cup.champion, 'CA edition has a champion');
    if (!world.leagueIds.includes(cup.champion)) asc++;
    finalists.add(cup.champion);
    // the two-legs/penalties bookkeeping must leave every tie decided
    for (const r of Object.keys(cup.ko)) for (const t of cup.ko[r]) ok(t.winner, 'CA tie decided');
    // scorers do not accumulate across the 200 fake editions
    for (const c of Object.values(world.clubs)) for (const p of c.players) p.season = { apps: 0, goals: 0, assists: 0 };
  }
  return { rate: asc / editions, asc, editions, distinct: finalists.size };
}

// Data without Copa Argentina still yields a complete bracket (byes for the top clubs).
function copaArgentinaFallback(seed) {
  const data = JSON.parse(JSON.stringify(DATA));
  delete data.cups.copaArgentina;
  const game = EM.Career.newGame(data, { clubId: clubStrengths()[14].id, directorName: 'Test', seed });
  const rng = EM.Util.careerRng(game.career);
  game.season = EM.Season.createSeason(game.world, game.career, rng);
  for (const md of game.season.calendar.filter((m) => m.comp === 'copaArgentina')) EM.Season.playMatchday(game, md);
  const cup = game.season.cups.copaArgentina;
  ok(cup.done && cup.champion, 'CA fallback has a champion');
  eq(cup.ko.r32.length, 32, 'CA fallback: 32 ties incl. byes');
  ok(cup.ko.r32.filter((t) => t.bye).length > 0, 'CA fallback: byes present');
}

// A user squad above the cap still confirms empty sell / loan tasks.
function oversizedSquadCheck(seed) {
  const big = DATA.clubs.find((c) => c.players.length > EM.Market.MAX_SQUAD);
  const game = EM.Career.newGame(DATA, { clubId: big.id, directorName: 'Test', seed });
  const ev = game.career.decisionEvent;
  let guard = 0;
  while (!ev.done && guard++ < 6) EM.Career.chooseDecision(game, (ev.options.find((o) => !o.cost) || ev.options[0]).id);
  ok(ev.done, 'oversized: decision resolved');
  ok(EM.Career.sellPlayers(game, []).ok, 'oversized: empty sell confirms');
  ok(EM.Career.loanPlayers(game, []).ok, 'oversized: empty loan confirms');
  ok(!EM.Career.signPlayer(game, EM.Career.search(game, {}).items[0].player.id).ok, 'oversized: cannot sign above the cap');
}

// Difficulty: flat strength bonus for the user's XI and a money multiplier, both kept across seasons.
function difficultyChecks(seed) {
  const clubId = DATA.clubs[10].id;
  const make = (difficulty) => EM.Career.newGame(DATA, { clubId, directorName: 'Test', seed, startBudget: 20, difficulty });
  const games = { easy: make('easy'), normal: make('normal'), hard: make('hard'), unset: EM.Career.newGame(DATA, { clubId, seed, startBudget: 20 }) };
  eq(games.unset.career.difficulty, 'normal', 'difficulty defaults to normal');
  eq(EM.Career.DIFFICULTIES.map((d) => d.label).join(','), 'Fácil,Normal,Difícil', 'difficulty labels');
  const bonus = { easy: 3, normal: 1.5, hard: 0 };
  const money = { easy: 1.25, normal: 1, hard: 1 };
  const strength = {};
  for (const k of Object.keys(bonus)) {
    const g = games[k];
    eq(g.career.difficulty, k, `${k}: stored in the game`);
    eq(g.career.mods.level, bonus[k], `${k}: strength bonus`);
    eq(g.career.budget, Math.round(20 * money[k] * 10) / 10, `${k}: start budget`);
    Object.keys(g.career.tasks).forEach((t) => { g.career.tasks[t] = true; });
    EM.Squad.fillEmpty(g.career, EM.Career.userClub(g));
    strength[k] = EM.Squad.userXI(g.career, EM.Career.userClub(g)).strength;
  }
  ok(Math.abs(strength.easy - strength.hard - 3) < 1e-9 && Math.abs(strength.normal - strength.hard - 1.5) < 1e-9, 'difficulty bonus is added to the XI strength');
  const g = games.easy;
  EM.Career.simulateSeason(g);
  const base = { 1: 14, 2: 8, 3: 4 }[EM.Career.userClub(g).tier];
  const prizes = g.career.seasonPrizes;
  const left = g.career.budget;
  if (!g.career.summary.careerOver) {
    EM.Career.nextSeason(g);
    const bd = g.career.budgetBreakdown;
    eq(bd.base, Math.round(base * 1.25 * 10) / 10, 'easy: base income +25%');
    ok(Math.abs(bd.prizes - prizes * 1.25) < 0.11, 'easy: prizes +25%');
    ok(Math.abs(bd.total - (left + bd.base + bd.prizes)) < 0.11, 'easy: budget breakdown adds up');
    eq(g.career.mods.level, 3, 'easy: bonus kept after the season rollover');
  }
}

// ---- unit-level checks ------------------------------------------------------------------------------------------------
function unitChecks() {
  const U = EM.Util;
  const r1 = U.createRng(42);
  const r2 = U.createRng(42);
  ok(r1.next() === r2.next() && r1.int(1, 10) === r2.int(1, 10), 'rng is deterministic');
  eq(U.formatMoney(4.52), 'US$ 4.5M', 'formatMoney');
  eq(U.formatDate('2027-01-23'), 'sáb 23 ene 2027', 'formatDate');
  eq(EM.Positions.fit('ST', 'CF'), 0.95, 'fit ST/CF');
  eq(EM.Positions.fit('LB', 'LWB'), 0.95, 'fit LB/LWB');
  eq(EM.Positions.fit('CB', 'CM'), 0.55, 'fit adjacent lines');
  eq(EM.Positions.fit('CB', 'ST'), 0.2, 'fit far lines');
  eq(EM.Positions.fit('GK', 'CB'), 0.05, 'fit GK mismatch');
  eq(EM.Positions.fit('CM', 'CM'), 1, 'fit exact');
  for (const f of EM.Positions.FORMATION_NAMES) {
    const slots = EM.Positions.slotsOf(f);
    eq(slots.length, 11, `${f}: 11 slots`);
    eq(slots[0].y > 80, true, `${f}: GK at the bottom`);
    ok(slots.filter((s) => s.type !== 'GK').every((s) => s.y < slots[0].y), `${f}: outfield above GK`);
  }
  eq(EM.Positions.slotsOf('4-4-2')[10].type, 'CF', '4-4-2 second striker is CF');
  // penalties never end level
  const rng = U.createRng(7);
  for (let i = 0; i < 500; i++) { const p = EM.Match.penalties(rng, 70, 65); ok(p.h !== p.a, 'penalties decided'); }
  // match sim shape
  const home = { clubId: 'a', strength: 72, xi: DATA.clubs[0].players.slice(0, 11) };
  const away = { clubId: 'b', strength: 60, xi: null };
  let hw = 0, aw = 0;
  for (let i = 0; i < 2000; i++) {
    const m = EM.Match.simulate({}, home, away, { rng, knockout: false });
    ok(m.events.length === m.hg + m.ag, 'events = goals');
    ok(m.events.every((e, k) => k === 0 || e.min >= m.events[k - 1].min), 'events sorted');
    ok(m.events.filter((e) => e.side === 'away').every((e) => e.playerId === null), 'no xi -> anonymous scorer');
    if (m.winner === 'home') hw++; else if (m.winner === 'away') aw++;
  }
  ok(hw > aw * 2, 'stronger home side wins far more often');
  const ko = EM.Match.simulate({}, { clubId: 'a', strength: 65, xi: null }, { clubId: 'b', strength: 65, xi: null }, { rng, knockout: true, neutral: true });
  ok(ko.winner !== 'draw', 'knockout always has a winner');
  // qualification rule
  const annual = Array.from({ length: 30 }, (_, i) => ({ clubId: 'c' + (i + 1) }));
  const q = EM.League.qualification({ apertura: 'c5', clausura: 'c5', copaArgentinaChampion: 'c9', annual, relegated: ['c1', 'c30'] });
  eq(q.libertadores.join(','), 'c5,c9,c2,c3,c4,c6', 'repeated champion frees a slot; relegated c1 skipped');
  eq(q.libertadoresRepechaje, 'c6', 'last annual entrant is ARG6');
  eq(q.sudamericana.join(','), 'c7,c8,c10,c11,c12,c13', 'Sudamericana next six');
  const q2 = EM.League.qualification({ apertura: 'c1', clausura: 'c2', copaArgentinaChampion: 'x-asc', annual, relegated: ['x-asc'] });
  eq(q2.libertadores.join(','), 'c1,c2,x-asc,c3,c4,c5', 'second-division Copa Argentina champion still qualifies');
  // relegation rule
  const ann = Array.from({ length: 30 }, (_, i) => ({ clubId: 'c' + (i + 1) }));
  const prom = (id) => (id === 'c20' ? 0.9 : 1.5);
  eq(EM.League.relegation(ann, prom).join(','), 'c20,c30', 'worst promedio + last of the annual table');
  eq(EM.League.relegation(ann, (id) => (id === 'c30' ? 0.5 : 1.5)).join(','), 'c30,c29', 'same club -> second to last');
  // roundtrip of value formula
  eq(EM.Players.computeValue(70, 27, 'CM'), 2.9, 'computeValue 70/27/CM');
}

// ---- run ------------------------------------------------------------------------------------------------------------------
console.log(`ELMANAGER engine test (seed ${SEED})`);
const t0 = Date.now();
unitChecks();

const strengths = clubStrengths();
const midClub = strengths[14].id;
const strongest = strengths[0].id;
console.log(`Career 1: ${DATA.clubs.find((c) => c.id === midClub).name} (strength rank 15)`);
const first = playCareer(midClub, SEED, 'C1');
first.summary.forEach((l) => console.log('  ' + l));
let seasonsReached = first.seasons;
if (first.seasons < 5) {
  console.log(`  relegated after ${first.seasons} seasons; running career 2 with ${DATA.clubs.find((c) => c.id === strongest).name}`);
  const second = playCareer(strongest, SEED + 1, 'C2');
  second.summary.forEach((l) => console.log('  ' + l));
  seasonsReached = second.seasons;
}
eq(seasonsReached, 5, 'a career reaches season 5');

// Optional stress mode: `node scripts/test-engine.mjs <seed> all` plays one career with every club.
if (process.argv[3] === 'all') {
  const outcomes = [];
  for (const c of strengths) {
    const r = playCareer(c.id, SEED + 100, 'ALL-' + c.id);
    outcomes.push(`${c.name}: ${r.seasons} seasons${r.relegated ? ' (descenso)' : ''}`);
  }
  console.log('  all clubs: ' + outcomes.join(' | '));
}

const ca = copaArgentinaRates(200, SEED + 2);
console.log(`Copa Argentina: ${ca.asc}/${ca.editions} editions won by an ascenso club (${(ca.rate * 100).toFixed(1)}%), ${ca.distinct} distinct champions`);
ok(ca.rate < 0.05, `ascenso Copa Argentina win rate < 5% (got ${(ca.rate * 100).toFixed(1)}%)`);
copaArgentinaFallback(SEED + 3);
oversizedSquadCheck(SEED + 4);
difficultyChecks(SEED + 5);

console.log(`${checks} checks, ${failures.length} failures, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.log('FAILED');
  process.exit(1);
}
console.log('OK');
