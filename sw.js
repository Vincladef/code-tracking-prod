// sw.js — alias conservé pour compatibilité. Le service worker principal est firebase-messaging-sw.js.
const CACHE_VERSION = "v2024-10-05-3";
self.__APP_CACHE_VERSION = CACHE_VERSION;
importScripts("./firebase-messaging-sw.js");
