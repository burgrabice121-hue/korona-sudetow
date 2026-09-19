  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, arrayUnion, arrayRemove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDcx8nF7_cS30n7jBSPJ9iN3_Utl8cxHg8",
    authDomain: "korona-sudetow-fd77c.firebaseapp.com",
    projectId: "korona-sudetow-fd77c",
    storageBucket: "korona-sudetow-fd77c.firebasestorage.app",
    messagingSenderId: "371345372300",
    appId: "1:371345372300:web:7367e90be9926f4ac5b7a9"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Eksponuj globalnie dla reszty skryptów
  window._fb = { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, doc, setDoc, getDoc, collection, getDocs, updateDoc, arrayUnion, arrayRemove, serverTimestamp };
