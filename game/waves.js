// Forge TD neutral waves, sudden death, and creep spawning (sends are spawned here too, from the board queue).
const S = require('../public/shared.js');

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

// spawns every queued creep (waves and sends) whose time has come
function spawnDue(g, b) {
  if (!b.queue.length) return;
  b.queue.sort((a, c) => a.at - c.at);
  while (b.queue.length && b.queue[0].at <= g.time) spawnCreep(g, b, b.queue.shift());
}

module.exports = { sdHpMult, sdLeakMult, spawnCreep, queueWave, spawnDue };
