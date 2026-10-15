  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
  import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendEmailVerification, reload } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
  import { getFirestore, doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
  auth.languageCode = "pl"; // maile Firebase (np. potwierdzenie adresu) po polsku
  const db = getFirestore(app);

  // Eksponuj globalnie dla reszty skryptów
  window._fb = { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendEmailVerification, reload, doc, setDoc, getDoc, collection, getDocs, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp, query, where, app };

  // Funkcje serwera (functions/index.js): region musi się zgadzać z REGION w functions/index.js.
  // Moduł ładowany dopiero przy pierwszym wywołaniu.
  const FN_REGION = "europe-west1";
  let fnPromise = null;
  window._fb.callable = function(name){
    if(!fnPromise){
      fnPromise = import("https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js")
        .then(m => ({m, fns: m.getFunctions(app, FN_REGION)}));
    }
    return fnPromise.then(x => x.m.httpsCallable(x.fns, name));
  };

  // Storage (zdjęcia z pamiętnika) ładowany osobno — ewentualny błąd nie może zepsuć logowania ani postępu.
  window._fbStorageReady = import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js").then(function(m){
    window._fb.storage = m.getStorage(app);
    window._fb.sRef = m.ref;
    window._fb.uploadBytes = m.uploadBytes;
    window._fb.getDownloadURL = m.getDownloadURL;
    window._fb.deleteObject = m.deleteObject;
    return true;
  }).catch(function(e){ console.warn('Storage niedostępny', e); return false; });
