import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./app/global.css";
import App from "./app/App.tsx";
import { AppErrorBoundary } from "./shared/ui/ErrorPage.tsx";

// After a redeploy, an open tab still references the previous build's hashed
// chunks, which no longer exist, so the next lazy route fails to load. Vite
// reports each failed chunk here; tag the error and let it propagate. The route
// boundary then reloads once for a route that really failed to render, while a
// failed hover/idle prefetch is swallowed by its own catch. Reloading from this
// listener directly would wipe a half-filled form whenever a prefetch failed.
window.addEventListener("vite:preloadError", (event) => {
  const error = (event as Event & { payload?: unknown }).payload;
  if (error instanceof Error) (error as Error & { chunkLoadFailed?: boolean }).chunkLoadFailed = true;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </BrowserRouter>
  </StrictMode>
);
