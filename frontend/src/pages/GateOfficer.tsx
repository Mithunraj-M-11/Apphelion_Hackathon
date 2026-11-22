// Officer actions at the gate. The pipeline is the only thing that lifts a barrier on its own; everything else is
// an officer action with a reason, recorded and never deleted. Releasing a hold or resolving an old trip does not
// open the barrier: the truck is read again and goes through every check.
import { useState } from "react";
import { LuClipboardList, LuDoorOpen, LuRotateCcw, LuUnlock, LuUserCheck } from "react-icons/lu";
import { api, gateApi, type GateDecision, type Hold, type TripSession } from "../api";
import { ErrorNote } from "../components";
import { formatDateTime, formatPlate } from "../format";

const POLICY_CODES = ["TRIP_LIMIT", "TONNE_LIMIT", "VEHICLE_LIMIT", "PER_VEHICLE_LIMIT", "PERMIT_INACTIVE", "OUTSIDE_HOURS"];
const STICKER_CODES = ["RFID_MISSING", "RFID_UNKNOWN", "RFID_REVOKED"];
const IDENTITY_CODES = ["UNREGISTERED_VEHICLE", "UNIDENTIFIED_VEHICLE"];
const BLOCKING_TRIP_CODES = ["UNRESOLVED_TRIP", "CLONE_SUSPECT"];

const MIN_REASON = 3;

/** The reason box and busy / error state shared by every officer action. */
function useOfficerAction(onDone: () => void) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= MIN_REASON;
  const run = async (fn: (reason: string) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn(reason.trim());
      setReason("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = (
    <label className="gc-field">
      Officer's reason (required, recorded)
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Checked chassis number and GB sticker in person"
      />
    </label>
  );
  return { input, run, busy, error, ok };
}

function sessionLabel(s: TripSession) {
  const what = s.status === "ACTIVE" ? "open pass" : s.status === "FLAGGED" ? "flagged trip" : "unresolved trip";
  return `${what} ${s.trip_code}, entered ${formatDateTime(s.entry_at)}`;
}

/** Under a refused decision: what the officer can do about this vehicle, and only that. */
export function OfficerPanel({
  m,
  holds,
  sessions,
  onChanged,
  onReadAgain,
  onExit,
}: {
  m: GateDecision;
  holds: Hold[];
  sessions: TripSession[];
  onChanged: () => void;
  onReadAgain: () => void;
  onExit: (m: GateDecision) => void;
}) {
  const [acted, setActed] = useState(false);
  const act = useOfficerAction(() => {
    setActed(true);
    onChanged();
  });
  if (m.barrier !== "down") return null;

  const codes = m.alerts.map((a) => a.code);
  const truckId = m.truck?.id ?? null;
  const exit = m.direction === "OUT";
  const notes: string[] = [];

  if (m.barrier_forced) {
    return (
      <div className="gc-officer">
        <div className="gc-officer-head">
          <LuUserCheck /> Officer
        </div>
        <p className="small">
          The vehicle broke through the barrier. It is recorded{m.trip === "ILLEGAL" ? " as an illegal trip" : ""} with a
          critical alert. There is nothing to release at the gate; follow it up from Alerts.
        </p>
      </div>
    );
  }

  // Holds raised on this vehicle, or by this read (a clone case holds the other truck too)
  const relHolds = holds.filter((h) => h.truck_id === truckId || h.movement_id === m.id);
  // The trip that blocks a new pass at entry; the pass the officer can close at exit
  const truckSession = truckId != null ? sessions.find((s) => s.truck_id === truckId) : undefined;
  const blockingTrip = !exit && codes.some((c) => BLOCKING_TRIP_CODES.includes(c)) ? truckSession : undefined;
  const truckHeld = holds.some((h) => h.truck_id === truckId);
  const canLetOut = exit && truckId != null && truckSession != null;

  if (!truckId || codes.some((c) => IDENTITY_CODES.includes(c))) {
    notes.push("Vehicle not identified against the GB registry: keep it at the barrier and escalate.");
  }
  if (!exit && codes.some((c) => POLICY_CODES.includes(c))) {
    notes.push("Contract limit (quota, permit period or hours): no officer override at the gate. The truck is turned away.");
  }
  if (!exit && codes.some((c) => STICKER_CODES.includes(c))) {
    notes.push("GB sticker missing, unreadable or revoked: refused for now. The sticker is fixed or reissued at the GB office.");
  }
  if (exit && truckId != null && truckSession == null && relHolds.length === 0) {
    notes.push("No open pass for this truck: it did not enter through a GB gate. Keep it at the barrier and escalate.");
  }

  const hasActions = relHolds.length > 0 || blockingTrip != null || canLetOut;
  if (!hasActions && notes.length === 0) return null;

  return (
    <div className="gc-officer">
      <div className="gc-officer-head">
        <LuUserCheck /> Officer
      </div>
      {notes.map((n) => (
        <p key={n} className="small">{n}</p>
      ))}

      {hasActions && act.input}

      {relHolds.map((h) => (
        <div key={h.id} className="gc-officer-row">
          <div className="small">
            <strong>{formatPlate(h.truck.plate, h.truck.plate_type)}</strong> on hold ({h.reason_code}) since{" "}
            {formatDateTime(h.created_at)}
          </div>
          <button
            className="btn small"
            disabled={act.busy || !act.ok}
            onClick={() => act.run((r) => gateApi.releaseHold(h.id, r))}
          >
            <LuUnlock /> Release hold
          </button>
        </div>
      ))}

      {blockingTrip && (
        <div className="gc-officer-row">
          <div className="small">
            Blocking: {sessionLabel(blockingTrip)}.
            {blockingTrip.status === "ACTIVE" && (
              <span className="warn-text"> Close it only if the truck holding this pass is not inside the site.</span>
            )}
          </div>
          <div className="gc-officer-btns">
            <button
              className="btn small"
              disabled={act.busy || !act.ok}
              onClick={() => act.run((r) => api.resolveTrip(blockingTrip.session_id, "RESOLVE", r))}
              title="The trip stays counted, closed by the officer"
            >
              Late close
            </button>
            <button
              className="btn small"
              disabled={act.busy || !act.ok}
              onClick={() => act.run((r) => api.resolveTrip(blockingTrip.session_id, "CANCEL", r))}
              title="The trip did not happen; its reservation is released"
            >
              Cancel trip
            </button>
          </div>
        </div>
      )}

      {canLetOut && (
        <div className="gc-officer-row">
          <div className="small">
            Let {formatPlate(m.truck!.plate, m.truck!.plate_type)} out on its {sessionLabel(truckSession!)}. The pass is
            closed by the officer and flagged; the trip counts.
            {truckHeld && <span className="warn-text"> Release the hold first.</span>}
          </div>
          <button
            className="btn small"
            disabled={act.busy || !act.ok || truckHeld}
            onClick={() =>
              act.run(async (r) => {
                const out = await gateApi.officerExit(m.id, r);
                onExit(out);
              })
            }
          >
            <LuDoorOpen /> Let out
          </button>
        </div>
      )}

      {(relHolds.length > 0 || blockingTrip) && (
        <button className="btn primary small gc-officer-again" disabled={!acted} onClick={onReadAgain}>
          <LuRotateCcw /> Read the vehicle again
        </button>
      )}
      <ErrorNote error={act.error} />
    </div>
  );
}

/** Everything waiting for an officer under the session permit: active holds and open / unresolved trips. */
export function OpenItems({
  holds,
  sessions,
  onChanged,
}: {
  holds: Hold[];
  sessions: TripSession[];
  onChanged: () => void;
}) {
  const act = useOfficerAction(onChanged);
  const unresolved = sessions.filter((s) => s.status !== "ACTIVE");
  const open = sessions.filter((s) => s.status === "ACTIVE");
  const count = holds.length + unresolved.length;
  return (
    <section className="card gc-open-items">
      <header className="gc-panel-head">
        <LuClipboardList /> <h3>Waiting for an officer</h3>
        <span className={`badge ${count ? "warn" : "ok"} small`}>{count ? `${count} open` : "none"}</span>
        <span className="muted small">
          {open.length} truck{open.length === 1 ? "" : "s"} inside on an open pass
        </span>
      </header>
      {count === 0 ? (
        <p className="muted small">No holds and no unresolved trips under this session's permit.</p>
      ) : (
        <>
          {act.input}
          {holds.map((h) => (
            <div key={`h${h.id}`} className="gc-officer-row">
              <div className="small">
                <span className="badge bad small">Hold</span>{" "}
                <strong>{formatPlate(h.truck.plate, h.truck.plate_type)}</strong> ({h.reason_code}) since{" "}
                {formatDateTime(h.created_at)}
              </div>
              <button
                className="btn small"
                disabled={act.busy || !act.ok}
                onClick={() => act.run((r) => gateApi.releaseHold(h.id, r))}
              >
                <LuUnlock /> Release
              </button>
            </div>
          ))}
          {unresolved.map((s) => (
            <div key={`s${s.id}`} className="gc-officer-row">
              <div className="small">
                <span className="badge warn small">Trip</span>{" "}
                <strong>{s.truck ? formatPlate(s.truck.plate, s.truck.plate_type) : `truck #${s.truck_id}`}</strong>{" "}
                {sessionLabel(s)}
              </div>
              <div className="gc-officer-btns">
                <button
                  className="btn small"
                  disabled={act.busy || !act.ok}
                  onClick={() => act.run((r) => api.resolveTrip(s.session_id, "RESOLVE", r))}
                >
                  Late close
                </button>
                <button
                  className="btn small"
                  disabled={act.busy || !act.ok}
                  onClick={() => act.run((r) => api.resolveTrip(s.session_id, "CANCEL", r))}
                >
                  Cancel trip
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      <ErrorNote error={act.error} />
    </section>
  );
}
