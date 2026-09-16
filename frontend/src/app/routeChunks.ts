// Shared loaders for the lazily-imported route components.
//
// App.tsx wraps these in React.lazy, and the Header calls the same function to
// warm a chunk before the user commits to the navigation. Because a dynamic
// import is memoised by the module system, the prefetch and the later lazy()
// resolve to the exact same promise — the click then renders from cache
// instead of waiting on the network.
export const loadLogin = () => import("../features/auth/Login");
export const loadReportIssue = () => import("../features/reporting/ReportIssue");

let idlePrefetched = false;

/** Fetch a route chunk ahead of time, ignoring failures — this is only ever an
 *  optimisation, and the real navigation will retry through Suspense. */
export function prefetchRoute(load: () => Promise<unknown>) {
  load().catch(() => {});
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
  const run = () => prefetchRoute(loadLogin);
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1500);
  }
}
