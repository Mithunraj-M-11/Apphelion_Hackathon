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
import {
  gateApi,
  isTripResult,
  type Movement,
  type SimRun,
  type SingleScenarioResult,
  type TripEventExpect,
  type TripScenarioResult,
} from "../api";
import { AlertList, BarrierBadge, ErrorNote, ResultBadge, TripBadge } from "../components";
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
            Simulated cheating at the gates, scored against the whole system: was each trick caught, and did honest
            trucks pass without false alarms? Click a run for its scorecard.
          </p>
        </div>
      </div>
      <div className="hint">
        <LuTerminal /> Run a suite: <code>docker compose run --rm simulator trip_basic</code> (full trips) or{" "}
        <code>identify_basic</code> (Identify only)
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

// ---------------------------------------------------------------- detail: Identify-only scenario
function ScenarioExpanded({ s, movement }: { s: SingleScenarioResult; movement: Movement | undefined }) {
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

// ---------------------------------------------------------------- detail: full-trip story
const expectText = (e: TripEventExpect) =>
  [
    e.barrier && `barrier ${e.barrier}`,
    e.pass_issued != null && (e.pass_issued ? "pass issued" : "no pass"),
    e.trip && `${e.trip.toLowerCase()} trip`,
    e.result,
    e.alerts?.length ? `alerts ${e.alerts.join(", ")}` : null,
    e.not_alerts?.length ? `not ${e.not_alerts.join(", ")}` : null,
  ].filter(Boolean).join(" · ") || "—";

function TripExpanded({ s, movements }: { s: TripScenarioResult; movements: Record<number, Movement> }) {
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const L = s.ledger;
  return (
    <div className="scenario-expanded">
      {s.why && (
        <p className="why">
          {s.why}
          {s.rules && <span className="muted"> Rules {s.rules}.</span>}
          {s.real_case && <span className="muted"> ({s.real_case})</span>}
        </p>
      )}
      <table className="table table-inner">
        <thead>
          <tr><th>#</th><th>Time</th><th>Gate</th><th>Vehicle</th><th>Shown / note</th><th>Expected</th><th>What happened</th><th>Check</th></tr>
        </thead>
        <tbody>
          {s.events.map((e) => (
            <Fragment key={e.n}>
              <tr className="clickable" onClick={() => setOpenEvent(openEvent === e.n ? null : e.n)}>
                <td>{e.n}</td>
                <td className="nowrap">{e.at}</td>
                <td className="nowrap">{e.dir === "IN" ? "Entry" : "Exit"}</td>
                <td className="nowrap">
                  {e.readings.plate_read ? <span className="plate plate-sm">{formatPlate(e.readings.plate_read)}</span> : <span className="muted">no plate</span>}
                  <div className="small muted">
                    {e.vehicle !== e.readings.plate_read ? `really ${e.vehicle} · ` : ""}
                    {e.readings.weight_t != null ? `${e.readings.weight_t.toFixed(1)} t` : "no weight"}
                  </div>
                </td>
                <td className="small">
                  {e.dir === "OUT" && <div>Shows: {e.readings.shown}</div>}
                  {e.readings.forced && <div className="bad-text">Forces the barrier</div>}
                  {e.note && <div className="muted">{e.note}</div>}
                </td>
                <td className="small">{expectText(e.expected)}</td>
                <td>
                  <div className="badges-row">
                    <BarrierBadge barrier={e.actual.barrier} />
                    {e.actual.pass_issued && <span className="badge neutral">{e.actual.pass_issued} issued</span>}
                    <TripBadge trip={e.actual.trip} />
                  </div>
                  <div style={{ marginTop: 6 }}><AlertList alerts={e.actual.alerts} /></div>
                </td>
                <td><PassTag pass={e.pass} /></td>
              </tr>
              {openEvent === e.n && (
                <tr className="detail-row">
                  <td colSpan={8}>
                    {e.problems.length > 0 && <ErrorNote error={e.problems.join("; ")} />}
                    {movements[e.movement_id] ? <MovementDetail m={movements[e.movement_id]} /> :
                      <p className="muted small">Gate event #{e.movement_id} not loaded.</p>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {s.problems.length > 0 && <ErrorNote error={s.problems.join("; ")} />}
      <div className="small muted" style={{ marginTop: 8 }}>
        Permit ledger after the story: trips {L.trips_reserved}/{L.trip_limit} reserved, {L.legal_trips} legal,{" "}
        {L.actual_trips} actual, {L.illegal_trips} illegal · {L.tonnes} t of {L.tonne_limit} t ·{" "}
        {L.active_holds} truck(s) on hold
      </div>
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
      if (isTripResult(s)) {
        for (const c of s.actual.caught_by) {
          const bucket = s.expected.alerts.includes(c) ? decisive : supporting;
          bucket[c] = (bucket[c] ?? 0) + 1;
        }
        continue;
      }
      const main = decisiveCheck(s.actual.result, s.actual.caught_by);
      if (main) decisive[main] = (decisive[main] ?? 0) + 1;
      for (const c of s.actual.caught_by) if (c !== main) supporting[c] = (supporting[c] ?? 0) + 1;
    }
    return { decisive, supporting };
  }, [run]);

  if (error) return <ErrorNote error={error} />;
  if (!run) return <p className="muted">Loading…</p>;

  const missed = run.tamper_total - run.tamper_caught;
  const trips = run.results.length > 0 && isTripResult(run.results[0]);
  const name = (c: string) => (trips ? c : label(c));
  const tripResults = run.results.filter(isTripResult);
  const singleResults = run.results.filter((r): r is SingleScenarioResult => !isTripResult(r));

  return (
    <>
      <p><Link className="back-link" to="/scenario-runs"><LuArrowLeft /> Scenario runs</Link></p>
      <div className="page-head">
        <div>
          <h1>Run #{run.id} · {run.suite}</h1>
          <p className="muted">
            {trips ? "Full-trip stories (entry, pass, exit)" : "Identify only"} · identify mode {run.identify_mode} ·{" "}
            {formatDateTime(run.started_at)}
          </p>
        </div>
      </div>

      <div className="stats stats-6">
        <Tile label={trips ? "Stories passed" : "Scenarios passed"} value={run.passed} total={run.total}
              tone={run.passed === run.total ? "ok" : "bad"} />
        <Tile label={trips ? "Honest stories" : "Honest trips"} value={run.honest_total} />
        <Tile label={trips ? "Cheat stories" : "Tampering cases"} value={run.tamper_total} />
        <Tile label="Tampering caught" value={run.tamper_caught} total={run.tamper_total}
              tone={missed === 0 ? "ok" : "bad"} />
        <Tile label="Tampering missed" value={missed} tone={missed === 0 ? "ok" : "bad"} />
        <Tile label="False alarms" value={run.false_alarms} total={run.honest_total}
              tone={run.false_alarms === 0 ? "ok" : "bad"} />
      </div>

      <div className="card">
        <header className="card-head">
          <h3>{trips ? "Caught by: which alert exposed each trick" : "Caught by: which check did the work"}</h3>
        </header>
        <div className="breakdown">
          {Object.entries(breakdown.decisive).map(([c, n]) => (
            <span key={c} className="chip chip-main">{name(c)} <strong>{n}</strong></span>
          ))}
          {Object.keys(breakdown.decisive).length === 0 && <span className="muted">No tampering caught.</span>}
        </div>
        {Object.keys(breakdown.supporting).length > 0 && (
          <div className="breakdown">
            <span className="muted small">Supporting evidence:</span>
            {Object.entries(breakdown.supporting).map(([c, n]) => (
              <span key={c} className="chip">{name(c)} <strong>{n}</strong></span>
            ))}
          </div>
        )}
      </div>

      {trips ? (
        <table className="table">
          <thead>
            <tr><th /><th>#</th><th>Story</th><th>Type</th><th>Events</th><th>Expected alerts</th><th>Alerts raised</th><th>Result</th></tr>
          </thead>
          <tbody>
            {tripResults.map((s) => (
              <Fragment key={s.id}>
                <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <td className="muted">{open === s.id ? <LuChevronDown /> : <LuChevronRight />}</td>
                  <td className="nowrap">{s.id}</td>
                  <td>{s.name}</td>
                  <td><span className={`badge ${s.kind === "honest" ? "neutral" : "warn"}`}>{s.kind === "honest" ? "Honest" : "Cheat"}</span></td>
                  <td>{s.events.length}</td>
                  <td className="small mono">{s.expected.alerts.join(", ") || "none"}</td>
                  <td className="small mono">{s.actual.caught_by.join(", ") || "none"}</td>
                  <td><PassTag pass={s.pass} /></td>
                </tr>
                {open === s.id && (
                  <tr className="detail-row">
                    <td />
                    <td colSpan={7}><TripExpanded s={s} movements={movements} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th /><th>#</th><th>Scenario</th><th>Type</th><th>Expected</th><th>Actual</th><th>Caught by</th><th>Result</th>
            </tr>
          </thead>
          <tbody>
            {singleResults.map((s) => {
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
      )}
    </>
  );
}

export default function SimRuns() {
  const { id } = useParams();
  return id ? <RunDetail id={Number(id)} /> : <RunList />;
}
