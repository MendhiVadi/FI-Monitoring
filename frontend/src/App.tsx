import { Suspense, lazy } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { ErrorPage } from "./pages/ErrorPage";

const ReportIssue = lazy(() => import("./pages/ReportIssue").then((m) => ({ default: m.ReportIssue })));
const Tickets = lazy(() => import("./pages/Tickets").then((m) => ({ default: m.Tickets })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute").then((m) => ({ default: m.ProtectedRoute })));
const OfficerPortal = lazy(() => import("./pages/OfficerPortal").then((m) => ({ default: m.OfficerPortal })));
const PrivacyPolicy = lazy(() => import("./pages/legal/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("./pages/legal/TermsOfUse").then((m) => ({ default: m.TermsOfUse })));
const Accessibility = lazy(() => import("./pages/legal/Accessibility").then((m) => ({ default: m.Accessibility })));
const FairUsePolicy = lazy(() => import("./pages/legal/FairUsePolicy").then((m) => ({ default: m.FairUsePolicy })));
const ContactUs = lazy(() => import("./pages/legal/ContactUs").then((m) => ({ default: m.ContactUs })));
const DatasetLinks = lazy(() => import("./pages/legal/DatasetLinks").then((m) => ({ default: m.DatasetLinks })));

export default function App() {
  const location = useLocation();
  const isIndependentPortal = location.pathname.startsWith("/officer-portal") || location.pathname.startsWith("/portal");

  return (
    <>
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
          <Route path="/login" element={<Login />} />
          <Route path="/tickets" element={<Tickets />} />
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
