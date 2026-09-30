// ELMANAGER UI core: element builder, icons, modals, toasts, player rows, club theme.
// Every data string goes through textContent / text nodes, so nothing needs escaping by hand.
(function (UI) {
  'use strict';

  const EM = window.EM;
  const META = EM.Positions.META;

  // ---- element builder ----------------------------------------------------------------------------
  // h('div', { class: 'x', onclick: fn, style: { '--i': 2 }, data: { id: 'a' } }, 'text', childNode, [more])
  function h(tag, props) {
    const node = document.createElement(tag);
    const p = props || {};
    Object.keys(p).forEach(function (k) {
      const v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') {
        Object.keys(v).forEach(function (s) {
          if (s.indexOf('--') === 0) node.style.setProperty(s, v[s]); else node.style[s] = v[s];
        });
      } else if (k === 'data') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ---- icons (static inline SVG, never built from data) --------------------------------------------
  const ICONS = {
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
    sell: '<path d="M3.5 12.5L12 4h8v8l-8.5 8.5z"/><circle cx="16" cy="8" r="1.3"/>',
    loan: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    sign: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M18 7v6M15 10h6"/>',
    formation: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 12h16M8.5 3v3.5h7V3M8.5 21v-3.5h7V21"/><circle cx="12" cy="12" r="2.6"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5A3 3 0 0 0 8 10M16 6h3.5A3 3 0 0 1 16 10M12 13v4M8.5 20h7M10 17h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
    coffee: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 3v3M12 3v3"/>',
    ball: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.8 2.8-1.4 4.4H9.6l-1.4-4.4zM12 7.5V3.5M15.8 10.3l3.7-1.2M14.4 14.7l2.4 3.2M9.6 14.7l-2.4 3.2M8.2 10.3L4.5 9.1"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
    home: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14.5h2"/>',
    users: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4"/>',
    warn: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',
  };

  function icon(name, cls) {
    const span = h('span', { class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    span.innerHTML = '<svg viewBox="0 0 24 24" focusable="false">' + (ICONS[name] || '') + '</svg>';
    return span;
  }

  // ---- buttons -------------------------------------------------------------------------------------------
  // Skewed button; the label is counter-skewed so the text stays straight.
  function btn(label, opts) {
    const o = opts || {};
    const b = h('button', {
      type: 'button', class: 'btn' + (o.kind ? ' btn-' + o.kind : '') + (o.block ? ' btn-block' : '') + (o.cls ? ' ' + o.cls : ''),
      disabled: o.disabled, onclick: o.onClick, title: o.title, id: o.id
    }, h('span', { class: 'btn-in' }, o.icon ? icon(o.icon) : null,
      o.sub ? h('span', { class: 'btn-txt' }, h('span', { text: label }), h('small', { text: o.sub })) : h('span', { text: label })));
    return b;
  }

  function setBtnLabel(b, label) { b.querySelector('.btn-in > span:last-child').textContent = label; }

  // ---- club helpers ----------------------------------------------------------------------------------------
  function crestSrc(club) { return 'img/crests/' + club.id + '.png'; }

  function crest(club, cls) {
    const img = h('img', { class: 'crest' + (cls ? ' ' + cls : ''), src: crestSrc(club), alt: '', loading: 'lazy' });
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    return img;
  }

  function flag(nat) {
    const img = h('img', { class: 'flag', src: 'img/flags/' + nat + '.png', alt: '', loading: 'lazy' });
    img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    return img;
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [108, 196, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(rgb) {
    const c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Club color readable on the night-navy background (too dark colors are lightened).
  function clubAccent(club) {
    let rgb = hexToRgb(club && club.colors && club.colors.primary);
    for (let i = 0; i < 8 && luminance(rgb) < 0.22; i++) {
      rgb = rgb.map(function (v) { return Math.round(v + (255 - v) * 0.2); });
    }
    return rgb;
  }

  function applyClubTheme(club) {
    const rgb = clubAccent(club);
    document.documentElement.style.setProperty('--club', 'rgb(' + rgb.join(',') + ')');
    document.documentElement.style.setProperty('--club-rgb', rgb.join(','));
  }

  function resetTheme() {
    document.documentElement.style.removeProperty('--club');
    document.documentElement.style.removeProperty('--club-rgb');
  }

  // ---- player pieces -----------------------------------------------------------------------------------------
  function posName(pos) { return (META[pos] || { name: pos }).name; }

  function posChip(pos) {
    const m = META[pos] || { line: 'MID', short: pos, name: pos };
    return h('span', { class: 'pos line-' + m.line, title: m.name, text: m.short });
  }

  function ratingBadge(rating) {
    return h('span', { class: 'ovr' + (rating >= 75 ? ' tier-gold' : (rating >= 68 ? ' tier-silver' : '')), title: 'Valoración', text: String(rating) });
  }

  // Clickable player row. opts: { selected, disabled, extra, club, price, showCheck, onClick, note }
  function playerRow(player, opts) {
    const o = opts || {};
    const row = h('button', {
      type: 'button', class: 'prow' + (o.selected ? ' is-selected' : '') + (o.disabled ? ' is-disabled' : ''),
      disabled: o.disabled, 'aria-pressed': o.showCheck ? String(!!o.selected) : null, onclick: o.onClick
    },
      h('span', { class: 'pr-name' },
        flag(player.nat),
        h('span', { class: 'pr-text' },
          h('span', { class: 'pr-n', text: (player.fame ? '★ ' : '') + player.name }),
          h('span', { class: 'pr-m' },
            o.extra ? h('span', { class: o.club ? 'x-club' : null, text: o.extra + ' · ' }) : null,
            [player.age + ' años', o.note].filter(Boolean).join(' · ')))),
      o.club ? h('span', { class: 'pr-club', text: o.club }) : h('span', { class: 'pr-club' }),
      h('span', { class: 'pr-pos' }, posChip(player.pos)),
      h('span', { class: 'pr-ovr' }, ratingBadge(player.rating)),
      h('span', { class: 'pr-price', text: EM.Util.formatMoney(o.price != null ? o.price : player.value) }),
      o.showCheck ? h('span', { class: 'pr-check' }, o.selected ? icon('check') : null) : null);
    return row;
  }

  // ---- modals (sheet on mobile, centered on desktop) ----------------------------------------------------------
  const stack = [];
  let scrollLock = 0;

  function modalRoot() { return document.getElementById('modal-root'); }

  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll('button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(function (n) { return n.offsetParent !== null; });
  }

  // opts: { title, icon, body, footer: [nodes], size: 'md'|'lg', onClose }
  function openModal(opts) {
    const opener = document.activeElement;
    const titleId = 'modal-title-' + (stack.length + 1);
    const bodyEl = h('div', { class: 'sheet-body' }, opts.body);
    const footEl = h('div', { class: 'sheet-foot' }, opts.footer || []);
    const closeBtn = h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Cerrar' }, icon('close'));
    const sheet = h('div', { class: 'sheet' + (opts.size === 'lg' ? ' sheet-lg' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'sheet-grab' }),
      h('header', { class: 'sheet-head' },
        opts.icon ? h('span', { class: 'sheet-ico' }, icon(opts.icon)) : null,
        h('h2', { id: titleId, class: 'sheet-title', text: opts.title }),
        closeBtn),
      bodyEl, footEl);
    const backdrop = h('div', { class: 'backdrop' });
    const overlay = h('div', { class: 'overlay' }, backdrop, sheet);
    const handle = { el: overlay, body: bodyEl, foot: footEl, sheet: sheet, closed: false };
    handle.setBody = function (node) { clear(bodyEl); append(bodyEl, node); };
    handle.setFooter = function (nodes) { clear(footEl); append(footEl, nodes); footEl.hidden = !footEl.firstChild; };
    handle.close = function () {
      if (handle.closed) return;
      handle.closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      overlay.remove();
      scrollLock = Math.max(0, scrollLock - 1);
      if (!scrollLock) document.body.classList.remove('modal-open');
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      if (opts.onClose) opts.onClose();
    };
    footEl.hidden = !(opts.footer && opts.footer.length);
    backdrop.addEventListener('click', handle.close);
    closeBtn.addEventListener('click', handle.close);
    modalRoot().appendChild(overlay);
    stack.push(handle);
    scrollLock++;
    document.body.classList.add('modal-open');
    closeBtn.focus();
    return handle;
  }

  function closeTopModal() { if (stack.length) stack[stack.length - 1].close(); }

  document.addEventListener('keydown', function (e) {
    if (!stack.length) return;
    const top = stack[stack.length - 1];
    if (e.key === 'Escape') { e.preventDefault(); top.close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(top.sheet);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function confirmDialog(opts) {
    const m = openModal({
      title: opts.title, icon: opts.icon || 'warn',
      body: h('p', { class: 'dialog-text', text: opts.text }),
      footer: [
        btn('Cancelar', { kind: 'ghost', onClick: function () { m.close(); } }),
        btn(opts.confirmLabel || 'Aceptar', { kind: opts.danger ? 'danger' : 'primary', onClick: function () { m.close(); opts.onConfirm(); } })
      ]
    });
    return m;
  }

  // ---- toast ---------------------------------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  // ---- screens ---------------------------------------------------------------------------------------------------
  // opts.keepScroll re-renders in place (no entrance animation, scroll position kept).
  function mount(node, opts) {
    const app = document.getElementById('app');
    const keep = !!(opts && opts.keepScroll);
    const y = window.scrollY;
    clear(app);
    node.classList.add('screen');
    if (!keep) node.classList.add('screen-in');
    app.appendChild(node);
    window.scrollTo(0, keep ? y : 0);
  }

  const reduceMotion = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  UI.h = h;
  UI.clear = clear;
  UI.icon = icon;
  UI.btn = btn;
  UI.setBtnLabel = setBtnLabel;
  UI.crest = crest;
  UI.flag = flag;
  UI.clubAccent = clubAccent;
  UI.applyClubTheme = applyClubTheme;
  UI.resetTheme = resetTheme;
  UI.posName = posName;
  UI.posChip = posChip;
  UI.ratingBadge = ratingBadge;
  UI.playerRow = playerRow;
  UI.openModal = openModal;
  UI.closeTopModal = closeTopModal;
  UI.confirmDialog = confirmDialog;
  UI.toast = toast;
  UI.mount = mount;
  UI.reduceMotion = reduceMotion;
  UI.money = EM.Util.formatMoney;
})(window.EMUI = window.EMUI || {});
