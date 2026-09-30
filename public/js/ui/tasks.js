// ELMANAGER task sheets: pretemporada, vender, préstamo and fichar (the formation sheet lives in pitch.js).
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;
  const money = UI.money;

  // Re-renders a list keeping the scroll position and the focused row.
  function keepView(scrollEl, render, focusId) {
    const top = scrollEl.scrollTop;
    render();
    scrollEl.scrollTop = top;
    if (focusId) {
      const n = scrollEl.querySelector('[data-id="' + focusId + '"]');
      if (n) n.focus({ preventScroll: true });
    }
  }

  function sheetClose(app, key) { return function () { app.afterTask(key); }; }

  // ---- pretemporada ---------------------------------------------------------------------------------------------
  const DECISION_TEXT = {
    coach: 'Definí quién dirige al equipo esta temporada. Afecta el nivel del plantel.',
    academy: 'Invertí en las divisiones inferiores: suma nivel al plantel y mejora a los juveniles que suben.',
    stadium: 'Decidí si encarar obras en el estadio esta pretemporada.'
  };

  function decisionDetail(ev, opt) {
    if (ev.type === 'sponsor') return 'Aporta ' + money(opt.fee) + ' al presupuesto si acepta.';
    const parts = [];
    if (opt.incumbent) parts.push('DT actual');
    if (opt.cost) parts.push('Costo ' + money(opt.cost));
    if (opt.strengthMod) parts.push((opt.strengthMod > 0 ? '+' : '') + opt.strengthMod + ' de nivel');
    return parts.join(' · ') || 'Sin costo ni efecto';
  }

  function openDecision(app) {
    const game = app.game;
    const ev = game.career.decisionEvent;
    let picked = null;
    const handle = UI.openModal({ title: 'Pretemporada · ' + ev.title, icon: 'clipboard', body: null, onClose: sheetClose(app, 'preSeason') });

    function resultText() {
      const r = ev.result;
      if (ev.type === 'sponsor') return r.success ? 'Listo: ' + r.name + ' aporta ' + money(r.fee) + '.' : 'Listo: esta temporada no hay sponsor de camiseta.';
      return 'Listo: ' + r.name + '.';
    }

    function render() {
      const body = h('div');
      if (ev.done) {
        body.appendChild(h('p', { class: 'info-bar good', text: resultText() }));
        handle.setBody(body);
        handle.setFooter([UI.btn('Cerrar', { block: true, onClick: handle.close })]);
        return;
      }
      if (ev.type === 'sponsor') {
        const pips = h('span', { class: 'pips', 'aria-hidden': 'true' });
        for (let i = 0; i < EM.Career.SPONSOR_ATTEMPTS; i++) pips.appendChild(h('i', { class: 'pip' + (i >= ev.attemptsLeft ? ' used' : '') }));
        body.appendChild(h('div', { class: 'attempts' }, h('span', { text: 'Intentos: ' + ev.attemptsLeft }), pips));
        body.appendChild(h('p', { class: 'info-bar', text: 'Elegí un sponsor y presioná "Negociar". Si rechaza la oferta perdés un intento.' }));
      } else {
        body.appendChild(h('p', { class: 'info-bar', text: DECISION_TEXT[ev.type] }));
      }
      const cards = h('div', { class: 'choice-grid' });
      ev.options.forEach(function (opt) {
        const poor = ev.type !== 'sponsor' && opt.cost > game.career.budget + 1e-9;
        const top = [h('span', { class: 'cc-name', text: opt.name })];
        if (ev.type === 'sponsor') top.push(h('span', { class: 'prob ' + (opt.prob >= 60 ? 'hi' : (opt.prob >= 40 ? 'mid' : 'lo')), text: opt.prob + '%' }));
        cards.appendChild(h('button', {
          type: 'button', class: 'choice' + (picked === opt.id ? ' is-selected' : ''), disabled: poor, 'aria-pressed': String(picked === opt.id),
          onclick: function () { picked = opt.id; render(); }
        }, h('span', { class: 'cc-top' }, top), h('span', { class: 'cc-detail', text: poor ? 'No alcanza el presupuesto' : decisionDetail(ev, opt) })));
      });
      body.appendChild(cards);
      handle.setBody(body);
      handle.setFooter([
        UI.btn('Cancelar', { kind: 'ghost', onClick: handle.close }),
        UI.btn(ev.type === 'sponsor' ? 'Negociar' : 'Confirmar', { kind: 'primary', icon: 'arrow', disabled: !picked, onClick: confirm })
      ]);
    }

    function confirm() {
      if (!picked) return;
      const r = EM.Career.chooseDecision(game, picked);
      if (!r.ok) { UI.toast(r.message); return; }
      app.commit();
      if (r.kind === 'sponsor') {
        UI.toast(r.success ? r.name + ' aceptó el acuerdo: +' + money(r.fee) : r.name + ' rechazó la propuesta.');
        if (r.done) { handle.close(); return; }
        picked = null;
        render();
        return;
      }
      UI.toast(r.name + ' confirmado.');
      handle.close();
    }

    render();
  }

  // ---- vender / préstamo --------------------------------------------------------------------------------------------
  function groupByLine(players) {
    return EM.Positions.LINE_ORDER.map(function (line) {
      return {
        line: line,
        players: players.filter(function (p) { return EM.Positions.line(p.pos) === line; }).sort(function (a, b) { return b.rating - a.rating; })
      };
    }).filter(function (g) { return g.players.length; });
  }

  // cfg: { key, title, icon, limit, candidates, selected, info(selection) -> string, confirm(ids) -> result, confirmLabel, done(result) -> toast }
  function openPicker(app, cfg) {
    const game = app.game;
    const chosen = {};
    cfg.selected.forEach(function (id) { chosen[id] = true; });
    const info = h('p', { class: 'info-bar' });
    const list = h('div', { class: 'list' });
    const handle = UI.openModal({ title: cfg.title, icon: cfg.icon, body: [info, list], onClose: sheetClose(app, cfg.key) });
    const scrollEl = handle.body;

    function count() { return Object.keys(chosen).length; }

    function paint() {
      const players = cfg.candidates(game);
      const byId = {};
      players.forEach(function (p) { byId[p.id] = p; });
      info.textContent = cfg.info(Object.keys(chosen).map(function (id) { return byId[id]; }).filter(Boolean));
      UI.clear(list);
      groupByLine(players).forEach(function (g) {
        list.appendChild(h('h4', { class: 'list-group', text: EM.Positions.LINE_NAMES[g.line] }));
        g.players.forEach(function (p) {
          const on = !!chosen[p.id];
          const row = UI.playerRow(p, {
            selected: on, showCheck: true, disabled: !on && count() >= cfg.limit,
            onClick: function () {
              if (on) delete chosen[p.id]; else chosen[p.id] = true;
              keepView(scrollEl, paint, p.id);
            }
          });
          row.dataset.id = p.id;
          list.appendChild(row);
        });
      });
    }

    handle.setFooter([
      UI.btn('Cancelar', { kind: 'ghost', onClick: handle.close }),
      UI.btn(cfg.confirmLabel, {
        kind: 'primary', icon: 'check',
        onClick: function () {
          const r = cfg.confirm(game, Object.keys(chosen));
          if (!r.ok) { UI.toast(r.message); return; }
          app.commit();
          UI.toast(cfg.done(r));
          handle.close();
        }
      })
    ]);
    paint();
  }

  function openSell(app) {
    openPicker(app, {
      key: 'sell', title: 'Vender jugadores', icon: 'sell', limit: EM.Market.SELL_LIMIT, confirmLabel: 'Confirmar ventas',
      candidates: EM.Career.sellCandidates, selected: Object.keys(app.game.career.pre.sales),
      info: function (sel) {
        const total = sel.reduce(function (n, p) { return n + p.value; }, 0);
        return 'Podés vender hasta ' + EM.Market.SELL_LIMIT + ' jugadores a su valor de mercado; se van a otro club de la Liga. Seleccionados: ' +
          sel.length + '/' + EM.Market.SELL_LIMIT + ' · Ingreso: ' + money(total) + '.';
      },
      confirm: EM.Career.sellPlayers,
      done: function (r) { return r.count ? r.count + (r.count === 1 ? ' jugador vendido.' : ' jugadores vendidos.') : 'Sin ventas.'; }
    });
  }

  function openLoan(app) {
    openPicker(app, {
      key: 'loan', title: 'Préstamos', icon: 'loan', limit: EM.Market.LOAN_LIMIT, confirmLabel: 'Confirmar préstamos',
      candidates: EM.Career.loanCandidates, selected: Object.keys(app.game.career.pre.loans),
      info: function (sel) {
        return 'Es opcional. Prestás hasta ' + EM.Market.LOAN_LIMIT + ' jugadores por la temporada y vuelven en la próxima pretemporada. Seleccionados: ' +
          sel.length + '/' + EM.Market.LOAN_LIMIT + '.';
      },
      confirm: EM.Career.loanPlayers,
      done: function (r) { return r.count ? r.count + (r.count === 1 ? ' jugador a préstamo.' : ' jugadores a préstamo.') : 'Sin préstamos.'; }
    });
  }

  // ---- fichar -------------------------------------------------------------------------------------------------------------
  const REGION_LABELS = [
    ['', 'Todos'], ['ARG', 'Liga Profesional'], ['Brasil', 'Brasil'], ['Uruguay', 'Uruguay'], ['Paraguay', 'Paraguay'],
    ['Colombia', 'Colombia'], ['Chile', 'Chile'], ['Europa', 'Europa'], ['América', 'América']
  ];
  const POS_FILTERS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST', 'CF'];
  const filters = { q: '', region: '', pos: '' };

  function chipRow(label, options, current, onPick) {
    const row = h('div', { class: 'chip-row', role: 'group', 'aria-label': label });
    options.forEach(function (o) {
      row.appendChild(h('button', {
        type: 'button', class: 'chip' + (current === o[0] ? ' is-active' : ''), title: o[2] || null, 'aria-pressed': String(current === o[0]),
        onclick: function () { onPick(o[0]); }
      }, o[1]));
    });
    return row;
  }

  function openSign(app) {
    const game = app.game;
    const career = game.career;
    const budgetChip = h('div', { class: 'budget-chip' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Buscar jugador o club...', autocomplete: 'off', value: filters.q, 'aria-label': 'Buscar jugador o club' });
    const regionRow = h('div');
    const posRow = h('div');
    const head = h('div', { class: 'market-head', 'aria-hidden': 'true' },
      h('span', { text: 'Jugador' }), h('span', { text: 'Club' }), h('span', { text: 'Pos.' }), h('span', { text: 'Val.' }), h('span', { text: 'Precio' }), h('span'));
    const list = h('div', { class: 'list market' });
    const signedBox = h('div', { class: 'signed-box' });
    const handle = UI.openModal({
      title: 'Mercado de pases', icon: 'sign', size: 'lg', onClose: sheetClose(app, 'sign'),
      body: [budgetChip, search, regionRow, posRow, head, list, signedBox]
    });
    const scrollEl = handle.body;

    function paintFilters() {
      UI.clear(regionRow);
      regionRow.appendChild(chipRow('Región', REGION_LABELS, filters.region, function (v) { filters.region = v; paintFilters(); paintList(); }));
      UI.clear(posRow);
      posRow.appendChild(chipRow('Posición', [['', 'Todas']].concat(POS_FILTERS.map(function (p) {
        return [p, EM.Positions.META[p].short, EM.Positions.META[p].name];
      })), filters.pos, function (v) { filters.pos = v; paintFilters(); paintList(); }));
    }

    function paintBudget() {
      const size = EM.Career.userClub(game).players.length;
      UI.clear(budgetChip);
      budgetChip.appendChild(h('span', null, 'Presupuesto disponible ', h('strong', { text: money(career.budget) })));
      budgetChip.appendChild(h('span', { class: size >= EM.Market.MAX_SQUAD ? 'warn' : '', text: 'Plantel ' + size + '/' + EM.Market.MAX_SQUAD }));
    }

    function regionLabel(item) {
      const r = REGION_LABELS.filter(function (x) { return x[0] === item.region; })[0];
      return item.club.shortName + (item.region === 'ARG' ? '' : ' · ' + (item.club.league || (r ? r[1] : item.region)));
    }

    function sign(item) {
      const r = EM.Career.signPlayer(game, item.player.id);
      if (!r.ok) { UI.toast(r.message); return; }
      app.commit();
      keepView(scrollEl, function () { paintBudget(); paintList(); paintSigned(); });
    }

    function paintList() {
      UI.clear(list);
      const res = EM.Career.search(game, { q: filters.q.trim(), region: filters.region, pos: filters.pos });
      const full = EM.Career.userClub(game).players.length >= EM.Market.MAX_SQUAD;
      if (!res.items.length) { list.appendChild(h('p', { class: 'empty', text: 'No se encontraron jugadores.' })); return; }
      res.items.forEach(function (item) {
        const row = UI.playerRow(item.player, {
          extra: regionLabel(item), club: regionLabel(item), price: item.price, disabled: full || item.price > career.budget + 1e-9,
          note: item.player.nat === 'ba' && item.region !== 'ARG' ? 'Vuelve' : null, onClick: function () { sign(item); }
        });
        row.dataset.id = item.player.id;
        list.appendChild(row);
      });
      if (res.total > res.items.length) {
        list.appendChild(h('p', { class: 'empty', text: 'Mostrando ' + res.items.length + ' de ' + res.total + ' — filtrá para ver más.' }));
      }
    }

    function paintSigned() {
      UI.clear(signedBox);
      const signed = EM.Career.signedPlayers(game);
      if (!signed.length) return;
      signedBox.appendChild(h('h4', { class: 'list-group', text: 'Fichados (' + signed.length + ') · tocá para deshacer' }));
      signed.forEach(function (s) {
        signedBox.appendChild(UI.playerRow(s.player, {
          selected: true, showCheck: true, price: s.price, extra: s.from ? 'Desde ' + s.from.shortName : null,
          onClick: function () {
            const r = EM.Career.unsignPlayer(game, s.player.id);
            if (!r.ok) { UI.toast(r.message); return; }
            app.commit();
            keepView(scrollEl, function () { paintBudget(); paintList(); paintSigned(); });
          }
        }));
      });
    }

    search.addEventListener('input', function () { filters.q = search.value; paintList(); });
    handle.setFooter([
      UI.btn('Cerrar', { kind: 'ghost', onClick: handle.close }),
      UI.btn('Confirmar fichajes', {
        kind: 'primary', icon: 'check',
        onClick: function () {
          const r = EM.Career.confirmSigning(game);
          if (!r.ok) { UI.toast(r.message); return; }
          app.commit();
          UI.toast('Mercado cerrado.');
          handle.close();
        }
      })
    ]);
    paintBudget();
    paintFilters();
    paintList();
    paintSigned();
  }

  UI.openTask = function (app, key) {
    const open = { preSeason: openDecision, sell: openSell, loan: openLoan, sign: openSign, formation: UI.openFormation }[key];
    if (open) open(app);
  };
})(window.EMUI = window.EMUI || {});
