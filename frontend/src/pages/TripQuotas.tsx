import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuHistory,
  LuPencil,
} from "react-icons/lu";
import { api, type QuotaAdjustment, type VehicleQuota } from "../api";
import { ErrorNote } from "../components";
import { formatDateTime, formatPlate } from "../format";

export default function TripQuotas() {
  const [quotas, setQuotas] = useState<VehicleQuota[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // Adjustment modal
  const [adjustTarget, setAdjustTarget] = useState<VehicleQuota | null>(null);
  const [newMax, setNewMax] = useState<number>(100);
  const [reason, setReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Adjustment history modal
  const [historyTarget, setHistoryTarget] = useState<VehicleQuota | null>(null);
  const [adjustments, setAdjustments] = useState<QuotaAdjustment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadQuotas = () => {
    setLoading(true);
    api
      .quotas(statusFilter || undefined)
      .then(setQuotas)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadQuotas();
  }, [statusFilter]);

  const filteredQuotas = quotas.filter((q) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return q.truck?.plate && q.truck.plate.toLowerCase().includes(term);
  });

  const handleAdjust = async () => {
    if (!adjustTarget || !reason.trim()) return;
    setAdjusting(true);
    setAdjustError(null);
    try {
      await api.adjustQuota(adjustTarget.truck_id, {
        new_max: newMax,
        reason: reason.trim(),
      });
      setAdjustTarget(null);
      setReason("");
      loadQuotas();
    } catch (e) {
      setAdjustError((e as Error).message);
    } finally {
      setAdjusting(false);
    }
  };

  const openHistory = (q: VehicleQuota) => {
    setHistoryTarget(q);
    setLoadingHistory(true);
    api
      .quotaAdjustments(q.truck_id)
      .then(setAdjustments)
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  };

  const statusBadgeCls = (status: string) => {
    switch (status) {
      case "AVAILABLE":
        return "badge ok";
      case "LOW":
        return "badge warn";
      case "EXHAUSTED":
        return "badge bad";
      case "EXPIRED":
        return "badge bad";
      default:
        return "badge neutral";
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Per-Vehicle Trip Quota Management</h1>
          <p className="muted">
            Track authorized trip quotas per vehicle, enforce non-deduction on entry, and manage quota top-ups with full
            officer audit trails.
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-num ok-text">{quotas.filter((q) => q.status === "AVAILABLE").length}</div>
          <div className="stat-label">Available quota</div>
        </div>
        <div className="stat">
          <div className="stat-num warn-text">{quotas.filter((q) => q.status === "LOW").length}</div>
          <div className="stat-label">Low quota (≤ 5 trips)</div>
        </div>
        <div className="stat">
          <div className="stat-num bad-text">{quotas.filter((q) => q.status === "EXHAUSTED").length}</div>
          <div className="stat-label">Quota exhausted</div>
        </div>
        <div className="stat">
          <div className="stat-num">{quotas.reduce((acc, q) => acc + q.completed_trips, 0)}</div>
          <div className="stat-label">Total completed trips</div>
        </div>
      </div>

      <div className="filters">
        <input
          placeholder="Search by vehicle registration plate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="AVAILABLE">Available</option>
          <option value="LOW">Low</option>
          <option value="EXHAUSTED">Exhausted</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <button className="btn" onClick={loadQuotas}>
          Refresh
        </button>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr>
            <th>Vehicle Plate</th>
            <th>Quota Progress</th>
            <th>Completed</th>
            <th>Remaining</th>
            <th>Maximum Quota</th>
            <th>Status</th>
            <th>Validity Window</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="center muted" style={{ padding: 24 }}>
                Loading vehicle quotas…
              </td>
            </tr>
          ) : filteredQuotas.length === 0 ? (
            <tr>
              <td colSpan={8} className="center muted" style={{ padding: 24 }}>
                No vehicle quota records found.
              </td>
            </tr>
          ) : (
            filteredQuotas.map((q) => {
              const pct = q.max_trips > 0 ? Math.min(100, (q.completed_trips / q.max_trips) * 100) : 0;
              return (
                <tr key={q.id}>
                  <td>
                    {q.truck ? (
                      <Link to={`/registry/${q.truck.id}`} className="plate plate-sm">
                        {formatPlate(q.truck.plate, q.truck.plate_type)}
                      </Link>
                    ) : (
                      `Truck #${q.truck_id}`
                    )}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <div style={{ background: "var(--border)", height: 8, borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          background: q.remaining_trips <= 5 ? "var(--bad)" : "var(--primary)",
                          width: `${pct}%`,
                          height: "100%",
                        }}
                      />
                    </div>
                    <span className="small muted">
                      {q.completed_trips} of {q.max_trips} ({Math.round(pct)}%)
                    </span>
                  </td>
                  <td>
                    <strong>{q.completed_trips}</strong>
                  </td>
                  <td>
                    <strong className={q.remaining_trips <= 5 ? "bad-text" : "ok-text"}>
                      {q.remaining_trips}
                    </strong>
                  </td>
                  <td>{q.max_trips}</td>
                  <td>
                    <span className={statusBadgeCls(q.status)}>{q.status}</span>
                  </td>
                  <td className="small">
                    {q.valid_from} to {q.valid_to}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn small"
                        style={{ padding: "3px 8px", fontSize: "0.8rem" }}
                        onClick={() => {
                          setAdjustTarget(q);
                          setNewMax(q.max_trips + 50);
                          setReason("");
                          setAdjustError(null);
                        }}
                      >
                        <LuPencil /> Adjust
                      </button>
                      <button
                        className="btn small"
                        style={{ padding: "3px 8px", fontSize: "0.8rem" }}
                        onClick={() => openHistory(q)}
                      >
                        <LuHistory /> History
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Adjust Quota Modal */}
      {adjustTarget && (
        <div className="modal-backdrop" onClick={() => setAdjustTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Adjust Quota Limit · {adjustTarget.truck?.plate ? formatPlate(adjustTarget.truck.plate) : ""}</h3>
            <p className="muted small">
              Authorized quota adjustments alter the maximum allowable trips for this truck. Completed trips will
              remain unchanged.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12, fontSize: "0.85rem" }}>
              <div>Current Max: <strong>{adjustTarget.max_trips}</strong></div>
              <div>Completed: <strong>{adjustTarget.completed_trips}</strong></div>
              <div>Current Remaining: <strong>{adjustTarget.remaining_trips}</strong></div>
              <div>New Remaining: <strong>{Math.max(0, newMax - adjustTarget.completed_trips)}</strong></div>
            </div>
            <label className="gc-field">
              New Maximum Trips Limit
              <input
                type="number"
                min={adjustTarget.completed_trips}
                value={newMax}
                onChange={(e) => setNewMax(Number(e.target.value))}
              />
            </label>
            <label className="gc-field">
              Mandatory Adjustment Reason
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Contract amendment #C-2026-B approved 50 additional loads"
              />
            </label>
            <ErrorNote error={adjustError} />
            <div className="modal-actions">
              <button className="btn" onClick={() => setAdjustTarget(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={adjusting || !reason.trim()}
                onClick={handleAdjust}
              >
                Confirm Quota Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment History Modal */}
      {historyTarget && (
        <div className="modal-backdrop" onClick={() => setHistoryTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>Quota Adjustment Audit History</h3>
            <p className="muted small">
              Vehicle: <strong>{historyTarget.truck ? formatPlate(historyTarget.truck.plate) : ""}</strong>
            </p>

            {loadingHistory ? (
              <div className="muted center" style={{ padding: 20 }}>Loading audit records…</div>
            ) : adjustments.length === 0 ? (
              <div className="muted center" style={{ padding: 20 }}>No adjustments recorded for this vehicle.</div>
            ) : (
              <table className="table compact" style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Previous Max</th>
                    <th>New Max</th>
                    <th>Change</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>{a.previous_max}</td>
                      <td>{a.new_max}</td>
                      <td>
                        <strong className={a.delta >= 0 ? "ok-text" : "bad-text"}>
                          {a.delta >= 0 ? `+${a.delta}` : a.delta}
                        </strong>
                      </td>
                      <td>{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setHistoryTarget(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
