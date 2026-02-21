import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue, push, serverTimestamp
  , query, orderByChild, limitToLast, remove
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBjSCYNOngXOSQGBU7jMj1kgf7hunfMjyI",
  authDomain: "marionetes-do-destino.firebaseapp.com",
  databaseURL: "https://marionetes-do-destino-default-rtdb.firebaseio.com",
  projectId: "marionetes-do-destino",
  storageBucket: "marionetes-do-destino.firebasestorage.app",
  messagingSenderId: "506859529879",
  appId: "1:506859529879:web:aef41f525b22754c7f6bd2",
  measurementId: "G-LQNNS93LDY"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export {
  setPersistence, browserLocalPersistence,
  signInAnonymously, signOut, onAuthStateChanged,
  ref, get, set, update, onValue, push, serverTimestamp,
  query, orderByChild, limitToLast, remove
};
