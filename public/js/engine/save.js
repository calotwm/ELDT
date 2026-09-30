// ELMANAGER engine: save / load through localStorage (single slot).
// Games are plain JSON and players are owned by their club, so a JSON round trip is lossless.
(function (EM) {
  'use strict';

  const KEY = 'elmanager.save.v2';

  // localStorage can be missing (Node, private mode) or throw on access.
  function store() {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch (e) {
      return null;
    }
  }

  function save(game) {
    const s = store();
    if (!s) return false;
    try {
      s.setItem(KEY, JSON.stringify(game));
      return true;
    } catch (e) {
      return false;
    }
  }

  function valid(game) {
    return !!game && game.version === EM.Career.VERSION && !!game.career && !!game.world && !!game.season;
  }

  function load() {
    const s = store();
    if (!s) return null;
    try {
      const raw = s.getItem(KEY);
      if (!raw) return null;
      const game = JSON.parse(raw);
      return valid(game) ? game : null;
    } catch (e) {
      return null;
    }
  }

  function exists() {
    const s = store();
    try {
      return !!s && s.getItem(KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    const s = store();
    if (!s) return false;
    try {
      s.removeItem(KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  EM.Save = { KEY: KEY, save: save, load: load, exists: exists, clear: clear };
})(window.EM = window.EM || {});
