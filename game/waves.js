// Forge TD neutral waves, sudden death, and creep spawning (sends are spawned here too, from the board queue).
const S = require('../public/shared.js');

// sudden-death multipliers for the wave that is current right now
function sdHpMult(g) { const W = S.WAVE; return g.wave >= W.SUDDEN_DEATH_WAVE ? Math.pow(W.SUDDEN_DEATH_GROWTH, g.wave - W.SUDDEN_DEATH_WAVE + 1) : 1; }
function sdLeakMult(g) { return g.wave >= S.WAVE.SUDDEN_DEATH_WAVE ? S.WAVE.SUDDEN_DEATH_LEAK_MULT : 1; }

function spawnCreep(g, b, spec) {
  let hp = spec.hp, leak = spec.leak;
  // sent creeps get the sudden-death multipliers of the wave in which they actually enter the board
  if (spec.from) { hp = Math.round(hp * sdHpMult(g)); leak = leak * sdLeakMult(g); }
  b.creeps.push(makeCreep(g, spec, hp, leak, S.SPAWN.c, S.SPAWN.r, S.SPAWN.c + 0.5, S.SPAWN.r + 0.5));
}

function makeCreep(g, spec, hp, leak, c, r, x, y) {
  return {
    id: g.nextCreepId++, kind: spec.kind, hp, maxHp: hp, speed: spec.speed, bounty: spec.bounty, leak, radius: spec.radius,
    v: spec.v || 0, arrowMult: spec.arrowMult || 1, slowResist: spec.slowResist || 0, shards: spec.shards || 0,
    c, r, nc: null, nr: null, x, y, slowUntil: 0, slowAmt: 0, from: spec.from || null,
  };
}

// v0.6: a dead Splitter bursts into `parent.shards` Shards at its position, continuing its route.
// They wait on b.born and join the board after the towers have fired (a splash that killed the parent can't hit them the same tick).
function splitShards(g, b, parent) {
  const SP = S.SPLIT, n = parent.shards | 0;
  if (n <= 0) return;
  const hp = Math.max(1, Math.round(parent.maxHp * SP.SHARD_HP)), bounty = Math.max(1, Math.round(parent.bounty * SP.SHARD_BOUNTY));
  const spec = { kind: 'shard', speed: SP.SHARD_SPEED, bounty, radius: SP.SHARD_RADIUS, v: parent.v, from: parent.from };
  // the parent's leak is split across its shards (total = parent.leak), so killing a Splitter next to the base never
  // costs more lives than letting it leak: whole lives go to the first shards, any fractional rest to shard 0
  const L = parent.leak || 0, per = Math.floor(L / n), whole = Math.floor(L - per * n), frac = L - per * n - whole;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, o = 0.12, leak = per + (i < whole ? 1 : 0) + (i === 0 ? frac : 0);
    const cr = makeCreep(g, spec, hp, leak, parent.c, parent.r, parent.x + Math.cos(a) * o, parent.y + Math.sin(a) * o);
    cr.nc = parent.nc; cr.nr = parent.nr;
    (b.born || (b.born = [])).push(cr);
  }
  g.events.push({ k: 'split', b: b.team, x: +parent.x.toFixed(2), y: +parent.y.toFixed(2), n, v: parent.v });
}
function flushBorn(b) { if (b.born && b.born.length) { for (const cr of b.born) b.creeps.push(cr); b.born.length = 0; } }

function queueWave(room) {
  const g = room.game, W = S.WAVE;
  g.wave++;
  const n = g.wave;
  const boss = S.isBossWave(n), split = S.isSplitWave(n);
  const sd = n >= W.SUDDEN_DEATH_WAVE;
  if (sd && !g.suddenDeath) { g.suddenDeath = true; g.events.push({ k: 'sudden' }); }
  const sdMult = sd ? Math.pow(W.SUDDEN_DEATH_GROWTH, n - W.SUDDEN_DEATH_WAVE + 1) : 1;
  const leakMult = sd ? W.SUDDEN_DEATH_LEAK_MULT : 1;
  const hp = Math.round(S.waveHp(n) * S.teamScale(g.teamSize, n) * sdMult);
  const fast = n % W.FAST_EVERY === 0 || (sd && W.SUDDEN_DEATH_FAST);
  const bounty = 1 + Math.floor(n / W.BOUNTY_DIV);
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const count = Math.min(W.COUNT_BASE + Math.floor(n * W.COUNT_PER), W.COUNT_MAX);
    const nSplit = split ? Math.round(count * W.SPLIT_SHARE) : 0;
    for (let i = 0; i < count; i++) {
      const at = g.time + i * W.SPACING, speed = fast ? W.FAST_SPEED : W.SPEED;
      if (i >= count - nSplit) b.queue.push({ at, kind: 'splitter', v: n, hp: Math.round(hp * W.SPLIT_HP), speed, bounty: bounty * 2, leak: leakMult, radius: S.SENDS.splitter.radius, shards: S.SPLIT.SHARDS[0] });
      else b.queue.push({ at, kind: 'neutral', v: n, hp, speed, bounty, leak: leakMult, radius: S.CREEP_RADIUS.neutral });
    }
    if (boss) b.queue.push({ at: g.time + count * W.SPACING + 0.5, kind: 'boss', v: n, hp: Math.round(hp * W.BOSS_HP_MULT), speed: W.BOSS_SPEED, bounty: 10 + n * 2, leak: W.BOSS_LEAK * leakMult, radius: S.CREEP_RADIUS.boss });
  }
  g.events.push({ k: 'wave', n, boss, split });
}

// spawns every queued creep (waves and sends) whose time has come
function spawnDue(g, b) {
  if (!b.queue.length) return;
  b.queue.sort((a, c) => a.at - c.at);
  while (b.queue.length && b.queue[0].at <= g.time) spawnCreep(g, b, b.queue.shift());
}

module.exports = { sdHpMult, sdLeakMult, spawnCreep, makeCreep, splitShards, flushBorn, queueWave, spawnDue };
