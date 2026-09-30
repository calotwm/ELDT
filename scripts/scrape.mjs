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
  'Segundo Delantero': 'ST',
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
const CLUB_TIER = {
  'boca-juniors': 1, 'river-plate': 1,
  'racing-club': 2, 'independiente': 2, 'san-lorenzo': 2, 'estudiantes-de-la-plata': 2,
  'velez-sarsfield': 2, 'talleres-cordoba': 2, 'rosario-central': 2, 'lanus': 2,
  'argentinos-juniors': 2, 'huracan': 2,
};
const TIER_BASE_RATING = { 1: 73, 2: 69, 3: 65 };
const POSITION_VALUE = {
  GK: 0.65, CB: 0.85, LB: 0.8, RB: 0.8, LWB: 0.8, RWB: 0.8,
  CDM: 0.95, CM: 1, CAM: 1.1, LM: 1, RM: 1, LW: 1.1, RW: 1.1, ST: 1.2,
};

// Deterministic pseudo-random in [0, 1) from a string, so reruns are stable.
function hash01(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function ageRatingDelta(age) {
  if (age <= 19) return -6;
  if (age <= 21) return -3;
  if (age <= 29) return 0;
  if (age <= 32) return -1;
  return -3;
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

function computeRating({ name, age, number, stats }, baseRating) {
  const noise = Math.round((hash01(name) - 0.5) * 10); // -5..+5
  const production = Math.min(8, stats.goals * 0.6 + stats.assists * 0.5 + stats.tackles * 0.1);
  const squadRole = number ? 0 : -4; // no shirt number: usually reserve/academy
  const rating = baseRating + noise + production + squadRole + ageRatingDelta(age);
  return Math.max(50, Math.min(88, Math.round(rating)));
}

function computeValue(rating, age, pos) {
  // Exponential over rating: 60 -> ~0.8M, 70 -> ~3M, 80 -> ~11M (before modifiers).
  const base = 0.8 * Math.exp((rating - 60) * 0.13);
  const value = base * ageValueFactor(age) * POSITION_VALUE[pos];
  return Math.max(0.2, Math.round(value * 10) / 10);
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

function parseTeam(team, pageData, opts = {}) {
  const tier = opts.tier ?? CLUB_TIER[team.url_name] ?? 3;
  const baseRating = opts.baseRating ?? TIER_BASE_RATING[tier];
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
      const rating = computeRating({ name: p.name, age, number, stats }, baseRating);
      players.push({
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
      });
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
// the best of Brazil and Uruguay, plus Argentine veterans abroad who may return.
const ARGENTINE = 'ba';
const topRated = (count) => (players) => [...players].sort((a, b) => b.rating - a.rating).slice(0, count);
const argentinesAged = (minAge) => (players) => players.filter((p) => p.nat === ARGENTINE && p.age >= minAge);

const FOREIGN_SOURCES = [
  { key: 'brasil', label: 'Brasileirão', region: 'Brasil', path: '/league/brasileirao-serie-a/bbd', baseRating: 71, tier: 1, pick: topRated(5) },
  { key: 'uruguay', label: 'Liga Uruguaya', region: 'Uruguay', path: '/league/uruguayan-championship/gbh', baseRating: 64, tier: 3, pick: topRated(4) },
  { key: 'premier', label: 'Premier League', region: 'Europa', path: '/league/premier-league/h', baseRating: 77, tier: 1, pick: argentinesAged(28) },
  { key: 'laliga', label: 'La Liga', region: 'Europa', path: '/league/laliga/bb', baseRating: 76, tier: 1, pick: argentinesAged(28) },
  { key: 'seriea', label: 'Serie A', region: 'Europa', path: '/league/serie-a/bh', baseRating: 75, tier: 1, pick: argentinesAged(28) },
  { key: 'bundesliga', label: 'Bundesliga', region: 'Europa', path: '/league/bundesliga/cf', baseRating: 75, tier: 1, pick: argentinesAged(28) },
  { key: 'ligue1', label: 'Ligue 1', region: 'Europa', path: '/league/ligue-1/df', baseRating: 74, tier: 1, pick: argentinesAged(28) },
  { key: 'portugal', label: 'Liga Portugal', region: 'Europa', path: '/league/liga-portugal/hd', baseRating: 72, tier: 1, pick: argentinesAged(28) },
  { key: 'mls', label: 'MLS', region: 'América', path: '/league/mls/bae', baseRating: 68, tier: 2, pick: argentinesAged(26), anyCountry: true },
  { key: 'ligamx', label: 'Liga MX', region: 'América', path: '/league/liga-mx/beb', baseRating: 69, tier: 2, pick: argentinesAged(26) },
];

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
    const players = source.pick(club.players);
    if (!players.length) continue;
    players.forEach((p) => countries.add(p.nat));
    await download(`${IMG_API}/team/${team.id}/1`, join(ROOT, 'public/img/crests', `${team.id}.png`));
    clubs.push({
      id: club.id, slug: club.slug, name: club.name, shortName: club.shortName, tier: source.tier,
      colors: club.colors, league: source.label, leagueKey: source.key, region: source.region, players,
    });
  }
  const total = clubs.reduce((n, c) => n + c.players.length, 0);
  console.log(`${source.label}: ${teams.length} teams, ${total} players picked`);
  return clubs;
}

async function main() {
  const { data: league } = await fetchNextData(LEAGUE_PATH);
  const teams = extractTeams(league.props.pageProps);
  console.log(`Found ${teams.length} teams`);

  const clubs = [];
  const countries = new Set();
  for (const team of teams) {
    await sleep(DELAY_MS);
    const { data } = await fetchNextData(`/team/${team.url_name}/${team.id}`);
    const club = parseTeam(team, data.props.pageProps.data);
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

  for (const c of countries) {
    if (c) await download(`${IMG_API}/country/${c}/1`, join(ROOT, 'public/img/flags', `${c}.png`));
  }

  clubs.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const payload = { scrapedAt: new Date().toISOString(), source: SITE, clubs, foreignClubs };
  const out = join(ROOT, 'public/data/clubs.js');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `// Generated by scripts/scrape.mjs. Do not edit by hand.\nwindow.LEAGUE_DATA = ${JSON.stringify(payload)};\n`);
  if (unmappedPositions.size) console.warn('Unmapped positions:', [...unmappedPositions].join(', '));
  console.log(`Wrote ${clubs.length} clubs and ${foreignClubs.length} foreign clubs to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
