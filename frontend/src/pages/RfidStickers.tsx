import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuAlertOctagon,
  LuPlus,
  LuRefreshCw,
} from "react-icons/lu";
import { api, type RfidSticker, type TruckListItem } from "../api";
import { ErrorNote } from "../components";
import { formatDateTime, formatPlate } from "../format";

export default function RfidStickers() {
  const [stickers, setStickers] = useState<RfidSticker[]>([]);
  const [trucks, setTrucks] = useState<TruckListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // Modals
  const [issueModal, setIssueModal] = useState(false);
  const [issueTruckId, setIssueTruckId] = useState<number>(0);
  const [issueUid, setIssueUid] = useState("");
  const [issueDays, setIssueDays] = useState(365);
  const [issuing, setIssuing] = useState(false);

  const [replaceModal, setReplaceModal] = useState<RfidSticker | null>(null);
  const [replaceUid, setReplaceUid] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [replacing, setReplacing] = useState(false);

  const [revokeModal, setRevokeModal] = useState<RfidSticker | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.rfidStickers({ status: statusFilter || undefined }),
      api.trucks(),
    ])
      .then(([sList, tList]) => {
        setStickers(sList);
        setTrucks(tList);
        if (tList.length > 0 && !issueTruckId) {
          setIssueTruckId(tList[0].id);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const filteredStickers = stickers.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.uid.toLowerCase().includes(q) ||
      (s.truck?.plate && s.truck.plate.toLowerCase().includes(q))
    );
  });

  const handleIssue = async () => {
    if (!issueTruckId || !issueUid.trim()) return;
    setIssuing(true);
    setError(null);
    try {
      await api.issueSticker({
        truck_id: issueTruckId,
        uid: issueUid.trim(),
        validity_days: issueDays,
      });
      setIssueModal(false);
      setIssueUid("");
      loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIssuing(false);
    }
  };

  const handleReplace = async () => {
    if (!replaceModal || !replaceUid.trim() || !replaceReason.trim()) return;
    setReplacing(true);
    setError(null);
    try {
      await api.replaceSticker(replaceModal.id, {
        new_uid: replaceUid.trim(),
        reason: replaceReason.trim(),
      });
      setReplaceModal(null);
      setReplaceUid("");
      setReplaceReason("");
      loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplacing(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeModal || !revokeReason.trim()) return;
    setRevoking(true);
    setError(null);
    try {
      await api.revokeSticker(revokeModal.id, {
        reason: revokeReason.trim(),
      });
      setRevokeModal(null);
      setRevokeReason("");
      loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevoking(false);
    }
  };

  const statusBadgeCls = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "badge ok";
      case "REPLACED":
        return "badge neutral";
      case "REVOKED":
        return "badge bad";
      case "DAMAGED":
        return "badge warn";
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
          <h1>GB RFID Sticker Management</h1>
          <p className="muted">
            Registry of physical cryptographic RFID stickers issued to trucks by the Governing Body, separate from
            commercial FASTag tags.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setIssueUid(`GB-RFID-${Math.floor(10000 + Math.random() * 90000)}`);
            setIssueModal(true);
          }}
        >
          <LuPlus /> Issue New Sticker
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-num ok-text">{stickers.filter((s) => s.status === "ACTIVE").length}</div>
          <div className="stat-label">Active stickers</div>
        </div>
        <div className="stat">
          <div className="stat-num bad-text">{stickers.filter((s) => s.status === "REVOKED").length}</div>
          <div className="stat-label">Revoked stickers</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stickers.filter((s) => s.status === "REPLACED").length}</div>
          <div className="stat-label">Replaced / retired</div>
        </div>
        <div className="stat">
          <div className="stat-num warn-text">{stickers.filter((s) => s.status === "DAMAGED").length}</div>
          <div className="stat-label">Marked damaged</div>
        </div>
      </div>

      <div className="filters">
        <input
          placeholder="Search by sticker UID or vehicle plate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="REVOKED">Revoked</option>
          <option value="REPLACED">Replaced</option>
          <option value="DAMAGED">Damaged</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <button className="btn" onClick={loadData}>
          Refresh
        </button>
      </div>

      <ErrorNote error={error} />

      <table className="table">
        <thead>
          <tr>
            <th>Sticker UID</th>
            <th>Assigned Vehicle</th>
            <th>Status</th>
            <th>Issued Date</th>
            <th>Expiry Date</th>
            <th>Revocation / Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="center muted" style={{ padding: 24 }}>
                Loading RFID stickers…
              </td>
            </tr>
          ) : filteredStickers.length === 0 ? (
            <tr>
              <td colSpan={7} className="center muted" style={{ padding: 24 }}>
                No stickers matching the current filter.
              </td>
            </tr>
          ) : (
            filteredStickers.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong className="mono">{s.uid}</strong>
                </td>
                <td>
                  {s.truck?.plate ? (
                    <Link to={`/registry/${s.truck.id}`} className="plate plate-sm">
                      {formatPlate(s.truck.plate, s.truck.plate_type)}
                    </Link>
                  ) : (
                    `Truck #${s.truck_id}`
                  )}
                </td>
                <td>
                  <span className={statusBadgeCls(s.status)}>{s.status}</span>
                </td>
                <td>{formatDateTime(s.issued_at)}</td>
                <td>{formatDateTime(s.expires_at)}</td>
                <td>
                  {s.status === "REVOKED" ? (
                    <span className="bad-text small">{s.revocation_reason ?? "Revoked"}</span>
                  ) : s.status === "REPLACED" ? (
                    <span className="muted small">Replaced by #{s.replaced_by_sticker_id}</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {s.status === "ACTIVE" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn small"
                        style={{ padding: "3px 8px", fontSize: "0.8rem" }}
                        onClick={() => {
                          setReplaceModal(s);
                          setReplaceUid(`GB-RFID-${Math.floor(10000 + Math.random() * 90000)}`);
                        }}
                      >
                        <LuRefreshCw /> Replace
                      </button>
                      <button
                        className="btn small"
                        style={{ padding: "3px 8px", fontSize: "0.8rem", color: "var(--bad)" }}
                        onClick={() => setRevokeModal(s)}
                      >
                        <LuAlertOctagon /> Revoke
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Issue Modal */}
      {issueModal && (
        <div className="modal-backdrop" onClick={() => setIssueModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Issue GB RFID Sticker</h3>
            <label className="gc-field">
              Vehicle to assign
              <select
                value={issueTruckId}
                onChange={(e) => setIssueTruckId(Number(e.target.value))}
              >
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatPlate(t.plate, t.plate_type)} · {t.make} {t.model}
                  </option>
                ))}
              </select>
            </label>
            <label className="gc-field">
              Sticker UID
              <input
                value={issueUid}
                onChange={(e) => setIssueUid(e.target.value)}
                placeholder="GB-RFID-12345"
              />
            </label>
            <label className="gc-field">
              Validity (Days)
              <input
                type="number"
                value={issueDays}
                onChange={(e) => setIssueDays(Number(e.target.value))}
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setIssueModal(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={issuing || !issueUid.trim()}
                onClick={handleIssue}
              >
                Issue Sticker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Modal */}
      {replaceModal && (
        <div className="modal-backdrop" onClick={() => setReplaceModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Replace RFID Sticker · {replaceModal.uid}</h3>
            <p className="muted small">
              Replacing this sticker will mark {replaceModal.uid} as REPLACED and assign a new RFID sticker to truck #
              {replaceModal.truck_id}.
            </p>
            <label className="gc-field">
              New Replacement Sticker UID
              <input
                value={replaceUid}
                onChange={(e) => setReplaceUid(e.target.value)}
                placeholder="GB-RFID-XXXXX"
              />
            </label>
            <label className="gc-field">
              Mandatory Replacement Reason
              <input
                value={replaceReason}
                onChange={(e) => setReplaceReason(e.target.value)}
                placeholder="e.g. Sticker peeling off windshield / damaged during washing"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setReplaceModal(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={replacing || !replaceUid.trim() || !replaceReason.trim()}
                onClick={handleReplace}
              >
                Confirm Replacement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {revokeModal && (
        <div className="modal-backdrop" onClick={() => setRevokeModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Revoke RFID Sticker · {revokeModal.uid}</h3>
            <p className="muted small">
              Revoking this sticker will immediately prevent this vehicle from receiving entry authorization across all
              site gates.
            </p>
            <label className="gc-field">
              Mandatory Revocation Reason
              <input
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Tampering detected / sticker found affixed to unauthorized truck"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setRevokeModal(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                style={{ background: "var(--bad)", borderColor: "var(--bad)" }}
                disabled={revoking || !revokeReason.trim()}
                onClick={handleRevoke}
              >
                Confirm Revocation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
