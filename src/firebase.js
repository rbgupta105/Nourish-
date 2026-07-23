import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCWdHnjbECVElXTRL9R7-ZJ2ICCN88UfGs",
  authDomain: "nourish-7d929.firebaseapp.com",
  projectId: "nourish-7d929",
  storageBucket: "nourish-7d929.firebasestorage.app",
  messagingSenderId: "280639878923",
  appId: "1:280639878923:web:209940c1916b2731e2d40e",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
