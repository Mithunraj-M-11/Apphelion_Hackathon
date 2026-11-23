import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LuArrowLeft, LuPencil } from "react-icons/lu";
import { api, type HistoryEntry, type Truck } from "../api";
import { AuthBadge, Card, ErrorNote, Expiry, Field, StatusBadge } from "../components";
import { formatDate, formatDateTime, formatPlate, STATUS_LABEL } from "../format";
import { useOfficer } from "../officer";

const ACTION_LABEL: Record<string, string> = {
  create: "Enrolled",
  update: "Edited",
  status: "Status changed",
  photo: "Photo added",
};

function summarise(h: HistoryEntry): string {
  if (h.action === "create" || !h.after) return "";
  return Object.entries(h.after)
    .map(([k, v]) => {
      const before = h.before?.[k];
      return before !== undefined ? `${k}: ${String(before)} to ${String(v)}` : `${k}: ${String(v)}`;
    })
    .join(" · ");
}

function StatusPanel({ truck, onChanged }: { truck: Truck; onChanged: (t: Truck) => void }) {
  const { acting } = useOfficer();
  const [status, setStatus] = useState(truck.status);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      onChanged(await api.changeStatus(truck.id, status, reason));
      setReason("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="status-panel">
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        {Object.entries(STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn" disabled={busy || reason.trim().length < 3 || status === truck.status} onClick={submit}>
        Change status
      </button>
      <span className="muted small">as {acting?.name ?? "—"}</span>
      <ErrorNote error={error} />
    </div>
  );
}

function PhotoUpload({ truckId, onUploaded }: { truckId: number; onUploaded: (t: Truck) => void }) {
  const [kind, setKind] = useState("side");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="photo-upload">
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="plate_front">Plate (front)</option>
        <option value="plate_rear">Plate (rear)</option>
        <option value="side">Side</option>
        <option value="full">Full view</option>
      </select>
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            onUploaded(await api.uploadPhoto(truckId, kind, file));
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
          e.target.value = "";
        }}
      />
      <ErrorNote error={error} />
    </div>
  );
}

export default function TruckDetail() {
  const id = Number(useParams().id);
  const [truck, setTruck] = useState<Truck | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.truck(id).then(setTruck).catch((e) => setError(e.message));
    api.history(id).then(setHistory).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  const changed = (t: Truck) => {
    setTruck(t);
    api.history(id).then(setHistory);
  };

  if (error) return <ErrorNote error={error} />;
  if (!truck) return <p className="muted">Loading…</p>;
  const t = truck;

  return (
    <>
      <p><Link className="back-link" to="/registry"><LuArrowLeft /> Truck registry</Link></p>

      <div className="hero">
        <div>
          <div className="plate plate-lg">{formatPlate(t.plate, t.plate_type)}</div>
          <div className="hero-sub">
            {[t.make, t.model].filter(Boolean).join(" ")} · {t.body_type} · {t.colour}
            {t.plate_type === "bh" && <span className="badge neutral">BH series</span>}
          </div>
        </div>
        <div className="hero-right">
          <StatusBadge status={t.status} />
          <AuthBadge auth={t.authorisation} />
          <Link className="btn" to={`/registry/${t.id}/edit`}><LuPencil /> Edit</Link>
        </div>
      </div>

      {!t.authorisation.authorised && (
        <div className="alert-box">
          <strong>Not authorised to work today:</strong>
          <ul>{t.authorisation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {t.status_reason && <p className="muted">Status note: {t.status_reason}</p>}

      <div className="grid">
        <Card title="Identity">
          <Field label="Plate (normalised)" mono>{t.plate}</Field>
          <Field label="Plate type">{t.plate_type === "bh" ? "Bharat series" : "Standard"}</Field>
          <Field label="FASTag tag ID" mono>{t.fastag_tag_id}</Field>
          <Field label="FASTag chip ID (factory)" mono>{t.fastag_chip_id}</Field>
          <Field label="Chassis no." mono>{t.chassis_no}</Field>
          <Field label="Engine no." mono>{t.engine_no}</Field>
        </Card>

        <Card title="Physical (measured at inspection)">
          <Field label="Length">{t.length_m} m</Field>
          <Field label="Axles">{t.axle_count}</Field>
          <Field label="Axle spacings">
            {t.axle_spacings_m?.length ? `${t.axle_spacings_m.map((x) => x.toFixed(2)).join(" / ")} m` : "—"}
          </Field>
          <Field label="Empty weight">{t.empty_weight_t} t</Field>
          <Field label="Rated capacity">{t.rated_capacity_t} t</Field>
          <Field label="Gross vehicle weight">{t.gvw_t ? `${t.gvw_t} t` : "—"}</Field>
          <Field label="Body / colour">{t.body_type} · {t.colour}</Field>
        </Card>

        <Card title="Documents (VAHAN)">
          <Field label="VAHAN check">
            {t.vahan_verified ? (
              <span className="ok-text">Verified {formatDate(t.vahan_checked_at)}</span>
            ) : (
              <span className="bad-text">Not verified</span>
            )}
          </Field>
          <Field label="Registration (RC)"><Expiry date={t.rc_valid_until} /></Field>
          <Field label="Fitness"><Expiry date={t.fitness_valid_until} /></Field>
          <Field label="Insurance"><Expiry date={t.insurance_valid_until} /></Field>
          <Field label="Permit"><Expiry date={t.permit_valid_until} /></Field>
        </Card>

        <Card title="Ownership & site">
          <Field label="Transporter">{t.transporter.name}</Field>
          <Field label="Contract">{t.contract?.code}</Field>
          <Field label="Vendor">{t.contract?.vendor_name}</Field>
          <Field label="Site">{t.contract?.site_name}</Field>
          <Field label="Enrollment valid">{formatDate(t.valid_from)} – {formatDate(t.valid_to)}</Field>
        </Card>

        <Card title="Enrollment (maker–checker)">
          <Field label="Inspected by">{t.inspector?.name}</Field>
          <Field label="Inspected at">{formatDateTime(t.inspected_at)}</Field>
          <Field label="Location">{t.inspection_location}</Field>
          <Field label="Approved by">{t.approver?.name ?? <span className="warn-text">Not yet approved</span>}</Field>
          <Field label="Approved at">{formatDateTime(t.approved_at)}</Field>
        </Card>

        <Card title="Status">
          <StatusPanel key={`${t.id}-${t.status}`} truck={t} onChanged={changed} />
        </Card>
      </div>

      <Card title={`Photos (${t.photos.length})`} actions={<PhotoUpload truckId={t.id} onUploaded={changed} />}>
        {t.photos.length === 0 ? (
          <p className="muted">No photos (optional for the simulation).</p>
        ) : (
          <div className="photos">
            {t.photos.map((p) => (
              <figure key={p.id}>
                <img src={p.url} alt={p.kind} />
                <figcaption>{p.kind.replace("_", " ")} · {formatDate(p.uploaded_at)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </Card>

      <Card title="Change history (append-only)">
        <table className="table compact">
          <thead>
            <tr><th>When</th><th>What</th><th>By</th><th>Reason</th><th>Changes</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="nowrap">{formatDateTime(h.changed_at)}</td>
                <td>{ACTION_LABEL[h.action] ?? h.action}</td>
                <td className="nowrap">{h.officer.name}</td>
                <td>{h.reason ?? "—"}</td>
                <td className="small mono">{summarise(h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
