# Director Deportivo AR

## Objective
Mobile-first "sporting director" game for the Argentine Liga Profesional, inspired by the mechanics of clearlakesimulator.netlify.app (pick club, budget, 5 transfer-window tasks, simulate season). Own implementation, improved UI, FIFA 14 menu color palette.

## Problem / Why
Original game covers 6 Premier League clubs. User wants the same experience with Argentine football data.

## Scope
- Scraper (Node, no deps) over promiedos.com.ar `__NEXT_DATA__`: 30 Liga Profesional clubs, squads, coach, colors, crests, flags, season stats.
- Market value computed by own formula (Promiedos has no market values).
- Static game (HTML/CSS/vanilla JS), mobile-first, FIFA 14 palette (dark charcoal tiles, lime-green highlight).
- Tasks: pre-season, sell, loan, sign (pool = other 29 clubs), formation; simulate season.

## Constraints
- Do not copy original app.js/css; reimplement.
- Artifacts in English code; UI copy in Spanish (target audience Argentine).
- Currency: USD millions.

## Tasks
- [x] T1 Scraper + value formula -> `public/data/clubs.js`, crests, flags. Route: inline (single file, understood).
- [x] T2 Game UI + logic (index.html, css, js). Route: delegated writer (2+ non-trivial files).
- [x] T3 Smoke check in browser at mobile width, fix issues.
- [x] T4 Scraper: international market (Brasileirão top 5/club, Uruguay top 4/club, Argentines >=28 in top-5 Europe + Portugal, >=26 in MLS/Liga MX) -> LEAGUE_DATA.foreignClubs. Route: inline.
- [x] T5 Rename game to "EL DT"; integrate foreignClubs into signing market (region filter, league label); README. Route: delegated writer.
- [x] T6 Push to GitHub calotwm/ELDT (user-authorized destination and operation).

## Acceptance criteria
- 30 clubs selectable; each squad matches Promiedos.
- All 5 tasks playable on 375px wide screen; season simulation produces table position + summary.

## TDD
Mode: off (no project config, user did not request). Checks: run scraper, node syntax check, browser smoke test.

## Delivery
Strategy: ask-on-risk. Branch `feat/game`.

## Progress
- Repo initialized, branch `feat/game`.
- Engram mirror: PENDING (engram reported ambiguous_project; neither listed project matches this repo).
- T2: delegated writer built public/index.html, css/styles.css, js/{formations,logic,state,ui-common,screens,tasks,main}.js. node --check OK; headless logic test ALL ASSERTIONS PASSED.
- T3: CDP smoke at 390x844 mobile: full flow (Boca: pre-season, sell, loan, sign, formation, simulate) reached 5/5 and results; no horizontal overflow; no console errors. Fixed: raw country codes in player rows, league table cut off (now DG/Pts fits), English filter chips (now Spanish labels), choice cards as <button>.
- Review (reliability lens) approved + acknowledged for da1306e. Fixed its 2 warnings: simulate now requires complete XI; undoing sales/loans checks budget and squad cap. Regression script passed.
- Open suggestion: no committed automated tests (tests live in session scratchpad).
- T5: renamed to EL DT; foreign market (1090 players in pool) with region filter, Vuelve badge, 60-row cap; README. Checks: node --check OK, headless + regress + foreign signing tests passed, CDP smoke 5/5 at 390px, no errors.
- T6: pushed main (9fdbe87) to https://github.com/calotwm/ELDT.
