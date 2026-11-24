import { Fragment, useEffect, useState } from "react";
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
  LuX,
  LuXCircle,
} from "react-icons/lu";
import {
  gateApi,
  isTripResult,
  type EdgeScenarioResult,
  type Movement,
  type SimRun,
  type SimSuite,
  type StoryKind,
  type TripEventExpect,
  type TripScenarioResult,
} from "../api";
import { ErrorNote } from "../components";
import { formatDateTime } from "../format";
import { ScenarioSheetButton } from "./SimScenarioSheet";
import { StoryTimeline, type TimelineStep } from "./StoryTimeline";
import { Scorecard, StatusBadge, type Cost, type Pick, type ScoreItem, type Status } from "./Scorecard";

const POLL_MS = 2000;

/** What each suite is judged against (the first line of its scorecard). */
const JUDGED: Record<string, string> = {
  gate_cheats: "Regression: every rule we built, judged against its own design. Everything should be covered.",
  threat_coverage: "Threat coverage: every P0 / P1 cheat, judged against what the GB should do, built or not. "
    + "What isn't covered is the work still to do.",
  mixed_batch: "Mixed batch: 300 stories in a shuffled order, cheats and honest trips together, each judged against "
    + "what the GB should do. Built from the regression and threat stories with other trucks, plus generated honest trips.",
  edge_resilience: "Edge resilience: failover, WAN loss, disaster recovery, snapshots and reconciliation, each judged "
    + "against its specified behaviour.",
};

function KindBadge({ kind }: { kind: StoryKind }) {
  const [cls, text] = kind === "honest" ? ["neutral", "Honest"] : kind === "officer" ? ["ok", "Officer"] : ["warn", "Cheat"];
  return <span className={`badge ${cls}`}>{text}</span>;
}

function PassTag({ pass }: { pass: boolean }) {
  return (
    <span className={pass ? "pass-tag" : "fail-tag"}>
      {pass ? <LuCheckCircle2 /> : <LuXCircle />} {pass ? "Pass" : "Fail"}
    </span>
  );
}

// ---------------------------------------------------------------- list
/** A run that stopped before all of its suite's stories were played (e.g. the backend went down mid-run). */
function interrupted(r: SimRun, suites: SimSuite[]) {
  const n = suites.find((x) => x.suite === r.suite)?.stories;
  return r.finished_at != null && n != null && r.results.length < n;
}

function RunList() {
  const [runs, setRuns] = useState<SimRun[]>([]);
  const [suites, setSuites] = useState<SimSuite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
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
      {(() => {
        // one launcher: pick a suite, run it (while a run is going, it shows that one)
        const name = running?.suite ?? starting ?? (chosen || suites[0]?.suite || "");
        const su = suites.find((x) => x.suite === name);
        return (
          <div className="card sr-launcher">
            <div className="sr-launcher-row">
              <label className="sr-launcher-pick">
                Suite
                <select value={name} disabled={busy} onChange={(e) => setChosen(e.target.value)}>
                  {suites.map((x) => <option key={x.suite} value={x.suite}>{x.title}</option>)}
                </select>
              </label>
              <button className="btn primary" disabled={busy || !su} onClick={() => su && start(su.suite)}>
                {busy ? <LuLoader2 className="spin" /> : <LuPlay />}
                {running ? `Running ${running.results.length}/${su?.stories ?? "?"}` : starting ? "Starting" : "Run"}
              </button>
            </div>
            {su && (
              <div className="sr-launcher-about">
                <p className="muted small">{su.description}</p>
                <span className="small muted">{su.stories} stories</span>
              </div>
            )}
          </div>
        );
      })()}
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
              ) : interrupted(r, suites) ? (
                <td colSpan={3} className="muted">interrupted after {r.results.length} of {suites.find((x) => x.suite === r.suite)?.stories} stories</td>
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
    (e as { rejected?: boolean }).rejected ? "rejected (no pole sent it)" : null,
    e.not_alerts?.length ? `not ${e.not_alerts.join(", ")}` : null,
  ].filter(Boolean).join(" · ") || "—";

/** One gate event in plain words: where, what was read, what the driver showed, what the GB decided. */
function gateText(e: TripScenarioResult["events"][number]) {
  const a = e.actual;
  const read = e.readings.plate_read ?? "no plate";
  const really = e.vehicle && e.vehicle !== e.readings.plate_read ? `, really ${e.vehicle.replace(/_/g, " ")}` : "";
  const shown = e.dir === "OUT" && e.readings.shown ? `, shows ${e.readings.shown}` : "";
  let outcome: string;
  if (a.barrier === "up") {
    outcome = e.dir === "IN" ? (a.pass_issued ? `let in, pass ${a.pass_issued} issued` : "let through")
      : a.trip ? `let out, ${a.trip.toLowerCase()} trip` : "let out";
  } else {
    outcome = "barrier stays down";
    if (e.readings.forced) outcome += `, broke through${a.trip === "ILLEGAL" ? ": illegal trip" : ""}`;
  }
  return `${e.dir === "IN" ? "Entry" : "Exit"} gate: read ${read}${really}${shown}, ${outcome}`;
}

function storySteps(s: TripScenarioResult): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const e of s.events) {
    const alerts = e.actual.alerts.map((x) => x.code);
    const hasExpect = Object.keys(e.expected ?? {}).length > 0;
    if (e.dir === "OFFICER") {
      steps.push({ at: e.at, kind: "officer", text: `Officer ${e.note ?? ""}`, movement: e.movement_id, alerts,
                   expected: hasExpect ? expectText(e.expected) : undefined, pass: e.pass });
      continue;
    }
    if (e.dir === "UNSEEN") {
      steps.push({ at: e.at, kind: "unseen", text: e.note ?? "" });
      continue;
    }
    if (e.dir === "INSIDER" || e.dir === "VENDOR") {
      steps.push({ at: e.at, kind: "officer", text: e.dir === "INSIDER" ? `Insider: ${e.note ?? ""}` : `Vendor: ${e.note ?? ""}`,
                   alerts, expected: hasExpect ? expectText(e.expected) : undefined, pass: e.pass });
      continue;
    }
    if ((e.actual as { not_delivered?: boolean }).not_delivered) {
      steps.push({ at: e.at, kind: "unseen", text: `${e.dir === "IN" ? "Entry" : "Exit"} gate, ${e.note ?? "pole offline"}` });
      continue;
    }
    if (e.note) steps.push({ at: "", kind: "unseen", text: e.note });
    steps.push({ at: e.at, kind: "gate", text: gateText(e), movement: e.movement_id, alerts,
                 expected: expectText(e.expected), pass: e.pass });
  }
  return steps;
}

function TripExpanded({ s, movements }: { s: TripScenarioResult; movements: Record<number, Movement> }) {
  const L = s.ledger;
  return (
    <div className="scenario-expanded">
      {s.why && (
        <p className="sr-cheat-story">
          {s.why}
          {s.rules && <span className="muted"> Rules {s.rules}.</span>}
          {s.real_case && <span className="muted"> ({s.real_case})</span>}
        </p>
      )}
      <StoryTimeline steps={storySteps(s)} movements={movements} />
      {s.problems.length > 0 && <ErrorNote error={s.problems.join("; ")} />}
      <div className="small muted" style={{ marginTop: 8 }}>
        Permit after the story: {L.trips_reserved}/{L.trip_limit} trips reserved, {L.legal_trips} legal,{" "}
        {L.actual_trips} actual, {L.illegal_trips} illegal · {L.tonnes} t of {L.tonne_limit} t · {L.active_holds} truck(s) on hold
      </div>
    </div>
  );
}

/** Any scenario run in the shared scorecard's terms: one status per story / case, and the cost. */
function score(run: SimRun): { items: ScoreItem[]; cost: Cost } {
  const tripResults = run.results.filter(isTripResult);
  const edgeResults = run.results.filter((r): r is EdgeScenarioResult => !isTripResult(r));
  const status = (r: TripScenarioResult) => (r.coverage ?? (r.pass ? "covered" : "gap")) as Status;
  const items: ScoreItem[] = [
    ...tripResults.map((r) => ({
      id: r.id, name: `${r.id} ${r.name}`, area: r.category ?? "control", priority: r.priority ?? null, status: status(r),
      cls: (r.kind === "tamper" ? "cheat" : r.kind === "honest" ? "honest" : "other") as ScoreItem["cls"],
    })),
    ...edgeResults.map((r) => ({
      id: r.id, name: `${r.id} ${r.name}`, area: r.category ?? "edge", status: (r.pass ? "covered" : "gap") as Status,
      // same classes as the story table's Honest / Cheat / Officer badges
      cls: (r.kind === "tamper" ? "cheat" : r.kind === "honest" ? "honest" : "other") as ScoreItem["cls"],
    })),
  ];
  const sum = (f: (r: TripScenarioResult) => number) => tripResults.reduce((a, r) => a + f(r), 0);
  const hasTruth = tripResults.some((r) => r.really_moved);
  const cost: Cost = {
    ...(hasTruth
      ? {
          trips: { missed: sum((r) => Math.max(0, (r.really_moved?.trips ?? 0) - (r.gb_recorded?.trips ?? 0))),
                   of: sum((r) => r.really_moved?.trips ?? 0) },
          tonnes: { missed: sum((r) => Math.max(0, (r.really_moved?.tonnes ?? 0) - (r.gb_recorded?.tonnes ?? 0))),
                    of: sum((r) => r.really_moved?.tonnes ?? 0) },
        }
      : {}),
  };
  return { items, cost };
}

/** The records of a run: one row per story (or edge case), opening into what happened. */
function RecordTables({ trip, edge, threatRun, movements }: {
  trip: TripScenarioResult[]; edge: EdgeScenarioResult[]; threatRun: boolean; movements: Record<number, Movement>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {trip.length > 0 && (
        <table className="table">
          <thead>
            {threatRun ? (
              <tr><th /><th>Case</th><th>Story</th><th>Priority</th><th>Ideal alerts</th><th>Alerts raised</th><th>Really moved / GB recorded</th><th>Coverage</th></tr>
            ) : (
              <tr><th /><th>#</th><th>Story</th><th>Type</th><th>Events</th><th>Expected alerts</th><th>Alerts raised</th><th>Status</th></tr>
            )}
          </thead>
          <tbody>
            {trip.map((s) => (
              <Fragment key={s.id}>
                <tr className="clickable" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  <td className="muted">{open === s.id ? <LuChevronDown /> : <LuChevronRight />}</td>
                  <td className="nowrap">{s.id}</td>
                  <td>
                    <div className="td-name">
                      {s.name} <ScenarioSheetButton title={`${s.id} · ${s.name}`} sheet={s.sheet} />
                    </div>
                  </td>
                  {threatRun ? (
                    <>
                      <td className="nowrap">{s.priority ?? "—"} · {s.threat}</td>
                      <td className="small mono">{s.expected.alerts.join(", ") || "none"}</td>
                      <td className="small mono">{s.actual.caught_by.join(", ") || "none"}</td>
                      <td className="nowrap">
                        {s.really_moved?.trips ?? 0} / {s.gb_recorded?.trips ?? 0} trips
                        <div className="small muted">{s.really_moved?.tonnes ?? 0} / {s.gb_recorded?.tonnes ?? 0} t</div>
                      </td>
                      <td><StatusBadge s={s.coverage as Status} /></td>
                    </>
                  ) : (
                    <>
                      <td><KindBadge kind={s.kind} /></td>
                      <td>{s.events.length}</td>
                      <td className="small mono">{s.expected.alerts.join(", ") || "none"}</td>
                      <td className="small mono">{s.actual.caught_by.join(", ") || "none"}</td>
                      <td><StatusBadge s={(s.coverage ?? (s.pass ? "covered" : "gap")) as Status} /></td>
                    </>
                  )}
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

      {edge.length > 0 && (
        <table className="table">
          <thead>
            <tr><th /><th>#</th><th>Case</th><th>Type</th><th>What happened</th><th>Result</th></tr>
          </thead>
          <tbody>
            {edge.map((s) => (
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

function RunDetail({ id }: { id: number }) {
  const [run, setRun] = useState<SimRun | null>(null);
  const [movements, setMovements] = useState<Record<number, Movement>>({});
  const [pick, setPick] = useState<Pick | null>(null);
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

  const tripResults = run.results.filter(isTripResult);
  const threatRun = tripResults.some((r) => r.coverage && r.threat);
  const edgeResults = run.results.filter((r): r is EdgeScenarioResult => !isTripResult(r));
  const { items, cost } = score(run);

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

      <Scorecard judgedAgainst={JUDGED[run.suite] ?? "Judged against each story's expected outcome."}
                 items={items} unit={edgeResults.length && !tripResults.length ? "cases" : "stories"} cost={cost}
                 onPick={setPick} />

      {pick && (
        <div className="modal-backdrop" onClick={() => setPick(null)}>
          <div className="modal td-modal" onClick={(e) => e.stopPropagation()}>
            <div className="td-top">
              <h3>{pick.title} <span className="muted small">({pick.ids.length})</span></h3>
              <button className="btn small" onClick={() => setPick(null)} title="Close"><LuX /></button>
            </div>
            {pick.ids.length === 0 ? <p className="muted">None in this run.</p> : (
              <>
                <p className="small muted">Click a record to see what happened, step by step.</p>
                <RecordTables trip={tripResults.filter((r) => pick.ids.includes(r.id))}
                              edge={edgeResults.filter((r) => pick.ids.includes(r.id))}
                              threatRun={threatRun} movements={movements} />
              </>
            )}
          </div>
        </div>
      )}

      <RecordTables trip={tripResults} edge={edgeResults} threatRun={threatRun} movements={movements} />
    </>
  );
}

export default function SimRuns() {
  const { id } = useParams();
  return id ? <RunDetail id={Number(id)} /> : <RunList />;
}
