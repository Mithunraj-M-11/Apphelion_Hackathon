import { useEffect, useState } from "react";
import {
  LuAlertTriangle,
  LuCheckCircle2,
  LuDownload,
  LuRefreshCw,
  LuShieldAlert,
  LuUpload,
  LuWifi,
  LuWifiOff,
} from "react-icons/lu";
import {
  api,
  type EdgeSystemState,
  type EmergencyMovement,
  type RecoverySnapshotEnvelope,
} from "../api";
import { ErrorNote } from "../components";
import { formatDateTime } from "../format";

export default function EdgeRecovery() {
  const [state, setState] = useState<EdgeSystemState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot generation
  const [generatedSnapshot, setGeneratedSnapshot] = useState<RecoverySnapshotEnvelope | null>(null);
  const [generatingSnap, setGeneratingSnap] = useState(false);

  // Disaster recovery restoration modal / input
  const [restoreModal, setRestoreModal] = useState(false);
  const [snapshotJson, setSnapshotJson] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [restoreResult, setRestoreResult] = useState<Record<string, unknown> | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Emergency authorization
  const [emPlate, setEmPlate] = useState("");
  const [emDirection, setEmDirection] = useState<"IN" | "OUT">("IN");
  const [emGate, setEmGate] = useState("G1");
  const [emReason, setEmReason] = useState("");
  const [emMovements, setEmMovements] = useState<EmergencyMovement[]>([]);
  const [recordingEm, setRecordingEm] = useState(false);

  // Reconciliation
  const [reconciling, setReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<{
    reconciled_count: number;
    discrepancy_count: number;
    discrepancies: { emergency_movement_id: number; truck_plate: string; problems: string[] }[];
  } | null>(null);

  const loadAll = () => {
    setLoading(true);
    Promise.all([api.edgeState(), api.emergencyMovements()])
      .then(([st, ems]) => {
        setState(st);
        setEmMovements(ems);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Failover simulation: primary edge failure
  const simulatePrimaryFail = async () => {
    if (!state) return;
    setError(null);
    try {
      const updated = await api.updateEdgeState({
        primary_status: "FAILED",
        active_authority: "STANDBY",
        standby_status: "ACTIVE",
      });
      setState(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Restore primary edge
  const restorePrimary = async () => {
    if (!state) return;
    setError(null);
    try {
      const updated = await api.updateEdgeState({
        primary_status: "ACTIVE",
        active_authority: "PRIMARY",
        standby_status: "STANDBY",
        disaster_recovery_mode: false,
      });
      setState(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Toggle WAN connectivity
  const toggleWan = async () => {
    if (!state) return;
    setError(null);
    const newWan =
      state.wan_connectivity === "ONLINE"
        ? "WAN_OFFLINE_LOCAL_OPERATIONAL"
        : "ONLINE";
    try {
      const updated = await api.updateEdgeState({ wan_connectivity: newWan });
      setState(updated);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Generate snapshot
  const handleGenerateSnapshot = async () => {
    setGeneratingSnap(true);
    setError(null);
    try {
      const snap = await api.generateSnapshot();
      setGeneratedSnapshot(snap);
      setSnapshotJson(JSON.stringify(snap, null, 2));
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingSnap(false);
    }
  };

  // Restore snapshot
  const handleRestoreSnapshot = async () => {
    if (!snapshotJson.trim() || !restoreReason.trim()) return;
    setRestoring(true);
    setError(null);
    try {
      const envelope = JSON.parse(snapshotJson);
      const res = await api.restoreSnapshot({
        snapshot_envelope: envelope,
        approval_reason: restoreReason.trim(),
      });
      setRestoreResult(res);
      setRestoreReason("");
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  };

  // Record emergency movement
  const handleRecordEmergency = async () => {
    if (!emPlate.trim() || !emReason.trim()) return;
    setRecordingEm(true);
    setError(null);
    try {
      await api.recordEmergencyMovement({
        truck_plate: emPlate.trim(),
        direction: emDirection,
        gate: emGate,
        reason: emReason.trim(),
      });
      setEmPlate("");
      setEmReason("");
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecordingEm(false);
    }
  };

  // Reconcile
  const handleReconcile = async () => {
    setReconciling(true);
    setError(null);
    try {
      const report = await api.reconcile();
      setReconcileReport(
        report as {
          reconciled_count: number;
          discrepancy_count: number;
          discrepancies: { emergency_movement_id: number; truck_plate: string; problems: string[] }[];
        }
      );
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReconciling(false);
    }
  };

  if (!state && loading) {
    return <div className="muted center" style={{ padding: 40 }}>Loading Edge Infrastructure State…</div>;
  }

  const isWanOnline = state?.wan_connectivity === "ONLINE";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Edge Infrastructure & Disaster Recovery</h1>
          <p className="muted">
            Local site edge device topology, automated standby failover, signed snapshot disaster recovery, and offline
            reconciliation.
          </p>
        </div>
        <button className="btn" onClick={loadAll}>
          <LuRefreshCw /> Refresh Status
        </button>
      </div>

      <ErrorNote error={error} />

      {/* Infrastructure Topology Grid */}
      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {/* Primary Edge */}
        <div className={`stat ${state?.primary_status === "ACTIVE" ? "" : "bad"}`} style={{ borderLeft: "4px solid var(--primary)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="stat-label">PRIMARY EDGE CONTROLLER</div>
            <span className={`badge ${state?.primary_status === "ACTIVE" ? "ok" : "bad"}`}>
              {state?.primary_status}
            </span>
          </div>
          <div className="stat-num" style={{ fontSize: "1.2rem", marginTop: 4 }}>
            {state?.active_authority === "PRIMARY" ? "ACTIVE AUTHORITY" : "STANDBY / INACTIVE"}
          </div>
          <div className="small muted">PostgreSQL authoritative replica · Gate pole sync</div>
        </div>

        {/* Standby Edge */}
        <div className={`stat ${state?.standby_status === "ACTIVE" ? "" : ""}`} style={{ borderLeft: "4px solid #10b981" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="stat-label">HOT-STANDBY EDGE DEVICE</div>
            <span className={`badge ${state?.standby_status === "ACTIVE" ? "warn" : "neutral"}`}>
              {state?.standby_status}
            </span>
          </div>
          <div className="stat-num" style={{ fontSize: "1.2rem", marginTop: 4 }}>
            {state?.active_authority === "STANDBY" ? "ACTIVE AUTHORITY" : "STANDBY READY"}
          </div>
          <div className="small muted">Zero-data-loss standby · Heartbeat synchronized</div>
        </div>

        {/* WAN Status */}
        <div className={`stat ${isWanOnline ? "" : "warn"}`} style={{ borderLeft: "4px solid var(--warn)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="stat-label">WAN / INTERNET UPLINK</div>
            <span className={`badge ${isWanOnline ? "ok" : "warn"}`}>
              {state?.wan_connectivity}
            </span>
          </div>
          <div className="stat-num" style={{ fontSize: "1.2rem", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            {isWanOnline ? <LuWifi /> : <LuWifiOff />} {isWanOnline ? "ONLINE" : "OFFLINE (LOCAL OPS)"}
          </div>
          <div className="small muted">Site local authorization continues uninterrupted</div>
        </div>

        {/* Snapshot / Recovery State */}
        <div className="stat" style={{ borderLeft: "4px solid #8b5cf6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="stat-label">AUTHORIZATION SNAPSHOT</div>
            <span className="badge neutral">HMAC-SHA256 SIGNED</span>
          </div>
          <div className="stat-num" style={{ fontSize: "1.2rem", marginTop: 4 }}>
            {state?.last_snapshot_version ?? "No snapshot created"}
          </div>
          <div className="small muted">
            {state?.last_snapshot_at ? `Generated ${formatDateTime(state.last_snapshot_at)}` : "Generate snapshot below"}
          </div>
        </div>
      </div>

      {/* Simulation & Control Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {/* Failover and Connectivity Controls */}
        <section className="card">
          <header className="card-head">
            <h3>Failover & Resilience Demonstration</h3>
          </header>
          <p className="muted small">
            Simulate real-world hardware and network failure modes to demonstrate uninterrupted site gate operations.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>Primary Edge Failure</strong>
                <div className="muted small">Simulate primary device outage; hot-standby takes over authority</div>
              </div>
              <button
                className="btn small"
                disabled={state?.primary_status === "FAILED"}
                onClick={simulatePrimaryFail}
              >
                <LuAlertTriangle /> Simulate Failover
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>Restore Primary Edge</strong>
                <div className="muted small">Re-establish primary edge authority after recovery</div>
              </div>
              <button
                className="btn small"
                disabled={state?.primary_status === "ACTIVE" && state?.active_authority === "PRIMARY"}
                onClick={restorePrimary}
              >
                <LuCheckCircle2 /> Restore Primary
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>WAN / Central Disconnect</strong>
                <div className="muted small">Toggle between Central Online and Local-First Autonomous operation</div>
              </div>
              <button className="btn small" onClick={toggleWan}>
                {isWanOnline ? <LuWifiOff /> : <LuWifi />} {isWanOnline ? "Disconnect WAN" : "Reconnect WAN"}
              </button>
            </div>
          </div>
        </section>

        {/* Disaster Recovery Snapshot Controls */}
        <section className="card">
          <header className="card-head">
            <h3>Disaster Recovery Snapshot</h3>
          </header>
          <p className="muted small">
            Generate an encrypted, tamper-evident authorization snapshot containing truck mappings, RFID states, and
            quotas for Level 3 disaster recovery.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="btn primary"
              disabled={generatingSnap}
              onClick={handleGenerateSnapshot}
            >
              <LuDownload /> {generatingSnap ? "Generating…" : "Generate Signed Snapshot"}
            </button>
            <button className="btn" onClick={() => setRestoreModal(true)}>
              <LuUpload /> Restore from Snapshot
            </button>
          </div>

          {generatedSnapshot && (
            <div style={{ marginTop: 12 }}>
              <div className="small ok-text">
                Snapshot generated with digest: <span className="mono">{generatedSnapshot.digest.slice(0, 16)}…</span>
              </div>
              <div className="small muted">
                Contains {generatedSnapshot.data.trucks.length} trucks, {generatedSnapshot.data.rfid_stickers.length}{" "}
                stickers, {generatedSnapshot.data.quotas.length} quotas.
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Level 3 Disaster Recovery: Emergency Authorization & Post-Restoration Reconciliation */}
      <section className="card" style={{ marginBottom: 20 }}>
        <header className="card-head">
          <h3>Emergency Authorization & Post-Disaster Reconciliation</h3>
        </header>
        <p className="muted small">
          When normal infrastructure is unavailable, authorized officers can record emergency vehicle movements
          against the recovered snapshot. When normal authority resumes, automated reconciliation flags discrepancies.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, marginTop: 12 }}>
          {/* Emergency Movement Form */}
          <div style={{ background: "var(--neutral-bg)", padding: 14, borderRadius: 10 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
              <LuShieldAlert /> Record Emergency Manual Authorization
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px", gap: 10 }}>
              <label className="gc-field">
                Vehicle Plate
                <input
                  value={emPlate}
                  onChange={(e) => setEmPlate(e.target.value)}
                  placeholder="OD09AC5678"
                />
              </label>
              <label className="gc-field">
                Direction
                <select
                  value={emDirection}
                  onChange={(e) => setEmDirection(e.target.value as "IN" | "OUT")}
                >
                  <option value="IN">Entry (IN)</option>
                  <option value="OUT">Exit (OUT)</option>
                </select>
              </label>
              <label className="gc-field">
                Gate
                <input value={emGate} onChange={(e) => setEmGate(e.target.value)} />
              </label>
            </div>
            <label className="gc-field">
              Mandatory Officer Justification
              <input
                value={emReason}
                onChange={(e) => setEmReason(e.target.value)}
                placeholder="e.g. Infrastructure hardware replacement in progress; verified against signed snapshot #1"
              />
            </label>
            <button
              className="btn primary small"
              disabled={recordingEm || !emPlate.trim() || !emReason.trim()}
              onClick={handleRecordEmergency}
            >
              Record Emergency Movement
            </button>
          </div>

          {/* Reconciliation Trigger & Report */}
          <div style={{ background: "var(--neutral-bg)", padding: 14, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem" }}>System Reconciliation</h4>
              <button
                className="btn small"
                disabled={reconciling || emMovements.filter((m) => !m.reconciled).length === 0}
                onClick={handleReconcile}
              >
                <LuRefreshCw /> {reconciling ? "Reconciling…" : "Run Reconciliation"}
              </button>
            </div>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {emMovements.filter((m) => !m.reconciled).length} unreconciled emergency movement(s) recorded during outage.
            </div>

            {reconcileReport && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Reconciliation Complete</strong>
                  <span className={`badge ${reconcileReport.discrepancy_count > 0 ? "bad" : "ok"}`}>
                    {reconcileReport.discrepancy_count} Discrepancy(ies)
                  </span>
                </div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {reconcileReport.reconciled_count} emergency movements audited against authoritative registry.
                </div>
                {reconcileReport.discrepancies.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: "0.8rem", color: "var(--bad)" }}>
                    {reconcileReport.discrepancies.map((d) => (
                      <li key={d.emergency_movement_id}>
                        {d.truck_plate}: {d.problems.join("; ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Emergency movements table */}
        {emMovements.length > 0 && (
          <table className="table compact" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Recorded At</th>
                <th>Vehicle Plate</th>
                <th>Direction</th>
                <th>Gate</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Reconciliation Audit</th>
              </tr>
            </thead>
            <tbody>
              {emMovements.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.created_at)}</td>
                  <td><strong>{m.truck_plate}</strong></td>
                  <td>{m.direction}</td>
                  <td>{m.gate}</td>
                  <td>{m.reason}</td>
                  <td>
                    <span className={`badge ${m.reconciled ? "ok" : "warn"}`}>
                      {m.reconciled ? "RECONCILED" : "UNRECONCILED"}
                    </span>
                  </td>
                  <td className="small">{m.reconciliation_notes ?? "Pending reconciliation"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Snapshot Restoration Modal */}
      {restoreModal && (
        <div className="modal-backdrop" onClick={() => setRestoreModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 650 }}>
            <h3>Level 3: Disaster Recovery Snapshot Restoration</h3>
            <p className="muted small">
              Paste or inspect the digitally signed recovery snapshot JSON to restore vehicle identities, RFID sticker
              states, and quotas into this replacement local controller.
            </p>
            <label className="gc-field">
              Signed Snapshot JSON Envelope
              <textarea
                rows={7}
                style={{ font: "inherit", fontSize: "0.75rem", width: "100%", padding: 6, borderRadius: 6, border: "1px solid var(--border)", fontFamily: "monospace" }}
                value={snapshotJson}
                onChange={(e) => setSnapshotJson(e.target.value)}
                placeholder="Paste signed snapshot envelope JSON here…"
              />
            </label>
            <label className="gc-field">
              GB Officer Approval Justification
              <input
                value={restoreReason}
                onChange={(e) => setRestoreReason(e.target.value)}
                placeholder="e.g. Primary and standby server rack replaced following power surge; restoring verified snapshot"
              />
            </label>

            {restoreResult && (
              <div style={{ background: "var(--ok-bg)", border: "1px solid var(--ok)", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: "0.85rem" }}>
                <strong>Snapshot restored successfully</strong>
                <div>Age: {String(restoreResult.age_hours)} hours {restoreResult.is_stale ? "(Potentially Stale)" : ""}</div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setRestoreModal(false)}>
                Close
              </button>
              <button
                className="btn primary"
                disabled={restoring || !snapshotJson.trim() || !restoreReason.trim()}
                onClick={handleRestoreSnapshot}
              >
                {restoring ? "Verifying & Restoring…" : "Verify Signature & Restore State"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
