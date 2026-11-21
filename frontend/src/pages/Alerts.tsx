import { useCallback, useEffect, useState } from "react";
import { LuRefreshCw } from "react-icons/lu";
import { gateApi, type Alert } from "../api";
import { ErrorNote, SeverityBadge } from "../components";
import { formatDateTime } from "../format";
import { SourceLink } from "./GateEvents";

/** Every alert the GB system raised (newest first). Review workflow (acknowledge / confirm / dismiss) comes later. */
export default function Alerts() {
  const [rows, setRows] = useState<Alert[]>([]);
  const [severity, setSeverity] = useState("");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    gateApi
      .alerts({ severity, origin })
      .then((d) => {
        setRows(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [severity, origin]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const counts = rows.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.severity]: (acc[a.severity] ?? 0) + 1 }), {});

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p className="muted">
            Everything the GB system flagged: refusals, pass misuse, weight problems, forced barriers and illegal trips.
            Alerts are never deleted.
          </p>
        </div>
        <button className="btn" onClick={load}><LuRefreshCw /> Refresh</button>
      </div>

      <div className="stats">
        {(["CRITICAL", "HIGH", "MEDIUM", "INFO"] as const).map((s) => (
          <div key={s} className="stat">
            <div className={`stat-num ${s === "CRITICAL" || s === "HIGH" ? "bad-text" : s === "MEDIUM" ? "warn-text" : ""}`}>{counts[s] ?? 0}</div>
            <div className="stat-label">{s.toLowerCase()}</div>
          </div>
        ))}
      </div>

      <div className="filters">
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option value="">All sources</option>
          <option value="real">Real poles</option>
          <option value="sim">Simulator runs</option>
          <option value="walkthrough">Walkthrough</option>
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="INFO">Info</option>
        </select>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr><th>When</th><th>Severity</th><th>Alert</th><th>What happened</th><th>Gate event</th><th>Source</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{formatDateTime(a.created_at)}</td>
              <td><SeverityBadge severity={a.severity} /></td>
              <td className="mono small nowrap">{a.code}</td>
              <td className="small">{a.message}</td>
              <td className="small">{a.movement_id ? `#${a.movement_id}` : "—"}</td>
              <td className="small nowrap"><SourceLink source={a.source} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted center">No alerts.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
