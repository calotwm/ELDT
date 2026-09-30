// ELMANAGER title screen: game cover with INICIAR / CONTINUAR and the cafecito link.
(function (UI) {
  'use strict';

  const h = UI.h;

  // app: { hasSave(), savedGame(), newGame(), continueGame() }
  UI.renderTitle = function (app) {
    const saved = app.savedGame();
    const buttons = h('div', { class: 'title-actions' });
    buttons.appendChild(UI.btn('INICIAR', { kind: 'primary', cls: 'btn-xl', icon: 'play', onClick: app.newGame }));

    if (saved) {
      const club = saved.world.clubs[saved.career.clubId];
      buttons.appendChild(UI.btn('CONTINUAR', {
        cls: 'btn-xl', icon: 'arrow', onClick: app.continueGame, sub: club.name + ' · Temporada ' + saved.career.year
      }));
    }

    const cafe = h('a', {
      class: 'cafe', href: 'https://cafecito.app/urquisoft', target: '_blank', rel: 'noopener noreferrer'
    }, UI.icon('coffee'), h('span', { text: 'Invitame un cafecito' }));

    const node = h('section', { class: 'title-screen', 'aria-label': 'Pantalla de inicio' },
      h('div', { class: 'stadium-fx', 'aria-hidden': 'true' },
        h('i', { class: 'light l1' }), h('i', { class: 'light l2' }), h('i', { class: 'light l3' }), h('i', { class: 'light l4' }),
        h('div', { class: 'pitch-floor' }, h('i', { class: 'pf-circle' }), h('i', { class: 'pf-line' }), h('i', { class: 'pf-box' }))),
      h('div', { class: 'title-body' },
        h('p', { class: 'kicker', text: 'Director deportivo · Fútbol argentino' }),
        h('h1', { class: 'wordmark', 'aria-label': 'ELMANAGER' }, h('span', { class: 'wm-el', text: 'EL' }), h('span', { class: 'wm-rest', text: 'MANAGER' })),
        h('p', { class: 'title-desc', text: 'Juego de director deportivo del fútbol argentino: elegí un club, armá el plantel y llevalo 5 temporadas por el Apertura, el Clausura, la Copa Argentina y las copas internacionales.' }),
        buttons,
        cafe),
      h('footer', { class: 'title-foot', text: 'Datos: promiedos.com.ar' }));
    UI.mount(node);
  };
})(window.EMUI = window.EMUI || {});
