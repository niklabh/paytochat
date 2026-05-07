"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db, firebaseConfigured, googleProvider } from "./firebase/client";
import { DEFAULT_USER_SETTINGS, type UserDoc } from "./types";
import { isValidHandle, slugifyHandle } from "./utils";

export class HandleTakenError extends Error {
  constructor() {
    super("HANDLE_TAKEN");
    this.name = "HandleTakenError";
  }
}

interface AuthCtx {
  loading: boolean;
  user: User | null;
  profile: UserDoc | null;
  configured: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, handle: string, displayName: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  /**
   * Creates the Firestore profile for the currently signed-in user with the
   * chosen handle. Used by the post-Google-sign-in onboarding flow. Throws
   * `HandleTakenError` if another user already owns the handle.
   */
  claimHandle: (handle: string, displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

// Runs in a Firestore transaction so concurrent callers (e.g. signUpEmail and
// onAuthStateChanged firing in parallel right after createUser) can't both
// create the same /users/{uid} doc with different handles. The first commit
// wins; the second's transaction retries, sees the doc, and returns.
async function ensureUserDoc(
  user: User,
  suggestedHandle?: string,
  displayName?: string
) {
  const ref = doc(db, "users", user.uid);

  const base =
    suggestedHandle ||
    slugifyHandle(user.email?.split("@")[0] || `user${user.uid.slice(0, 6)}`);
  let handle = base;
  if (!isValidHandle(handle)) {
    handle = `user${user.uid.slice(0, 6)}`;
  }

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;

    const newDoc: Omit<UserDoc, "createdAt"> & {
      createdAt: ReturnType<typeof serverTimestamp>;
    } = {
      uid: user.uid,
      handle,
      handleLower: handle.toLowerCase(),
      displayName: displayName || user.displayName || handle,
      bio: "",
      avatarUrl: user.photoURL || "",
      createdAt: serverTimestamp(),
      wallets: {},
      socials: {},
      settings: DEFAULT_USER_SETTINGS,
      stats: { totalEarnedUSD: 0, messagesReceived: 0, messagesOpened: 0 },
    };
    tx.set(ref, newDoc);
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  // Set by signUpEmail before kicking off Firebase Auth so the auth-state
  // listener can use the chosen handle/displayName when it races to create
  // the Firestore profile.
  const pendingSignUp = useRef<{ handle: string; displayName?: string } | null>(
    null
  );

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      // Reset profile up front so that switching users (or signing out) can't
      // briefly leak the previous user's profile into the UI.
      setProfile(null);
      if (!u) {
        setLoading(false);
        return;
      }
      const pending = pendingSignUp.current;
      try {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          // Existing user — the onSnapshot subscription below will keep state
          // in sync. Seed it now so consumers don't see a null-profile flash.
          setProfile(snap.data() as UserDoc);
        } else if (pending) {
          // Email signup path: signUpEmail set this with the handle the user
          // just picked.
          await ensureUserDoc(u, pending.handle, pending.displayName);
        }
        // Otherwise (e.g. brand-new Google user): leave profile as null so the
        // UI can route them to /a/onboarding to claim a handle.
      } catch (e) {
        console.error("auth bootstrap failed", e);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to profile doc.
  useEffect(() => {
    if (!user || !firebaseConfigured) {
      setProfile(null);
      return;
    }
    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserDoc);
      }
    });
    return () => unsub();
  }, [user]);

  const value: AuthCtx = {
    loading,
    user,
    profile,
    configured: firebaseConfigured,
    async signInEmail(email, password) {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // Defense in depth: if a previous signup failed before the Firestore
      // doc was written, recreate it on next login.
      await ensureUserDoc(cred.user);
    },
    async signUpEmail(email, password, handle, displayName) {
      pendingSignUp.current = { handle, displayName };
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
        await ensureUserDoc(cred.user, handle, displayName);
      } finally {
        pendingSignUp.current = null;
      }
    },
    async signInGoogle() {
      // Don't auto-create a profile here. The auth-state listener decides:
      // if no Firestore profile exists yet, the UI routes the user through
      // /a/onboarding to claim a handle.
      await signInWithPopup(auth, googleProvider);
    },
    async signOutUser() {
      await signOut(auth);
    },
    async claimHandle(handle, displayName) {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      if (!isValidHandle(handle)) throw new Error("Invalid handle");

      // Best-effort uniqueness check. The Firestore rules don't enforce
      // cross-user uniqueness on `handleLower`, so two parallel claims could
      // still race. The first to commit "wins" the public profile lookup
      // (which uses .limit(1)); the loser would need to pick another handle
      // from settings. Acceptable for now.
      const q = query(
        collection(db, "users"),
        where("handleLower", "==", handle.toLowerCase()),
        limit(1)
      );
      const existing = await getDocs(q);
      if (!existing.empty && existing.docs[0].id !== u.uid) {
        throw new HandleTakenError();
      }

      if (displayName && u.displayName !== displayName) {
        try {
          await updateProfile(u, { displayName });
        } catch {
          // Non-fatal: the Firestore doc is the source of truth for display.
        }
      }
      await ensureUserDoc(u, handle, displayName || handle);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
