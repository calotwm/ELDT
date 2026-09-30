// Game state container and mutators. No DOM access; depends on window.LEAGUE_DATA
// and window.GameLogic only, so it stays testable headlessly.
(function (global) {
  'use strict';

  var GameLogic = global.GameLogic;

  function findClub(clubId) {
    return global.LEAGUE_DATA.clubs.find(function (c) { return c.id === clubId; });
  }

  function createInitialState() {
    return {
      clubId: null,
      directorName: '',
      season: '2027',
      budget: 0,
      spent: 0,
      strengthMod: 0,
      preSeason: { done: false, eventType: null, choiceId: null, summary: '' },
      sponsorAttemptsLeft: GameLogic.SPONSOR_ATTEMPTS,
      sponsorLocked: false,
      soldIds: [],
      loanedIds: [],
      signedPlayers: [], // full player objects with an added originClubId
      formationName: '4-3-3',
      slots: {}, // slotId -> player object
      tasks: { preSeason: false, sell: false, loan: false, sign: false, formation: false },
      simulated: null
    };
  }

  var TASK_ORDER = ['preSeason', 'sell', 'loan', 'sign', 'formation'];

  function getClub(state) {
    return findClub(state.clubId);
  }

  function getBaseSquad(state) {
    var club = getClub(state);
    return club ? club.players : [];
  }

  // Current squad = base club squad minus sold/loaned, plus signed players.
  function getSquad(state) {
    var base = getBaseSquad(state).filter(function (p) {
      return state.soldIds.indexOf(p.id) === -1 && state.loanedIds.indexOf(p.id) === -1;
    });
    return base.concat(state.signedPlayers);
  }

  function squadSize(state) {
    return getSquad(state).length;
  }

  function completedTaskCount(state) {
    return TASK_ORDER.reduce(function (n, t) { return n + (state.tasks[t] ? 1 : 0); }, 0);
  }

  function isTaskUnlocked(state, taskKey) {
    var idx = TASK_ORDER.indexOf(taskKey);
    if (idx <= 0) return true;
    return state.tasks[TASK_ORDER[idx - 1]];
  }

  function canSimulate(state) {
    return completedTaskCount(state) === 5 &&
      formationComplete(state) &&
      squadSize(state) >= GameLogic.MIN_SQUAD_TO_SIMULATE;
  }

  function remainingBudget(state) {
    return Math.max(0, state.budget - state.spent);
  }

  // ---- mutators -------------------------------------------------------------
  function selectClub(state, clubId, directorName, budget) {
    state.clubId = clubId;
    state.directorName = directorName;
    state.budget = budget;
    state.spent = 0;
  }

  function applyPreSeasonChoice(state, event, option) {
    state.strengthMod += option.strengthMod || 0;
    if (option.cost) state.spent += option.cost;
    if (event.type === 'sponsor') {
      state.preSeason.summary = 'Sponsor: ' + option.name;
    } else if (event.type === 'coach') {
      state.preSeason.summary = 'DT: ' + option.name;
    } else {
      state.preSeason.summary = option.name;
    }
    state.preSeason.done = true;
    state.preSeason.eventType = event.type;
    state.preSeason.choiceId = option.id;
    state.tasks.preSeason = true;
  }

  function sponsorSuccess(state, fee) {
    state.spent -= fee; // fee reduces spend, i.e. adds to available budget
    state.preSeason.summary = 'Sponsor conseguido (+' + fee + 'M)';
    state.preSeason.done = true;
    state.tasks.preSeason = true;
    state.sponsorLocked = true;
  }

  function sponsorExhausted(state) {
    state.preSeason.summary = 'Sin sponsor esta temporada';
    state.preSeason.done = true;
    state.tasks.preSeason = true;
    state.sponsorLocked = true;
  }

  function unslotPlayer(state, playerId) {
    Object.keys(state.slots).forEach(function (slotId) {
      if (state.slots[slotId] && state.slots[slotId].id === playerId) {
        delete state.slots[slotId];
        state.tasks.formation = false;
      }
    });
  }

  function setSoldPlayers(state, ids) {
    var base = getBaseSquad(state);
    var newlySold = base.filter(function (p) { return ids.indexOf(p.id) !== -1 && state.soldIds.indexOf(p.id) === -1; });
    var unsold = base.filter(function (p) { return ids.indexOf(p.id) === -1 && state.soldIds.indexOf(p.id) !== -1; });
    // Undoing a sale returns the player, so it must fit the budget and the squad cap.
    var spentDelta = sumValues(unsold) - sumValues(newlySold);
    if (state.spent + spentDelta > state.budget) return 'budget';
    if (squadSize(state) + unsold.length - newlySold.length > GameLogic.MAX_SQUAD_SIZE) return 'squad';
    newlySold.forEach(function (p) { state.spent -= p.value; unslotPlayer(state, p.id); });
    unsold.forEach(function (p) { state.spent += p.value; });
    state.soldIds = ids.slice();
    state.tasks.sell = true;
    invalidateFormationIfNeeded(state);
    return 'ok';
  }

  function sumValues(players) {
    return players.reduce(function (sum, p) { return sum + p.value; }, 0);
  }

  function setLoanedPlayers(state, ids) {
    var returning = state.loanedIds.filter(function (id) { return ids.indexOf(id) === -1; }).length;
    var leaving = ids.filter(function (id) { return state.loanedIds.indexOf(id) === -1; }).length;
    if (squadSize(state) + returning - leaving > GameLogic.MAX_SQUAD_SIZE) return 'squad';
    state.loanedIds = ids.slice();
    ids.forEach(function (id) { unslotPlayer(state, id); });
    state.tasks.loan = true;
    invalidateFormationIfNeeded(state);
    return 'ok';
  }

  function signPlayer(state, player, sellerClub) {
    var price = GameLogic.buyPriceForPlayer(player, sellerClub);
    if (price > remainingBudget(state)) return false;
    if (squadSize(state) >= GameLogic.MAX_SQUAD_SIZE) return false;
    var copy = Object.assign({}, player, { originClubId: sellerClub.id, boughtPrice: price });
    state.signedPlayers.push(copy);
    state.spent += price;
    return true;
  }

  function unsignPlayer(state, playerId) {
    var idx = state.signedPlayers.findIndex(function (p) { return p.id === playerId; });
    if (idx === -1) return;
    var p = state.signedPlayers[idx];
    state.spent -= p.boughtPrice;
    state.signedPlayers.splice(idx, 1);
    unslotPlayer(state, playerId);
  }

  function markSignDone(state) {
    state.tasks.sign = true;
    invalidateFormationIfNeeded(state);
  }

  function invalidateFormationIfNeeded(state) {
    if (state.tasks.formation) state.tasks.formation = false;
  }

  function setFormation(state, name) {
    if (state.formationName !== name) {
      state.formationName = name;
      state.slots = {};
      state.tasks.formation = false;
    }
  }

  function assignSlot(state, slotId, player) {
    // remove player from any other slot first
    unslotPlayer(state, player.id);
    state.slots[slotId] = player;
  }

  function clearSlot(state, slotId) {
    delete state.slots[slotId];
  }

  function formationComplete(state) {
    var formation = global.FORMATIONS[state.formationName];
    return formation.slots.every(function (s) { return !!state.slots[s.id]; });
  }

  function confirmFormation(state) {
    state.tasks.formation = true;
  }

  global.GameState = {
    TASK_ORDER: TASK_ORDER,
    createInitialState: createInitialState,
    findClub: findClub,
    getClub: getClub,
    getBaseSquad: getBaseSquad,
    getSquad: getSquad,
    squadSize: squadSize,
    completedTaskCount: completedTaskCount,
    isTaskUnlocked: isTaskUnlocked,
    canSimulate: canSimulate,
    remainingBudget: remainingBudget,
    selectClub: selectClub,
    applyPreSeasonChoice: applyPreSeasonChoice,
    sponsorSuccess: sponsorSuccess,
    sponsorExhausted: sponsorExhausted,
    setSoldPlayers: setSoldPlayers,
    setLoanedPlayers: setLoanedPlayers,
    signPlayer: signPlayer,
    unsignPlayer: unsignPlayer,
    markSignDone: markSignDone,
    setFormation: setFormation,
    assignSlot: assignSlot,
    clearSlot: clearSlot,
    formationComplete: formationComplete,
    confirmFormation: confirmFormation
  };
})(typeof window !== 'undefined' ? window : this);
