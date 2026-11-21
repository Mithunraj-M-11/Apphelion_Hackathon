import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LuChevronDown, LuChevronRight, LuRefreshCw } from "react-icons/lu";
import { gateApi, type Movement } from "../api";
import { AlertList, BarrierBadge, CheckList, ErrorNote, ResultBadge, SeverityBadge, StepList, TripBadge } from "../components";
import { CHECK_LABEL, formatDateTime, formatPlate, isWalkthroughSource, parseSimSource, RESULT_LABEL } from "../format";

export function SourceLink({ source }: { source: string | null }) {
  const sim = parseSimSource(source);
  if (isWalkthroughSource(source)) return <Link to="/gate-console" onClick={(e) => e.stopPropagation()}>Walkthrough</Link>;
  if (!sim) return <span className="muted">Pole</span>;
  return (
    <Link to={`/scenario-runs/${sim.runId}`} onClick={(e) => e.stopPropagation()}>
      Run #{sim.runId} · {sim.scenario}
    </Link>
  );
}

/** Expanded view of one gate event: claimed identity, flags and every check. */
export function MovementDetail({ m }: { m: Movement }) {
  return (
    <div className="detail-grid">
      <div>
        <div className="field-label">Claimed identity</div>
        {m.truck ? (
          <Link to={`/registry/${m.truck.id}`}>{formatPlate(m.truck.plate, m.truck.plate_type)} (registry)</Link>
        ) : (
          <span className="muted">No registered truck matched</span>
        )}
        {m.flags.length > 0 && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Flags</div>
            <div>{m.flags.map((f) => <span key={f} className="badge neutral">{f.replace("_", " ")}</span>)}</div>
          </>
        )}
        <div className="field-label" style={{ marginTop: 10 }}>Gate event</div>
        <div className="small">#{m.id} · {m.gate} {m.direction === "IN" ? "entry" : "exit"} · mode {m.identify_mode}
          {m.weight_t != null ? ` · weigh pad ${m.weight_t.toFixed(2)} t` : " · no weight"}</div>
        {m.barrier && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Decision</div>
            <div className="badges-row"><BarrierBadge barrier={m.barrier} forced={m.barrier_forced} /> <TripBadge trip={m.trip} /></div>
          </>
        )}
        {m.pass && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Pass</div>
            <div className="small">
              <strong>{m.pass.code}</strong> · {m.pass.status}
              {m.pass.net_t != null && ` · net ${m.pass.net_t.toFixed(2)} t`}
              {m.pass.close_mode && ` · closed by ${m.pass.close_mode.replace("_", " ")}`}
            </div>
          </>
        )}
        {m.alerts.length > 0 && (
          <>
            <div className="field-label" style={{ marginTop: 10 }}>Alerts</div>
            <AlertList alerts={m.alerts} />
          </>
        )}
      </div>
      {m.steps ? <StepList steps={m.steps} /> : <CheckList checks={m.checks} />}
    </div>
  );
}

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "INFO"];
const topAlert = (m: Movement) =>
  [...m.alerts].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))[0];

export default function GateEvents() {
  const [rows, setRows] = useState<Movement[]>([]);
  const [result, setResult] = useState("");
  const [origin, setOrigin] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    gateApi
      .movements({ result, origin })
      .then((d) => {
        setRows(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [result, origin]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // near-live feed
    return () => clearInterval(t);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gate events</h1>
          <p className="muted">
            Every vehicle the GB poles observed: what the sensors read, how Identify decided, and what the gate did
            (pass, barrier, alerts). This is the operational view, with no answer key. Click a row for every step.
          </p>
        </div>
        <button className="btn" onClick={load}><LuRefreshCw /> Refresh</button>
      </div>

      <div className="filters">
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option value="">All sources</option>
          <option value="pole">Real poles</option>
          <option value="sim">Simulator runs</option>
          <option value="walkthrough">Walkthrough</option>
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">All results</option>
          {Object.entries(RESULT_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr>
            <th />
            <th>When</th>
            <th>Gate</th>
            <th>Plate read</th>
            <th>FASTag</th>
            <th>Length</th>
            <th>Identify</th>
            <th>Barrier</th>
            <th>Top alert</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <Fragment key={m.id}>
              <tr className="clickable" onClick={() => setOpen(open === m.id ? null : m.id)}>
                <td className="muted">{open === m.id ? <LuChevronDown /> : <LuChevronRight />}</td>
                <td className="nowrap">{formatDateTime(m.observed_at)}</td>
                <td className="nowrap">{m.gate} · {m.direction}</td>
                <td>{m.plate_read ? <span className="plate plate-sm">{formatPlate(m.plate_normalised ?? m.plate_read)}</span> : <span className="muted">none</span>}</td>
                <td className="mono small">{m.fastag_read ? `${m.fastag_read.slice(0, 10)}…` : <span className="muted">none</span>}</td>
                <td className="nowrap">{m.radar_length_m != null ? `${m.radar_length_m.toFixed(2)} m` : "—"}</td>
                <td><ResultBadge result={m.result} /></td>
                <td><BarrierBadge barrier={m.barrier} forced={m.barrier_forced} /></td>
                <td className="small nowrap">{topAlert(m) ? <><SeverityBadge severity={topAlert(m)!.severity} /> {topAlert(m)!.code}</> : (m.caught_by.map((c) => CHECK_LABEL[c] ?? c).join(", ") || "—")}</td>
                <td className="small nowrap"><SourceLink source={m.source} /></td>
              </tr>
              {open === m.id && (
                <tr className="detail-row">
                  <td />
                  <td colSpan={9}><MovementDetail m={m} /></td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={10} className="muted center">No gate events yet. Run a scenario suite to generate some.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
