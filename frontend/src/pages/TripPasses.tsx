import { useEffect, useState } from "react";
import {
  LuEye,
} from "react-icons/lu";
import { QRCodeSVG } from "qrcode.react";
import { api, type TripSession } from "../api";
import { ErrorNote } from "../components";
import { formatDateTime, formatPlate } from "../format";

export default function TripPasses() {
  const [trips, setTrips] = useState<TripSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedTrip, setSelectedTrip] = useState<TripSession | null>(null);

  // Override / resolve modal state
  const [resolveAction, setResolveAction] = useState<"RESOLVE" | "FLAG" | "CANCEL">("RESOLVE");
  const [resolveReason, setResolveReason] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const loadTrips = () => {
    setLoading(true);
    api
      .trips({ status: statusFilter || undefined })
      .then(setTrips)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTrips();
  }, [statusFilter]);

  const filteredTrips = trips.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.trip_code.toLowerCase().includes(q) ||
      (t.truck?.plate && t.truck.plate.toLowerCase().includes(q)) ||
      (t.sticker?.uid && t.sticker.uid.toLowerCase().includes(q))
    );
  });

  const handleResolve = async () => {
    if (!selectedTrip || !resolveReason.trim()) return;
    setResolving(true);
    setResolveError(null);
    try {
      await api.resolveTrip(selectedTrip.session_id, resolveAction, resolveReason);
      setResolveReason("");
      setSelectedTrip(null);
      loadTrips();
    } catch (e) {
      setResolveError((e as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const statusBadgeCls = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "badge ok";
      case "COMPLETED":
        return "badge neutral";
      case "EXPIRED_UNRESOLVED":
        return "badge bad";
      case "FLAGGED":
        return "badge warn";
      default:
        return "badge neutral";
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trip Pass Dashboard</h1>
          <p className="muted">
            Internal administrative registry of all vehicle trip sessions, active authorization tokens, and unresolved
            discrepancies.
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{trips.filter((t) => t.status === "ACTIVE").length}</div>
          <div className="stat-label">Active trips on site</div>
        </div>
        <div className="stat">
          <div className="stat-num">{trips.filter((t) => t.status === "COMPLETED").length}</div>
          <div className="stat-label">Completed trips</div>
        </div>
        <div className="stat">
          <div className="stat-num bad-text">
            {trips.filter((t) => t.status === "EXPIRED_UNRESOLVED").length}
          </div>
          <div className="stat-label">Expired / unresolved</div>
        </div>
        <div className="stat">
          <div className="stat-num warn-text">
            {trips.filter((t) => t.status === "FLAGGED").length}
          </div>
          <div className="stat-label">Flagged for review</div>
        </div>
      </div>

      <div className="filters">
        <input
          placeholder="Search by trip code, truck plate, or RFID UID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="EXPIRED_UNRESOLVED">Expired unresolved</option>
          <option value="FLAGGED">Flagged</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button className="btn" onClick={loadTrips}>
          Refresh
        </button>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr>
            <th>Trip Code</th>
            <th>Vehicle Plate</th>
            <th>RFID Sticker</th>
            <th>Status</th>
            <th>Entry Gate</th>
            <th>Entry Time</th>
            <th>Expiry Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="center muted" style={{ padding: 24 }}>
                Loading trip sessions…
              </td>
            </tr>
          ) : filteredTrips.length === 0 ? (
            <tr>
              <td colSpan={8} className="center muted" style={{ padding: 24 }}>
                No trip passes matching the current filter.
              </td>
            </tr>
          ) : (
            filteredTrips.map((t) => (
              <tr key={t.id}>
                <td>
                  <strong>{t.trip_code}</strong>
                  <div className="mono small muted">{t.session_id}</div>
                </td>
                <td>
                  {t.truck?.plate ? (
                    <span className="plate plate-sm">{formatPlate(t.truck.plate, t.truck.plate_type)}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <span className="mono">{t.sticker?.uid ?? "—"}</span>
                </td>
                <td>
                  <span className={statusBadgeCls(t.status)}>{t.status.replace("_", " ")}</span>
                </td>
                <td>{t.entry_gate}</td>
                <td>{formatDateTime(t.entry_at)}</td>
                <td>{formatDateTime(t.expires_at)}</td>
                <td>
                  <button
                    className="btn small"
                    onClick={() => setSelectedTrip(t)}
                    style={{ padding: "3px 8px", fontSize: "0.8rem" }}
                  >
                    <LuEye /> Inspect Pass
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Inspect / Resolve Modal */}
      {selectedTrip && (
        <div className="modal-backdrop" onClick={() => setSelectedTrip(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>Trip Authorization Pass · {selectedTrip.trip_code}</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 16, marginBottom: 16 }}>
              <div style={{ display: "grid", gap: 6, fontSize: "0.85rem" }}>
                <div>
                  <span className="muted">Session ID:</span> <span className="mono">{selectedTrip.session_id}</span>
                </div>
                <div>
                  <span className="muted">Vehicle:</span>{" "}
                  <strong>{selectedTrip.truck ? formatPlate(selectedTrip.truck.plate) : "—"}</strong>
                </div>
                <div>
                  <span className="muted">RFID Sticker:</span>{" "}
                  <span className="mono">{selectedTrip.sticker?.uid ?? "—"}</span>
                </div>
                <div>
                  <span className="muted">Current Status:</span>{" "}
                  <span className={statusBadgeCls(selectedTrip.status)}>
                    {selectedTrip.status.replace("_", " ")}
                  </span>
                </div>
                <div>
                  <span className="muted">Entry Gate:</span> {selectedTrip.entry_gate} (
                  {formatDateTime(selectedTrip.entry_at)})
                </div>
                <div>
                  <span className="muted">Expires At:</span> {formatDateTime(selectedTrip.expires_at)}
                </div>
                {selectedTrip.completed_at && (
                  <div>
                    <span className="muted">Completed At:</span> {formatDateTime(selectedTrip.completed_at)}
                  </div>
                )}
                {selectedTrip.notes && (
                  <div>
                    <span className="muted">Notes:</span> <em>{selectedTrip.notes}</em>
                  </div>
                )}
              </div>

              {/* QR Code */}
              <div style={{ textAlign: "center", background: "#fff", padding: 8, borderRadius: 6, border: "1px solid var(--border)" }}>
                <QRCodeSVG value={selectedTrip.signed_token} size={110} level="M" />
                <div style={{ fontSize: "0.7rem", color: "#374151", marginTop: 4 }}>Internal GB Token</div>
              </div>
            </div>

            {/* Token display */}
            <div style={{ marginBottom: 16 }}>
              <div className="muted small">Signed Token (HMAC-SHA256):</div>
              <div className="gc-token-box mono">{selectedTrip.signed_token}</div>
            </div>

            {/* Resolution workflow if expired or flagged */}
            {(selectedTrip.status === "EXPIRED_UNRESOLVED" ||
              selectedTrip.status === "FLAGGED" ||
              selectedTrip.status === "ACTIVE") && (
              <div style={{ background: "var(--neutral-bg)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>Officer Administrative Action</h4>
                <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <label className="small">
                    Action:
                    <select
                      value={resolveAction}
                      onChange={(e) => setResolveAction(e.target.value as "RESOLVE" | "FLAG" | "CANCEL")}
                      style={{ marginLeft: 6 }}
                    >
                      <option value="RESOLVE">Resolve (Mark Completed)</option>
                      <option value="FLAG">Flag for Investigation</option>
                      <option value="CANCEL">Cancel Pass</option>
                    </select>
                  </label>
                </div>
                <label className="gc-field" style={{ marginBottom: 8 }}>
                  Mandatory justification reason
                  <input
                    value={resolveReason}
                    onChange={(e) => setResolveReason(e.target.value)}
                    placeholder="e.g. Weighbridge exit confirmed manually on docket #1042"
                  />
                </label>
                <ErrorNote error={resolveError} />
                <button
                  className="btn primary small"
                  disabled={resolving || !resolveReason.trim()}
                  onClick={handleResolve}
                >
                  Confirm Action
                </button>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setSelectedTrip(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
