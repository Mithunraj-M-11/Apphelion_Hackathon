import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  LuArrowLeft,
  LuCheckCircle2,
  LuChevronDown,
  LuChevronRight,
  LuTerminal,
  LuXCircle,
} from "react-icons/lu";
import { gateApi, type Movement, type ScenarioResult, type SimRun } from "../api";
import { ErrorNote, ResultBadge } from "../components";
import { CHECK_LABEL, decisiveCheck, formatDateTime, formatPlate } from "../format";
import { MovementDetail } from "./GateEvents";

const label = (c: string) => CHECK_LABEL[c] ?? c;

function Tile({ label, value, total, tone }: { label: string; value: number; total?: number; tone?: "ok" | "bad" }) {
  return (
    <div className="stat">
      <div className={`stat-num ${tone === "ok" ? "ok-text" : tone === "bad" ? "bad-text" : ""}`}>
        {value}
        {total != null && <span className="muted stat-of">/{total}</span>}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function PassTag({ pass }: { pass: boolean }) {
  return (
    <span className={pass ? "pass-tag" : "fail-tag"}>
      {pass ? <LuCheckCircle2 /> : <LuXCircle />} {pass ? "Pass" : "Fail"}
    </span>
  );
}

// ---------------------------------------------------------------- list
function RunList() {
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    gateApi.simRuns().then(setRuns).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scenario runs</h1>
          <p className="muted">
            Simulated tampering at the gate, scored against the whole system: was each tampering case caught, and
            did honest trucks pass without false alarms? Click a run for its scorecard.
          </p>
        </div>
      </div>
      <div className="hint">
        <LuTerminal /> Run a suite: <code>docker compose run --rm simulator identify_basic</code>
      </div>
      <ErrorNote error={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Run</th><th>Suite</th><th>Mode</th><th>When</th>
            <th>Scenarios passed</th><th>Tampering caught</th><th>False alarms</th><th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => navigate(`/scenario-runs/${r.id}`)}>
              <td>#{r.id}</td>
              <td>{r.suite}</td>
              <td>{r.identify_mode}</td>
              <td className="nowrap">{formatDateTime(r.started_at)}</td>
              <td className={r.passed === r.total ? "ok-text" : "bad-text"}>{r.passed}/{r.total}</td>
              <td className={r.tamper_caught === r.tamper_total ? "ok-text" : "bad-text"}>{r.tamper_caught}/{r.tamper_total}</td>
              <td className={r.false_alarms === 0 ? "ok-text" : "bad-text"}>{r.false_alarms}/{r.honest_total}</td>
              <td className="muted"><LuChevronRight /></td>
            </tr>
          ))}
          {runs.length === 0 && <tr><td colSpan={8} className="muted center">No runs yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- detail
function ScenarioExpanded({ s, movement }: { s: ScenarioResult; movement: Movement | undefined }) {
  return (
    <div className="scenario-expanded">
      {s.why && <p className="why">{s.why}{s.real_case && <span className="muted"> ({s.real_case})</span>}</p>}
      <div className="scenario-grid">
        <div>
          <div className="field-label">Sensors reported</div>
          <div>Plate: {s.readings.plate_read ? <span className="plate plate-sm">{formatPlate(s.readings.plate_read)}</span> : <span className="muted">none</span>}</div>
          <div>FASTag: <span className="mono small">{s.readings.fastag_read ? `${s.readings.fastag_read.slice(0, 12)}…` : "none"}</span></div>
          <div>Length: {s.readings.radar_length_m?.toFixed(2)} m</div>
        </div>
        <div>
          <div className="field-label">Expected</div>
          <ResultBadge result={s.expected.result} />
          <div className="small">caught by: {(s.expected.caught_by ?? []).map(label).join(", ") || "nothing (honest)"}</div>
          {s.expected.not_caught_by && <div className="small">not by: {s.expected.not_caught_by.map(label).join(", ")}</div>}
        </div>
        <div>
          <div className="field-label">Actual</div>
          <ResultBadge result={s.actual.result} />
          <div className="small">caught by: {s.actual.caught_by.map(label).join(", ") || "nothing"}</div>
        </div>
      </div>
      {s.problems.length > 0 && <ErrorNote error={s.problems.join("; ")} />}
      <div className="field-label" style={{ marginTop: 14 }}>Gate event</div>
      {movement ? <MovementDetail m={movement} /> : <p className="muted small">Gate event #{s.movement_id} not loaded.</p>}
    </div>
  );
}

function RunDetail({ id }: { id: number }) {
  const [run, setRun] = useState<SimRun | null>(null);
  const [movements, setMovements] = useState<Record<number, Movement>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gateApi.simRun(id).then(setRun).catch((e) => setError(e.message));
    gateApi
      .movements({ source_prefix: `sim:${id}:` })
      .then((list) => setMovements(Object.fromEntries(list.map((m) => [m.id, m]))))
      .catch(() => {});
  }, [id]);

  const breakdown = useMemo(() => {
    const decisive: Record<string, number> = {};
    const supporting: Record<string, number> = {};
    for (const s of run?.results ?? []) {
      if (s.kind !== "tamper") continue;
      const main = decisiveCheck(s.actual.result, s.actual.caught_by);
      if (main) decisive[main] = (decisive[main] ?? 0) + 1;
      for (const c of s.actual.caught_by) if (c !== main) supporting[c] = (supporting[c] ?? 0) + 1;
    }
    return { decisive, supporting };
  }, [run]);

  if (error) return <ErrorNote error={error} />;
  if (!run) return <p className="muted">Loading…</p>;

  const missed = run.tamper_total - run.tamper_caught;
  return (
    <>
      <p><Link className="back-link" to="/scenario-runs"><LuArrowLeft /> Scenario runs</Link></p>
      <div className="page-head">
        <div>
          <h1>Run #{run.id} · {run.suite}</h1>
          <p className="muted">Identify mode: {run.identify_mode} · {formatDateTime(run.started_at)}</p>
        </div>
      </div>

      <div className="stats stats-6">
        <Tile label="Scenarios passed" value={run.passed} total={run.total} tone={run.passed === run.total ? "ok" : "bad"} />
        <Tile label="Honest trips" value={run.honest_total} />
        <Tile label="Tampering cases" value={run.tamper_total} />
        <Tile label="Tampering caught" value={run.tamper_caught} total={run.tamper_total}
              tone={missed === 0 ? "ok" : "bad"} />
        <Tile label="Tampering missed" value={missed} tone={missed === 0 ? "ok" : "bad"} />
        <Tile label="False alarms" value={run.false_alarms} total={run.honest_total}
              tone={run.false_alarms === 0 ? "ok" : "bad"} />
      </div>

      <div className="card">
        <header className="card-head"><h3>Caught by: which check did the work</h3></header>
        <div className="breakdown">
          {Object.entries(breakdown.decisive).map(([c, n]) => (
            <span key={c} className="chip chip-main">{label(c)} <strong>{n}</strong></span>
          ))}
          {Object.keys(breakdown.decisive).length === 0 && <span className="muted">No tampering caught.</span>}
        </div>
        {Object.keys(breakdown.supporting).length > 0 && (
          <div className="breakdown">
            <span className="muted small">Supporting evidence:</span>
            {Object.entries(breakdown.supporting).map(([c, n]) => (
              <span key={c} className="chip">{label(c)} <strong>{n}</strong></span>
            ))}
          </div>
        )}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th /><th>#</th><th>Scenario</th><th>Type</th><th>Expected</th><th>Actual</th><th>Caught by</th><th>Result</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((s) => {
            const main = decisiveCheck(s.actual.result, s.actual.caught_by);
            return (
              <Fragment key={s.id}>
                <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <td className="muted">{open === s.id ? <LuChevronDown /> : <LuChevronRight />}</td>
                  <td className="nowrap">{s.id}</td>
                  <td>{s.name}</td>
                  <td><span className={`badge ${s.kind === "honest" ? "neutral" : "warn"}`}>{s.kind === "honest" ? "Honest" : "Tamper"}</span></td>
                  <td><ResultBadge result={s.expected.result} /></td>
                  <td><ResultBadge result={s.actual.result} /></td>
                  <td className="small">{main ? <strong>{label(main)}</strong> : "—"}</td>
                  <td><PassTag pass={s.pass} /></td>
                </tr>
                {open === s.id && (
                  <tr className="detail-row">
                    <td />
                    <td colSpan={7}><ScenarioExpanded s={s} movement={movements[s.movement_id]} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function SimRuns() {
  const { id } = useParams();
  return id ? <RunDetail id={Number(id)} /> : <RunList />;
}
