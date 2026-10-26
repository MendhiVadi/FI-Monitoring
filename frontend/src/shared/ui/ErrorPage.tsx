import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface ErrorPageProps {
  code?: string;
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorPage({
  code = "404",
  title = "Page not found",
  message = "The page you requested does not exist or may have moved.",
  onRetry,
}: ErrorPageProps) {
  // A missing page is not an emergency, so the card is not an assertive alert;
  // moving focus to the heading is what tells a screen reader where it landed.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="error-page-title">
        <div style={styles.code} aria-hidden="true">{code}</div>
        <p style={styles.eyebrow}>LAND DISPUTE</p>
        <h1 id="error-page-title" ref={headingRef} tabIndex={-1} data-route-focus="" style={styles.title}>{title}</h1>
        <p style={styles.message}>{message}</p>
        <div style={styles.actions}>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn btn-primary">
              Try again
            </button>
          )}
          {onRetry ? (
            <Link to="/" className="btn btn-secondary">Return home</Link>
          ) : (
            <>
              <Link to="/report" className="btn btn-primary">Report a dispute</Link>
              <Link to="/" className="btn btn-secondary">Return home</Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unexpected application error", error, info);
  }

  private retry = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorPage
          code="ERROR"
          title="Something went wrong"
          message="We couldn't complete that request. If you were submitting a report, look for a reference number before resubmitting."
          onRetry={this.retry}
        />
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "7rem 1rem 4rem",
    display: "grid",
    placeItems: "center",
    background: "radial-gradient(circle at 50% 20%, #123525 0%, #06100c 48%, #040a16 100%)",
  },
  card: {
    width: "min(100%, 620px)",
    padding: "clamp(2rem, 7vw, 4rem)",
    textAlign: "center",
    border: "1px solid rgba(123, 216, 159, 0.28)",
    borderRadius: 24,
    background: "rgba(5, 18, 13, 0.88)",
    boxShadow: "0 28px 80px rgba(0, 0, 0, 0.45)",
  },
  code: {
    fontSize: "clamp(5rem, 22vw, 9rem)",
    lineHeight: 0.9,
    fontWeight: 900,
    letterSpacing: "-0.08em",
    color: "rgba(123, 216, 159, 0.12)",
  },
  eyebrow: {
    margin: "1.5rem 0 0.65rem",
    color: "#7bd89f",
    letterSpacing: "0.18em",
    fontSize: "0.76rem",
    fontWeight: 800,
  },
  title: { fontSize: "clamp(2rem, 7vw, 3.5rem)", lineHeight: 1.05, overflowWrap: "anywhere" },
  message: { margin: "1rem auto 0", maxWidth: 440, opacity: 0.72, lineHeight: 1.7 },
  actions: { marginTop: "2rem", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "0.75rem" },
};
