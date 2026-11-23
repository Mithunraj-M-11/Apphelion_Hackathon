import type { ReactNode } from "react";
import type { Authorisation, Check } from "./api";
import { CHECK_LABEL, daysUntil, formatDate, RESULT_LABEL, STATUS_LABEL } from "./format";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function AuthBadge({ auth }: { auth: Authorisation }) {
  return auth.authorised ? (
    <span className="badge ok">Authorised</span>
  ) : (
    <span className="badge bad" title={auth.reasons.join("\n")}>
      Not authorised
    </span>
  );
}

/** Document expiry with colour: expired (red), under 30 days (amber), fine (green). */
export function Expiry({ date }: { date: string | null }) {
  const days = daysUntil(date);
  const cls = days == null ? "muted" : days < 0 ? "bad-text" : days < 30 ? "warn-text" : "ok-text";
  const note = days == null ? "missing" : days < 0 ? `expired ${-days} d ago` : days < 30 ? `${days} d left` : "valid";
  return (
    <span className={cls}>
      {formatDate(date)} <small>({note})</small>
    </span>
  );
}

export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={mono ? "field-value mono" : "field-value"}>{children ?? "—"}</div>
    </div>
  );
}

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="error-note">{error}</div> : null;
}

export function ResultBadge({ result }: { result: string }) {
  const cls =
    result === "AUTHORISED" ? "ok" : result === "NOT_AUTHORISED" || result === "UNIDENTIFIED" ? "warn" : "bad";
  return <span className={`badge ${cls}`}>{RESULT_LABEL[result] ?? result}</span>;
}

/** Every Identify check with its status and reason. */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.name} className={`check check-${c.status}`}>
          <span className="check-name">{CHECK_LABEL[c.name] ?? c.name}</span>
          <span className="check-status">{c.status.replace("_", " ")}</span>
          <span className="check-detail">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

const SEVERITY_CLASS: Record<string, string> = { INFO: "neutral", MEDIUM: "warn", HIGH: "bad", CRITICAL: "crit" };

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`badge ${SEVERITY_CLASS[severity] ?? "neutral"}`}>{severity.toLowerCase()}</span>;
}

export function BarrierBadge({ barrier, forced }: { barrier: string | null; forced?: boolean }) {
  if (!barrier) return <span className="muted">—</span>;
  return (
    <span className={`badge ${barrier === "up" ? "ok" : "bad"}`}>
      Barrier {barrier}{forced ? ", forced" : ""}
    </span>
  );
}

export function TripBadge({ trip }: { trip: string | null }) {
  if (!trip) return null;
  return <span className={`badge ${trip === "LEGAL" ? "ok" : "crit"}`}>{trip === "LEGAL" ? "Legal trip" : "Illegal trip"}</span>;
}

/** Alerts raised by a gate event, most severe first. */
export function AlertList({ alerts }: { alerts: { code: string; severity: string; message: string }[] }) {
  if (alerts.length === 0) return <span className="muted small">No alerts</span>;
  const order = ["CRITICAL", "HIGH", "MEDIUM", "INFO"];
  const sorted = [...alerts].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <ul className="alert-list">
      {sorted.map((a, i) => (
        <li key={`${a.code}-${i}`}>
          <SeverityBadge severity={a.severity} /> <strong className="mono small">{a.code}</strong>
          <span className="small muted"> {a.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Steps of the trip pipeline (Identify, Eligibility / Pass check, Measure, Pass / Compare, Barrier). */
export function StepList({ steps }: { steps: { name: string; status: string; items: { label: string; status: string; detail: string }[] }[] }) {
  return (
    <div className="step-list">
      {steps.map((s) => (
        <div key={s.name} className="step-block">
          <div className={`step-name step-${s.status}`}>
            {s.name === "Identify" ? "Identify: identity" : s.name === "Body" ? "Identify: body" : s.name}
          </div>
          <ul className="checks">
            {s.items.map((c, i) => (
              <li key={`${c.label}-${i}`} className={`check check-${c.status}`}>
                <span className="check-name">{c.label}</span>
                <span className="check-status">{c.status}</span>
                <span className="check-detail">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
