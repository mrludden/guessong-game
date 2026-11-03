// Firebase project configuration.
// Replace these placeholder values with the config from Firebase Console:
// Project settings > General > Your apps > SDK setup and configuration.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
};

export const firebaseConfigured = !Object.values(firebaseConfig).some(value => value.includes("YOUR_"));
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const signInGuest = () => signInAnonymously(auth);