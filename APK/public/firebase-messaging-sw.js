importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDNLaSUaBiC52mFrHsOIwkmahJbAtK2E-U',
  authDomain: 'floodguard-f84ac.firebaseapp.com',
  projectId: 'floodguard-f84ac',
  storageBucket: 'floodguard-f84ac.firebasestorage.app',
  messagingSenderId: '488469166284',
  appId: '1:488469166284:web:bd34ad115167061f17aa69',
  measurementId: 'G-7JVD25ZNN5'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification || {};
  const data = payload.data || {};
  const title = notif.title || 'FloodGuard Alert';
  const body = notif.body || '';
  const url = data.url || '/';
  const isDanger = (data.event || '').toUpperCase().includes('DANGER');

  const options = isDanger ? {
    body,
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    vibrate: [800, 200, 800, 200, 800, 200, 1000, 400, 1000, 400, 1000],
    requireInteraction: true,
    tag: 'floodguard-danger',
    renotify: true,
    data: { url, event: data.event }
  } : {
    body,
    icon: '/app-icon-192.png',
    badge: '/app-icon-192.png',
    vibrate: [500, 110, 500, 110, 450],
    requireInteraction: false,
    tag: 'floodguard-alert',
    data: { url }
  };

  return self.registration.showNotification(title, options);
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
