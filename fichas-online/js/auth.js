import { auth, onAuthStateChanged, signInAnonymously, signOut } from "./firebase.js";

export async function ensureSignedIn() {
  const u = auth.currentUser;
  if (u) return u;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export function waitForAuth() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user || null);
    });
  });
}

export async function signOutNow() {
  try { await signOut(auth); } catch {}
}
