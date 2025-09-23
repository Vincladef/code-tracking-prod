// sw.js — Service Worker FCM (web push)
importScripts("https://www.gstatic.com/firebasejs/9.6.10/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.6.10/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAQcvZ9a2j4MHF04RjMHIey0R_iwnjZf4o",
  authDomain: "tracking-d-habitudes.firebaseapp.com",
  projectId: "tracking-d-habitudes",
  storageBucket: "tracking-d-habitudes.firebasestorage.app",
  messagingSenderId: "739389871966",
  appId: "1:739389871966:web:684e26dbdfb0c0a69221cf"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(({ notification = {}, data = {} }) => {
  self.registration.showNotification(notification.title || "Rappel", {
    body: notification.body || "Tu as des consignes à remplir aujourd’hui.",
    icon: "/icon.png",
    badge: "/badge.png",
    data: { link: data.link || "/" }
  });
});

self.addEventListener("notificationclick", (e) => {
  const link = e.notification?.data?.link || e.notification?.data?.url || "/";
  e.notification.close();
  if (link) {
    e.waitUntil(clients.openWindow(link));
  }
});
