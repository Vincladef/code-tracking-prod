// sw.js — Service Worker FCM (web push)
importScripts("https://www.gstatic.com/firebasejs/9.6.10/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.6.10/firebase-messaging-compat.js");

const DEFAULT_NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAB6ElEQVR42u3d0U0gQAxDwVRGudccRUANJwTrxLNSGvCb/52Pf59frvfGCAAYAgAHgAPAAeAAuHv/8wAoC94KYkTvxjDCd0MY8bsRjPDdEEb8bgQjfDeEEb8bwYjfjWDE70Yw4ncjGPG7EYz43QhG/G4EAAAgfjOCEb8bAQAAiN+MYMTvRgAAAOI3IwAAAPGbEQAAgPjNCAAAQPxmBAAAAAAA4tciAAAA8ZsRAAAAAAAAAID4nQgAAAAAAAAAQPxOBAAAAAAAAAAAAAAAACB+GwIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiWxwcAAAAAAAAAAAAAAAAI2uIDAAAAAAAAAASd8QEAAAAAAAAAgs74AADg17Dm+AAAAAAA/g6ujQ8AAO8AQPA+PgAAvAUAwdv4AADwHkA7gtfbAwDAewCtCBJ2jwHQhiBlcwAAyAHQgiBp7zgA1xGkbQ0AAHkAriJI3DkWwDUEqRtHA7iCIHnfeADbEaRvuwLAVgQbdl0DYBuCLZuuArAFwaY91wFIhrBxx7UA0hBs3XA1gAQI27c7AeAVggu7nQHwlxAu7XUOwG9huLrRaQA/xdCwCwAAAAAAAAAAAAAAAADQBuAb8crY5qD79QEAAAAASUVORK5CYII=";

firebase.initializeApp({
  apiKey: "AIzaSyAQcvZ9a2j4MHF04RjMHIey0R_iwnjZf4o",
  authDomain: "tracking-d-habitudes.firebaseapp.com",
  projectId: "tracking-d-habitudes",
  storageBucket: "tracking-d-habitudes.firebasestorage.app",
  messagingSenderId: "739389871966",
  appId: "1:739389871966:web:684e26dbdfb0c0a69221cf"
});

const messaging = firebase.messaging();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Ce service worker est principalement dédié aux notifications push.
  // La présence de ce gestionnaire garantit le comportement attendu pour la PWA.
});

messaging.onBackgroundMessage((payload = {}) => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  const hasNotificationPayload = Boolean(
    (notification && notification.title) || notification.body
  );

  if (hasNotificationPayload) {
    // Firebase affiche automatiquement les notifications avec un payload "notification".
    // On ne fait rien ici pour éviter un doublon.
    return;
  }

  const title = data.title || "Rappel";
  const body = data.body || "Tu as des éléments à remplir aujourd’hui.";

  self.registration.showNotification(title, {
    body,
    icon: data.icon || DEFAULT_NOTIFICATION_ICON,
    badge: data.badge || "/badge.png",
    data: { link: data.link || "/" },
  });
});

self.addEventListener("notificationclick", (e) => {
  const link = e.notification?.data?.link || e.notification?.data?.url || "/";
  e.notification.close();
  if (link) {
    e.waitUntil(clients.openWindow(link));
  }
});
