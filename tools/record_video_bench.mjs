// 逐帧渲染鲲鹏短片：连接已启动的 Chrome CDP，用 __film.setTime 跳帧取图。
// 用法：START=0 END=90 FPS=24 OUT=frames node tools/record_video.mjs
import fs from 'node:fs';
import path from 'node:path';

const FPS = Number(process.env.FPS || 24);
const START = Number(process.env.START || 0);
const END = Number(process.env.END || 90);
const OUT = process.env.OUT || 'frames';
const PORT = Number(process.env.PORT || 9222);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) throw new Error('No debuggable page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
function call(method, params = {}) {
  const n = ++id;
  return new Promise((res, rej) => {
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

await call('Page.enable');
await call('Runtime.enable');

for (let i = 0; i < 150; i++) {
  const r = await call('Runtime.evaluate', { expression: 'typeof window.__film', returnByValue: true });
  if (r.result.value === 'object') break;
  await new Promise(r => setTimeout(r, 200));
}

fs.mkdirSync(OUT, { recursive: true });
const total = Math.ceil((END - START) * FPS);
const t0 = Date.now();
console.log(`recording ${total} frames, ${FPS}fps, ${START}-${END}s`);

for (let f = 0; f < total; f++) {
  const t = START + f / FPS;
  const tEval0 = Date.now();
  await call('Runtime.evaluate', {
    expression: `new Promise(r=>{window.__film.setTime(${t});requestAnimationFrame(()=>requestAnimationFrame(()=>r(1)));})`,
    awaitPromise: true,
    returnByValue: true
  });
  const tCap = Date.now();
  const shot = await call('Page.captureScreenshot', { format: 'jpeg', quality: 93, captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `f${String(f).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
  if (f % 48 === 0) console.log(`${f}/${total} t=${t.toFixed(2)} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
console.log('DONE elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
ws.close();
