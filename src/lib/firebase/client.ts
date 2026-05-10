import { getApps, getApp, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
  logEvent,
  setUserId as setAnalyticsUserId,
  type Analytics,
} from "firebase/analytics";

const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

const isBrowser = typeof window !== "undefined";

// We only initialize Firebase in the browser. During static prerender (server)
// the env vars may not be available, and `getAuth` would throw `auth/invalid-api-key`.
// All Firebase usages in this codebase happen inside `useEffect` or event
// handlers, so they always run client-side.
const app =
  isBrowser && firebaseConfigured
    ? getApps().length
      ? getApp()
      : initializeApp(config)
    : null;

export const auth: Auth = (app
  ? getAuth(app)
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            "Firebase Auth used on server or before configuration. Make sure NEXT_PUBLIC_FIREBASE_* env vars are set."
          );
        },
      }
    ) as Auth));

export const db: Firestore = (app
  ? getFirestore(app)
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            "Firestore used on server or before configuration. Make sure NEXT_PUBLIC_FIREBASE_* env vars are set."
          );
        },
      }
    ) as Firestore));

export const storage: FirebaseStorage = (app
  ? getStorage(app)
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(
            "Firebase Storage used on server or before configuration. Make sure NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is set."
          );
        },
      }
    ) as FirebaseStorage));

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Firebase Analytics (browser-only, requires `measurementId`). `isSupported`
// guards against environments where the SDK can't run — server, prerender,
// some private/incognito modes, browsers blocking cookies, etc. We resolve
// to `null` in those cases so callers can no-op without try/catch.
let analyticsPromise: Promise<Analytics | null> | null = null;

export function getAnalyticsClient(): Promise<Analytics | null> {
  if (!isBrowser || !app || !config.measurementId) return Promise.resolve(null);
  if (!analyticsPromise) {
    analyticsPromise = isAnalyticsSupported()
      .then((ok) => (ok ? getAnalytics(app as FirebaseApp) : null))
      .catch(() => null);
  }
  return analyticsPromise;
}

export async function trackEvent(
  name: string,
  params?: Record<string, unknown>
): Promise<void> {
  const a = await getAnalyticsClient();
  if (!a) return;
  logEvent(a, name as string, params as Record<string, unknown> | undefined);
}

export async function setAnalyticsUser(userId: string | null): Promise<void> {
  const a = await getAnalyticsClient();
  if (!a) return;
  setAnalyticsUserId(a, userId);
}
