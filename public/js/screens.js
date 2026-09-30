// Intro screen, hub screen and results screen rendering/wiring.
(function (global) {
  'use strict';

  var U = global.UICommon;
  var GS = global.GameState;
  var GL = global.GameLogic;
  var $ = U.$;

  var TASK_META = {
    preSeason: { icon: '📋', name: 'Pretemporada' },
    sell: { icon: '💸', name: 'Vender' },
    loan: { icon: '🤝', name: 'Préstamo' },
    sign: { icon: '✍️', name: 'Fichar' },
    formation: { icon: '⚽', name: 'Formación' }
  };

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    $('screen-' + name).classList.add('active');
    window.scrollTo(0, 0);
  }

  // ---------------- Intro screen ----------------
  var selectedClubId = null;

  function initIntro(app) {
    var clubs = global.LEAGUE_DATA.clubs;
    var grid = $('club-grid');

    function renderGrid(filter) {
      grid.innerHTML = '';
      var q = (filter || '').trim().toLowerCase();
      clubs
        .filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) !== -1; })
        .forEach(function (c) {
          var tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'club-tile' + (selectedClubId === c.id ? ' selected' : '');
          tile.style.setProperty('--accent', c.colors.primary);
          tile.setAttribute('role', 'option');
          tile.setAttribute('aria-selected', String(selectedClubId === c.id));
          var ring = document.createElement('div');
          ring.className = 'club-tile-crest-ring';
          var img = document.createElement('img');
          img.src = U.crestSrc(c);
          img.alt = '';
          U.hideOnError(img);
          ring.appendChild(img);
          var label = document.createElement('div');
          label.className = 'club-tile-name';
          label.textContent = c.shortName;
          tile.appendChild(ring);
          tile.appendChild(label);
          tile.addEventListener('click', function () {
            selectedClubId = c.id;
            renderGrid($('club-search').value);
            updateSummary(c);
            updateBudgetDefault(c);
            validateStart();
          });
          grid.appendChild(tile);
        });
    }

    function updateSummary(club) {
      var box = $('club-summary');
      box.classList.add('visible');
      box.innerHTML =
        '<strong>' + club.name + '</strong> (' + club.nickname + ')<br>' +
        'DT actual: ' + club.coach + ' · Estadio: ' + club.stadium + ' · Fundado en ' + club.founded;
    }

    var budgetTouchedManually = false;
    function updateBudgetDefault(club) {
      if (budgetTouchedManually) return;
      var def = GL.defaultBudgetForTier(club.tier);
      $('budget-slider').value = def;
      $('budget-value').textContent = GL.formatMoney(def);
    }

    $('budget-slider').addEventListener('input', function () {
      budgetTouchedManually = true;
      $('budget-value').textContent = GL.formatMoney(parseFloat($('budget-slider').value));
    });

    $('club-search').addEventListener('input', function (e) { renderGrid(e.target.value); });

    function validateStart() {
      var name = $('director-name').value.trim();
      $('start-btn').disabled = !(selectedClubId && name.length > 0);
    }
    $('director-name').addEventListener('input', validateStart);

    $('start-btn').addEventListener('click', function () {
      if (!selectedClubId) return;
      var name = $('director-name').value.trim();
      if (!name) return;
      var budget = parseFloat($('budget-slider').value);
      GS.selectClub(app.state, selectedClubId, name, budget);
      try { localStorage.setItem('dda_last_club', selectedClubId); } catch (e) { /* ignore */ }
      initHubTheme(app);
      showScreen('hub');
      refreshHub(app);
    });

    renderGrid('');
    validateStart();
  }

  function initHubTheme(app) {
    var club = GS.getClub(app.state);
    document.documentElement.style.setProperty('--accent', club.colors.primary);
    $('hub-crest').src = U.crestSrc(club);
    $('hub-crest').alt = club.name;
    $('hub-club-name').textContent = club.name;
    $('hub-director').textContent = app.state.directorName;
  }

  // ---------------- Hub screen ----------------
  function refreshHub(app) {
    var state = app.state;
    $('hub-budget').textContent = GL.formatMoney(GS.remainingBudget(state));
    var squadSize = GS.squadSize(state);
    var squadEl = $('hub-squad');
    squadEl.textContent = squadSize;
    squadEl.classList.toggle('warn', squadSize < GL.MIN_SQUAD_TO_SIMULATE);
    $('hub-tasks').textContent = GS.completedTaskCount(state) + '/5';

    renderTaskGrid(app);

    var canSim = GS.canSimulate(state);
    $('simulate-btn').disabled = !canSim;
    $('simulate-hint').textContent = canSim
      ? 'Todo listo. ¡Suerte esta temporada!'
      : (squadSize < GL.MIN_SQUAD_TO_SIMULATE
        ? 'Necesitás al menos ' + GL.MIN_SQUAD_TO_SIMULATE + ' jugadores en el plantel.'
        : 'Completá las 5 tareas para simular la temporada.');
  }

  function renderTaskGrid(app) {
    var state = app.state;
    var grid = $('task-grid');
    grid.innerHTML = '';
    var currentKey = GS.TASK_ORDER.find(function (k) { return !state.tasks[k]; });

    GS.TASK_ORDER.forEach(function (key) {
      var meta = TASK_META[key];
      var unlocked = GS.isTaskUnlocked(state, key);
      var done = state.tasks[key];
      var isCurrent = key === currentKey;

      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile' + (isCurrent ? ' tile-current' : '') + (!unlocked ? ' tile-locked' : '') + (done ? ' tile-done' : '');
      tile.disabled = !unlocked;

      var badge = document.createElement('span');
      badge.className = 'tile-badge' + (done ? ' done' : '');
      badge.textContent = done ? 'Listo' : (unlocked ? 'Pendiente' : 'Bloqueado');
      tile.appendChild(badge);

      var icon = document.createElement('div');
      icon.className = 'tile-icon';
      icon.textContent = meta.icon;
      tile.appendChild(icon);

      var name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = meta.name;
      tile.appendChild(name);

      var sub = document.createElement('div');
      sub.className = 'tile-meta';
      sub.textContent = taskSummary(state, key);
      tile.appendChild(sub);

      if (unlocked) {
        tile.addEventListener('click', function () { global.Tasks.open(app, key); });
      }
      grid.appendChild(tile);
    });
  }

  function taskSummary(state, key) {
    if (key === 'preSeason') return state.tasks.preSeason ? state.preSeason.summary : 'Definí la agenda del club';
    if (key === 'sell') return state.soldIds.length + ' vendidos';
    if (key === 'loan') return state.loanedIds.length + ' a préstamo';
    if (key === 'sign') return state.signedPlayers.length + ' fichajes';
    if (key === 'formation') return state.tasks.formation ? state.formationName : 'Sin definir';
    return '';
  }

  // ---------------- Results screen ----------------
  function renderResults(app, result) {
    var state = app.state;
    var club = GS.getClub(state);
    var userRow = result.table.find(function (r) { return r.isUser; });
    var grade = GL.gradeForPosition(result.userPosition, result.table.length);

    var body = $('results-body');
    body.innerHTML = '';

    var hero = document.createElement('div');
    hero.className = 'result-hero';
    hero.innerHTML =
      '<div class="result-grade ' + grade.tone + '">' + grade.label + '</div>' +
      '<div class="result-position">' + result.userPosition + '°</div>' +
      '<div class="result-club">' + club.name + ' · ' + userRow.points + ' pts · Temporada 2027</div>';
    body.appendChild(hero);

    var stats = document.createElement('div');
    stats.className = 'result-stats-grid';
    var statDefs = [
      [userRow.won + 'V ' + userRow.drawn + 'E ' + userRow.lost + 'D', 'Récord'],
      [userRow.goalsFor + '-' + userRow.goalsAgainst, 'Goles'],
      [result.scorer ? result.scorer.goals : 0, 'Goles (goleador)']
    ];
    statDefs.forEach(function (pair) {
      var box = document.createElement('div');
      box.className = 'result-stat';
      box.innerHTML = '<div class="result-stat-value">' + pair[0] + '</div><div class="result-stat-label">' + pair[1] + '</div>';
      stats.appendChild(box);
    });
    body.appendChild(stats);

    if (result.scorer) {
      var scorerTitle = document.createElement('div');
      scorerTitle.className = 'section-title';
      scorerTitle.textContent = 'Goleador del equipo';
      body.appendChild(scorerTitle);
      var scorerRow = document.createElement('div');
      scorerRow.className = 'info-bar';
      scorerRow.innerHTML = '<strong>' + result.scorer.player.name + '</strong> — ' + result.scorer.goals + ' goles en la temporada.';
      body.appendChild(scorerRow);
    }

    var tableTitle = document.createElement('div');
    tableTitle.className = 'section-title';
    tableTitle.textContent = 'Tabla final — Liga Profesional';
    body.appendChild(tableTitle);

    function formatGoalDiff(diff) { return diff > 0 ? '+' + diff : String(diff); }

    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'league-table';
    table.innerHTML =
      '<thead><tr><th>#</th><th class="team-th">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>DG</th><th>Pts</th></tr></thead>';
    var tbody = document.createElement('tbody');
    result.table.forEach(function (row, idx) {
      var tr = document.createElement('tr');
      if (row.isUser) tr.className = 'user-row';
      var rowClub = GS.findClub(row.clubId);
      tr.innerHTML =
        '<td>' + (idx + 1) + '</td>' +
        '<td class="team-cell"><img src="' + U.crestSrc(rowClub) + '" alt="" onerror="this.style.display=\'none\'">' + row.shortName + '</td>' +
        '<td>' + row.played + '</td><td>' + row.won + '</td><td>' + row.drawn + '</td><td>' + row.lost + '</td>' +
        '<td>' + formatGoalDiff(row.goalsFor - row.goalsAgainst) + '</td><td class="pts-cell">' + row.points + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);

    var actions = document.createElement('div');
    actions.className = 'results-actions';
    actions.appendChild(U.makeButton('btn btn-primary btn-block', 'Jugar de nuevo', function () {
      global.location.reload();
    }));
    body.appendChild(actions);

    showScreen('results');
  }

  global.Screens = {
    showScreen: showScreen,
    initIntro: initIntro,
    refreshHub: refreshHub,
    renderResults: renderResults
  };
})(window);
