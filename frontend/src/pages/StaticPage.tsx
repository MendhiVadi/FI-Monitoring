interface StaticPageProps {
  title: string;
  children: React.ReactNode;
}

export function StaticPage({ title, children }: StaticPageProps) {
  return (
    <main style={{ minHeight: "70vh", padding: "8rem 2rem 4rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>{title}</h1>
      <div style={{ opacity: 0.85, marginTop: "1rem", lineHeight: 1.6 }}>{children}</div>
    </main>
  );
}
