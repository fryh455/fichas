import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  update,
  get,
  onValue,
  off,
  push,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

/**
 * PREENCHA AQUI.
 * - Project Settings -> SDK setup and configuration -> "Config"
 */
export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

function assertConfig() {
  const required = ["apiKey","authDomain","databaseURL","projectId","appId"];
  for (const k of required) {
    if (!FIREBASE_CONFIG[k]) {
      throw new Error(`FIREBASE_CONFIG incompleto: falta "${k}" em /js/firebase.js`);
    }
  }
}

assertConfig();

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Re-export RTDB helpers
export {
  ref,
  set,
  update,
  get,
  onValue,
  off,
  push,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  limitToLast
};

// Auth helpers
export {
  onAuthStateChanged,
  signInAnonymously,
  signOut
};
