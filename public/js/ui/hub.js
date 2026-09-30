// ELMANAGER season hub: header, five task tiles, "Tu temporada" panel and the simulate button.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  const TASK_META = {
    preSeason: { icon: 'clipboard', name: 'Pretemporada' },
    sell: { icon: 'sell', name: 'Vender' },
    loan: { icon: 'loan', name: 'Préstamo' },
    sign: { icon: 'sign', name: 'Fichar' },
    formation: { icon: 'formation', name: 'Formación' }
  };

  function decisionSummary(ev) {
    if (!ev.done) return ev.title;
    const r = ev.result;
    if (ev.type === 'sponsor') return r.success ? 'Sponsor: ' + r.name + ' (+' + EM.Util.formatMoney(r.fee) + ')' : 'Sin sponsor esta temporada';
    if (ev.type === 'coach') return 'DT: ' + r.name;
    if (ev.type === 'academy') return 'Inferiores: ' + r.name;
    return 'Estadio: ' + r.name;
  }

  function taskSummary(key, ts) {
    if (key === 'preSeason') return decisionSummary(ts.decision);
    if (key === 'sell') return ts.counts.sold ? ts.counts.sold + (ts.counts.sold === 1 ? ' vendido' : ' vendidos') : 'Hasta ' + EM.Market.SELL_LIMIT + ' jugadores';
    if (key === 'loan') return ts.counts.loaned ? ts.counts.loaned + ' a préstamo' : 'Hasta ' + EM.Market.LOAN_LIMIT + ' jugadores';
    if (key === 'sign') return ts.counts.signed ? ts.counts.signed + (ts.counts.signed === 1 ? ' fichaje' : ' fichajes') : 'Mercado de pases';
    return ts.tasks.formation.done ? 'Formación ' + ts.formation : 'Sin definir';
  }

  function tile(key, ts, idx, app) {
    const st = ts.tasks[key];
    const meta = TASK_META[key];
    const stateText = st.done ? 'Listo' : (st.unlocked ? 'Pendiente' : 'Bloqueado');
    return h('button', {
      type: 'button', class: 'tile' + (st.done ? ' is-done' : '') + (ts.current === key ? ' is-current' : '') + (!st.unlocked ? ' is-locked' : ''),
      data: { task: key }, style: { '--i': idx }, disabled: !st.unlocked,
      title: st.unlocked ? null : 'Completá la tarea anterior', onclick: function () { app.openTask(key); }
    },
      h('span', { class: 'tile-num', text: String(idx + 1) }),
      h('span', { class: 'badge' + (st.done ? ' badge-ok' : ''), text: stateText }),
      h('span', { class: 'tile-ico' }, UI.icon(st.done ? 'check' : (st.unlocked ? meta.icon : 'lock'))),
      h('span', { class: 'tile-name', text: meta.name }),
      h('span', { class: 'tile-sub', text: taskSummary(key, ts) }));
  }

  function stat(icon, value, label, warn) {
    return h('div', { class: 'hub-stat' + (warn ? ' is-warn' : '') },
      h('span', { class: 'hs-ico' }, UI.icon(icon)),
      h('span', { class: 'hs-val', text: String(value) }),
      h('span', { class: 'hs-lab', text: label }));
  }

  function listLine(label, names) {
    return names && names.length ? h('p', { class: 'note-line' }, h('strong', { text: label + ' ' }), names.join(', ')) : null;
  }

  function seasonPanel(info) {
    const comps = h('ul', { class: 'comp-list' });
    info.competitions.forEach(function (c) {
      comps.appendChild(h('li', null,
        UI.icon('trophy'),
        h('span', { class: 'cl-name', text: c.name }),
        c.phase2 ? h('span', { class: 'badge badge-sky', text: 'Fase 2' }) : null));
    });
    const notes = [];
    if (info.competitions.some(function (c) { return c.phase2; })) {
      notes.push(h('p', { class: 'note-line', text: 'Clasificaste sexto: arrancás la Libertadores en la Fase 2 (repechaje a dos partidos).' }));
    }
    const last = info.last;
    const lastBox = last ? h('div', { class: 'panel-sub' },
      h('h4', { text: 'Temporada ' + last.year }),
      h('p', { class: 'note-line', text: last.annualPos + '° en la tabla anual · Apertura: ' + last.apertura + ' · Clausura: ' + last.clausura }),
      h('p', { class: 'note-line', text: 'Copa Argentina: ' + last.copaArgentina + (last.continental ? ' · ' + last.continental.name + ': ' + last.continental.stage : '') }),
      last.titles.length ? h('p', { class: 'note-line gold', text: 'Títulos: ' + last.titles.join(', ') }) : null) : null;

    const b = info.breakdown;
    const money = b ? h('div', { class: 'panel-sub' },
      h('h4', { text: 'Presupuesto ' + b.year }),
      h('dl', { class: 'money-list' },
        h('div', null, h('dt', { text: 'Saldo anterior' }), h('dd', { text: EM.Util.formatMoney(b.leftover) })),
        h('div', null, h('dt', { text: 'Ingresos base' }), h('dd', { text: '+ ' + EM.Util.formatMoney(b.base) })),
        h('div', null, h('dt', { text: 'Premios' }), h('dd', { text: '+ ' + EM.Util.formatMoney(b.prizes) })),
        h('div', { class: 'total' }, h('dt', { text: 'Total' }), h('dd', { text: EM.Util.formatMoney(b.total) })))) : null;

    const r = info.rollover;
    const roll = r && (r.retired.length || r.youth.length || r.loansBack.length) ? h('div', { class: 'panel-sub' },
      h('h4', { text: 'Novedades del plantel' }),
      listLine('Se retiraron:', r.retired), listLine('Suben de las inferiores:', r.youth), listLine('Vuelven de préstamo:', r.loansBack)) : null;

    return h('aside', { class: 'panel season-panel' },
      h('h3', { class: 'panel-title', text: 'Tu temporada' }),
      comps, notes, lastBox, money, roll);
  }

  function simHint(ts) {
    if (ts.canSimulate) return 'Todo listo. ¡Suerte esta temporada!';
    if (ts.squadSize < EM.Market.MIN_SQUAD) return 'Necesitás al menos ' + EM.Market.MIN_SQUAD + ' jugadores en el plantel.';
    return 'Completá las 5 tareas para simular la temporada.';
  }

  // app: { game, toTitle(), openTask(key), simulate() }. opts.animate plays the entrance animation.
  UI.renderHub = function (app, opts) {
    const game = app.game;
    const career = game.career;
    const club = EM.Career.userClub(game);
    const ts = EM.Career.taskState(game);
    const info = EM.Career.seasonInfo(game);
    const diff = EM.Career.difficultyOf(career.difficulty);
    UI.applyClubTheme(club);

    const sim = UI.btn('SIMULAR TEMPORADA', { kind: 'primary', block: true, cls: 'btn-xl', icon: 'ball', disabled: !ts.canSimulate, onClick: app.simulate });

    const header = h('header', { class: 'panel hub-head' },
      h('div', { class: 'hub-top' },
        h('div', { class: 'hub-club' },
          UI.crest(club, 'crest-lg'),
          h('div', { class: 'hub-id' },
            h('h2', { class: 'hub-club-name', text: club.name }),
            h('p', { class: 'hub-dt', text: 'DT ' + career.directorName }))),
        h('div', { class: 'hub-season' },
          h('span', { class: 'badge badge-lime', text: 'Temporada ' + info.year + ' · ' + info.index + '/' + info.total }),
          h('span', { class: 'badge', title: UI.difficultyText(diff), text: 'Dificultad ' + diff.label }),
          UI.btn('Inicio', { kind: 'ghost', cls: 'btn-sm', icon: 'home', onClick: app.toTitle }))),
      h('div', { class: 'hub-stats' },
        stat('wallet', EM.Util.formatMoney(career.budget), 'Presupuesto'),
        stat('users', ts.squadSize, 'Plantel', ts.squadSize < EM.Market.MIN_SQUAD),
        stat('check', ts.doneCount + '/' + ts.total, 'Tareas')));

    const tiles = h('div', { class: 'task-grid' }, ts.order.map(function (k, i) { return tile(k, ts, i, app); }));

    UI.mount(h('section', { class: 'hub' + (opts && opts.animate ? ' hub-anim' : ''), 'aria-label': 'Panel de temporada' },
      header,
      h('div', { class: 'hub-grid' },
        h('div', { class: 'hub-main' },
          h('h3', { class: 'section-title', text: 'Pretemporada' }),
          tiles,
          h('div', { class: 'sim-bar' }, sim, h('p', { class: 'sim-hint', text: simHint(ts) }))),
        seasonPanel(info))), { keepScroll: !(opts && opts.animate) });
  };
})(window.EMUI = window.EMUI || {});
