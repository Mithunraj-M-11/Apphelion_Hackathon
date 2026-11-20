import { useEffect, useState } from "react";

type Health = { status: string; database: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Aphelion: GB Monitoring Dashboard</h1>
      <p>Starter page. Backend status:</p>
      <pre>{error ? `error: ${error}` : health ? JSON.stringify(health, null, 2) : "loading..."}</pre>
    </main>
  );
}
