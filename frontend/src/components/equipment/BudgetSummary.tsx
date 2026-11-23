import { LuAlertTriangle, LuArrowRight, LuCalendar, LuCheckCircle2, LuCoins, LuShield } from "react-icons/lu";

interface BudgetSummaryProps {
  onSelectTier?: (tierId: number) => void;
}

export function BudgetSummary({ onSelectTier }: BudgetSummaryProps) {
  return (
    <div className="eq-budget-section">
      <div className="eq-budget-header">
        <span className="eq-sub-eyebrow">Estimated Capital Expenditure</span>
        <h3 className="eq-sec-heading">Overall Estimated Investment by Tier</h3>
        <p className="muted">
          Indicative budget envelopes for turn-key deployment at a single mining site with dual-lane gate configuration.
        </p>
      </div>

      {/* 3 Large Tier Summary Cards */}
      <div className="eq-budget-cards-grid">
        {/* Tier 1 Card */}
        <div className="eq-budget-card tier-1">
          <div className="eq-budget-card-top">
            <span className="eq-budget-tier-pill tier-1">Tier 1</span>
            <span className="eq-budget-item-count">7 Equipment Items</span>
          </div>
          <h4 className="eq-budget-card-title">Basic Independent Monitoring</h4>
          <div className="eq-budget-amount-wrap">
            <div className="eq-budget-amount">₹21 lakh – ₹51.5 lakh</div>
            <div className="eq-budget-subtext">Capital Expenditure (One-time deployment)</div>
          </div>
          <p className="eq-budget-desc">
            Core independent gate infrastructure: Solar ANPR, Cryptographic RFID reader &amp; stickers, boom barriers,
            3D radar, GB edge server, and turn-key integration.
          </p>

          <div className="eq-budget-features">
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Independent entry &amp; exit vehicle identification</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Cryptographic vehicle authentication (AES-128)</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Tamper-evident hash-chained gate logs</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>GB-owned 4G cellular telemetry</span>
            </div>
          </div>

          {onSelectTier && (
            <button type="button" className="eq-budget-action-btn" onClick={() => onSelectTier(1)}>
              <span>View Tier 1 Equipment</span>
              <LuArrowRight />
            </button>
          )}
        </div>

        {/* Tier 2 Card */}
        <div className="eq-budget-card tier-2 popular">
          <div className="eq-budget-badge-popular">Recommended for Volume Integrity</div>
          <div className="eq-budget-card-top">
            <span className="eq-budget-tier-pill tier-2">Tier 2</span>
            <span className="eq-budget-item-count">10 Equipment Items</span>
          </div>
          <h4 className="eq-budget-card-title">Independent Monitoring + Weight Verification + Power Resilience</h4>
          <div className="eq-budget-amount-wrap">
            <div className="eq-budget-amount">₹71 lakh – ₹2.07 crore</div>
            <div className="eq-budget-subtext">Capital Expenditure (Includes All Tier 1 Items)</div>
          </div>
          <p className="eq-budget-desc">
            Complete Tier 1 deployment augmented with in-pavement Weigh-In-Motion dynamic axle sensors and a 48-hour
            site battery backup system.
          </p>

          <div className="eq-budget-features">
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>All 7 Tier 1 Core Monitoring capabilities</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Weigh-In-Motion dynamic gross weight &amp; axle check</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>48-hour full autonomy battery backup covering all gear</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Pavement grooving, epoxy potting &amp; truck calibration</span>
            </div>
          </div>

          {onSelectTier && (
            <button type="button" className="eq-budget-action-btn primary" onClick={() => onSelectTier(2)}>
              <span>View Tier 2 Equipment</span>
              <LuArrowRight />
            </button>
          )}
        </div>

        {/* Tier 3 Card */}
        <div className="eq-budget-card tier-3">
          <div className="eq-budget-card-top">
            <span className="eq-budget-tier-pill tier-3">Tier 3</span>
            <span className="eq-budget-item-count">14 Equipment Items</span>
          </div>
          <h4 className="eq-budget-card-title">Advanced Monitoring + Aerial Intelligence + Perimeter Security</h4>
          <div className="eq-budget-amount-wrap">
            <div className="eq-budget-amount">₹1.06 crore – ₹2.72 crore*</div>
            <div className="eq-budget-subtext">*Initial turn-key CAPEX (Excluding perimeter fencing)</div>
          </div>
          <p className="eq-budget-desc">
            All Tier 1 and Tier 2 capabilities plus enterprise UAV LiDAR surveying, 3D point cloud photogrammetry,
            commercial satellite monitoring, and electric perimeter enclosure.
          </p>

          <div className="eq-budget-features">
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>All 10 Tier 1 &amp; Tier 2 capabilities included</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>UAV RTK LiDAR drone for 3D pit scans &amp; stockpiles</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>Point cloud processing &amp; volumetric cut/fill software</span>
            </div>
            <div className="eq-bf-item">
              <LuCheckCircle2 className="eq-bf-icon ok" />
              <span>High-resolution orbital satellite boundary oversight</span>
            </div>
          </div>

          {onSelectTier && (
            <button type="button" className="eq-budget-action-btn" onClick={() => onSelectTier(3)}>
              <span>View Tier 3 Equipment</span>
              <LuArrowRight />
            </button>
          )}
        </div>
      </div>

      {/* Additional Costs Callout */}
      <div className="eq-additional-costs-card">
        <h4 className="eq-add-costs-title">
          <LuCoins /> Variable &amp; Recurring Subscriptions (Tier 3)
        </h4>
        <div className="eq-add-costs-grid">
          <div className="eq-add-cost-item">
            <div className="eq-add-cost-head">
              <LuShield className="eq-add-cost-icon" />
              <div>
                <strong>Electric Perimeter Security Fencing</strong>
                <span className="muted small">Physical deterrent channeled to gate corridors</span>
              </div>
            </div>
            <div className="eq-add-cost-price">₹5 lakh – ₹12 lakh / km</div>
            <p className="small muted">
              Variable one-time investment proportional to surveyed lease boundary perimeter length. Conforms to Indian
              pulsed non-lethal standards (IS 302 / IEC 60335-2-76).
            </p>
          </div>

          <div className="eq-add-cost-item">
            <div className="eq-add-cost-head">
              <LuCalendar className="eq-add-cost-icon" />
              <div>
                <strong>Commercial Satellite Imagery Subscription</strong>
                <span className="muted small">Maxar / Airbus / Planet periodic tasking</span>
              </div>
            </div>
            <div className="eq-add-cost-price">₹3 lakh – ₹15 lakh / year</div>
            <p className="small muted">
              Annual recurring subscription for sub-meter optical passes, land-use change masks, and lease boundary
              surveillance over 25 sq. km mine catchment tiles.
            </p>
          </div>
        </div>
      </div>

      {/* Prominent Statutory & Budgeting Disclaimer */}
      <div className="eq-disclaimer-box">
        <LuAlertTriangle className="eq-disclaimer-icon" />
        <div className="eq-disclaimer-text">
          <strong>Indicative Budgeting Notice &amp; Contingency Provision:</strong>
          <p>
            All figures are preliminary India-market estimates, not vendor quotations. Prices exclude GST, major civil
            works, recurring maintenance, connectivity charges, calibration and other site-specific costs. Allow a
            10–15% contingency during preliminary budgeting.
          </p>
        </div>
      </div>
    </div>
  );
}
