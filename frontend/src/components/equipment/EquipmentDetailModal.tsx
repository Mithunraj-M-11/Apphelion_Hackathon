import { useEffect } from "react";
import {
  LuAlertCircle,
  LuBuilding2,
  LuCheckCircle2,
  LuInfo,
  LuLayers,
  LuShieldAlert,
  LuSliders,
  LuTag,
  LuX,
  LuZap,
} from "react-icons/lu";
import type { EquipmentItem } from "../../data/equipmentCatalogue";
import { EquipmentIllustration } from "./EquipmentIllustrations";

interface EquipmentDetailModalProps {
  item: EquipmentItem | null;
  onClose: () => void;
}

export function EquipmentDetailModal({ item, onClose }: EquipmentDetailModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (item) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="eq-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="eq-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Close Button */}
        <button
          type="button"
          className="eq-modal-close"
          onClick={onClose}
          aria-label="Close modal"
          title="Close (Esc)"
        >
          <LuX />
        </button>

        {/* Modal Header Media */}
        <div className="eq-modal-hero">
          <EquipmentIllustration type={item.illustrationType} className="eq-modal-hero-img" />
          <div className="eq-modal-hero-overlay">
            <span className="eq-modal-cat-badge">{item.category}</span>
            <h2 id="modal-title" className="eq-modal-title">
              {item.name}
            </h2>
            <div className="eq-modal-meta-row">
              <div className="eq-modal-price-pill">
                <LuTag />
                <span>{item.priceDisplay}</span>
              </div>
              <div className="eq-modal-qty-pill">
                <LuLayers />
                <span>Quantity: {item.quantity}</span>
              </div>
              {item.backupCovered && (
                <div className="eq-modal-backup-pill">
                  <LuZap />
                  <span>48h Power Resilient</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Content Body */}
        <div className="eq-modal-content">
          {/* Description */}
          <div className="eq-modal-section">
            <h4 className="eq-modal-sec-title">Equipment Purpose &amp; Overview</h4>
            <p className="eq-modal-desc">{item.fullDescription}</p>
          </div>

          {/* Example Equipment if available */}
          {item.exampleEquipment && item.exampleEquipment.length > 0 && (
            <div className="eq-modal-section">
              <h4 className="eq-modal-sec-title">Benchmark Equipment &amp; Payloads</h4>
              <div className="eq-modal-benchmarks">
                {item.exampleEquipment.map((ex) => (
                  <div key={ex} className="eq-benchmark-item">
                    <span className="eq-benchmark-bullet" />
                    <span>{ex}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Market Brands & Manufacturers */}
          <div className="eq-modal-section">
            <h4 className="eq-modal-sec-title">
              <LuBuilding2 /> Available Market Brands &amp; Manufacturers
            </h4>
            {item.brandCategories && item.brandCategories.length > 0 ? (
              <div className="eq-brand-category-group">
                {item.brandCategories.map((cat, i) => (
                  <div key={i} className="eq-brand-cat-card">
                    <span className="eq-brand-cat-name">{cat.category}</span>
                    <div className="eq-brand-pill-wrap">
                      {cat.brands.map((b) => (
                        <span key={b} className="eq-brand-pill primary">
                          {b}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="eq-brand-pill-wrap">
                {item.brands.map((b) => (
                  <span key={b} className="eq-brand-pill primary">
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Key Capabilities */}
          <div className="eq-modal-section">
            <h4 className="eq-modal-sec-title">
              <LuCheckCircle2 /> Key Functional Features
            </h4>
            <div className="eq-modal-features-grid">
              {item.keyFeatures.map((feat, idx) => (
                <div key={idx} className="eq-modal-feature-item">
                  <LuCheckCircle2 className="eq-modal-feat-icon" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Technical Specifications */}
          {item.specifications && item.specifications.length > 0 && (
            <div className="eq-modal-section">
              <h4 className="eq-modal-sec-title">
                <LuSliders /> Indicative Specifications
              </h4>
              <div className="eq-specs-table">
                {item.specifications.map((spec, idx) => (
                  <div key={idx} className="eq-spec-row">
                    <span className="eq-spec-label">{spec.label}</span>
                    <span className="eq-spec-val">{spec.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Procurement Considerations */}
          {item.procurementNotes && (
            <div className="eq-modal-alert info">
              <LuInfo className="eq-alert-icon" />
              <div>
                <strong>Procurement Consideration</strong>
                <p>{item.procurementNotes}</p>
              </div>
            </div>
          )}

          {/* Operational Notes */}
          {item.operationalNotes && (
            <div className="eq-modal-alert warning">
              <LuAlertCircle className="eq-alert-icon" />
              <div>
                <strong>Operational Requirement</strong>
                <p>{item.operationalNotes}</p>
              </div>
            </div>
          )}

          {/* Safety Notes */}
          {item.safetyNotes && (
            <div className="eq-modal-alert danger">
              <LuShieldAlert className="eq-alert-icon" />
              <div>
                <strong>Mandatory Safety Standard</strong>
                <p>{item.safetyNotes}</p>
              </div>
            </div>
          )}

          {/* Cost Note */}
          <div className="eq-modal-footer-note">
            <span>
              Indicative India-market pricing: <strong>{item.priceDisplay}</strong> {item.unitNote ? `(${item.unitNote})` : ""}. Final cost requires site validation, vendor quotation, and civil mounting assessment.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
