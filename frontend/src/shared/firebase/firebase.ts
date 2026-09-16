import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

export const useEmulators = import.meta.env.DEV && import.meta.env.MODE === "emulator";
const firebaseConfig = useEmulators ? { apiKey: "demo-forestwatch-key", authDomain: "localhost", projectId: "demo-forestwatch", appId: "demo-forestwatch" } : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Only the app and Auth live here. Firestore and Functions are initialised in
// ./firestore and ./functions instead, so importing `auth` (which the Header
// does on every page, including the landing page) no longer drags both of
// those SDKs into the initial bundle.
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
if (useEmulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
