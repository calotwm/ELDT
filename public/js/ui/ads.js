// ELMANAGER ad units (Google AdSense). Ads only appear on resting screens (title, season results,
// final summary), never inside the pre-season tasks. A placement renders nothing until its slot id is set.
(function (UI) {
  'use strict';

  const h = UI.h;
  const AD_CLIENT = 'ca-pub-6547457899052307';
  // Fill with the "data-ad-slot" ids of the ad units created in the AdSense dashboard.
  const AD_SLOTS = { title: '', results: '', summary: '' };

  function adSlot(placement) {
    const slotId = AD_SLOTS[placement];
    if (!slotId) return null;
    const ins = h('ins', {
      class: 'adsbygoogle', style: { display: 'block' },
      'data-ad-client': AD_CLIENT, 'data-ad-slot': slotId,
      'data-ad-format': 'auto', 'data-full-width-responsive': 'true'
    });
    // AdSense needs the <ins> attached before push; screens mount synchronously right after building.
    setTimeout(function () {
      if (!ins.isConnected) return;
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked by an ad blocker */ }
    }, 0);
    return h('aside', { class: 'ad-box ad-' + placement, 'aria-label': 'Publicidad' },
      h('span', { class: 'ad-label', text: 'Publicidad' }), ins);
  }

  UI.adSlot = adSlot;
})(window.EMUI = window.EMUI || {});
