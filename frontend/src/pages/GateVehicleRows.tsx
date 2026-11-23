// What physically arrives at a gate barrier, one row per thing on the truck. Each row has a marker for what was
// STAGED (green genuine, amber breaks a rule, red tampered), never a prediction of the GB server's decision: the left
// panel shows the cheat that was set up, the server panel shows whether it was caught.
import type { ReactNode } from "react";
import type { RfidSticker, Truck, TruckListItem } from "../api";
import { formatPlate } from "../format";

export type VehicleKind = "registered" | "outside";
export type PlateShown = "own" | "none" | "custom";
export type TagShown = "own" | "none" | "from";
export type RfidSimMode = "genuine" | "cloned" | "revoked" | "unknown_damaged";

export type Setup = {
  vehicle: VehicleKind;
  registeredPlate: string;
  outsidePlate: string;
  outsideLength: number;
  plate: PlateShown;
  customPlate: string;
  tag: TagShown;
  tagFrom: string;
  rfidUid: string;
  rfidSimMode: RfidSimMode;
  camera?: "ok" | "unreadable" | "misread"; // sensor fault: the plate is there, the camera fails
  fastagReader?: "ok" | "missed"; // sensor fault: the tag is there, the reader misses it
  outsideEmpty?: number; // empty weight of an outside vehicle (t), default 12
};

export const OUTSIDE_TAG = "34161FA8000000000000OUT1"; // an outside truck's own FASTag: real, not in the GB registry
export const LIGHT_VEHICLE_MAX_M = 6; // shorter vehicles are logged, not trips (rule C2)

export type Mark = "ok" | "warn" | "bad";

/** Sensor readings a faithful pole reports for a physical setup (plate, FASTag, radar length). */
export function readingsFor(s: Setup, details: Record<string, Truck>) {
  const reg = s.vehicle === "registered" ? details[s.registeredPlate] : undefined;
  const ownPlate = s.vehicle === "registered" ? s.registeredPlate : s.outsidePlate;
  const ownTag = s.vehicle === "registered" ? reg?.fastag_tag_id ?? null : OUTSIDE_TAG;
  const length = s.vehicle === "registered" ? reg?.length_m ?? null : s.outsideLength;
  let plateRead = s.plate === "own" ? ownPlate || null : s.plate === "none" ? null : s.customPlate.trim() || null;
  if (plateRead && s.camera === "unreadable") plateRead = null;
  else if (plateRead && s.camera === "misread") plateRead = plateRead.slice(0, -1) + (plateRead.endsWith("8") ? "3" : "8");
  let tagRead = s.tag === "own" ? ownTag : s.tag === "none" ? null : details[s.tagFrom]?.fastag_tag_id ?? null;
  if (tagRead && s.fastagReader === "missed") tagRead = null;
  const ready = s.vehicle === "outside" || !!reg;
  return { reg, ownPlate, plateRead, tagRead, length, ready };
}

const shortTag = (t: string | null) => (t ? (t.length > 12 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t) : "none");

/** Load presets (tonnes, or % of rated capacity). */
const LOADS: { value: string; label: string }[] = [
  { value: "0", label: "Empty" },
  { value: "10", label: "10 t (arrives loaded)" },
  { value: "50%", label: "Half (50%)" },
  { value: "90%", label: "Loaded (90%)" },
  { value: "120%", label: "Overloaded (120%)" },
];

/** Which GB sticker is on the vehicle, as one choice (UID + chip behaviour together). */
type StickerKind = "own" | "none" | "cloned" | "revoked" | "damaged" | `other:${string}`;

function stickerKind(s: Setup, stickers: Record<string, RfidSticker>): StickerKind {
  if (!s.rfidUid) return "none";
  if (s.rfidSimMode === "cloned") return "cloned";
  if (s.rfidSimMode === "revoked") return "revoked";
  if (s.rfidSimMode === "unknown_damaged") return "damaged";
  const own = s.vehicle === "registered" ? stickers[s.registeredPlate]?.uid : undefined;
  if (own && s.rfidUid === own) return "own";
  const owner = Object.entries(stickers).find(([, st]) => st.uid === s.rfidUid)?.[0];
  return owner ? `other:${owner}` : "damaged";
}

/** The truck whose identity the vehicle shows (plate shown, else its own): a clone copies that truck's sticker. */
function claimedPlate(s: Setup) {
  if (s.plate === "custom" && s.customPlate) return s.customPlate;
  return s.vehicle === "registered" ? s.registeredPlate : "";
}

function Row({ label, mark, reading, children }: { label: string; mark: Mark; reading?: ReactNode; children: ReactNode }) {
  return (
    <div className="gc-vrow">
      <span className={`gc-mark gc-mark-${mark}`} title={mark === "ok" ? "Genuine" : mark === "warn" ? "Breaks a rule" : "Tampered"} />
      <span className="gc-vlabel">{label}</span>
      <div className="gc-vctrl">{children}</div>
      {reading != null && <div className="gc-vread">{reading}</div>}
    </div>
  );
}

export type Physical = { load: string; noWeight: boolean; force: boolean };

export type QrChoice = {
  value: string;
  entryToken: string;
  editedToken: string;
  entryPlate: string; // the truck the entry pass was issued to
  entryPassUsed: boolean; // that pass was already closed at an exit
  set: (token: string) => void;
};

export type RowsProps = {
  dir: "IN" | "OUT";
  setup: Setup;
  update: (patch: Partial<Setup>) => void;
  trucks: TruckListItem[];
  details: Record<string, Truck>;
  stickers: Record<string, RfidSticker>;
  physical: Physical;
  setPhysical: (patch: Partial<Physical>) => void;
  weight: number | null;
  qr?: QrChoice;
  openPass?: string | null;
};

/** Every row's mark and the values the rows show, from one place (rows and header count agree). */
function analyse({ dir, setup, trucks, details, stickers, physical, qr, openPass }: RowsProps) {
  const r = readingsFor(setup, details);
  const light = setup.vehicle === "outside" && setup.outsideLength < LIGHT_VEHICLE_MAX_M;
  const listed = trucks.find((t) => t.plate === setup.registeredPlate);

  // ---- vehicle
  const vehicleMark: Mark =
    setup.vehicle === "outside" ? (light ? "ok" : "bad") : listed && !listed.authorisation.authorised ? "warn" : "ok";
  const vehicleNote =
    setup.vehicle === "outside"
      ? light
        ? `light vehicle, ${setup.outsideLength} m: not a truck`
        : `not in the GB registry, ${setup.outsideLength} m`
      : listed && !listed.authorisation.authorised
      ? `not authorised: ${listed.authorisation.reasons.join("; ") || listed.status}`
      : `registered, ${r.length != null ? `${r.length.toFixed(2)} m` : "…"}${openPass ? ` · open pass ${openPass}` : ""}`;

  const kind = stickerKind(setup, stickers);
  const stickerMark: Mark = kind === "own" || (kind === "none" && setup.vehicle === "outside") ? "ok" : "bad";
  const rated = r.reg?.rated_capacity_t ?? 25;
  const raw = physical.load.trim();
  const tonnes = raw.endsWith("%") ? (rated * Number(raw.slice(0, -1))) / 100 : Number(raw);
  const loadMark: Mark = physical.noWeight
    ? "ok"
    : dir === "IN"
    ? tonnes > 1 ? "warn" : "ok"
    : tonnes > rated || tonnes < 0.5 ? "warn" : "ok";
  const qrValue = !qr
    ? ""
    : !qr.value
    ? "none"
    : qr.value === qr.entryToken
    ? "entry"
    : qr.value === qr.editedToken
    ? "edited"
    : "other";
  const qrMisused =
    qrValue === "entry" && !!qr && (qr.entryPassUsed || (!!qr.entryPlate && claimedPlate(setup) !== qr.entryPlate));
  const qrMark: Mark = qrValue === "entry" ? (qrMisused ? "bad" : "ok") : qrValue === "none" ? "warn" : "bad";
  const tagMark: Mark = setup.tag === "own" ? (setup.fastagReader === "missed" ? "warn" : "ok")
    : light && setup.tag === "none" ? "ok" : "bad"; // a car has no FASTag; a missed read is a sensor fault
  const plateMark: Mark = setup.plate === "own" ? (setup.camera && setup.camera !== "ok" ? "warn" : "ok") : "bad";
  const marks: Mark[] = [
    vehicleMark,
    plateMark,
    tagMark,
    stickerMark,
    ...(qr ? [qrMark] : []),
    loadMark,
    physical.noWeight ? "bad" : "ok",
    physical.force ? "bad" : "ok",
  ];
  return { r, light, listed, vehicleMark, vehicleNote, kind, stickerMark, loadMark, qrValue, qrMark, tagMark, plateMark, marks };
}

/** Count of tampered / rule-breaking rows, for the panel header. */
export function markCounts(props: RowsProps) {
  const { marks } = analyse(props);
  return { bad: marks.filter((m) => m === "bad").length, warn: marks.filter((m) => m === "warn").length };
}

/** The rows for one barrier (entry or exit). */
export function VehicleRows(props: RowsProps) {
  const { setup, update, trucks, stickers, physical, setPhysical, weight, qr } = props;
  const { r, vehicleMark, vehicleNote, kind, stickerMark, loadMark, qrValue, qrMark, tagMark, plateMark } = analyse(props);
  const others = (exclude: string) => trucks.filter((t) => t.plate !== exclude);

  // ---- plate
  const plateValue = setup.plate === "custom" ? `copy:${setup.customPlate}`
    : setup.plate === "own" && setup.camera && setup.camera !== "ok" ? `cam:${setup.camera}` : setup.plate;
  const setPlate = (v: string) =>
    v.startsWith("cam:") ? update({ plate: "own", camera: v.slice(4) as Setup["camera"] }) :
    v.startsWith("copy:") ? update({ plate: "custom", customPlate: v.slice(5), camera: "ok" })
      : update({ plate: v as PlateShown, camera: "ok" });

  // ---- FASTag
  const tagValue = setup.tag === "from" ? `from:${setup.tagFrom}`
    : setup.tag === "own" && setup.fastagReader === "missed" ? "reader:missed" : setup.tag;
  const setTag = (v: string) =>
    v === "reader:missed" ? update({ tag: "own", fastagReader: "missed" }) :
    v.startsWith("from:") ? update({ tag: "from", tagFrom: v.slice(5), fastagReader: "ok" })
      : update({ tag: v as TagShown, fastagReader: "ok" });

  // ---- GB sticker
  const ownSticker = setup.vehicle === "registered" ? stickers[setup.registeredPlate]?.uid ?? "" : "";
  const claimed = claimedPlate(setup);
  const setSticker = (v: string) => {
    if (v === "own") return update({ rfidUid: ownSticker, rfidSimMode: "genuine" });
    if (v === "none") return update({ rfidUid: "", rfidSimMode: "genuine" });
    if (v === "cloned") return update({ rfidUid: stickers[claimed]?.uid ?? ownSticker, rfidSimMode: "cloned" });
    if (v === "revoked") return update({ rfidUid: ownSticker || stickers[claimed]?.uid || "", rfidSimMode: "revoked" });
    if (v === "damaged") return update({ rfidUid: ownSticker || "GB-RFID-99999", rfidSimMode: "unknown_damaged" });
    return update({ rfidUid: stickers[v.slice(6)]?.uid ?? "", rfidSimMode: "genuine" });
  };
  const stickerNote =
    kind === "none"
      ? setup.vehicle === "outside"
        ? "no GB sticker (none issued)"
        : "no sticker read"
      : `reads ${setup.rfidUid}${setup.rfidSimMode !== "genuine" ? ` (${setup.rfidSimMode.replace("_", " ")})` : ""}`;

  // ---- load
  const loadValue = LOADS.some((l) => l.value === physical.load) ? physical.load : "custom";

  return (
    <div className="gc-vrows">
      <Row label="Vehicle" mark={vehicleMark} reading={vehicleNote}>
        <select
          value={setup.vehicle === "registered" ? setup.registeredPlate : "__outside"}
          onChange={(e) =>
            e.target.value === "__outside"
              ? update({ vehicle: "outside" })
              : update({ vehicle: "registered", registeredPlate: e.target.value })
          }
        >
          {setup.vehicle === "registered" && !setup.registeredPlate && <option value="">Choose a truck…</option>}
          {trucks.map((t) => (
            <option key={t.id} value={t.plate}>
              {formatPlate(t.plate, t.plate_type)} · {t.make} {t.model}
            </option>
          ))}
          <option value="__outside">Outside vehicle (not registered)</option>
        </select>
        {setup.vehicle === "outside" && (
          <div className="gc-vsub">
            <input
              value={setup.outsidePlate}
              onChange={(e) => update({ outsidePlate: e.target.value })}
              placeholder="Its own plate"
            />
            <input
              type="number"
              step="0.1"
              value={setup.outsideLength}
              onChange={(e) => update({ outsideLength: Number(e.target.value) })}
              title="True length (m)"
            />
            <span className="muted small">m</span>
            <input
              type="number"
              step="0.1"
              value={setup.outsideEmpty ?? 12}
              onChange={(e) => update({ outsideEmpty: Number(e.target.value) })}
              title="Empty weight (t)"
            />
            <span className="muted small">t empty</span>
          </div>
        )}
      </Row>

      <Row
        label="Plate"
        mark={plateMark}
        reading={r.plateRead ? `reads ${formatPlate(r.plateRead)}` : "no plate read"}
      >
        <select value={plateValue} onChange={(e) => setPlate(e.target.value)}>
          <option value="own">Its own plate</option>
          <option value="cam:unreadable">Its own plate, camera can't read it (mud, night)</option>
          <option value="cam:misread">Its own plate, camera misreads one character</option>
          <option value="none">No plate (removed or covered)</option>
          {setup.plate === "custom" && !trucks.some((t) => t.plate === setup.customPlate) && (
            <option value={plateValue}>Fake plate {setup.customPlate}</option>
          )}
          {others(setup.registeredPlate).map((t) => (
            <option key={t.id} value={`copy:${t.plate}`}>
              Copied from {formatPlate(t.plate, t.plate_type)}
            </option>
          ))}
        </select>
      </Row>

      <Row label="FASTag" mark={tagMark} reading={`reads ${shortTag(r.tagRead)}`}>
        <select value={tagValue} onChange={(e) => setTag(e.target.value)}>
          <option value="own">{setup.vehicle === "registered" ? "Its own tag" : "Its own tag (not in GB registry)"}</option>
          <option value="reader:missed">Its own tag, reader misses it</option>
          <option value="none">No tag (removed or blocked)</option>
          {others(setup.registeredPlate).map((t) => (
            <option key={t.id} value={`from:${t.plate}`}>
              Taken from {formatPlate(t.plate, t.plate_type)}
            </option>
          ))}
        </select>
      </Row>

      <Row label="GB sticker" mark={stickerMark} reading={stickerNote}>
        <select value={kind} onChange={(e) => setSticker(e.target.value)}>
          {setup.vehicle === "registered" && <option value="own">Its own sticker</option>}
          <option value="none">{setup.vehicle === "registered" ? "Removed or shielded" : "None"}</option>
          {claimed && <option value="cloned">Cloned chip (copy of {formatPlate(claimed)}'s sticker)</option>}
          {setup.vehicle === "registered" && <option value="revoked">Revoked sticker</option>}
          <option value="damaged">{setup.vehicle === "registered" ? "Damaged or unreadable" : "Fake or unknown sticker"}</option>
          {Object.keys(stickers)
            .filter((plate) => plate !== setup.registeredPlate)
            .map((plate) => (
              <option key={plate} value={`other:${plate}`}>
                Sticker of {formatPlate(plate)}
              </option>
            ))}
        </select>
      </Row>

      {qr && (
        <Row
          label="QR shown"
          mark={qrMark}
          reading={
            !qr.value
              ? "no QR or code: plate + FASTag + sticker fallback"
              : qrValue === "entry" && qr.entryPassUsed
              ? "this pass was already used at an exit"
              : qrValue === "entry" && qrMark === "bad"
              ? `pass issued to ${formatPlate(qr.entryPlate)}, not this vehicle`
              : `${qr.value.slice(0, 18)}…`
          }
        >
          <select
            value={qrValue}
            onChange={(e) =>
              qr.set(e.target.value === "entry" ? qr.entryToken : e.target.value === "edited" ? qr.editedToken : "")
            }
          >
            <option value="entry" disabled={!qr.entryToken}>
              The QR given at entry{qr.entryToken ? "" : " (none issued)"}
            </option>
            <option value="none">No QR shown</option>
            <option value="edited" disabled={!qr.entryToken}>
              Edited / forged QR
            </option>
            {qrValue === "other" && <option value="other">Another QR</option>}
          </select>
        </Row>
      )}

      <Row
        label="Load"
        mark={loadMark}
        reading={physical.noWeight ? "not weighed" : weight != null ? `${weight.toFixed(2)} t on the pad` : "…"}
      >
        <select
          value={loadValue}
          onChange={(e) => setPhysical({ load: e.target.value === "custom" ? physical.load : e.target.value })}
        >
          {LOADS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {loadValue === "custom" && (
          <div className="gc-vsub">
            <input
              value={physical.load}
              onChange={(e) => setPhysical({ load: e.target.value })}
              placeholder="t, or % of rated"
            />
          </div>
        )}
      </Row>

      <Row label="Weigh pad" mark={physical.noWeight ? "bad" : "ok"}>
        <select value={physical.noWeight ? "skip" : "read"} onChange={(e) => setPhysical({ noWeight: e.target.value === "skip" })}>
          <option value="read">Reads the truck</option>
          <option value="skip">Skipped (no reading)</option>
        </select>
      </Row>

      <Row label="Barrier" mark={physical.force ? "bad" : "ok"}>
        <select value={physical.force ? "force" : "stop"} onChange={(e) => setPhysical({ force: e.target.value === "force" })}>
          <option value="stop">Stops if refused</option>
          <option value="force">Breaks through if refused</option>
        </select>
      </Row>
    </div>
  );
}

/** How many rows are tampered / break a rule, for the panel header. Mirrors the marks in VehicleRows. */
export function TamperCount({ marks }: { marks: { bad: number; warn: number } }) {
  if (!marks.bad && !marks.warn) return <span className="badge ok small">All genuine</span>;
  return (
    <span className="gc-tamper-count">
      {marks.bad > 0 && <span className="badge bad small">{marks.bad} tampered</span>}
      {marks.warn > 0 && <span className="badge warn small">{marks.warn} breaks a rule</span>}
    </span>
  );
}
