// Forge TD - game simulation entry point (kept so server.js and the tests can keep requiring ./game.js).
// The code lives in game/: see ARCHITECTURE.md for which file owns which rule.
module.exports = require('./game/index.js');
