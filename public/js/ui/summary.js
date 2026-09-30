// ELMANAGER final summary: the five seasons in one table, total titles and "Nueva partida".
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  // app: { game, restart(), toTitle() }
  UI.renderSummary = function (app) {
    const game = app.game;
    const club = EM.Career.userClub(game);
    const fin = EM.Career.getFinalSummary(game);
    const relegated = fin.endReason === 'relegation';
    const best = fin.history.reduce(function (m, r) { return Math.min(m, r.annualPos); }, 99);
    UI.applyClubTheme(club);

    const body = h('tbody');
    fin.history.forEach(function (r) {
      body.appendChild(h('tr', { class: r.relegated ? 'zone-rel' : (r.titles.length ? 'zone-lib' : '') },
        h('th', { scope: 'row', class: 'sticky-col', text: String(r.year) }),
        h('td', { class: 'pts', text: r.annualPos + '°' }),
        h('td', { text: r.apertura }), h('td', { text: r.clausura }), h('td', { text: r.copaArgentina }),
        h('td', { text: r.continental ? r.continental.name.replace('Copa ', '') + ': ' + r.continental.stage : '—' }),
        h('td', { class: 'titles-cell', text: r.titles.length ? r.titles.join(', ') : '—' })));
    });

    const stamps = [];
    fin.history.forEach(function (r) {
      r.titles.forEach(function (t, k) {
        stamps.push(h('span', { class: 'stamp', style: { '--d': (0.5 + stamps.length * 0.15) + 's' } }, UI.icon('trophy'), h('span', { text: r.year + ' · ' + t })));
      });
    });

    UI.mount(h('section', { class: 'summary', 'aria-label': 'Resumen final' },
      h('header', { class: 'panel res-hero reveal tone-' + (relegated ? 'bad' : 'gold'), style: { '--i': 0 } },
        h('div', { class: 'rh-top' }, UI.crest(club, 'crest-lg'),
          h('div', null, h('h2', { class: 'rh-club', text: club.name }), h('p', { class: 'rh-year', text: 'DT ' + game.career.directorName }))),
        h('h3', { class: 'summary-title', text: relegated ? 'Descendiste. Fin de la carrera.' : 'Carrera completa' }),
        h('div', { class: 'rh-stats' },
          h('div', null, h('strong', { text: String(fin.seasons) }), h('span', { text: fin.seasons === 1 ? 'Temporada' : 'Temporadas' })),
          h('div', null, h('strong', { text: String(fin.titles) }), h('span', { text: fin.titles === 1 ? 'Título' : 'Títulos' })),
          h('div', null, h('strong', { text: best + '°' }), h('span', { text: 'Mejor puesto' })),
          h('div', null, h('strong', { text: EM.Util.formatMoney(fin.budget) }), h('span', { text: 'Caja final' }))),
        stamps.length ? h('div', { class: 'stamps' }, stamps) : null),
      h('section', { class: 'panel card reveal', style: { '--i': 1 } },
        h('h3', { class: 'card-title', text: 'Tus temporadas' }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'standings history' },
          h('thead', null, h('tr', null,
            h('th', { class: 'sticky-col', text: 'Año' }), h('th', { text: 'Anual' }), h('th', { text: 'Apertura' }), h('th', { text: 'Clausura' }),
            h('th', { text: 'Copa Argentina' }), h('th', { text: 'Copa internacional' }), h('th', { text: 'Títulos' }))),
          body))),
      h('div', { class: 'sim-bar sim-bar-row' },
        UI.btn('Inicio', { kind: 'ghost', icon: 'home', onClick: app.toTitle }),
        UI.btn('NUEVA PARTIDA', { kind: 'primary', cls: 'btn-xl', icon: 'play', onClick: app.restart }))));
  };
})(window.EMUI = window.EMUI || {});
