// "Scenario sheet" popup for one scenario-run story: everything about it in one place. The read-out tells the story
// (vehicles, contract, each step: physically there -> pole reported -> GB decided, verdict); the JSON view is the
// same sheet as one document, with a switch to the shorthand as written in the suite file.
import { useState, type ReactNode } from "react";
import { LuBot, LuCheck, LuCopy, LuFileText, LuUserCheck, LuX } from "react-icons/lu";
import { BarrierBadge, TripBadge } from "../components";
import { formatPlate } from "../format";

type Json = Record<string, unknown>;
type Mark = "ok" | "warn" | "bad";

const str = (v: unknown) => (v == null ? "" : String(v));
const isPlate = (v: unknown) => typeof v === "string" && /^[A-Z0-9]{6,12}$/.test(v);
const plate = (v: unknown) => (isPlate(v) ? formatPlate(String(v)) : str(v));
const short = (v: unknown) => {
  const t = str(v);
  return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t || "none";
};

// ---------------------------------------------------------------- the vehicles involved
function vehicleName(key: string, vehicles: Json) {
  if (!key.startsWith("rogue:")) return plate(key);
  const v = (vehicles[key] ?? {}) as Json;
  return `unregistered ${key.slice(6).replace(/_/g, " ")}${v.own_plate ? ` (own plate ${plate(v.own_plate)})` : ""}`;
}

function VehicleCard({ id, v }: { id: string; v: Json }) {
  const reg = v.registered === true;
  const rows: [string, ReactNode][] = reg
    ? [
        ["Make / model", `${str(v.make)} ${str(v.model)}`],
        ["Transporter", str(v.transporter)],
        ["FASTag", <span className="mono">{short(v.fastag)}</span>],
        ["GB sticker", <span className="mono">{str(v.gb_sticker) || "none"} {v.gb_sticker_status ? `(${str(v.gb_sticker_status)})` : ""}</span>],
        ["Length", `${str(v.length_m)} m`],
        ["Empty / rated", `${str(v.empty_weight_t)} t / ${str(v.rated_capacity_t)} t`],
        ["Authorised", v.authorised ? "yes" : `no: ${((v.not_authorised_because as string[]) ?? []).join("; ") || str(v.status)}`],
      ]
    : [
        ["Own plate", plate(v.own_plate)],
        ["Length", `${str(v.length_m)} m`],
        ["Empty / rated", `${str(v.empty_weight_t)} t / ${str(v.rated_capacity_t)} t`],
        ["GB sticker", "none issued"],
      ];
  return (
    <div className="ss-vehicle">
      <div className="ss-vehicle-head">
        {reg ? <span className="plate plate-sm">{plate(id)}</span> : <strong>{id.slice(6).replace(/_/g, " ")}</strong>}
        <span className={`badge ${reg ? (v.authorised ? "ok" : "warn") : "bad"} small`}>
          {reg ? "In GB registry" : "Not registered"}
        </span>
      </div>
      {rows.map(([k, val]) => (
        <div key={k} className="ss-kv"><span className="muted">{k}</span><span>{val}</span></div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- one step
function physicalRows(p: Json, vehicles: Json, dir: string): [string, string, Mark][] {
  const vkey = str(p.vehicle);
  const veh = (vehicles[vkey] ?? {}) as Json;
  const rogue = vkey.startsWith("rogue:");
  const light = rogue && Number(veh.length_m) < 6;
  const rows: [string, string, Mark][] = [
    ["Vehicle", vehicleName(vkey, vehicles), rogue && !light ? "bad" : "ok"],
    ["Plate", p.plate_shown === "own" ? "its own" : p.plate_shown === "none" ? "none (removed)" : `copy of ${plate(p.plate_shown)}`,
      p.plate_shown === "own" ? "ok" : "bad"],
    ["FASTag", p.fastag === "own" ? "its own" : p.fastag === "none" ? "none" : str(p.fastag).replace(/([A-Z0-9]{8,})/, (m) => plate(m)),
      p.fastag === "own" || (p.fastag === "none" && light) ? "ok" : "bad"],
    ["GB sticker", p.gb_sticker === "own" ? (rogue ? "none issued" : "its own") : p.gb_sticker === "none" ? "none" :
      str(p.gb_sticker).replace(/([A-Z0-9]{8,})/, (m) => plate(m)),
      p.gb_sticker === "own" || (p.gb_sticker === "none" && rogue) ? "ok" : "bad"],
  ];
  if (p.gb_sticker !== "none" && !(rogue && p.gb_sticker === "own"))
    rows.push(["Sticker chip", str(p.sticker_chip).replace("_", " "), p.sticker_chip === "genuine" ? "ok" : "bad"]);
  const load = p.load;
  const loadMark: Mark = load === "none" ? "bad" :
    dir === "IN" ? (Number(load) > 1 ? "warn" : "ok") :
    typeof load === "string" && load.endsWith("%") ? (parseFloat(load) > 100 ? "warn" : "ok") : Number(load) < 0.5 ? "warn" : "ok";
  rows.push(["Load", load === "none" ? "weigh pad skipped" : typeof load === "number" ? `${load} t` : str(load), loadMark]);
  if (dir === "OUT") {
    const s = str(p.shows_at_exit);
    rows.push(["Shows at exit", s === "qr" ? "its own QR" : s === "sms" ? "its SMS code" : s === "none" ? "nothing" : s,
      s === "qr" || s === "sms" ? "ok" : s === "none" ? "warn" : "bad"]);
  }
  if (p.breaks_through_if_refused) rows.push(["Barrier", "breaks through if refused", "bad"]);
  if (p.note) rows.push(["Note", str(p.note), "ok"]);
  return rows;
}

function reportedRows(body: Json): [string, ReactNode][] {
  return [
    ["Plate read", body.plate_read ? plate(body.plate_read) : "none"],
    ["FASTag read", <span className="mono">{short(body.fastag_read)}</span>],
    ["Radar length", body.radar_length_m != null ? `${str(body.radar_length_m)} m` : "none"],
    ["GB sticker", <span className="mono">{body.rfid_sticker_uid ? `${str(body.rfid_sticker_uid)} (${str(body.rfid_sim_mode)})` : "none"}</span>],
    ["Weigh pad", body.weight_t != null ? `${str(body.weight_t)} t` : "no reading"],
    ...(body.direction === "OUT"
      ? [["Shown", body.pass_token ? "QR" : body.pass_code ? `SMS code ${str(body.pass_code)}` : "nothing"] as [string, ReactNode]]
      : []),
    ...(body.barrier_forced ? [["Barrier impact", "yes"] as [string, ReactNode]] : []),
  ];
}

function expectLine(x: Json) {
  const parts: string[] = [];
  if (x.barrier) parts.push(`barrier ${str(x.barrier)}`);
  if (x.pass_issued != null) parts.push(x.pass_issued ? "pass issued" : "no pass");
  if (x.trip) parts.push(`${str(x.trip).toLowerCase()} trip`);
  if (x.result) parts.push(`identify ${str(x.result)}`);
  if (Array.isArray(x.alerts) && x.alerts.length) parts.push(`alerts ${x.alerts.join(", ")}`);
  if (Array.isArray(x.not_alerts) && x.not_alerts.length) parts.push(`not ${x.not_alerts.join(", ")}`);
  for (const [k, v] of Object.entries(x))
    if (!["barrier", "pass_issued", "trip", "result", "alerts", "not_alerts"].includes(k)) parts.push(`${k.replace(/_/g, " ")} ${str(v)}`);
  return parts.join(" · ") || "nothing specific";
}

function PassMark({ pass }: { pass: boolean }) {
  return <span className={pass ? "pass-tag" : "fail-tag"}>{pass ? "As expected" : "Not as expected"}</span>;
}

function StepCard({ st, vehicles }: { st: Json; vehicles: Json }) {
  const exp = (st.expected ?? {}) as Json;
  const act = (st.actual ?? {}) as Json;
  const reqs = (st.requests ?? []) as Json[];
  const alerts = (act.alerts ?? []) as string[];
  const head = (icon: ReactNode, title: string) => (
    <div className="ss-step-head">
      <span className="ss-step-n">{str(st.n)}</span>
      <span className="ss-step-time">{str(st.at)}</span>
      {icon}
      <strong>{title}</strong>
      <span className="ss-grow" />
      <PassMark pass={st.pass === true} />
    </div>
  );
  if (st.actor === "officer") {
    const oa = (st.officer_action ?? {}) as Json;
    return (
      <div className="ss-step">
        {head(<LuUserCheck />, "Officer action")}
        <div className="ss-cols">
          <div>
            <div className="field-label">What the officer does</div>
            <div className="small">{str(oa.did)}</div>
            <div className="small muted">as officer #{str(oa.officer_id)}</div>
          </div>
          <div>
            <div className="field-label">Sent</div>
            {reqs.map((r, i) => (
              <div key={i} className="small mono">{str(r.method)} {str(r.path)}</div>
            ))}
            {reqs[0] && (
              <div className="small">reason "{str(((reqs[0].body ?? reqs[0].query ?? {}) as Json).reason)}"</div>
            )}
          </div>
          <div>
            <div className="field-label">GB decided</div>
            {act.barrier ? (
              <div className="badges-row"><BarrierBadge barrier={str(act.barrier)} /><TripBadge trip={(act.trip as string) ?? null} /></div>
            ) : (
              <div className="small">{str(act.done) || "done"}</div>
            )}
            {alerts.length > 0 && <div className="small mono">{alerts.join(", ")}</div>}
          </div>
        </div>
        {Object.keys(exp).length > 0 && <div className="ss-expect small">Expected: {expectLine(exp)}</div>}
      </div>
    );
  }
  if (st.actor === "unseen" || st.actor === "insider" || st.actor === "vendor") {
    const title = st.actor === "unseen" ? "Not seen by the GB" : st.actor === "insider" ? "Insider" : "Vendor";
    return (
      <div className={`ss-step${st.actor === "unseen" ? " ss-step-unseen" : ""}`}>
        {head(null, title)}
        <div className="small">{str(st.did)}</div>
        {((act.alerts ?? []) as string[]).length > 0 && <div className="small mono">{((act.alerts ?? []) as string[]).join(", ")}</div>}
        {Object.keys(exp).length > 0 && <div className="ss-expect small">Expected: {expectLine(exp)}</div>}
      </div>
    );
  }
  if (st.actor === "edge") {
    return (
      <div className="ss-step">
        {head(<LuBot />, `Edge: ${str(st.action).replace(/_/g, " ")}`)}
        <div className="ss-expect small">Expected: {expectLine(exp)}</div>
        <div className="small">What happened: <strong>{str(act.result)}</strong></div>
      </div>
    );
  }
  const dir = str(st.direction);
  const body = ((reqs[0] ?? {}).body ?? {}) as Json;
  return (
    <div className="ss-step">
      {head(null, `${dir === "IN" ? "Entry" : "Exit"} barrier, gate ${str(st.gate)}`)}
      <div className="ss-cols">
        <div>
          <div className="field-label">Physically there</div>
          {physicalRows((st.physical ?? {}) as Json, vehicles, dir).map(([k, v, m]) => (
            <div key={k} className="ss-kv">
              <span className="muted"><span className={`gc-mark gc-mark-${m}`} /> {k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="field-label">Pole reported</div>
          {reportedRows(body).map(([k, v]) => (
            <div key={k} className="ss-kv"><span className="muted">{k}</span><span>{v}</span></div>
          ))}
        </div>
        <div>
          <div className="field-label">GB decided</div>
          <div className="ss-kv"><span className="muted">Identify</span><span>{str(act.identify)}</span></div>
          <div className="badges-row" style={{ margin: "4px 0" }}>
            <BarrierBadge barrier={str(act.barrier)} />
            <TripBadge trip={(act.trip as string) ?? null} />
          </div>
          {act.pass_issued ? <div className="small">Pass issued: <strong>{str(act.pass_issued)}</strong></div> : null}
          {act.pass_closed ? <div className="small">Pass presented: <strong>{str(act.pass_closed)}</strong></div> : null}
          <div className="small">{alerts.length ? <span className="mono">{alerts.join(", ")}</span> : <span className="muted">no alerts</span>}</div>
        </div>
      </div>
      <div className="ss-expect small">Expected: {expectLine(exp)}</div>
      {((st.problems ?? []) as string[]).length > 0 && (
        <div className="small bad-text">{((st.problems ?? []) as string[]).join("; ")}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the whole sheet
function storyLine(steps: Json[], vehicles: Json): string {
  return steps
    .map((st) => {
      if (st.actor === "officer") return `${str(st.at)} an officer ${str(((st.officer_action ?? {}) as Json).did)}.`;
      if (st.actor === "edge") return `The edge ${str(st.action).replace(/_/g, " ")}.`;
      const p = (st.physical ?? {}) as Json;
      const a = (st.actual ?? {}) as Json;
      const tricks = physicalRows(p, vehicles, str(st.direction)).filter(([k, , m]) => m !== "ok" && k !== "Vehicle")
        .map(([k, v]) => `${k.toLowerCase()} ${v}`);
      const who = vehicleName(str(p.vehicle), vehicles);
      const what = `${str(st.at)} ${who} at the ${st.direction === "IN" ? "entry" : "exit"}${tricks.length ? ` (${tricks.join(", ")})` : ""}`;
      const alerts = (a.alerts ?? []) as string[];
      const outcome = a.barrier === "up" ? (a.pass_issued ? `let in with pass ${str(a.pass_issued)}` : st.direction === "OUT" ? `let out${a.trip ? `, ${str(a.trip).toLowerCase()} trip` : ""}` : "let through")
        : `stopped${a.trip === "ILLEGAL" ? " but breaks through: illegal trip" : ""}`;
      return `${what}: ${outcome}${alerts.length ? `, ${alerts.map((x) => x.split(" ")[0]).join(", ")}` : ""}.`;
    })
    .join(" ");
}

function SheetView({ sheet }: { sheet: Json }) {
  const sc = (sheet.scenario ?? {}) as Json;
  const vehicles = (sheet.vehicles ?? {}) as Json;
  const steps = (sheet.steps ?? []) as Json[];
  const verdict = (sheet.verdict ?? {}) as Json;
  const contract = sheet.contract as Json | undefined;
  const ledger = verdict.ledger_after as Json | undefined;
  const passes = verdict.story_passes === true;
  return (
    <>
      <div className={`ss-verdict ${passes ? "ok" : "bad"}`}>
        <strong>{passes ? "Story passes" : "Story fails"}</strong>
        {verdict.cheat_caught === true && <span> · cheat caught by {((verdict.expected_alerts ?? []) as string[]).join(", ")}</span>}
        {verdict.cheat_caught === false && <span> · cheat NOT caught</span>}
        {sc.kind === "honest" && <span> · {verdict.false_alarm ? `false alarm ${(verdict.false_alarm as string[]).join(", ")}` : "no false alarm"}</span>}
      </div>
      <div className="small muted">
        {str(sc.suite)} · {str(sc.kind)} · {str(sc.category)}{sc.rules ? ` · rules ${str(sc.rules)}` : ""}
      </div>
      {sc.why ? <p className="why">{str(sc.why)}</p> : null}
      {sc.real_case ? <p className="small muted">Real case: {str(sc.real_case)}</p> : null}
      {steps.length > 0 && <p className="ss-story">{storyLine(steps, vehicles)}</p>}

      {Object.keys(vehicles).length > 0 && (
        <>
          <div className="field-label">Vehicles involved (GB registry at run time)</div>
          <div className="ss-vehicles">
            {Object.entries(vehicles).map(([id, v]) => <VehicleCard key={id} id={id} v={v as Json} />)}
          </div>
        </>
      )}
      {contract && (
        <>
          <div className="field-label">Contract this story runs under (its own permit)</div>
          <div className="td-chips">
            {[
              `${str(contract.trip_limit)} trips`,
              `${str(contract.tonne_limit)} t`,
              `${str(contract.vehicle_limit)} vehicles`,
              contract.per_vehicle_trips ? `${str(contract.per_vehicle_trips)} trips per vehicle` : "no per-vehicle allocation",
              `hours ${str(contract.hours_start).slice(0, 5)} to ${str(contract.hours_end).slice(0, 5)}`,
              `exit grace ${str(contract.exit_grace_min)} min`,
              `pass valid ${str(contract.pass_expiry_min)} min`,
            ].map((c) => <span key={c} className="chip">{c}</span>)}
          </div>
        </>
      )}
      <div className="field-label">Steps</div>
      {steps.map((st) => <StepCard key={str(st.n)} st={st} vehicles={vehicles} />)}
      <div className="field-label">Verdict</div>
      <div className="small">Expected alerts: <span className="mono">{((verdict.expected_alerts ?? []) as string[]).join(", ") || "none"}</span></div>
      {verdict.raised_alerts ? (
        <div className="small">Raised alerts: <span className="mono">{((verdict.raised_alerts ?? []) as string[]).join(", ") || "none"}</span></div>
      ) : null}
      {ledger && (
        <div className="small">
          Permit after the story: {str(ledger.trips_reserved)}/{str(ledger.trip_limit)} trips reserved, {str(ledger.legal_trips)} legal,{" "}
          {str(ledger.actual_trips)} actual, {str(ledger.illegal_trips)} illegal · {str(ledger.tonnes)} t · {str(ledger.active_holds)} truck(s) on hold
        </div>
      )}
      {((verdict.problems ?? []) as string[]).length > 0 && (
        <div className="small bad-text">{((verdict.problems ?? []) as string[]).join("; ")}</div>
      )}
    </>
  );
}

/** Key order for the JSON view (the database stores keys sorted alphabetically). Unknown keys go last. */
const KEY_ORDER = [
  "scenario", "contract", "vehicles", "steps", "verdict", "as_written",
  "suite", "id", "name", "kind", "category", "rules", "real_case", "why",
  "n", "at", "actor", "gate", "direction", "action", "physical", "officer_action", "requests", "expected", "actual",
  "pass", "problems",
  "vehicle", "plate_shown", "fastag", "gb_sticker", "sticker_chip", "load", "shows_at_exit", "breaks_through_if_refused",
  "note", "did", "officer_id", "refused_event",
  "method", "path", "headers", "query", "body", "plate_read", "fastag_read", "radar_length_m", "rfid_sticker_uid",
  "rfid_sim_mode", "weight_t", "pass_token", "pass_code", "barrier_forced", "observed_at", "permit_id", "source",
  "identify", "barrier", "decision", "pass_issued", "pass_closed", "trip", "alerts", "not_alerts", "result", "done",
  "story_passes", "cheat_caught", "expected_alerts", "raised_alerts", "false_alarm", "ledger_after",
  "registered", "plate", "own_plate", "make", "model", "transporter", "gb_sticker_status", "length_m",
  "empty_weight_t", "rated_capacity_t", "status", "authorised", "not_authorised_because",
  "trip_limit", "tonne_limit", "vehicle_limit", "per_vehicle_trips", "hours_start", "hours_end", "exit_grace_min",
  "pass_expiry_min", "events", "type",
];

function inOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(inOrder);
  if (!v || typeof v !== "object") return v;
  const rank = (k: string) => (KEY_ORDER.includes(k) ? KEY_ORDER.indexOf(k) : KEY_ORDER.length);
  const keys = Object.keys(v as Json).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return Object.fromEntries(keys.map((k) => [k, inOrder((v as Json)[k])]));
}

/** The button that opens the sheet; renders nothing for runs saved before sheets were recorded. */
export function ScenarioSheetButton({ title, sheet }: { title: string; sheet: unknown }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"sheet" | "json">("sheet");
  const [jsonOf, setJsonOf] = useState<"full" | "written">("full");
  const [copied, setCopied] = useState(false);
  if (!sheet || typeof sheet !== "object") return null;
  const data = sheet as Json;
  const { as_written, ...full } = data;
  const raw = JSON.stringify(inOrder(jsonOf === "full" ? full : as_written), null, 2);
  const copy = () =>
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <>
      <button
        className="btn small td-btn"
        title="Everything about this scenario: vehicles, contract, each step and the verdict"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <LuFileText /> Scenario sheet
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal td-modal" onClick={(e) => e.stopPropagation()}>
            <div className="td-top">
              <h3>{title}</h3>
              <div className="td-switch">
                <button className={view === "sheet" ? "active" : ""} onClick={() => setView("sheet")}>Sheet</button>
                <button className={view === "json" ? "active" : ""} onClick={() => setView("json")}>JSON</button>
              </div>
              <button className="btn small" onClick={() => setOpen(false)} title="Close"><LuX /></button>
            </div>
            {view === "sheet" ? (
              <div className="td-body"><SheetView sheet={data} /></div>
            ) : (
              <div className="td-body">
                <div className="ss-json-bar">
                  <div className="td-switch">
                    <button className={jsonOf === "full" ? "active" : ""} onClick={() => setJsonOf("full")}>Full sheet</button>
                    <button className={jsonOf === "written" ? "active" : ""} onClick={() => setJsonOf("written")}>
                      As written in the suite file
                    </button>
                  </div>
                  <button className="btn small td-copy" onClick={copy}>
                    {copied ? <LuCheck /> : <LuCopy />} {copied ? "Copied" : "Copy JSON"}
                  </button>
                </div>
                {jsonOf === "written" && (
                  <p className="small muted">
                    Shorthand: anything left out is the honest default (own plate, own FASTag, own GB sticker with a
                    genuine chip, empty at entry, 90% at exit, its own QR at exit).
                  </p>
                )}
                <pre className="td-json">{raw}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
