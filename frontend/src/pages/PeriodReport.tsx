// GB period report for one permit: what the GB recorded over the period, for the officers who act on it. Only the GB's
// own records (gates, passes, alerts, holds, the Vendor's reports, surveys, officer actions); never simulation ground
// truth. Print / save as PDF from the browser.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LuArrowLeft, LuPrinter } from "react-icons/lu";
import { gateApi, type PeriodReport as Report, type ReportAlertRow } from "../api";
import { ErrorNote, SeverityBadge } from "../components";

const fmt = (x: number | null | undefined, digits = 0) =>
  x == null ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card pr-section">
      <header className="card-head"><h3>{title}</h3>{sub && <span className="muted small">{sub}</span>}</header>
      {children}
    </section>
  );
}

function AlertRows({ rows, withCount }: { rows: ReportAlertRow[]; withCount?: boolean }) {
  return (
    <table className="table table-inner">
      <thead>
        <tr><th>Severity</th><th>Alert</th>{withCount && <th>Open</th>}<th>When</th><th>What</th></tr>
      </thead>
      <tbody>
        {rows.map((a, i) => (
          <tr key={i}>
            <td><SeverityBadge severity={a.severity} /></td>
            <td className="mono small">{a.code}</td>
            {withCount && <td>{a.count}</td>}
            <td className="nowrap small">{a.when ?? "—"}</td>
            <td className="small">{a.message}{a.officer ? ` (officer ${a.officer})` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PeriodReport() {
  const { permitId } = useParams();
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gateApi.permitReport(Number(permitId)).then(setR).catch((e) => setError(e.message));
  }, [permitId]);
  if (error) return <ErrorNote error={error} />;
  if (!r) return <p className="muted">Loading…</p>;
  const t = r.totals, v = r.vendor, na = r.needs_action;
  const nothingOpen = na.alerts.length === 0 && na.unresolved.length === 0 && na.holds.length === 0;

  return (
    <div className="pr">
      <div className="pr-toolbar no-print">
        <button className="btn back-link" onClick={() => history.back()}><LuArrowLeft /> Back</button>
        <button className="btn primary" onClick={() => window.print()}><LuPrinter /> Print / save as PDF</button>
      </div>

      <header className="pr-head">
        <div className="pr-eyebrow">SiteWatch · GB period report</div>
        <h1>{r.permit.label}</h1>
        <p className="muted">
          {day(r.period.from)} to {day(r.period.to)} ({r.period.days} days) · permit {fmt(r.permit.trip_limit)} trips,{" "}
          {fmt(r.permit.tonne_limit)} t, {r.permit.vehicle_limit} vehicles, hours {r.permit.hours} · generated{" "}
          {r.generated_at}
        </p>
        <p className="small muted">
          From the GB's own records only: its gates, passes, alerts, the Vendor's daily reports and the GB's surveys.
        </p>
      </header>

      <div className="pr-tiles">
        <div className="card pr-tile">
          <div className="pr-tile-label">Permit allows</div>
          <div className="pr-tile-num">{fmt(r.permit.trip_limit)}</div>
          <div className="small muted">trips · {fmt(r.permit.tonne_limit)} t</div>
        </div>
        <div className="card pr-tile">
          <div className="pr-tile-label">Counted at GB gates</div>
          <div className="pr-tile-num">{fmt(t.trips_counted)}</div>
          <div className="small muted">trips · {fmt(t.tonnes_counted)} t · {pct(t.trips_counted, r.permit.trip_limit)} of the permit</div>
        </div>
        <div className="card pr-tile">
          <div className="pr-tile-label">Without a pass</div>
          <div className={`pr-tile-num ${t.trips_without_pass ? "bad-text" : ""}`}>{fmt(t.trips_without_pass)}</div>
          <div className="small muted">trips forced the barrier · about {fmt(t.tonnes_without_pass_est)} t</div>
        </div>
        <div className="card pr-tile">
          <div className="pr-tile-label">Vendor says</div>
          <div className={`pr-tile-num ${v.trips < v.gb_trips_same_days ? "warn-text" : ""}`}>{fmt(v.trips)}</div>
          <div className="small muted">trips · {fmt(v.tonnes)} t · {v.days_reported} daily reports</div>
        </div>
      </div>

      <Section title="Findings" sub="most serious first">
        <ul className="pr-findings">
          {r.findings.map((f, i) => (
            <li key={i}><SeverityBadge severity={f.severity} /> <span>{f.text}</span></li>
          ))}
        </ul>
      </Section>

      <Section title="Needs an officer" sub="open items">
        {nothingOpen ? <p className="small">Nothing open.</p> : (
          <>
            {na.alerts.length > 0 && <AlertRows rows={na.alerts} withCount />}
            {na.unresolved.length > 0 && (
              <p className="small pr-gap">
                <strong>Unresolved trips</strong> (expired without an exit; the truck is blocked until an officer resolves
                it): {na.unresolved.map((u) => `${u.trip_code} (${u.plate}, expired ${u.expired})`).join("; ")}
              </p>
            )}
            {na.holds.length > 0 && (
              <p className="small pr-gap">
                <strong>Trucks on hold</strong>: {na.holds.map((h) => `${h.plate} (${h.reason})`).join("; ")}
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Day by day" sub="GB gates against the Vendor's daily report">
        <table className="table table-inner pr-num">
          <thead>
            <tr>
              <th>Day</th><th>Entries</th><th>Refused</th><th>Counted at gates</th><th>With a pass</th>
              <th>Without a pass</th><th>Tonnes (pad)</th><th>Vendor trips</th><th>Vendor tonnes</th>
            </tr>
          </thead>
          <tbody>
            {r.daily.map((d) => (
              <tr key={d.day}>
                <td className="nowrap">{day(d.day)}</td>
                <td>{d.entries}</td>
                <td>{d.entry_refusals + d.exit_refusals}</td>
                <td><strong>{d.actual_trips}</strong></td>
                <td>{d.legal_trips}</td>
                <td className={d.illegal_trips ? "bad-text" : ""}>{d.illegal_trips}</td>
                <td>{fmt(d.tonnes, 1)}</td>
                <td className={d.vendor_trips != null && d.vendor_trips < d.actual_trips ? "warn-text" : ""}>{d.vendor_trips ?? "—"}</td>
                <td>{fmt(d.vendor_tonnes, 1)}</td>
              </tr>
            ))}
            <tr className="pr-total">
              <td>Total</td>
              <td>{r.daily.reduce((n, d) => n + d.entries, 0)}</td>
              <td>{r.daily.reduce((n, d) => n + d.entry_refusals + d.exit_refusals, 0)}</td>
              <td>{t.trips_counted}</td>
              <td>{r.daily.reduce((n, d) => n + d.legal_trips, 0)}</td>
              <td>{t.trips_without_pass}</td>
              <td>{fmt(t.tonnes_with_pass, 1)}</td>
              <td>{v.trips}</td>
              <td>{fmt(v.tonnes, 1)}</td>
            </tr>
          </tbody>
        </table>
        <p className="small muted pr-gap">
          Tonnes are the weigh pad's net tonnes on trips that closed a pass ({fmt(t.late_closes_charged)} late-closed trips
          charged at the truck's rated load). Trips without a pass add about {fmt(t.tonnes_without_pass_est)} t (exit
          weight minus the truck's enrolled empty weight).
        </p>
      </Section>

      {r.surveys.rows.length > 0 && (
        <Section title="Weekly volume surveys" sub="ore that left by the survey against what the gates weighed">
          <table className="table table-inner pr-num">
            <thead><tr><th>Week</th><th>Method</th><th>Left by the survey</th><th>Weighed by the gates</th><th>Gap</th></tr></thead>
            <tbody>
              {r.surveys.rows.map((s) => (
                <tr key={s.period_from}>
                  <td className="nowrap">{day(s.period_from)} to {day(s.period_to)}</td>
                  <td className="small">{s.status === "rejected" ? "rejected (fly again)" : s.method.replace(/_/g, " ")}</td>
                  <td>{fmt(s.surveyed_out_t)} t</td>
                  <td>{fmt(s.gates_out_t)} t</td>
                  <td className={s.gap_pct != null && s.gap_pct > 5 ? "bad-text" : ""}>
                    {s.gap_pct != null ? `${s.gap_pct > 0 ? "+" : ""}${s.gap_pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
              {r.surveys.total && (
                <tr className="pr-total">
                  <td>Since the first survey</td><td />
                  <td>{fmt(r.surveys.total.surveyed_out_t)} t</td>
                  <td>{fmt(r.surveys.total.gates_out_t)} t</td>
                  <td className={r.surveys.total.gap_t > 0 ? "bad-text" : ""}>{fmt(r.surveys.total.gap_t)} t ({r.surveys.total.gap_pct}%)</td>
                </tr>
              )}
            </tbody>
          </table>
          {r.surveys.alerts.length > 0 && <p className="small pr-gap">Raised: <span className="mono">{r.surveys.alerts.join(", ")}</span></p>}
        </Section>
      )}

      <Section title="GB equipment" sub={`${r.equipment.pole_outages} pole outages, about ${r.equipment.outage_minutes} min`}>
        {r.equipment.items.length === 0 ? <p className="small">No equipment problem recorded.</p> : (
          <>
            <p className="small">
              {Object.entries(r.equipment.counts).map(([c, n]) => <span key={c} className="pr-chip"><span className="mono">{c}</span> {n}</span>)}
            </p>
            <AlertRows rows={r.equipment.items} />
          </>
        )}
      </Section>

      <Section title="Officer actions" sub="overrides need a written reason and are counted per officer">
        {r.officers.length === 0 ? <p className="small">No officer overrides.</p> : (
          <table className="table table-inner pr-num">
            <thead><tr><th>Officer</th><th>Let out at exit</th><th>Late closes</th><th>Late closes unsupported</th><th>Pattern alerts</th></tr></thead>
            <tbody>
              {r.officers.map((o) => (
                <tr key={o.officer}>
                  <td>{o.officer}</td>
                  <td>{o.OFFICER_EXIT ?? 0}</td>
                  <td>{o.OFFICER_LATE_CLOSE ?? 0}</td>
                  <td className={o.LATE_CLOSE_UNSUPPORTED ? "bad-text" : ""}>{o.LATE_CLOSE_UNSUPPORTED ?? 0}</td>
                  <td className={o.OFFICER_OVERRIDE_PATTERN ? "bad-text" : ""}>{o.OFFICER_OVERRIDE_PATTERN ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Record integrity">
        <p className="small">
          {fmt(r.integrity.chained_events)} gate events are sealed in the hash chain.{" "}
          {r.integrity.failed_checks.length === 0
            ? "No record check has found an edited or deleted event."
            : `${r.integrity.failed_checks.length} record checks found edited or deleted events:`}
        </p>
        {r.integrity.failed_checks.length > 0 && <AlertRows rows={r.integrity.failed_checks} />}
      </Section>

      <Section title="All alerts in the period" sub={Object.entries(r.alerts_by_severity).map(([s, n]) => `${s.toLowerCase()} ${n}`).join(" · ")}>
        <p className="small">
          {Object.entries(r.alerts_by_code).map(([c, n]) => <span key={c} className="pr-chip"><span className="mono">{c}</span> {n}</span>)}
        </p>
      </Section>
    </div>
  );
}
