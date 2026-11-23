import { useEffect, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import type { EquipmentItem } from "../../data/equipmentCatalogue";
import { EquipmentCard } from "./EquipmentCard";

interface EquipmentRowProps {
  items: EquipmentItem[];
  tierId: number;
  onSelect: (item: EquipmentItem) => void;
}

export function EquipmentRow({ items, tierId, onSelect }: EquipmentRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;

    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);

    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [items]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = Math.max(340, el.clientWidth * 0.75);
    el.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  return (
    <div className="eq-row-container">
      {/* Left Navigation Button */}
      <button
        type="button"
        className={`eq-nav-btn left ${canScrollLeft ? "visible" : "hidden"}`}
        onClick={() => scroll("left")}
        disabled={!canScrollLeft}
        aria-label="Scroll equipment row left"
        title="Scroll left"
      >
        <LuChevronLeft />
      </button>

      {/* Horizontally scrollable row */}
      <div className="eq-scroll-track" ref={scrollRef}>
        {items.map((item) => (
          <div key={`${tierId}-${item.id}`} className="eq-slide">
            <EquipmentCard item={item} tierId={tierId} onSelect={onSelect} />
          </div>
        ))}
      </div>

      {/* Right Navigation Button */}
      <button
        type="button"
        className={`eq-nav-btn right ${canScrollRight ? "visible" : "hidden"}`}
        onClick={() => scroll("right")}
        disabled={!canScrollRight}
        aria-label="Scroll equipment row right"
        title="Scroll right"
      >
        <LuChevronRight />
      </button>
    </div>
  );
}
