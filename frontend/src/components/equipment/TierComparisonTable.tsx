import { LuCheck, LuX } from "react-icons/lu";
import { CAPABILITY_COMPARISON } from "../../data/equipmentCatalogue";

export function TierComparisonTable() {
  return (
    <div className="eq-comparison-section">
      <div className="eq-comparison-header">
        <span className="eq-sub-eyebrow">Tier-by-Tier Capabilities</span>
        <h3 className="eq-sec-heading">Capability Matrix Across Deployment Tiers</h3>
        <p className="muted">
          Compare security depth, volumetric detection capabilities, and infrastructure resilience across all three
          tiers.
        </p>
      </div>

      <div className="eq-table-wrapper">
        <table className="eq-comparison-table">
          <thead>
            <tr>
              <th className="eq-th-capability">Monitored Capability</th>
              <th className="eq-th-tier">
                <div className="eq-tier-th-badge tier-1">Tier 1</div>
                <div className="eq-tier-th-sub">Basic Monitoring</div>
              </th>
              <th className="eq-th-tier">
                <div className="eq-tier-th-badge tier-2">Tier 2</div>
                <div className="eq-tier-th-sub">+ WIM &amp; 48h Backup</div>
              </th>
              <th className="eq-th-tier">
                <div className="eq-tier-th-badge tier-3">Tier 3</div>
                <div className="eq-tier-th-sub">+ Aerial LiDAR &amp; Orbit</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_COMPARISON.map((row, idx) => (
              <tr key={idx} className="eq-table-row">
                <td className="eq-td-capability">
                  <div className="eq-cap-name">{row.capability}</div>
                  <div className="eq-cap-desc">{row.description}</div>
                </td>

                {/* Tier 1 Cell */}
                <td className="eq-td-status center">
                  {row.tier1 ? (
                    <span className="eq-status-badge yes">
                      <LuCheck /> Yes
                    </span>
                  ) : (
                    <span className="eq-status-badge no">
                      <LuX /> No
                    </span>
                  )}
                </td>

                {/* Tier 2 Cell */}
                <td className="eq-td-status center">
                  {row.tier2 ? (
                    <span className="eq-status-badge yes">
                      <LuCheck /> Yes
                    </span>
                  ) : (
                    <span className="eq-status-badge no">
                      <LuX /> No
                    </span>
                  )}
                </td>

                {/* Tier 3 Cell */}
                <td className="eq-td-status center">
                  {row.tier3 ? (
                    <span className="eq-status-badge yes">
                      <LuCheck /> Yes
                    </span>
                  ) : (
                    <span className="eq-status-badge no">
                      <LuX /> No
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
