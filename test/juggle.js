// v0.5 regression (adapted from QA's v0.4 juggle2.js): a fallback-aware sell/rebuild juggler on a 2-gap wall.
// Route-changing sales now wait for SELL_HARD_CAP, so juggling must gain (almost) nothing. Usage: node test/juggle.js
// Juggler: keep a sale queued on the closed gap Y right after each flip; when it fires, immediately close the other gap.
const S = require('../public/shared.js');
const G = require('../game.js');
function setup(gapRow) {
  const room = { code: 'J', players: new Map(), phase: 'game' };
  room.players.set(1, { id: 1, team: 'L', name: 'J', kills: 0, sent: 0 });
  room.players.set(2, { id: 2, team: 'R', name: 'X', kills: 0, sent: 0 });
  G.createGame(room); const p = room.players.get(1); p.gold = 100000; room.game.boards.L.lives = 1e9;
  for (let c = 1; c <= 9; c++) if (G.build(room, p, 'arrow', c, gapRow)) throw 'wall';
  G.build(room, p, 'arrow', 0, gapRow);
  return { room, p, b: room.game.boards.L };
}
function run(juggle, { wave = 15, big = false, maxT = 400, extraArrows = 0 } = {}) {
  const R = 10; const { room, p, b } = setup(R); const g = room.game; g.wave = wave - 1; g.nextWave = 0.01;
  // optional extra damage: arrows along row 12/13 below the wall
  for (let i = 0; i < extraArrows; i++) G.build(room, p, 'arrow', 1 + (i % 9), 13 + Math.floor(i / 9) * 2);
  const gaps = { A: [0, R], B: [10, R] }; let closed = 'A', flips = 0, gold = 0, queued = false, firstSpawn = null, leaks = 0, kills = 0;
  while (g.time < maxT) {
    if (g.wave >= wave) g.nextWave = 1e9;
    if (juggle && b.creeps.length) {
      const Y = gaps[closed];
      if (!queued) { const t = b.towers.get(Y[0] + ',' + Y[1]); if (t && t.sellAt === null && !G.sell(room, p, Y[0], Y[1])) queued = true; }
      else if (!b.towers.has(Y[0] + ',' + Y[1])) { // sale fired: close the other gap
        const Xk = closed === 'A' ? 'B' : 'A', X = gaps[Xk];
        if (!G.build(room, p, 'arrow', X[0], X[1])) { closed = Xk; queued = false; flips++; gold -= S.TOWERS.arrow.cost * (1 - S.SELL_REFUND); }
      }
    }
    if (big) for (const c of b.creeps) if (!c._big) { c._big = 1; c.hp = c.maxHp = 1e9; }
    const before = b.lives, pk = p.kills;
    G.stepGame(room); g.events.length = 0;
    leaks += before - b.lives;
    if (firstSpawn === null && b.creeps.length) firstSpawn = g.time;
    if (g.wave >= wave && !b.creeps.length && !b.queue.length && firstSpawn !== null) break;
  }
  return { juggle, flips, goldCost: Math.round(-gold), onBoardSec: +(g.time - firstSpawn).toFixed(1), leaks, kills: p.kills, left: b.creeps.length };
}
let fails = 0;
for (const w of [10, 15, 18]) for (const ex of [0, 9]) {
  const a = run(false, { wave: w, extraArrows: ex }), j = run(true, { wave: w, extraArrows: ex });
  const ok = j.flips <= 2 && j.leaks >= a.leaks - 1;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  wave ${w} +${ex} arrows | no juggle leaks ${a.leaks} | juggle flips ${j.flips} (${j.goldCost}g) leaks ${j.leaks}`);
}
const im = run(true, { big: true, maxT: 300 });
if (im.flips > 3) fails++;
console.log(`${im.flips > 3 ? 'FAIL' : 'PASS'}  immortal creeps 300 s: ${im.flips} flips`);
console.log(fails ? `JUGGLE TESTS: ${fails} FAILED` : 'JUGGLE TESTS: ALL PASS');
process.exit(fails ? 1 : 0);
