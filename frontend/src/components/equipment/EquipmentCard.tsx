import type { KeyboardEvent } from "react";
import { LuChevronRight, LuSparkles, LuTag } from "react-icons/lu";
import type { EquipmentItem } from "../../data/equipmentCatalogue";
import { EquipmentIllustration } from "./EquipmentIllustrations";

interface EquipmentCardProps {
  item: EquipmentItem;
  tierId: number;
  onSelect: (item: EquipmentItem) => void;
}

export function EquipmentCard({ item, tierId, onSelect }: EquipmentCardProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item);
    }
  };

  return (
    <div
      className="eq-card"
      tabIndex={0}
      role="button"
      aria-label={`View details for ${item.name}`}
      onClick={() => onSelect(item)}
      onKeyDown={handleKeyDown}
    >
      {/* Visual illustration top */}
      <div className="eq-card-media">
        <EquipmentIllustration type={item.illustrationType} className="eq-card-img" />
        <div className="eq-card-overlay">
          <span className="eq-badge-category">{item.category}</span>
          <span className="eq-badge-qty">{item.quantity}</span>
        </div>
      </div>

      {/* Card Content */}
      <div className="eq-card-body">
        <div className="eq-card-price-row">
          <div className="eq-price-tag">
            <LuTag className="eq-price-icon" />
            <span className="eq-price-val">{item.priceDisplay}</span>
          </div>
          {item.backupCovered && tierId >= 2 && (
            <span className="eq-backup-pill" title="Protected under 48-Hour Battery Backup">
              48h Backup
            </span>
          )}
        </div>

        <h3 className="eq-card-title">{item.name}</h3>
        <p className="eq-card-desc">{item.shortDescription}</p>

        {/* Available Market Brands */}
        <div className="eq-card-brands">
          <span className="eq-brands-label">Brands:</span>
          <div className="eq-brands-list">
            {item.brands.slice(0, 4).map((brand) => (
              <span key={brand} className="eq-brand-chip">
                {brand}
              </span>
            ))}
            {item.brands.length > 4 && (
              <span className="eq-brand-chip more">+{item.brands.length - 4} more</span>
            )}
          </div>
        </div>

        {/* Key Features preview */}
        <ul className="eq-features-preview">
          {item.keyFeatures.slice(0, 3).map((feat, idx) => (
            <li key={idx}>
              <LuSparkles className="eq-feat-icon" />
              <span>{feat}</span>
            </li>
          ))}
        </ul>

        {/* Hover Action Prompt */}
        <div className="eq-card-hover-action">
          <span>Explore specifications &amp; brands</span>
          <LuChevronRight />
        </div>
      </div>
    </div>
  );
}
