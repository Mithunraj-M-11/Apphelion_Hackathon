import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Transporter } from "../api";
import { Card, ErrorNote, Field } from "../components";

function AddDriver({ transporter, onAdded }: { transporter: Transporter; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-form">
      <input placeholder="Driver name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button
        className="btn"
        disabled={name.length < 2 || phone.length < 6}
        onClick={async () => {
          try {
            await api.addDriver(transporter.id, { name, phone });
            setName("");
            setPhone("");
            setError(null);
            onAdded();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Add driver
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

function NewTransporter({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ name: "", gstin: "", contact_person: "", contact_phone: "", address: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title="Add transporter">
      <div className="form-row">
        <label>Company name<input value={form.name} onChange={set("name")} /></label>
        <label>GSTIN<input value={form.gstin} onChange={set("gstin")} maxLength={15} /></label>
      </div>
      <div className="form-row">
        <label>Contact person<input value={form.contact_person} onChange={set("contact_person")} /></label>
        <label>Contact phone<input value={form.contact_phone} onChange={set("contact_phone")} /></label>
      </div>
      <label>Address<input value={form.address} onChange={set("address")} /></label>
      <ErrorNote error={error} />
      <div className="form-actions">
        <button
          className="btn primary"
          disabled={form.name.length < 2}
          onClick={async () => {
            try {
              await api.createTransporter({
                ...form,
                gstin: form.gstin || null,
                phone_numbers: form.contact_phone ? [form.contact_phone] : [],
              });
              setForm({ name: "", gstin: "", contact_person: "", contact_phone: "", address: "" });
              setError(null);
              onAdded();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Add transporter
        </button>
      </div>
    </Card>
  );
}

export default function Transporters() {
  const [list, setList] = useState<Transporter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.transporters().then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transporters</h1>
          <p className="muted">The parties: every trip is traceable to a company. Drivers receive trip passes.</p>
        </div>
      </div>
      <ErrorNote error={error} />
      <div className="grid">
        {list.map((t) => (
          <Card key={t.id} title={t.name}
                actions={<Link to={`/registry?transporter=${t.id}`} className="small">{t.truck_count} trucks</Link>}>
            <Field label="GSTIN" mono>{t.gstin}</Field>
            <Field label="Contact">{t.contact_person} · {t.contact_phone}</Field>
            <Field label="Pass numbers">{t.phone_numbers.join(", ") || "—"}</Field>
            <Field label="Address">{t.address}</Field>
            <div className="field-label" style={{ marginTop: 12 }}>Drivers</div>
            <ul className="plain">
              {t.drivers.map((d) => (
                <li key={d.id}>
                  {d.name} · {d.phone}
                  {d.licence_no && <span className="muted small"> · DL {d.licence_no}</span>}
                </li>
              ))}
            </ul>
            <AddDriver transporter={t} onAdded={load} />
          </Card>
        ))}
      </div>
      <NewTransporter onAdded={load} />
    </>
  );
}
