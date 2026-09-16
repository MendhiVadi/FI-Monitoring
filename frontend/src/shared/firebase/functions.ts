import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { app, useEmulators } from "./firebase";

// Split out of ./firebase so the Functions SDK ships only in the route chunks
// that call a callable (dispute submission and the officer portal).
export const functions = getFunctions(app);
if (useEmulators) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
