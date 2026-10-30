import { NavLink } from "react-router-dom";
import { loadTrackCase, prefetchRoute } from "../routeChunks";
import "./layout.css";

// Warmed on hover/focus like the header's report link: the tracking page is a
// lazy route, and the legal pages are small enough not to need it.
const prefetchTrack = () => prefetchRoute(loadTrackCase);

const LINKS: { to: string; label: string; prefetch?: () => void }[] = [
  { to: "/track", label: "Track a Report", prefetch: prefetchTrack },
  { to: "/privacy-policy", label: "Privacy Policy" },
  { to: "/terms-of-use", label: "Terms of Use" },
  { to: "/accessibility", label: "Accessibility" },
  { to: "/fair-use-policy", label: "Fair Use Policy" },
  { to: "/contact", label: "Contact Us" },
  { to: "/datasets", label: "Dataset Links" },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <span>&copy; {new Date().getFullYear()} Land Dispute</span>
      <nav className="site-footer__nav" aria-label="Tracking, legal and information">
        <ul>
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} onMouseEnter={link.prefetch} onFocus={link.prefetch}>{link.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
