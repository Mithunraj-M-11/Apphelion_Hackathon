import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  LuCpu,
  LuExternalLink,
  LuFingerprint,
  LuPlay,
  LuRadioTower,
  LuTerminal,
  LuTrash2,
  LuZap,
} from "react-icons/lu";
import { api, gateApi, type Check, type LogEntry, type Movement, type Truck, type TruckListItem } from "../api";
import { ErrorNote, ResultBadge } from "../components";
import { CHECK_LABEL, formatPlate } from "../format";

// ---------------------------------------------------------------- mocked physical world
type VehicleKind = "registered" | "outside";
type PlateShown = "own" | "none" | "custom";
type TagShown = "own" | "none" | "from";

type Setup = {
  vehicle: VehicleKind;
  registeredPlate: string;
  outsidePlate: string;
  outsideLength: number;
  plate: PlateShown;
  customPlate: string;
  tag: TagShown;
  tagFrom: string;
};

const OUTSIDE_TAG = "34161FA8000000000000OUT1"; // an outside truck's own FASTag: real tag, not in the GB registry

/** Mirrors simulator/scenarios/identify_basic.yaml so the console and the automated suite tell the same story. */
const PRESETS: { name: string; setup: Setup }[] = [
  { name: "Honest trip (control)",
    setup: { vehicle: "registered", registeredPlate: "OD09AC5678", outsidePlate: "", outsideLength: 8.2, plate: "own", customPlate: "", tag: "own", tagFrom: "" } },
  { name: "Unregistered truck",
    setup: { vehicle: "outside", registeredPlate: "", outsidePlate: "OD09ZX7781", outsideLength: 8.1, plate: "own", customPlate: "", tag: "none", tagFrom: "" } },
  { name: "Fake plate, tag removed",
    setup: { vehicle: "outside", registeredPlate: "", outsidePlate: "OD14QQ0042", outsideLength: 9.7, plate: "custom", customPlate: "OD09AB1234", tag: "none", tagFrom: "" } },
  { name: "Fake plate + FASTag stolen from another truck",
    setup: { vehicle: "outside", registeredPlate: "", outsidePlate: "OD02KK7310", outsideLength: 8.3, plate: "custom", customPlate: "OD09AB1234", tag: "from", tagFrom: "OD09AE4521" } },
  { name: "Plate and FASTag removed",
    setup: { vehicle: "outside", registeredPlate: "", outsidePlate: "OD11MM5521", outsideLength: 8.4, plate: "none", customPlate: "", tag: "none", tagFrom: "" } },
  { name: "Suspended truck, genuine",
    setup: { vehicle: "registered", registeredPlate: "OD09AM1111", outsidePlate: "", outsideLength: 8.2, plate: "own", customPlate: "", tag: "own", tagFrom: "" } },
];

function sessionId(): string {
  const key = "sitewatch.walkSession";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

const shortTag = (t: string | null) => (t ? (t.length > 12 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t) : "none");
const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

// ---------------------------------------------------------------- steps shown in the server panel
// Each step is a block; the team adds Pass / Compare / Act as more blocks here.
type StepView = { name: string; Icon: IconType; checks: Check[] };

function stepsFor(m: Movement): StepView[] {
  return [{ name: "Identify", Icon: LuFingerprint, checks: m.checks }];
}

export default function GateConsole() {
  const session = useMemo(sessionId, []);
  const source = `walkthrough:${session}`;

  const [trucks, setTrucks] = useState<TruckListItem[]>([]);
  const [details, setDetails] = useState<Record<string, Truck>>({});
  const [setup, setSetup] = useState<Setup>(PRESETS[0].setup);
  const [preset, setPreset] = useState(0);

  const [movement, setMovement] = useState<Movement | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [instant, setInstant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // registry (read-only) and details for the trucks the setup refers to
  useEffect(() => {
    api.trucks().then(setTrucks).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const needed = [setup.vehicle === "registered" ? setup.registeredPlate : "", setup.tag === "from" ? setup.tagFrom : ""]
      .filter((p) => p && !details[p]);
    for (const plate of needed) {
      const t = trucks.find((x) => x.plate === plate);
      if (t) api.truck(t.id).then((d) => setDetails((cur) => ({ ...cur, [plate]: d })));
    }
  }, [setup, trucks, details]);

  // live log stream for this tab's walkthrough
  useEffect(() => {
    gateApi.logs(source, 200).then(setLogs).catch(() => {});
    const es = new EventSource(`/api/logs/stream?source=${encodeURIComponent(source)}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      const entry = JSON.parse(ev.data) as LogEntry;
      setLogs((cur) => (cur.some((l) => l.id === entry.id) ? cur : [...cur, entry]));
    };
    return () => es.close();
  }, [source]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  // reveal checks one by one for the audience
  const totalChecks = movement ? stepsFor(movement).reduce((n, s) => n + s.checks.length, 0) : 0;
  useEffect(() => {
    if (!movement || revealed >= totalChecks) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), instant ? 0 : 300);
    return () => clearTimeout(t);
  }, [movement, revealed, totalChecks, instant]);

  // what the (faithful) sensors will report for this physical setup
  const reg = setup.vehicle === "registered" ? details[setup.registeredPlate] : undefined;
  const ownPlate = setup.vehicle === "registered" ? setup.registeredPlate : setup.outsidePlate;
  const ownTag = setup.vehicle === "registered" ? reg?.fastag_tag_id ?? null : OUTSIDE_TAG;
  const length = setup.vehicle === "registered" ? reg?.length_m ?? null : setup.outsideLength;
  const plateRead = setup.plate === "own" ? ownPlate || null : setup.plate === "none" ? null : setup.customPlate.trim() || null;
  const tagRead = setup.tag === "own" ? ownTag : setup.tag === "none" ? null : details[setup.tagFrom]?.fastag_tag_id ?? null;
  const ready = setup.vehicle === "outside" || !!reg;

  const update = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));

  const arrive = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await gateApi.postEvent("G1", {
        direction: "IN",
        plate_read: plateRead,
        fastag_read: tagRead,
        radar_length_m: length,
        source,
      });
      setRevealed(0);
      setMovement(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = movement != null && revealed >= totalChecks;
  let shown = 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gate console</h1>
          <p className="muted">
            Live walkthrough: describe what physically arrives at the gate, then watch the GB software decide, step by
            step, with its log streaming below.
          </p>
        </div>
      </div>

      <div className="gc-grid">
        {/* ------------------------------------------------ mocked sensors */}
        <section className="card gc-panel">
          <header className="gc-panel-head">
            <LuRadioTower /> <h3>Gate G1 · entry</h3>
            <span className="gc-tag gc-tag-mock">Mocked sensors</span>
          </header>

          <label className="gc-field">
            Preset
            <select value={preset} onChange={(e) => {
              const i = Number(e.target.value);
              setPreset(i);
              setSetup(PRESETS[i].setup);
            }}>
              {PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
            </select>
          </label>

          <div className="gc-sep">What physically arrives</div>
          <div className="gc-radio">
            <label><input type="radio" checked={setup.vehicle === "registered"} onChange={() => update({ vehicle: "registered" })} /> Registered truck</label>
            <label><input type="radio" checked={setup.vehicle === "outside"} onChange={() => update({ vehicle: "outside" })} /> Outside truck</label>
          </div>
          {setup.vehicle === "registered" ? (
            <label className="gc-field">
              Truck
              <select value={setup.registeredPlate} onChange={(e) => update({ registeredPlate: e.target.value })}>
                <option value="">Choose…</option>
                {trucks.map((t) => <option key={t.id} value={t.plate}>{formatPlate(t.plate, t.plate_type)} · {t.make} {t.model}</option>)}
              </select>
            </label>
          ) : (
            <div className="gc-row">
              <label className="gc-field">Its own plate<input value={setup.outsidePlate} onChange={(e) => update({ outsidePlate: e.target.value })} /></label>
              <label className="gc-field">True length (m)<input type="number" step="0.1" value={setup.outsideLength}
                onChange={(e) => update({ outsideLength: Number(e.target.value) })} /></label>
            </div>
          )}

          <label className="gc-field">
            Plate on the truck
            <select value={setup.plate} onChange={(e) => update({ plate: e.target.value as PlateShown })}>
              <option value="own">Its own plate</option>
              <option value="none">No plate (removed / covered)</option>
              <option value="custom">A different plate (fake)</option>
            </select>
          </label>
          {setup.plate === "custom" && (
            <label className="gc-field">Fake plate shown<input value={setup.customPlate} onChange={(e) => update({ customPlate: e.target.value })} placeholder="OD09AB1234" /></label>
          )}

          <label className="gc-field">
            FASTag on the windscreen
            <select value={setup.tag} onChange={(e) => update({ tag: e.target.value as TagShown })}>
              <option value="own">{setup.vehicle === "registered" ? "Its own tag" : "Its own tag (not in GB registry)"}</option>
              <option value="none">No tag (removed / blocked)</option>
              <option value="from">Tag taken from another registered truck</option>
            </select>
          </label>
          {setup.tag === "from" && (
            <label className="gc-field">
              Taken from
              <select value={setup.tagFrom} onChange={(e) => update({ tagFrom: e.target.value })}>
                <option value="">Choose…</option>
                {trucks.map((t) => <option key={t.id} value={t.plate}>{formatPlate(t.plate, t.plate_type)}</option>)}
              </select>
            </label>
          )}

          <div className="gc-preview">
            <div className="field-label">Sensors will report</div>
            <div>Plate: {plateRead ? <span className="plate plate-sm">{formatPlate(plateRead)}</span> : <span className="muted">none</span>}</div>
            <div>FASTag: <span className="mono small">{shortTag(tagRead)}</span></div>
            <div>Radar length: {length != null ? `${length.toFixed(2)} m` : "…"}</div>
          </div>

          <button className="btn primary gc-go" disabled={busy || !ready} onClick={arrive}>
            <LuPlay /> Truck arrives at gate
          </button>
          <ErrorNote error={error} />
        </section>

        {/* ------------------------------------------------ live GB software */}
        <section className="card gc-panel">
          <header className="gc-panel-head">
            <LuCpu /> <h3>GB server</h3>
            <span className="gc-tag gc-tag-live">Live GB software</span>
            <label className="gc-instant"><input type="checkbox" checked={instant} onChange={(e) => setInstant(e.target.checked)} /><LuZap /> Instant</label>
          </header>

          {!movement ? (
            <p className="muted gc-empty">Waiting for a truck. Set up the gate on the left and press "Truck arrives at gate".</p>
          ) : (
            <>
              {stepsFor(movement).map((step) => (
                <div key={step.name} className="gc-step">
                  <div className="gc-step-head"><step.Icon /> {step.name}</div>
                  <ul className="gc-checks">
                    {step.checks.map((c) => {
                      const visible = shown++ < revealed;
                      return (
                        <li key={c.name} className={`gc-check ${visible ? `gc-${c.status}` : "gc-pending"}`}>
                          <span className="gc-dot" />
                          <span className="gc-check-name">{CHECK_LABEL[c.name] ?? c.name}</span>
                          <span className="gc-check-status">{visible ? c.status.replace("_", " ") : "checking…"}</span>
                          {visible && c.status !== "not_applicable" && <span className="gc-check-detail">{c.detail}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {done && (
                <div className="gc-result">
                  <div className="gc-result-main">
                    <ResultBadge result={movement.result} />
                    {movement.flags.map((f) => <span key={f} className="badge neutral">{f.replace("_", " ")}</span>)}
                  </div>
                  {movement.caught_by.length > 0 && (
                    <div className="small">Caught by: <strong>{movement.caught_by.map((c) => CHECK_LABEL[c] ?? c).join(", ")}</strong></div>
                  )}
                  <div className="gc-links small">
                    <Link to="/gate-events"><LuExternalLink /> Gate event #{movement.id}</Link>
                    {movement.truck && (
                      <Link to={`/registry/${movement.truck.id}`}><LuExternalLink /> Claimed truck {formatPlate(movement.truck.plate, movement.truck.plate_type)}</Link>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ live log */}
      <section className="card gc-log-card">
        <header className="gc-panel-head">
          <LuTerminal /> <h3>Live server log</h3>
          <span className={`gc-live ${live ? "on" : ""}`}><span className="gc-live-dot" /> {live ? "streaming" : "connecting"}</span>
          <button className="btn gc-clear" onClick={() => setLogs([])}><LuTrash2 /> Clear</button>
        </header>
        <div className="gc-log" ref={logRef}>
          {logs.length === 0 && <div className="muted">No log lines yet for this session.</div>}
          {logs.map((l) => (
            <div key={l.id} className={`gc-line gc-${l.level.toLowerCase()}`}>
              <span className="gc-time">{clock(l.at)}</span>
              <span className="gc-comp">{l.component}</span>
              <span className="gc-level">{l.level}</span>
              <span className="gc-msg">{l.message}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
