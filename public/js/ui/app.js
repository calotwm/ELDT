// ELMANAGER app shell: navigation between screens, autosave and the "simulando" overlay.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  const SIM_STAGES = ['Apertura', 'Clausura', 'Copa Argentina', 'Copas internacionales', 'Tabla anual y ascensos'];
  const SIM_MS = 1500;

  const app = {
    data: window.LEAGUE_DATA,
    game: null,
    screen: 'title',
    saveWarned: false,
    cache: undefined,
    busy: false
  };

  // ---- save ------------------------------------------------------------------------------------------------
  app.savedGame = function () {
    if (app.cache === undefined) app.cache = EM.Save.exists() ? EM.Save.load() : null;
    return app.cache;
  };

  app.commit = function () {
    app.cache = undefined;
    if (!EM.Save.save(app.game) && !app.saveWarned) {
      app.saveWarned = true;
      UI.toast('No se pudo guardar la partida en este navegador.');
    }
  };

  // ---- screens ---------------------------------------------------------------------------------------------
  app.toTitle = function () {
    app.screen = 'title';
    app.cache = undefined;
    UI.resetTheme();
    UI.renderTitle(app);
  };

  app.restart = function () {
    app.screen = 'setup';
    UI.renderSetup(app);
  };

  app.newGame = function () {
    const saved = app.savedGame();
    if (!saved) { app.restart(); return; }
    const club = saved.world.clubs[saved.career.clubId];
    UI.confirmDialog({
      title: 'Nueva partida', icon: 'warn', danger: true, confirmLabel: 'Empezar de nuevo',
      text: 'Ya tenés una partida guardada (' + club.name + ' · Temporada ' + saved.career.year + '). Si empezás otra, se reemplaza.',
      onConfirm: app.restart
    });
  };

  app.start = function (opts) {
    app.game = EM.Career.newGame(app.data, opts);
    app.commit();
    showHub(true);
  };

  app.continueGame = function () {
    const saved = app.savedGame();
    if (!saved) { UI.toast('No hay una partida guardada.'); return; }
    app.game = saved;
    const phase = saved.career.phase;
    if (phase === 'review') showResults();
    else if (phase === 'ended') showSummary();
    else showHub(true);
  };

  function showHub(animate) {
    app.screen = 'hub';
    UI.renderHub(app, { animate: !!animate });
  }

  function showResults() {
    app.screen = 'results';
    UI.renderResults(app);
  }

  function showSummary() {
    app.screen = 'summary';
    UI.renderSummary(app);
  }

  app.openTask = function (key) { UI.openTask(app, key); };

  // Called when a task sheet closes: redraw the hub and give focus back to the tile.
  app.afterTask = function (key) {
    if (app.screen !== 'hub') return;
    showHub(false);
    const tile = document.querySelector('.tile[data-task="' + key + '"]');
    if (tile && !tile.disabled) tile.focus({ preventScroll: true });
  };

  // ---- simulation --------------------------------------------------------------------------------------------
  app.simulate = function () {
    if (app.busy || !EM.Career.canSimulate(app.game)) return;
    app.busy = true;
    const year = app.game.career.year;
    const label = h('p', { class: 'sim-stage', text: SIM_STAGES[0] });
    const fill = h('i', { class: 'sim-fill' });
    const bar = h('div', { class: 'sim-bar-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Progreso de la simulación' }, fill);
    const skip = UI.btn('Saltar', { kind: 'ghost', cls: 'btn-sm', icon: 'arrow', onClick: function () { skipped = true; if (result) finish(); } });
    const overlay = h('div', { class: 'sim-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Simulando temporada' },
      h('div', { class: 'panel sim-card' },
        h('span', { class: 'sim-ball' }, UI.icon('ball')),
        h('h2', { class: 'sim-title', text: 'Simulando temporada ' + year }),
        label, bar, skip));
    document.getElementById('modal-root').appendChild(overlay);
    document.body.classList.add('modal-open');
    skip.focus();

    let result = null;
    let skipped = false;
    let done = false;
    let timer = null;

    function finish() {
      if (done) return;
      done = true;
      clearInterval(timer);
      overlay.remove();
      document.body.classList.remove('modal-open');
      app.busy = false;
      if (!result.ok) { UI.toast(result.message); return; }
      showResults();
    }

    setTimeout(function () {
      result = EM.Career.simulateSeason(app.game);
      if (result.ok) app.commit();
      if (skipped || !result.ok) { finish(); return; }
      const total = UI.reduceMotion() ? 350 : SIM_MS;
      const t0 = Date.now();
      timer = setInterval(function () {
        const p = Math.min(1, (Date.now() - t0) / total);
        fill.style.width = Math.round(p * 100) + '%';
        bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        label.textContent = SIM_STAGES[Math.min(SIM_STAGES.length - 1, Math.floor(p * SIM_STAGES.length))];
        if (p >= 1) finish();
      }, 40);
    }, 40);
  };

  app.nextSeason = function () {
    if (app.busy) return;
    const r = EM.Career.nextSeason(app.game);
    if (!r.ok) { UI.toast(r.message); return; }
    app.commit();
    if (r.ended) { showSummary(); return; }
    showHub(true);
    UI.toast('Empieza la pretemporada ' + app.game.career.year + '.');
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.EMApp = app;
    app.toTitle();
  });
})(window.EMUI = window.EMUI || {});
