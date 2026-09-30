// ELMANAGER club select: searchable crest grid, club summary, director name and budget slider.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  const TIER_LABEL = { 1: 'Club grande', 2: 'Club mediano', 3: 'Club chico' };
  const NAME_KEY = 'elmanager.director';
  const DIFF_KEY = 'elmanager.difficulty';

  function savedName() {
    try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function rememberName(name) {
    try { window.localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage unavailable */ }
  }

  function savedDifficulty() {
    try { return EM.Career.difficultyOf(window.localStorage.getItem(DIFF_KEY)).id; } catch (e) { return EM.Career.DEFAULT_DIFFICULTY; }
  }

  function rememberDifficulty(id) {
    try { window.localStorage.setItem(DIFF_KEY, id); } catch (e) { /* storage unavailable */ }
  }

  function num(v) { return String(v).replace('.', ','); }

  // Plain-language effect of a difficulty level.
  UI.difficultyText = function (d) {
    const parts = [];
    if (d.bonus) parts.push('+' + num(d.bonus) + ' de nivel al equipo');
    if (d.money > 1) parts.push('+' + Math.round((d.money - 1) * 100) + '% de presupuesto cada temporada');
    return parts.length ? parts.join(' y ') + '.' : 'Sin ayudas: el equipo juega con su nivel real.';
  };

  function stat(label, value) {
    return h('div', { class: 'kv' }, h('dt', { text: label }), h('dd', { text: String(value) }));
  }

  // app: { data, toTitle(), start({ clubId, directorName, startBudget }) }
  UI.renderSetup = function (app) {
    const clubs = app.data.clubs;
    let selected = null;
    let budgetTouched = false;
    let difficulty = savedDifficulty();
    const tiles = {};

    const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar club...', autocomplete: 'off', 'aria-label': 'Buscar club' });
    const grid = h('div', { class: 'club-grid', role: 'group', 'aria-label': 'Clubes de la Liga Profesional' });
    const summary = h('div', { class: 'club-summary' });
    const nameInput = h('input', { class: 'input', id: 'director-name', type: 'text', maxlength: '40', placeholder: 'Nombre del director deportivo', autocomplete: 'off', value: savedName() });
    const slider = h('input', { class: 'slider', id: 'budget-slider', type: 'range', min: '0', max: String(EM.Career.MAX_START_BUDGET), step: '0.5', value: '20' });
    const budgetOut = h('output', { class: 'budget-out', for: 'budget-slider', text: EM.Util.formatMoney(20) });
    const diffNote = h('p', { class: 'diff-note' });
    const diffRow = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Dificultad' });
    const start = UI.btn('COMENZAR', { kind: 'primary', block: true, cls: 'btn-xl', icon: 'play', disabled: true, onClick: begin });

    clubs.forEach(function (c) {
      const tile = h('button', { type: 'button', class: 'club-tile', 'aria-pressed': 'false', title: c.name, onclick: function () { choose(c); } },
        h('span', { class: 'ct-ring', style: { '--c': 'rgb(' + UI.clubAccent(c).join(',') + ')' } }, UI.crest(c)),
        h('span', { class: 'ct-name', text: c.shortName }));
      tiles[c.id] = tile;
    });

    function renderGrid() {
      const q = EM.Util.norm(search.value);
      UI.clear(grid);
      const list = clubs.filter(function (c) { return !q || EM.Util.norm(c.name).indexOf(q) >= 0 || EM.Util.norm(c.shortName).indexOf(q) >= 0; });
      list.forEach(function (c) { grid.appendChild(tiles[c.id]); });
      if (!list.length) grid.appendChild(h('p', { class: 'empty', text: 'No hay clubes con ese nombre.' }));
    }

    function choose(c) {
      selected = c;
      Object.keys(tiles).forEach(function (id) {
        const on = id === c.id;
        tiles[id].classList.toggle('is-selected', on);
        tiles[id].setAttribute('aria-pressed', String(on));
      });
      UI.applyClubTheme(c);
      if (!budgetTouched) {
        slider.value = String(EM.Career.defaultBudget(c.tier));
        budgetOut.textContent = EM.Util.formatMoney(Number(slider.value));
      }
      const xi = EM.Squad.bestXI(c.players, '4-3-3').strength;
      UI.clear(summary);
      summary.appendChild(h('div', { class: 'cs-head' },
        UI.crest(c, 'crest-xl'),
        h('div', null, h('h3', { class: 'cs-name', text: c.name }), h('p', { class: 'cs-nick', text: c.nickname }))));
      summary.appendChild(h('dl', { class: 'kv-grid' },
        stat('Categoría', TIER_LABEL[c.tier] || 'Club'),
        stat('Plantel', c.players.length + ' jugadores'),
        stat('Nivel del once', xi.toFixed(1)),
        stat('DT actual', c.coach),
        stat('Estadio', c.stadium),
        stat('Fundado', c.founded)));
      validate();
    }

    function paintDifficulty() {
      UI.clear(diffRow);
      EM.Career.DIFFICULTIES.forEach(function (d) {
        const on = d.id === difficulty;
        diffRow.appendChild(h('button', {
          type: 'button', class: 'seg-btn' + (on ? ' is-active' : ''), role: 'radio', 'aria-checked': String(on),
          onclick: function () { difficulty = d.id; rememberDifficulty(d.id); paintDifficulty(); }
        }, d.label));
      });
      diffNote.textContent = UI.difficultyText(EM.Career.difficultyOf(difficulty));
    }

    function validate() { start.disabled = !(selected && nameInput.value.trim().length > 0); }

    function begin() {
      const name = nameInput.value.trim();
      if (!selected || !name) return;
      rememberName(name);
      app.start({ clubId: selected.id, directorName: name, startBudget: Number(slider.value), difficulty: difficulty });
    }

    search.addEventListener('input', renderGrid);
    nameInput.addEventListener('input', validate);
    slider.addEventListener('input', function () {
      budgetTouched = true;
      budgetOut.textContent = EM.Util.formatMoney(Number(slider.value));
    });

    summary.appendChild(h('p', { class: 'cs-empty', text: 'Elegí un club de la grilla para ver su ficha.' }));
    renderGrid();
    paintDifficulty();
    UI.resetTheme();

    const side = h('aside', { class: 'panel setup-side' },
      summary,
      h('label', { class: 'field-label', for: 'director-name', text: 'Tu nombre' }), nameInput,
      h('label', { class: 'field-label', for: 'budget-slider', text: 'Presupuesto de pases' }),
      h('div', { class: 'budget-row' }, h('span', { text: 'US$ 0M' }), budgetOut, h('span', { text: 'US$ ' + EM.Career.MAX_START_BUDGET + 'M' })),
      slider,
      h('label', { class: 'field-label', text: 'Dificultad' }), diffRow, diffNote,
      h('div', { class: 'sticky-cta' }, start));

    UI.mount(h('section', { class: 'setup', 'aria-label': 'Elegir club' },
      h('header', { class: 'page-head' },
        UI.btn('Inicio', { kind: 'ghost', cls: 'btn-sm', icon: 'back', onClick: app.toTitle }),
        h('h2', { class: 'page-title', text: 'Elegí tu club' })),
      h('div', { class: 'setup-grid' },
        h('div', { class: 'setup-main' }, search, grid),
        side)));
  };
})(window.EMUI = window.EMUI || {});
