// Balance variant sweep (adapted from QA's v0.4 tune4.js). Usage: node test/tune.js [variant]
const S = require('../public/shared.js'); const B = require('./balance.js');
const base = JSON.parse(JSON.stringify({ UP: S.SEND_UP, T2: S.SEND_TEAM2, TR: S.SEND_TRAITS.swarm.count, BL: S.SENDS.brute.leak, SHP: S.SEND_TRAITS.swarm.hp }));
function apply(v) { Object.assign(S.SEND_UP, JSON.parse(JSON.stringify(base.UP)), v.UP || {}); Object.assign(S.SEND_TEAM2, base.T2, v.T2 || {}); S.SEND_TRAITS.swarm.count = v.swarmCount || base.TR.slice(); S.SENDS.brute.leak = v.bruteLeak || base.BL; S.SEND_TRAITS.swarm.hp = v.swarmHP3 ? [1, S.SEND_UP.HP[1], S.SEND_UP.HP[2], v.swarmHP3] : base.SHP; }
const D = (t = 'mix') => ({ tower: t, send: 0, kind: 'mix', need: 'mid' });
const E = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid' });
const X = (f, k, burst) => ({ tower: 'mix', send: f, kind: k, need: 'mid', burst });
const U = (f, k = 'mix') => ({ tower: 'mix', send: +(f * 0.65).toFixed(3), kind: k, need: 'mid', up: 3, upFrac: +(f * 0.35).toFixed(3), upWave: 6 });
const ECO = (e) => ({ tower: 'mix', send: 0, kind: 'mix', need: 'mid', eco: e });
const EU = (f, k = 'mix') => ({ tower: 'mix', send: f, kind: k, need: 'mid', upE: true });
const rows = [
  ['1v1 ECO20 vs D', [ECO(0.2)], [D()]], ['2v2 ECO20 vs D+D', [ECO(0.2), ECO(0.2)], [D(), D()]],
  ['1v1 U mix20 vs D', [U(0.2)], [D()]], ['1v1 U mix40 vs D', [U(0.4)], [D()]], ['1v1 U runner40 vs D', [U(0.4, 'runner')], [D()]], ['1v1 U swarm40 vs D', [U(0.4, 'swarm')], [D()]],
  ['1v1 U20 vs E20', [U(0.2)], [E(0.2)]], ['1v1 EU40 vs E40', [EU(0.4)], [E(0.4)]], ['1v1 E40 vs EU40', [E(0.4)], [EU(0.4)]],
  ['2v2 U runner60 vs D+Da', [U(0.6, 'runner'), U(0.6, 'runner')], [D(), D('arrow')]], ['2v2 U swarm60 vs D+Da', [U(0.6, 'swarm'), U(0.6, 'swarm')], [D(), D('arrow')]],
  ['2v2 U mix40 vs D+Da', [U(0.4), U(0.4)], [D(), D('arrow')]], ['2v2 U runner40 vs D+Da', [U(0.4, 'runner'), U(0.4, 'runner')], [D(), D('arrow')]],
  ['2v2 burst4 brute50 vs D+Da', [X(0.5, 'brute', 4), X(0.5, 'brute', 4)], [D(), D('arrow')]], ['2v2 burst8 brute50 vs D+Da', [X(0.5, 'brute', 8), X(0.5, 'brute', 8)], [D(), D('arrow')]],
  ['2v2 burst8 brute30 vs D+Da', [X(0.3, 'brute', 8), X(0.3, 'brute', 8)], [D(), D('arrow')]],
  ['2v2 E mix40 vs D+Da', [E(0.4), E(0.4)], [D(), D('arrow')]], ['2v2 E mix20 vs D+Da', [E(0.2), E(0.2)], [D(), D('arrow')]], ['2v2 E40 vs E20', [E(0.4), E(0.4)], [E(0.2), E(0.2)]],
  ['2v2 U20 vs E20', [U(0.2), U(0.2)], [E(0.2), E(0.2)]],
  ['1v1 U swarm60 vs D', [U(0.6, 'swarm')], [D()]], ['2v2 U swarm40 vs D+Da', [U(0.4, 'swarm'), U(0.4, 'swarm')], [D(), D('arrow')]],
  ['1v1 D vs D', [D()], [D()]], ['2v2 D vs D', [D(), D('arrow')], [D(), D('arrow')]],
];
// v0.5: shared.js already holds the V7 numbers; 'swarmHP16' is QA's untested next lever (Swarm T3 HP 1.85 -> 1.6, bounty follows HP)
const variants = {
  V7: {},
  V7_swarmHP16: { swarmHP3: 1.6 },
  V7_swarmHP17: { swarmHP3: 1.7 },
};
const only = process.argv[2];
for (const [vn, v] of Object.entries(variants)) {
  if (only && vn !== only) continue;
  apply(v); console.log('== ' + vn);
  for (const [l, a, b] of rows) {
    const rs = []; for (let s = 1; s <= 5; s++) { const pre = { L: 0, R: 0 }; const r = B.run(l, a, b, { seed: s, maxMin: 25, onEvent: (e, g) => { if (e.k === 'leak' && g.wave < 22) pre[e.team] += e.n; } }); r.pre = pre; rs.push(r); }
    const w = { L: 0, R: 0, draw: 0 }; rs.forEach((r) => w[r.winner] = (w[r.winner] || 0) + 1);
    console.log(`  ${l.padEnd(28)} L${w.L} R${w.R} d${w.draw} | min ${rs.map((r) => r.min).join(',')} | preSD ${rs.map((r) => r.pre.L + '/' + r.pre.R).join(' ')} | tiers ${rs[0].tiers}`);
  }
}
