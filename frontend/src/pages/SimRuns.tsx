import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  LuArrowLeft,
  LuCheckCircle2,
  LuChevronDown,
  LuChevronRight,
  LuLoader2,
  LuPlay,
  LuTerminal,
  LuTrash2,
  LuXCircle,
} from "react-icons/lu";
import {
  gateApi,
  isTripResult,
  type EdgeScenarioResult,
  type Movement,
  type ScenarioResult,
  type SimRun,
  type SimSuite,
  type StoryKind,
  type TripEventExpect,
  type TripScenarioResult,
} from "../api";
import { AlertList, BarrierBadge, ErrorNote, TripBadge } from "../components";
import { formatDateTime, formatPlate } from "../format";
import { MovementDetail } from "./GateEvents";
import { ScenarioSheetButton } from "./SimScenarioSheet";

/** The threats a story belongs to, in the order the scorecard shows them. */
const CATEGORIES: { key: string; title: string }[] = [
  { key: "identity", title: "Vehicle identity" },
  { key: "sticker", title: "GB RFID sticker" },
  { key: "pass", title: "Pass misuse" },
  { key: "measure", title: "Weight and load" },
  { key: "limits", title: "Contract limits" },
  { key: "evasion", title: "Bypass and force" },
  { key: "officer", title: "Officer actions" },
  { key: "edge", title: "Edge resilience" },
  { key: "control", title: "Honest controls" },
];

const POLL_MS = 2000;

function KindBadge({ kind }: { kind: StoryKind }) {
  const [cls, text] = kind === "honest" ? ["neutral", "Honest"] : kind === "officer" ? ["ok", "Officer"] : ["warn", "Cheat"];
  return <span className={`badge ${cls}`}>{text}</span>;
}

/** One card per threat: cheats caught, honest stories without a false alarm, officer / edge stories passed. */
function CategoryGrid({ results }: { results: ScenarioResult[] }) {
  const cards = CATEGORIES.map((c) => {
    const rs = results.filter((r) => (r.category ?? "") === c.key);
    if (rs.length === 0) return null;
    const cheats = rs.filter((r) => r.kind === "tamper");
    const honest = rs.filter((r) => r.kind === "honest");
    const caught = cheats.filter((r) => (isTripResult(r) ? r.caught : r.pass)).length;
    const passed = rs.filter((r) => r.pass).length;
    const [value, total, what] =
      cheats.length > 0
        ? [caught, cheats.length, "cheats caught"]
        : c.key === "control"
        ? [honest.filter((r) => r.pass).length, honest.length, "passed with no false alarm"]
        : [passed, rs.length, "stories pass"];
    return (
      <div key={c.key} className={`sr-cat ${value === total ? "ok" : "bad"}`}>
        <div className="sr-cat-title">{c.title}</div>
        <div className="sr-cat-num">
          {value}
          <span className="muted">/{total}</span>
        </div>
        <div className="small muted">{what}</div>
      </div>
    );
  });
  return <div className="sr-cats">{cards}</div>;
}

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
  const [suites, setSuites] = useState<SimSuite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => gateApi.simRuns().then(setRuns).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    gateApi.simSuites().then(setSuites).catch((e) => setError(e.message));
  }, []);
  const running = runs.find((r) => r.finished_at == null);
  useEffect(() => {  // follow a run while it is going
    if (!running && !starting) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [running?.id, starting]);
  useEffect(() => {
    if (starting && running) setStarting(null);
  }, [running?.id]);

  const start = async (suite: string) => {
    setError(null);
    setStarting(suite);
    try {
      await gateApi.startSuite(suite);
      load();
    } catch (e) {
      setStarting(null);
      setError((e as Error).message);
    }
  };
  const clear = async () => {
    if (!window.confirm("Delete every scenario run and its gate events, passes, holds, alerts and logs? " +
                        "Gate console sessions, site runs and real gate data are kept.")) return;
    setError(null);
    try {
      await gateApi.clearSimRuns();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const busy = !!running || !!starting;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scenario runs</h1>
          <p className="muted">
            Every known cheat played against the real GB software, one short story each, scored on whether it was
            caught and whether honest trucks passed without a false alarm.
          </p>
        </div>
        <button className="btn sr-clear" onClick={clear} disabled={busy || runs.length === 0}>
          <LuTrash2 /> Clear runs
        </button>
      </div>
      <div className="sr-suites">
        {suites.map((s) => {
          const mine = running?.suite === s.suite ? running : undefined;
          return (
            <div key={s.suite} className="card sr-suite">
              <div>
                <h3>{s.title}</h3>
                <p className="muted small">{s.description}</p>
                <span className="small muted">{s.stories} stories</span>
              </div>
              <button className="btn primary" disabled={busy} onClick={() => start(s.suite)}>
                {mine || starting === s.suite ? <LuLoader2 className="spin" /> : <LuPlay />}
                {mine ? `Running ${mine.results.length}/${s.stories}` : starting === s.suite ? "Starting" : "Run"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="hint small">
        <LuTerminal /> Also from a terminal: <code>docker compose run --rm simulator gate_cheats</code>
      </div>
      <ErrorNote error={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Run</th><th>Suite</th><th>When</th>
            <th>Stories passed</th><th>Cheats caught</th><th>False alarms</th><th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => navigate(`/scenario-runs/${r.id}`)}>
              <td>#{r.id}</td>
              <td>{suites.find((s) => s.suite === r.suite)?.title ?? r.suite}</td>
              <td className="nowrap">{formatDateTime(r.started_at)}</td>
              {r.finished_at == null ? (
                <td colSpan={3} className="muted"><LuLoader2 className="spin" /> running, {r.results.length} stories done</td>
              ) : (
                <>
                  <td className={r.passed === r.total ? "ok-text" : "bad-text"}>{r.passed}/{r.total}</td>
                  <td className={r.tamper_caught === r.tamper_total ? "ok-text" : "bad-text"}>{r.tamper_caught}/{r.tamper_total}</td>
                  <td className={r.false_alarms === 0 ? "ok-text" : "bad-text"}>{r.false_alarms}/{r.honest_total}</td>
                </>
              )}
              <td className="muted"><LuChevronRight /></td>
            </tr>
          ))}
          {runs.length === 0 && <tr><td colSpan={7} className="muted center">No runs yet. Run a suite above.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- detail: edge resilience case
const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));

function EdgeExpanded({ s }: { s: EdgeScenarioResult }) {
  return (
    <div className="scenario-expanded">
      {s.why && <p className="why">{s.why}</p>}
      <div className="scenario-grid">
        <div>
          <div className="field-label">Action</div>
          <div className="mono small">{s.readings.scenario_type ?? "—"}</div>
        </div>
        <div>
          <div className="field-label">Expected</div>
          {Object.entries(s.expected).map(([k, v]) => (
            <div key={k} className="small">{k.replace(/_/g, " ")}: <strong>{show(v)}</strong></div>
          ))}
        </div>
        <div>
          <div className="field-label">What happened</div>
          <div className="small"><strong>{s.actual.result ?? "—"}</strong></div>
        </div>
      </div>
      {s.problems.length > 0 && <ErrorNote error={s.problems.join("; ")} />}
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
                <td className="nowrap">{e.dir === "IN" ? "Entry" : e.dir === "OUT" ? "Exit" : "Officer"}</td>
                <td className="nowrap">
                  {e.dir === "OFFICER" ? (
                    e.vehicle ? <span className="plate plate-sm">{formatPlate(e.vehicle)}</span> : <span className="muted">—</span>
                  ) : (
                    <>
                      {e.readings.plate_read ? <span className="plate plate-sm">{formatPlate(e.readings.plate_read)}</span> : <span className="muted">no plate</span>}
                      <div className="small muted">
                        {e.vehicle !== e.readings.plate_read ? `really ${e.vehicle} · ` : ""}
                        {e.readings.weight_t != null ? `${e.readings.weight_t.toFixed(1)} t` : "no weight"}
                      </div>
                    </>
                  )}
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
                    {e.movement_id != null && movements[e.movement_id] ? <MovementDetail m={movements[e.movement_id]} /> :
                      <p className="muted small">{e.movement_id == null ? "Officer action, no gate event." : `Gate event #${e.movement_id} not loaded.`}</p>}
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

  const load = () => {
    gateApi.simRun(id).then(setRun).catch((e) => setError(e.message));
    gateApi
      .movements({ source_prefix: `sim:${id}:` })
      .then((list) => setMovements(Object.fromEntries(list.map((m) => [m.id, m]))))
      .catch(() => {});
  };
  useEffect(load, [id]);
  const running = run != null && run.finished_at == null;
  useEffect(() => {  // follow the run while it is going
    if (!running) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [running, id]);

  const breakdown = useMemo(() => {
    const decisive: Record<string, number> = {};
    for (const s of run?.results ?? []) {
      if (s.kind !== "tamper" || !isTripResult(s)) continue;
      for (const c of s.actual.caught_by) if (s.expected.alerts.includes(c)) decisive[c] = (decisive[c] ?? 0) + 1;
    }
    return decisive;
  }, [run]);

  if (error)
    return (
      <>
        <p><Link className="back-link" to="/scenario-runs"><LuArrowLeft /> Scenario runs</Link></p>
        <ErrorNote
          error={error === "Run not found" ? `Run #${id} no longer exists: the runs were cleared. Open a current run from the list.` : error}
        />
      </>
    );
  if (!run) return <p className="muted">Loading…</p>;

  const missed = run.tamper_total - run.tamper_caught;
  const tripResults = run.results.filter(isTripResult);
  const edgeResults = run.results.filter((r): r is EdgeScenarioResult => !isTripResult(r));
  const officer = run.results.filter((r) => r.kind === "officer");

  return (
    <>
      <p><Link className="back-link" to="/scenario-runs"><LuArrowLeft /> Scenario runs</Link></p>
      <div className="page-head">
        <div>
          <h1>Run #{run.id} · {run.suite}</h1>
          <p className="muted">
            {formatDateTime(run.started_at)}
            {running && <> · <LuLoader2 className="spin" /> running, {run.results.length} stories done</>}
          </p>
        </div>
      </div>

      <div className="stats stats-6">
        <Tile label="Stories passed" value={run.passed} total={run.total} tone={run.passed === run.total ? "ok" : "bad"} />
        <Tile label="Cheat stories" value={run.tamper_total} />
        <Tile label="Cheats caught" value={run.tamper_caught} total={run.tamper_total} tone={missed === 0 ? "ok" : "bad"} />
        <Tile label="Honest stories" value={run.honest_total} />
        <Tile label="False alarms" value={run.false_alarms} total={run.honest_total}
              tone={run.false_alarms === 0 ? "ok" : "bad"} />
        <Tile label="Officer stories" value={officer.filter((r) => r.pass).length} total={officer.length}
              tone={officer.every((r) => r.pass) ? "ok" : "bad"} />
      </div>

      <div className="card">
        <header className="card-head"><h3>By threat</h3></header>
        <CategoryGrid results={run.results} />
      </div>

      {Object.keys(breakdown).length > 0 && (
        <div className="card">
          <header className="card-head"><h3>Which alert exposed each cheat</h3></header>
          <div className="breakdown">
            {Object.entries(breakdown).map(([c, n]) => (
              <span key={c} className="chip chip-main">{c} <strong>{n}</strong></span>
            ))}
          </div>
        </div>
      )}

      {tripResults.length > 0 && (
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
                  <td>
                    <div className="td-name">
                      {s.name} <ScenarioSheetButton title={`${s.id} · ${s.name}`} sheet={s.sheet} />
                    </div>
                  </td>
                  <td><KindBadge kind={s.kind} /></td>
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
      )}

      {edgeResults.length > 0 && (
        <table className="table">
          <thead>
            <tr><th /><th>#</th><th>Case</th><th>Type</th><th>What happened</th><th>Result</th></tr>
          </thead>
          <tbody>
            {edgeResults.map((s) => (
              <Fragment key={s.id}>
                <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <td className="muted">{open === s.id ? <LuChevronDown /> : <LuChevronRight />}</td>
                  <td className="nowrap">{s.id}</td>
                  <td>
                    <div className="td-name">
                      {s.name} <ScenarioSheetButton title={`${s.id} · ${s.name}`} sheet={s.sheet} />
                    </div>
                  </td>
                  <td><KindBadge kind={s.kind} /></td>
                  <td className="small mono">{s.actual.result ?? "—"}</td>
                  <td><PassTag pass={s.pass} /></td>
                </tr>
                {open === s.id && (
                  <tr className="detail-row">
                    <td />
                    <td colSpan={5}><EdgeExpanded s={s} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
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
