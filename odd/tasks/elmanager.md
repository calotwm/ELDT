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
- T2 in progress on `feat/elmanager-02-engine` (stacked on 01): delegated writer with engine spec (session scratchpad).
