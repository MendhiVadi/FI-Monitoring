import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { app, useEmulators } from "./firebase";
import { ensureAppCheck } from "./appCheck";

// Split out of ./firebase so the Functions SDK ships only in the route chunks
// that call a callable (dispute submission, status tracking and the officer
// portal). App Check starts first, so the very first call already carries a token.
ensureAppCheck();
export const functions = getFunctions(app);
if (useEmulators) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
