const configuredApiOrigin = (import.meta.env.VITE_API_BASE_URL || "").trim();

const apiOrigin = configuredApiOrigin
  ? configuredApiOrigin.replace(/\/$/, "")
  : import.meta.env.PROD && (window.location.hostname === "localhost" || /\.(web\.app|firebaseapp\.com)$/.test(window.location.hostname))
    ? "https://forest-watch-eight.vercel.app"
    : "";

/** Build a URL that works both on the website and in the bundled Android app. */
export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
}
