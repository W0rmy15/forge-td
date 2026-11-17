// In-process checks for v0.3 game rules (no server needed): queued sales, send scaling, sudden-death finish rule.
// Usage: node test/sim.js
const S = require('../public/shared.js');
const G = require('../game.js');
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); if (!ok) fails++; };
function mkRoom(n = 1) {
  const room = { code: 'T', players: new Map(), phase: 'game' };
  let id = 1;
  for (const team of ['L', 'R']) for (let i = 0; i < n; i++) { room.players.set(id, { id, team, name: team + id, kills: 0, sent: 0 }); id++; }
  G.createGame(room); return room;
}
const step = (room, sec) => { for (let i = 0; i < sec / G.DT && room.phase === 'game'; i++) { G.stepGame(room); room.game.events.length = 0; } };

// --- queued sales ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L;
  p.gold = 10000;
  check('build arrow', G.build(room, p, 'arrow', 2, 5) === null);
  check('board idle before wave 1 -> sale is immediate', G.sell(room, p, 2, 5) === null && !b.towers.has('2,5'));
  G.build(room, p, 'arrow', 2, 5); G.build(room, p, 'arrow', 3, 5);
  step(room, 21); // wave 1 spawning
  check('board busy during wave', G.boardBusy(g, b) === true, { creeps: b.creeps.length, queued: b.queue.length });
  const gold0 = p.gold;
  check('sell on busy board queues (tower stays)', G.sell(room, p, 2, 5) === null && b.towers.has('2,5') && b.towers.get('2,5').sellAt !== null);
  check('no refund while queued', p.gold === gold0);
  check('queued tower cannot be upgraded', /queued for sale/.test(G.upgrade(room, p, 2, 5) || ''));
  const t = b.towers.get('2,5'); const cd0 = t.cd; let fired = false;
  for (let i = 0; i < 100 && b.towers.has('2,5'); i++) { G.stepGame(room); if (room.game.events.some((e) => e.k === 'shot' && e.x1 === 2.5 && e.y1 === 5.5)) fired = true; room.game.events.length = 0; }
  check('queued tower keeps firing', fired);
  check('sell again cancels the queued sale', G.sell(room, p, 2, 5) === null && b.towers.get('2,5').sellAt === null);
  G.sell(room, p, 2, 5);
  let sold = null; const ref = Math.floor(S.towerSpent('arrow', 0) * S.SELL_REFUND);
  for (let i = 0; i < 2000; i++) { const busy = G.boardBusy(g, b); G.stepGame(room); g.events.length = 0; if (!b.towers.has('2,5')) { sold = { busyBefore: busy, creeps: b.creeps.length }; break; } }
  check('queued sale executes once board is clear (no creeps, no spawn due)', sold && sold.creeps === 0, sold);
  check('refund paid on execution (70%)', p.gold >= gold0 + ref - 1, { gold0, now: p.gold, ref });
}
// --- send HP scaling ---
{
  const r1 = mkRoom(1), r2 = mkRoom(2);
  for (const r of [r1, r2]) { r.game.wave = 12; for (const p of r.players.values()) { p.gold = 1e5; p.income = 0; } }
  G.doSend(r1, r1.players.get(1), 'runner'); G.doSend(r2, r2.players.get(1), 'runner');
  const h1 = r1.game.boards.R.queue[0].hp, h2 = r2.game.boards.R.queue[0].hp;
  check('2v2 send HP = 2x 1v1 send HP', Math.abs(h2 / h1 - 2) < 0.02, { h1, h2 });
  check('runner HP = 1.8 x wave HP x ramp at wave 12', Math.abs(h1 - 1.8 * S.waveHp(12) * S.sendRamp(12)) <= 1, { h1, wave: S.waveHp(12), ramp: S.sendRamp(12) });
  check('send ramp: wave 1 = 0.26x, wave 14+ = 1x', Math.abs(S.sendRamp(1) - 0.26) < 1e-9 && S.sendRamp(13) < 1 && S.sendRamp(14) === 1 && S.sendRamp(20) === 1);
  check('bounties Runner 9 / Swarm 3 / Brute 18', S.SENDS.runner.bounty === 9 && S.SENDS.swarm.bounty === 3 && S.SENDS.brute.bounty === 18);
  check('2v2 waves x2 HP', S.teamScale(2) === 2 && S.teamScale(1) === 1);
}
// --- unlimited sends + send lane ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e5; g.wave = 5;
  let errs = 0; for (let i = 0; i < 40; i++) if (G.doSend(room, p, 'runner')) errs++;
  const q = g.boards.R.queue.filter((x) => x.from).map((x) => x.at).sort((a, b) => a - b);
  check('40 sends in one wave all accepted (no per-wave cap)', errs === 0 && q.length === 40, { errs, n: q.length });
  check('sends enter through the lane, spaced lane x mult apart', Math.abs(q[1] - q[0] - S.SENDS.runner.lane * S.SEND_LANE_MULT) < 1e-9, { gap: q[1] - q[0] });
}
// --- sudden death finish rule ---
{
  const room = mkRoom(), g = room.game;
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE - 1; g.nextWave = 0.01; G.stepGame(room);
  check('sudden death starts at wave ' + S.WAVE.SUDDEN_DEATH_WAVE, g.suddenDeath && g.wave === S.WAVE.SUDDEN_DEATH_WAVE && g.events.some((e) => e.k === 'sudden'));
  g.events.length = 0;
  // L falls first but R will leak more in the same wave
  g.boards.L.lives = 1; g.boards.L.rawLives = 1; g.boards.R.lives = 3; g.boards.R.rawLives = 3;
  const mk = (b, n) => { for (let i = 0; i < n; i++) b.creeps.push({ id: 900 + i + (b === g.boards.R ? 100 : 0), kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 50, bounty: 0, leak: 1, radius: 0.2, c: 5, r: 18, nc: null, nr: null, x: 5.5, y: 18.5, slowUntil: 0, slowAmt: 0 }); };
  g.boards.L.queue = []; g.boards.R.queue = [];
  mk(g.boards.L, 2); G.stepGame(room);
  check('base falling in sudden death does not end the game at once', room.phase === 'game' && g.finishing && g.finishing.fell === 'L', g.finishing);
  const p = room.players.get(1); p.gold = 1e5;
  check('no sends while the final wave is played out', /Final wave/.test(G.doSend(room, p, 'runner') || ''));
  mk(g.boards.R, 6);
  let n = 0; while (room.phase === 'game' && n++ < 400) { G.stepGame(room); g.events.length = 0; }
  check('game ends when the wave is finished', room.phase === 'over', { n });
  check('side that lost fewer total lives wins even though its base fell first', g.winner === 'L', { winner: g.winner, reason: g.winReason, raw: [g.boards.L.rawLives, g.boards.R.rawLives] });
}
{
  const room = mkRoom(), g = room.game;
  g.wave = 5; g.boards.L.lives = 0; g.boards.L.rawLives = 0; G.stepGame(room);
  check('outside sudden death a fallen base loses immediately', room.phase === 'over' && g.winner === 'R');
}
{
  const room = mkRoom(), g = room.game;
  g.suddenDeath = true; g.wave = 23; g.boards.L.queue = []; g.boards.R.queue = [];
  g.boards.L.lives = 0; g.boards.L.rawLives = -2; g.boards.R.lives = 0; g.boards.R.rawLives = -2;
  G.stepGame(room); G.stepGame(room);
  check('identical lives lost and kills -> draw', room.phase === 'over' && g.winner === 'draw', { w: g.winner, r: g.winReason });
}
console.log(fails ? `SIM TESTS: ${fails} FAILED` : 'SIM TESTS: ALL PASS');
process.exit(fails ? 1 : 0);
