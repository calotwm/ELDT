# ELMANAGER

A sporting-director game built around Argentine football. Pick a Liga Profesional club and run it for five seasons: each pre-season you complete five tasks (club decision, sell, loan, sign, formation), then simulate the whole season in one click and see how you did in the Apertura, the Clausura, the Tabla Anual, the Copa Argentina and, if you qualified, the Copa Libertadores or Sudamericana.

Static HTML/CSS/vanilla JS, no framework, no build step, no dependencies. The UI takes its visual mood from mid-2010s football games (tile menus, lime highlight, condensed type) with its own identity and no third-party assets.

## Run locally

```
npm start
```

Then open http://localhost:3000. `server.mjs` is a zero-dependency static server for `public/` and reads the `PORT` environment variable.

## Deploy on Railway

Create a service from this repository. Railway detects `package.json` and runs `npm start`; no configuration is needed. Saved games live in each player's browser (localStorage), so the server is stateless.

## How the game works

- Five seasons, 2027 to 2031. Squads carry over: players age and develop, loans return, veterans retire and academy players are added.
- League format as in 2026: two zones of 15, 16 fechas, top 8 per zone to single-match playoffs, Tabla Anual (the leader is "Campeón de Liga") and promedios over the last three seasons.
- Relegation: worst promedio and last of the Tabla Anual (if it is the same club, the second-to-last of the annual table). Two Primera Nacional clubs are promoted. If your club is relegated, the career ends.
- Copa Libertadores next season: Apertura champion, Clausura champion, Copa Argentina champion, then the best of the Tabla Anual up to six; the last one entering by the table plays Fase 2. Copa Sudamericana: the next six of the Tabla Anual.
- Copa Argentina: 64 clubs (30 Liga Profesional + 34 from the ascenso), single match, neutral venue.
- Transfer market: the other Liga Profesional clubs, the top five players of every club in Brasil, Uruguay, Paraguay, Colombia and Chile, and Argentines playing in Europe, MLS and Liga MX.
- Difficulty: Fácil, Normal or Difícil, chosen with the club.

## Tests

```
npm test
```

Plays full five-season careers headlessly and checks tables, relegation and promotion, cup qualification carried into the next season, unique squads and save/load.

## Refreshing the data

```
npm run scrape
```

`scripts/scrape.mjs` (Node 18+) reads promiedos.com.ar and writes `public/data/clubs.js` plus crests and flags: Liga Profesional squads, zones and promedios, 2026 Libertadores, Sudamericana and Copa Argentina participants, Primera Nacional clubs for promotion, and the foreign transfer pool.

Not published by promiedos, therefore game parameters of this project: player ratings and market values (own formula), club strengths for teams without squad data, prize money, and players generated for the academy in later seasons.

## Credits

- Data source: [promiedos.com.ar](https://www.promiedos.com.ar).
- Inspired by the mechanics of [Sporting Director Simulator](https://clearlakesimulator.netlify.app), reimplemented independently with its own code, UI and data pipeline.
