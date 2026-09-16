import { Link } from "react-router-dom";

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
    <footer
      style={{
        background: "#040a16",
        color: "rgba(255,255,255,0.7)",
        padding: "2.5rem 2rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "1.5rem",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>&copy; {new Date().getFullYear()} Forest Watch</span>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem" }}>
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none", fontSize: "0.9rem" }}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
