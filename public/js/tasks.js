// The five hub task sheets: pretemporada, vender, préstamo, fichar, formación.
(function (global) {
  'use strict';

  var U = global.UICommon;
  var GS = global.GameState;
  var GL = global.GameLogic;
  var $ = U.$;

  var RENDERERS = {
    preSeason: renderPreSeason,
    sell: renderSell,
    loan: renderLoan,
    sign: renderSign,
    formation: renderFormation
  };

  var ICONS = {
    preSeason: '📋',
    sell: '💸',
    loan: '🤝',
    sign: '✍️',
    formation: '⚽'
  };
  var TITLES = {
    preSeason: 'Pretemporada',
    sell: 'Vender jugadores',
    loan: 'Préstamos',
    sign: 'Mercado de pases',
    formation: 'Formación'
  };

  function open(app, key) {
    RENDERERS[key](app);
  }

  function refreshAfterChange(app) {
    global.Screens.refreshHub(app);
  }

  // ---------------- PRE-SEASON ----------------
  var sponsorPickId = null;

  function renderPreSeason(app) {
    var state = app.state;
    var club = GS.getClub(state);
    var event = GL.getPreSeasonEvent(club);
    var body = document.createElement('div');

    if (state.tasks.preSeason) {
      var done = document.createElement('div');
      done.className = 'info-bar good';
      done.innerHTML = 'Listo: <strong>' + state.preSeason.summary + '</strong>';
      body.appendChild(done);
      U.openSheet({
        icon: ICONS.preSeason, title: TITLES.preSeason, body: body,
        footerButtons: [U.makeButton('btn btn-block', 'Cerrar', U.closeSheet)]
      });
      return;
    }

    if (event.type === 'sponsor') {
      renderSponsorEvent(app, event, body);
      return;
    }
    renderChoiceEvent(app, event, body);
  }

  function renderSponsorEvent(app, event, body) {
    var state = app.state;
    var attemptsRow = document.createElement('div');
    attemptsRow.className = 'attempts-row';
    var pips = document.createElement('div');
    pips.className = 'pip-row';
    for (var i = 0; i < GL.SPONSOR_ATTEMPTS; i++) {
      var p = document.createElement('span');
      p.className = 'pip' + (i >= state.sponsorAttemptsLeft ? ' used' : '');
      pips.appendChild(p);
    }
    var label = document.createElement('span');
    label.textContent = 'Intentos: ' + state.sponsorAttemptsLeft;
    attemptsRow.appendChild(label);
    attemptsRow.appendChild(pips);
    body.appendChild(attemptsRow);

    var info = document.createElement('div');
    info.className = 'info-bar';
    info.textContent = 'Elegí un sponsor y presioná "Negociar". Si rechaza la oferta perdés un intento.';
    body.appendChild(info);

    var grid = document.createElement('div');
    grid.className = 'choice-grid';
    event.options.forEach(function (opt) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'choice-card' + (sponsorPickId === opt.id ? ' selected' : '');
      var probClass = opt.prob >= 60 ? 'prob-high' : (opt.prob >= 40 ? 'prob-mid' : 'prob-low');
      card.innerHTML =
        '<div class="choice-card-top"><span class="choice-card-name">' + opt.name + '</span>' +
        '<span class="prob-pill ' + probClass + '">' + opt.prob + '%</span></div>' +
        '<div class="choice-card-detail">Aporta ' + GL.formatMoney(opt.fee) + ' al presupuesto si acepta.</div>';
      card.addEventListener('click', function () {
        sponsorPickId = opt.id;
        renderPreSeason(app);
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);

    var negotiateBtn = U.makeButton('btn btn-primary', 'Negociar →', function () {
      if (!sponsorPickId) return;
      var opt = event.options.find(function (o) { return o.id === sponsorPickId; });
      var result = GL.attemptSponsorPitch(opt);
      state.sponsorAttemptsLeft--;
      if (result.success) {
        GS.sponsorSuccess(state, result.fee);
        U.showToast(opt.name + ' aceptó el acuerdo.');
        refreshAfterChange(app);
        U.closeSheet();
        return;
      }
      U.showToast(opt.name + ' rechazó la propuesta.');
      if (state.sponsorAttemptsLeft <= 0) {
        GS.sponsorExhausted(state);
        refreshAfterChange(app);
        U.closeSheet();
        return;
      }
      sponsorPickId = null;
      renderPreSeason(app);
    });
    negotiateBtn.disabled = !sponsorPickId;

    U.openSheet({
      icon: ICONS.preSeason, title: TITLES.preSeason, body: body,
      footerButtons: [U.makeButton('btn btn-ghost', 'Cancelar', U.closeSheet), negotiateBtn]
    });
  }

  function renderChoiceEvent(app, event, body) {
    var state = app.state;
    var picked = null;

    var info = document.createElement('div');
    info.className = 'info-bar';
    info.textContent = eventDescription(event);
    body.appendChild(info);

    var grid = document.createElement('div');
    grid.className = 'choice-grid';
    event.options.forEach(function (opt) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'choice-card';
      var detail = [];
      if (opt.incumbent) detail.push('DT actual');
      if (opt.cost) detail.push('Costo ' + GL.formatMoney(opt.cost));
      if (opt.strengthMod) detail.push((opt.strengthMod > 0 ? '+' : '') + opt.strengthMod + ' de nivel');
      card.innerHTML =
        '<div class="choice-card-name">' + opt.name + '</div>' +
        '<div class="choice-card-detail">' + (detail.join(' · ') || 'Sin costo ni efecto') + '</div>';
      card.addEventListener('click', function () {
        picked = opt;
        grid.querySelectorAll('.choice-card').forEach(function (c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        confirmBtn.disabled = false;
      });
      grid.appendChild(card);
    });
    body.appendChild(grid);

    var confirmBtn = U.makeButton('btn btn-primary', 'Confirmar', function () {
      if (!picked) return;
      GS.applyPreSeasonChoice(state, event, picked);
      refreshAfterChange(app);
      U.closeSheet();
    });
    confirmBtn.disabled = true;

    U.openSheet({
      icon: ICONS.preSeason, title: TITLES.preSeason, body: body,
      footerButtons: [U.makeButton('btn btn-ghost', 'Cancelar', U.closeSheet), confirmBtn]
    });
  }

  function eventDescription(event) {
    if (event.type === 'coach') return 'Definí quién dirige al equipo esta temporada. Afecta el nivel del plantel.';
    if (event.type === 'academy') return 'Invertí en las divisiones inferiores para reforzar el nivel general del plantel.';
    return 'Decidí si encarar obras en el estadio esta pretemporada.';
  }

  // ---------------- SELL ----------------
  function renderSell(app) {
    var state = app.state;
    var selected = state.soldIds.slice();
    var body = document.createElement('div');
    var info = document.createElement('div');
    info.className = 'info-bar';
    body.appendChild(info);

    var list = document.createElement('div');
    list.className = 'list-scroll';
    body.appendChild(list);

    function updateInfo() {
      info.textContent = 'Podés vender hasta ' + GL.SELL_LIMIT + ' jugadores. Seleccionados: ' + selected.length + '/' + GL.SELL_LIMIT + '.';
    }

    function renderList() {
      list.innerHTML = '';
      var squad = GS.getBaseSquad(state).filter(function (p) { return state.loanedIds.indexOf(p.id) === -1; });
      squad.forEach(function (p) {
        var isSel = selected.indexOf(p.id) !== -1;
        var atLimit = !isSel && selected.length >= GL.SELL_LIMIT;
        var row = U.buildPlayerRow(p, {
          selected: isSel, showCheck: true, disabled: atLimit,
          onClick: function () {
            if (isSel) selected = selected.filter(function (id) { return id !== p.id; });
            else selected.push(p.id);
            updateInfo();
            renderList();
          }
        });
        list.appendChild(row);
      });
    }

    updateInfo();
    renderList();

    U.openSheet({
      icon: ICONS.sell, title: TITLES.sell, body: body,
      footerButtons: [
        U.makeButton('btn btn-ghost', 'Cancelar', U.closeSheet),
        U.makeButton('btn btn-primary', 'Confirmar ventas', function () {
          GS.setSoldPlayers(state, selected);
          refreshAfterChange(app);
          U.closeSheet();
        })
      ]
    });
  }

  // ---------------- LOAN ----------------
  function renderLoan(app) {
    var state = app.state;
    var selected = state.loanedIds.slice();
    var body = document.createElement('div');
    var info = document.createElement('div');
    info.className = 'info-bar';
    body.appendChild(info);
    var list = document.createElement('div');
    list.className = 'list-scroll';
    body.appendChild(list);

    function updateInfo() {
      info.textContent = 'Es opcional. Podés prestar hasta ' + GL.LOAN_LIMIT + ' jugadores. Seleccionados: ' + selected.length + '/' + GL.LOAN_LIMIT + '.';
    }

    function renderList() {
      list.innerHTML = '';
      var squad = GS.getBaseSquad(state).filter(function (p) { return state.soldIds.indexOf(p.id) === -1; });
      squad.forEach(function (p) {
        var isSel = selected.indexOf(p.id) !== -1;
        var atLimit = !isSel && selected.length >= GL.LOAN_LIMIT;
        var row = U.buildPlayerRow(p, {
          selected: isSel, showCheck: true, disabled: atLimit,
          onClick: function () {
            if (isSel) selected = selected.filter(function (id) { return id !== p.id; });
            else selected.push(p.id);
            updateInfo();
            renderList();
          }
        });
        list.appendChild(row);
      });
    }

    updateInfo();
    renderList();

    U.openSheet({
      icon: ICONS.loan, title: TITLES.loan, body: body,
      footerButtons: [
        U.makeButton('btn btn-ghost', 'Cancelar', U.closeSheet),
        U.makeButton('btn btn-primary', 'Confirmar préstamos', function () {
          GS.setLoanedPlayers(state, selected);
          refreshAfterChange(app);
          U.closeSheet();
        })
      ]
    });
  }

  // ---------------- SIGN ----------------
  var signSearch = '';
  var signPosFilter = 'ALL';
  var SIGN_POS_LIST = ['ALL', 'GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];

  function marketPool(app) {
    var state = app.state;
    var ownId = state.clubId;
    var pool = [];
    global.LEAGUE_DATA.clubs.forEach(function (c) {
      if (c.id === ownId) return;
      c.players.forEach(function (p) { pool.push({ player: p, club: c }); });
    });
    return pool;
  }

  function renderSign(app) {
    var state = app.state;
    var body = document.createElement('div');

    var budgetChip = document.createElement('div');
    budgetChip.className = 'budget-chip';
    body.appendChild(budgetChip);

    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'text-input';
    search.placeholder = 'Buscar jugador o club...';
    search.value = signSearch;
    search.style.marginBottom = '10px';
    body.appendChild(search);

    var filterRow = document.createElement('div');
    filterRow.className = 'pos-filter-row';
    body.appendChild(filterRow);

    var listWrap = document.createElement('div');
    listWrap.className = 'market-list list-scroll';
    body.appendChild(listWrap);

    var signedSummary = document.createElement('div');
    signedSummary.className = 'signed-summary';
    body.appendChild(signedSummary);

    function updateBudgetChip() {
      budgetChip.innerHTML = 'Presupuesto disponible <strong>' + GL.formatMoney(GS.remainingBudget(state)) + '</strong>';
    }

    function renderFilters() {
      filterRow.innerHTML = '';
      SIGN_POS_LIST.forEach(function (pos) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pos-filter-btn' + (signPosFilter === pos ? ' active' : '');
        btn.textContent = pos === 'ALL' ? 'TODOS' : global.POS_META[pos].label;
        btn.addEventListener('click', function () {
          signPosFilter = pos;
          renderFilters();
          renderMarketList();
        });
        filterRow.appendChild(btn);
      });
    }

    function renderMarketList() {
      listWrap.innerHTML = '';
      var q = signSearch.trim().toLowerCase();
      var signedIds = state.signedPlayers.map(function (p) { return p.id; });
      var items = marketPool(app).filter(function (item) {
        if (signPosFilter !== 'ALL' && item.player.pos !== signPosFilter) return false;
        if (q && item.player.name.toLowerCase().indexOf(q) === -1 && item.club.name.toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).sort(function (a, b) { return b.player.rating - a.player.rating; }).slice(0, 60);

      if (!items.length) {
        var none = document.createElement('div');
        none.className = 'no-results';
        none.textContent = 'No se encontraron jugadores.';
        listWrap.appendChild(none);
        return;
      }

      items.forEach(function (item) {
        var price = GL.buyPriceForPlayer(item.player, item.club);
        var isSigned = signedIds.indexOf(item.player.id) !== -1;
        var overBudget = !isSigned && price > GS.remainingBudget(state);
        var overSquad = !isSigned && GS.squadSize(state) >= GL.MAX_SQUAD_SIZE;
        var row = U.buildPlayerRow(item.player, {
          metaExtra: item.club.shortName,
          priceOverride: price,
          selected: isSigned,
          showCheck: true,
          disabled: overBudget || overSquad,
          onClick: function () {
            if (isSigned) {
              GS.unsignPlayer(state, item.player.id);
            } else {
              var ok = GS.signPlayer(state, item.player, item.club);
              if (!ok) { U.showToast('No alcanza el presupuesto o el plantel está completo.'); return; }
            }
            updateBudgetChip();
            renderMarketList();
            renderSignedSummary();
          }
        });
        row.classList.add('market-row');
        if (isSigned) row.classList.add('signed');
        if (overBudget || overSquad) row.classList.add('over-budget');
        listWrap.appendChild(row);
      });
    }

    function renderSignedSummary() {
      signedSummary.innerHTML = '';
      if (!state.signedPlayers.length) return;
      var title = document.createElement('div');
      title.className = 'signed-summary-title';
      title.textContent = 'Fichados (' + state.signedPlayers.length + ')';
      signedSummary.appendChild(title);
      state.signedPlayers.forEach(function (p) {
        var row = U.buildPlayerRow(p, {
          priceOverride: p.boughtPrice, showCheck: true, selected: true,
          onClick: function () {
            GS.unsignPlayer(state, p.id);
            updateBudgetChip();
            renderMarketList();
            renderSignedSummary();
          }
        });
        signedSummary.appendChild(row);
      });
    }

    search.addEventListener('input', function () {
      signSearch = search.value;
      renderMarketList();
    });

    updateBudgetChip();
    renderFilters();
    renderMarketList();
    renderSignedSummary();

    U.openSheet({
      icon: ICONS.sign, title: TITLES.sign, body: body,
      footerButtons: [
        U.makeButton('btn btn-ghost', 'Cancelar', U.closeSheet),
        U.makeButton('btn btn-primary', 'Confirmar fichajes', function () {
          GS.markSignDone(state);
          refreshAfterChange(app);
          U.closeSheet();
        })
      ]
    });
  }

  // ---------------- FORMATION ----------------
  function renderFormation(app) {
    var state = app.state;
    var body = document.createElement('div');

    var info = document.createElement('div');
    info.className = 'info-bar';
    info.textContent = 'Elegí una formación y tocá cada posición para asignar un jugador.';
    body.appendChild(info);

    var tabs = document.createElement('div');
    tabs.className = 'formation-tabs';
    body.appendChild(tabs);

    var actionsRow = document.createElement('div');
    actionsRow.className = 'formation-actions';
    body.appendChild(actionsRow);

    var pitchWrap = document.createElement('div');
    body.appendChild(pitchWrap);

    var confirmBtn = U.makeButton('btn btn-primary', 'Confirmar formación', function () {
      GS.confirmFormation(state);
      refreshAfterChange(app);
      U.closeSheet();
    });

    function renderTabs() {
      tabs.innerHTML = '';
      Object.keys(global.FORMATIONS).forEach(function (name) {
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'formation-tab' + (state.formationName === name ? ' active' : '');
        tab.textContent = name;
        tab.addEventListener('click', function () {
          GS.setFormation(state, name);
          renderTabs();
          renderPitch();
        });
        tabs.appendChild(tab);
      });
    }

    function autoFill() {
      var formation = global.FORMATIONS[state.formationName];
      var squad = GS.getSquad(state).slice();
      var usedIds = {};
      formation.slots.forEach(function (slot) {
        if (state.slots[slot.id]) usedIds[state.slots[slot.id].id] = true;
      });
      formation.slots.forEach(function (slot) {
        if (state.slots[slot.id]) return;
        var candidates = squad
          .filter(function (p) { return !usedIds[p.id]; })
          .map(function (p) { return { p: p, fit: GL.posFitMultiplier(p.pos, slot.type) }; })
          .sort(function (a, b) { return (b.fit * b.p.rating) - (a.fit * a.p.rating); });
        if (candidates.length) {
          state.slots[slot.id] = candidates[0].p;
          usedIds[candidates[0].p.id] = true;
        }
      });
      renderPitch();
    }

    function renderPitch() {
      pitchWrap.innerHTML = '';
      var pitch = document.createElement('div');
      pitch.className = 'pitch';
      pitch.appendChild(elDiv('pitch-line-center'));
      pitch.appendChild(elDiv('pitch-circle-center'));
      pitch.appendChild(elDiv('pitch-box-top'));
      pitch.appendChild(elDiv('pitch-box-bottom'));

      var formation = global.FORMATIONS[state.formationName];
      formation.slots.forEach(function (slot) {
        var player = state.slots[slot.id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pitch-slot' + (player ? ' filled' : '');
        btn.style.left = slot.x + '%';
        btn.style.top = slot.y + '%';
        var circle = document.createElement('div');
        circle.className = 'pitch-slot-circle';
        if (player) circle.style.background = lineColor(player.pos);
        circle.textContent = player ? String(player.rating) : slot.type;
        var lbl = document.createElement('div');
        lbl.className = 'pitch-slot-label';
        lbl.textContent = player ? player.shortName : '';
        btn.appendChild(circle);
        btn.appendChild(lbl);
        btn.addEventListener('click', function () { openSlotPicker(app, slot, renderPitch, updateConfirm); });
        pitch.appendChild(btn);
      });
      pitchWrap.appendChild(pitch);
      updateConfirm();
    }

    function updateConfirm() {
      confirmBtn.disabled = !GS.formationComplete(state);
    }

    actionsRow.appendChild(U.makeButton('btn', 'Auto-completar', autoFill));

    renderTabs();
    renderPitch();

    U.openSheet({
      icon: ICONS.formation, title: TITLES.formation, body: body,
      footerButtons: [U.makeButton('btn btn-ghost', 'Cerrar', U.closeSheet), confirmBtn]
    });
  }

  function elDiv(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function lineColor(pos) {
    var line = GL.posLine(pos);
    if (line === 'GK') return 'var(--gk)';
    if (line === 'DEF') return 'var(--def)';
    if (line === 'FWD') return 'var(--fwd)';
    return 'var(--mid)';
  }

  function openSlotPicker(app, slot, onAssigned, onUpdate) {
    var state = app.state;
    var squad = GS.getSquad(state);
    var slottedElsewhere = {};
    Object.keys(state.slots).forEach(function (sid) {
      if (sid !== slot.id && state.slots[sid]) slottedElsewhere[state.slots[sid].id] = true;
    });

    var body = document.createElement('div');
    var current = state.slots[slot.id];
    if (current) {
      body.appendChild(U.makeButton('btn btn-danger btn-block', 'Quitar ' + current.name, function () {
        GS.clearSlot(state, slot.id);
        U.closePicker();
        onAssigned();
        onUpdate();
      }));
    }

    var candidates = squad
      .filter(function (p) { return !slottedElsewhere[p.id]; })
      .map(function (p) { return { p: p, fit: GL.posFitMultiplier(p.pos, slot.type) }; })
      .sort(function (a, b) { return b.fit - a.fit || b.p.rating - a.p.rating; });

    if (!candidates.length) {
      var none = document.createElement('div');
      none.className = 'no-results';
      none.textContent = 'No hay jugadores disponibles en el plantel.';
      body.appendChild(none);
    }

    candidates.forEach(function (c) {
      var penaltyNote = c.fit < 1 ? ' · fuera de posición (' + Math.round(c.fit * 100) + '%)' : '';
      var row = U.buildPlayerRow(c.p, {
        metaExtra: (penaltyNote ? 'Ajustado' : null),
        onClick: function () {
          GS.assignSlot(state, slot.id, c.p);
          U.closePicker();
          onAssigned();
          onUpdate();
        }
      });
      body.appendChild(row);
    });

    U.openPicker(slot.type + ' — elegir jugador', body);
  }

  global.Tasks = { open: open };
})(window);
