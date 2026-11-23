// One scorecard for every run (Gate cheats, Threat coverage, Edge resilience, Site runs). It answers, in order:
//   1. Correct against ground truth: how often did the GB do the right thing, out of everything judged?
//   2. Cheats: how many did it catch (recall), and when it flags, is it really a cheat (precision)? F1.
//   3. Honest: does it leave honest trucks alone (recall), and is what it passes really honest (precision)? F1.
//   then what it cost (trips / tonnes missed) and the detail by threat area.
import type { ReactNode } from "react";

/** How the GB handled one item: covered (as it should), partial, gap (noticed, not enough), silent (no idea),
 * period (only a period check, e.g. the weekly survey, can judge it). */
export type Status = "covered" | "partial" | "gap" | "silent" | "period";

/** One judged item: a scenario story, an edge case, or one cheat attempt in a site run. */
export type ScoreItem = {
  id: string;
  name: string;
  area: string; // threat area key (AREAS)
  status: Status;
  cls: "cheat" | "honest" | "other"; // other = officer / edge cases: counted in "correct" only
  priority?: string | null;
  how?: string; // e.g. "stopped" / "caught after" for covered site attempts
};

/** Honest cases counted outside the items (site runs: honest gate events, not stories). */
export type HonestCount = { total: number; flagged: number; unit: string };

export type Cost = {
  trips?: { missed: number; of: number };
  tonnes?: { missed: number; of: number };
};

/** The previous run of the same suite / scenario, to show before -> after. */
export type Before = { label: string; items: ScoreItem[]; cost: Cost; honest?: HonestCount | null };

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
  period: "Period-level",
};
const RANK: Record<Status, number> = { covered: 0, period: 0, partial: 1, gap: 2, silent: 3 };

export function StatusBadge({ s }: { s?: Status | null }) {
  const cls = s === "covered" ? "ok" : s === "partial" ? "warn" : s === "period" ? "neutral" : s ? "bad" : "neutral";
  return <span className={`badge ${cls}`}>{s ? STATUS_TEXT[s] : "—"}</span>;
}

// ---------------------------------------------------------------- the numbers
type Scores = {
  correct: number;
  judged: number;
  cheats: number;
  caught: number; // flagged: covered, partial or gap
  fully: number; // covered
  missed: number; // silent
  period: number;
  honest: number;
  honestFlagged: number;
  cheatP: number | null;
  cheatR: number | null;
  cheatF1: number | null;
  honestP: number | null;
  honestR: number | null;
  honestF1: number | null;
};

const ratio = (a: number, b: number) => (b ? a / b : null);
const f1 = (p: number | null, r: number | null) => (p == null || r == null ? null : p + r ? (2 * p * r) / (p + r) : 0);

export function scores(items: ScoreItem[], honestCount?: HonestCount | null): Scores {
  const cheats = items.filter((i) => i.cls === "cheat" && i.status !== "period");
  const period = items.filter((i) => i.status === "period").length;
  const caught = cheats.filter((i) => i.status !== "silent").length;
  const fully = cheats.filter((i) => i.status === "covered").length;
  const missed = cheats.length - caught;
  const honestItems = items.filter((i) => i.cls === "honest");
  const honest = honestCount ? honestCount.total : honestItems.length;
  const honestFlagged = honestCount ? honestCount.flagged : honestItems.filter((i) => i.status !== "covered").length;
  const other = items.filter((i) => i.cls === "other");
  const tp = caught, fn = missed, fp = honestFlagged, tn = honest - honestFlagged;
  const cheatP = ratio(tp, tp + fp), cheatR = ratio(tp, tp + fn);
  const honestP = ratio(tn, tn + fn), honestR = ratio(tn, tn + fp);
  return {
    correct: fully + tn + other.filter((i) => i.status === "covered").length,
    judged: cheats.length + honest + other.length,
    cheats: cheats.length, caught, fully, missed, period, honest, honestFlagged,
    cheatP, cheatR, cheatF1: f1(cheatP, cheatR), honestP, honestR, honestF1: f1(honestP, honestR),
  };
}

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x: number) => Math.round(x).toLocaleString("en-IN");

function Was({ was, now, lowerIsBetter, asPct }: { was: number | null | undefined; now: number | null; lowerIsBetter?: boolean;
  asPct?: boolean }) {
  if (was == null || now == null) return null;
  const same = asPct ? Math.abs(was - now) < 0.0005 : Math.round(was) === Math.round(now);
  if (same) return <span className="sc-was">same as before</span>;
  const better = lowerIsBetter ? now < was : now > was;
  return <span className={`sc-was ${better ? "ok-text" : "bad-text"}`}>was {asPct ? pct(was) : num(was)}</span>;
}

function Metric({ label, value, was, help }: { label: string; value: number | null; was?: number | null; help: string }) {
  return (
    <div className="sc-metric" title={help}>
      <div className="sc-metric-val">{pct(value)}</div>
      <div className="sc-metric-label">{label}</div>
      <Was was={was} now={value} asPct />
    </div>
  );
}

function Tile({ label, value, total, tone, sub, onClick }: { label: string; value: number; total?: number;
  tone?: "ok" | "warn" | "bad"; sub?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`stat${onClick ? " sr-tile-click" : ""}`} onClick={onClick} role={onClick ? "button" : undefined}
         title={onClick ? "Show the list behind this number" : undefined}>
      <div className={`stat-num ${tone ? `${tone}-text` : ""}`}>
        {num(value)}
        {total != null && <span className="muted stat-of">/{num(total)}</span>}
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
  honest,
  onStatus,
  onCost,
  before,
}: {
  judgedAgainst: string;
  items: ScoreItem[];
  unit: string; // "stories", "cases", "attempts"
  cost: Cost;
  honest?: HonestCount | null; // site runs: honest gate events instead of honest items
  onStatus?: (s: Status) => void;
  onCost?: (k: "trips" | "tonnes" | "honest") => void;
  before?: Before | null;
}) {
  const sc = scores(items, honest);
  const was = before ? scores(before.items, before.honest) : null;
  const honestUnit = honest?.unit ?? "honest stories";
  const count = (s: Status) => items.filter((i) => i.status === s).length;
  const hows = items.filter((i) => i.status === "covered" && i.how).reduce<Record<string, number>>((a, i) => {
    a[i.how as string] = (a[i.how as string] ?? 0) + 1;
    return a;
  }, {});
  const priorities = ["P0", "P1", "extra"]
    .map((p) => {
      const rs = items.filter((i) => i.priority === p && i.status !== "period");
      return rs.length ? `${p}: ${rs.filter((i) => i.status === "covered").length} of ${rs.length} covered` : null;
    })
    .filter(Boolean)
    .join(" · ");
  const click = (s: Status) => (onStatus ? () => onStatus(s) : undefined);

  return (
    <>
      <p className="sc-judged">{judgedAgainst}</p>
      {before && <p className="small muted sc-before">Compared with {before.label}: green = better than before, red = worse.</p>}

      {/* 1. correct against ground truth */}
      <div className="card sc-overall">
        <div className="sc-overall-num">
          {num(sc.correct)}<span className="muted"> of {num(sc.judged)}</span>
          <span className="sc-overall-pct">{pct(ratio(sc.correct, sc.judged))}</span>
        </div>
        <div className="sc-overall-label">
          <strong>Correct against ground truth</strong>: cheats fully handled, honest cases passed clean
          {items.some((i) => i.cls === "other") ? ", officer and edge cases as specified" : ""}.
          <Was was={was ? ratio(was.correct, was.judged) : null} now={ratio(sc.correct, sc.judged)} asPct />
        </div>
      </div>

      {/* 2. cheats and 3. honest */}
      <div className="sc-classes">
        {sc.cheats > 0 && (
          <div className="card sc-class">
            <header className="card-head"><h3>Cheats</h3><span className="muted small">{num(sc.cheats)} {unit === "attempts" ? "attempts" : "cheat stories"}</span></header>
            <div className="sc-class-line">
              <span className="sr-tile-click" onClick={click("covered")}><strong className="ok-text">{num(sc.fully)}</strong> fully handled</span>
              <span className="sr-tile-click" onClick={click("gap")}><strong className="warn-text">{num(sc.caught - sc.fully)}</strong> flagged only</span>
              <span className="sr-tile-click" onClick={click("silent")}><strong className={sc.missed ? "bad-text" : ""}>{num(sc.missed)}</strong> missed silently</span>
            </div>
            <div className="sc-metrics">
              <Metric label="Recall: cheats caught" value={sc.cheatR} was={was?.cheatR}
                      help="Caught (flagged at all) / all cheats. How many cheats we catch." />
              <Metric label="Precision: flags that were cheats" value={sc.cheatP} was={was?.cheatP}
                      help="Caught / everything flagged (cheats caught + honest wrongly flagged)." />
              <Metric label="F1" value={sc.cheatF1} was={was?.cheatF1} help="Harmonic mean of precision and recall." />
            </div>
            {Object.keys(hows).length > 0 && (
              <div className="small muted">Fully handled: {Object.entries(hows).map(([h, k]) => `${k} ${h}`).join(", ")}</div>
            )}
          </div>
        )}
        {sc.honest > 0 && (
          <div className="card sc-class">
            <header className="card-head"><h3>Honest</h3><span className="muted small">{num(sc.honest)} {honestUnit}</span></header>
            <div className="sc-class-line">
              <span><strong className="ok-text">{num(sc.honest - sc.honestFlagged)}</strong> passed clean</span>
              <span className={onCost ? "sr-tile-click" : ""} onClick={onCost ? () => onCost("honest") : undefined}>
                <strong className={sc.honestFlagged ? "bad-text" : ""}>{num(sc.honestFlagged)}</strong> wrongly flagged
              </span>
            </div>
            <div className="sc-metrics">
              <Metric label="Recall: honest left alone" value={sc.honestR} was={was?.honestR}
                      help="Passed clean / all honest cases. Do we leave honest trucks alone?" />
              <Metric label="Precision: passes that were honest" value={sc.honestP} was={was?.honestP}
                      help="Honest passed clean / everything passed clean (honest + cheats missed silently)." />
              <Metric label="F1" value={sc.honestF1} was={was?.honestF1} help="Harmonic mean of precision and recall." />
            </div>
          </div>
        )}
      </div>

      {/* what it cost */}
      {(cost.trips || cost.tonnes) && (
        <div className="stats stats-3">
          {cost.trips && (
            <Tile label="Trips the GB missed" value={cost.trips.missed} total={cost.trips.of}
                  sub={<><div>of what really moved</div><Was was={before?.cost.trips?.missed} now={cost.trips.missed} lowerIsBetter /></>}
                  tone={cost.trips.missed ? "bad" : "ok"} onClick={onCost ? () => onCost("trips") : undefined} />
          )}
          {cost.tonnes && (
            <Tile label="Tonnes the GB missed" value={cost.tonnes.missed} total={cost.tonnes.of}
                  sub={<><div>of what really moved</div><Was was={before?.cost.tonnes?.missed} now={cost.tonnes.missed} lowerIsBetter /></>}
                  tone={cost.tonnes.missed >= 1 ? "bad" : "ok"} onClick={onCost ? () => onCost("tonnes") : undefined} />
          )}
        </div>
      )}

      {/* detail: by threat area, with the status breakdown */}
      <div className="card">
        <header className="card-head">
          <h3>By threat area</h3>
          <span className="muted small">{items.length} {unit}</span>
        </header>
        <div className="sc-status-line small">
          {(["covered", "partial", "gap", "silent", "period"] as Status[]).filter((s) => count(s) > 0 || s !== "period").map((s) => (
            <span key={s} className={onStatus ? "sr-tile-click" : ""} onClick={click(s)}>
              <StatusBadge s={s} /> {count(s)}
            </span>
          ))}
          {priorities && <span className="muted">· {priorities}</span>}
        </div>
        {count("period") > 0 && (
          <p className="small muted">
            Period-level: a single trip is far below what a volume survey can measure, so these are judged by the weekly
            survey in the site runs, not here.
          </p>
        )}
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
