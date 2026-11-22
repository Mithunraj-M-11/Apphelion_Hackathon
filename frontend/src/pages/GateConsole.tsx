import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  LuCheck,
  LuCpu,
  LuExternalLink,
  LuFingerprint,
  LuLogIn,
  LuLogOut,
  LuPlay,
  LuRadioTower,
  LuShieldAlert,
  LuShieldCheck,
  LuTag,
  LuTerminal,
  LuTrash2,
  LuZap,
} from "react-icons/lu";
import { QRCodeSVG } from "qrcode.react";
import {
  api,
  gateApi,
  type Check,
  type EdgeSystemState,
  type ExitVerifyOut,
  type LogEntry,
  type Movement,
  type RfidSticker,
  type TripSession,
  type Truck,
  type TruckListItem,
  type VehicleQuota,
} from "../api";
import { ErrorNote, ResultBadge } from "../components";
import { CHECK_LABEL, formatDateTime, formatPlate } from "../format";

// ---------------------------------------------------------------- mocked physical world
type VehicleKind = "registered" | "outside";
type PlateShown = "own" | "none" | "custom";
type TagShown = "own" | "none" | "from";
type RfidSimMode = "genuine" | "cloned" | "revoked" | "unknown_damaged";

type Setup = {
  vehicle: VehicleKind;
  registeredPlate: string;
  outsidePlate: string;
  outsideLength: number;
  plate: PlateShown;
  customPlate: string;
  tag: TagShown;
  tagFrom: string;
  // GB RFID Sticker additions
  rfidUid: string;
  rfidSimMode: RfidSimMode;
};

const OUTSIDE_TAG = "34161FA8000000000000OUT1"; // an outside truck's own FASTag: real tag, not in the GB registry

/** Extended presets exercising both Identity and GB Trip Authorization workflows. */
const PRESETS: { name: string; setup: Setup }[] = [
  {
    name: "Honest trip & trip pass issuance (control)",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD09AC5678",
      outsidePlate: "",
      outsideLength: 8.2,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00002",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Cloned GB RFID sticker (crypto mismatch)",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD09AC5678",
      outsidePlate: "",
      outsideLength: 8.2,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00002",
      rfidSimMode: "cloned",
    },
  },
  {
    name: "Revoked GB RFID sticker",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD02BQ4410",
      outsidePlate: "",
      outsideLength: 8.3,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00011",
      rfidSimMode: "revoked",
    },
  },
  {
    name: "Exhausted trip quota (0 remaining)",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD11CE3305",
      outsidePlate: "",
      outsideLength: 8.3,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00013",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Blocked: Expired unresolved trip exists",
    setup: {
      vehicle: "registered",
      registeredPlate: "CG04MN5507",
      outsidePlate: "",
      outsideLength: 8.3,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00017",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Unregistered truck",
    setup: {
      vehicle: "outside",
      registeredPlate: "",
      outsidePlate: "OD09ZX7781",
      outsideLength: 8.1,
      plate: "own",
      customPlate: "",
      tag: "none",
      tagFrom: "",
      rfidUid: "GB-RFID-99999",
      rfidSimMode: "unknown_damaged",
    },
  },
  {
    name: "Fake plate, FASTag removed",
    setup: {
      vehicle: "outside",
      registeredPlate: "",
      outsidePlate: "OD14QQ0042",
      outsideLength: 9.7,
      plate: "custom",
      customPlate: "OD09AB1234",
      tag: "none",
      tagFrom: "",
      rfidUid: "GB-RFID-00001",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Fake plate + FASTag stolen from another truck",
    setup: {
      vehicle: "outside",
      registeredPlate: "",
      outsidePlate: "OD02KK7310",
      outsideLength: 8.3,
      plate: "custom",
      customPlate: "OD09AB1234",
      tag: "from",
      tagFrom: "OD09AE4521",
      rfidUid: "GB-RFID-00001",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Suspended truck, genuine tag",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD09AM1111",
      outsidePlate: "",
      outsideLength: 8.2,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "GB-RFID-00019",
      rfidSimMode: "genuine",
    },
  },
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
type StepView = { name: string; Icon: IconType; checks: Check[] };

function stepsFor(m: Movement): StepView[] {
  const steps: StepView[] = [{ name: "Identify", Icon: LuFingerprint, checks: m.checks }];
  if (m.trip_checks && m.trip_checks.length > 0) {
    steps.push({ name: "GB Trip Authorization", Icon: LuShieldCheck, checks: m.trip_checks });
  }
  return steps;
}

export default function GateConsole() {
  const session = useMemo(sessionId, []);
  const source = `walkthrough:${session}`;

  // Operating mode: ENTRY vs EXIT
  const [mode, setMode] = useState<"ENTRY" | "EXIT">("ENTRY");

  // Edge infrastructure status
  const [edge, setEdge] = useState<EdgeSystemState | null>(null);

  const [trucks, setTrucks] = useState<TruckListItem[]>([]);
  const [details, setDetails] = useState<Record<string, Truck>>({});
  const [stickers, setStickers] = useState<Record<string, RfidSticker>>({});
  const [quotas, setQuotas] = useState<Record<string, VehicleQuota>>({});
  const [activeSessions, setActiveSessions] = useState<TripSession[]>([]);

  // Entry setup
  const [setup, setSetup] = useState<Setup>(PRESETS[0].setup);
  const [preset, setPreset] = useState(0);

  // Exit setup
  const [exitGate, setExitGate] = useState("G1");
  const [exitPlate, setExitPlate] = useState("");
  const [exitRfidUid, setExitRfidUid] = useState("");
  const [exitSimMode, setExitSimMode] = useState<RfidSimMode>("genuine");
  const [exitQrToken, setExitQrToken] = useState("");
  const [exitResult, setExitResult] = useState<ExitVerifyOut | null>(null);

  const [movement, setMovement] = useState<Movement | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [instant, setInstant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Load edge infrastructure state
  useEffect(() => {
    api.edgeState().then(setEdge).catch(() => {});
  }, []);

  // Registry (read-only) and active sessions
  const reloadData = () => {
    api.trucks().then(setTrucks).catch((e) => setError(e.message));
    api.rfidStickers().then((list) => {
      const map: Record<string, RfidSticker> = {};
      list.forEach((s) => {
        if (s.truck?.plate) map[s.truck.plate] = s;
      });
      setStickers(map);
    }).catch(() => {});
    api.trips({ status: "ACTIVE" }).then(setActiveSessions).catch(() => {});
  };

  useEffect(() => {
    reloadData();
  }, []);

  useEffect(() => {
    const needed = [
      setup.vehicle === "registered" ? setup.registeredPlate : "",
      setup.tag === "from" ? setup.tagFrom : "",
      exitPlate,
    ].filter((p) => p && !details[p]);
    for (const plate of needed) {
      const t = trucks.find((x) => x.plate === plate);
      if (t) {
        api.truck(t.id).then((d) => setDetails((cur) => ({ ...cur, [plate]: d })));
        api.quota(t.id).then((q) => setQuotas((cur) => ({ ...cur, [plate]: q }))).catch(() => {});
      }
    }
  }, [setup, exitPlate, trucks, details]);

  // When registered truck changes in Entry mode, automatically sync its GB RFID sticker UID
  useEffect(() => {
    if (setup.vehicle === "registered" && setup.registeredPlate) {
      const s = stickers[setup.registeredPlate];
      if (s) {
        setSetup((cur) => ({ ...cur, rfidUid: s.uid }));
      }
    }
  }, [setup.vehicle, setup.registeredPlate, stickers]);

  // When exit plate changes, auto-fill active session token and sticker
  useEffect(() => {
    if (exitPlate) {
      const sess = activeSessions.find((s) => s.truck?.plate === exitPlate);
      if (sess) {
        setExitQrToken(sess.signed_token);
        if (sess.sticker?.uid) setExitRfidUid(sess.sticker.uid);
      } else {
        const s = stickers[exitPlate];
        if (s) setExitRfidUid(s.uid);
        setExitQrToken("");
      }
    }
  }, [exitPlate, activeSessions, stickers]);

  // Live log stream for this tab's walkthrough
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

  // Reveal checks one by one for audience
  const totalChecks =
    mode === "ENTRY"
      ? movement
        ? stepsFor(movement).reduce((n, s) => n + s.checks.length, 0)
        : 0
      : exitResult
      ? exitResult.checks.length
      : 0;

  useEffect(() => {
    if ((mode === "ENTRY" && !movement) || (mode === "EXIT" && !exitResult)) return;
    if (revealed >= totalChecks) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), instant ? 0 : 250);
    return () => clearTimeout(t);
  }, [movement, exitResult, revealed, totalChecks, instant, mode]);

  // What the sensors will report for physical setup
  const reg = setup.vehicle === "registered" ? details[setup.registeredPlate] : undefined;
  const ownPlate = setup.vehicle === "registered" ? setup.registeredPlate : setup.outsidePlate;
  const ownTag = setup.vehicle === "registered" ? reg?.fastag_tag_id ?? null : OUTSIDE_TAG;
  const length = setup.vehicle === "registered" ? reg?.length_m ?? null : setup.outsideLength;
  const plateRead =
    setup.plate === "own" ? ownPlate || null : setup.plate === "none" ? null : setup.customPlate.trim() || null;
  const tagRead = setup.tag === "own" ? ownTag : setup.tag === "none" ? null : details[setup.tagFrom]?.fastag_tag_id ?? null;
  const ready = setup.vehicle === "outside" || !!reg;

  const update = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));

  // Arrive at Entry Gate
  const arriveEntry = async () => {
    setBusy(true);
    setError(null);
    setExitResult(null);
    try {
      const m = await gateApi.postEvent("G1", {
        direction: "IN",
        plate_read: plateRead,
        fastag_read: tagRead,
        radar_length_m: length,
        source,
        rfid_sticker_uid: setup.rfidUid.trim() || null,
        rfid_sim_mode: setup.rfidSimMode,
      });
      setRevealed(0);
      setMovement(m);
      reloadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Arrive at Exit Gate
  const arriveExit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await gateApi.exitVerify({
        gate: exitGate,
        truck_plate: exitPlate || null,
        rfid_sticker_uid: exitRfidUid.trim() || null,
        qr_token: exitQrToken.trim() || null,
        sim_auth_mode: exitSimMode,
        source,
      });
      setRevealed(0);
      setExitResult(res);
      reloadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyToken = (tok: string) => {
    navigator.clipboard.writeText(tok);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const done =
    mode === "ENTRY" ? movement != null && revealed >= totalChecks : exitResult != null && revealed >= totalChecks;
  let shown = 0;

  // Edge status pill formatting
  const edgeIsOnline = edge?.wan_connectivity === "ONLINE";
  const edgeIsPrimary = edge?.active_authority === "PRIMARY" && edge?.primary_status === "ACTIVE";
  const edgeStatusCls = !edgeIsOnline || !edgeIsPrimary ? (edge?.disaster_recovery_mode ? "bad" : "warn") : "";
  const edgeStatusText = edge?.disaster_recovery_mode
    ? "EMERGENCY / DISASTER RECOVERY"
    : edge?.primary_status === "FAILED"
    ? "STANDBY ACTIVE · FAILOVER"
    : edge?.wan_connectivity === "WAN_OFFLINE_LOCAL_OPERATIONAL"
    ? "PRIMARY ACTIVE · WAN OFFLINE (LOCAL)"
    : "PRIMARY ACTIVE · ONLINE";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Gate console</h1>
          <p className="muted">
            Unified vehicle entry and exit gate terminal with GB RFID authentication, internal signed QR trip
            authorization, and offline edge resilience.
          </p>
        </div>
      </div>

      {/* Mode bar & Edge Infrastructure compact indicator */}
      <div className="gc-mode-bar">
        <div className="gc-mode-tabs">
          <button
            className={`gc-mode-tab ${mode === "ENTRY" ? "active" : ""}`}
            onClick={() => {
              setMode("ENTRY");
              setRevealed(0);
            }}
          >
            <LuLogIn /> ENTRY MODE
          </button>
          <button
            className={`gc-mode-tab ${mode === "EXIT" ? "active" : ""}`}
            onClick={() => {
              setMode("EXIT");
              setRevealed(0);
            }}
          >
            <LuLogOut /> EXIT MODE
          </button>
        </div>

        <div className="gc-edge-status-wrap" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className={`gc-edge-status ${edgeStatusCls}`}>
            <span className="dot" />
            <strong>{edgeStatusText}</strong>
          </div>
          <Link to="/edge-recovery" className="gc-edge-link small">
            <LuShieldAlert /> Infrastructure
          </Link>
        </div>
      </div>

      {mode === "ENTRY" ? (
        /* ================================================= ENTRY MODE ================================================= */
        <div className="gc-grid">
          {/* Left panel: Entry Gate Inputs */}
          <section className="card gc-panel">
            <header className="gc-panel-head">
              <LuRadioTower /> <h3>Gate G1 · Entry</h3>
              <span className="gc-tag gc-tag-mock">Mocked sensors</span>
            </header>

            <label className="gc-field">
              Preset scenario
              <select
                value={preset}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setPreset(i);
                  setSetup(PRESETS[i].setup);
                }}
              >
                {PRESETS.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="gc-sep">What physically arrives</div>
            <div className="gc-radio">
              <label>
                <input
                  type="radio"
                  checked={setup.vehicle === "registered"}
                  onChange={() => update({ vehicle: "registered" })}
                />{" "}
                Registered truck
              </label>
              <label>
                <input
                  type="radio"
                  checked={setup.vehicle === "outside"}
                  onChange={() => update({ vehicle: "outside" })}
                />{" "}
                Outside truck
              </label>
            </div>

            {setup.vehicle === "registered" ? (
              <label className="gc-field">
                Truck
                <select
                  value={setup.registeredPlate}
                  onChange={(e) => update({ registeredPlate: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.plate}>
                      {formatPlate(t.plate, t.plate_type)} · {t.make} {t.model}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="gc-row">
                <label className="gc-field">
                  Its own plate
                  <input
                    value={setup.outsidePlate}
                    onChange={(e) => update({ outsidePlate: e.target.value })}
                  />
                </label>
                <label className="gc-field">
                  True length (m)
                  <input
                    type="number"
                    step="0.1"
                    value={setup.outsideLength}
                    onChange={(e) => update({ outsideLength: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}

            <label className="gc-field">
              Plate on the truck
              <select
                value={setup.plate}
                onChange={(e) => update({ plate: e.target.value as PlateShown })}
              >
                <option value="own">Its own plate</option>
                <option value="none">No plate (removed / covered)</option>
                <option value="custom">A different plate (fake)</option>
              </select>
            </label>
            {setup.plate === "custom" && (
              <label className="gc-field">
                Fake plate shown
                <input
                  value={setup.customPlate}
                  onChange={(e) => update({ customPlate: e.target.value })}
                  placeholder="OD09AB1234"
                />
              </label>
            )}

            <label className="gc-field">
              FASTag on the windscreen
              <select
                value={setup.tag}
                onChange={(e) => update({ tag: e.target.value as TagShown })}
              >
                <option value="own">
                  {setup.vehicle === "registered" ? "Its own tag" : "Its own tag (not in GB registry)"}
                </option>
                <option value="none">No tag (removed / blocked)</option>
                <option value="from">Tag taken from another registered truck</option>
              </select>
            </label>
            {setup.tag === "from" && (
              <label className="gc-field">
                Taken from
                <select value={setup.tagFrom} onChange={(e) => update({ tagFrom: e.target.value })}>
                  <option value="">Choose…</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.plate}>
                      {formatPlate(t.plate, t.plate_type)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* GB RFID Sticker Section */}
            <div className="gc-sep" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <LuTag /> GB-ISSUED RFID STICKER
            </div>

            <label className="gc-field">
              GB RFID Sticker UID
              <input
                value={setup.rfidUid}
                onChange={(e) => update({ rfidUid: e.target.value })}
                placeholder="GB-RFID-00001"
              />
            </label>

            <label className="gc-field">
              Simulated Chip Authentication
              <select
                value={setup.rfidSimMode}
                onChange={(e) => update({ rfidSimMode: e.target.value as RfidSimMode })}
              >
                <option value="genuine">Genuine sticker (cryptographic challenge-response valid)</option>
                <option value="cloned">Cloned / invalid sticker (crypto challenge mismatch)</option>
                <option value="revoked">Revoked sticker (listed in central GB revocation list)</option>
                <option value="unknown_damaged">Damaged or unknown sticker (unregistered / unreadable)</option>
              </select>
            </label>

            <div className="gc-preview">
              <div className="field-label">Sensors will report at gate</div>
              <div>
                Plate:{" "}
                {plateRead ? (
                  <span className="plate plate-sm">{formatPlate(plateRead)}</span>
                ) : (
                  <span className="muted">none</span>
                )}
              </div>
              <div>
                FASTag: <span className="mono small">{shortTag(tagRead)}</span>
              </div>
              <div>Radar length: {length != null ? `${length.toFixed(2)} m` : "…"}</div>
              <div>
                GB RFID: <span className="mono small">{setup.rfidUid || "none"}</span>{" "}
                <span className="badge neutral small">{setup.rfidSimMode}</span>
              </div>
              {setup.vehicle === "registered" && setup.registeredPlate && quotas[setup.registeredPlate] && (
                <div>
                  Quota:{" "}
                  <strong>
                    {quotas[setup.registeredPlate].remaining_trips} / {quotas[setup.registeredPlate].max_trips} trips
                  </strong>{" "}
                  <span className={`badge ${quotas[setup.registeredPlate].status === "AVAILABLE" ? "ok" : "bad"} small`}>
                    {quotas[setup.registeredPlate].status}
                  </span>
                </div>
              )}
            </div>

            <button
              className="btn primary gc-go"
              disabled={busy || !ready}
              onClick={arriveEntry}
            >
              <LuPlay /> Truck arrives at gate
            </button>
            <ErrorNote error={error} />
          </section>

          {/* Right panel: GB Server Identification & Trip Authorization */}
          <section className="card gc-panel">
            <header className="gc-panel-head">
              <LuCpu /> <h3>GB Server</h3>
              <span className="gc-tag gc-tag-live">Live GB software</span>
              <label className="gc-instant">
                <input
                  type="checkbox"
                  checked={instant}
                  onChange={(e) => setInstant(e.target.checked)}
                />
                <LuZap /> Instant
              </label>
            </header>

            {!movement ? (
              <p className="muted gc-empty">
                Waiting for a truck. Set up the gate on the left and press "Truck arrives at gate".
              </p>
            ) : (
              <>
                {stepsFor(movement).map((step) => (
                  <div key={step.name} className="gc-step">
                    <div className="gc-step-head">
                      <step.Icon /> {step.name}
                    </div>
                    <ul className="gc-checks">
                      {step.checks.map((c) => {
                        const visible = shown++ < revealed;
                        const statusClass =
                          c.status === "warning"
                            ? "gc-warning"
                            : `gc-${c.status}`;
                        return (
                          <li
                            key={c.name}
                            className={`gc-check ${visible ? statusClass : "gc-pending"}`}
                          >
                            <span className="gc-dot" />
                            <span className="gc-check-name">{CHECK_LABEL[c.name] ?? c.name}</span>
                            <span className="gc-check-status">
                              {visible ? c.status.replace("_", " ") : "checking…"}
                            </span>
                            {visible && c.status !== "not_applicable" && (
                              <span className="gc-check-detail">{c.detail}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                {done && (
                  <div className="gc-result">
                    <div className="gc-result-main">
                      <ResultBadge result={movement.trip_decision || movement.result} />
                      {movement.flags.map((f) => (
                        <span key={f} className="badge neutral">
                          {f.replace("_", " ")}
                        </span>
                      ))}
                    </div>

                    {movement.caught_by.length > 0 && (
                      <div className="small">
                        Identify issues:{" "}
                        <strong>{movement.caught_by.map((c) => CHECK_LABEL[c] ?? c).join(", ")}</strong>
                      </div>
                    )}

                    {movement.reasons && movement.reasons.length > 0 && (
                      <div className="small bad-text">
                        {movement.reasons.join("; ")}
                      </div>
                    )}

                    <div className="gc-links small">
                      <Link to="/gate-events">
                        <LuExternalLink /> Gate event #{movement.id}
                      </Link>
                      {movement.truck && (
                        <Link to={`/registry/${movement.truck.id}`}>
                          <LuExternalLink /> Claimed truck{" "}
                          {formatPlate(movement.truck.plate, movement.truck.plate_type)}
                        </Link>
                      )}
                    </div>

                    {/* Trip Authorization Panel upon successful entry */}
                    {movement.trip_decision === "ENTRY AUTHORIZED" && movement.trip_session && (
                      <div className="gc-trip-pass">
                        <div className="gc-trip-pass-head">
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <LuShieldCheck style={{ color: "var(--ok)", fontSize: "1.2rem" }} />
                            <h4 style={{ margin: 0, fontSize: "1rem" }}>
                              Trip Authorization Pass ({movement.trip_session.trip_code})
                            </h4>
                          </div>
                          <span className="badge ok">ACTIVE</span>
                        </div>

                        <div className="gc-trip-grid">
                          <div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: "0.85rem" }}>
                              <div>
                                <span className="muted">Vehicle:</span>{" "}
                                <strong>{formatPlate(movement.truck?.plate || "")}</strong>
                              </div>
                              <div>
                                <span className="muted">Gate:</span>{" "}
                                <strong>{movement.trip_session.entry_gate}</strong>
                              </div>
                              <div>
                                <span className="muted">GB RFID Sticker:</span>{" "}
                                <span className="mono">{movement.rfid_sticker_uid || "—"}</span>
                              </div>
                              <div>
                                <span className="muted">Trip Quota Remaining:</span>{" "}
                                <strong>
                                  {movement.quota_remaining != null ? `${movement.quota_remaining} / ${movement.quota_max ?? 100}` : "—"}
                                </strong>
                              </div>
                              <div>
                                <span className="muted">Entry Time:</span>{" "}
                                <span>{formatDateTime(movement.trip_session.entry_at)}</span>
                              </div>
                              <div>
                                <span className="muted">Valid Until:</span>{" "}
                                <span>{formatDateTime(movement.trip_session.expires_at)}</span>
                              </div>
                            </div>

                            <div style={{ marginTop: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span className="muted small">Internal Signed Token Hash:</span>
                                <button
                                  className="btn small"
                                  style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                                  onClick={() => copyToken(movement.trip_session?.signed_token || "")}
                                >
                                  {copiedToken ? <LuCheck /> : null} {copiedToken ? "Copied" : "Copy Token"}
                                </button>
                              </div>
                              <div className="gc-token-box mono">{movement.trip_session.signed_token}</div>
                            </div>
                          </div>

                          {/* Real QR Code */}
                          <div className="gc-qr-card">
                            <QRCodeSVG
                              value={movement.trip_session.signed_token}
                              size={120}
                              level="M"
                              includeMargin={false}
                            />
                            <div className="gc-qr-caption">Internal GB QR Token</div>
                            <span className="muted small" style={{ fontSize: "0.7rem" }}>Administrative use</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ) : (
        /* ================================================= EXIT MODE ================================================= */
        <div className="gc-grid">
          {/* Left panel: Exit Gate Inputs */}
          <section className="card gc-panel">
            <header className="gc-panel-head">
              <LuLogOut /> <h3>Gate G1 · Exit Verification</h3>
              <span className="gc-tag gc-tag-mock">Exit sensors</span>
            </header>

            <label className="gc-field">
              Exit Gate
              <select value={exitGate} onChange={(e) => setExitGate(e.target.value)}>
                <option value="G1">Gate G1 · Exit</option>
                <option value="G2">Gate G2 · Exit</option>
              </select>
            </label>

            <label className="gc-field">
              Vehicle arriving at exit
              <select value={exitPlate} onChange={(e) => setExitPlate(e.target.value)}>
                <option value="">Choose vehicle…</option>
                {trucks.map((t) => {
                  const hasActive = activeSessions.some((s) => s.truck?.plate === t.plate);
                  return (
                    <option key={t.id} value={t.plate}>
                      {formatPlate(t.plate, t.plate_type)} {hasActive ? "★ [ACTIVE TRIP]" : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="gc-field">
              Scanned GB RFID Sticker UID
              <input
                value={exitRfidUid}
                onChange={(e) => setExitRfidUid(e.target.value)}
                placeholder="GB-RFID-00001"
              />
            </label>

            <label className="gc-field">
              RFID Chip Authentication Simulation
              <select
                value={exitSimMode}
                onChange={(e) => setExitSimMode(e.target.value as RfidSimMode)}
              >
                <option value="genuine">Genuine sticker (crypto challenge verified)</option>
                <option value="cloned">Cloned sticker (signature mismatch)</option>
                <option value="revoked">Revoked sticker (flagged in registry)</option>
                <option value="unknown_damaged">Unknown or damaged sticker</option>
              </select>
            </label>

            <label className="gc-field">
              Presented Internal Trip QR Token
              <textarea
                rows={3}
                style={{ font: "inherit", fontSize: "0.8rem", width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--border)" }}
                value={exitQrToken}
                onChange={(e) => setExitQrToken(e.target.value)}
                placeholder="Paste signed token or choose truck with active trip above"
              />
            </label>

            <div className="gc-preview">
              <div className="field-label">Exit Pole Scan Preview</div>
              <div>
                Vehicle: <strong>{exitPlate ? formatPlate(exitPlate) : "none"}</strong>
              </div>
              <div>
                Active trip detected:{" "}
                {activeSessions.find((s) => s.truck?.plate === exitPlate) ? (
                  <span className="ok-text font-bold">
                    {activeSessions.find((s) => s.truck?.plate === exitPlate)?.trip_code}
                  </span>
                ) : (
                  <span className="muted">None found</span>
                )}
              </div>
              <div>
                GB RFID: <span className="mono small">{exitRfidUid || "none"}</span>
              </div>
            </div>

            <button
              className="btn primary gc-go"
              disabled={busy || !exitPlate}
              onClick={arriveExit}
            >
              <LuPlay /> Verify vehicle exit
            </button>
            <ErrorNote error={error} />
          </section>

          {/* Right panel: Exit Verification Checklist */}
          <section className="card gc-panel">
            <header className="gc-panel-head">
              <LuCpu /> <h3>GB Server · Exit Verification</h3>
              <span className="gc-tag gc-tag-live">Authority check</span>
            </header>

            {!exitResult ? (
              <p className="muted gc-empty">
                Waiting for an exiting vehicle. Select a truck on the left and click "Verify vehicle exit".
              </p>
            ) : (
              <>
                <div className="gc-step">
                  <div className="gc-step-head">
                    <LuShieldCheck /> GB Exit Verification
                  </div>
                  <ul className="gc-checks">
                    {exitResult.checks.map((c) => {
                      const visible = shown++ < revealed;
                      return (
                        <li
                          key={c.name}
                          className={`gc-check ${visible ? `gc-${c.status}` : "gc-pending"}`}
                        >
                          <span className="gc-dot" />
                          <span className="gc-check-name">{CHECK_LABEL[c.name] ?? c.name}</span>
                          <span className="gc-check-status">
                            {visible ? c.status.replace("_", " ") : "checking…"}
                          </span>
                          {visible && c.status !== "not_applicable" && (
                            <span className="gc-check-detail">{c.detail}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {done && (
                  <div className="gc-result">
                    <div className="gc-result-main">
                      <ResultBadge result={exitResult.decision} />
                      {exitResult.passed && (
                        <span className="badge ok">QUOTA DEDUCTED: 1 TRIP</span>
                      )}
                    </div>

                    {exitResult.reasons && exitResult.reasons.length > 0 && (
                      <div className="small bad-text">
                        {exitResult.reasons.join("; ")}
                      </div>
                    )}

                    {exitResult.passed && exitResult.session && (
                      <div className="gc-trip-pass" style={{ background: "var(--ok-bg)", border: "1px solid var(--ok)" }}>
                        <div className="gc-trip-pass-head">
                          <h4 style={{ margin: 0 }}>
                            Trip {exitResult.session.trip_code} Completed Successfully
                          </h4>
                          <span className="badge ok">COMPLETED</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: "0.85rem" }}>
                          <div>
                            <span className="muted">Vehicle:</span>{" "}
                            <strong>{formatPlate(exitPlate)}</strong>
                          </div>
                          <div>
                            <span className="muted">Exit Gate:</span>{" "}
                            <strong>{exitGate}</strong>
                          </div>
                          <div>
                            <span className="muted">Vehicle Quota Transition:</span>{" "}
                            <strong>
                              {exitResult.quota_before} → {exitResult.quota_after} remaining
                            </strong>
                          </div>
                          <div>
                            <span className="muted">Completed At:</span>{" "}
                            <span>{new Date().toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* ------------------------------------------------ live log ------------------------------------------------ */}
      <section className="card gc-log-card">
        <header className="gc-panel-head">
          <LuTerminal /> <h3>Live server log</h3>
          <span className={`gc-live ${live ? "on" : ""}`}>
            <span className="gc-live-dot" /> {live ? "streaming" : "connecting"}
          </span>
          <button className="btn gc-clear" onClick={() => setLogs([])}>
            <LuTrash2 /> Clear
          </button>
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
