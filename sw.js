// sw.js — alias conservé pour compatibilité. Le service worker principal est firebase-messaging-sw.js.
const CACHE_V = "v2025-10-06-02";
const CACHE_NAME = `app-${CACHE_V}`;
self.__APP_CACHE_VERSION = CACHE_V;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await self.skipWaiting();
    await caches.open(CACHE_NAME);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

importScripts("./firebase-messaging-sw.js");
