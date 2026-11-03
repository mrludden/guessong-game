// Firebase project configuration.
// Project settings > General > Your apps > SDK setup and configuration.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyA1CrXzmzumQBTXABTyByCxUASz3lOKTPA",
  authDomain: "guessong-game-89060.firebaseapp.com",
  databaseURL: "https://guessong-game-89060-default-rtdb.firebaseio.com/",
  projectId: "guessong-game-89060",
  storageBucket: "guessong-game-89060.firebasestorage.app",
  messagingSenderId: "924702618223",
  appId: "1:924702618223:web:e5906a6be69e845559139a",
  measurementId: "G-G894QHPYD3"
};

export const firebaseConfigured = true;
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const signInGuest = () => signInAnonymously(auth);
