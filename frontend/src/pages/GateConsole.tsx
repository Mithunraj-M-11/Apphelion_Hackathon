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
  type Hold,
  type Ledger,
  type LogEntry,
  type Movement,
  type Permit,
  type RfidSticker,
  type TripSession,
  type Truck,
  type TruckListItem,
} from "../api";
import { AlertList, BarrierBadge, ErrorNote, ResultBadge, TripBadge } from "../components";
import { CHECK_LABEL, formatDateTime, formatPlate } from "../format";
import { OfficerPanel, OpenItems } from "./GateOfficer";
import {
  markCounts,
  readingsFor,
  TamperCount,
  VehicleRows,
  type RfidSimMode,
  type RowsProps,
  type Setup,
} from "./GateVehicleRows";

/** A registered truck as it physically arrives: its own plate and FASTag, with the given GB sticker. */
const registered = (plate: string, rfidUid: string, rfidSimMode: RfidSimMode = "genuine"): Setup => ({
  vehicle: "registered",
  registeredPlate: plate,
  outsidePlate: "",
  outsideLength: 8.2,
  plate: "own",
  customPlate: "",
  tag: "own",
  tagFrom: "",
  rfidUid,
  rfidSimMode,
});

/** A vehicle that is not in the GB registry, optionally showing a copied plate / FASTag / sticker. */
const outside = (o: Partial<Setup> & { outsidePlate: string; outsideLength: number }): Setup => ({
  vehicle: "outside",
  registeredPlate: "",
  plate: "own",
  customPlate: "",
  tag: "none",
  tagFrom: "",
  rfidUid: "",
  rfidSimMode: "genuine",
  ...o,
});

/** The weigh pad and barrier side of a preset (load in tonnes, or % of rated capacity). */
type Physical = { load: string; noWeight: boolean; force: boolean };
const NORMAL: Physical = { load: "0", noWeight: false, force: false };

type EntryPreset = { name: string; setup: Setup; physical?: Partial<Physical> };

/** Entry presets. Each story uses its own truck, so running one never blocks another. The trucks the impostor
 * stories pretend to be (OD09AB1234, OD09AE4521) are not used by any honest story, because those stories hold them. */
const PRESETS: EntryPreset[] = [
  { name: "Honest truck (control)", setup: registered("OD09AC5678", "GB-RFID-00002") },
  { name: "Arrives already loaded", setup: registered("OD09AG1180", "GB-RFID-00006"), physical: { load: "10" } },
  { name: "Weigh pad skipped at entry", setup: registered("OD09AH2468", "GB-RFID-00007"), physical: { noWeight: true } },
  { name: "Cloned GB RFID sticker (chip fails)", setup: registered("OD09AD0090", "GB-RFID-00003", "cloned") },
  {
    name: "Genuine truck after a clone attempt (run the previous preset first)",
    setup: registered("OD09AD0090", "GB-RFID-00003"),
  },
  { name: "Revoked GB RFID sticker", setup: registered("OD02BQ4410", "GB-RFID-00011", "revoked") },
  { name: "GB RFID sticker removed", setup: registered("OD09AF7733", "") },
  { name: "Suspended truck", setup: registered("OD09AM1111", "GB-RFID-00019") },
  {
    name: "Perfect clone: copied plate, FASTag and sticker UID",
    setup: outside({
      outsidePlate: "OD02KK7310",
      outsideLength: 8.3,
      plate: "custom",
      customPlate: "OD09AB1234",
      tag: "from",
      tagFrom: "OD09AB1234",
      rfidUid: "GB-RFID-00001",
      rfidSimMode: "cloned",
    }),
  },
  {
    name: "Fake plate, FASTag removed",
    setup: outside({ outsidePlate: "OD14QQ0042", outsideLength: 9.7, plate: "custom", customPlate: "OD09AB1234" }),
  },
  {
    name: "Fake plate + FASTag stolen from another truck",
    setup: outside({
      outsidePlate: "OD02KK7310",
      outsideLength: 8.3,
      plate: "custom",
      customPlate: "OD09AB1234",
      tag: "from",
      tagFrom: "OD09AE4521",
    }),
  },
  {
    name: "Unregistered truck",
    setup: outside({
      outsidePlate: "OD09ZX7781",
      outsideLength: 8.1,
      rfidUid: "GB-RFID-99999",
      rfidSimMode: "unknown_damaged",
    }),
  },
  {
    name: "Unregistered truck breaks through the barrier",
    setup: outside({ outsidePlate: "OD07TT4410", outsideLength: 9.1 }),
    physical: { force: true },
  },
  { name: "Light vehicle (car): logged, not a trip", setup: outside({ outsidePlate: "OD02CA1188", outsideLength: 4.3 }) },
];

/** Exit presets, applied to the latest entry: the same vehicle (or another one) arrives at the exit. */
type ExitPreset = {
  name: string;
  vehicle: "entry" | { plate: string; rfidUid: string }; // the entry's vehicle, or another registered truck
  sticker?: string; // a different GB sticker read on the entry's vehicle
  qr: "entry" | "none" | "edited";
  physical: Partial<Physical>;
  hint: string;
};

const EXIT_PRESETS: ExitPreset[] = [
  {
    name: "Honest exit, loaded 90%",
    vehicle: "entry",
    qr: "entry",
    physical: { load: "90%" },
    hint: "Pass closed, legal trip, net tonnes recorded.",
  },
  {
    name: "No QR shown (fallback close)",
    vehicle: "entry",
    qr: "none",
    physical: { load: "90%" },
    hint: "Closed on plate + FASTag + length + sticker, once a day per truck, with a Medium alert.",
  },
  {
    name: "Overloaded (120% of rated)",
    vehicle: "entry",
    qr: "entry",
    physical: { load: "120%" },
    hint: "Allowed out (the trip is real), with an overload alert.",
  },
  {
    name: "Weigh pad skipped at exit",
    vehicle: "entry",
    qr: "entry",
    physical: { load: "90%", noWeight: true },
    hint: "Allowed out, with a weigh-bypass alert: net tonnes unknown.",
  },
  {
    name: "Same QR used again (run an exit first)",
    vehicle: "entry",
    qr: "entry",
    physical: { load: "90%" },
    hint: "The pass is already closed: refused, PASS_REUSE, truck on hold.",
  },
  {
    name: "QR of a different truck",
    vehicle: { plate: "OD09AJ3579", rfidUid: "GB-RFID-00008" },
    qr: "entry",
    physical: { load: "90%" },
    hint: "OD 09 AJ 3579 shows this entry's QR: refused, both trucks on hold.",
  },
  {
    name: "Different GB sticker at exit",
    vehicle: "entry",
    sticker: "GB-RFID-00010",
    qr: "entry",
    physical: { load: "90%" },
    hint: "The sticker belongs to another truck: refused, both on hold. Then Release hold and Let out.",
  },
  {
    name: "Edited / forged QR",
    vehicle: "entry",
    qr: "edited",
    physical: { load: "90%" },
    hint: "One character of the QR changed: the signature fails, refused.",
  },
  {
    name: "No pass, breaks through",
    vehicle: { plate: "OD09AK6402", rfidUid: "GB-RFID-00009" },
    qr: "none",
    physical: { load: "90%", force: true },
    hint: "A truck that never entered through a GB gate forces the exit: ILLEGAL trip, critical alert.",
  },
];

/** A QR with one character of its signed body changed: what an edited or forged pass looks like. */
const editToken = (token: string) => {
  const i = Math.min(12, Math.max(0, token.indexOf(".") - 1));
  return token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
};

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
  const [activeSessions, setActiveSessions] = useState<TripSession[]>([]);
  // Waiting for an officer under the session permit: active holds, open and unresolved passes
  const [holds, setHolds] = useState<Hold[]>([]);
  const [permitSessions, setPermitSessions] = useState<TripSession[]>([]);

  // Entry setup
  const [setup, setSetup] = useState<Setup>(PRESETS[0].setup);
  const [preset, setPreset] = useState(0);
  const [entrySetup, setEntrySetup] = useState<Setup | null>(null); // what the latest entry physically was
  const [closedPasses, setClosedPasses] = useState<string[]>([]); // passes closed at an exit in this tab
  const [exitPreset, setExitPreset] = useState(0);

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

  // This walkthrough session's own permit (kept for the browser tab), so the demo never touches the real permit.
  // Bumping permitEpoch (after "Clear history") starts a fresh one.
  const [permitEpoch, setPermitEpoch] = useState(0);
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
      })
      .catch((e) => setError(e.message));
  }, [session, source, permitEpoch]);

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
    if (permit) reloadPermit(permit.id);
  };

  const reloadPermit = (permitId: number) => {
    gateApi.ledger(permitId).then(setLedger).catch(() => {});
    gateApi.holds(permitId).then(setHolds).catch(() => {});
    api
      .trips({ permit_id: permitId, status: "ACTIVE,EXPIRED_UNRESOLVED,FLAGGED" })
      .then(setPermitSessions)
      .catch(() => {});
  };

  useEffect(() => {
    reloadData();
  }, []);

  useEffect(() => {
    if (permit) reloadPermit(permit.id);
  }, [permit]);

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
      }
    }
  }, [setup, exitSetup, trucks, details]);

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
  const exitActive = activeSessions.find((s) => s.truck?.plate === exitR.plateRead);

  /** Entry form edits. Picking a registered truck by hand fills in its own GB sticker (a preset keeps its own). */
  // Hints under the entry preset: the claimed truck already has an open pass, or is on hold
  const claimedPlate =
    setup.vehicle === "registered" ? setup.registeredPlate : setup.plate === "custom" ? setup.customPlate : "";
  const entryOpen = claimedPlate ? permitSessions.find((x) => x.status === "ACTIVE" && x.truck?.plate === claimedPlate) : undefined;
  const entryHeld = claimedPlate ? holds.find((h) => h.truck.plate === claimedPlate) : undefined;

  const update = (patch: Partial<Setup>) =>
    setSetup((s) => {
      const next = { ...s, ...patch };
      if (patch.registeredPlate !== undefined && next.vehicle === "registered") {
        next.rfidUid = stickers[next.registeredPlate]?.uid ?? "";
      }
      return next;
    });

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
      applyExitPreset(0);
      setExitResult(null);
      setExitMovement(null);
    }
  };

  /** Entry preset: the vehicle, plus the weigh pad and barrier side of the story. */
  const applyPreset = (i: number) => {
    const ph = { ...NORMAL, ...PRESETS[i].physical };
    setPreset(i);
    setSetup(PRESETS[i].setup);
    setEntryLoad(ph.load);
    setNoWeight(ph.noWeight);
    setForceBarrier(ph.force);
  };

  /** Exit preset, applied to the latest entry (its vehicle and the pass it was given). */
  const applyExitPreset = (i: number) => {
    const ep = EXIT_PRESETS[i];
    const ph = { ...NORMAL, ...ep.physical };
    const base = entrySetup ?? setup;
    let next: Setup = ep.vehicle === "entry" ? { ...base } : registered(ep.vehicle.plate, ep.vehicle.rfidUid);
    if (ep.sticker) next = { ...next, rfidUid: ep.sticker, rfidSimMode: "genuine" };
    const token = movement?.trip_session?.signed_token ?? "";
    setExitPreset(i);
    setExitSetup(next);
    setExitQrToken(ep.qr === "none" || !token ? "" : ep.qr === "edited" ? editToken(token) : token);
    setExitLoad(ph.load);
    setNoWeight(ph.noWeight);
    setForceBarrier(ph.force);
    setPrefilledFrom(movement?.id ?? null);
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

  // One row per thing on the truck, for each barrier; markers show what was staged
  const entryRows: RowsProps = {
    dir: "IN",
    setup,
    update,
    trucks,
    details,
    stickers,
    physical: { load: entryLoad, noWeight, force: forceBarrier },
    setPhysical: (ph) => {
      if (ph.load !== undefined) setEntryLoad(ph.load);
      if (ph.noWeight !== undefined) setNoWeight(ph.noWeight);
      if (ph.force !== undefined) setForceBarrier(ph.force);
    },
    weight: entryWeight,
    openPass: entryOpen?.trip_code ?? null,
  };
  const entryToken = movement?.trip_session?.signed_token ?? "";
  const exitRows: RowsProps = {
    dir: "OUT",
    setup: exitSetup,
    update: updateExit,
    trucks,
    details,
    stickers,
    physical: { load: exitLoad, noWeight, force: forceBarrier },
    setPhysical: (ph) => {
      if (ph.load !== undefined) setExitLoad(ph.load);
      if (ph.noWeight !== undefined) setNoWeight(ph.noWeight);
      if (ph.force !== undefined) setForceBarrier(ph.force);
    },
    weight: weighPad(exitR.reg, exitLoad),
    qr: {
      value: exitQrToken,
      entryToken,
      editedToken: entryToken ? editToken(entryToken) : "",
      entryPlate: movement?.trip_session?.truck?.plate ?? movement?.truck?.plate ?? "",
      entryPassUsed: !!movement?.trip_session && closedPasses.includes(movement.trip_session.trip_code),
      set: setExitQrToken,
    },
    openPass: exitActive?.trip_code ?? null,
  };

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
      setEntrySetup({ ...setup });
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
      showExit(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Show an exit decision (from the exit pole, or from an officer letting the truck out). */
  const showExit = (m: GateDecision) => {
    const checks = (m.trip_checks ?? []) as Check[];
    const closed = m.barrier === "up" ? m.trip_session?.trip_code : undefined;
    if (closed) setClosedPasses((cur) => (cur.includes(closed) ? cur : [...cur, closed]));
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
  };

  /** Wipe every Gate console session from the database and start again on a fresh permit. */
  const clearHistory = async () => {
    if (!window.confirm("Clear the entire Gate console history? All console gate events, passes, holds, alerts and " +
                        "log lines are deleted. Scenario runs, site runs and real gate data are kept.")) return;
    setBusy(true);
    setError(null);
    try {
      await gateApi.clearWalkthroughHistory();
      setMovement(null);
      setExitMovement(null);
      setExitResult(null);
      setPrefilledFrom(null);
      setClosedPasses([]);
      setExitSetup(BLANK_EXIT);
      setExitQrToken("");
      setRevealed(0);
      setLogs([]);
      setHolds([]);
      setPermitSessions([]);
      setActiveSessions([]);
      setLedger(null);
      setPermit(null);
      setMode("ENTRY");
      setPermitEpoch((n) => n + 1);
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
        <button className="btn gc-clear-history" disabled={busy} onClick={clearHistory}
                title="Delete every Gate console session and start on a fresh permit">
          <LuTrash2 /> Clear history
        </button>

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

      {permit && <OpenItems holds={holds} sessions={permitSessions} onChanged={reloadData} />}

      {mode === "ENTRY" ? (
        /* ================================================= ENTRY MODE ================================================= */
        <div className="gc-grid">
          {/* Left panel: Entry Gate Inputs */}
          <section className="card gc-panel">
            <header className="gc-panel-head">
              <LuRadioTower /> <h3>Gate G1 · Entry</h3>
              <TamperCount marks={markCounts(entryRows)} />
              <span className="gc-tag gc-tag-mock">Mocked sensors</span>
            </header>

            <label className="gc-field">
              Preset scenario
              <select
                value={preset}
                onChange={(e) => applyPreset(Number(e.target.value))}
              >
                {PRESETS.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {entryOpen && (
              <div className="gc-hint warn-text small">
                {formatPlate(entryOpen.truck?.plate ?? "")} already has open pass {entryOpen.trip_code}: run its exit
                first, or this entry is treated as a second copy of the same identity (and the truck is held).
              </div>
            )}
            {entryHeld && (
              <div className="gc-hint warn-text small">
                {formatPlate(entryHeld.truck.plate, entryHeld.truck.plate_type)} is on hold ({entryHeld.reason_code}):
                it will be refused until an officer releases it under "Waiting for an officer".
              </div>
            )}

            <VehicleRows {...entryRows} />

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
                    <OfficerPanel
                      key={movement.id}
                      m={movement}
                      holds={holds}
                      sessions={permitSessions}
                      onChanged={reloadData}
                      onReadAgain={arriveEntry}
                      onExit={() => {}}
                    />

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
              <TamperCount marks={markCounts(exitRows)} />
              <span className="gc-tag gc-tag-mock">Exit sensors</span>
            </header>

            <label className="gc-field">
              Exit preset (applied to the latest entry)
              <select value={exitPreset} onChange={(e) => applyExitPreset(Number(e.target.value))}>
                {EXIT_PRESETS.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="gc-hint muted small">{EXIT_PRESETS[exitPreset].hint}</div>
            {EXIT_PRESETS[exitPreset].qr !== "none" && !movement?.trip_session && (
              <div className="gc-hint warn-text small">
                The latest entry was not given a pass, so there is no QR to show. Run an honest entry first.
              </div>
            )}

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

            <VehicleRows {...exitRows} />

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
                    {exitMovement && (
                      <OfficerPanel
                        key={exitMovement.id}
                        m={exitMovement}
                        holds={holds}
                        sessions={permitSessions}
                        onChanged={reloadData}
                        onReadAgain={arriveExit}
                        onExit={showExit}
                      />
                    )}

                    {exitResult.reasons && exitResult.reasons.length > 0 && (
                      <div className="small bad-text">
                        {exitResult.reasons.join("; ")}
                      </div>
                    )}

                    {exitResult.passed && exitResult.session && (
                      <div className="gc-trip-pass" style={{ background: "var(--ok-bg)", border: "1px solid var(--ok)" }}>
                        <div className="gc-trip-pass-head">
                          <h4 style={{ margin: 0 }}>
                            Trip {exitResult.session.trip_code} Completed
                            {exitResult.session.close_mode === "officer" ? " (let out by an officer)" : ""}
                          </h4>
                          <span className={`badge ${exitResult.session.close_mode === "officer" ? "warn" : "ok"}`}>
                            {exitResult.session.close_mode === "officer" ? "CLOSED BY OFFICER" : "COMPLETED"}
                          </span>
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
