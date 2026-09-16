import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Header } from "./layout/Header";
import { Footer } from "./layout/Footer";
import { ErrorPage } from "../shared/ui/ErrorPage";
import { loadLogin, loadReportIssue } from "./routeChunks";

// Home is lazy like every other route. Importing it eagerly pulled three.js,
// React Three Fiber, drei and GSAP into the entry chunk, so an officer opening
// /login or a reporter opening /report downloaded the entire 3D globe first.
const Home = lazy(() => import("../features/home/Home").then((m) => ({ default: m.Home })));
const FraMonitoring = lazy(() => import("../features/fra-demo/FraMonitoring").then(m => ({ default: m.FraMonitoring })));
const ReportIssue = lazy(() => loadReportIssue().then((m) => ({ default: m.ReportIssue })));
const Tickets = lazy(() => import("../features/tickets/Tickets").then((m) => ({ default: m.Tickets })));
const Login = lazy(() => loadLogin().then((m) => ({ default: m.Login })));
const ProtectedRoute = lazy(() => import("../features/auth/ProtectedRoute").then((m) => ({ default: m.ProtectedRoute })));
const OfficerPortal = lazy(() => import("../features/officer-portal/OfficerPortal").then((m) => ({ default: m.OfficerPortal })));
const PrivacyPolicy = lazy(() => import("../features/legal/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("../features/legal/TermsOfUse").then((m) => ({ default: m.TermsOfUse })));
const Accessibility = lazy(() => import("../features/legal/Accessibility").then((m) => ({ default: m.Accessibility })));
const FairUsePolicy = lazy(() => import("../features/legal/FairUsePolicy").then((m) => ({ default: m.FairUsePolicy })));
const ContactUs = lazy(() => import("../features/legal/ContactUs").then((m) => ({ default: m.ContactUs })));
const DatasetLinks = lazy(() => import("../features/legal/DatasetLinks").then((m) => ({ default: m.DatasetLinks })));

// React Router keeps the window's scroll position across route changes, so
// clicking a header link from halfway down the landing page dropped you into
// the middle of the next page — usually onto blank space above the form,
// which read as the navigation having hung. Reset on every path change.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const location = useLocation();
  const isIndependentPortal = location.pathname.startsWith("/officer-portal") || location.pathname.startsWith("/portal");

  return (
    <>
      <ScrollToTop />
      {!isIndependentPortal && <Header />}
      <Suspense
        fallback={
          <main
            style={{
              minHeight: "70vh",
              display: "grid",
              placeItems: "center",
              padding: "7rem 2rem 4rem",
              color: "#173b2b",
            }}
          >
            <p role="status" aria-live="polite">Loading Forest Watch…</p>
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<ReportIssue />} />
          <Route path="/fra-monitoring" element={<FraMonitoring />} />
          <Route path="/login" element={<Login />} />
          {/* Lists every dispute ticket, including reporter PII — officer-only,
              matching the read rule enforced in firestore.rules. */}
          <Route path="/tickets" element={<ProtectedRoute><Tickets /></ProtectedRoute>} />
          <Route path="/officer-portal" element={<ProtectedRoute><OfficerPortal /></ProtectedRoute>} />
          <Route path="/portal" element={<ProtectedRoute><OfficerPortal /></ProtectedRoute>} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-use" element={<TermsOfUse />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="/fair-use-policy" element={<FairUsePolicy />} />
          <Route path="/contact" element={<ContactUs />} />
          <Route path="/datasets" element={<DatasetLinks />} />
          <Route path="*" element={<ErrorPage />} />
        </Routes>
      </Suspense>
      {!isIndependentPortal && <Footer />}
    </>
  );
}
