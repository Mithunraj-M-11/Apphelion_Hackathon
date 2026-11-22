import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { IconType } from "react-icons";
import {
  LuBarChart3,
  LuCalculator,
  LuCheck,
  LuCpu,
  LuDoorClosed,
  LuExternalLink,
  LuFingerprint,
  LuLogIn,
  LuLogOut,
  LuPlay,
  LuRadioTower,
  LuScale,
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
  type GateDecision,
  type Ledger,
  type LogEntry,
  type Movement,
  type Permit,
  type RfidSticker,
  type TripSession,
  type Truck,
  type TruckListItem,
  type VehicleQuota,
} from "../api";
import { AlertList, BarrierBadge, ErrorNote, ResultBadge, TripBadge } from "../components";
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
    name: "GB RFID sticker removed",
    setup: {
      vehicle: "registered",
      registeredPlate: "OD09AF7733",
      outsidePlate: "",
      outsideLength: 8.3,
      plate: "own",
      customPlate: "",
      tag: "own",
      tagFrom: "",
      rfidUid: "",
      rfidSimMode: "genuine",
    },
  },
  {
    name: "Perfect clone: copied plate, FASTag and sticker UID",
    setup: {
      vehicle: "outside",
      registeredPlate: "",
      outsidePlate: "OD02KK7310",
      outsideLength: 8.3,
      plate: "custom",
      customPlate: "OD09AB1234",
      tag: "from",
      tagFrom: "OD09AB1234",
      rfidUid: "GB-RFID-00001",
      rfidSimMode: "cloned",
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

const STEP_ICON: Record<string, IconType> = {
  Identify: LuFingerprint,
  Eligibility: LuShieldCheck,
  "Pass check": LuShieldCheck,
  Measure: LuScale,
  Pass: LuTag,
  Compare: LuCalculator,
  Barrier: LuDoorClosed,
};

/** Today in site time (IST), YYYY-MM-DD. */
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function stepsFor(m: Movement): StepView[] {
  if (m.steps && m.steps.length > 0) {
    // unified pipeline: Identify (plate, FASTag, length, GB sticker), Eligibility / Pass check, Measure, Pass /
    // Compare, Barrier
    return m.steps.map((s) => ({
      name: s.name,
      Icon: STEP_ICON[s.name] ?? LuShieldCheck,
      checks: s.items.map((i) => ({ name: i.label, status: i.status, detail: i.detail }) as unknown as Check),
    }));
  }
  const steps: StepView[] = [{ name: "Identify", Icon: LuFingerprint, checks: m.checks }];
  if (m.trip_checks && m.trip_checks.length > 0) {
    steps.push({ name: "GB Trip Authorization", Icon: LuShieldCheck, checks: m.trip_checks });
  }
  return steps;
}

/** Sensor readings a faithful pole reports for a physical setup (plate, FASTag, radar length). */
function readingsFor(s: Setup, details: Record<string, Truck>) {
  const reg = s.vehicle === "registered" ? details[s.registeredPlate] : undefined;
  const ownPlate = s.vehicle === "registered" ? s.registeredPlate : s.outsidePlate;
  const ownTag = s.vehicle === "registered" ? reg?.fastag_tag_id ?? null : OUTSIDE_TAG;
  const length = s.vehicle === "registered" ? reg?.length_m ?? null : s.outsideLength;
  const plateRead = s.plate === "own" ? ownPlate || null : s.plate === "none" ? null : s.customPlate.trim() || null;
  const tagRead = s.tag === "own" ? ownTag : s.tag === "none" ? null : details[s.tagFrom]?.fastag_tag_id ?? null;
  const ready = s.vehicle === "outside" || !!reg;
  return { reg, ownPlate, plateRead, tagRead, length, ready };
}

/** What physically arrives at a barrier: the vehicle, the plate on it, the FASTag, the GB RFID sticker.
 * Used by both entry and exit: the exit identifies the vehicle again from scratch. */
function IdentityInputs({
  setup,
  update,
  trucks,
  title = "What physically arrives",
  activePlates,
}: {
  setup: Setup;
  update: (patch: Partial<Setup>) => void;
  trucks: TruckListItem[];
  title?: string;
  activePlates?: Set<string>;
}) {
  // trucks with an open trip in this session first (exit), newest registry order otherwise
  const ordered = activePlates
    ? [...trucks].sort((a, b) => Number(activePlates.has(b.plate)) - Number(activePlates.has(a.plate)))
    : trucks;
  return (
    <>
            <div className="gc-sep">{title}</div>
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
                  {ordered.map((t) => (
                    <option key={t.id} value={t.plate}>
                      {formatPlate(t.plate, t.plate_type)} · {t.make} {t.model}
                      {activePlates?.has(t.plate) ? " (open trip)" : ""}
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

    </>
  );
}

const BLANK_EXIT: Setup = {
  vehicle: "registered",
  registeredPlate: "",
  outsidePlate: "",
  outsideLength: 8.2,
  plate: "own",
  customPlate: "",
  tag: "own",
  tagFrom: "",
  rfidUid: "",
  rfidSimMode: "genuine",
};

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
  const [exitSetup, setExitSetup] = useState<Setup>(BLANK_EXIT);
  const [prefilledFrom, setPrefilledFrom] = useState<number | null>(null); // entry movement the exit continues
  const [exitQrToken, setExitQrToken] = useState("");
  const [exitResult, setExitResult] = useState<ExitVerifyOut | null>(null);

  const [movement, setMovement] = useState<GateDecision | null>(null);
  const [exitMovement, setExitMovement] = useState<GateDecision | null>(null);
  const [revealed, setRevealed] = useState(0);

  // Session permit (this demo's own contract limits, so it never uses up the real permit) and its ledger
  const [permit, setPermit] = useState<Permit | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  // Weigh pad and barrier impact (mocked sensors)
  const [entryLoad, setEntryLoad] = useState("0");
  const [exitLoad, setExitLoad] = useState("90%");
  const [noWeight, setNoWeight] = useState(false);
  const [forceBarrier, setForceBarrier] = useState(false);
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

  // This walkthrough session's own permit (kept for the browser tab), so the demo never touches the real permit
  useEffect(() => {
    const key = `sitewatch.walkPermit.${session}`;
    let saved: number | null = null;
    try {
      saved = Number(window.sessionStorage.getItem(key)) || null;
    } catch {
      saved = null;
    }
    const create = () =>
      gateApi.createPermit({
          label: `Gate console session ${session}`,
          valid_from: todayIST(),
          valid_to: todayIST(),
          trip_limit: 10,
          tonne_limit: 300,
          vehicle_limit: 8,
          hours_start: "00:00:00",
          hours_end: "23:59:00",
          exit_grace_min: 30,
          pass_expiry_min: 120,
          per_vehicle_trips: null,
          source,
        });
    // a remembered permit may have been cleared from the database: start a fresh one then
    const load = saved ? gateApi.permit(saved).catch(() => create()) : create();
    load
      .then((p) => {
        setPermit(p);
        try {
          window.sessionStorage.setItem(key, String(p.id));
        } catch {
          /* not remembered; fine */
        }
        gateApi.ledger(p.id).then(setLedger).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [session, source]);

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
    api
      .trips({ status: "ACTIVE" })
      .then((list) => setActiveSessions(list.filter((s) => s.source === source)))
      .catch(() => {});
    if (permit) gateApi.ledger(permit.id).then(setLedger).catch(() => {});
  };

  useEffect(() => {
    reloadData();
  }, []);

  useEffect(() => {
    const needed = [
      setup.vehicle === "registered" ? setup.registeredPlate : "",
      setup.tag === "from" ? setup.tagFrom : "",
      exitSetup.vehicle === "registered" ? exitSetup.registeredPlate : "",
      exitSetup.tag === "from" ? exitSetup.tagFrom : "",
    ].filter((p) => p && !details[p]);
    for (const plate of needed) {
      const t = trucks.find((x) => x.plate === plate);
      if (t) {
        api.truck(t.id).then((d) => setDetails((cur) => ({ ...cur, [plate]: d })));
        api.quota(t.id).then((q) => setQuotas((cur) => ({ ...cur, [plate]: q }))).catch(() => {});
      }
    }
  }, [setup, exitSetup, trucks, details]);

  // When registered truck changes in Entry mode, automatically sync its GB RFID sticker UID
  useEffect(() => {
    if (setup.vehicle === "registered" && setup.registeredPlate) {
      const s = stickers[setup.registeredPlate];
      if (s) {
        setSetup((cur) => ({ ...cur, rfidUid: s.uid }));
      }
    }
  }, [setup.vehicle, setup.registeredPlate, stickers]);


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
  const { reg, plateRead, tagRead, length, ready } = readingsFor(setup, details);
  const exitR = readingsFor(exitSetup, details);
  const activePlates = new Set(activeSessions.map((s) => s.truck?.plate).filter((p): p is string => !!p));
  const exitActive = activeSessions.find((s) => s.truck?.plate === exitR.plateRead);

  const update = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));

  /** Exit form edits. Picking a registered truck by hand fills in its own sticker and its open trip's QR. */
  const updateExit = (patch: Partial<Setup>) => {
    setExitSetup((s) => {
      const next = { ...s, ...patch };
      if (patch.registeredPlate !== undefined && next.vehicle === "registered") {
        next.rfidUid = stickers[next.registeredPlate]?.uid ?? "";
      }
      return next;
    });
    if (patch.registeredPlate !== undefined) {
      const sess = activeSessions.find((x) => x.truck?.plate === patch.registeredPlate);
      setExitQrToken(sess?.signed_token ?? "");
      setPrefilledFrom(null);
    }
  };

  /** Switching to Exit continues the latest entry: the same physical vehicle arrives at the exit barrier,
   * showing the pass it was given (if any). Only once per entry, so edits made for a demo are kept. */
  const openExit = () => {
    setMode("EXIT");
    setRevealed(0);
    if (movement && movement.id !== prefilledFrom) {
      setExitSetup({ ...setup });
      setExitQrToken(movement.trip_session?.signed_token ?? "");
      setExitLoad("90%");
      setForceBarrier(false);
      setExitResult(null);
      setExitMovement(null);
      setPrefilledFrom(movement.id);
    }
  };

  const clearExit = () => {
    setExitSetup(BLANK_EXIT);
    setExitQrToken("");
    setExitResult(null);
    setExitMovement(null);
    setPrefilledFrom(movement?.id ?? null); // don't re-fill from the same entry
  };

  /** Weigh pad reading: the truck's empty weight + what is in the body ("t" or "NN%" of rated capacity). */
  const weighPad = (t: Truck | undefined, load: string, outsideEmpty = 12, outsideRated = 25): number | null => {
    if (noWeight) return null;
    const empty = t ? t.empty_weight_t : outsideEmpty;
    const rated = t ? t.rated_capacity_t : outsideRated;
    const raw = load.trim();
    const tonnes = raw.endsWith("%") ? (rated * Number(raw.slice(0, -1))) / 100 : Number(raw);
    return Number.isFinite(tonnes) ? Math.round((empty + tonnes) * 100) / 100 : null;
  };
  const entryWeight = weighPad(reg, entryLoad);

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
        weight_t: entryWeight,
        barrier_forced: forceBarrier,
        permit_id: permit?.id,
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
      // The exit pole identifies the vehicle again from scratch: plate, FASTag, radar length, GB sticker,
      // plus the weigh pad and the QR shown
      const m = await gateApi.postEvent(exitGate, {
        direction: "OUT",
        plate_read: exitR.plateRead,
        fastag_read: exitR.tagRead,
        radar_length_m: exitR.length,
        weight_t: weighPad(exitR.reg, exitLoad),
        barrier_forced: forceBarrier,
        permit_id: permit?.id,
        source,
        rfid_sticker_uid: exitSetup.rfidUid.trim() || null,
        rfid_sim_mode: exitSetup.rfidSimMode,
        qr_token: exitQrToken.trim() || null,
      });
      const checks = (m.trip_checks ?? []) as Check[];
      setRevealed(0);
      setExitMovement(m);
      setExitResult({
        decision: m.trip_decision ?? (m.barrier === "up" ? "EXIT AUTHORIZED" : "EXIT REJECTED"),
        passed: m.barrier === "up",
        reasons: checks.filter((c) => c.status === "failed").map((c) => c.detail),
        checks,
        session: m.trip_session ?? null,
        quota_before: null,
        quota_after: m.quota_remaining ?? null,
        exit_movement_id: m.id,
      });
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
            onClick={openExit}
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

      {/* Session permit ledger: what this demo's contract allows vs what the gates recorded */}
      {ledger && (
        <div className="card gc-ledger">
          <LuBarChart3 />
          <span>Session permit #{ledger.permit_id}</span>
          <span>Trips reserved <strong>{ledger.trips_reserved}/{ledger.trip_limit}</strong></span>
          <span>Legal <strong>{ledger.legal_trips}</strong></span>
          <span>Actual <strong>{ledger.actual_trips}</strong></span>
          <span className={ledger.illegal_trips ? "bad-text" : ""}>Illegal <strong>{ledger.illegal_trips}</strong></span>
          <span>Tonnes <strong>{ledger.tonnes}/{ledger.tonne_limit}</strong></span>
          <span className={ledger.active_holds ? "warn-text" : ""}>On hold <strong>{ledger.active_holds}</strong></span>
          <span>
            Alerts <strong>{ledger.alerts.CRITICAL}</strong> critical, <strong>{ledger.alerts.HIGH}</strong> high
          </span>
        </div>
      )}

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

            <IdentityInputs setup={setup} update={update} trucks={trucks} />

            <div className="gc-sep" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <LuScale /> WEIGH PAD AND BARRIER
            </div>
            <div className="gc-row">
              <label className="gc-field">
                Load in the body (t, or % of rated)
                <input value={entryLoad} disabled={noWeight} onChange={(e) => setEntryLoad(e.target.value)} placeholder="0" />
              </label>
              <label className="gc-field">
                Weigh pad
                <select value={noWeight ? "skip" : "read"} onChange={(e) => setNoWeight(e.target.value === "skip")}>
                  <option value="read">Reads the truck</option>
                  <option value="skip">Skipped (no reading)</option>
                </select>
              </label>
            </div>
            <label className="gc-field" style={{ flexDirection: "row", alignItems: "center", gap: 6, color: "var(--bad)" }}>
              <input type="checkbox" checked={forceBarrier} onChange={(e) => setForceBarrier(e.target.checked)} />
              Breaks through if the barrier stays down
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
              <div>Weigh pad: {entryWeight != null ? `${entryWeight.toFixed(2)} t` : noWeight ? "no reading" : "…"}</div>
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
                      <BarrierBadge barrier={movement.barrier} forced={movement.barrier_forced} />
                      <ResultBadge result={movement.trip_decision || movement.result} />
                      {movement.flags.map((f) => (
                        <span key={f} className="badge neutral">
                          {f.replace("_", " ")}
                        </span>
                      ))}
                    </div>
                    <AlertList alerts={movement.alerts} />

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
                                <span className="muted">SMS code:</span>{" "}
                                <strong className="mono">{movement.trip_session.sms_code || "—"}</strong>
                              </div>
                              <div>
                                <span className="muted">Entry weight:</span>{" "}
                                <strong>
                                  {movement.trip_session.entry_weight_t != null
                                    ? `${movement.trip_session.entry_weight_t.toFixed(2)} t`
                                    : "—"}
                                </strong>
                              </div>
                              <div>
                                <span className="muted">Vehicle allocation:</span>{" "}
                                <strong>
                                  {movement.quota_remaining != null
                                    ? `${movement.quota_remaining} / ${movement.quota_max} left`
                                    : "none in this contract"}
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

            {movement && prefilledFrom === movement.id && (
              <div className="gc-continue">
                <div>
                  <strong>Continuing from entry #{movement.id}</strong>{" "}
                  <span className="muted small">
                    {movement.plate_read ? formatPlate(movement.plate_read) : "no plate"} ·{" "}
                    {movement.trip_session
                      ? `pass ${movement.trip_session.trip_code}`
                      : "no pass issued (refused at entry)"}
                  </span>
                </div>
                <button className="btn small" onClick={clearExit}>Clear</button>
              </div>
            )}

            <IdentityInputs
              setup={exitSetup}
              update={updateExit}
              trucks={trucks}
              title="What physically arrives at the exit"
              activePlates={activePlates}
            />

            <label className="gc-field">
              Presented Internal Trip QR Token
              <textarea
                rows={3}
                style={{ font: "inherit", fontSize: "0.8rem", width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--border)" }}
                value={exitQrToken}
                onChange={(e) => setExitQrToken(e.target.value)}
                placeholder="The pass shown at the exit (filled from the entry, or paste another one)"
              />
            </label>

            <div className="gc-row">
              <label className="gc-field">
                Load in the body (t, or % of rated)
                <input value={exitLoad} disabled={noWeight} onChange={(e) => setExitLoad(e.target.value)} placeholder="90%" />
              </label>
              <label className="gc-field">
                Weigh pad
                <select value={noWeight ? "skip" : "read"} onChange={(e) => setNoWeight(e.target.value === "skip")}>
                  <option value="read">Reads the truck</option>
                  <option value="skip">Skipped (no reading)</option>
                </select>
              </label>
            </div>
            <label className="gc-field" style={{ flexDirection: "row", alignItems: "center", gap: 6, color: "var(--bad)" }}>
              <input type="checkbox" checked={forceBarrier} onChange={(e) => setForceBarrier(e.target.checked)} />
              Breaks through if the barrier stays down
            </label>

            <div className="gc-preview">
              <div className="field-label">Exit pole will report</div>
              <div>
                Plate:{" "}
                {exitR.plateRead ? (
                  <span className="plate plate-sm">{formatPlate(exitR.plateRead)}</span>
                ) : (
                  <span className="muted">none</span>
                )}
              </div>
              <div>
                FASTag: <span className="mono small">{shortTag(exitR.tagRead)}</span>
              </div>
              <div>Radar length: {exitR.length != null ? `${exitR.length.toFixed(2)} m` : "…"}</div>
              <div>
                GB RFID: <span className="mono small">{exitSetup.rfidUid || "none"}</span>{" "}
                <span className="badge neutral small">{exitSetup.rfidSimMode}</span>
              </div>
              <div>
                Weigh pad:{" "}
                {(() => {
                  const w = weighPad(exitR.reg, exitLoad);
                  return w != null ? `${w.toFixed(2)} t` : noWeight ? "no reading" : "…";
                })()}
              </div>
              <div>
                QR shown: <span className="mono small">{exitQrToken ? `${exitQrToken.slice(0, 18)}…` : "none"}</span>
              </div>
              <div>
                Open trip for this plate:{" "}
                {exitActive ? (
                  <span className="ok-text">{exitActive.trip_code}</span>
                ) : (
                  <span className="muted">none found</span>
                )}
              </div>
            </div>

            <button
              className="btn primary gc-go"
              disabled={busy || !exitR.ready}
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
                      {exitMovement && <BarrierBadge barrier={exitMovement.barrier} forced={exitMovement.barrier_forced} />}
                      <ResultBadge result={exitResult.decision} />
                      {exitMovement && <TripBadge trip={exitMovement.trip} />}
                    </div>
                    {exitMovement && <AlertList alerts={exitMovement.alerts} />}

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
                            <strong>{exitR.plateRead ? formatPlate(exitR.plateRead) : "no plate"}</strong>
                          </div>
                          <div>
                            <span className="muted">Exit Gate:</span>{" "}
                            <strong>{exitGate}</strong>
                          </div>
                          <div>
                            <span className="muted">Net load (weigh pad):</span>{" "}
                            <strong>
                              {exitResult.session.net_t != null ? `${exitResult.session.net_t.toFixed(2)} t` : "not measured"}
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
