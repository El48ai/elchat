import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

// GANTI dari Firebase Console -> Project settings -> Web app
export const firebaseConfig = {
  apiKey: "ISI_API_KEY",
  authDomain: "ISI_AUTH_DOMAIN",
  projectId: "ISI_PROJECT_ID",
  storageBucket: "ISI_STORAGE_BUCKET",
  messagingSenderId: "ISI_SENDER_ID",
  appId: "ISI_APP_ID",
  databaseURL: "ISI_DATABASE_URL_REALTIME_DB"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);

export async function ensureAnonAuth(){
  if (auth.currentUser) return auth.currentUser;
  const res = await signInAnonymously(auth);
  return res.user;
}
