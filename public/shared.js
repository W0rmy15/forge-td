// Shared game constants + pathfinding (used by both server and client).
// ALL tuning numbers live here.
(function (root) {
  const S = {
    VERSION: '0.4.0',
    COLS: 11, ROWS: 20,
    SPAWN: { c: 5, r: 0 }, BASE: { c: 5, r: 19 },
    // economy
    START_GOLD: 150, START_INCOME: 18, LIVES: 20,
    INCOME_EVERY: 10, WAVE_EVERY: 30, FIRST_WAVE: 20,
    MAX_PER_TEAM: 2, SELL_REFUND: 0.7,
    // Sales are queued while your board is busy (creeps on it, or a spawn due within SELL_SPAWN_GUARD s)
    // and execute the moment it is clear. The tower keeps firing until then.
    SELL_SPAWN_GUARD: 2,
    // ...but a queued sale never waits forever: after SELL_MAX_WAIT s it executes as soon as no creep is within
    // SELL_CLEAR_RADIUS cells of the tower (so a steady trickle of sends can't lock your towers in place)
    SELL_MAX_WAIT: 10, SELL_CLEAR_RADIUS: 3,
    MAX_GOLD: 1e7, MAX_INCOME: 1e5,
    // neutral waves: hp = BASE_HP * GROWTH^(n-1) * teamScale(teamSize)
    WAVE: {
      BASE_HP: 25, GROWTH: 1.17,
      COUNT_BASE: 6, COUNT_MAX: 22, SPACING: 0.6,
      SPEED: 1.25, FAST_SPEED: 1.7, FAST_EVERY: 3,
      BOSS_EVERY: 5, BOSS_HP_MULT: 9, BOSS_LEAK: 3, BOSS_SPEED: 0.8,
      // sudden death: from this wave on, every wave gets an extra HP multiplier (compounding per wave).
      // When a base falls in sudden death the current wave is finished and the side that lost fewer lives in total wins.
      SUDDEN_DEATH_WAVE: 22, SUDDEN_DEATH_GROWTH: 1.25, SUDDEN_DEATH_LEAK_MULT: 1,
    },
    // neutral waves scale with team size: 2v2 = x2.3 HP (a team of two has 2x the gold plus shared-maze synergy)
    // (eased in: TEAM2_SCALE_START at wave 1 rising linearly to TEAM2_SCALE at TEAM2_SCALE_WAVE, so 2v2 isn't harsher than 1v1 early)
    TEAM2_SCALE: 2.3, TEAM2_SCALE_START: 2.0, TEAM2_SCALE_WAVE: 14,
    teamScale(teamSize, wave) {
      if ((teamSize || 1) < 2) return 1;
      const k = Math.min(1, Math.max(0, ((wave || 1) - 1) / Math.max(1, S.TEAM2_SCALE_WAVE - 1)));
      return S.TEAM2_SCALE_START + (S.TEAM2_SCALE - S.TEAM2_SCALE_START) * k;
    },
    // 2v2 send HP multiplier (in place of teamScale for sends): TEAM2_SCALE x SEND_TEAM2_BONUS = 2.3 x 1.3 = x2.99 once
    // the game is under way, but only x1.8 until wave FROM, rising linearly to full at wave FULL. Two attackers' sends land
    // on one shared maze; the slow start keeps 2v2 bank-and-dump rushes (bots won at ~4.3 min with the full value) in check.
    SEND_TEAM2_BONUS: 1.3, SEND_TEAM2: { START: 1.8, FROM: 6, FULL: 16 },
    // server protection: a send is refused when the target lane is already booked more than this many seconds ahead
    // (this is not a per-wave cap; with gold and patience you can still send as much as you like)
    LANE_MAX_AHEAD: 45,
    // tower damage multiplier against slowed creeps (Frost synergy)
    SLOWED_DMG_MULT: 1.25,
    TOWERS: {
      arrow: { name: 'Arrow', key: '1', color: '#f2c94c', cost: 50, desc: 'Fast single target',
        levels: [ { dmg: 10, range: 3.0, rate: 0.5 }, { dmg: 19, range: 3.3, rate: 0.45 }, { dmg: 34, range: 3.6, rate: 0.4 } ] },
      cannon: { name: 'Cannon', key: '2', color: '#b0b8c4', cost: 80, desc: 'Slow, splash damage',
        levels: [ { dmg: 22, range: 2.6, rate: 1.4, splash: 1.0 }, { dmg: 48, range: 2.9, rate: 1.3, splash: 1.25 }, { dmg: 92, range: 3.2, rate: 1.2, splash: 1.45 } ] },
      frost: { name: 'Frost', key: '3', color: '#6fd3ff', cost: 60, desc: 'Slows an area; slowed creeps take +25% damage',
        levels: [ { dmg: 6, range: 2.8, rate: 0.8, slow: 0.4, slowDur: 1.6, area: 0.9 }, { dmg: 12, range: 3.0, rate: 0.75, slow: 0.5, slowDur: 1.9, area: 1.1 }, { dmg: 22, range: 3.3, rate: 0.7, slow: 0.6, slowDur: 2.2, area: 1.3 } ] },
    },
    // cost to upgrade to level index i = tower.cost * UPGRADE_MULT[i]
    UPGRADE_MULT: [0, 1, 1.6],
    // Sends: hp = hpMult * neutral wave HP of the current wave (min wave 1) * teamScale(team size). Payback = cost / income * INCOME_EVERY.
    // bounty = gold the defender's tower owner gets for the kill.
    // diminishing returns: income gained per send = income * F / (F + income already gained from sends)
    SEND_INCOME_FALLOFF: 120,
    // sends are unlimited (gold is the only limit); each enemy board has one send lane: a send occupies it for
    // lane * SEND_LANE_MULT seconds (swarm creeps enter gap s apart), so banked dumps trickle in
    SEND_LANE_MULT: 1.5,
    SEND_RAMP: { START: 0.2, PER_WAVE: 0.06 }, // send HP multiplier = min(1, START + PER_WAVE * wave)
    SENDS: {
      runner: { name: 'Runner', key: 'q', desc: 'Fast', cost: 35, income: 2, hpMult: 2.1, speed: 2.6, bounty: 9, leak: 1, count: 1, gap: 0, lane: 0.6, radius: 0.22, color: '#7bed6f' },
      brute: { name: 'Brute', key: 'w', desc: 'Very tanky, leaks cost 2', cost: 70, income: 4, hpMult: 10.5, speed: 0.95, bounty: 24, leak: 2, count: 1, gap: 0, lane: 2, radius: 0.36, color: '#e05d5d' },
      swarm: { name: 'Swarm', key: 'e', desc: '5 small', cost: 50, income: 3, hpMult: 0.9, speed: 1.8, bounty: 3, leak: 1, count: 5, gap: 0.25, lane: 1.5, radius: 0.16, color: '#c58bff' },
    },
    // Send upgrades: each player upgrades each send type through tiers 1..MAX_TIER (persist for the match).
    // Tier t: HP x HP[t], per-send price x COST[t], income gained per send x INCOME[t] (payback time unchanged),
    // defender bounty x BOUNTY[t]. Buying tier t costs round(send.cost * UP_COST[t]).
    SEND_UP: {
      MAX_TIER: 3,
      UNLOCK_WAVE: [0, 8, 12, 16], // tier t can be bought from this wave on (keeps upgraded rushes out of the early game)
      UP_COST: [0, 2, 3.5, 5.5],
      HP: [1, 1.2, 1.5, 1.85],
      COST: [1, 1.1, 1.2, 1.3],
      INCOME: [1, 1.1, 1.2, 1.3],
      BOUNTY: [1, 1.2, 1.5, 1.85], // = HP multiplier: defenders earn the same gold per HP killed
      INCOME_PER_GOLD: 0.05, // buying a tier also raises income by cost x this (sends give ~0.057/gold), with the send falloff
    },
    // per-type tier traits (index = tier). Runner: speed x; Swarm: unit count; Brute: Arrow damage taken x and slow resistance.
    SEND_TRAITS: {
      runner: { speedMult: [1, 1, 1.2, 1.35], desc: ['', 'Tougher', 'Tougher + 20% faster', 'Elite: +35% speed'] },
      swarm: { count: [5, 5, 6, 7], desc: ['', 'Tougher', 'Tougher + 6 per send', 'Elite: 7 per send'] },
      brute: { arrowMult: [1, 1, 0.6, 0.5], slowResist: [0, 0, 0, 0.5], desc: ['', 'Tougher', 'Armored: -40% Arrow damage', 'Elite: -50% Arrow, half slow'] },
    },
    NEUTRAL: { color: '#d9d9d9', bossColor: '#ff9f43' },
  };
  S.waveHp = function (n) { return S.WAVE.BASE_HP * Math.pow(S.WAVE.GROWTH, Math.max(1, n) - 1); };
  // early-game ramp on send HP: x0.26 at wave 1 rising to x1 at wave 14, so early send rushes can't flatten a defense before it exists
  S.sendRamp = function (wave) { return Math.min(1, S.SEND_RAMP.START + S.SEND_RAMP.PER_WAVE * Math.max(1, wave)); };
  S.clampTier = function (t) { return Number.isInteger(t) && t > 0 ? Math.min(t, S.SEND_UP.MAX_TIER) : 0; };
  // wave at which the send ramp reaches full strength (for UI text)
  S.sendTeamMult = function (teamSize, wave) {
    if ((teamSize || 1) < 2) return 1;
    const T = S.SEND_TEAM2, full = S.TEAM2_SCALE * S.SEND_TEAM2_BONUS, w = wave || 1;
    const k = Math.min(1, Math.max(0, (w - T.FROM) / Math.max(1, T.FULL - T.FROM)));
    return T.START + (full - T.START) * k;
  };
  S.sendRampFullWave = function () { return Math.ceil((1 - S.SEND_RAMP.START) / S.SEND_RAMP.PER_WAVE - 1e-9); };
  S.sendHp = function (kind, wave, teamSize, tier) {
    const n = teamSize || 1;
    return Math.round(S.SENDS[kind].hpMult * S.waveHp(Math.max(1, wave)) * S.sendTeamMult(n, wave) * S.sendRamp(wave) * S.SEND_UP.HP[S.clampTier(tier)]);
  };
  // everything about one send of `kind` at `tier` except HP (which depends on the wave)
  S.sendSpec = function (kind, tier) {
    const b = S.SENDS[kind], t = S.clampTier(tier), U = S.SEND_UP, tr = S.SEND_TRAITS[kind] || {};
    return {
      cost: Math.round(b.cost * U.COST[t]), income: b.income * U.INCOME[t], bounty: Math.round(b.bounty * U.BOUNTY[t]),
      speed: b.speed * (tr.speedMult ? tr.speedMult[t] : 1), count: tr.count ? tr.count[t] : b.count,
      arrowMult: tr.arrowMult ? tr.arrowMult[t] : 1, slowResist: tr.slowResist ? tr.slowResist[t] : 0, tier: t,
    };
  };
  S.sendUpCost = function (kind, tier) { // cost to go from `tier` to tier+1 (null at max)
    const t = S.clampTier(tier); if (t >= S.SEND_UP.MAX_TIER) return null;
    return Math.round(S.SENDS[kind].cost * S.SEND_UP.UP_COST[t + 1]);
  };
  S.hasTower = function (type) { return typeof type === 'string' && Object.prototype.hasOwnProperty.call(S.TOWERS, type); };
  S.hasSend = function (kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(S.SENDS, kind); };
  S.towerSpent = function (type, lvl) {
    const t = S.TOWERS[type]; let s = t.cost;
    for (let i = 1; i <= lvl; i++) s += Math.round(t.cost * S.UPGRADE_MULT[i]);
    return s;
  };
  S.upgradeCost = function (type, lvl) { // cost to go from lvl to lvl+1
    if (lvl >= 2) return null;
    return Math.round(S.TOWERS[type].cost * S.UPGRADE_MULT[lvl + 1]);
  };
  // BFS distance field from base. blocked: function(c,r)->bool. Returns Int32Array (-1 = unreachable)
  S.computeDist = function (blocked) {
    const { COLS, ROWS, BASE } = S;
    const d = new Int32Array(COLS * ROWS).fill(-1);
    const q = [BASE.c + BASE.r * COLS]; d[q[0]] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], c = i % COLS, r = (i / COLS) | 0;
      const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of nb) {
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const j = nc + nr * COLS;
        if (d[j] !== -1 || blocked(nc, nr)) continue;
        d[j] = d[i] + 1; q.push(j);
      }
    }
    return d;
  };
  // pick next cell from (c,r) following distance field
  S.nextCell = function (d, c, r) {
    const { COLS, ROWS } = S;
    const cur = d[c + r * COLS];
    let best = null, bd = cur < 0 ? 1e9 : cur;
    const nb = [[c, r + 1], [c - 1, r], [c + 1, r], [c, r - 1]];
    for (const [nc, nr] of nb) {
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const v = d[nc + nr * COLS];
      if (v >= 0 && v < bd) { bd = v; best = { c: nc, r: nr }; }
    }
    return best;
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = S; else root.SHARED = S;
})(typeof window !== 'undefined' ? window : this);
