// Forge TD sends: buying creeps for the enemy board, send income (with falloff), and per-player send tiers.
const S = require('../public/shared.js');
const { other, addGold, addIncome } = require('./core.js');

// per-player send tiers; only keys of S.SENDS exist, and every lookup is guarded by S.hasSend
function freshTiers() { const o = Object.create(null); for (const k of Object.keys(S.SENDS)) o[k] = 0; return o; }
function tierOf(p, kind) { return p.sendTier && S.hasSend(kind) ? S.clampTier(p.sendTier[kind]) : 0; }

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
      arrowMult: spec.arrowMult, slowResist: spec.slowResist, shards: spec.shards, from: p.id });
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
  sendIncomeGain(p, cost * S.SEND_UP.INCOME_PER_GOLD * S.sendUpIncomeMult(g.teamSize)); // an upgrade is an investment too (same falloff as sends; 2v2 x SEND_TEAM2_INCOME)
  p.sendTier[kind] = tier + 1;
  p.sendUpSpent = (p.sendUpSpent || 0) + cost;
  g.events.push({ k: 'sendup', team: p.team, kind, tier: tier + 1, name: p.name, id: p.id });
  return null;
}

module.exports = { freshTiers, tierOf, sendIncomeGain, doSend, upgradeSend };
