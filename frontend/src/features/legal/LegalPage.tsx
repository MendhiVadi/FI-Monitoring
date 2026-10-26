import type { ReactNode } from "react";
import { StaticPage } from "../../shared/ui/StaticPage";
import "./legal.css";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <StaticPage title={title}>
      <div className="legal-content">{children}</div>
    </StaticPage>
  );
}

// Internal pages use <Link> (no full reload, so an unsent report draft and
// phone verification survive); only off-site links open a new tab.
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}<span className="legal-sr-only"> (opens in new tab)</span>
    </a>
  );
}
