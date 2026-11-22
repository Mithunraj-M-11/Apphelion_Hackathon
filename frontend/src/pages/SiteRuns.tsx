import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LuArrowLeft, LuChevronDown, LuChevronRight, LuLoader2, LuPlay, LuTerminal, LuTrash2, LuX } from "react-icons/lu";
import {
  api,
  gateApi,
  siteApi,
  type Contract,
  type Movement,
  type Permit,
  type SiteCheat,
  type SiteDay,
  type SiteReport,
  type SiteRun,
  type SiteScenario,
} from "../api";
import { ErrorNote, SeverityBadge } from "../components";
import { formatDateTime } from "../format";
import { MovementDetail } from "./GateEvents";

const fmt = (n: number, digits = 0) => n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const CHEAT_LABEL: Record<string, string> = {
  quota_push: "Kept going after the quota",
  side_track_both: "Side track in and out",
  side_track_out: "Pass at entry, left by side track",
  side_track_in_gate_out: "Side track in, gate out",
  unregistered: "Unregistered truck",
  clone: "Clone while real truck inside",
  pass_reuse: "Old pass reused",
  pass_handover: "Pass handed to another truck",
  forged_qr: "Forged / edited QR",
  night_trip: "Night trip",
  overload: "Overload",
  arrive_loaded: "Arrived already loaded",
  weigh_bypass: "Weigh pad skipped",
};

/** What each cheat is, in one line: the setup a viewer needs before the gate events make sense. */
const CHEAT_STORY: Record<string, string> = {
  quota_push: "The trip limit is used up, so the GB stops issuing passes; the Vendor's truck tries to keep working anyway.",
  side_track_both: "Comes in and leaves by side tracks, never touching a GB gate.",
  side_track_out: "Gets a pass at the entry gate, then leaves loaded by a side track instead of the exit gate.",
  side_track_in_gate_out: "Comes in by a side track (skipping the entry gate, so it never gets a pass), then leaves through a GB exit.",
  unregistered: "A truck that is not in the GB registry tries to work on the site.",
  clone: "The real truck is inside on a pass; a copy wearing its plate, FASTag and a copied sticker arrives at the entry.",
  pass_reuse: "Leaves legally on its pass, comes back in by a side track, reloads, and shows the same QR again.",
  pass_handover: "A truck with a pass hands its QR to another truck that came in by a side track.",
  forged_qr: "Comes in by a side track and shows an edited copy of a real QR at the exit.",
  night_trip: "Tries to work outside the permitted hours.",
  overload: "A legal trip, but loaded well above the truck's rated capacity.",
  arrive_loaded: "Brings material in from outside, so it would leave with more than it loaded here.",
  weigh_bypass: "A legal trip that drives round the exit weigh pad, so the load is never weighed.",
};

function Tile({ label, value, sub, tone, onClick }: { label: string; value: string | number; sub?: string;
                tone?: "ok" | "warn" | "bad"; onClick?: () => void }) {
  return (
    <div className={`stat${onClick ? " sr-tile-click" : ""}`} onClick={onClick} role={onClick ? "button" : undefined}
         title={onClick ? "Show the list behind this number" : undefined}>
      <div className={`stat-num ${tone ? `${tone}-text` : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- daily chart
const SERIES: { key: keyof SiteDay; label: string; color: string }[] = [
  { key: "true_trips", label: "Ground truth", color: "var(--series-1)" },
  { key: "gb_actual", label: "GB actual", color: "var(--series-2)" },
  { key: "gb_legal", label: "GB legal", color: "var(--series-3)" },
  { key: "vendor_trips", label: "Vendor reported", color: "var(--series-4)" },
];

/** Trips per day: what really left vs what the GB saw vs what was legal vs what the Vendor claimed. */
function DailyChart({ days }: { days: SiteDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 260, L = 40, R = 118, T = 12, B = 28;
  const max = Math.max(4, ...days.flatMap((d) => SERIES.map((s) => Number(d[s.key]))));
  const step = max <= 10 ? 2 : max <= 40 ? 10 : max <= 100 ? 20 : 50;
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (days.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (days.length - 1));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const colW = (W - L - R) / Math.max(1, days.length - 1);

  // direct labels at the line ends, nudged apart so they never collide
  const last = days.length - 1;
  const ends = SERIES.map((s) => ({ ...s, y: y(Number(days[last][s.key])) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;

  return (
    <div className="sr-chart-wrap">
      <div className="sr-legend">
        {SERIES.map((s) => <span key={s.label}><span className="sr-key" style={{ background: s.color }} /> {s.label}</span>)}
      </div>
      <svg className="sr-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trips per day by source">
        {ticks.map((t) => (
          <g key={t}>
            <line className="sr-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="sr-axis-text" x={L - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <text key={d.day} className="sr-axis-text" x={x(i)} y={H - 8} textAnchor="middle">{dayLabel(d.day)}</text>
        ))}
        {hover != null && <line className="sr-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />}
        {SERIES.map((s) => (
          <g key={s.label}>
            <polyline className="sr-line" style={{ stroke: s.color }}
                      points={days.map((d, i) => `${x(i)},${y(Number(d[s.key]))}`).join(" ")} />
            {days.map((d, i) => (
              <circle key={d.day} className="sr-dot" cx={x(i)} cy={y(Number(d[s.key]))} r={hover === i ? 5 : 4}
                      style={{ fill: s.color }} />
            ))}
          </g>
        ))}
        {ends.map((e) => (
          <text key={e.label} className="sr-label" x={W - R + 10} y={e.y + 4}>{e.label} {fmt(Number(days[last][e.key]))}</text>
        ))}
        {days.map((d, i) => (
          <rect key={d.day} className="sr-hit" x={x(i) - colW / 2} y={T} width={colW} height={H - T - B}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover != null && (
        <div className="sr-tip" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
          <strong>{dayLabel(days[hover].day)}</strong>
          {SERIES.map((s) => (
            <div key={s.label} className="sr-tip-row">
              <span className="sr-key" style={{ background: s.color }} /><span>{s.label}</span>
              <strong>{fmt(Number(days[hover][s.key]))}</strong>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 4 }}>
            {days[hover].gb_illegal} illegal, {days[hover].invisible_trips} never at a gate, {days[hover].entry_refusals} refused at entry
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- list
const POLL_MS = 2000;

function RunList() {
  const [runs, setRuns] = useState<SiteRun[]>([]);
  const [scenarios, setScenarios] = useState<SiteScenario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => siteApi.runs().then(setRuns).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    siteApi.scenarios().then(setScenarios).catch((e) => setError(e.message));
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

  const start = async (scenario: string) => {
    setError(null);
    setStarting(scenario);
    try {
      await siteApi.start(scenario);
      load();
    } catch (e) {
      setStarting(null);
      setError((e as Error).message);
    }
  };
  const clear = async () => {
    if (!window.confirm("Delete every site run and its gate events, passes, holds, alerts, Vendor reports and logs? " +
                        "Gate console sessions, scenario runs and real gate data are kept.")) return;
    setError(null);
    try {
      await siteApi.clear();
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
          <h1>Site runs</h1>
          <p className="muted">
            A whole contract period played through the GB gates: honest traffic with cheats mixed in. Each report
            compares what the permit allowed, what the Vendor reported, what the GB recorded, and what really happened.
          </p>
        </div>
        <button className="btn sr-clear" onClick={clear} disabled={busy || runs.length === 0}>
          <LuTrash2 /> Clear runs
        </button>
      </div>
      <div className="sr-suites">
        {scenarios.map((sc) => {
          const mine = running?.scenario === sc.scenario ? running : undefined;
          return (
            <div key={sc.scenario} className="card sr-suite">
              <div>
                <h3>{sc.scenario.replace(/_/g, " ")}</h3>
                <p className="muted small">{sc.description}</p>
                <span className="small muted">
                  {sc.days} days · {sc.fleet} trucks{sc.trip_limit != null ? ` · permit ${fmt(sc.trip_limit)} trips` : ""}
                </span>
              </div>
              <button className="btn primary" disabled={busy} onClick={() => start(sc.scenario)}>
                {mine || starting === sc.scenario ? <LuLoader2 className="spin" /> : <LuPlay />}
                {mine ? `Running, ${fmt(mine.gate_events_so_far ?? 0)} gate events` : starting === sc.scenario ? "Starting" : "Run"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="hint small">
        <LuTerminal /> Also from a terminal: <code>docker compose run --rm simulator site brief_case</code>
      </div>
      <ErrorNote error={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Run</th><th>Scenario</th><th>Period</th><th>Permitted</th><th>Vendor</th><th>GB actual</th>
            <th>Truth</th><th>Cheats prevented / detected / missed</th><th>False alarms</th><th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const rep = r.report;
            return (
              <tr key={r.id} className="clickable" onClick={() => navigate(`/site-runs/${r.id}`)}>
                <td>#{r.id}</td>
                <td>{r.scenario}</td>
                <td className="nowrap">{r.days} days · {formatDateTime(r.started_at)}</td>
                {rep ? (
                  <>
                    <td>{fmt(rep.headline.trips.permitted)}</td>
                    <td>{fmt(rep.headline.trips.vendor_reported)}</td>
                    <td>{fmt(rep.headline.trips.gb_actual)}</td>
                    <td><strong>{fmt(rep.headline.trips.ground_truth)}</strong></td>
                    <td className="nowrap">
                      <span className="sr-outcome-prevented">{rep.cheats_summary.prevented}</span> /{" "}
                      <span className="sr-outcome-detected">{rep.cheats_summary.detected}</span> /{" "}
                      <span className="sr-outcome-missed">{rep.cheats_summary.missed}</span>
                    </td>
                    <td className={rep.false_alarms.count === 0 ? "ok-text" : "bad-text"}>{rep.false_alarms.count}</td>
                  </>
                ) : (
                  <td colSpan={6} className="muted">
                    {r.finished_at ? "No report" : <><LuLoader2 className="spin" /> running, {fmt(r.gate_events_so_far ?? 0)} gate events so far</>}
                  </td>
                )}
                <td className="muted"><LuChevronRight /></td>
              </tr>
            );
          })}
          {runs.length === 0 && <tr><td colSpan={10} className="muted center">No site runs yet. Run a scenario above.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- drill-down from a tile
type Group = "all" | "prevented" | "detected" | "missed" | "unseen" | "false";

const GROUP_TITLE: Record<Group, string> = {
  all: "Every cheat staged",
  prevented: "Prevented: stopped before material left",
  detected: "Detected: material left, alert raised",
  missed: "Missed",
  unseen: "Trips never at a GB gate",
  false: "False alarms on honest trucks",
};

/** One attempt: the cheat in one line, then its timeline (legs the GB can't see greyed, gate events opening into
 * the full gate-event detail). */
function AttemptRow({ c, movements }: { c: SiteCheat; movements: Record<number, Movement> }) {
  const [open, setOpen] = useState(false);
  const [openEvent, setOpenEvent] = useState<number | null>(null);
  const steps = c.timeline?.length
    ? [...c.timeline].sort((a, b) => a.at.localeCompare(b.at))
    : (c.movements ?? []).map((id) => ({ at: "", seen: true, text: `Gate event #${id}`, movement: id, alerts: [] as string[] }));
  return (
    <>
      <tr className="clickable" onClick={() => setOpen((o) => !o)}>
        <td className="muted">{open ? <LuChevronDown /> : <LuChevronRight />}</td>
        <td className="nowrap">{dayLabel(c.day)} {c.at}</td>
        <td>{CHEAT_LABEL[c.type] ?? c.type}</td>
        <td className="small">{c.vehicle}</td>
        <td className="small">{c.on_refusal?.replace("_", " ") ?? "—"}</td>
        <td className={`sr-outcome-${c.outcome}`}>{c.outcome}</td>
        <td className="small mono">{c.alerts.join(", ") || "—"}</td>
        <td className="small muted">{c.note}</td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td />
          <td colSpan={7}>
            {CHEAT_STORY[c.type] && <p className="sr-cheat-story">{CHEAT_STORY[c.type]}</p>}
            <ol className="sr-timeline">
              {steps.map((st, k) => (
                <li key={k} className={st.seen ? "seen" : "unseen"}>
                  <div
                    className={`sr-tl-row${st.movement ? " clickable" : ""}`}
                    onClick={() => st.movement && setOpenEvent(openEvent === st.movement ? null : st.movement)}
                  >
                    <span className="sr-tl-time">{st.at}</span>
                    <span className="sr-tl-text">{st.text}</span>
                    {st.seen ? (
                      st.alerts && st.alerts.length > 0 && <span className="small mono sr-tl-alerts">{st.alerts.join(", ")}</span>
                    ) : (
                      <span className="sr-tl-unseen">not seen by the GB</span>
                    )}
                    {st.movement && (openEvent === st.movement ? <LuChevronDown /> : <LuChevronRight />)}
                  </div>
                  {st.movement && openEvent === st.movement && (
                    <div className="sr-event">
                      {movements[st.movement] ? <MovementDetail m={movements[st.movement]} /> :
                        <p className="muted small">Gate event #{st.movement} not loaded.</p>}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {steps.length === 0 && <p className="muted small">No gate event for this attempt.</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function GroupPopup({ group, r, onClose }: { group: Group; r: SiteReport; onClose: () => void }) {
  const [movements, setMovements] = useState<Record<number, Movement>>({});
  useEffect(() => {  // this run's gate events (its own permit), to open under each attempt
    gateApi
      .movements({ permit_id: String(r.permit_id), limit: "1000" })
      .then((list) => setMovements(Object.fromEntries(list.map((m) => [m.id, m]))))
      .catch(() => {});
  }, [r.permit_id]);
  const cheats = group === "all" ? r.cheats : r.cheats.filter((c) => c.outcome === group);
  const unseen = r.accuracy.never_at_a_gate;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal td-modal" onClick={(e) => e.stopPropagation()}>
        <div className="td-top">
          <h3>{GROUP_TITLE[group]}</h3>
          <button className="btn small" onClick={onClose} title="Close"><LuX /></button>
        </div>
        {group === "unseen" ? (
          unseen == null ? (
            <p className="muted">This run was saved before the list was recorded. Run the scenario again to see it.</p>
          ) : unseen.length === 0 ? (
            <p>Every trip passed a GB gate.</p>
          ) : (
            <>
              <p className="small muted">
                These trips really happened (simulation ground truth) but never crossed a GB gate, so no gate event
                exists for them.
              </p>
              <table className="table table-inner">
                <thead><tr><th>When</th><th>Vehicle</th><th>Tonnes</th><th>Why</th></tr></thead>
                <tbody>
                  {unseen.map((t, i) => (
                    <tr key={i}>
                      <td className="nowrap">{dayLabel(t.day)} {t.at}</td>
                      <td className="small">{t.vehicle}</td>
                      <td>{fmt(t.tonnes, 1)}</td>
                      <td className="small">{t.cheat ? CHEAT_LABEL[t.cheat] ?? t.cheat : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        ) : group === "false" ? (
          r.false_alarms.items.length === 0 ? (
            <p>No serious alert was raised on any of the {fmt(r.false_alarms.honest_events)} honest gate events.</p>
          ) : (
            <ul className="small">
              {r.false_alarms.items.map((f, i) => <li key={i}>{f.at} {f.vehicle}: {f.code} {f.message}</li>)}
            </ul>
          )
        ) : cheats.length === 0 ? (
          <p className="muted">None in this run.</p>
        ) : (
          <>
            <p className="small muted">Click an attempt to see what happened, step by step. Click a gate event to see what the pole read and what the GB decided.</p>
            <table className="table table-inner">
              <thead>
                <tr><th /><th>When</th><th>Cheat</th><th>Vehicle</th><th>If refused</th><th>Outcome</th><th>Alerts</th><th>What happened</th></tr>
              </thead>
              <tbody>
                {cheats.map((c, i) => <AttemptRow key={i} c={c} movements={movements} />)}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- report
/** The contract this run was played under: the agreement and the permit terms the GB enforces at the gates.
 * Collapsible; the ledger below is what happened during the run. */
function ContractSection({ permitId }: { permitId: number }) {
  const [permit, setPermit] = useState<Permit | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  useEffect(() => {
    gateApi.permit(permitId).then((p) => {
      setPermit(p);
      api.contracts().then((cs) => setContract(cs.find((c) => c.id === p.contract_id) ?? null)).catch(() => {});
    }).catch(() => {});
  }, [permitId]);
  if (!permit) return null;
  const hhmm = (t: string) => t.slice(0, 5);
  const terms: [string, string][] = [
    ["Period", `${dayLabel(permit.valid_from)} to ${dayLabel(permit.valid_to)}`],
    ["Trips allowed", fmt(permit.trip_limit)],
    ["Tonnes allowed", `${fmt(permit.tonne_limit)} t`],
    ["Vehicles allowed", fmt(permit.vehicle_limit)],
    ["Trips per vehicle", permit.per_vehicle_trips ? fmt(permit.per_vehicle_trips) : "no per-vehicle allocation"],
    ["Working hours", `${hhmm(permit.hours_start)} to ${hhmm(permit.hours_end)}`],
    ["Exit grace after hours", `${permit.exit_grace_min} min`],
    ["Pass valid for", `${permit.pass_expiry_min} min from entry`],
  ];
  return (
    <details className="card sr-contract">
      <summary>
        <strong>Contract</strong>
        <span className="muted">
          {contract ? `${contract.code} · ` : ""}{fmt(permit.trip_limit)} trips · {fmt(permit.tonne_limit)} t ·{" "}
          {dayLabel(permit.valid_from)} to {dayLabel(permit.valid_to)}
        </span>
      </summary>
      <div className="sr-contract-grid">
        {contract && (
          <div>
            <div className="field-label">Agreement</div>
            <div className="sr-kv"><span className="muted">Contract</span><span>{contract.code}</span></div>
            <div className="sr-kv"><span className="muted">Vendor</span><span>{contract.vendor_name}</span></div>
            <div className="sr-kv"><span className="muted">Site</span><span>{contract.site_name}</span></div>
            <div className="sr-kv"><span className="muted">Mineral</span><span>{contract.mineral ?? "—"}</span></div>
          </div>
        )}
        <div>
          <div className="field-label">Permit terms the GB enforces at the gates</div>
          {terms.map(([k, v]) => (
            <div key={k} className="sr-kv"><span className="muted">{k}</span><span>{v}</span></div>
          ))}
        </div>
      </div>
      <p className="small muted">
        This run uses its own copy of the permit (#{permit.id}), so it never touches the real permit.
      </p>
    </details>
  );
}

function Headline({ r }: { r: SiteReport }) {
  const rows: { label: string; key: "trips" | "tonnes"; digits: number }[] = [
    { label: "Trips", key: "trips", digits: 0 },
    { label: "Tonnes", key: "tonnes", digits: 1 },
  ];
  return (
    <table className="table sr-headline">
      <thead>
        <tr>
          <th /><th>Permitted</th><th>Vendor reported</th><th>GB legal</th><th>GB actual</th><th>GB illegal</th>
          <th>Ground truth</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, key, digits }) => {
          const h = r.headline[key];
          return (
            <tr key={key}>
              <td><strong>{label}</strong></td>
              <td>{fmt(h.permitted, digits)}</td>
              <td>{fmt(h.vendor_reported, digits)}</td>
              <td>{fmt(h.gb_legal, digits)}</td>
              <td>{fmt(h.gb_actual, digits)}</td>
              <td className={h.gb_illegal > 0 ? "bad-text" : ""}>{fmt(h.gb_illegal, digits)}</td>
              <td className="sr-truth">{fmt(h.ground_truth, digits)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RunDetail({ id }: { id: number }) {
  const [run, setRun] = useState<SiteRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCheats, setShowCheats] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  useEffect(() => {
    siteApi.run(id).then(setRun).catch((e) => setError(e.message));
  }, [id]);
  const going = run != null && run.finished_at == null;
  useEffect(() => {  // follow the run while it is going
    if (!going) return;
    const t = setInterval(() => siteApi.run(id).then(setRun).catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  }, [going, id]);
  const r = run?.report ?? null;
  const topCodes = useMemo(() => (r ? Object.entries(r.alerts.by_code).slice(0, 12) : []), [r]);

  const back = <p><Link className="back-link" to="/site-runs"><LuArrowLeft /> Site runs</Link></p>;
  if (error)
    return (
      <>
        {back}
        <ErrorNote error={error === "Run not found" ? `Site run #${id} no longer exists: the runs were cleared.` : error} />
      </>
    );
  if (!run) return <p className="muted">Loading…</p>;
  if (!r)
    return (
      <>
        {back}
        <p className="muted">
          {going ? <><LuLoader2 className="spin" /> Running: {fmt(run.gate_events_so_far ?? 0)} gate events so far. The report appears when the period is done.</>
            : "This run has no report (it was interrupted)."}
        </p>
      </>
    );

  const cs = r.cheats_summary;
  const acc = r.accuracy;
  const h = r.headline.trips;
  return (
    <>
      <p><Link className="back-link" to="/site-runs"><LuArrowLeft /> Site runs</Link></p>
      <div className="page-head">
        <div>
          <h1>Site run #{run.id} · {run.scenario}</h1>
          <p className="muted">
            {run.description} {r.config.days[0]} to {r.config.days[1]} · {r.config.fleet} trucks working,{" "}
            {r.config.test_trucks} test trucks for staged cheats · {fmt(r.gate_events)} gate events · seed {run.seed}
          </p>
        </div>
      </div>

      {(run.permit_id ?? r.permit_id) != null && <ContractSection permitId={(run.permit_id ?? r.permit_id) as number} />}

      <div className="card">
        <header className="card-head"><h3>The ledger: what was allowed, claimed, recorded, and real</h3></header>
        <Headline r={r} />
        <p className="sr-note">
          Ground truth is what really left the site; the GB never sees it. GB actual counts every heavy vehicle that
          crossed an exit (legal closes plus forced barriers); illegal tonnes are estimated from the weigh pad minus
          the truck's enrolled empty weight.
          {h.vendor_reported < h.gb_actual && ` The Vendor reported ${fmt(h.gb_actual - h.vendor_reported)} fewer trips than the GB recorded.`}
        </p>
      </div>

      <div className="stats stats-6">
        <Tile label="Cheats staged" value={cs.injected} onClick={() => setGroup("all")} />
        <Tile label="Prevented" value={cs.prevented} tone="ok" sub="stopped before material left" onClick={() => setGroup("prevented")} />
        <Tile label="Detected" value={cs.detected} tone="warn" sub="material left, alert raised" onClick={() => setGroup("detected")} />
        <Tile label="Missed" value={cs.missed} tone={cs.missed ? "bad" : "ok"} onClick={() => setGroup("missed")}
              sub={cs.missed_attempt_flagged ? `${cs.missed_attempt_flagged} with the attempt on record` : undefined} />
        <Tile label="Trips seen by GB gates" value={`${acc.trips_seen_pct}%`} onClick={() => setGroup("unseen")}
              sub={`${fmt(acc.gb_actual_trips)} of ${fmt(acc.true_trips)}; ${acc.trips_never_at_a_gate} never at a gate`} />
        <Tile label="False alarms" value={r.false_alarms.count} tone={r.false_alarms.count ? "bad" : "ok"} onClick={() => setGroup("false")}
              sub={`on ${fmt(r.false_alarms.honest_events)} honest gate events`} />
      </div>

      {group && <GroupPopup group={group} r={r} onClose={() => setGroup(null)} />}

      <div className="card">
        <header className="card-head"><h3>Trips per day</h3></header>
        <DailyChart days={r.daily} />
        <table className="table table-inner">
          <thead>
            <tr>
              <th>Day</th><th>Ground truth</th><th>GB actual</th><th>GB legal</th><th>GB illegal</th>
              <th>Never at a gate</th><th>Refused at entry</th><th>Vendor reported</th><th>Vendor check</th>
            </tr>
          </thead>
          <tbody>
            {r.daily.map((d) => (
              <tr key={d.day}>
                <td className="nowrap">{dayLabel(d.day)}</td>
                <td><strong>{d.true_trips}</strong></td>
                <td>{d.gb_actual}</td>
                <td>{d.gb_legal}</td>
                <td className={d.gb_illegal ? "bad-text" : ""}>{d.gb_illegal}</td>
                <td>{d.invisible_trips}</td>
                <td>{d.entry_refusals}</td>
                <td>{d.vendor_trips}</td>
                <td className="small mono">{d.vendor_alerts.join(", ") || <span className="muted">matches</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <header className="card-head"><h3>Cheats by type</h3></header>
        <table className="table">
          <thead>
            <tr><th>Cheat</th><th>Staged</th><th>Prevented</th><th>Detected</th><th>Missed</th><th>Avg. minutes to first alert</th></tr>
          </thead>
          <tbody>
            {Object.entries(r.cheats_by_type).sort((a, b) => b[1].injected - a[1].injected).map(([type, row]) => (
              <tr key={type}>
                <td>{CHEAT_LABEL[type] ?? type} <span className="muted small mono">{type}</span></td>
                <td>{row.injected}</td>
                <td className="sr-outcome-prevented">{row.prevented || ""}</td>
                <td className="sr-outcome-detected">{row.detected || ""}</td>
                <td className="sr-outcome-missed">
                  {row.missed || ""}{row.attempt_flagged ? <span className="small muted"> ({row.attempt_flagged} attempt on record)</span> : ""}
                </td>
                <td>{row.avg_minutes_to_alert ?? "—"}</td>
              </tr>
            ))}
            {cs.injected === 0 && <tr><td colSpan={6} className="muted center">No cheats in this scenario (control run).</td></tr>}
          </tbody>
        </table>
        {r.cheats_by_type.side_track_both && (
          <p className="sr-note">
            "Side track in and out" never touches a GB gate, so no gate rule can see it. Only the monthly mass balance
            (drone survey of the pit vs tonnes dispatched, rule CP10, not built in the PoC) would expose it.
          </p>
        )}
        {cs.injected > 0 && (
          <>
            <button className="btn" onClick={() => setShowCheats((s) => !s)}>
              {showCheats ? <LuChevronDown /> : <LuChevronRight />} Every staged cheat ({cs.injected})
            </button>
            {showCheats && (
              <table className="table table-inner">
                <thead><tr><th>When</th><th>Cheat</th><th>Vehicle</th><th>If refused</th><th>Outcome</th><th>Alerts</th><th>What happened</th></tr></thead>
                <tbody>
                  {r.cheats.map((c, i) => (
                    <tr key={i}>
                      <td className="nowrap">{dayLabel(c.day)} {c.at}</td>
                      <td>{CHEAT_LABEL[c.type] ?? c.type}</td>
                      <td className="small">{c.vehicle}</td>
                      <td className="small">{c.on_refusal?.replace("_", " ") ?? "—"}</td>
                      <td className={`sr-outcome-${c.outcome}`}>{c.outcome}</td>
                      <td className="small mono">{c.alerts.join(", ") || "—"}</td>
                      <td className="small muted">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="card">
        <header className="card-head"><h3>Alerts raised</h3></header>
        <div className="badges-row" style={{ marginBottom: 10 }}>
          {(["CRITICAL", "HIGH", "MEDIUM", "INFO"] as const).map((s) => (
            <span key={s}><SeverityBadge severity={s} /> <strong>{r.alerts.by_severity[s] ?? 0}</strong></span>
          ))}
        </div>
        <div className="breakdown">
          {topCodes.map(([code, n]) => <span key={code} className="chip">{code} <strong>{n}</strong></span>)}
        </div>
        <p className="sr-note">
          See them under <Link to="/alerts">Alerts</Link> and <Link to="/gate-events">Gate events</Link> (filter: Site runs).
        </p>
        {r.false_alarms.items.length > 0 && (
          <>
            <div className="field-label">False alarms on honest trucks</div>
            <ul className="small">
              {r.false_alarms.items.map((f, i) => <li key={i}>{f.at} {f.vehicle}: {f.code} {f.message}</li>)}
            </ul>
          </>
        )}
        {(r.skipped.length > 0 || r.unexpected.length > 0) && (
          <div className="sr-note">
            {r.skipped.map((s, i) => <div key={`s${i}`}>Not staged: {s}</div>)}
            {r.unexpected.map((s, i) => <Fragment key={`u${i}`}><div className="bad-text">Unexpected: {s}</div></Fragment>)}
          </div>
        )}
      </div>
    </>
  );
}

export default function SiteRuns() {
  const { id } = useParams();
  return id ? <RunDetail id={Number(id)} /> : <RunList />;
}
