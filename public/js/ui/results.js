// ELMANAGER results screen: hero, titles, per-competition cards and the next-season outlook.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  function team(world, id) { return EM.Cups.teamInfo(world, id); }

  function teamCell(world, id, mine) {
    const t = team(world, id);
    return h('span', { class: 'team' + (mine ? ' is-mine' : '') }, UI.crest({ id: id }), h('span', { class: 'team-name', text: t.shortName || t.name, title: t.name }));
  }

  function num(v) { return v > 0 ? '+' + v : String(v); }

  // rows: league rows sorted best first. zoneOf(id) -> 'lib' | 'sud' | 'rel' | null
  function standingsTable(world, rows, userId, zoneOf) {
    const body = h('tbody');
    rows.forEach(function (r, i) {
      const zone = zoneOf ? zoneOf(r.clubId) : null;
      body.appendChild(h('tr', { class: (r.clubId === userId ? 'is-mine ' : '') + (zone ? 'zone-' + zone : '') },
        h('th', { scope: 'row', class: 'sticky-col' }, h('span', { class: 'rank', text: String(i + 1) }), teamCell(world, r.clubId, r.clubId === userId)),
        h('td', { text: String(r.played) }),
        h('td', { class: 'c-gep', text: String(r.won) }), h('td', { class: 'c-gep', text: String(r.drawn) }), h('td', { class: 'c-gep', text: String(r.lost) }),
        h('td', { text: num(r.gf - r.ga) }), h('td', { class: 'pts', text: String(r.points) })));
    });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', null, h('tr', null,
        h('th', { class: 'sticky-col', text: 'Equipo' }), h('th', { title: 'Partidos jugados', text: 'PJ' }),
        h('th', { class: 'c-gep', title: 'Ganados', text: 'G' }), h('th', { class: 'c-gep', title: 'Empatados', text: 'E' }), h('th', { class: 'c-gep', title: 'Perdidos', text: 'P' }),
        h('th', { title: 'Diferencia de gol', text: 'DG' }), h('th', { title: 'Puntos', text: 'Pts' }))),
      body));
  }

  function card(title, i, cls) {
    const c = h('section', { class: 'panel card reveal' + (cls ? ' ' + cls : ''), style: { '--i': i } }, h('h3', { class: 'card-title', text: title }));
    Array.prototype.slice.call(arguments, 3).forEach(function (child) { if (child) c.appendChild(Array.isArray(child) ? h('div', { class: 'card-stack' }, child) : child); });
    return c;
  }

  function stageTag(stage) {
    const gold = stage === 'Campeón';
    return h('span', { class: 'stage-tag' + (gold ? ' is-gold' : ''), text: stage });
  }

  function championLine(world, id, label) {
    return h('p', { class: 'champ-line' }, UI.icon('trophy'), h('span', { text: (label || 'Campeón') + ': ' }), id ? teamCell(world, id, false) : h('span', { text: '—' }));
  }

  function grade(sum) {
    if (sum.relegatedUser) return { label: 'Descenso', tone: 'bad' };
    if (sum.titles.length) return { label: sum.titles.length > 1 ? 'Temporada histórica' : 'Campeón', tone: 'gold' };
    if (sum.next === 'libertadores') return { label: 'Zona de Libertadores', tone: 'sky' };
    if (sum.next === 'sudamericana') return { label: 'Zona de Sudamericana', tone: 'good' };
    return sum.annualPos <= 15 ? { label: 'Mitad de tabla', tone: 'neutral' } : { label: 'Zona baja', tone: 'neutral' };
  }

  function torneoCard(world, name, t, i) {
    return card(name, i, null,
      h('p', { class: 'big-line' }, stageTag(t.stage)),
      h('p', { class: 'sub-line', text: 'Zona ' + t.zone + ' · ' + t.pos + '° en la fase regular' }),
      championLine(world, t.champion));
  }

  function continentalCard(world, sum, userId, i) {
    const c = sum.continental;
    const parts = [
      h('p', { class: 'big-line' }, stageTag(c.stage)),
      c.phase2 ? h('p', { class: 'sub-line', text: 'Empezaste en la Fase 2 (repechaje a dos partidos).' }) : null
    ];
    if (c.group) {
      parts.push(h('h4', { class: 'mini-title', text: c.group.name }));
      parts.push(standingsTable(world, c.group.rows, userId, null));
    }
    parts.push(championLine(world, c.champion));
    return card(c.name, i, 'span-2', parts);
  }

  function nextCard(world, sum, next, i) {
    let stamp;
    let text;
    let tone = 'neutral';
    if (sum.relegatedUser) { text = 'Descendiste. Fin de la carrera.'; tone = 'bad'; stamp = 'DESCENSO'; }
    else if (sum.careerOver) { text = 'Completaste las 5 temporadas. Fin de la carrera.'; }
    else if (sum.next === 'libertadores') { text = 'Clasificado a Copa Libertadores ' + next + (sum.nextPhase2 ? ' (arrancás en la Fase 2)' : ''); tone = 'sky'; stamp = 'CLASIFICADO'; }
    else if (sum.next === 'sudamericana') { text = 'Clasificado a Copa Sudamericana ' + next; tone = 'sky'; stamp = 'CLASIFICADO'; }
    else text = 'Sin copas internacionales en ' + next;
    return card(sum.careerOver ? 'Fin de la carrera' : 'Próxima temporada', i, 'span-2 next-card tone-' + tone,
      stamp ? h('span', { class: 'stamp ' + (tone === 'bad' ? 'stamp-red' : 'stamp-sky'), text: stamp }) : null,
      h('p', { class: 'big-line', text: text }));
  }

  function chipsOf(world, ids, cls) {
    return h('ul', { class: 'chips' }, ids.map(function (id) { return h('li', { class: cls }, teamCell(world, id, false)); }));
  }

  // app: { game, nextSeason() }
  UI.renderResults = function (app) {
    const game = app.game;
    const world = game.world;
    const career = game.career;
    const sum = career.summary;
    const season = game.season;
    const user = career.clubId;
    const club = world.clubs[user];
    const g = grade(sum);
    const row = sum.annualRow;
    UI.applyClubTheme(club);

    const lib = {};
    const sud = {};
    const rel = {};
    sum.qualification.libertadores.forEach(function (id) { lib[id] = true; });
    sum.qualification.sudamericana.forEach(function (id) { sud[id] = true; });
    sum.relegated.forEach(function (id) { rel[id] = true; });
    const zoneOf = function (id) { return rel[id] ? 'rel' : (lib[id] ? 'lib' : (sud[id] ? 'sud' : null)); };
    const annual = EM.League.annualTable(season.torneos.apertura, season.torneos.clausura);

    const stamps = h('div', { class: 'stamps' }, sum.titles.map(function (t, k) {
      return h('span', { class: 'stamp', style: { '--d': (0.7 + k * 0.25) + 's' } }, UI.icon('trophy'), h('span', { text: t }));
    }));

    const hero = h('header', { class: 'panel res-hero reveal tone-' + g.tone, style: { '--i': 0 } },
      h('div', { class: 'rh-top' }, UI.crest(club, 'crest-lg'),
        h('div', null, h('h2', { class: 'rh-club', text: club.name }), h('p', { class: 'rh-year', text: 'Temporada ' + sum.year + ' · ' + (career.seasonIndex + 1) + '/' + career.maxSeasons }))),
      h('div', { class: 'rh-main' },
        h('div', { class: 'rh-pos' }, h('span', { class: 'rh-num', text: sum.annualPos + '°' }), h('span', { class: 'rh-lab', text: 'Tabla anual' })),
        h('span', { class: 'grade grade-' + g.tone, text: g.label })),
      h('div', { class: 'rh-stats' },
        h('div', null, h('strong', { text: String(row.points) }), h('span', { text: 'Puntos' })),
        h('div', null, h('strong', { text: row.won + '-' + row.drawn + '-' + row.lost }), h('span', { text: 'G-E-P' })),
        h('div', null, h('strong', { text: row.gf + '-' + row.ga }), h('span', { text: 'Goles' })),
        h('div', null, h('strong', { text: sum.titles.length }), h('span', { text: sum.titles.length === 1 ? 'Título' : 'Títulos' }))),
      sum.titles.length ? stamps : null,
      sum.relegatedUser ? h('p', { class: 'banner-bad', text: 'Descendiste. Fin de la carrera.' }) : null);

    let i = 1;
    const cards = [
      torneoCard(world, 'Apertura', sum.apertura, i++),
      torneoCard(world, 'Clausura', sum.clausura, i++),
      card('Tabla anual', i++, 'span-2',
        standingsTable(world, annual, user, zoneOf),
        h('ul', { class: 'legend' },
          h('li', { class: 'zone-lib' }, 'Copa Libertadores'), h('li', { class: 'zone-sud' }, 'Copa Sudamericana'), h('li', { class: 'zone-rel' }, 'Descenso'))),
      card('Copa Argentina', i++, null,
        h('p', { class: 'big-line' }, stageTag(sum.copaArgentina.stage)),
        championLine(world, sum.copaArgentina.champion),
        championLine(world, sum.copaArgentina.runnerUp, 'Subcampeón'))
    ];
    if (sum.continental) cards.push(continentalCard(world, sum, user, i++));
    cards.push(card('Campeones ' + sum.year, i++, null, h('ul', { class: 'champ-list' }, [
      ['Apertura', sum.champions.apertura], ['Clausura', sum.champions.clausura], ['Campeón de Liga', sum.champions.liga],
      ['Copa Argentina', sum.champions.copaArgentina], ['Copa Libertadores', sum.champions.libertadores], ['Copa Sudamericana', sum.champions.sudamericana]
    ].map(function (c) { return h('li', null, h('span', { class: 'cl-comp', text: c[0] }), teamCell(world, c[1], c[1] === user)); }))));
    cards.push(card('Ascensos y descensos', i++, null,
      h('h4', { class: 'mini-title bad', text: 'Descienden' }), chipsOf(world, sum.relegated, 'chip-bad'),
      h('h4', { class: 'mini-title good', text: 'Ascienden' }), chipsOf(world, sum.promoted, 'chip-good')));
    cards.push(card('Goleador del equipo', i++, null, sum.topScorer
      ? h('p', { class: 'big-line' }, h('strong', { text: sum.topScorer.name }), ' — ' + sum.topScorer.goals + (sum.topScorer.goals === 1 ? ' gol' : ' goles'))
      : h('p', { class: 'sub-line', text: 'Nadie convirtió goles esta temporada.' })));
    cards.push(nextCard(world, sum, sum.year + 1, i++));

    const label = sum.careerOver ? 'VER RESUMEN FINAL' : 'SIGUIENTE TEMPORADA';
    UI.mount(h('section', { class: 'results', 'aria-label': 'Resultado de la temporada ' + sum.year },
      hero,
      h('div', { class: 'cards' }, cards),
      h('div', { class: 'sim-bar' }, UI.btn(label, { kind: 'primary', block: true, cls: 'btn-xl', icon: 'arrow', onClick: app.nextSeason }))));
  };
})(window.EMUI = window.EMUI || {});
