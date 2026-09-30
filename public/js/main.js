// Bootstrap: wires the intro/hub/results screens together.
(function () {
  'use strict';

  var GS = window.GameState;
  var GL = window.GameLogic;
  var U = window.UICommon;

  function runSimulation(app) {
    var state = app.state;
    var formation = window.FORMATIONS[state.formationName];
    var xiEntries = GL.buildXIEntries(formation, state.slots);
    var strength = GL.computeXIStrength(xiEntries, state.strengthMod);

    var result = GL.simulateSeason(window.LEAGUE_DATA.clubs, state.clubId, strength);
    var scorer = GL.estimateTopScorer(xiEntries, result.userGoalsScored);

    window.Screens.renderResults(app, {
      table: result.table,
      userPosition: result.userPosition,
      scorer: scorer
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var app = { state: GS.createInitialState() };
    window.App = app;

    U.initSheets();
    window.Screens.initIntro(app);

    document.getElementById('simulate-btn').addEventListener('click', function () {
      if (!GS.canSimulate(app.state)) return;
      runSimulation(app);
    });
  });
})();
