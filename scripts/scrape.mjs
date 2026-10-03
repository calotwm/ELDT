// Scrapes Liga Profesional squads from promiedos.com.ar and writes public/data/clubs.js.
// Promiedos pages are Next.js; all data lives in the embedded __NEXT_DATA__ JSON.
// Usage: node scripts/scrape.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.promiedos.com.ar';
const IMG_API = 'https://api.promiedos.com.ar/images';
const LEAGUE_PATH = '/league/liga-profesional/hc';
const UA = 'Mozilla/5.0 (director-deportivo-ar scraper)';
const DELAY_MS = 400;
const PRIMERA_NACIONAL_PATH = '/league/primera-nacional/ebj';
const CUP_SOURCES = [
  { key: 'libertadores', name: 'Copa Libertadores', edition: 2026, path: '/league/libertadores/bac' },
  { key: 'sudamericana', name: 'Copa Sudamericana', edition: 2026, path: '/league/conmebol-sudamericana/dij' },
];
const COUNTRY_BASE_RATING = { cb: 71, baj: 65, fb: 65, bai: 64, bbb: 64, ci: 63, bbc: 62, bbd: 60, bba: 60 };
const DEFAULT_COUNTRY_BASE_RATING = 62;
const COPA_ARGENTINA = { name: 'Copa Argentina', edition: 2026, path: '/league/copa-argentina/gea', stage: '32avos de final' };
const LOWER_DIVISION_BASE_RATING = 57;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchNextData(path) {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error(`${path}: __NEXT_DATA__ not found`);
  return { data: JSON.parse(match[1]), html };
}

async function download(url, file) {
  try {
    await access(file);
    return;
  } catch {}
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

// ─── Position mapping ────────────────────────────────────────────────────────
const POSITION_MAP = {
  'Arquero': 'GK',
  'Defensa Central': 'CB',
  'Defensa Lateral Izquierdo': 'LB',
  'Defensa Lateral Derecho': 'RB',
  'Carrilero Izquierdo': 'LWB',
  'Carrilero Derecho': 'RWB',
  'Centrocampista defensivo': 'CDM',
  'Mediocampista Central': 'CM',
  'Mediocampista Ofensivo': 'CAM',
  'Mediocampista Izquierdo': 'LM',
  'Mediocampista Derecho': 'RM',
  'Volante Izquierdo': 'LM',
  'Volante Derecho': 'RM',
  'Extremo Izquierdo': 'LW',
  'Extremo Derecho': 'RW',
  'Delantero Izquierdo': 'LW',
  'Delantero Derecho': 'RW',
  'Centro Delantero': 'ST',
  'Segundo Delantero': 'CF',
};
const GROUP_FALLBACK = { Arqueros: 'GK', Defensores: 'CB', Mediocampistas: 'CM', Delanteros: 'ST' };
const unmappedPositions = new Set();

function mapPosition(player, groupName) {
  const pos = POSITION_MAP[player.formation_position];
  if (pos) return pos;
  unmappedPositions.add(`${player.formation_position} (${groupName})`);
  return GROUP_FALLBACK[groupName] ?? 'CM';
}

// ─── Rating & value formula ──────────────────────────────────────────────────
// Promiedos has no market values, so we derive a 0-99 rating and a USD value.
// The five "grandes" of Argentine football; everyone else is a mid-size or small club.
const CLUB_TIER = {
  'boca-juniors': 1, 'river-plate': 1, 'racing-club': 1, 'independiente': 1, 'san-lorenzo': 1,
  'estudiantes-de-la-plata': 2, 'velez-sarsfield': 2, 'talleres-cordoba': 2, 'rosario-central': 2,
  'lanus': 2, 'argentinos-juniors': 2, 'huracan': 2, "newell's-old-boys": 2,
};
const TIER_BASE_RATING = { 1: 71.5, 2: 68.5, 3: 66 };
// Recent form from the real promedios table (points per game over three seasons) moves a
// club's base rating around its tier: +/- FORM_MAX_SHIFT points, centered on FORM_PIVOT ppg.
const FORM_PIVOT = 1.35;
const FORM_SCALE = 4;
const FORM_MAX_SHIFT = 2.5;

function formShift(promedio) {
  if (!promedio?.played) return 0;
  const shift = (promedio.points / promedio.played - FORM_PIVOT) * FORM_SCALE;
  return Math.max(-FORM_MAX_SHIFT, Math.min(FORM_MAX_SHIFT, shift));
}
const POSITION_VALUE = {
  GK: 0.65, CB: 0.85, LB: 0.8, RB: 0.8, LWB: 0.8, RWB: 0.8,
  CDM: 0.95, CM: 1, CAM: 1.1, LM: 1, RM: 1, LW: 1.1, RW: 1.1, CF: 1.15, ST: 1.2,
};

// Deterministic pseudo-random in [0, 1) from a string, so reruns are stable.
function hash01(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function ageRatingDelta(age) {
  if (age <= 18) return -8;
  if (age <= 19) return -6;
  if (age <= 21) return -3;
  if (age <= 23) return -1;
  if (age <= 29) return 0;
  if (age <= 32) return -1;
  if (age <= 34) return -3;
  return -5;
}

function ageValueFactor(age) {
  if (age <= 19) return 1.1;
  if (age <= 21) return 1.25;
  if (age <= 25) return 1.15;
  if (age <= 27) return 1;
  if (age <= 29) return 0.75;
  if (age <= 31) return 0.5;
  if (age <= 33) return 0.3;
  return 0.15;
}

function squadRoleDelta(number) {
  if (!number) return -5; // no shirt number: usually reserve/academy
  if (number >= 30) return -3; // high numbers: fringe or academy call-ups
  return 0;
}

function computeRating({ name, age, number, stats }, baseRating) {
  // Triangular noise in -5..+5: most players sit near their club level, few stand out.
  const noise = (hash01(name) + hash01(`${name}#`) - 1) * 5;
  const production = Math.min(5, stats.goals * 0.5 + stats.assists * 0.4 + stats.tackles * 0.08);
  const rating = baseRating + noise + production + squadRoleDelta(number) + ageRatingDelta(age);
  return Math.max(45, Math.min(86, Math.round(rating)));
}

function computeValue(rating, age, pos) {
  // Exponential over rating: 60 -> ~0.8M, 70 -> ~3M, 80 -> ~11M (before modifiers).
  const base = 0.8 * Math.exp((rating - 60) * 0.13);
  const value = base * ageValueFactor(age) * POSITION_VALUE[pos];
  return Math.max(0.2, Math.round(value * 10) / 10);
}

// ─── Fame bonus ──────────────────────────────────────────────────────────────
// The formula punishes age hard, which undervalues well-known names. Famous players
// get a flat value bonus and a small rating bump. Names must match Promiedos exactly.
const FAME = {
  3: ['Lionel Messi', 'Ángel Di María', 'Paulo Dybala', 'Lautaro Martínez', 'Rodrigo De Paul',
    'Nicolás Otamendi', 'Leandro Paredes'],
  2: ['Cristian Romero', 'Emilliano Buendía', 'Giovani Lo Celso', 'Nahuel Molina', 'Gonzalo Montiel',
    'Marcos Acuña', 'Nicolás Tagliafico', 'Gerónimo Rulli', 'Juan Foyth', 'Giovanni Simeone',
    'Lucas Ocampos', 'Juan Musso', 'Lucas Martínez Quarta', 'Thiago Almada', 'Angel Correa',
    'Sebastián Driussi', 'Enner Valencia', 'Miguel Merentiel', 'Jorge Carrascal', 'Pedro', 'José Paradela',
    'Giorgian de Arrascaeta'],
};
const FAME_BONUS = { 3: { value: 6, rating: 3 }, 2: { value: 3, rating: 2 } };
const FAME_BY_NAME = new Map(Object.entries(FAME).flatMap(([level, names]) => names.map((n) => [n, Number(level)])));
const fameMatches = new Set();

// Game-design overrides (user request): Messi is the hardest signing in the game.
const PLAYER_OVERRIDE = {
  'Lionel Messi': { rating: 85, value: 30 },
  'Giorgian de Arrascaeta': { rating: 82, value: 12 },
};

// Game-design rating anchors for well-known players, whose real level a league-wide formula
// cannot capture (an Argentina starter is not an average Premier League player).
// Estimates on a FIFA-like scale, not data from Promiedos. Names must match Promiedos exactly.
const RATING_ANCHOR = {
  'Emiliano Martínez': 85, 'Gerónimo Rulli': 80, 'Juan Musso': 77, 'Walter Benítez': 77,
  'Cristian Romero': 84, 'Lisandro Martínez': 82, 'Nicolás Otamendi': 76, 'Leonardo Balerdi': 78,
  'Facundo Medina': 78, 'Germán Pezzella': 75, 'Nahuel Molina': 79, 'Gonzalo Montiel': 76,
  'Nicolás Tagliafico': 76, 'Marcos Acuña': 75, 'Juan Foyth': 77, 'Lucas Martínez Quarta': 76,
  'Enzo Fernández': 85, 'Alexis Mac Allister': 86, 'Rodrigo De Paul': 81, 'Leandro Paredes': 79,
  'Giovani Lo Celso': 79, 'Exequiel Palacios': 80, 'Thiago Almada': 79, 'Nico Paz': 81,
  'Franco Mastantuono': 78, 'Valentín Barco': 74, 'Claudio Echeverri': 73, 'Valentín Carboni': 73,
  'Lautaro Martínez': 88, 'Julián Álvarez': 87, 'Paulo Dybala': 80, 'Ángel Di María': 78,
  'Alejandro Garnacho': 80, 'Nicolás González': 79, 'Giuliano Simeone': 79, 'Matías Soulé': 79,
  'Valentín Castellanos': 77, 'Santiago Castro': 75, 'Lucas Beltrán': 74, 'Angel Correa': 77,
  'Giovanni Simeone': 75, 'Lucas Ocampos': 76,
};

function applyFame(player) {
  const famous = applyFameBonus(player);
  const override = PLAYER_OVERRIDE[player.name];
  return override ? { ...famous, ...override } : famous;
}

function applyFameBonus(player) {
  const fame = FAME_BY_NAME.get(player.name);
  if (!fame) return player;
  fameMatches.add(player.name);
  const bonus = FAME_BONUS[fame];
  // Anchored ratings already reflect fame; only the market value bonus still applies.
  const rating = RATING_ANCHOR[player.name] ? player.rating : Math.min(88, player.rating + bonus.rating);
  const value = Math.round((player.value + bonus.value) * 10) / 10;
  return { ...player, fame, rating, value };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────
function parseStats(stats) {
  const byName = new Map();
  const filter = stats?.filters?.find((f) => f.selected) ?? stats?.filters?.[0];
  const KEYS = { Goles: 'goals', Asistencias: 'assists', 'Barridas ganadas': 'tackles' };
  for (const table of filter?.tables ?? []) {
    const key = KEYS[table.name];
    if (!key) continue;
    for (const row of table.rows ?? []) {
      const name = row.entity?.object?.name;
      if (!name) continue;
      const entry = byName.get(name) ?? { goals: 0, assists: 0, tackles: 0 };
      entry[key] = Number(row.values?.[0]?.value) || 0;
      byName.set(name, entry);
    }
  }
  return byName;
}

const anchorMatches = new Set();

function parseTeam(team, pageData, opts = {}) {
  const tier = opts.tier ?? CLUB_TIER[team.url_name] ?? 3;
  const baseRating = opts.baseRating ?? TIER_BASE_RATING[tier] + formShift(opts.promedio);
  const statsByName = parseStats(pageData.stats);
  const info = Object.fromEntries((pageData.team_info ?? []).map((i) => [i.name, i.value]));
  let coach = null;
  const players = [];

  for (const group of pageData.squad?.groups ?? []) {
    for (const row of group.rows ?? []) {
      const p = row.entity?.object;
      if (!p) continue;
      if (p.is_staff) {
        if (!coach && p.formation_position === 'Entrenador') coach = p.name;
        continue;
      }
      const age = Number(p.age) || 25;
      const number = p.num ? Number(p.num) : null;
      const stats = statsByName.get(p.name) ?? { goals: 0, assists: 0, tackles: 0 };
      const pos = mapPosition(p, group.name);
      const anchor = p.country_id === ARGENTINE ? RATING_ANCHOR[p.name] : undefined; // skip foreign namesakes
      if (anchor) anchorMatches.add(p.name);
      const rating = anchor ?? computeRating({ name: p.name, age, number, stats }, baseRating);
      players.push(applyFame({
        id: `${team.id}-${players.length + 1}`,
        name: p.name,
        shortName: p.sname || p.name,
        pos,
        nat: p.country_id,
        age,
        number,
        rating,
        value: computeValue(rating, age, pos),
        goals: stats.goals,
        assists: stats.assists,
      }));
    }
  }

  return {
    id: team.id,
    slug: team.url_name,
    name: team.name,
    shortName: team.short_name,
    tier,
    colors: { primary: team.colors?.color ?? '#444444', text: team.colors?.text_color ?? '#FFFFFF' },
    coach,
    nickname: info['Apodo'] ?? null,
    stadium: pageData.stadium?.name ?? info['Estadio'] ?? null,
    founded: info['Fundación'] ?? null,
    players,
  };
}

function extractTeams(leagueData, { anyCountry = false } = {}) {
  // Teams appear in several places (tables, fixtures). Keep the league's own clubs:
  // the majority country, unless the league spans countries (e.g. MLS).
  const teams = new Map();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'string' && node.url_name && node.country_id && node.colors && node.name) {
      const isSecondary = node.url_name.endsWith('-reserves') || node.url_name.includes('(w)');
      if (!isSecondary && !teams.has(node.id)) teams.set(node.id, node);
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(leagueData);
  const all = [...teams.values()];
  if (anyCountry) return all;
  const counts = {};
  for (const t of all) counts[t.country_id] = (counts[t.country_id] ?? 0) + 1;
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return all.filter((t) => t.country_id === main);
}

// ─── International market ────────────────────────────────────────────────────
// Players from other leagues who could realistically join an Argentine club:
// the best of each South American league, plus Argentine and South American veterans abroad who may return.
const ARGENTINE = 'ba';
const topRated = (count) => (players) => [...players].sort((a, b) => b.rating - a.rating).slice(0, count);

// Argentines and other South Americans (any CONMEBOL country) abroad, old enough to consider
// coming back to the region.
const CONMEBOL = new Set(['cb', 'bbb', 'bai', 'baj', 'ci', 'bbc', 'bbd', 'bba', 'fb']);
const returningSouthAmericans = (argentineMinAge, otherMinAge) => (players) => players.filter((p) =>
  p.age >= (p.nat === ARGENTINE ? argentineMinAge : CONMEBOL.has(p.nat) ? otherMinAge : Infinity));

// Base ratings are for a squad's average player; known stars get RATING_ANCHOR values instead.
const FOREIGN_SOURCES = [
  { key: 'brasil', label: 'Brasileirão', region: 'Brasil', path: '/league/brasileirao-serie-a/bbd', baseRating: 70, tier: 1, pick: topRated(5) },
  { key: 'uruguay', label: 'Liga Uruguaya', region: 'Uruguay', path: '/league/uruguayan-championship/gbh', baseRating: 64, tier: 3, pick: topRated(5) },
  { key: 'paraguay', label: 'Liga Paraguaya', region: 'Paraguay', path: '/league/copa-de-primera/gcb', baseRating: 63, tier: 3, pick: topRated(5) },
  { key: 'colombia', label: 'Liga BetPlay', region: 'Colombia', path: '/league/liga-betplay/gca', baseRating: 65, tier: 2, pick: topRated(5) },
  { key: 'chile', label: 'Liga Chilena', region: 'Chile', path: '/league/campeonato-nacional/bdf', baseRating: 63, tier: 3, pick: topRated(5) },
  { key: 'premier', label: 'Premier League', region: 'Europa', path: '/league/premier-league/h', baseRating: 74, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'laliga', label: 'La Liga', region: 'Europa', path: '/league/laliga/bb', baseRating: 73, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'seriea', label: 'Serie A', region: 'Europa', path: '/league/serie-a/bh', baseRating: 72.5, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'bundesliga', label: 'Bundesliga', region: 'Europa', path: '/league/bundesliga/cf', baseRating: 72.5, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'ligue1', label: 'Ligue 1', region: 'Europa', path: '/league/ligue-1/df', baseRating: 71.5, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'portugal', label: 'Liga Portugal', region: 'Europa', path: '/league/liga-portugal/hd', baseRating: 70, tier: 1, pick: returningSouthAmericans(28, 29) },
  { key: 'mls', label: 'MLS', region: 'América', path: '/league/mls/bae', baseRating: 67, tier: 2, pick: returningSouthAmericans(26, 28), anyCountry: true },
  { key: 'ligamx', label: 'Liga MX', region: 'América', path: '/league/liga-mx/beb', baseRating: 68, tier: 2, pick: returningSouthAmericans(26, 28) },
];

// Players always added to the foreign market even if the league's pick rule leaves them out (user requests).
const MUST_PICK = new Set(['Giorgian de Arrascaeta']);

// Younger Argentines in Europe (not picked by the age filter): the best EUROPE_EXTRA_COUNT join the market.
const EUROPE_EXTRA_COUNT = 15;
const europeExtras = [];

function foreignClubEntry(club, source, players) {
  return {
    id: club.id, slug: club.slug, name: club.name, shortName: club.shortName, tier: source.tier,
    colors: club.colors, league: source.label, leagueKey: source.key, region: source.region, players,
  };
}

function collectEuropeExtras(club, source, picked) {
  const pickedIds = new Set(picked.map((p) => p.id));
  for (const p of club.players) {
    if (p.nat === ARGENTINE && !pickedIds.has(p.id)) europeExtras.push({ player: p, club, source });
  }
}

async function addEuropeExtras(foreignClubs, countries) {
  const best = europeExtras.sort((a, b) => b.player.rating - a.player.rating).slice(0, EUROPE_EXTRA_COUNT);
  for (const { player, club, source } of best) {
    let entry = foreignClubs.find((c) => c.id === club.id);
    if (!entry) {
      entry = foreignClubEntry(club, source, []);
      foreignClubs.push(entry);
      await download(`${IMG_API}/team/${club.id}/1`, join(ROOT, 'public/img/crests', `${club.id}.png`));
    }
    entry.players.push(player);
    countries.add(player.nat);
  }
  console.log(`Europe extras: ${best.map((e) => `${e.player.name} (${e.player.rating})`).join(', ')}`);
}

async function scrapeForeignSource(source, countries) {
  const { data: league } = await fetchNextData(source.path);
  const teams = extractTeams(league.props.pageProps, { anyCountry: source.anyCountry });
  const clubs = [];
  for (const team of teams) {
    await sleep(DELAY_MS);
    let data;
    try {
      ({ data } = await fetchNextData(`/team/${team.url_name}/${team.id}`));
    } catch (err) {
      console.warn(`  skip ${team.name}: ${err.message}`);
      continue;
    }
    const club = parseTeam(team, data.props.pageProps.data, source);
    const picked = source.pick(club.players);
    const players = picked.concat(club.players.filter((p) => MUST_PICK.has(p.name) && !picked.includes(p)));
    if (source.region === 'Europa') collectEuropeExtras(club, source, players);
    if (!players.length) continue;
    players.forEach((p) => countries.add(p.nat));
    await download(`${IMG_API}/team/${team.id}/1`, join(ROOT, 'public/img/crests', `${team.id}.png`));
    clubs.push(foreignClubEntry(club, source, players));
  }
  const total = clubs.reduce((n, c) => n + c.players.length, 0);
  console.log(`${source.label}: ${teams.length} teams, ${total} players picked`);
  return clubs;
}

// ─── League tables, cups, promotion ──────────────────────────────────────────
const isSecondaryTeam = (t) => t.url_name.endsWith('-reserves') || t.url_name.includes('(w)');
const tablesOf = (group) => (group?.tables ?? []).map((t) => ({ name: t.name?.trim(), rows: t.table?.rows ?? t.rows ?? [] }));
const findGroup = (pageData, part) => (pageData.tables_groups ?? []).find((g) => g.name?.includes(part));
const rowValue = (row, key) => Number(row.values?.find((v) => v.key === key)?.value);

function parseLeagueInfo(pageData, clubIds) {
  const zones = { A: [], B: [] };
  for (const table of tablesOf(findGroup(pageData, 'Apertura'))) {
    const zone = table.name?.match(/Zona ([AB])/)?.[1];
    if (!zone) continue;
    zones[zone] = table.rows.map((r) => r.entity?.object?.id).filter((id) => clubIds.has(id));
  }
  const promedios = {};
  // The group name is empty on the live page; the label lives on the table itself.
  const promediosTables = (pageData.tables_groups ?? []).flatMap(tablesOf).filter((t) => t.name?.includes('Promedios'));
  for (const table of promediosTables) {
    for (const row of table.rows) {
      const id = row.entity?.object?.id;
      if (!clubIds.has(id)) continue;
      promedios[id] = { points: rowValue(row, 'Points') || 0, played: rowValue(row, 'GamePlayed') || 0 };
    }
  }
  return { name: 'Liga Profesional', zones, promedios };
}

// Caches raw team page data by id, so a team needed by several sections is fetched once
// but can still be parsed with each section's own rating options.
const teamPageCache = new Map();
async function fetchTeamCached(team, opts) {
  if (!teamPageCache.has(team.id)) {
    await sleep(DELAY_MS);
    const { data } = await fetchNextData(`/team/${team.url_name}/${team.id}`);
    teamPageCache.set(team.id, data.props.pageProps.data);
  }
  return parseTeam(team, teamPageCache.get(team.id), opts);
}

function bestElevenStrength(players) {
  const top = [...players].sort((a, b) => b.rating - a.rating).slice(0, 11);
  if (!top.length) return null;
  return Math.round((top.reduce((n, p) => n + p.rating, 0) / top.length) * 10) / 10;
}

async function scrapeCup(source, countries, clubIds) {
  const { data } = await fetchNextData(source.path);
  const group = findGroup(data.props.pageProps.data, 'Fase de grupos') ?? data.props.pageProps.data.tables_groups?.[0];
  const seen = new Map();
  const argentineTeams = [];
  for (const table of tablesOf(group)) {
    for (const row of table.rows) {
      const t = row.entity?.object;
      if (!t) continue;
      if (t.country_id === ARGENTINE) {
        if (clubIds.has(t.id) && !argentineTeams.includes(t.id)) argentineTeams.push(t.id);
      } else if (!seen.has(t.id)) seen.set(t.id, t);
    }
  }
  const teams = [];
  for (const t of seen.values()) {
    const baseRating = COUNTRY_BASE_RATING[t.country_id] ?? DEFAULT_COUNTRY_BASE_RATING;
    let strength = baseRating;
    try {
      const club = await fetchTeamCached(t, { tier: 2, baseRating });
      strength = bestElevenStrength(club.players) ?? baseRating;
    } catch (err) {
      console.warn(`  cup team ${t.name}: ${err.message}; using base rating ${baseRating}`);
    }
    countries.add(t.country_id);
    await download(`${IMG_API}/team/${t.id}/1`, join(ROOT, 'public/img/crests', `${t.id}.png`));
    teams.push({
      id: t.id, slug: t.url_name, name: t.name, shortName: t.short_name, country: t.country_id,
      colors: { primary: t.colors?.color ?? '#444444', text: t.colors?.text_color ?? '#FFFFFF' }, strength,
    });
  }
  console.log(`${source.name}: ${teams.length} foreign teams, ${argentineTeams.length} Argentine`);
  return { name: source.name, edition: source.edition, teams, argentineTeams };
}

async function scrapeCopaArgentina(clubIds, promotionPool) {
  const { data } = await fetchNextData(COPA_ARGENTINA.path);
  const stage = data.props.pageProps.data.brackets?.stages?.find((st) => st.name === COPA_ARGENTINA.stage);
  if (!stage) throw new Error(`stage "${COPA_ARGENTINA.stage}" not found`);
  const poolById = new Map(promotionPool.map((c) => [c.id, c]));
  const primeraIds = [];
  const others = new Map();
  for (const group of stage.groups ?? []) {
    // Games carry the full team objects (url_name, colors); bracket participants may not.
    const detailed = new Map((group.games ?? []).flatMap((g) => g.teams ?? []).map((t) => [t.id, t]));
    for (const p of group.participants ?? []) {
      if (clubIds.has(p.id)) {
        if (!primeraIds.includes(p.id)) primeraIds.push(p.id);
      } else if (!others.has(p.id)) {
        others.set(p.id, { ...p, ...detailed.get(p.id) });
      }
    }
  }
  const teams = [];
  let fallbacks = 0;
  for (const t of others.values()) {
    const pooled = poolById.get(t.id);
    let strength = LOWER_DIVISION_BASE_RATING;
    if (pooled) {
      strength = bestElevenStrength(pooled.players) ?? LOWER_DIVISION_BASE_RATING;
    } else if (t.url_name) {
      try {
        const club = await fetchTeamCached(t, { tier: 3, baseRating: LOWER_DIVISION_BASE_RATING });
        strength = bestElevenStrength(club.players) ?? LOWER_DIVISION_BASE_RATING;
      } catch (err) {
        console.warn(`  copa team ${t.name}: ${err.message}; using base rating ${strength}`);
        fallbacks++;
      }
    } else {
      console.warn(`  copa team ${t.name}: no url_name; using base rating ${strength}`);
      fallbacks++;
    }
    await download(`${IMG_API}/team/${t.id}/1`, join(ROOT, 'public/img/crests', `${t.id}.png`));
    teams.push({
      id: t.id, slug: t.url_name ?? null, name: t.name, shortName: t.short_name,
      colors: { primary: t.colors?.color ?? '#555555', text: t.colors?.text_color ?? '#FFFFFF' },
      strength, inPromotionPool: Boolean(pooled),
    });
  }
  console.log(`${COPA_ARGENTINA.name}: ${primeraIds.length} Primera, ${teams.length} other teams, ${fallbacks} strength fallbacks`);
  return { name: COPA_ARGENTINA.name, edition: COPA_ARGENTINA.edition, primeraIds, teams };
}

async function scrapePromotionPool(size = 10) {
  const { data } = await fetchNextData(PRIMERA_NACIONAL_PATH);
  const pageData = data.props.pageProps.data;
  const columns = tablesOf(pageData.tables_groups?.[0]).map((t) =>
    t.rows.map((r) => r.entity?.object).filter((t2) => t2 && !isSecondaryTeam(t2)));
  const ordered = [];
  const seen = new Set();
  for (let i = 0; i < Math.max(0, ...columns.map((c) => c.length)); i++) {
    for (const col of columns) {
      const t = col[i];
      if (t && !seen.has(t.id)) { seen.add(t.id); ordered.push(t); }
    }
  }
  const pool = [];
  for (const t of ordered) {
    if (pool.length >= size) break;
    try {
      const club = await fetchTeamCached(t, { tier: 3, baseRating: 61 });
      if (club.players.length < 15) {
        console.warn(`skip promotion candidate ${club.name}: only ${club.players.length} players`);
        continue;
      }
      await download(`${IMG_API}/team/${t.id}/1`, join(ROOT, 'public/img/crests', `${t.id}.png`));
      pool.push(club);
      console.log(`Promotion pool: ${club.name}, ${club.players.length} players`);
    } catch (err) {
      console.warn(`skip promotion candidate ${t.name}: ${err.message}`);
    }
  }
  return pool;
}

async function main() {
  const { data: league } = await fetchNextData(LEAGUE_PATH);
  const teams = extractTeams(league.props.pageProps);
  console.log(`Found ${teams.length} teams`);
  const { promedios } = parseLeagueInfo(league.props.pageProps.data, new Set(teams.map((t) => t.id)));

  const clubs = [];
  const countries = new Set();
  for (const team of teams) {
    await sleep(DELAY_MS);
    const { data } = await fetchNextData(`/team/${team.url_name}/${team.id}`);
    const club = parseTeam(team, data.props.pageProps.data, { promedio: promedios[team.id] });
    if (club.players.length < 15) {
      console.warn(`skip ${club.name}: only ${club.players.length} players`);
      continue;
    }
    clubs.push(club);
    club.players.forEach((p) => countries.add(p.nat));
    await download(`${IMG_API}/team/${team.id}/1`, join(ROOT, 'public/img/crests', `${team.id}.png`));
    console.log(`${club.name}: ${club.players.length} players, coach ${club.coach}`);
  }

  const foreignClubs = [];
  for (const source of FOREIGN_SOURCES) {
    try {
      foreignClubs.push(...(await scrapeForeignSource(source, countries)));
    } catch (err) {
      console.warn(`skip league ${source.label}: ${err.message}`);
    }
  }
  await addEuropeExtras(foreignClubs, countries);

  const clubIds = new Set(clubs.map((c) => c.id));
  const leagueInfo = parseLeagueInfo(league.props.pageProps.data, clubIds);
  console.log(`League: zones A=${leagueInfo.zones.A.length} B=${leagueInfo.zones.B.length}, promedios=${Object.keys(leagueInfo.promedios).length}`);

  const cups = {};
  for (const source of CUP_SOURCES) {
    try {
      cups[source.key] = await scrapeCup(source, countries, clubIds);
    } catch (err) {
      console.warn(`skip cup ${source.name}: ${err.message}`);
    }
  }

  let promotionPool = [];
  try {
    promotionPool = await scrapePromotionPool();
  } catch (err) {
    console.warn(`skip promotion pool: ${err.message}`);
  }
  try {
    cups.copaArgentina = await scrapeCopaArgentina(clubIds, promotionPool);
  } catch (err) {
    console.warn(`skip cup ${COPA_ARGENTINA.name}: ${err.message}`);
  }

  promotionPool.forEach((c) => c.players.forEach((p) => countries.add(p.nat)));

  for (const c of countries) {
    if (c) await download(`${IMG_API}/country/${c}/1`, join(ROOT, 'public/img/flags', `${c}.png`));
  }

  clubs.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const payload = { scrapedAt: new Date().toISOString(), source: SITE, league: leagueInfo, cups, clubs, foreignClubs, promotionPool };
  const out = join(ROOT, 'public/data/clubs.js');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `// Generated by scripts/scrape.mjs. Do not edit by hand.\nwindow.LEAGUE_DATA = ${JSON.stringify(payload)};\n`);
  const missingFame = [...FAME_BY_NAME.keys()].filter((n) => !fameMatches.has(n));
  if (missingFame.length) console.warn('Famous players not found:', missingFame.join(', '));
  const missingAnchors = Object.keys(RATING_ANCHOR).filter((n) => !anchorMatches.has(n));
  if (missingAnchors.length) console.warn('Anchored players not found:', missingAnchors.join(', '));
  if (unmappedPositions.size) console.warn('Unmapped positions:', [...unmappedPositions].join(', '));
  console.log(`Wrote ${clubs.length} clubs and ${foreignClubs.length} foreign clubs to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
