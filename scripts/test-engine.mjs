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
for (const f of ['util', 'positions', 'players', 'match', 'squad', 'league', 'cups', 'season', 'market', 'career', 'save']) {
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
  for (const p of world.freeAgents) list.push({ p, where: 'free' });
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

function fixLineup(game) {
  const { career } = game;
  EM.Squad.autoLineup(career, EM.Career.userClub(game));
}

// Squad hygiene so the pre-season checklist can pass: 18..32 players.
function fixSquadSize(game) {
  const { world, career } = game;
  const club = EM.Career.userClub(game);
  let guard = 0;
  while (club.players.length > EM.Market.MAX_SQUAD && guard++ < 20) {
    const worst = club.players.filter((p) => !p.loan).sort((a, b) => a.value - b.value)[0];
    const r = EM.Market.release(world, career, worst.id);
    ok(r.ok, 'release to trim squad: ' + r.message);
    if (!r.ok) break;
  }
  guard = 0;
  while (club.players.length < EM.Market.MIN_SQUAD && guard++ < 40) {
    const cands = EM.Market.search(world, career, { maxPrice: 1.5 }).filter((i) => i.free || i.club);
    let signed = false;
    for (const it of cands) {
      for (let a = 0; a < 3 && !signed; a++) {
        const r = EM.Market.negotiate(world, career, it.player.id, it.price * 1.1, 2);
        if (r.accepted) signed = true;
        if (r.blocked) break;
      }
      if (signed) break;
    }
    ok(signed, 'could sign a player to reach the minimum squad');
    if (!signed) break;
  }
}

// Exercises the market while a window is open. Everything asserted keeps the world consistent.
function marketRound(game, label) {
  const { world, career } = game;
  const club = EM.Career.userClub(game);
  ok(EM.Market.windowOpen(career), `${label}: window open`);

  const list = EM.Market.search(world, career, { line: 'DEF', maxPrice: 3 });
  ok(list.length > 0 && list.length <= 80, `${label}: search returns items`);
  for (let i = 1; i < list.length; i++) ok(list[i - 1].player.rating >= list[i].player.rating, `${label}: search sorted by rating`);
  ok(list.every((i) => i.player.pos && EM.Positions.line(i.player.pos) === 'DEF' && i.price <= 3), `${label}: search filters`);
  ok(list.every((i) => i.club === null || i.club.id !== career.clubId), `${label}: search excludes own players`);
  ok(EM.Market.search(world, career, { q: 'MESSI' }).every((i) => EM.Util.norm(i.player.name).includes('messi')), `${label}: accent/case-insensitive search`);

  // free agent signing (uses the 3-attempt rule)
  const fa = EM.Market.search(world, career, { region: 'Libre' })[0];
  if (fa && club.players.length < EM.Market.MAX_SQUAD && career.budget > 1) {
    let attempts = 0;
    let signed = false;
    while (attempts < 5) {
      const r = EM.Market.negotiate(world, career, fa.player.id, 0, 2);
      if (r.blocked && r.attemptsLeft === 0) break;
      if (r.blocked) break;
      attempts++;
      if (r.accepted) { signed = true; break; }
    }
    ok(attempts <= EM.Market.MAX_ATTEMPTS, `${label}: max ${EM.Market.MAX_ATTEMPTS} attempts`);
    if (signed) {
      ok(club.players.some((p) => p.id === fa.player.id), `${label}: signed free agent is in the squad`);
      ok(!world.freeAgents.some((p) => p.id === fa.player.id), `${label}: signed free agent left the pool`);
    }
  }

  // buy a cheap domestic player
  const buy = EM.Market.search(world, career, { region: 'ASC', maxPrice: 1.2 })[0];
  if (buy && club.players.length < EM.Market.MAX_SQUAD && career.budget > 3) {
    const seller = buy.club;
    const before = seller.players.length;
    for (let a = 0; a < 3; a++) {
      const r = EM.Market.negotiate(world, career, buy.player.id, buy.price * 1.15, 3);
      if (r.blocked) break;
      if (r.accepted) {
        eq(seller.players.length, before - 1, `${label}: seller lost the player`);
        ok(club.players.some((p) => p.id === buy.player.id), `${label}: buyer has the player`);
        eq(buy.player.clubId, club.id, `${label}: clubId updated`);
        break;
      }
    }
  }

  // loan in a non-starter (cheap)
  const loanCands = EM.Market.search(world, career, { region: 'ARG', maxPrice: 1.5 });
  for (const it of loanCands) {
    if (!it.club) continue;
    const r = EM.Market.loanIn(world, career, it.player.id);
    if (r.ok) {
      ok(it.player.loan && it.player.loan.from === it.club.id, `${label}: loan recorded`);
      ok(club.players.some((p) => p.id === it.player.id), `${label}: loaned player in squad`);
      break;
    }
  }

  // list a bench player and accept an offer (deterministic offers)
  const candidate = club.players.filter((p) => !p.loan).sort((a, b) => a.rating - b.rating)[3];
  if (candidate && club.players.length > EM.Market.MIN_SQUAD + 1) {
    EM.Market.listPlayer(world, career, candidate.id, 'transfer');
    const o1 = EM.Market.offersFor(world, career, candidate.id);
    const o2 = EM.Market.offersFor(world, career, candidate.id);
    ok(JSON.stringify(o1) === JSON.stringify(o2), `${label}: offers are deterministic per window`);
    ok(o1.length >= 1 && o1.length <= 3, `${label}: 1..3 offers`);
    if (o1.length) {
      const before = career.budget;
      const target = EM.Squad.getClub(world, o1[0].clubId);
      const r = EM.Market.acceptOffer(world, career, candidate.id, o1[0].id);
      ok(r.ok, `${label}: accept offer ${r.message}`);
      ok(!club.players.some((p) => p.id === candidate.id), `${label}: sold player left`);
      ok(target.players.some((p) => p.id === candidate.id), `${label}: sold player joined buyer`);
      ok(Math.abs(career.budget - (before + o1[0].fee)) < 0.11, `${label}: budget credited`);
    }
  }

  // renew somebody with a short contract
  const expiring = club.players.find((p) => p.contract <= 2 && p.age < 33 && !p.loan);
  if (expiring && career.budget > 2) {
    const r = EM.Market.renew(career, expiring, 2);
    ok(r.ok, `${label}: renew ${r.message}`);
  }
  const longContract = club.players.find((p) => p.contract > 2);
  if (longContract) ok(!EM.Market.renew(career, longContract, 1).ok, `${label}: cannot renew a long contract`);

  fixLineup(game);
  checkPlayerUniqueness(world, label + ' market');
  ok(career.budget > -0.05, `${label}: budget not negative (${career.budget})`);
}

// ---- one full career --------------------------------------------------------------------------------------
function playCareer(clubId, seed, tag, opts = {}) {
  const game = EM.Career.newGame(DATA, { clubId, directorName: 'Test', seed });
  const { career, world } = game;
  const summary = [];
  let prevQual = null;
  let roundTripDone = false;
  ok(game.version === 1, 'game version');
  const startIds = new Set(allSquadPlayers(world).map((x) => x.p.id));
  ok(startIds.size > 1000, 'players loaded');

  for (let s = 0; s < career.maxSeasons; s++) {
    const label = `${tag} S${s + 1}`;
    eq(career.phase, 'preseason', `${label}: starts in preseason`);
    eq(career.year, 2027 + s, `${label}: year`);
    eq(career.window, 'pre', `${label}: pre window`);
    ok(!EM.Career.canStartSeason(game), `${label}: cannot start before objectives`);

    // cups of this season contain last season's qualifiers
    const season = game.season;
    if (prevQual) {
      for (const id of prevQual.libertadores) ok(season.cups.libertadores.teams.includes(id), `${label}: ${id} in Libertadores`);
      for (const id of prevQual.sudamericana) ok(season.cups.sudamericana.teams.includes(id), `${label}: ${id} in Sudamericana`);
      const userWasIn = prevQual.libertadores.includes(clubId) ? 'libertadores' : (prevQual.sudamericana.includes(clubId) ? 'sudamericana' : null);
      if (prevQual.userRelegated) ok(!season.userCups.length, `${label}: relegated user not in cups`);
      else if (userWasIn) ok(season.userCups.includes(userWasIn), `${label}: qualified user plays ${userWasIn}`);
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
    // Clausura mirrors the Apertura with home and away swapped
    const a0 = season.torneos.apertura.rounds[0][0];
    const c0 = season.torneos.clausura.rounds[0][0];
    ok(a0.home === c0.away && a0.away === c0.home, `${label}: Clausura mirrors Apertura`);
    eq(season.calendar.length > 60, true, `${label}: calendar built`);
    ok(season.calendar.every((md, i) => i === 0 || season.calendar[i - 1].date <= md.date), `${label}: calendar sorted by date`);

    // pre-season: objectives, decision, friendlies, market, lineup
    const opts2 = EM.Career.objectiveOptions(game);
    const objs = {
      league: career.expectation,
      cup: opts2.cup ? 'grupos' : null,
      copaArgentina: 'octavos'
    };
    if (opts.safeObjectives) objs.league = 'permanencia';
    const cash0 = career.budget;
    const so = EM.Career.setObjectives(game, objs);
    ok(so.ok, `${label}: setObjectives ${so.message || ''}`);
    ok(career.budget > cash0, `${label}: base income paid`);
    // changing objectives must not pay the base income twice
    const cash1 = career.budget;
    EM.Career.setObjectives(game, { ...objs, league: 'permanencia' });
    EM.Career.setObjectives(game, objs);
    ok(Math.abs(career.budget - cash1) < 0.11, `${label}: objective re-selection is idempotent`);

    const ev = career.decisionEvent;
    if (ev.type === 'sponsor') {
      let guard = 0;
      while (!ev.done && guard++ < 5) EM.Career.pitchSponsor(game, ev.options[guard % ev.options.length].id);
      ok(ev.done, `${label}: sponsor event resolved`);
      ok(EM.Career.chooseOption(game, 'skip').ok === false, `${label}: decision cannot be repeated`);
    } else {
      const cheap = ev.options.find((o) => o.cost <= 2 && o.id !== 'keep') || ev.options[0];
      const r = EM.Career.chooseOption(game, cheap.id);
      ok(r.ok, `${label}: decision ${ev.type} ${r.message || ''}`);
      ok(ev.done, `${label}: decision done`);
    }

    const friendlies = EM.Career.friendlyOptions(game);
    eq(friendlies.length, 4, `${label}: 4 friendly options`);
    const fr = EM.Career.playFriendly(game, friendlies[0].id);
    ok(fr.ok, `${label}: friendly`);
    ok(!EM.Career.playFriendly(game, friendlies[0].id).ok, `${label}: same friendly twice refused`);
    EM.Career.playFriendly(game, friendlies[1].id);
    EM.Career.playFriendly(game, friendlies[2].id);
    ok(!EM.Career.playFriendly(game, friendlies[3].id).ok, `${label}: max 3 friendlies`);
    ok(career.mods.cohesion > 0 && career.mods.cohesion <= 1.2, `${label}: cohesion within cap`);

    marketRound(game, label + ' pre');
    fixSquadSize(game);
    fixLineup(game);
    const chk = EM.Career.checkPreseason(game);
    ok(chk.ok, `${label}: preseason checklist ${chk.reasons.join('; ')}`);
    const st = EM.Career.startSeason(game);
    ok(st.ok, `${label}: startSeason`);
    eq(career.phase, 'season', `${label}: phase season`);
    eq(career.window, null, `${label}: window closed after start`);
    ok(!EM.Market.negotiate(world, career, allSquadPlayers(world)[0].p.id, 1, 1).accepted, `${label}: no transfers with window closed`);

    // play the season
    let windowSeen = false;
    let steps = 0;
    let userLeagueMatches = 0;
    let userPlayoffMatches = 0;
    let userContinentalMatches = 0;
    let midWindowFullSquad = null;
    while (steps++ < 400) {
      const r = EM.Season.advanceToNextUserMatch(game);
      if (r.userMatch) {
        const m = r.userMatch;
        ok(Number.isInteger(m.hg) && Number.isInteger(m.ag), `${label}: user match has a score`);
        if (m.comp === 'apertura' || m.comp === 'clausura') {
          if (r.userMatchday.stage === 'regular') userLeagueMatches++; else userPlayoffMatches++;
        } else if (m.comp !== 'copaArgentina') userContinentalMatches++;
      }
      if (r.windowOpened) {
        windowSeen = true;
        eq(career.window, 'mid', `${label}: mid window open`);
        marketRound(game, label + ' mid');
        midWindowFullSquad = EM.Career.userClub(game).players.length;
      }
      if (!roundTripDone && s === 1 && steps === 12) {
        roundTripDone = true;
        ok(EM.Save.save(game), 'save works');
        ok(EM.Save.exists(), 'save exists');
        const loaded = EM.Save.load();
        ok(!!loaded, 'load works');
        eq(JSON.stringify(loaded), JSON.stringify(game), 'save -> JSON -> load roundtrip preserves the game');
        // determinism: same input, same continuation
        const a = JSON.parse(JSON.stringify(game));
        const b = loaded;
        EM.Season.advanceToNextUserMatch(a);
        EM.Season.advanceToNextUserMatch(b);
        eq(JSON.stringify(a), JSON.stringify(b), 'loaded game continues identically (deterministic RNG)');
        EM.Save.clear();
        ok(!EM.Save.exists(), 'clear works');
      }
      if (r.seasonOver) break;
    }
    ok(windowSeen, `${label}: mid-season window appeared`);
    ok(midWindowFullSquad === null || midWindowFullSquad >= 14, `${label}: squad size sane`);
    ok(EM.Season.isSeasonOver(game.season), `${label}: season over`);
    ok(game.season.calendar.every((md) => md.played), `${label}: every match day played`);
    eq(career.window, null, `${label}: window closed at end`);
    eq(userLeagueMatches, 32, `${label}: user plays 32 regular league matches`);
    eq(EM.Season.nextUserMatchday(game.season), null, `${label}: no next match day`);

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

    // ---- close the season -----------------------------------------------------------------------------
    const fin = EM.Career.finishSeason(game);
    ok(fin.ok, `${label}: finishSeason ${fin.message || ''}`);
    eq(career.phase, 'review', `${label}: review phase`);
    const sum = career.summary;
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
    const hist = career.history[career.history.length - 1];
    eq(hist.year, 2027 + s, `${label}: history year`);
    ok(Number.isFinite(career.budget) && Number.isFinite(career.confidence) && career.confidence >= 0 && career.confidence <= 100, `${label}: budget/confidence finite`);
    ok(career.finances.length > 0 && career.news.length > 0 && career.news.length <= 80, `${label}: finances and news present`);
    for (const md of game.season.calendar) for (const m of md.matches || []) {
      for (const ev of m.events) if (ev.playerId) ok(true, '');
    }
    prevQual = { ...q, userRelegated: sum.relegatedUser };

    summary.push(
      `${label} ${career.year} | anual ${hist.annualPos}° ${hist.points}pts | Ap ${hist.apertura} | Cl ${hist.clausura} | ` +
      `${hist.continental ? hist.continental.name + ': ' + hist.continental.stage : 'sin copa int.'} | CA ${hist.copaArgentina} | ` +
      `títulos [${hist.titles.join(', ')}] | goleador ${hist.topScorer ? hist.topScorer.name + ' ' + hist.topScorer.goals : '-'} | ` +
      `obj ${hist.objectiveMet ? 'ok' : 'no'} | caja ${career.budget} | conf ${career.confidence} | ` +
      `campeones ${world.clubs[sum.champions.apertura].shortName}/${world.clubs[sum.champions.clausura].shortName}/` +
      `${(world.clubs[sum.champions.libertadores] || world.cupTeams[sum.champions.libertadores]).shortName}` +
      `${sum.relegatedUser ? ' | DESCENSO' : ''}`
    );

    // ---- next season ------------------------------------------------------------------------------------
    const loanedIn = EM.Career.userClub(game).players.filter((p) => p.loan).map((p) => ({ id: p.id, from: p.loan.from }));
    const nx = EM.Career.startNextSeason(game);
    ok(nx.ok, `${label}: startNextSeason`);
    if (career.phase === 'ended') {
      eq(career.history.length, s + 1, `${label}: ended after ${s + 1} seasons`);
      break;
    }
    eq(career.seasonIndex, s + 1, `${label}: season index advanced`);
    ok(EM.Career.userClub(game).players.every((p) => !p.loan || p.loan.until >= career.seasonIndex), `${label}: loans expired`);
    for (const l of loanedIn) {
      const found = EM.Squad.findPlayer(world, l.id);
      ok(!found || !found.player.loan, `${label}: loan ended for ${l.id}`);
      if (found && found.club) ok(found.club.id !== clubId || l.from === clubId, `${label}: loaned player returned to ${l.from}`);
    }
    checkPlayerUniqueness(world, `${label} rollover`);
    ok(world.freeAgents.length <= 60, `${label}: free agent pool bounded`);
    ok(Object.values(world.clubs).every((c) => c.id === clubId || (c.players.length >= 20 && c.players.length <= 36)), `${label}: AI squad sizes sane`);
    ok(allSquadPlayers(world).every(({ p }) => p.rating >= 45 && p.rating <= 92 && p.season.apps === 0 && p.injury === 0), `${label}: ratings clamped, stats reset`);
  }

  eq(career.phase, 'ended', `${tag}: career ended`);
  return { game, summary, seasons: career.history.length, sacked: career.sackedReason };
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
    career.budget = 50;
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
  // needs
  const club = { players: [{ pos: 'GK', age: 36 }, { pos: 'CB', age: 30 }, { pos: 'LB', age: 30 }] };
  const needs = EM.Squad.needs(club);
  ok(needs.some((n) => n.startsWith('Falta profundidad: solo 1 ')), 'needs: depth message');
  ok(needs.includes('Arqueros envejecidos'), 'needs: old keepers');
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
  console.log(`  sacked after ${first.seasons} seasons (${first.sacked}); running career 2 with ${DATA.clubs.find((c) => c.id === strongest).name}`);
  const second = playCareer(strongest, SEED + 1, 'C2', { safeObjectives: true });
  second.summary.forEach((l) => console.log('  ' + l));
  seasonsReached = second.seasons;
}
eq(seasonsReached, 5, 'a career reaches season 5');

// Optional stress mode: `node scripts/test-engine.mjs <seed> all` plays one career with every club.
if (process.argv[3] === 'all') {
  const outcomes = [];
  for (const c of strengths) {
    const r = playCareer(c.id, SEED + 100, 'ALL-' + c.id, { safeObjectives: false });
    outcomes.push(`${c.name}: ${r.seasons} seasons${r.sacked ? ' (' + r.sacked + ')' : ''}`);
  }
  console.log('  all clubs: ' + outcomes.join(' | '));
}

const ca = copaArgentinaRates(200, SEED + 2);
console.log(`Copa Argentina: ${ca.asc}/${ca.editions} editions won by an ascenso club (${(ca.rate * 100).toFixed(1)}%), ${ca.distinct} distinct champions`);
ok(ca.rate < 0.05, `ascenso Copa Argentina win rate < 5% (got ${(ca.rate * 100).toFixed(1)}%)`);
copaArgentinaFallback(SEED + 3);

console.log(`${checks} checks, ${failures.length} failures, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.log('FAILED');
  process.exit(1);
}
console.log('OK');
