import { Capacitor } from '@capacitor/core';
import { FCM_CONFIG, FCM_VAPID_KEY } from '@/constants';
import { sendFcmToken } from '@/api/auth';

type ForegroundPayload = {
  title?: string;
  body?: string;
  data?: Record<string, string>;
};

type FirebaseMessagePayload = {
  notification?: {
    title?: string;
    body?: string;
  };
  data?: Record<string, string>;
};

type FirebaseMessagingCompat = {
  getToken: (options?: Record<string, unknown>) => Promise<string>;
  onMessage: (listener: (payload: FirebaseMessagePayload) => void) => (() => void) | void;
};

type FirebaseCompat = {
  apps?: unknown[];
  initializeApp: (config: typeof FCM_CONFIG) => unknown;
  messaging: () => FirebaseMessagingCompat;
};

declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

const FIREBASE_APP_SCRIPT = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
const FIREBASE_MESSAGING_SCRIPT = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js';
const FIREBASE_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

let currentForegroundHandler: ((payload: ForegroundPayload) => void) | null = null;
let currentApiBase = '';
let currentAuthToken = '';
let lastKnownPushToken = '';
let lastUploadedKey = '';
let nativeInitPromise: Promise<void> | null = null;
let webInitPromise: Promise<void> | null = null;
let firebaseLoadPromise: Promise<FirebaseCompat | null> | null = null;
let webMessageUnsubscribe: (() => void) | null = null;

function platformLabel() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || navigator.platform || 'Browser';
}

function emitForeground(title?: string, body?: string, data?: Record<string, string>) {
  currentForegroundHandler?.({ title, body, data });
}

function uploadKey(authToken: string, pushToken: string) {
  return `${authToken}::${pushToken}`;
}

async function uploadTokenIfPossible(pushToken: string) {
  const trimmed = String(pushToken || '').trim();
  if (!trimmed) return;
  lastKnownPushToken = trimmed;
  if (!currentApiBase || !currentAuthToken) return;

  const key = uploadKey(currentAuthToken, trimmed);
  if (key === lastUploadedKey) return;

  await sendFcmToken(trimmed, {
    apiBase: currentApiBase,
    authToken: currentAuthToken,
  });
  lastUploadedKey = key;
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const selector = `script[data-fg-src="${src}"]`;
    const existing = document.querySelector(selector) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.fgSrc = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function loadFirebaseCompat() {
  if (firebaseLoadPromise) return firebaseLoadPromise;

  firebaseLoadPromise = (async () => {
    await loadScript(FIREBASE_APP_SCRIPT);
    await loadScript(FIREBASE_MESSAGING_SCRIPT);
    return window.firebase || null;
  })().catch((error) => {
    firebaseLoadPromise = null;
    console.warn('[FCM-web] Firebase SDK load failed:', error instanceof Error ? error.message : error);
    return null;
  });

  return firebaseLoadPromise;
}

async function ensureFirebaseMessagingWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: FIREBASE_SW_SCOPE,
    });
  } catch (error) {
    console.warn('[FCM-web] Service worker registration failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function initNativePush() {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  let permissions = await PushNotifications.checkPermissions().catch(() => ({ receive: 'prompt' as const }));
  if (permissions.receive !== 'granted') {
    permissions = await PushNotifications.requestPermissions().catch(() => ({ receive: 'denied' as const }));
  }
  if (permissions.receive !== 'granted') {
    return;
  }

  await Promise.allSettled([
    PushNotifications.createChannel({
      id: 'floodguard_alert',
      name: 'Flood Alert',
      description: 'Rising water and advisory notifications',
      importance: 4,
      vibration: true,
      visibility: 1,
    }),
    PushNotifications.createChannel({
      id: 'floodguard_danger',
      name: 'Flood Danger',
      description: 'Critical flood danger notifications',
      importance: 5,
      vibration: true,
      visibility: 1,
    }),
  ]);

  await PushNotifications.addListener('registration', (token) => {
    void uploadTokenIfPossible(String(token?.value || ''));
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.warn('[FCM-native] Registration error:', error?.error || error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    emitForeground(
      notification.title,
      notification.body,
      notification.data as Record<string, string> | undefined,
    );
  });

  await PushNotifications.register();
}

async function initWebPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : Notification.permission === 'denied'
      ? 'denied'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    return;
  }

  const firebase = await loadFirebaseCompat();
  if (!firebase) return;

  if (!Array.isArray(firebase.apps) || firebase.apps.length === 0) {
    firebase.initializeApp(FCM_CONFIG);
  }

  try {
    const workerRegistration = await ensureFirebaseMessagingWorker();
    const messaging = firebase.messaging();
    const pushToken = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: workerRegistration || undefined,
    });

    if (pushToken) {
      await uploadTokenIfPossible(pushToken);
    }

    if (!webMessageUnsubscribe) {
      const unsubscribe = messaging.onMessage((payload) => {
        emitForeground(
          payload.notification?.title,
          payload.notification?.body,
          payload.data,
        );
      });
      webMessageUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
    }
  } catch (error) {
    console.warn('[FCM-web] Token registration failed:', error instanceof Error ? error.message : error);
  }
}

export function getPushClientDetails() {
  const native = Capacitor.isNativePlatform();
  return {
    appType: native ? 'APK' : 'PWA',
    deviceName: native ? `FloodGuard ${Capacitor.getPlatform().toUpperCase()}` : `FloodGuard Web (${platformLabel()})`,
  };
}

export function setPushForegroundHandler(handler: ((payload: ForegroundPayload) => void) | null) {
  currentForegroundHandler = handler;
}

export async function ensurePushRegistration(auth: { apiBase: string; authToken: string }) {
  currentApiBase = String(auth.apiBase || '').trim();
  currentAuthToken = String(auth.authToken || '').trim();

  if (!currentApiBase || !currentAuthToken) return;

  if (lastKnownPushToken) {
    await uploadTokenIfPossible(lastKnownPushToken).catch(() => {});
  }

  if (Capacitor.isNativePlatform()) {
    if (!nativeInitPromise) nativeInitPromise = initNativePush();
    await nativeInitPromise;
    return;
  }

  if (!webInitPromise) webInitPromise = initWebPush();
  await webInitPromise;
}
