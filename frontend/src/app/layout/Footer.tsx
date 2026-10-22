import { NavLink } from "react-router-dom";
import "./layout.css";

const LINKS = [
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
      <nav className="site-footer__nav" aria-label="Legal and information">
        <ul>
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink to={link.to}>{link.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
