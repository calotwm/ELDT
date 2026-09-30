// ELMANAGER formation sheet: vertical pitch (goalkeeper at the bottom), formation tabs, slot picker.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const h = UI.h;

  // Markings in real proportions on a 68 x 105 pitch (FIFA standard areas).
  const PITCH_SVG = '<svg viewBox="0 0 68 105" class="pitch-lines" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="currentColor" stroke-width=".35">' +
    '<rect x="1.5" y="1.5" width="65" height="102"/><line x1="1.5" y1="52.5" x2="66.5" y2="52.5"/>' +
    '<circle cx="34" cy="52.5" r="9.15"/>' +
    '<rect x="13.85" y="1.5" width="40.3" height="16.5"/><rect x="24.85" y="1.5" width="18.3" height="5.5"/>' +
    '<rect x="13.85" y="87" width="40.3" height="16.5"/><rect x="24.85" y="98" width="18.3" height="5.5"/>' +
    '<path d="M27.09 18A9.15 9.15 0 0 0 40.91 18M27.09 87A9.15 9.15 0 0 1 40.91 87"/>' +
    '<path d="M1.5 2.5A1 1 0 0 0 2.5 1.5M65.5 1.5A1 1 0 0 0 66.5 2.5M1.5 102.5A1 1 0 0 0 2.5 103.5M66.5 102.5A1 1 0 0 0 65.5 103.5"/>' +
    '</g><g fill="currentColor"><circle cx="34" cy="52.5" r=".6"/><circle cx="34" cy="12" r=".5"/><circle cx="34" cy="93" r=".5"/></g></svg>';

  function slotName(type) { return UI.posName(type); }

  function playerById(club, id) {
    return club.players.filter(function (p) { return p.id === id; })[0] || null;
  }

  // ---- slot picker (second modal) --------------------------------------------------------------------------------
  function openSlotPicker(app, slot, onDone, onClose) {
    const game = app.game;
    const club = EM.Career.userClub(game);
    const lineup = game.career.lineup;
    const inXI = {};
    Object.keys(lineup.slots).forEach(function (k) { inXI[lineup.slots[k]] = k; });
    const current = playerById(club, lineup.slots[slot.id]);
    const body = h('div');

    const handle = UI.openModal({ title: 'Elegir: ' + slotName(slot.type), icon: 'users', body: body, onClose: onClose });

    function pick(fn) {
      const r = fn();
      if (!r.ok) { UI.toast(r.message); return; }
      app.commit();
      handle.close();
      onDone(slot.id);
    }

    if (current) {
      body.appendChild(UI.btn('Quitar a ' + current.name, {
        kind: 'danger', block: true, cls: 'picker-remove', onClick: function () { pick(function () { return EM.Career.clearSlot(game, slot.id); }); }
      }));
    }
    const ranked = club.players.map(function (p) { return { p: p, fit: EM.Positions.fit(p.pos, slot.type) }; })
      .sort(function (a, b) { return (b.fit - a.fit) || (b.p.rating - a.p.rating); });
    if (!ranked.length) body.appendChild(h('p', { class: 'empty', text: 'No hay jugadores disponibles en el plantel.' }));
    const list = h('div', { class: 'list' });
    ranked.forEach(function (c) {
      const notes = [];
      if (c.fit < 1) notes.push('Fuera de puesto (' + Math.round(c.fit * 100) + '%)');
      if (inXI[c.p.id] && inXI[c.p.id] !== slot.id) notes.push('Ya es titular');
      list.appendChild(UI.playerRow(c.p, {
        selected: c.p.id === lineup.slots[slot.id], note: notes.join(' · ') || null,
        onClick: function () { pick(function () { return EM.Career.assignSlot(game, slot.id, c.p.id); }); }
      }));
    });
    body.appendChild(list);
  }

  // ---- formation sheet -----------------------------------------------------------------------------------------------
  UI.openFormation = function (app) {
    const game = app.game;
    const career = game.career;
    const club = EM.Career.userClub(game);

    const tabs = h('div', { class: 'chip-row formation-tabs', role: 'group', 'aria-label': 'Formación' });
    const level = h('p', { class: 'info-bar' });
    const pitchBox = h('div', { class: 'pitch-box' });
    const confirmBtn = UI.btn('Confirmar formación', { kind: 'primary', icon: 'check', onClick: confirm });
    const side = h('div', { class: 'fl-side' },
      h('p', { class: 'info-bar fl-hint', text: 'Elegí una formación y tocá cada posición para asignar un jugador.' }),
      tabs,
      h('div', { class: 'fl-actions' },
        UI.btn('Autocompletar', { icon: 'star', onClick: function () { run(EM.Career.autoFill(game)); } }),
        UI.btn('Limpiar', { kind: 'ghost', onClick: clearAll })),
      level);
    const handle = UI.openModal({
      title: 'Formación', icon: 'formation', size: 'lg', onClose: function () { app.afterTask('formation'); },
      body: h('div', { class: 'formation-layout' }, side, pitchBox),
      footer: [UI.btn('Cerrar', { kind: 'ghost', onClick: function () { handle.close(); } }), confirmBtn]
    });

    function run(r, focusSlot) {
      if (!r.ok) { UI.toast(r.message); return; }
      app.commit();
      paint(focusSlot);
    }

    function clearAll() {
      Object.keys(career.lineup.slots).forEach(function (id) { EM.Career.clearSlot(game, id); });
      app.commit();
      paint();
    }

    function confirm() {
      const r = EM.Career.confirmFormation(game);
      if (!r.ok) { UI.toast(r.message); return; }
      app.commit();
      UI.toast('Formación ' + career.lineup.formation + ' confirmada.');
      handle.close();
    }

    function paintTabs() {
      UI.clear(tabs);
      EM.Positions.FORMATION_NAMES.forEach(function (name) {
        const on = career.lineup.formation === name;
        tabs.appendChild(h('button', {
          type: 'button', class: 'chip' + (on ? ' is-active' : ''), 'aria-pressed': String(on),
          onclick: function () { if (!on) run(EM.Career.setFormation(game, name)); }
        }, name));
      });
    }

    function paintPitch(activeId) {
      UI.clear(pitchBox);
      const pitch = h('div', { class: 'pitch' });
      const lines = h('div', { class: 'pitch-art' });
      lines.innerHTML = PITCH_SVG;
      pitch.appendChild(lines);
      EM.Positions.slotsOf(career.lineup.formation).forEach(function (slot) {
        const p = playerById(club, career.lineup.slots[slot.id]);
        const label = p ? p.name + ' · ' + UI.posName(p.pos) + ' · ' + p.rating : slotName(slot.type) + ' (vacante)';
        const meta = EM.Positions.META[slot.type];
        pitch.appendChild(h('button', {
          type: 'button', class: 'slot' + (p ? ' is-filled line-' + EM.Positions.line(p.pos) : '') + (slot.id === activeId ? ' is-active' : ''),
          style: { left: slot.x + '%', top: slot.y + '%' }, data: { slot: slot.id }, title: label, 'aria-label': label + '. Tocá para cambiar.',
          onclick: function (e) {
            const btn = e.currentTarget;
            btn.classList.add('is-active');
            openSlotPicker(app, slot, function (id) { paint(id); }, function () { btn.classList.remove('is-active'); });
          }
        },
          h('span', { class: 'slot-chip', text: p ? String(p.rating) : meta.short }),
          h('span', { class: 'slot-name', text: p ? p.shortName : '' })));
      });
      pitchBox.appendChild(pitch);
    }

    function paint(focusSlot) {
      paintTabs();
      paintPitch(null);
      const complete = EM.Squad.isComplete(career, club);
      confirmBtn.disabled = !complete;
      const empty = EM.Positions.slotsOf(career.lineup.formation).filter(function (s) { return !career.lineup.slots[s.id]; }).length;
      level.textContent = complete
        ? 'Nivel del once: ' + EM.Squad.userXI(career, club).strength.toFixed(1) + (career.tasks.formation ? ' · Formación confirmada.' : ' · Falta confirmar.')
        : 'Posiciones sin jugador: ' + empty + '.';
      if (focusSlot) {
        const n = pitchBox.querySelector('[data-slot="' + focusSlot + '"]');
        if (n) n.focus({ preventScroll: true });
      }
    }

    paint();
  };
})(window.EMUI = window.EMUI || {});
