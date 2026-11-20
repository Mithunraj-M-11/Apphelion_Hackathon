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
