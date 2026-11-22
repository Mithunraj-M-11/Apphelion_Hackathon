import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LuPlus } from "react-icons/lu";
import { api, type Transporter, type TruckListItem } from "../api";
import { AuthBadge, ErrorNote, StatusBadge } from "../components";
import { formatPlate, STATUS_LABEL } from "../format";

export default function RegistryList() {
  const [trucks, setTrucks] = useState<TruckListItem[]>([]);
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [transporterId, setTransporterId] = useState(searchParams.get("transporter") ?? "");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.transporters().then(setTransporters).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .trucks({ q, status, transporter_id: transporterId })
        .then((d) => {
          setTrucks(d);
          setError(null);
        })
        .catch((e) => setError(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, status, transporterId]);

  const authorised = trucks.filter((t) => t.authorisation.authorised).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Truck registry</h1>
          <p className="muted">
            Ground truth: every truck here was physically inspected by the GB and checked against VAHAN.
          </p>
        </div>
        <Link className="btn primary" to="/registry/new">
          <LuPlus /> Enroll truck
        </Link>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-num">{trucks.length}</div><div className="stat-label">Trucks shown</div></div>
        <div className="stat"><div className="stat-num ok-text">{authorised}</div><div className="stat-label">Authorised today</div></div>
        <div className="stat"><div className="stat-num bad-text">{trucks.length - authorised}</div><div className="stat-label">Not authorised</div></div>
        <div className="stat"><div className="stat-num">{transporters.length}</div><div className="stat-label">Transporters</div></div>
      </div>

      <div className="filters">
        <input placeholder="Search plate, make, model, FASTag…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={transporterId} onChange={(e) => setTransporterId(e.target.value)}>
          <option value="">All transporters</option>
          {transporters.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr>
            <th>Plate</th>
            <th>Vehicle</th>
            <th>Transporter</th>
            <th>Status</th>
            <th>Today</th>
          </tr>
        </thead>
        <tbody>
          {trucks.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => navigate(`/registry/${t.id}`)}>
              <td><span className="plate">{formatPlate(t.plate, t.plate_type)}</span></td>
              <td>{[t.make, t.model].filter(Boolean).join(" ")} <span className="muted">· {t.body_type}</span></td>
              <td>{t.transporter.name}</td>
              <td><StatusBadge status={t.status} /></td>
              <td><AuthBadge auth={t.authorisation} /></td>
            </tr>
          ))}
          {trucks.length === 0 && (
            <tr><td colSpan={5} className="muted center">No trucks match.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
