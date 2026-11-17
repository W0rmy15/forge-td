// In-process checks for v0.3/v0.4 game rules (no server needed): queued sales, send scaling, sudden-death finish rule.
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
  const sellAt = b.towers.get('2,5').sellAt;
  for (let i = 0; i < 2000; i++) { const busy = G.boardBusy(g, b); G.stepGame(room); g.events.length = 0; if (!b.towers.has('2,5')) { sold = { busyBefore: busy, creeps: b.creeps.length, waited: +(g.time - sellAt).toFixed(2) }; break; } }
  check('queued sale executes once board is clear, or after the max wait with no creep near', sold && (!sold.busyBefore || sold.waited >= S.SELL_MAX_WAIT), sold);
  check('refund paid on execution (70%)', p.gold >= gold0 + ref - 1, { gold0, now: p.gold, ref });
}
// --- send HP scaling ---
{
  const r1 = mkRoom(1), r2 = mkRoom(2);
  for (const r of [r1, r2]) { r.game.wave = 12; for (const p of r.players.values()) { p.gold = 1e5; p.income = 0; } }
  G.doSend(r1, r1.players.get(1), 'runner'); G.doSend(r2, r2.players.get(1), 'runner');
  const h1 = r1.game.boards.R.queue[0].hp, h2 = r2.game.boards.R.queue[0].hp;
  const want2 = S.sendTeamMult(2, 12);
  check('2v2 send HP = sendTeamMult(2, wave) x 1v1 send HP', Math.abs(h2 / h1 - want2) < 0.02, { h1, h2, want: want2 });
  check('runner HP = 2.1 x wave HP x ramp at wave 12', Math.abs(h1 - 2.1 * S.waveHp(12) * S.sendRamp(12)) <= 1, { h1, wave: S.waveHp(12), ramp: S.sendRamp(12) });
  check('send ramp: wave 1 = 0.26x, wave 14+ = 1x', Math.abs(S.sendRamp(1) - 0.26) < 1e-9 && S.sendRamp(13) < 1 && S.sendRamp(14) === 1 && S.sendRamp(20) === 1);
  check('bounties Runner 9 / Swarm 3 / Brute 24', S.SENDS.runner.bounty === 9 && S.SENDS.swarm.bounty === 3 && S.SENDS.brute.bounty === 24);
  check('2v2 team scale eases 2.0 (wave 1) -> 2.3 (wave 14+), 1v1 = 1', S.teamScale(1, 12) === 1 && Math.abs(S.teamScale(2, 1) - 2.0) < 1e-9 && Math.abs(S.teamScale(2, 14) - 2.3) < 1e-9 && Math.abs(S.teamScale(2, 30) - 2.3) < 1e-9);
  check(`2v2 send multiplier: x${S.SEND_TEAM2.START} to wave 6, x2.99 (2.3 x 1.3) from wave 16, 1v1 = 1`, S.sendTeamMult(1, 20) === 1 && S.sendTeamMult(2, 1) === S.SEND_TEAM2.START && S.sendTeamMult(2, 6) === S.SEND_TEAM2.START && Math.abs(S.sendTeamMult(2, 16) - 2.99) < 1e-9 && Math.abs(S.sendTeamMult(2, 30) - 2.99) < 1e-9);
  check('send HP multipliers 2.1 / 0.9 / 10.5 (QA T10)', S.SENDS.runner.hpMult === 2.1 && S.SENDS.swarm.hpMult === 0.9 && S.SENDS.brute.hpMult === 10.5);
}
// --- unlimited sends + send lane ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e5; g.wave = 5;
  let errs = 0; for (let i = 0; i < 40; i++) if (G.doSend(room, p, 'runner')) errs++;
  const q = g.boards.R.queue.filter((x) => x.from).map((x) => x.at).sort((a, b) => a - b);
  check('40 runner sends in one wave all accepted (no per-wave cap; 24 s of lane)', errs === 0 && q.length === 40, { errs, n: q.length });
  check('sends enter through the lane, spaced lane x mult apart', Math.abs(q[1] - q[0] - S.SENDS.runner.lane * S.SEND_LANE_MULT) < 1e-9, { gap: q[1] - q[0] });
}
// --- v0.4: lane limit (server protection, not a per-wave cap) ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = 5;
  let n = 0, err = null; for (let i = 0; i < 500 && !err; i++) { err = G.doSend(room, p, 'brute'); if (!err) n++; }
  const b = g.boards.R, ahead = b.sendAt - g.time, gold = p.gold;
  check('sends refused with "Lane full" once the lane is booked > 45 s ahead', /Lane full/.test(err || '') && ahead > S.LANE_MAX_AHEAD && ahead - S.SENDS.brute.lane * S.SEND_LANE_MULT <= S.LANE_MAX_AHEAD, { n, err, ahead });
  check('refused send is not charged', G.doSend(room, p, 'runner') && p.gold === gold);
  step(room, 10);
  check('lane frees up as time passes', G.doSend(room, p, 'runner') === null);
}
// --- v0.4: sudden-death multipliers are applied at spawn, not at send ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6;
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE - 1; g.boards.R.sendAt = g.time + 40; // lane booked: this send enters after sudden death starts
  G.doSend(room, p, 'runner'); const qe = g.boards.R.queue.find((x) => x.from);
  check('queued send HP has no sudden-death multiplier at send time', qe.hp === S.sendHp('runner', g.wave, 1, 0), { hp: qe.hp });
  g.wave = S.WAVE.SUDDEN_DEATH_WAVE + 1; g.time = qe.at; g.nextWave = 1e9; g.boards.R.queue = [qe];
  G.stepGame(room);
  const cr = g.boards.R.creeps.find((c) => c.from);
  const mult = Math.pow(S.WAVE.SUDDEN_DEATH_GROWTH, 2);
  check('sudden-death HP + leak multipliers applied when the creep spawns', cr && Math.abs(cr.maxHp - Math.round(qe.hp * mult)) <= 1 && cr.leak === qe.leak * S.WAVE.SUDDEN_DEATH_LEAK_MULT, cr && { hp: cr.maxHp, want: Math.round(qe.hp * mult), leak: cr.leak });
}
// --- v0.4: queued sale max wait ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e5;
  G.build(room, p, 'arrow', 10, 18); // far corner, nowhere near the path
  b.queue.push({ at: 1e9, kind: 'neutral', hp: 1, speed: 1, bounty: 1, leak: 1, radius: 0.3 });
  b.creeps.push({ id: 999, kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 0, leak: 1, radius: 0.3, v: 1, arrowMult: 1, slowResist: 0, c: 5, r: 2, nc: null, nr: null, x: 5.5, y: 2.5, slowUntil: 0, slowAmt: 0, from: null });
  g.nextWave = 1e9;
  G.sell(room, p, 10, 18);
  step(room, S.SELL_MAX_WAIT - 1);
  check('queued sale still waiting before the max wait', b.towers.has('10,18'));
  step(room, 1.5);
  check('queued sale executes after SELL_MAX_WAIT s when it reroutes nobody (board still busy)', !b.towers.has('10,18') && b.creeps.length > 0);
  // v0.5: a tower right next to a creep that is not on any route still sells after the max wait
  G.build(room, p, 'arrow', 6, 2); G.sell(room, p, 6, 2); step(room, S.SELL_MAX_WAIT + 0.5);
  check('v0.5: queued sale next to a creep sells after the max wait when no route changes', !b.towers.has('6,2'));
}
// --- v0.5: sale fallback vs routes (trickle grief) ---
{
  // a wall across row 10 with the gap at column 0; the creep stuck at (2,4) routes through the gap
  const room = mkRoom(), g = room.game, p = room.players.get(1), b = g.boards.L; p.gold = 1e6; g.nextWave = 1e9;
  for (let c = 1; c <= 10; c++) G.build(room, p, 'arrow', c, 10);
  b.queue.push({ at: 1e9, kind: 'neutral', hp: 1, speed: 1, bounty: 1, leak: 1, radius: 0.3 });
  b.creeps.push({ id: 998, kind: 'neutral', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 0, leak: 1, radius: 0.3, v: 1, arrowMult: 1, slowResist: 0, c: 2, r: 4, nc: null, nr: null, x: 2.5, y: 4.5, slowUntil: 0, slowAmt: 0, from: null });
  check('removing the wall tower at (5,10) changes the creep route', G.saleChangesRoute(b, b.towers.get('5,10')) === true);
  check('removing the far wall end (10,10) (a longer detour) changes no route', G.saleChangesRoute(b, b.towers.get('10,10')) === false);
  G.sell(room, p, 5, 10); const t0 = g.time;
  step(room, S.SELL_MAX_WAIT + 1);
  check('route-changing sale is still queued after SELL_MAX_WAIT', b.towers.has('5,10'));
  let soldAt = null; for (let i = 0; i < 20 * 15 && soldAt === null; i++) { G.stepGame(room); g.events.length = 0; if (!b.towers.has('5,10')) soldAt = g.time - t0; }
  check(`route-changing sale executes at the SELL_HARD_CAP (${S.SELL_HARD_CAP} s)`, soldAt !== null && Math.abs(soldAt - S.SELL_HARD_CAP) < 0.11, { soldAt });
}
// --- v0.5: QA trickle scenario (one runner per second forever: the board is never clear) ---
{
  const trickle = (tc, tr) => {
    const room = mkRoom(), g = room.game, d = room.players.get(1), a = room.players.get(2);
    d.gold = 1e5; a.gold = 1e6; g.boards.L.lives = 1e9; g.nextWave = 1e9;
    G.build(room, d, 'arrow', tc, tr);
    let queuedAt = null, soldAt = null;
    for (let i = 0; i < 20 * 120; i++) {
      if (i % 20 === 0) G.doSend(room, a, 'runner');
      if (i === 100) { G.sell(room, d, tc, tr); queuedAt = g.time; }
      for (const c of g.boards.L.creeps) c.hp = Math.max(c.hp, 1e6);
      G.stepGame(room); g.events.length = 0;
      if (queuedAt !== null && soldAt === null && !g.boards.L.towers.has(tc + ',' + tr)) soldAt = g.time - queuedAt;
    }
    return soldAt;
  };
  const near = trickle(4, 3), far = trickle(0, 18);
  check('trickle: tower beside the path sells within the hard cap', near !== null && near <= S.SELL_HARD_CAP + 0.1, { near });
  check('trickle: far tower sells after the max wait', far !== null && far <= S.SELL_MAX_WAIT + 0.1, { far });
}
// --- v0.4: send upgrades ---
{
  const room = mkRoom(), g = room.game, p = room.players.get(1); p.gold = 1e6; g.wave = 1;
  check('upgrade: unknown / prototype kinds rejected', ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'neutral', 'boss', '', null, 7].every((k) => G.upgradeSend(room, p, k) === 'Unknown send'));
  check('upgrade: locked before wave 8', /unlocks at wave 8/.test(G.upgradeSend(room, p, 'runner') || ''));
  g.wave = 8; const poor = room.players.get(2); poor.gold = 10;
  check('upgrade: not enough gold', G.upgradeSend(room, poor, 'runner') === 'Not enough gold' && poor.gold === 10);
  const g0 = p.gold, inc0 = p.income;
  check(`upgrade: tier 1 bought at wave 8 for ${S.SEND_UP.UP_COST[1]}x base cost`, G.upgradeSend(room, p, 'runner') === null && G.tierOf(p, 'runner') === 1 && g0 - p.gold === S.sendUpCost('runner', 0) && S.sendUpCost('runner', 0) === Math.round(35 * S.SEND_UP.UP_COST[1]));
  check('upgrade: gives a little income (cost x INCOME_PER_GOLD, carried fraction)', p.income + p.incomeFrac - inc0 > 0 && Math.abs(p.income + p.incomeFrac - inc0 - S.sendUpCost('runner', 0) * S.SEND_UP.INCOME_PER_GOLD) < 1e-9, { inc0, inc: p.income, frac: p.incomeFrac });
  check('upgrade: tier 2 locked until wave 12', /unlocks at wave 12/.test(G.upgradeSend(room, p, 'runner') || ''));
  g.wave = 16; G.upgradeSend(room, p, 'runner'); G.upgradeSend(room, p, 'runner');
  check('upgrade: max tier 3', G.tierOf(p, 'runner') === 3 && /max tier/.test(G.upgradeSend(room, p, 'runner') || ''));
  check('upgrade: tiers are per player and per kind', G.tierOf(p, 'brute') === 0 && G.tierOf(room.players.get(2), 'runner') === 0);
  check('upgrade: tier map has no prototype', Object.getPrototypeOf(p.sendTier) === null);
  p.sendTier.runner = 99; check('tierOf clamps a bad stored tier', G.tierOf(p, 'runner') === 3); p.sendTier.runner = 3;
  G.doSend(room, p, 'runner'); const q = g.boards.R.queue.filter((x) => x.from).pop();
  check('T3 runner: HP x1.85, speed x1.35, price x1.3', Math.abs(q.hp - Math.round(S.sendHp('runner', 16, 1, 0) * 1.85)) <= 2 && Math.abs(q.speed - S.SENDS.runner.speed * 1.35) < 1e-9 && S.sendSpec('runner', 3).cost === Math.round(35 * 1.3), { hp: q.hp, base: S.sendHp('runner', 16, 1, 0), speed: q.speed });
  g.wave = 16; for (let i = 0; i < 3; i++) G.upgradeSend(room, p, 'swarm');
  const before = g.boards.R.queue.length; G.doSend(room, p, 'swarm');
  check(`T3 swarm sends ${S.SEND_TRAITS.swarm.count[3]} creeps`, g.boards.R.queue.length - before === S.SEND_TRAITS.swarm.count[3]);
  for (let i = 0; i < 3; i++) G.upgradeSend(room, p, 'brute');
  G.doSend(room, p, 'brute'); const bq = g.boards.R.queue.filter((x) => x.kind === 'brute').pop();
  check('T3 brute carries armor (arrow x0.5) and slow resist 50%', bq.arrowMult === 0.5 && bq.slowResist === 0.5);
  // armor and slow resist in combat
  const b = g.boards.R, t = { type: 'arrow', owner: 2 }, cr = { hp: 100, maxHp: 100, x: 1, y: 1, arrowMult: 0.5, slowResist: 0.5, slowUntil: 0, slowAmt: 0, kind: 'brute', v: 3, bounty: 1 };
  G._damage(room, b, cr, 10, t, g); check('armor halves arrow damage', cr.hp === 95, cr.hp);
  G._damage(room, b, cr, 10, { type: 'cannon', owner: 2 }, g); check('armor does not reduce cannon damage', cr.hp === 85, cr.hp);
  G._slow(g, cr, { slow: 0.4, slowDur: 2 }); check('slow resist halves the slow', Math.abs(cr.slowAmt - 0.2) < 1e-9, cr.slowAmt);
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
