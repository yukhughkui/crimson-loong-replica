// 连接 CDP 读取控制台/着色器错误：PORT=9223 URL=... node tools/check_console.mjs
const PORT = Number(process.env.PORT || 9223);
const URL = process.env.URL;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(m.error) : p.r(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled') console.log('CONSOLE', m.params.type, m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 500));
  if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', JSON.stringify(m.params.exceptionDetails).slice(0, 800));
  if (m.method === 'Log.entryAdded') console.log('LOG', m.params.entry.level, m.params.entry.text.slice(0, 800));
};
function call(method, params = {}) { const n = ++id; return new Promise((r, j) => { pending.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); }); }
await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
if (URL) await call('Page.navigate', { url: URL });
await new Promise(r => setTimeout(r, 12000));
ws.close();
