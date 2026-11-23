import { useEffect, useState } from "react";
import {
  LuAlertCircle,
  LuAlertTriangle,
  LuScale,
} from "react-icons/lu";
import {
  wimApi,
  type WimCorrelation,
  type WimDevice,
} from "../api";

export const WIM_SCENARIOS = [
  { value: "normal", label: "Normal Truck (Balanced loads within legal limits)" },
  { value: "normal_2axle", label: "Normal 2-Axle Rigid Truck (4t steer, 7.5t drive)" },
  { value: "normal_3axle", label: "Normal 3-Axle Heavy Tipper (4.8t steer, 8.5t + 8.5t tandem)" },
  { value: "normal_multiaxle", label: "Multi-Axle Heavy Freight (4+ axles)" },
  { value: "gvw_overload", label: "Gross Vehicle Weight (GVW) Overload (> 130% rated capacity)" },
  { value: "axle_overload", label: "Individual Axle Overload (> 11.5 t on single drive axle)" },
  { value: "axle_imbalance", label: "Abnormal Axle Weight Distribution (Forward imbalance)" },
  { value: "poor_quality", label: "Poor-Quality Dynamic Measurement (Sensor noise / bounce)" },
  { value: "incomplete_measurement", label: "Incomplete Measurement (Missed rear axle)" },
  { value: "device_offline", label: "WIM Device Failure / Sensor Channel Offline" },
  { value: "timeout", label: "Measurement Timeout (Inductive loop triggered, no weight)" },
  { value: "duplicate", label: "Duplicate Measurement (Re-transmitted frame)" },
];

export type WimSimulationState = {
  enabled: boolean;
  deviceCode: string;
  scenario: string;
  deviceStatus: "ONLINE" | "OFFLINE" | "DEGRADED";
};

export function WimSimulatorControls({
  gate,
  state,
  onChange,
  onTriggerScenario,
}: {
  gate: string;
  state: WimSimulationState;
  onChange: (patch: Partial<WimSimulationState>) => void;
  onTriggerScenario: (scenario: string) => void;
}) {
  const [device, setDevice] = useState<WimDevice | null>(null);
  const [devices, setDevices] = useState<WimDevice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    wimApi.devices().then((devs) => {
      setDevices(devs);
      const dev = devs.find((d) => d.gate === gate) || devs[0];
      if (dev) {
        setDevice(dev);
        onChange({ deviceCode: dev.device_code, deviceStatus: dev.status });
      }
    }).catch(() => { });
  }, [gate]);

  const toggleDeviceStatus = async (targetStatus: "ONLINE" | "OFFLINE" | "DEGRADED") => {
    if (!device) return;
    setBusy(true);
    try {
      const updated = await wimApi.updateStatus(
        device.device_code,
        targetStatus,
        `Console simulation operator toggled to ${targetStatus}`
      );
      setDevice(updated);
      onChange({ deviceStatus: updated.status });
    } catch {
      // Offline fallback state update for simulation
      onChange({ deviceStatus: targetStatus });
    } finally {
      setBusy(false);
    }
  };

  const handleDeviceChange = (code: string) => {
    const selected = devices.find((d) => d.device_code === code);
    if (selected) {
      setDevice(selected);
      onChange({ deviceCode: selected.device_code, deviceStatus: selected.status });
    } else {
      onChange({ deviceCode: code });
    }
  };

  const statusCls =
    state.deviceStatus === "ONLINE"
      ? "online"
      : state.deviceStatus === "DEGRADED"
        ? "degraded"
        : "offline";

  return (
    <div className="gc-wim-section">
      <div className="gc-wim-head">
        <h4>
          <LuScale /> WIM Sensor Simulation
        </h4>
        <span className={`gc-wim-pill ${statusCls}`}>
          {state.deviceStatus}
        </span>
        <span className="gc-tag gc-tag-mock" style={{ marginLeft: "auto" }}>
          Simulated WIM (POC)
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <strong>Enable WIM Verification</strong>
        </label>
        <span className="muted small" style={{ marginLeft: "auto" }}>
          Active: {state.deviceCode}
        </span>
      </div>

      {state.enabled && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <label className="gc-field" style={{ margin: 0 }}>
              WIM Device
              <select
                value={state.deviceCode}
                onChange={(e) => handleDeviceChange(e.target.value)}
                disabled={!state.enabled}
              >
                {devices.length > 0 ? (
                  devices.map((d) => (
                    <option key={d.id} value={d.device_code}>
                      {d.device_code} ({d.gate} · {d.lane} Weigh-in-Motion)
                    </option>
                  ))
                ) : (
                  <>
                    <option value="WIM-G1-01">WIM-G1-01 (Gate G1 · ENTRY-1 Weigh-in-Motion)</option>
                    <option value="WIM-G2-01">WIM-G2-01 (Gate G2 · EXIT-1 Weigh-in-Motion)</option>
                  </>
                )}
              </select>
            </label>

            <label className="gc-field" style={{ margin: 0 }}>
              Device Availability
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  className={`btn small ${state.deviceStatus === "ONLINE" ? "primary" : ""}`}
                  style={{ flex: 1, padding: "4px 6px", fontSize: "0.75rem" }}
                  disabled={busy}
                  onClick={() => toggleDeviceStatus("ONLINE")}
                  title="WIM Sensor Online and Calibrated"
                >
                  Online
                </button>
                <button
                  type="button"
                  className={`btn small ${state.deviceStatus === "DEGRADED" ? "primary" : ""}`}
                  style={{ flex: 1, padding: "4px 6px", fontSize: "0.75rem" }}
                  disabled={busy}
                  onClick={() => toggleDeviceStatus("DEGRADED")}
                  title="WIM Sensor Degraded Mode"
                >
                  Degrade
                </button>
                <button
                  type="button"
                  className={`btn small ${state.deviceStatus === "OFFLINE" ? "primary" : ""}`}
                  style={{ flex: 1, padding: "4px 6px", fontSize: "0.75rem", color: "var(--bad)" }}
                  disabled={busy}
                  onClick={() => toggleDeviceStatus("OFFLINE")}
                  title="Simulate Sensor Disconnect / Failure"
                >
                  Fail
                </button>
              </div>
            </label>
          </div>

          <label className="gc-field" style={{ marginBottom: 6 }}>
            Measurement Scenario
            <select
              value={state.scenario}
              onChange={(e) => onChange({ scenario: e.target.value })}
              disabled={!state.enabled}
            >
              {WIM_SCENARIOS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {/* Quick preset triggers */}
          <div className="gc-wim-btn-group">
            <span className="muted small" style={{ alignSelf: "center", marginRight: 4 }}>
              Presets:
            </span>
            <button
              type="button"
              className="btn small"
              onClick={() => onTriggerScenario("normal")}
            >
              Normal
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => onTriggerScenario("gvw_overload")}
            >
              GVW Overload
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => onTriggerScenario("axle_overload")}
            >
              Axle Overload
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => onTriggerScenario("poor_quality")}
            >
              Poor Quality
            </button>
            <button
              type="button"
              className="btn small"
              style={{ color: "var(--bad)" }}
              onClick={() => onTriggerScenario("device_offline")}
            >
              Simulate Failure
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function WimVerificationPanel({
  correlation,
  revealed,
  instant,
}: {
  correlation: WimCorrelation | null;
  revealed: number;
  instant: boolean;
}) {
  if (!correlation) return null;

  const m = correlation.measurement;
  const statusBadgeCls =
    correlation.overall_status === "PASSED"
      ? "badge ok"
      : correlation.overall_status === "WARNING"
        ? "badge warn"
        : correlation.overall_status === "UNAVAILABLE"
          ? "badge neutral"
          : "badge bad";

  return (
    <div className="gc-wim-verify-card">
      <div className="gc-wim-verify-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LuScale style={{ color: "var(--primary)", fontSize: "1.1rem" }} />
          <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Independent WIM Verification</h4>
        </div>
        <span className={statusBadgeCls}>{correlation.overall_status}</span>
      </div>

      {/* Discrepancy Alert Banner (Scenario E) */}
      {correlation.correlation_status === "DISCREPANCY" && (
        <div className="gc-wim-discrepancy-banner">
          <LuAlertTriangle style={{ fontSize: "1.3rem", flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>DISCREPANCY DETECTED — REQUIRES VERIFICATION</strong>
            <div>{correlation.discrepancy_reason || "Independent radar and WIM observations are conflicting."}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Radar and WIM observations preserved. Officer review required before vehicle clearance.
            </div>
          </div>
        </div>
      )}

      {/* Monitoring Warnings (Scenario B & C) */}
      {correlation.monitoring_warning && correlation.correlation_status !== "DISCREPANCY" && (
        <div className="gc-wim-warning-banner">
          <LuAlertCircle style={{ fontSize: "1.2rem", flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>MONITORING NOTICE: {correlation.correlation_status.replace("_", " ")}</strong>
            <div>{correlation.monitoring_warning}</div>
          </div>
        </div>
      )}

      {/* The 8 Verification Checklist Items */}
      <ul className="gc-checks">
        {correlation.checks.map((c, idx) => {
          const visible = instant || idx <= revealed;
          const statusClass =
            c.status === "warning"
              ? "gc-warning"
              : c.status === "unavailable"
                ? "gc-not_applicable"
                : `gc-${c.status}`;

          return (
            <li
              key={c.name}
              className={`gc-check ${visible ? statusClass : "gc-pending"}`}
            >
              <span className="gc-dot" />
              <span className="gc-check-name">{c.label}</span>
              <span className="gc-check-status">
                {visible ? c.status.replace("_", " ") : "evaluating…"}
              </span>
              {visible && c.status !== "unavailable" && (
                <span className="gc-check-detail">{c.detail}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Dynamic Weight Details Card */}
      {m && m.gross_weight_t > 0 && (
        <div className="gc-wim-preview" style={{ marginTop: 12 }}>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Measurement ID</span>
            <span className="gc-wim-preview-value mono">{m.measurement_id}</span>
          </div>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Gross Weight</span>
            <span className="gc-wim-preview-value" style={{ color: "var(--primary)" }}>
              {m.gross_weight_t.toFixed(2)} tonnes
            </span>
          </div>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Axle Count</span>
            <span className="gc-wim-preview-value">{m.axle_count} axles</span>
          </div>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Axle Loads</span>
            <span className="gc-wim-preview-value small">
              {m.axle_weights.map((w, i) => `A${i + 1}:${w.toFixed(1)}t`).join(" · ")}
            </span>
          </div>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Crossing Speed</span>
            <span className="gc-wim-preview-value">{m.speed_kmh.toFixed(1)} km/h</span>
          </div>
          <div className="gc-wim-preview-item">
            <span className="gc-wim-preview-label">Signal Quality</span>
            <span className="gc-wim-preview-value">
              <span
                className={`badge small ${m.quality === "GOOD" ? "ok" : m.quality === "FAIR" ? "warn" : "bad"
                  }`}
              >
                {m.quality}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
