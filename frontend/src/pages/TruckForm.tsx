import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LuArrowLeft } from "react-icons/lu";
import { api, type Contract, type Officer, type Transporter, type Truck } from "../api";
import { Card, ErrorNote } from "../components";
import { useOfficer } from "../officer";

type FormState = Record<string, string | boolean>;

const TEXT_FIELDS = [
  "plate", "fastag_tag_id", "fastag_chip_id", "make", "model", "body_type", "colour", "chassis_no", "engine_no",
  "inspection_location",
];
const NUMBER_FIELDS = ["length_m", "axle_count", "empty_weight_t", "rated_capacity_t", "gvw_t", "transporter_id",
  "contract_id", "approved_by"];
const DATE_FIELDS = ["rc_valid_until", "fitness_valid_until", "insurance_valid_until", "permit_valid_until",
  "valid_from", "valid_to"];

const EMPTY: FormState = {
  plate: "", fastag_tag_id: "", fastag_chip_id: "", make: "", model: "", body_type: "Tipper", colour: "",
  chassis_no: "", engine_no: "", length_m: "", axle_count: "3", axle_spacings_m: "", empty_weight_t: "",
  rated_capacity_t: "",
  gvw_t: "", rc_valid_until: "", fitness_valid_until: "", insurance_valid_until: "", permit_valid_until: "",
  vahan_verified: false, valid_from: "", valid_to: "", transporter_id: "", contract_id: "", approved_by: "",
  inspection_location: "GB enrollment bay, site gate 1",
};

function fromTruck(t: Truck): FormState {
  const s: FormState = { ...EMPTY };
  for (const k of [...TEXT_FIELDS, ...NUMBER_FIELDS, ...DATE_FIELDS]) {
    const v = (t as unknown as Record<string, unknown>)[k];
    if (v != null) s[k] = String(v);
  }
  s.transporter_id = String(t.transporter.id);
  s.contract_id = t.contract ? String(t.contract.id) : "";
  s.approved_by = t.approver ? String(t.approver.id) : "";
  s.vahan_verified = t.vahan_verified;
  s.axle_spacings_m = (t.axle_spacings_m ?? []).join(", ");
  return s;
}

function toPayload(s: FormState, editing: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { vahan_verified: s.vahan_verified };
  for (const k of TEXT_FIELDS) {
    if (editing && k === "plate") continue; // plate is the identity; not editable
    const v = String(s[k]).trim();
    out[k] = v === "" ? null : v;
  }
  for (const k of NUMBER_FIELDS) out[k] = s[k] === "" ? null : Number(s[k]);
  for (const k of DATE_FIELDS) out[k] = s[k] === "" ? null : s[k];
  const spacings = String(s.axle_spacings_m ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  out.axle_spacings_m = spacings.length && spacings.every((x) => x > 0) ? spacings : null;
  if (!editing) for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="form-row">{children}</div>;
}

export default function TruckForm() {
  const params = useParams();
  const editId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const { acting, officers } = useOfficer();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.transporters().then(setTransporters);
    api.contracts().then((c) => {
      setContracts(c);
      if (!editId && c[0]) setForm((f) => ({ ...f, contract_id: f.contract_id || String(c[0].id) }));
    });
    if (editId) api.truck(editId).then((t) => setForm(fromTruck(t)));
  }, [editId]);

  const approvers: Officer[] = officers.filter((o) => o.role === "approver");
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = (k: string, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input type={type} value={String(form[k])} onChange={set(k)} {...extra} />
    </label>
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload = toPayload(form, editId != null);
      const saved = editId
        ? await api.updateTruck(editId, { ...payload, reason: reason || null })
        : await api.createTruck(payload);
      navigate(`/registry/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit}>
      <p><Link to={editId ? `/registry/${editId}` : "/registry"} className="back-link"><LuArrowLeft /> Back</Link></p>
      <div className="page-head">
        <div>
          <h1>{editId ? `Edit ${form.plate}` : "Enroll a truck"}</h1>
          <p className="muted">
            Recorded by <strong>{acting?.name ?? "—"}</strong> from the physical inspection. Values must match what
            was measured and verified.
          </p>
        </div>
      </div>

      <div className="grid">
        <Card title="Identity">
          <Row>
            {input("plate", "Plate number", "text", { required: true, disabled: editId != null, placeholder: "OD 09 AB 1234" })}
          </Row>
          <Row>
            {input("fastag_tag_id", "FASTag tag ID (RFID sensor)")}
            {input("fastag_chip_id", "FASTag chip ID (RFID sensor)")}
          </Row>
          <Row>
            {input("chassis_no", "Chassis no.")}
            {input("engine_no", "Engine no.")}
          </Row>
        </Card>

        <Card title="Physical (measured)">
          <Row>
            {input("length_m", "Length (m)", "number", { step: "0.01", required: true })}
            {input("axle_count", "Axles", "number")}
            {input("axle_spacings_m", "Axle spacings (m, front to back, e.g. 3.90, 1.37)")}
          </Row>
          <Row>
            {input("empty_weight_t", "Empty weight (t)", "number", { step: "0.01", required: true })}
            {input("rated_capacity_t", "Rated capacity (t)", "number", { step: "0.1", required: true })}
            {input("gvw_t", "GVW (t)", "number", { step: "0.1" })}
          </Row>
          <Row>
            {input("make", "Make")}
            {input("model", "Model")}
          </Row>
          <Row>
            {input("body_type", "Body type")}
            {input("colour", "Colour")}
          </Row>
        </Card>

        <Card title="Documents (VAHAN)">
          <Row>
            {input("rc_valid_until", "RC valid until", "date")}
            {input("fitness_valid_until", "Fitness valid until", "date")}
          </Row>
          <Row>
            {input("insurance_valid_until", "Insurance valid until", "date")}
            {input("permit_valid_until", "Permit valid until", "date")}
          </Row>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(form.vahan_verified)}
              onChange={(e) => setForm((f) => ({ ...f, vahan_verified: e.target.checked }))}
            />
            Verified with VAHAN (simulated)
          </label>
        </Card>

        <Card title="Ownership & enrollment">
          <Row>
            <label>
              Transporter
              <select value={String(form.transporter_id)} onChange={set("transporter_id")} required>
                <option value="">Choose…</option>
                {transporters.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              Contract / site
              <select value={String(form.contract_id)} onChange={set("contract_id")}>
                <option value="">—</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
              </select>
            </label>
          </Row>
          <Row>
            {input("valid_from", "Valid from", "date")}
            {input("valid_to", "Valid to", "date")}
          </Row>
          <Row>
            {input("inspection_location", "Inspection location")}
            <label>
              Approved by (second officer)
              <select value={String(form.approved_by)} onChange={set("approved_by")}>
                <option value="">Not yet approved</option>
                {approvers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </Row>
        </Card>
      </div>

      {editId != null && (
        <Card title="Reason for the change">
          <input className="wide" placeholder="e.g. Re-measured after body repair" value={reason}
                 onChange={(e) => setReason(e.target.value)} />
        </Card>
      )}

      <ErrorNote error={error} />
      <div className="form-actions">
        <button className="btn primary" type="submit">{editId ? "Save changes" : "Enroll truck"}</button>
      </div>
    </form>
  );
}
