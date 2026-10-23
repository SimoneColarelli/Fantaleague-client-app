'use strict';

const CACHE = 'fantaleague-shell-v1';
const ASSETS = ['./', './index.html', './pwa.js', './manifest.webmanifest',
    './image/icon-192.png', './image/icon-512.png', './regolamento.md',
    './admin.html', './admin.js', './admin.css'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('fantaleague-shell-') && key !== CACHE)
            .map(key => caches.delete(key))
    )));
});

// Only public shell assets are cached. Data and future admin endpoints always
// use the network so a cached response cannot masquerade as a saved change.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || !assetURLs.has(event.request.url)) return;
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
        }
        return response;
    }).catch(() => caches.match(event.request).then(response => response || Response.error())));
});
