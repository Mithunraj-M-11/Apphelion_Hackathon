// One scorecard for every run (Gate cheats, Threat coverage, Edge resilience, Site runs). It answers the same three
// questions everywhere: what works, what doesn't (and does the GB at least know), and what it cost.
import type { ReactNode } from "react";

export type Status = "covered" | "partial" | "gap" | "silent";

/** One judged item: a scenario story, an edge case, or one attempt in a site run. */
export type ScoreItem = {
  id: string;
  name: string;
  area: string; // threat area key (AREAS)
  status: Status;
  priority?: string | null;
  how?: string; // e.g. "stopped" / "caught after" for covered site attempts
};

export type Cost = {
  trips?: { missed: number; of: number };
  tonnes?: { missed: number; of: number };
  honest?: { refused: number; of: number; label: string }; // honest trucks / events the GB wrongly refused or flagged
};

/** The threat areas, the same on every page. */
export const AREAS: { key: string; title: string }[] = [
  { key: "identity", title: "Vehicle identity" },
  { key: "sticker", title: "GB RFID sticker" },
  { key: "pass", title: "Pass misuse" },
  { key: "measure", title: "Weight and load" },
  { key: "limits", title: "Contract limits" },
  { key: "evasion", title: "Bypass and force" },
  { key: "infrastructure", title: "Poles, network, sensors" },
  { key: "records", title: "Records and reports" },
  { key: "officer", title: "Officer actions" },
  { key: "edge", title: "Edge resilience" },
  { key: "control", title: "Honest controls" },
];

export const STATUS_TEXT: Record<Status, string> = {
  covered: "Covered",
  partial: "Partial",
  gap: "Gap",
  silent: "Silent gap",
};
const RANK: Record<Status, number> = { covered: 0, partial: 1, gap: 2, silent: 3 };

export function StatusBadge({ s }: { s?: Status | null }) {
  const cls = s === "covered" ? "ok" : s === "partial" ? "warn" : s ? "bad" : "neutral";
  return <span className={`badge ${cls}`}>{s ? STATUS_TEXT[s] : "—"}</span>;
}

function Tile({ label, value, total, tone, sub, onClick }: { label: string; value: number; total?: number;
  tone?: "ok" | "warn" | "bad"; sub?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`stat${onClick ? " sr-tile-click" : ""}`} onClick={onClick} role={onClick ? "button" : undefined}
         title={onClick ? "Show the list behind this number" : undefined}>
      <div className={`stat-num ${tone ? `${tone}-text` : ""}`}>
        {value.toLocaleString("en-IN")}
        {total != null && <span className="muted stat-of">/{total.toLocaleString("en-IN")}</span>}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

export function Scorecard({
  judgedAgainst,
  items,
  unit,
  cost,
  onStatus,
  onCost,
}: {
  judgedAgainst: string;
  items: ScoreItem[];
  unit: string; // "stories", "cases", "attempts"
  cost: Cost;
  onStatus?: (s: Status) => void;
  onCost?: (k: "trips" | "tonnes" | "honest") => void;
}) {
  const n = items.length;
  const count = (s: Status) => items.filter((i) => i.status === s).length;
  const hows = items.filter((i) => i.status === "covered" && i.how).reduce<Record<string, number>>((a, i) => {
    a[i.how as string] = (a[i.how as string] ?? 0) + 1;
    return a;
  }, {});
  const howText = Object.entries(hows).map(([h, k]) => `${k} ${h}`).join(", ");
  const priorities = ["P0", "P1", "extra"]
    .map((p) => {
      const rs = items.filter((i) => i.priority === p);
      return rs.length ? `${p}: ${rs.filter((i) => i.status === "covered").length} of ${rs.length} covered` : null;
    })
    .filter(Boolean)
    .join(" · ");
  const click = (s: Status) => (onStatus ? () => onStatus(s) : undefined);
  const costClick = (k: "trips" | "tonnes" | "honest") => (onCost ? () => onCost(k) : undefined);

  return (
    <>
      <p className="sc-judged">{judgedAgainst}</p>
      <div className="stats stats-4">
        <Tile label="Covered" value={count("covered")} total={n} tone="ok" sub={howText || undefined} onClick={click("covered")} />
        <Tile label="Partial" value={count("partial")} total={n} tone={count("partial") ? "warn" : undefined} onClick={click("partial")} />
        <Tile label="Gap" value={count("gap")} total={n} tone={count("gap") ? "bad" : undefined} onClick={click("gap")} />
        <Tile label="Silent gap" value={count("silent")} total={n} tone={count("silent") ? "bad" : undefined}
              sub="the GB doesn't know" onClick={click("silent")} />
      </div>
      {(cost.trips || cost.tonnes || cost.honest) && (
        <div className="stats stats-3">
          {cost.trips && (
            <Tile label="Trips the GB missed" value={cost.trips.missed} total={cost.trips.of} sub="of what really moved"
                  tone={cost.trips.missed ? "bad" : "ok"} onClick={costClick("trips")} />
          )}
          {cost.tonnes && (
            <Tile label="Tonnes the GB missed" value={Math.round(cost.tonnes.missed)} total={Math.round(cost.tonnes.of)}
                  sub="of what really moved" tone={cost.tonnes.missed >= 1 ? "bad" : "ok"} onClick={costClick("tonnes")} />
          )}
          {cost.honest && (
            <Tile label={cost.honest.label} value={cost.honest.refused} total={cost.honest.of}
                  tone={cost.honest.refused ? "bad" : "ok"} onClick={costClick("honest")} />
          )}
        </div>
      )}
      {priorities && <p className="sc-line"><strong>{priorities}</strong></p>}
      <div className="card">
        <header className="card-head"><h3>By threat area</h3><span className="muted small">{n} {unit}</span></header>
        <div className="sr-cats">
          {AREAS.map((a) => {
            const rs = items.filter((i) => i.area === a.key);
            if (rs.length === 0) return null;
            const covered = rs.filter((i) => i.status === "covered").length;
            const worst = rs.reduce((w, i) => Math.max(w, RANK[i.status]), 0);
            const open = rs.filter((i) => i.status !== "covered").sort((x, y) => RANK[y.status] - RANK[x.status]);
            return (
              <div key={a.key} className={`sr-cat ${worst === 0 ? "ok" : worst === 1 ? "warn" : "bad"}`}>
                <div className="sr-cat-title">{a.title}</div>
                <div className="sr-cat-num">{covered}<span className="muted">/{rs.length}</span></div>
                <div className="small muted">covered</div>
                {open.length > 0 && (
                  <div className="sr-cat-open small">
                    {open.slice(0, 4).map((i) => (
                      <div key={i.id}><strong>{STATUS_TEXT[i.status]}</strong>: {i.name}</div>
                    ))}
                    {open.length > 4 && <div className="muted">and {open.length - 4} more</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
