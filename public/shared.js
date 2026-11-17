// Shared game constants + pathfinding (used by both server and client).
// ALL tuning numbers live here.
(function (root) {
  const S = {
    VERSION: '0.2.0',
    COLS: 11, ROWS: 20,
    SPAWN: { c: 5, r: 0 }, BASE: { c: 5, r: 19 },
    // economy
    START_GOLD: 150, START_INCOME: 18, LIVES: 20,
    INCOME_EVERY: 10, WAVE_EVERY: 30, FIRST_WAVE: 20,
    MAX_PER_TEAM: 2, SELL_REFUND: 0.7,
    SELL_DELAY: 3, // seconds a tower is disabled before it is removed, if creeps are on the board
    MAX_GOLD: 1e7, MAX_INCOME: 1e5,
    // neutral waves: hp = BASE_HP * GROWTH^(n-1) * teamScale(teamSize)
    WAVE: {
      BASE_HP: 25, GROWTH: 1.17,
      COUNT_BASE: 6, COUNT_MAX: 22, SPACING: 0.6,
      SPEED: 1.25, FAST_SPEED: 1.7, FAST_EVERY: 3,
      BOSS_EVERY: 5, BOSS_HP_MULT: 9, BOSS_LEAK: 3, BOSS_SPEED: 0.8,
      // sudden death: from this wave on, every wave gets an extra HP multiplier and leaks cost double
      SUDDEN_DEATH_WAVE: 24, SUDDEN_DEATH_GROWTH: 1.45, SUDDEN_DEATH_LEAK_MULT: 2,
    },
    teamScale(teamSize) { return 0.5 + 0.5 * Math.max(1, teamSize); },
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
    // Sends: hp = hpMult * neutral wave HP of the current wave (min wave 1). Payback = cost / income * INCOME_EVERY.
    SEND_CAP_PER_WAVE: 6, // sends per player between two neutral waves
    // diminishing returns: income gained per send = income * F / (F + income already gained from sends)
    SEND_INCOME_FALLOFF: 150,
    SENDS: {
      runner: { name: 'Runner', key: 'q', desc: 'Fast', cost: 35, income: 2, hpMult: 1.0, speed: 2.6, bounty: 3, leak: 1, count: 1, radius: 0.22, color: '#7bed6f' },
      brute: { name: 'Brute', key: 'w', desc: 'Very tanky, leaks cost 2', cost: 70, income: 4, hpMult: 5.5, speed: 0.95, bounty: 6, leak: 2, count: 1, radius: 0.36, color: '#e05d5d' },
      swarm: { name: 'Swarm', key: 'e', desc: '5 small', cost: 50, income: 3, hpMult: 0.4, speed: 1.8, bounty: 1, leak: 1, count: 5, radius: 0.16, color: '#c58bff' },
    },
    NEUTRAL: { color: '#d9d9d9', bossColor: '#ff9f43' },
  };
  S.waveHp = function (n) { return S.WAVE.BASE_HP * Math.pow(S.WAVE.GROWTH, Math.max(1, n) - 1); };
  S.sendHp = function (kind, wave) { return Math.round(S.SENDS[kind].hpMult * S.waveHp(Math.max(1, wave))); };
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
