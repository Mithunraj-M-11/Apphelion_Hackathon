import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LuBarChart3,
  LuExternalLink,
  LuGauge,
  LuRefreshCw,
  LuScale,
  LuSearch,
  LuShieldAlert,
  LuShieldCheck,
  LuX,
} from "react-icons/lu";
import {
  wimApi,
  type WimAnomaly,
  type WimDashboardMetrics,
  type WimDevice,
  type WimMeasurement,
} from "../api";
import { formatDateTime, formatPlate } from "../format";
import { useOfficer } from "../officer";

export default function WimDashboard() {
  const { acting } = useOfficer();
  const [tab, setTab] = useState<"overview" | "measurements" | "anomalies" | "devices">("overview");

  // Metrics state
  const [metrics, setMetrics] = useState<WimDashboardMetrics | null>(null);
  const [devices, setDevices] = useState<WimDevice[]>([]);
  const [measurements, setMeasurements] = useState<WimMeasurement[]>([]);
  const [anomalies, setAnomalies] = useState<WimAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters for measurements
  const [filterGate, setFilterGate] = useState("");
  const [filterDirection, setFilterDirection] = useState("");
  const [filterPlate, setFilterPlate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterQuality, setFilterQuality] = useState("");

  // Filters for anomalies
  const [anomalyFilterStatus, setAnomalyFilterStatus] = useState("");

  // Measurement detail modal
  const [selectedMeasurement, setSelectedMeasurement] = useState<WimMeasurement | null>(null);

  // Anomaly review modal
  const [reviewAnomaly, setReviewAnomaly] = useState<WimAnomaly | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"RESOLVED" | "DISMISSED" | "UNDER_REVIEW">("RESOLVED");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, d, meas, anom] = await Promise.all([
        wimApi.dashboard(),
        wimApi.devices(),
        wimApi.measurements({
          gate: filterGate,
          direction: filterDirection,
          plate: filterPlate,
          correlation_status: filterStatus,
          quality: filterQuality,
        }),
        wimApi.anomalies(anomalyFilterStatus ? { status: anomalyFilterStatus } : {}),
      ]);
      setMetrics(m);
      setDevices(d);
      setMeasurements(meas);
      setAnomalies(anom);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [filterGate, filterDirection, filterPlate, filterStatus, filterQuality, anomalyFilterStatus]);

  const handleDeviceStatusChange = async (deviceCode: string, status: string) => {
    try {
      await wimApi.updateStatus(deviceCode, status, `Manual console operator status switch to ${status}`);
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewAnomaly || !reviewReason.trim()) return;
    setReviewSubmitting(true);
    try {
      await wimApi.reviewAnomaly(reviewAnomaly.id, reviewStatus, reviewReason.trim());
      setReviewAnomaly(null);
      setReviewReason("");
      loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Weigh-in-Motion (WIM) Verification</h1>
          <p className="muted">
            Independent dynamic axle-weight observation system operating alongside radar vehicle profiling.
          </p>
        </div>
        <button className="btn" onClick={loadAll} disabled={loading} style={{ alignSelf: "flex-start" }}>
          <LuRefreshCw className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="card warn-text" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Tabs */}
      <div className="wim-tab-bar">
        <button
          className={`wim-tab-btn ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          <LuBarChart3 /> Overview & Metrics
        </button>
        <button
          className={`wim-tab-btn ${tab === "measurements" ? "active" : ""}`}
          onClick={() => setTab("measurements")}
        >
          <LuScale /> Measurement History ({measurements.length})
        </button>
        <button
          className={`wim-tab-btn ${tab === "anomalies" ? "active" : ""}`}
          onClick={() => setTab("anomalies")}
        >
          <LuShieldAlert /> Anomaly Management ({anomalies.filter((a) => a.status === "OPEN").length} open)
        </button>
        <button
          className={`wim-tab-btn ${tab === "devices" ? "active" : ""}`}
          onClick={() => setTab("devices")}
        >
          <LuGauge /> WIM Devices ({devices.length})
        </button>
      </div>

      {/* TAB 1: OVERVIEW & SUMMARY METRICS */}
      {tab === "overview" && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Summary Metric Cards */}
          <div className="stats stats-4">
            <div className="card stat">
              <span className="stat-label">Total WIM Devices</span>
              <strong className="stat-value">{metrics?.total_devices ?? "—"}</strong>
              <div className="small muted" style={{ marginTop: 4 }}>
                <span className="badge ok small">{metrics?.online_devices ?? 0} Online</span>{" "}
                <span className="badge bad small">{metrics?.offline_devices ?? 0} Offline</span>
              </div>
            </div>

            <div className="card stat">
              <span className="stat-label">Total Measurements</span>
              <strong className="stat-value">{metrics?.total_measurements ?? "—"}</strong>
              <div className="small muted" style={{ marginTop: 4 }}>
                <span className="badge ok small">{metrics?.successful_measurements ?? 0} Valid</span>{" "}
                <span className="badge warn small">{metrics?.poor_quality_measurements ?? 0} Poor Quality</span>
              </div>
            </div>

            <div className="card stat">
              <span className="stat-label">Radar / WIM Discrepancies</span>
              <strong className="stat-value" style={{ color: "var(--bad)" }}>
                {metrics?.radar_wim_discrepancies ?? 0}
              </strong>
              <div className="small muted" style={{ marginTop: 4 }}>Conflicting sensor evidence</div>
            </div>

            <div className="card stat">
              <span className="stat-label">Overload Anomalies</span>
              <strong className="stat-value" style={{ color: "var(--warn)" }}>
                {metrics?.overload_anomalies ?? 0}
              </strong>
              <div className="small muted" style={{ marginTop: 4 }}>GVW / statutory axle limits exceeded</div>
            </div>
          </div>

          {/* Verification Breakdown Grid */}
          <div className="grid">
            <section className="card">
              <header className="card-head">
                <LuShieldCheck /> <h3>Radar & WIM Correlation Distribution</h3>
              </header>
              <p className="muted small">
                Shows multi-sensor operational resilience and gap detection across gate events:
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>Both Radar & WIM Operational (Full Multi-Sensor Cross-Check)</span>
                  <strong className="badge ok">{metrics?.verification_overview?.both_operational ?? 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>Radar Operational · WIM Unavailable (Monitoring Gap Logged)</span>
                  <strong className="badge warn">{metrics?.verification_overview?.radar_only ?? 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>WIM Operational · Radar Unavailable (Independent Weight Evidence Preserved)</span>
                  <strong className="badge warn">{metrics?.verification_overview?.wim_only ?? 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>Both Radar & WIM Unavailable (Critical Security Gap)</span>
                  <strong className="badge bad">{metrics?.verification_overview?.both_unavailable ?? 0}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                  <span>Technological Discrepancies Requiring Review</span>
                  <strong className="badge bad">{metrics?.verification_overview?.discrepancies ?? 0}</strong>
                </div>
              </div>
            </section>

            <section className="card">
              <header className="card-head">
                <LuShieldAlert /> <h3>Anomaly Review Status</h3>
              </header>
              <p className="muted small">
                Weight and sensor anomalies logged for governing body audit:
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                <div style={{ border: "1px solid var(--bad)", borderRadius: 8, padding: 12, background: "var(--bad-bg)" }}>
                  <div className="small muted">OPEN / ACTION REQUIRED</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--bad)" }}>
                    {metrics?.anomaly_counts_by_status?.OPEN ?? 0}
                  </div>
                </div>
                <div style={{ border: "1px solid var(--warn)", borderRadius: 8, padding: 12, background: "var(--warn-bg)" }}>
                  <div className="small muted">UNDER REVIEW</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--warn)" }}>
                    {metrics?.anomaly_counts_by_status?.UNDER_REVIEW ?? 0}
                  </div>
                </div>
                <div style={{ border: "1px solid var(--ok)", borderRadius: 8, padding: 12, background: "var(--ok-bg)" }}>
                  <div className="small muted">RESOLVED BY OFFICER</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--ok)" }}>
                    {metrics?.anomaly_counts_by_status?.RESOLVED ?? 0}
                  </div>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                  <div className="small muted">DISMISSED (AUDITED)</div>
                  <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
                    {metrics?.anomaly_counts_by_status?.DISMISSED ?? 0}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: MEASUREMENT HISTORY */}
      {tab === "measurements" && (
        <section className="card">
          <header className="card-head" style={{ flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LuScale /> <h3>WIM Dynamic Measurement History</h3>
            </div>
            <span className="muted small">Preserved raw sensor observations</span>
          </header>

          {/* Filter Bar */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 180px" }}>
              <LuSearch className="muted" />
              <input
                type="text"
                placeholder="Filter by vehicle plate…"
                value={filterPlate}
                onChange={(e) => setFilterPlate(e.target.value)}
                style={{ width: "100%", font: "inherit", fontSize: "0.85rem" }}
              />
            </div>
            <select value={filterGate} onChange={(e) => setFilterGate(e.target.value)} style={{ fontSize: "0.85rem" }}>
              <option value="">All Gates</option>
              <option value="G1">Gate G1</option>
              <option value="G2">Gate G2</option>
            </select>
            <select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)} style={{ fontSize: "0.85rem" }}>
              <option value="">All Directions</option>
              <option value="ENTRY">ENTRY (IN)</option>
              <option value="EXIT">EXIT (OUT)</option>
            </select>
            <select value={filterQuality} onChange={(e) => setFilterQuality(e.target.value)} style={{ fontSize: "0.85rem" }}>
              <option value="">All Qualities</option>
              <option value="GOOD">Quality: GOOD</option>
              <option value="FAIR">Quality: FAIR</option>
              <option value="POOR">Quality: POOR</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ fontSize: "0.85rem" }}>
              <option value="">All Correlation Outcomes</option>
              <option value="CORRELATED">CORRELATED (Passed)</option>
              <option value="DISCREPANCY">DISCREPANCY (Conflicting)</option>
              <option value="RADAR_ONLY">RADAR ONLY</option>
              <option value="WIM_ONLY">WIM ONLY</option>
            </select>
          </div>

          {/* Measurements Table */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Measurement ID</th>
                  <th>Observed At</th>
                  <th>Gate / Lane</th>
                  <th>Vehicle Plate</th>
                  <th>Speed</th>
                  <th>Axles</th>
                  <th>Gross Weight</th>
                  <th>Quality</th>
                  <th>Radar Cross-Check</th>
                  <th>Correlation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {measurements.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No WIM measurements matching filters.
                    </td>
                  </tr>
                ) : (
                  measurements.map((m) => (
                    <tr key={m.id}>
                      <td className="mono small">
                        <strong>{m.measurement_id}</strong>
                      </td>
                      <td className="small">{formatDateTime(m.observed_at)}</td>
                      <td>
                        <span className="badge neutral small">
                          {m.gate} · {m.direction}
                        </span>
                      </td>
                      <td>
                        {m.plate ? (
                          <Link to={`/registry/${m.truck_id ?? ""}`}>
                            <strong>{formatPlate(m.plate)}</strong>
                          </Link>
                        ) : (
                          <span className="muted">unmatched</span>
                        )}
                      </td>
                      <td className="small">{m.speed_kmh.toFixed(1)} km/h</td>
                      <td>{m.axle_count} axles</td>
                      <td>
                        <strong style={{ color: "var(--primary)" }}>{m.gross_weight_t.toFixed(2)} t</strong>
                      </td>
                      <td>
                        <span
                          className={`badge small ${
                            m.quality === "GOOD" ? "ok" : m.quality === "FAIR" ? "warn" : "bad"
                          }`}
                        >
                          {m.quality}
                        </span>
                      </td>
                      <td className="small">
                        {m.radar_length_m != null ? `${m.radar_length_m.toFixed(2)} m` : <span className="muted">unavailable</span>}
                      </td>
                      <td>
                        <span
                          className={`badge small ${
                            m.correlation_status === "CORRELATED"
                              ? "ok"
                              : m.correlation_status === "DISCREPANCY"
                              ? "bad"
                              : "warn"
                          }`}
                        >
                          {m.correlation_status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn small"
                          onClick={() => setSelectedMeasurement(m)}
                          style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: ANOMALY MANAGEMENT */}
      {tab === "anomalies" && (
        <section className="card">
          <header className="card-head" style={{ flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LuShieldAlert /> <h3>Weight & Sensor Anomaly Management</h3>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["", "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] as const).map((s) => (
                <button
                  key={s}
                  className={`btn small ${anomalyFilterStatus === s ? "primary" : ""}`}
                  onClick={() => setAnomalyFilterStatus(s)}
                >
                  {s === "" ? "All" : s}
                </button>
              ))}
            </div>
          </header>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Anomaly Code</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Vehicle</th>
                  <th>Measurement</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Reviewer / Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No anomalies recorded for this status.
                    </td>
                  </tr>
                ) : (
                  anomalies.map((a) => (
                    <tr key={a.id}>
                      <td className="mono small">
                        <strong>{a.anomaly_code}</strong>
                      </td>
                      <td>
                        <span className="badge neutral small">{a.anomaly_type.replace("_", " ")}</span>
                      </td>
                      <td>
                        <span
                          className={`badge small ${
                            a.severity === "CRITICAL"
                              ? "bad"
                              : a.severity === "HIGH"
                              ? "bad"
                              : a.severity === "MEDIUM"
                              ? "warn"
                              : "neutral"
                          }`}
                        >
                          {a.severity}
                        </span>
                      </td>
                      <td>{a.plate ? formatPlate(a.plate) : "—"}</td>
                      <td className="mono small">
                        {a.measurement_id ? `#${a.measurement_id}` : "—"}
                      </td>
                      <td className="small" style={{ maxWidth: 320 }}>
                        {a.description}
                      </td>
                      <td>
                        <span
                          className={`badge small ${
                            a.status === "OPEN"
                              ? "bad"
                              : a.status === "UNDER_REVIEW"
                              ? "warn"
                              : "ok"
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="small">
                        {a.reviewer_name ? (
                          <div>
                            <strong>{a.reviewer_name}</strong>
                            <div className="muted">{a.resolution_reason}</div>
                          </div>
                        ) : (
                          <span className="muted">Pending review</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="btn small"
                          onClick={() => {
                            setReviewAnomaly(a);
                            setReviewStatus("RESOLVED");
                            setReviewReason("");
                          }}
                          style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: WIM DEVICES */}
      {tab === "devices" && (
        <section className="card">
          <header className="card-head">
            <LuGauge /> <h3>Simulated WIM Devices & Health</h3>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
            {devices.map((d) => (
              <div key={d.id} className="card" style={{ border: "1px solid var(--border)", marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    <LuScale /> {d.device_code}
                  </h4>
                  <span
                    className={`badge ${
                      d.status === "ONLINE" ? "ok" : d.status === "DEGRADED" ? "warn" : "bad"
                    }`}
                  >
                    {d.status}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", fontSize: "0.85rem", marginBottom: 12 }}>
                  <div><span className="muted">Gate:</span> <strong>{d.gate}</strong></div>
                  <div><span className="muted">Lane:</span> <strong>{d.lane}</strong></div>
                  <div><span className="muted">Model:</span> <span>{d.model}</span></div>
                  <div><span className="muted">Firmware:</span> <span>{d.firmware_version}</span></div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <span className="muted">Last Heartbeat:</span>{" "}
                    <span>{formatDateTime(d.last_heartbeat || d.updated_at)}</span>
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <div className="small muted" style={{ marginBottom: 6 }}>Simulate Availability Status:</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn small"
                      onClick={() => handleDeviceStatusChange(d.device_code, "ONLINE")}
                      disabled={d.status === "ONLINE"}
                    >
                      Set Online
                    </button>
                    <button
                      className="btn small"
                      onClick={() => handleDeviceStatusChange(d.device_code, "DEGRADED")}
                      disabled={d.status === "DEGRADED"}
                    >
                      Set Degraded
                    </button>
                    <button
                      className="btn small"
                      style={{ color: "var(--bad)" }}
                      onClick={() => handleDeviceStatusChange(d.device_code, "OFFLINE")}
                      disabled={d.status === "OFFLINE"}
                    >
                      Set Offline
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* MODAL 1: Measurement Detail Popup */}
      {selectedMeasurement && (
        <div className="modal-backdrop" onClick={() => setSelectedMeasurement(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <LuScale /> WIM Measurement: {selectedMeasurement.measurement_id}
              </h3>
              <button className="btn small" onClick={() => setSelectedMeasurement(null)}>
                <LuX />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "0.9rem" }}>
              <div><span className="muted">Gate / Lane:</span> <strong>{selectedMeasurement.gate} · {selectedMeasurement.lane}</strong></div>
              <div><span className="muted">Direction:</span> <strong>{selectedMeasurement.direction}</strong></div>
              <div><span className="muted">Observed Time:</span> <span>{formatDateTime(selectedMeasurement.observed_at)}</span></div>
              <div><span className="muted">Crossing Speed:</span> <strong>{selectedMeasurement.speed_kmh.toFixed(1)} km/h</strong></div>
              <div><span className="muted">Vehicle Plate:</span> <strong>{selectedMeasurement.plate ? formatPlate(selectedMeasurement.plate) : "unmatched"}</strong></div>
              <div><span className="muted">Signal Quality:</span> <span className="badge small ok">{selectedMeasurement.quality}</span></div>
              <div><span className="muted">Gross Weight:</span> <strong style={{ color: "var(--primary)" }}>{selectedMeasurement.gross_weight_t.toFixed(2)} tonnes</strong></div>
              <div><span className="muted">Axle Count:</span> <strong>{selectedMeasurement.axle_count} axles</strong></div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="field-label">Individual Axle Load Breakdown</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {selectedMeasurement.axle_weights.map((w, idx) => (
                  <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", background: "var(--neutral-bg)" }}>
                    <div className="small muted">Axle #{idx + 1}</div>
                    <strong>{w.toFixed(2)} t</strong>
                  </div>
                ))}
              </div>
            </div>

            {selectedMeasurement.movement_id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <Link to="/gate-events">
                  <LuExternalLink /> View Associated Gate Event #{selectedMeasurement.movement_id}
                </Link>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={() => setSelectedMeasurement(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Anomaly Review Popup */}
      {reviewAnomaly && (
        <div className="modal-backdrop" onClick={() => setReviewAnomaly(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <LuShieldAlert /> Review Anomaly: {reviewAnomaly.anomaly_code}
              </h3>
              <button className="btn small" onClick={() => setReviewAnomaly(null)}>
                <LuX />
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div className="small muted">Anomaly Type & Severity</div>
              <div><strong>{reviewAnomaly.anomaly_type}</strong> · <span className="badge bad small">{reviewAnomaly.severity}</span></div>
              <p className="small" style={{ marginTop: 6 }}>{reviewAnomaly.description}</p>
            </div>

            <form onSubmit={handleReviewSubmit}>
              <label className="gc-field" style={{ marginBottom: 12 }}>
                Review Outcome
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value as "RESOLVED" | "DISMISSED" | "UNDER_REVIEW")}
                >
                  <option value="RESOLVED">RESOLVED (Action taken, verified, or cleared)</option>
                  <option value="DISMISSED">DISMISSED (False alarm / benign observation)</option>
                  <option value="UNDER_REVIEW">UNDER_REVIEW (Requires physical weighbridge or inspection)</option>
                </select>
              </label>

              <label className="gc-field" style={{ marginBottom: 14 }}>
                Governing Body Officer Reason (Required)
                <textarea
                  rows={3}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="State the technical or administrative reason for this resolution…"
                  required
                  style={{ width: "100%", font: "inherit", fontSize: "0.85rem", padding: "8px" }}
                />
              </label>

              <div className="small muted" style={{ marginBottom: 12 }}>
                Acting officer attribution: <strong>{acting?.name || "Officer"} ({acting?.role || "Reviewer"})</strong>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setReviewAnomaly(null)} disabled={reviewSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={reviewSubmitting || !reviewReason.trim()}>
                  {reviewSubmitting ? "Submitting…" : "Submit Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
