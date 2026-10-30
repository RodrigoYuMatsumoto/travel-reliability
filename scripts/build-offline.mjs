import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = [
  '/index.html',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];
for (const name of await readdir('dist/web/assets'))
  if (/\.(js|css|woff2)$/.test(name)) assets.push('/assets/' + name);
const version = createHash('sha256')
  .update(await readFile('dist/web/index.html'))
  .digest('hex')
  .slice(0, 16);
const worker = `/* Generated static-only offline shell. Never cache API, identity or evidence. */
const CACHE='tr-shell-${version}', ASSETS=${JSON.stringify(assets)}, SAFE=new Set(ASSETS);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tr-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data==='activate')self.skipWaiting()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||/^\\/(v1|auth|hooks|public|schema|rules)(\\/|$)/.test(u.pathname))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}
if(SAFE.has(u.pathname)&&!u.search)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});`;
await writeFile('dist/web/sw.js', worker);
console.log(`Offline shell: ${assets.length} static assets; API caching disabled`);
