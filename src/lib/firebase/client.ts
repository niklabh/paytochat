import { getApps, getApp, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
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
