// Shared loaders for the lazily-imported route components.
//
// App.tsx wraps these in React.lazy, and the Header calls the same function to
// warm a chunk before the user commits to the navigation. Because a dynamic
// import is memoised by the module system, the prefetch and the later lazy()
// resolve to the exact same promise — the click then renders from cache
// instead of waiting on the network.
export const loadLogin = () => import("../features/auth/Login");
export const loadReportIssue = () => import("../features/reporting/ReportIssue");
export const loadTrackCase = () => import("../features/tracking/TrackCase");

let idlePrefetched = false;

/** Fetch a route chunk ahead of time, ignoring failures — this is only ever an
 *  optimisation, and the real navigation will retry through Suspense. */
export function prefetchRoute(load: () => Promise<unknown>) {
  load().catch(retryFailedStylesheet);
}

/** Vite requests a route's stylesheet once per page and never again, so one
 *  that failed during a prefetch would leave the real visit unstyled (the JS
 *  is retried, the CSS is not). Request it again now, or once back online. */
function retryFailedStylesheet(error: unknown) {
  const href = error instanceof Error ? /^Unable to preload CSS for (.+)$/.exec(error.message)?.[1] : undefined;
  const failed = href && [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find((link) => link.href === href);
  if (!failed) return;
  const retry = () => failed.replaceWith(failed.cloneNode());
  if (navigator.onLine === false) window.addEventListener("online", retry, { once: true });
  else retry();
}

/** Warm the login chunk once the browser is idle, so the first click on Staff
 *  login is instant rather than paying for the download.
 *
 *  Only the login route is warmed eagerly: it needs nothing beyond Firebase
 *  Auth, which is already loaded. The dispute form pulls in the Functions SDK,
 *  so that one is left to the hover/focus prefetch rather than spent on every
 *  landing-page visitor. */
export function prefetchHeaderRoutesWhenIdle() {
  if (idlePrefetched) return;
  idlePrefetched = true;
  // Speculative downloads cost real money on metered mobile data; leave them to
  // hover/focus when the visitor has asked the browser to save data.
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
  const run = () => prefetchRoute(loadLogin);
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
}

const RELOAD_KEY = "land-dispute:chunk-reload";

/** True for the error a lazy route throws when its chunk cannot be fetched,
 *  most often because a redeploy replaced the hashed file this tab expects.
 *  main.tsx tags the errors Vite reports; the message check covers dev mode. */
export function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (error as Error & { chunkLoadFailed?: boolean }).chunkLoadFailed === true
    || /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message);
}

/** Reload once to pick up the new build. Returns false instead when offline (a
 *  reload would only swap the page for the browser's offline screen) or when
 *  the last attempt was under 10s ago, so a broken build cannot reload-loop. */
export function reloadForNewBuild() {
  if (navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
