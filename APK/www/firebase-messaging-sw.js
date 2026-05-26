importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBHp7W9ucgDW4_u3MGvplLuqZFUE6-yJVI',
  projectId: 'floodguard-f84ac',
  messagingSenderId: '488469166284',
  appId: '1:488469166284:web:bd34ad115167061f17aa69'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification || {};
  const title = notif.title || 'FloodGuard Alert';
  const body = notif.body || '';
  const url = payload.data?.url || '/';

  return self.registration.showNotification(title, {
    body,
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450],
    requireInteraction: true,
    tag: 'floodguard-alert',
    data: { url }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wcs) => {
      const existing = wcs.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        return existing.navigate(url);
      }
      return clients.openWindow(url);
    })
  );
});
