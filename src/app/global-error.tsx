"use client";

// App-Router globaler Fehler-Handler (ersetzt die Pages-Router-500-Seite, die
// sonst beim Build den <Html>-Importfehler auslöst). Muss <html>/<body> rendern.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  return (
    <html lang="de">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", background: "#fff" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 56, fontWeight: 800, color: "#FFC400", margin: 0 }}>500</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 8 }}>Etwas ist schiefgelaufen</h1>
          <p style={{ color: "#6b7280", marginTop: 4 }}>Bitte versuchen Sie es erneut.</p>
          <button
            onClick={() => reset()}
            style={{ marginTop: 24, padding: "12px 20px", borderRadius: 16, background: "#FFC400", color: "#111827", fontWeight: 800, border: 0, cursor: "pointer" }}
          >
            Neu laden
          </button>
        </div>
      </body>
    </html>
  );
}
