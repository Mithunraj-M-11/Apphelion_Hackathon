// A story as a timeline, shared by Scenario runs and Site runs: gate events (seen by the GB, open into the full gate
// event), officer actions, and the legs the GB cannot see (greyed). Scenario stories also show expected vs actual.
import { useState } from "react";
import { gateApi } from "../api";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { Movement } from "../api";
import { MovementDetail } from "./GateEvents";

export type TimelineStep = {
  at: string;
  kind: "gate" | "officer" | "unseen";
  text: string;
  movement?: number | null;
  alerts?: string[];
  expected?: string; // scenario stories: what this step should produce
  pass?: boolean; // scenario stories: did it?
};

export function StoryTimeline({ steps, movements }: { steps: TimelineStep[]; movements: Record<number, Movement> }) {
  const [open, setOpen] = useState<number | null>(null);
  const [fetched, setFetched] = useState<Record<number, Movement | "missing">>({});
  const toggle = (id: number) => {
    setOpen(open === id ? null : id);
    if (!movements[id] && !fetched[id]) {  // not in the run's preloaded list (it is capped): fetch this one event
      gateApi.movement(id)
        .then((m) => setFetched((f) => ({ ...f, [id]: m })))
        .catch(() => setFetched((f) => ({ ...f, [id]: "missing" })));
    }
  };
  if (steps.length === 0) return <p className="muted small">No gate event for this story.</p>;
  return (
    <ol className="sr-timeline">
      {steps.map((st, k) => {
        const id = st.movement ?? null;
        return (
          <li key={k} className={st.kind === "unseen" ? "unseen" : st.kind === "officer" ? "officer" : "seen"}>
            <div className={`sr-tl-row${id ? " clickable" : ""}`} onClick={() => id && toggle(id)}>
              <span className="sr-tl-time">{st.at}</span>
              <span className="sr-tl-text">{st.text}</span>
              {st.kind === "unseen" ? (
                <span className="sr-tl-unseen">not seen by the GB</span>
              ) : (
                st.alerts && st.alerts.length > 0 && <span className="small mono sr-tl-alerts">{st.alerts.join(", ")}</span>
              )}
              {id ? (open === id ? <LuChevronDown /> : <LuChevronRight />) : null}
            </div>
            {st.expected && (
              <div className="sr-tl-expect small">
                <span className={st.pass ? "pass-tag" : "fail-tag"}>{st.pass ? "As expected" : "Not as expected"}</span>{" "}
                <span className="muted">expected: {st.expected}</span>
              </div>
            )}
            {id && open === id && (
              <div className="sr-event">
                {(() => {
                  const m = (movements[id] as Movement | undefined) ?? fetched[id];
                  if (m && m !== "missing") return <MovementDetail m={m} />;
                  return <p className="muted small">{m === "missing" ? `Gate event #${id} no longer exists.` : "Loading…"}</p>;
                })()}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
