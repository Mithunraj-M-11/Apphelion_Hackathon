import { useState } from "react";
import {
  LuCpu,
  LuInfo,
  LuMapPin,
  LuSlidersHorizontal,
  LuTag,
} from "react-icons/lu";
import {
  EQUIPMENT_ITEMS,
  TIERS_DATA,
  type EquipmentItem,
  type TierData,
} from "../../data/equipmentCatalogue";
import { BudgetSummary } from "./BudgetSummary";
import { EquipmentDetailModal } from "./EquipmentDetailModal";
import { EquipmentRow } from "./EquipmentRow";
import { TierComparisonTable } from "./TierComparisonTable";

export function EquipmentCatalogue() {
  const [selectedItem, setSelectedItem] = useState<EquipmentItem | null>(null);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <section className="eq-catalogue-root" id="equipment-catalogue">
      {/* Catalogue Header / Hero Banner */}
      <div className="eq-catalogue-hero">
        <div className="eq-hero-eyebrow">
          <LuCpu /> Technology Showcase &amp; Hardware Catalogue
        </div>
        <h2 className="eq-hero-title">
          Independent Mine Monitoring Hardware &amp; Sensor Ecosystem
        </h2>
        <p className="eq-hero-sub">
          Explore the commercial hardware, high-security cryptographic silicon, dynamic weight sensors, and aerial
          LiDAR systems deployed by the Governing Body across three progressive resilience tiers.
        </p>

        {/* Quick jump pills */}
        <div className="eq-jump-pills">
          <button
            type="button"
            className="eq-jump-pill"
            onClick={() => scrollToSection("tier-1-section")}
          >
            <span className="dot tier-1" />
            <span>Tier 1: Basic (7 items · ₹21L–₹51.5L)</span>
          </button>
          <button
            type="button"
            className="eq-jump-pill"
            onClick={() => scrollToSection("tier-2-section")}
          >
            <span className="dot tier-2" />
            <span>Tier 2: WIM &amp; Backup (10 items · ₹71L–₹2.07Cr)</span>
          </button>
          <button
            type="button"
            className="eq-jump-pill"
            onClick={() => scrollToSection("tier-3-section")}
          >
            <span className="dot tier-3" />
            <span>Tier 3: Advanced &amp; LiDAR (14 items · ₹1.06Cr–₹2.72Cr)</span>
          </button>
          <button
            type="button"
            className="eq-jump-pill"
            onClick={() => scrollToSection("tier-comparison-section")}
          >
            <LuSlidersHorizontal />
            <span>Capabilities Matrix</span>
          </button>
          <button
            type="button"
            className="eq-jump-pill"
            onClick={() => scrollToSection("budget-summary-section")}
          >
            <LuTag />
            <span>Budget Summary</span>
          </button>
        </div>
      </div>

      {/* Pricing Assumptions Callout */}
      <div className="eq-assumptions-banner">
        <div className="eq-assumptions-head">
          <div className="eq-assumptions-title">
            <LuMapPin /> Baseline Deployment Parameters (India Market)
          </div>
          <span className="eq-assumptions-tag">Standard Model: 1 Monitored Mine Gate</span>
        </div>
        <div className="eq-assumptions-grid">
          <div className="eq-assumption-chip">
            <strong>Deployment:</strong> 1 Entry Lane + 1 Exit Lane
          </div>
          <div className="eq-assumption-chip">
            <strong>Vision &amp; Read:</strong> 2 ANPR Cameras + 2 RFID Readers
          </div>
          <div className="eq-assumption-chip">
            <strong>Barriers &amp; Radar:</strong> 2 Boom Barriers + 2 3D Radars
          </div>
          <div className="eq-assumption-chip">
            <strong>Media &amp; Edge:</strong> 100 Frangible Stickers + 1 GB Server
          </div>
          <div className="eq-assumption-chip">
            <strong>Tier 2+ Scope:</strong> 1 WIM Array + 48h Full Battery Backup
          </div>
          <div className="eq-assumption-chip">
            <strong>Tier 3 Scope:</strong> LiDAR Drone + Satellites + Perimeter Fence
          </div>
        </div>
        <p className="eq-assumptions-note">
          <LuInfo className="eq-note-icon" />
          <span>
            Indicative India-market estimates. Actual costs depend on equipment specifications, site conditions, vendor
            quotations, installation requirements and taxes. Final procurement requires technical validation.
          </span>
        </p>
      </div>

      {/* Three Horizontal Tier Rows */}
      <div className="eq-tiers-wrapper">
        {TIERS_DATA.map((tier: TierData) => {
          const items = tier.equipmentIds
            .map((id) => EQUIPMENT_ITEMS[id])
            .filter(Boolean);

          return (
            <div
              key={tier.id}
              id={`tier-${tier.id}-section`}
              className={`eq-tier-row-block tier-${tier.id}`}
            >
              {/* Tier Row Header */}
              <div className="eq-tier-head">
                <div className="eq-tier-head-left">
                  <div className="eq-tier-pill-row">
                    <span className={`eq-tier-number-badge tier-${tier.id}`}>
                      {tier.tierNumber}
                    </span>
                    <span className="eq-tier-badge">{tier.badge}</span>
                    <span className="eq-tier-count">
                      {items.length} Equipment Categories
                    </span>
                  </div>
                  <h3 className="eq-tier-title">{tier.title}</h3>
                  <p className="eq-tier-desc">{tier.description}</p>
                </div>

                <div className="eq-tier-head-right">
                  <div className="eq-tier-budget-label">Total Estimated Investment</div>
                  <div className={`eq-tier-budget-value tier-${tier.id}`}>
                    {tier.budgetDisplay}
                  </div>
                  {tier.additionalNotes && (
                    <div className="eq-tier-add-notes">{tier.additionalNotes}</div>
                  )}
                </div>
              </div>

              {/* Horizontal Scrollable Carousel Row */}
              <EquipmentRow
                items={items}
                tierId={tier.id}
                onSelect={(item) => setSelectedItem(item)}
              />
            </div>
          );
        })}
      </div>

      {/* Capability Comparison Table */}
      <div id="tier-comparison-section">
        <TierComparisonTable />
      </div>

      {/* Budget Summary Cards & Contingency Note */}
      <div id="budget-summary-section">
        <BudgetSummary onSelectTier={(tierId) => scrollToSection(`tier-${tierId}-section`)} />
      </div>

      {/* Detail Modal */}
      <EquipmentDetailModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
      />
    </section>
  );
}
