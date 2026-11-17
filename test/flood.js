// Child process for exploits.js: joins a room with a token and floods 20k messages.
const WebSocket = require('ws');
const [url, code, token] = process.argv.slice(2);
const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', code, token }));
  setTimeout(() => {
    for (let i = 0; i < 20000; i++) { if (ws.readyState !== 1) break; ws.send(JSON.stringify(i % 3 === 0 ? { t: 'build', type: 'arrow', c: i % 11, r: (i >> 4) % 20 } : i % 3 === 1 ? { t: 'cursor', b: 'L', c: 1, r: 1 } : { t: 'chat', text: 'spam' })); }
  }, 200);
});
ws.on('close', (code) => { console.log('closed ' + code); process.exit(0); });
ws.on('error', () => {});
setTimeout(() => { console.log('still open'); process.exit(0); }, 5000);
