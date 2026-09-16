import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { app, useEmulators } from "./firebase";

// Split out of ./firebase so the Firestore SDK is only pulled in by the code
// that actually reads documents — the officer routes and the allow-list
// lookup, which imports this module dynamically once someone is signed in.
export const db = getFirestore(app);
if (useEmulators) connectFirestoreEmulator(db, "127.0.0.1", 8080);
