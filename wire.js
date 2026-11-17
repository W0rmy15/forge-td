// Forge TD - compact state encoding (v0.5). Used by server.js; decoded by S.decodeState in public/shared.js.
// Creeps: [id, kindIndex, round(x*10), round(y*10), ceil(hp), maxHp, slowed, v]  (radius is derived from the kind)
// Shots:  one flat array `sh` of [board*3 + towerIndex, c, r, round(x2*10), round(y2*10)] per shot (shots were ~88% of events)
const S = require('./public/shared.js');
const KIND = Object.create(null); S.WIRE.KINDS.forEach((k, i) => (KIND[k] = i));
const TWR = Object.create(null); S.WIRE.TOWERS.forEach((k, i) => (TWR[k] = i));
const q10 = (v) => Math.round(v * 10);

function encodeCreeps(g, b) {
  return b.creeps.map((c) => [c.id, KIND[c.kind] !== undefined ? KIND[c.kind] : 0, q10(c.x), q10(c.y), Math.ceil(c.hp), c.maxHp, g.time < c.slowUntil ? 1 : 0, c.v || 0]);
}
// splits one tick's events into the compact shot array and the remaining (rare) events
function splitEvents(events) {
  const sh = [], ev = [];
  for (const e of events) {
    if (e.k === 'shot' && TWR[e.tt] !== undefined) sh.push((e.b === 'R' ? 3 : 0) + TWR[e.tt], Math.floor(e.x1), Math.floor(e.y1), q10(e.x2), q10(e.y2));
    else ev.push(e);
  }
  return { sh, ev };
}
// seconds the board's send lane is booked ahead (0 when free), and whether new sends to it are refused
function laneInfo(g, b) {
  const ahead = Math.max(0, (b.sendAt || 0) - g.time);
  return { lane: Math.round(ahead * 10) / 10, laneFull: ahead > S.LANE_MAX_AHEAD ? 1 : 0 };
}
module.exports = { encodeCreeps, splitEvents, laneInfo };
