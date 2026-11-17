// Forge TD - pure game simulation (no networking). Used by server.js and by test/balance.js.
const S = require('./public/shared.js');

const TICK = 50; // ms (20 Hz)
const DT = TICK / 1000;
const key = (c, r) => c + ',' + r;
const other = (t) => (t === 'L' ? 'R' : 'L');

// ---- gold / income safety: every change goes through these ----
function addGold(p, amt) {
  const v = p.gold + amt;
  if (!Number.isFinite(amt) || !Number.isFinite(v)) throw new Error(`non-finite gold change for player ${p.id}: ${p.gold} + ${amt}`);
  p.gold = Math.max(0, Math.min(S.MAX_GOLD, v));
}
function addIncome(p, amt) {
  const v = p.income + amt;
  if (!Number.isFinite(amt) || !Number.isFinite(v)) throw new Error(`non-finite income change for player ${p.id}: ${p.income} + ${amt}`);
  p.income = Math.max(0, Math.min(S.MAX_INCOME, v));
}

function teamSizeOf(room) {
  let l = 0, r = 0;
  for (const p of room.players.values()) { if (p.team === 'L') l++; else if (p.team === 'R') r++; }
  return Math.max(1, l, r);
}

function newBoard(team) {
  return { team, lives: S.LIVES, rawLives: S.LIVES, towers: new Map(), creeps: [], queue: [], sendAt: 0, dist: S.computeDist(() => false), leakFlash: 0, towerVer: 1 };
}

function createGame(room) {
  room.game = {
    time: 0, boards: { L: newBoard('L'), R: newBoard('R') }, nextIncome: S.INCOME_EVERY, nextWave: S.FIRST_WAVE, wave: 0,
    events: [], winner: null, winReason: null, nextCreepId: 1, nextTowerId: 1, teamSize: teamSizeOf(room), suddenDeath: false,
    finishing: null, // { wave, fell: 'L'|'R'|'both' } once a base falls in sudden death: the current wave is played out, then lives lost decide
  };
  for (const p of room.players.values()) { p.gold = S.START_GOLD; p.income = S.START_INCOME; p.sent = 0; p.kills = 0; p.ready = false; p.sendIncome = 0; p.incomeFrac = 0; p.sendTier = freshTiers(); }
}

// per-player send tiers; only keys of S.SENDS exist, and every lookup is guarded by S.hasSend
function freshTiers() { const o = Object.create(null); for (const k of Object.keys(S.SENDS)) o[k] = 0; return o; }
function tierOf(p, kind) { return p.sendTier && S.hasSend(kind) ? S.clampTier(p.sendTier[kind]) : 0; }

function recomputeDist(b) { b.dist = S.computeDist((c, r) => b.towers.has(key(c, r))); b.towerVer++; }

function canBuild(b, c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= S.COLS || r >= S.ROWS) return 'Out of bounds';
  if ((c === S.SPAWN.c && r === S.SPAWN.r) || (c === S.BASE.c && r === S.BASE.r)) return 'Cannot build on spawn/base';
  if (b.towers.has(key(c, r))) return 'Occupied';
  for (const cr of b.creeps) {
    if ((cr.c === c && cr.r === r) || (cr.nc === c && cr.nr === r)) return 'A creep is in the way';
  }
  const d = S.computeDist((cc, rr) => (cc === c && rr === r) || b.towers.has(key(cc, rr)));
  if (d[S.SPAWN.c + S.SPAWN.r * S.COLS] < 0) return 'That would block the path!';
  for (const cr of b.creeps) if (d[cr.c + cr.r * S.COLS] < 0) return 'That would trap a creep';
  return null;
}

// sudden-death multipliers for the wave that is current right now
function sdHpMult(g) { const W = S.WAVE; return g.wave >= W.SUDDEN_DEATH_WAVE ? Math.pow(W.SUDDEN_DEATH_GROWTH, g.wave - W.SUDDEN_DEATH_WAVE + 1) : 1; }
function sdLeakMult(g) { return g.wave >= S.WAVE.SUDDEN_DEATH_WAVE ? S.WAVE.SUDDEN_DEATH_LEAK_MULT : 1; }

function spawnCreep(g, b, spec) {
  let hp = spec.hp, leak = spec.leak;
  // sent creeps get the sudden-death multipliers of the wave in which they actually enter the board
  if (spec.from) { hp = Math.round(hp * sdHpMult(g)); leak = leak * sdLeakMult(g); }
  b.creeps.push({
    id: g.nextCreepId++, kind: spec.kind, hp, maxHp: hp, speed: spec.speed, bounty: spec.bounty, leak, radius: spec.radius,
    v: spec.v || 0, arrowMult: spec.arrowMult || 1, slowResist: spec.slowResist || 0,
    c: S.SPAWN.c, r: S.SPAWN.r, nc: null, nr: null, x: S.SPAWN.c + 0.5, y: S.SPAWN.r + 0.5, slowUntil: 0, slowAmt: 0, from: spec.from || null,
  });
}

function queueWave(room) {
  const g = room.game, W = S.WAVE;
  g.wave++;
  const n = g.wave;
  const boss = n % W.BOSS_EVERY === 0;
  const sd = n >= W.SUDDEN_DEATH_WAVE;
  if (sd && !g.suddenDeath) { g.suddenDeath = true; g.events.push({ k: 'sudden' }); }
  const sdMult = sd ? Math.pow(W.SUDDEN_DEATH_GROWTH, n - W.SUDDEN_DEATH_WAVE + 1) : 1;
  const leakMult = sd ? W.SUDDEN_DEATH_LEAK_MULT : 1;
  const hp = Math.round(S.waveHp(n) * S.teamScale(g.teamSize, n) * sdMult);
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const count = Math.min(W.COUNT_BASE + n, W.COUNT_MAX);
    for (let i = 0; i < count; i++) b.queue.push({ at: g.time + i * W.SPACING, kind: 'neutral', v: n, hp, speed: n % W.FAST_EVERY === 0 ? W.FAST_SPEED : W.SPEED, bounty: 1 + Math.floor(n / 3), leak: leakMult, radius: S.CREEP_RADIUS.neutral });
    if (boss) b.queue.push({ at: g.time + count * W.SPACING + 0.5, kind: 'boss', v: n, hp: Math.round(hp * W.BOSS_HP_MULT), speed: W.BOSS_SPEED, bounty: 10 + n * 2, leak: W.BOSS_LEAK * leakMult, radius: S.CREEP_RADIUS.boss });
  }
  g.events.push({ k: 'wave', n, boss });
}

// diminishing returns: the more income you already got from sends (and send upgrades), the less each new one adds
function sendIncomeGain(p, base) {
  const gain = base * S.SEND_INCOME_FALLOFF / (S.SEND_INCOME_FALLOFF + p.sendIncome) + p.incomeFrac;
  const whole = Math.floor(gain);
  p.incomeFrac = gain - whole; p.sendIncome += whole;
  addIncome(p, whole);
}

function doSend(room, p, kind) {
  const g = room.game;
  if (!S.hasSend(kind)) return 'Unknown send';
  if (g.finishing) return 'Final wave: no more sends';
  const base = S.SENDS[kind], tier = tierOf(p, kind), spec = S.sendSpec(kind, tier);
  if (!Number.isFinite(spec.cost) || p.gold < spec.cost) return 'Not enough gold';
  const b = g.boards[other(p.team)];
  if ((b.sendAt || 0) - g.time > S.LANE_MAX_AHEAD) return `Lane full: the enemy send lane is booked more than ${S.LANE_MAX_AHEAD}s ahead, wait a moment`;
  addGold(p, -spec.cost); p.sent++; // no per-wave cap: sends are limited only by gold
  sendIncomeGain(p, spec.income * S.sendIncomeMult(g.teamSize)); // 2v2: x SEND_TEAM2_INCOME
  const hp = S.sendHp(kind, g.wave, g.teamSize, tier); // sudden-death multipliers are applied at spawn time
  const bounty = Math.round(spec.bounty * S.sendBountyMult(g.teamSize, g.wave)); // 2v2: bounty scales with the HP multiplier
  // Send lane: sends are unlimited, but each board has one entry lane and every send occupies it for spec.lane
  // seconds, so a big banked dump trickles in over time instead of arriving all at once.
  const start = Math.max(g.time, b.sendAt || 0);
  b.sendAt = start + base.lane * S.SEND_LANE_MULT;
  for (let i = 0; i < spec.count; i++) {
    b.queue.push({ at: start + i * base.gap, kind, v: tier, hp, speed: spec.speed, bounty, leak: base.leak, radius: base.radius,
      arrowMult: spec.arrowMult, slowResist: spec.slowResist, from: p.id });
  }
  g.events.push({ k: 'send', team: p.team, kind, tier, name: p.name, id: p.id, n: p.sent });
  return null;
}

// buy the next tier of one send type (persists for this player for the match)
function upgradeSend(room, p, kind) {
  const g = room.game;
  if (!S.hasSend(kind)) return 'Unknown send';
  if (g.finishing) return 'Final wave: no more upgrades';
  if (!p.sendTier) p.sendTier = freshTiers();
  const tier = tierOf(p, kind), cost = S.sendUpCost(kind, tier);
  if (cost === null) return `${S.SENDS[kind].name} is already max tier`;
  if (g.wave < S.SEND_UP.UNLOCK_WAVE[tier + 1]) return `Tier ${tier + 1} unlocks at wave ${S.SEND_UP.UNLOCK_WAVE[tier + 1]}`;
  if (!Number.isFinite(cost) || p.gold < cost) return 'Not enough gold';
  addGold(p, -cost);
  sendIncomeGain(p, cost * S.SEND_UP.INCOME_PER_GOLD); // an upgrade is an investment too (same falloff as sends)
  p.sendTier[kind] = tier + 1;
  p.sendUpSpent = (p.sendUpSpent || 0) + cost;
  g.events.push({ k: 'sendup', team: p.team, kind, tier: tier + 1, name: p.name, id: p.id });
  return null;
}

function build(room, p, type, c, r) {
  const g = room.game, b = g.boards[p.team];
  if (!S.hasTower(type)) return 'Unknown tower';
  const err = canBuild(b, c, r);
  if (err) return err;
  const spec = S.TOWERS[type];
  if (p.gold < spec.cost) return 'Not enough gold';
  addGold(p, -spec.cost);
  b.towers.set(key(c, r), { id: g.nextTowerId++, c, r, type, lvl: 0, owner: p.id, cd: 0, sellAt: null });
  recomputeDist(b);
  return null;
}

function ownTower(room, p, c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r)) return { err: null };
  const t = room.game.boards[p.team].towers.get(key(c, r));
  if (!t) return { err: null };
  if (t.owner !== p.id) return { err: "That's your teammate's tower" };
  return { t };
}

function upgrade(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  if (t.sellAt !== null) return 'That tower is queued for sale (sell again to cancel)';
  const cost = S.upgradeCost(t.type, t.lvl);
  if (cost === null) return 'Already max level';
  if (p.gold < cost) return 'Not enough gold';
  addGold(p, -cost); t.lvl++; room.game.boards[p.team].towerVer++;
  return null;
}

function finishSell(room, b, t) {
  const owner = room.players.get(t.owner);
  if (owner) addGold(owner, Math.floor(S.towerSpent(t.type, t.lvl) * S.SELL_REFUND));
  b.towers.delete(key(t.c, t.r));
  recomputeDist(b);
}

// A board is busy while creeps are on it or a spawn is due within SELL_SPAWN_GUARD seconds.
// Sales on a busy board are queued and execute the moment it is clear, so the path can never change
// under live creeps by removing a tower (this is what stops sell/rebuild "juggling").
function boardBusy(g, b) {
  return b.creeps.length > 0 || b.queue.some((q) => q.at <= g.time + S.SELL_SPAWN_GUARD);
}

// Would removing tower t change the route of any creep on the board (or of the next spawn)?
// Routes are followed cell by cell with S.nextCell, so the route from a cell is unchanged iff every cell on it
// picks the same next cell with and without the tower. We walk the union of all current routes once.
function saleChangesRoute(b, t) {
  const tk = key(t.c, t.r);
  const nd = S.computeDist((c, r) => { const k = key(c, r); return k !== tk && b.towers.has(k); });
  const seen = new Uint8Array(S.COLS * S.ROWS);
  const starts = [[S.SPAWN.c, S.SPAWN.r]];
  for (const cr of b.creeps) starts.push(cr.nc !== null ? [cr.nc, cr.nr] : [cr.c, cr.r]);
  for (const [c0, r0] of starts) {
    let c = c0, r = r0;
    for (let guard = 0; guard < S.COLS * S.ROWS; guard++) {
      const i = c + r * S.COLS;
      if (seen[i]) break;
      seen[i] = 1;
      if (c === S.BASE.c && r === S.BASE.r) break;
      const a = S.nextCell(b.dist, c, r), n = S.nextCell(nd, c, r);
      if (!a || !n) { if (a || n) return true; break; }
      if (a.c !== n.c || a.r !== n.r) return true;
      c = a.c; r = a.r;
    }
  }
  return false;
}

// sell = sell now if the board is clear, otherwise queue the sale; selling a queued tower again cancels the sale
function sell(room, p, c, r) {
  const { t, err } = ownTower(room, p, c, r);
  if (!t) return err;
  const g = room.game, b = g.boards[p.team];
  if (t.sellAt !== null) { t.sellAt = null; b.towerVer++; return null; }
  if (boardBusy(g, b)) { t.sellAt = g.time; b.towerVer++; }
  else finishSell(room, b, t);
  return null;
}

function damage(room, b, cr, dmg, tower, g) {
  if (cr.hp <= 0) return;
  if (g.time < cr.slowUntil) dmg *= S.SLOWED_DMG_MULT;
  if (tower.type === 'arrow' && cr.arrowMult !== 1) dmg *= cr.arrowMult; // armored Brutes
  cr.hp -= dmg;
  if (cr.hp <= 0) {
    const owner = room.players.get(tower.owner);
    if (owner) { addGold(owner, cr.bounty); owner.kills++; }
    tower.kills = (tower.kills || 0) + 1;
    g.events.push({ k: 'kill', b: b.team, x: +cr.x.toFixed(2), y: +cr.y.toFixed(2), kind: cr.kind, v: cr.v, g: cr.bounty, o: tower.owner });
  }
}

function slow(g, cr, st) {
  const active = g.time < cr.slowUntil;
  const amt = st.slow * (1 - (cr.slowResist || 0));
  cr.slowAmt = active ? Math.max(amt, cr.slowAmt) : amt;
  cr.slowUntil = Math.max(cr.slowUntil, g.time + st.slowDur);
}

function stepBoard(room, team) {
  const g = room.game, b = g.boards[team];
  if (b.queue.length) {
    b.queue.sort((a, c) => a.at - c.at);
    while (b.queue.length && b.queue[0].at <= g.time) spawnCreep(g, b, b.queue.shift());
  }
  // queued sells execute as soon as the board is clear; on a busy board after SELL_MAX_WAIT s if removing the tower
  // reroutes nobody, and after SELL_HARD_CAP s no matter what (so trickle sends can't lock towers in place)
  let anySell = false; for (const t of b.towers.values()) if (t.sellAt !== null) { anySell = true; break; }
  if (anySell) {
    const busy = boardBusy(g, b);
    for (const t of [...b.towers.values()]) {
      if (t.sellAt === null) continue;
      const waited = g.time - t.sellAt + 1e-9;
      if (!busy || waited >= S.SELL_HARD_CAP || (waited >= S.SELL_MAX_WAIT && !saleChangesRoute(b, t))) finishSell(room, b, t);
    }
  }
  // move creeps
  const survivors = [];
  for (const cr of b.creeps) {
    const speed = cr.speed * (g.time < cr.slowUntil ? 1 - cr.slowAmt : 1);
    let step = speed * DT;
    let leaked = false, guard = 0;
    while (step > 0 && guard++ < 10) {
      if (cr.c === S.BASE.c && cr.r === S.BASE.r) { leaked = true; break; }
      if (cr.nc === null) {
        const n = S.nextCell(b.dist, cr.c, cr.r);
        if (!n) break;
        cr.nc = n.c; cr.nr = n.r;
      }
      const tx = cr.nc + 0.5, ty = cr.nr + 0.5;
      const dx = tx - cr.x, dy = ty - cr.y, dd = Math.hypot(dx, dy);
      if (dd <= step) { cr.x = tx; cr.y = ty; step -= dd; cr.c = cr.nc; cr.r = cr.nr; cr.nc = null; cr.nr = null; }
      else { cr.x += (dx / dd) * step; cr.y += (dy / dd) * step; step = 0; }
    }
    if (leaked) {
      b.rawLives -= cr.leak;
      b.lives = Math.max(0, b.lives - cr.leak);
      b.leakFlash = 0.5;
      g.events.push({ k: 'leak', team, n: cr.leak });
    } else survivors.push(cr);
  }
  b.creeps = survivors;
  if (b.leakFlash > 0) b.leakFlash -= DT;
  // towers fire
  for (const t of b.towers.values()) {
    t.cd -= DT; // towers queued for sale keep firing until the sale executes
    if (t.cd > 0) continue;
    const st = S.TOWERS[t.type].levels[t.lvl];
    const tx = t.c + 0.5, ty = t.r + 0.5;
    let target = null, best = Infinity;
    for (const cr of b.creeps) {
      if (cr.hp <= 0) continue;
      if (Math.hypot(cr.x - tx, cr.y - ty) > st.range) continue;
      const prog = b.dist[cr.c + cr.r * S.COLS];
      const score = (prog < 0 ? 999 : prog) - (cr.hp / cr.maxHp) * 0.01;
      if (score < best) { best = score; target = cr; }
    }
    if (!target) continue;
    t.cd = st.rate;
    g.events.push({ k: 'shot', b: team, tt: t.type, x1: +tx.toFixed(2), y1: +ty.toFixed(2), x2: +target.x.toFixed(2), y2: +target.y.toFixed(2) });
    if (t.type === 'cannon') {
      for (const cr of b.creeps) if (cr.hp > 0 && Math.hypot(cr.x - target.x, cr.y - target.y) <= st.splash) damage(room, b, cr, st.dmg, t, g);
      g.events.push({ k: 'boom', b: team, x: +target.x.toFixed(2), y: +target.y.toFixed(2), r: st.splash });
    } else if (t.type === 'frost') {
      damage(room, b, target, st.dmg, t, g);
      for (const cr of b.creeps) if (cr.hp > 0 && Math.hypot(cr.x - target.x, cr.y - target.y) <= st.area) slow(g, cr, st);
      g.events.push({ k: 'chill', b: team, x: +target.x.toFixed(2), y: +target.y.toFixed(2), r: st.area });
    } else damage(room, b, target, st.dmg, t, g);
  }
  b.creeps = b.creeps.filter((c) => c.hp > 0);
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
  if (g.nextWave <= 0 && !g.finishing) { g.nextWave += S.WAVE_EVERY; queueWave(room); }
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

module.exports = { TICK, DT, key, other, createGame, stepGame, build, upgrade, sell, doSend, upgradeSend, tierOf, canBuild, teamSizeOf, addGold, addIncome, boardBusy, saleChangesRoute, _damage: damage, _slow: slow };
