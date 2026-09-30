# ELMANAGER

## Objective
Turn EL DT (single-season, five-task sporting-director toy) into ELMANAGER: a 5-season Argentine football career game with a FIFA 14/15/16-inspired career hub, real league format, international cups, pre-season decisions, squad management, save/load, and a responsive PC + mobile UI.

## Problem / Why
Current game: one season simulated in one click, fixed 5-task checklist, no calendar, no cups, no persistence, pitch upside-down (GK on top), positions shown in English codes, desktop layout is a stretched mobile column.

## Current architecture (explored)
- Static HTML/CSS/vanilla JS, classic scripts, globals (`window.GameState`, `GameLogic`, `UICommon`, `Screens`, `Tasks`).
- `state.js`: single-season state; squad = base club squad - sold/loaned + signed copies (sellers never lose players, world is not consistent).
- `logic.js`: pricing, pre-season events, XI strength, single round-robin season sim, top scorer estimate.
- `formations.js`: 5 formations, GK at y=8 (top).
- `screens.js` / `tasks.js`: intro, hub with 5 locked tasks, bottom-sheet tasks, results table.
- Data: `scripts/scrape.mjs` -> `public/data/clubs.js` (30 clubs + squads, 77 foreign market clubs). No zones, cups, promotion data.

## Data findings (promiedos.com.ar, verified 2026-09-30)
- League page exposes Apertura/Clausura zone tables (2 x 15), Promedios (relegation), Tabla Anual with destinations (champion + Libertadores + Sudamericana + descenso).
- Libertadores / Sudamericana pages expose 2026 group-stage participants (8 groups x 4) with country ids.
- Fixtures and playoff games are lazy-loaded (not in page JSON): fixtures are generated in-game with the real format.
- Not available on promiedos, therefore game parameters (documented, not presented as real data): player ratings/values (own formula, pre-existing), contracts, wages, prize money, youth players generated for future seasons, country base ratings for cup strength.

## Scope / Design
- Real format: Apertura + Clausura, 2 zones of 15, 16 fechas, top 8 per zone to single-match playoffs; Tabla Anual; Promedios; 2 relegations (last of annual table + worst promedio); Primera Nacional promotion pool.
- Qualification (real 2026 rule, verified in press 2026-09-30): Libertadores ARG1 Apertura champion, ARG2 Clausura champion, ARG3 Copa Argentina champion, then best of annual table until 6; the last annual-table entrant plays Fase 2 (repechaje); repeated champions free their slot to the table. Sudamericana: next 6 of the annual table. Annual leader = "Campeón de Liga". Relegation: worst promedio + last of annual (if same club, second-to-last of annual).
- Copa Argentina (user decision 2026-09-30): 64 teams, real 2026 participants from promiedos (32 primera + 32 ascenso), single match, neutral, penalties; ascenso upsets possible but rare (Huracán 2014 won it from the B Nacional).
- Cups: 32 teams, 8 groups of 4 (home/away), Libertadores top 2 to R16, 3rd to Sudamericana playoffs; Sudamericana winners to R16, runners-up vs Libertadores thirds; two-leg knockouts, single final; penalties on ties.
- Career: 5 seasons (2027-2031), board confidence, objectives chosen in pre-season, budget carried over + income, sacked on relegation or confidence 0.
- Squad: XI + 7 subs, captain, transfer/loan listing with AI offers, contracts + renewals, release, youth intake, aging/progression, injuries.
- Market: buy with negotiation, loan in, free agents, position search, sellers lose players (world consistency).
- UI: title screen (INICIAR, Continuar, Cafecito), club select, career hub dashboard, top nav (desktop) / bottom nav (mobile), pitch with GK at bottom, positions in Spanish.

## Constraints
- No framework, no build step, no dependencies. Code/comments English, UI copy neutral Spanish (Argentine audience).
- No FIFA assets or literal copy; own identity (celeste/sun-gold accents, angled panels).

## Tasks
- [ ] T1 Scraper: zones, promedios, cup participants + strength, promotion pool, CF position. Route: delegated writer (background, one file + data run).
- [ ] T2 Engine rewrite: world, match, league, cups, season calendar, career, market, save. Route: inline (parent holds the architecture; engine modules are tightly coupled, a design handoff would be larger than the code). Trigger evidence: writer trigger fired (2+ non-trivial files); delegation skipped deliberately, recorded here.
- [ ] T3 UI rewrite: title, club select, hub, squad, tactics pitch, market, calendar, competitions, news, pre-season, match overlay, season review, career end. Route: inline (same reason).
- [ ] T4 Headless engine test: 5 seasons full career, cup qualification, relegation, save/load roundtrip. Route: inline.
- [ ] T5 Browser QA desktop + mobile, console errors, English leftovers. Route: inline.
- [ ] T6 README + docs + Railway hosting (user requirement 2026-09-30): zero-dependency Node static server `server.mjs` reading `PORT`, `package.json` with `start` script and `engines.node`. Saves stay in the browser (localStorage).

## Acceptance criteria
- 5 full seasons playable end to end; stats/tables reset per season; history kept.
- Cup qualification in season N produces cup participation in season N+1, integrated in the calendar.
- Save/load restores mid-season state.
- No horizontal overflow at 375px; desktop uses width with multi-column hub.
- GK at the bottom; all positions in Spanish.

## TDD
Mode: off (no project config, not requested). Checks: `node --check`, headless career simulation script, browser smoke at 1440px and 390px.

## Delivery
Strategy: ask-on-risk. Branch `feat/elmanager`.

## Route revision (2026-09-30, session 2)
Routes for T2 and T3 changed from inline to delegated direct: one bounded writer per task, sequential (never parallel writers), parent keeps the design handoff. Trigger evidence: writer trigger (2+ non-trivial files) and mapping trigger (13 source files). T1 also delegated. FIFA 14/15/16 career-hub research delegated read-only, feeds T3.

## Size forecast
Rewrite of ~2,400 existing lines plus new engine, cups, career, save and UI: about 6,000-8,000 authored changed lines, far above the ~400 delivery budget. Chain strategy: stacked-to-main (user choice 2026-09-30).
Planned slices: (1) data: scraper + clubs.js + images; (2) engine core: util, positions, players, match, squad; (3) league + cups + season; (4) market + career + save + engine test; (5) UI shell, title, styles; (6) UI views; (7) README + cleanup of old files.

## Known gaps found by mapping (2026-09-30)
- `league.promedios` is empty in regenerated `clubs.js` (parser finds no rows); cause unknown. T1 must fix or document.
- `CF` exists in data but not in `POS_META`; no formation slot accepts it.
- Empty pitch slots and picker title render raw English codes (`tasks.js:601`, `:684`).
- Player ids are positional (`${teamId}-${index+1}`): unstable across rescrapes, affects saves.
- Scraper user-agent still `director-deportivo-ar scraper`.
- Loan error message says "venta" (`tasks.js:290`).

## Progress
- Branch `feat/elmanager` created from main (ea9991a).
- Engram mirror: PENDING (engram tools unavailable in sessions 1 and 2).
- Session 1 left T1 partly done, uncommitted: scraper extended, `clubs.js` regenerated, ~50 new crests/flags untracked.
- T1 done: Copa Argentina added (30 primera + 34 ascenso, 8 in promotion pool, strength 55-59.5). Commit 5b6e38f on `feat/elmanager-01-data`. Checks: `node --check scripts/scrape.mjs` OK; scraper run OK (warning: a few players with empty position fall back to group default). Review assess: medium, `under_budget` (201 lines) -> pending in slice.
- PR https://github.com/calotwm/ELDT/pull/1 opened from `feat/elmanager-02-engine` (data slice + this doc, commits 5b6e38f, 3a4b2cd).
- T2 done on `feat/elmanager-03-engine` (stacked on 02): commits 5548a00 (core), 30ab630 (league/cups/season), baa863a (market/career/save/test), 4048 lines. Checks: `node --check` all engine files OK; `node scripts/test-engine.mjs 314159` -> 42190 checks, 0 failures, Copa Argentina ascenso champion 1.5% of 200 editions (writer also ran 8 seeds + all-30-clubs stress: 0 failures). Review assess: medium, 4048 lines -> review due; consent pending.
- PR https://github.com/calotwm/ELDT/pull/2 (engine, stacked on #1) from `feat/elmanager-04-ui`.
- User decisions 2026-09-30: UI in two parts (A: title, Central, Plantel/Táctica, match overlay; B: rest) with a pause between; QA screenshots only on key screens; automatic reviews off (`gentle-ai review mode disable --scope clone`).
- PAUSED by user during T3 part A. UI writer stopped mid-work: `public/index.html` modified and `public/js/ui/` untracked, both partial and uncommitted. On resume: inspect them, finish part A (writer spec: ui-spec in session scratchpad, not persisted; re-derive from this doc), commit on a new branch stacked on `feat/elmanager-04-ui`.

## Scope change (user, 2026-09-30)
Career-mode direction dropped ("no quería una copia del modo carrera"). New scope: clearlake-style game (pick club, 5 pre-season tasks, one-click season simulation, results) over 5 seasons, with real competitions (Apertura/Clausura, Tabla Anual, promedios, descensos, Copa Argentina, Libertadores/Sudamericana carry-over), foreign market top 5 per club from Brasil, Uruguay, Paraguay, Colombia, Chile (+ Argentines abroad), FIFA 14-16 visual style only, responsive, pitch GK at the bottom, Spanish positions, title screen with Cafecito, Railway hosting.
- Removed from scope: match-by-match play, calendar navigation, news inbox, board/objectives/sacking (relegation still ends the career), friendlies, injuries, AI offers, contracts.
- Partial part-A UI discarded. New branch `feat/elmanager-05-simple` (stacked on 04).
- Tasks now: S1 scraper leagues (delegated, background); S2 engine trim + simplified UI (one delegated writer); S3 QA key screens (title, hub, pitch, results at 1440/390) + HTML read of the rest; S4 README + Railway server.
- S1 done: Paraguay, Colombia, Chile top 5 per club; Uruguay top 5 (commit 4dcbd2c). foreignClubs 77 -> 125.
- S2 done (delegated writer): engine trimmed to one-click seasons (preseason.js tasks, career.js simulateSeason/nextSeason, difficulty Fácil/Normal/Difícil = +3/+1.5/+0 strength; Normal mid club ~4.9 places above its strength rank over 30 seeded seasons), FIFA 14-style UI (charcoal, flat tiles, lime highlight), old UI files deleted. Checks: `node --check` all js OK; `node scripts/test-engine.mjs` OK on 4 seeds (0 failures).
- S3 QA: desktop 1440 (title, club select, hub, all 5 tasks, pitch with GK at bottom, results) and mobile 375 (title, results, hub, formation): no horizontal overflow, no console errors, Cafecito link opens new tab. Fixed: stat values wrapping on mobile (nowrap + clamp).
- S4 done: `server.mjs` + `package.json` (npm start/test/scrape) for Railway; README rewritten.
