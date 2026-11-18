// Forge TD - pure game simulation (no networking). Used by server.js (via ../game.js) and by the tests.
// The tick loop lives here; rules live in the sibling modules (see ARCHITECTURE.md).
const S = require('../public/shared.js');
const C = require('./core.js');
const { DT, addGold } = C;
const W = require('./waves.js');
const SE = require('./sends.js');
const T = require('./towers.js');
const CR = require('./creeps.js');

function createGame(room) {
  room.game = {
    time: 0, boards: { L: C.newBoard('L'), R: C.newBoard('R') }, nextIncome: S.INCOME_EVERY, nextWave: S.FIRST_WAVE, wave: 0,
    events: [], winner: null, winReason: null, nextCreepId: 1, nextTowerId: 1, teamSize: C.teamSizeOf(room), suddenDeath: false,
    finishing: null, // { wave, fell: 'L'|'R'|'both' } once a base falls in sudden death: the current wave is played out, then lives lost decide
  };
  for (const p of room.players.values()) { p.gold = S.START_GOLD; p.income = S.START_INCOME; p.sent = 0; p.kills = 0; p.ready = false; p.sendIncome = 0; p.incomeFrac = 0; p.sendTier = SE.freshTiers(); }
}

// one board, one tick: spawn, queued sales, movement, then towers fire
function stepBoard(room, team) {
  const g = room.game, b = g.boards[team];
  W.spawnDue(g, b);
  T.processSales(room, b);
  CR.moveCreeps(g, b);
  T.fireTowers(room, b);
  W.flushBorn(b); // Splitter shards born this tick
}

function teamKills(room, team) { let k = 0; for (const p of room.players.values()) if (p.team === team) k += p.kills; return k; }

// advances one tick; returns true if the game ended during this step
function stepGame(room) {
  const g = room.game;
  g.time += DT;
  g.nextIncome -= DT;
  if (g.nextIncome <= 0) {
    g.nextIncome += S.INCOME_EVERY;
    for (const p of room.players.values()) addGold(p, p.income);
    g.events.push({ k: 'income' });
  }
  g.nextWave -= DT;
  if (g.nextWave <= 0 && !g.finishing) { g.nextWave += S.WAVE_EVERY; W.queueWave(room); }
  stepBoard(room, 'L');
  stepBoard(room, 'R');
  for (const p of room.players.values()) {
    if (!Number.isFinite(p.gold) || !Number.isFinite(p.income)) throw new Error(`non-finite economy for player ${p.id}`);
  }
  const L = g.boards.L, R = g.boards.R;
  if (g.finishing) {
    // sudden death: play out the wave in which a base fell (no new wave starts), then compare lives lost
    const clear = !L.creeps.length && !R.creeps.length && !L.queue.length && !R.queue.length;
    if (clear || g.nextWave <= DT / 2) { decide(room, 'Sudden death: '); return true; }
    return false;
  }
  if (L.lives <= 0 || R.lives <= 0) {
    const fell = L.lives <= 0 && R.lives <= 0 ? 'both' : L.lives <= 0 ? 'L' : 'R';
    if (g.suddenDeath) {
      g.finishing = { wave: g.wave, fell };
      g.events.push({ k: 'finishing', fell, wave: g.wave });
      return false;
    }
    if (fell === 'both') decide(room, 'Tiebreak: ');
    else g.winner = fell === 'L' ? 'R' : 'L';
    room.phase = 'over';
    return true;
  }
  return false;
}

// winner by total lives lost (overkill counts: rawLives goes below 0), then kills, else draw
function decide(room, prefix) {
  const g = room.game, L = g.boards.L, R = g.boards.R;
  if (L.rawLives !== R.rawLives) { g.winner = L.rawLives > R.rawLives ? 'L' : 'R'; g.winReason = `${prefix}fewer lives lost (${S.LIVES - L.rawLives} vs ${S.LIVES - R.rawLives})`; }
  else {
    const kl = teamKills(room, 'L'), kr = teamKills(room, 'R');
    if (kl !== kr) { g.winner = kl > kr ? 'L' : 'R'; g.winReason = `${prefix}equal lives lost, more kills (${kl} vs ${kr})`; }
    else { g.winner = 'draw'; g.winReason = `${prefix}equal lives lost and kills`; }
  }
  room.phase = 'over';
}


module.exports = {
  TICK: C.TICK, DT, key: C.key, other: C.other, createGame, stepGame, build: T.build, upgrade: T.upgrade, sell: T.sell,
  doSend: SE.doSend, upgradeSend: SE.upgradeSend, tierOf: SE.tierOf, canBuild: C.canBuild, teamSizeOf: C.teamSizeOf,
  addGold, addIncome: C.addIncome, boardBusy: T.boardBusy, saleChangesRoute: T.saleChangesRoute, _damage: T.damage, _slow: T.slow,
};
