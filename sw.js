const VERSION='stamp-studio-v1.0.0';
const PREFIX='stamp-studio-';
const ASSETS=['./','./index.html','./style.css','./app.js','./core.js','./db.js','./manifest.json','./vendor/jszip.min.js','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==VERSION)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;event.respondWith((async()=>{const cache=await caches.open(VERSION);const cached=await cache.match(event.request,{ignoreSearch:true});if(cached)return cached;if(event.request.mode==='navigate')return cache.match('./index.html');return fetch(event.request);})());});
