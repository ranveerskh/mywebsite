import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDr6kRdTjdLEoq0398g1bN4D4a9Fm-CMfo",
  authDomain: "bareworld.firebaseapp.com",
  projectId: "bareworld",
  storageBucket: "bareworld.firebasestorage.app",
  messagingSenderId: "1010059894849",
  appId: "1:1010059894849:web:58976414fe92490d5766c0"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };