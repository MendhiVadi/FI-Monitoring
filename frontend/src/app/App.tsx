import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Header } from "./layout/Header";
import { Footer } from "./layout/Footer";
import { ErrorPage } from "../shared/ui/ErrorPage";
import { isChunkLoadError, loadLogin, loadReportIssue, loadTrackCase, reloadForNewBuild } from "./routeChunks";

// Home is lazy like every other route. Importing it eagerly pulled three.js,
// React Three Fiber, drei and GSAP into the entry chunk, so an officer opening
// /login or a reporter opening /report downloaded the entire 3D globe first.
const Home = lazy(() => import("../features/home/Home").then((m) => ({ default: m.Home })));
const FraMonitoring = lazy(() => import("../features/fra-demo/FraMonitoring").then(m => ({ default: m.FraMonitoring })));
const ReportIssue = lazy(() => loadReportIssue().then((m) => ({ default: m.ReportIssue })));
const TrackCase = lazy(() => loadTrackCase().then((m) => ({ default: m.TrackCase })));
const Tickets = lazy(() => import("../features/tickets/Tickets").then((m) => ({ default: m.Tickets })));
const Login = lazy(() => loadLogin().then((m) => ({ default: m.Login })));
const ProtectedRoute = lazy(() => import("../features/auth/ProtectedRoute").then((m) => ({ default: m.ProtectedRoute })));
const OfficerPortal = lazy(() => import("../features/officer-portal/OfficerPortal").then((m) => ({ default: m.OfficerPortal })));
const Insights = lazy(() => import("../features/officer-portal/Insights").then((m) => ({ default: m.Insights })));
const PrivacyPolicy = lazy(() => import("../features/legal/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("../features/legal/TermsOfUse").then((m) => ({ default: m.TermsOfUse })));
const Accessibility = lazy(() => import("../features/legal/Accessibility").then((m) => ({ default: m.Accessibility })));
const FairUsePolicy = lazy(() => import("../features/legal/FairUsePolicy").then((m) => ({ default: m.FairUsePolicy })));
const ContactUs = lazy(() => import("../features/legal/ContactUs").then((m) => ({ default: m.ContactUs })));
const DatasetLinks = lazy(() => import("../features/legal/DatasetLinks").then((m) => ({ default: m.DatasetLinks })));

const SITE_NAME = "Land Dispute";

// One name per route, used for the tab title and the navigation announcement.
const PAGE_NAMES: Record<string, string> = {
  "/": "",
  "/report": "Report a dispute",
  "/track": "Track a report",
  "/fra-monitoring": "FRA claims demonstration",
  "/login": "Staff sign-in",
  "/tickets": "Case tickets",
  "/officer-portal": "Staff portal",
  "/officer-portal/insights": "Staff insights",
  "/portal": "Staff portal",
  "/privacy-policy": "Privacy policy",
  "/terms-of-use": "Terms of use",
  "/accessibility": "Accessibility",
  "/fair-use-policy": "Fair use policy",
  "/contact": "Contact us",
  "/datasets": "Dataset links",
};

// React Router matches paths case-insensitively, so /Report is the report page.
function pageName(pathname: string) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PAGE_NAMES[path.toLowerCase()] ?? "Page not found";
}

// React Router keeps the window's scroll position across route changes, so
// clicking a header link from halfway down the landing page dropped you into
// the middle of the next page — usually onto blank space above the form,
// which read as the navigation having hung. Reset on every path change, and
// give every route its own tab title.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const name = pageName(pathname);
    document.title = name ? `${name} · ${SITE_NAME}` : SITE_NAME;
  }, [pathname]);
  return null;
}

// Module scope rather than a ref, so StrictMode's double effect and a route
// boundary remount do not count as a navigation.
let lastFocusedPath: string | null = null;

// A client-side navigation leaves focus on the link that was clicked, so a
// screen reader hears nothing about the new page. Rendered inside Suspense, the
// effect runs only once the new route has committed: move focus to its main
// heading (or the main region) and announce the page name politely. The first
// load is left alone so the skip link stays the first stop, and a page that
// already placed focus inside its main (an autoFocus control) keeps it.
function RouteFocus({ pathname }: { pathname: string }) {
  useEffect(() => {
    if (lastFocusedPath === null || lastFocusedPath === pathname) {
      lastFocusedPath = pathname;
      return;
    }
    lastFocusedPath = pathname;
    const main = document.querySelector("main");
    const target = main && !main.contains(document.activeElement) ? main.querySelector<HTMLElement>("h1, h2") ?? main : null;
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.setAttribute("data-route-focus", "");
      target.focus({ preventScroll: true });
    }
    const announcer = document.getElementById("route-announcer");
    if (announcer) {
      announcer.textContent = "";
      window.setTimeout(() => { announcer.textContent = pageName(pathname) || `${SITE_NAME} home`; }, 100);
    }
  }, [pathname]);
  return null;
}

// Fast route loads should not flash a loading state, and slow ones should not
// look like a blank page, so the message appears only after 250ms. The status
// region exists from the start (a live region inserted together with its text
// is often not announced), and main is not aria-busy, which would mute it.
function RouteLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="route-loading">
      <p role="status">
        {visible && (
          <>
            <span className="route-loading__spinner" aria-hidden="true" />
            Loading page…
          </>
        )}
      </p>
    </main>
  );
}

// Skips the fixed header. Every route renders its own <main>, so the target
// is found at click time rather than through a fixed id.
function focusMain(event: React.MouseEvent<HTMLAnchorElement>) {
  const main = document.querySelector("main");
  if (!main) return;
  event.preventDefault();
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.setAttribute("data-route-focus", "");
  main.focus();
}

// Keeps a failed route (typically a lazy chunk that could not download) inside
// the page chrome with a retry, instead of the app-wide boundary replacing the
// header and footer. A stale chunk after a redeploy reloads once to pick up
// the new build. Navigating to another path clears the failure.
type RouteBoundaryState = { failed: boolean; reloading: boolean; key: string };
class RouteBoundary extends Component<{ resetKey: string; children: ReactNode }, RouteBoundaryState> {
  state: RouteBoundaryState = { failed: false, reloading: false, key: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { resetKey: string }, state: RouteBoundaryState) {
    return props.resetKey === state.key ? null : { failed: false, reloading: false, key: props.resetKey };
  }
  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadForNewBuild()) this.setState({ reloading: true });
  }
  render() {
    if (this.state.reloading) return <RouteLoading />;
    return this.state.failed ? (
      <ErrorPage
        code="ERROR"
        title="This page could not load"
        message="Check your connection and try again. If you were submitting a report, look for a reference number before resubmitting."
        onRetry={() => window.location.reload()}
      />
    ) : this.props.children;
  }
}

export default function App() {
  const location = useLocation();
  const isIndependentPortal = location.pathname.startsWith("/officer-portal") || location.pathname.startsWith("/portal");

  return (
    <>
      <ScrollToTop />
      <a className="skip-link" href="#main" onClick={focusMain}>Skip to main content</a>
      {!isIndependentPortal && <Header />}
      <RouteBoundary resetKey={location.pathname}>
      <Suspense fallback={<RouteLoading />}>
        <RouteFocus pathname={location.pathname} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<ReportIssue />} />
          {/* Public: shows status and document requests only, never PII. */}
          <Route path="/track" element={<TrackCase />} />
          <Route path="/fra-monitoring" element={<FraMonitoring />} />
          <Route path="/login" element={<Login />} />
          {/* Lists every dispute ticket, including reporter PII — officer-only,
              matching the read rule enforced in firestore.rules. */}
          <Route path="/tickets" element={<ProtectedRoute><Tickets /></ProtectedRoute>} />
          {/* Viewers browse a masked registry through the callables (firestore.rules
              deny them raw ticket reads); every write inside stays officer+. */}
          <Route path="/officer-portal" element={<ProtectedRoute minAccess="viewer"><OfficerPortal /></ProtectedRoute>} />
          {/* Aggregate counts only, so read-only viewers may open it too. */}
          <Route path="/officer-portal/insights" element={<ProtectedRoute minAccess="viewer"><Insights /></ProtectedRoute>} />
          <Route path="/portal" element={<ProtectedRoute minAccess="viewer"><OfficerPortal /></ProtectedRoute>} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-use" element={<TermsOfUse />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="/fair-use-policy" element={<FairUsePolicy />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/datasets" element={<DatasetLinks />} />
          <Route path="*" element={<ErrorPage />} />
        </Routes>
      </Suspense>
      </RouteBoundary>
      {!isIndependentPortal && <Footer />}
      <p id="route-announcer" className="visually-hidden" aria-live="polite" aria-atomic="true" />
    </>
  );
}
