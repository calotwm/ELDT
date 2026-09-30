// Shared DOM helpers: bottom-sheet framework, toasts, player-row rendering.
(function (global) {
  'use strict';

  var GameLogic = global.GameLogic;
  var POS_META = global.POS_META;

  function $(id) { return document.getElementById(id); }

  function crestSrc(club) { return 'img/crests/' + club.id + '.png'; }
  function flagSrc(nat) { return 'img/flags/' + nat + '.png'; }

  function hideOnError(img) {
    img.addEventListener('error', function () {
      img.hidden = true;
    });
  }

  // ---- toast ---------------------------------------------------------------
  var toastTimer = null;
  function showToast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---- generic bottom sheet --------------------------------------------------
  var sheetOverlay = null;
  var lastFocused = null;

  function initSheets() {
    sheetOverlay = $('sheet-overlay');
    $('sheet-backdrop').addEventListener('click', closeSheet);
    $('sheet-close').addEventListener('click', closeSheet);
    $('picker-backdrop').addEventListener('click', closePicker);
    $('picker-close').addEventListener('click', closePicker);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('picker-overlay').classList.contains('hidden')) { closePicker(); return; }
      if (!sheetOverlay.classList.contains('hidden')) closeSheet();
    });
  }

  var onSheetClose = null;

  function openSheet(opts) {
    lastFocused = document.activeElement;
    $('sheet-icon').textContent = opts.icon || '⚽';
    $('sheet-title').textContent = opts.title || '';
    $('sheet-body').innerHTML = '';
    if (opts.body) $('sheet-body').appendChild(opts.body);
    $('sheet-footer').innerHTML = '';
    (opts.footerButtons || []).forEach(function (btn) { $('sheet-footer').appendChild(btn); });
    onSheetClose = opts.onClose || null;
    sheetOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('sheet-close').focus();
  }

  function closeSheet() {
    sheetOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    if (onSheetClose) { var cb = onSheetClose; onSheetClose = null; cb(); }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openPicker(title, bodyEl) {
    $('picker-title').textContent = title;
    var body = $('picker-body');
    body.innerHTML = '';
    body.appendChild(bodyEl);
    $('picker-overlay').classList.remove('hidden');
    $('picker-close').focus();
  }

  function closePicker() {
    $('picker-overlay').classList.add('hidden');
  }

  // ---- reusable row builders --------------------------------------------------
  function posChip(pos) {
    var meta = POS_META[pos] || { line: 'MID', label: pos };
    var span = document.createElement('span');
    span.className = 'pos-chip line-' + meta.line;
    span.textContent = meta.label;
    return span;
  }

  function ratingBadge(rating) {
    var span = document.createElement('span');
    span.className = 'rating-badge';
    span.textContent = rating;
    return span;
  }

  function flagImg(nat) {
    var img = document.createElement('img');
    img.className = 'player-flag';
    img.src = flagSrc(nat);
    img.alt = '';
    hideOnError(img);
    return img;
  }

  // Builds a clickable player row: flag, name, age, position chip, rating, value.
  function buildPlayerRow(player, opts) {
    opts = opts || {};
    var row = document.createElement('div');
    row.className = 'player-row' + (opts.selected ? ' selected' : '') + (opts.disabled ? ' disabled' : '');
    row.setAttribute('role', 'button');
    row.tabIndex = opts.disabled ? -1 : 0;

    row.appendChild(flagImg(player.nat));

    var main = document.createElement('div');
    main.className = 'player-main';
    var name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = player.name;
    var meta = document.createElement('div');
    meta.className = 'player-meta';
    meta.textContent = (opts.metaExtra ? opts.metaExtra + ' · ' : '') + player.age + ' años';
    main.appendChild(name);
    main.appendChild(meta);
    row.appendChild(main);

    var right = document.createElement('div');
    right.className = 'player-right';
    right.appendChild(posChip(player.pos));
    right.appendChild(ratingBadge(player.rating));
    var val = document.createElement('span');
    val.className = 'player-value';
    val.textContent = GameLogic.formatMoney(opts.priceOverride != null ? opts.priceOverride : player.value);
    right.appendChild(val);
    if (opts.showCheck) {
      var check = document.createElement('span');
      check.className = 'check-icon';
      check.textContent = opts.selected ? '✓' : '';
      right.appendChild(check);
    }
    row.appendChild(right);

    if (opts.onClick && !opts.disabled) {
      row.addEventListener('click', opts.onClick);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(); }
      });
    }
    return row;
  }

  function makeButton(cls, text, onClick) {
    var btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = text;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  global.UICommon = {
    $: $,
    crestSrc: crestSrc,
    flagSrc: flagSrc,
    hideOnError: hideOnError,
    showToast: showToast,
    initSheets: initSheets,
    openSheet: openSheet,
    closeSheet: closeSheet,
    openPicker: openPicker,
    closePicker: closePicker,
    posChip: posChip,
    ratingBadge: ratingBadge,
    flagImg: flagImg,
    buildPlayerRow: buildPlayerRow,
    makeButton: makeButton
  };
})(window);
