// "Equipment & records" in the Gate console: attacks on the GB's own equipment and records, acted out live for the
// session's own permit, and the GB checks that catch them (pole heartbeat, pole signatures, reference weight test,
// hash chain). Each result shows the alert it raised; the live log below the console shows the same.
import { useState } from "react";
import { LuDatabase, LuPlugZap, LuScale, LuShieldAlert, LuShieldCheck, LuWifiOff } from "react-icons/lu";
import { ApiError, gateApi, type Permit } from "../api";
import { ErrorNote } from "../components";

type Result = { title: string; outcome: string; alerts: string[]; good: boolean };

const SILENCE_MIN = 25;

export function EquipmentPanel({ permit, source, onChanged }: { permit: Permit; source: string; onChanged: () => void }) {
  const [results, setResults] = useState<Result[]>([]);
  const [known, setKnown] = useState("30");
  const [reading, setReading] = useState("27");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<Result>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      setResults((cur) => [r, ...cur].slice(0, 6));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const poleSilent = () =>
    run("pole", async () => {
      // the pole was heard 25 minutes ago and again now, with nothing in between (its own demo source, so the
      // console's normal pole is not affected)
      const now = new Date();
      const before = new Date(now.getTime() - SILENCE_MIN * 60_000);
      const demo = `${source}:pole-demo`;
      await gateApi.consoleHeartbeat("G1", { at: before.toISOString(), permit_id: permit.id, source: demo });
      const r = await gateApi.consoleHeartbeat("G1", { at: now.toISOString(), permit_id: permit.id, source: demo });
      return {
        title: `Pole G1 goes silent for ${SILENCE_MIN} min (power cut, smashed)`,
        outcome: r.alerts.length ? "The GB noticed the silence when the pole came back" : "Nothing noticed",
        alerts: r.alerts, good: r.alerts.includes("POLE_SILENT"),
      };
    });

  const fakeEvent = () =>
    run("fake", async () => {
      try {
        await gateApi.postUnsigned("G1", {
          direction: "OUT", plate_read: "OD09AC5678", fastag_read: null, radar_length_m: 8.23, weight_t: 26.3,
          permit_id: permit.id, source,
        });
        return { title: "Someone on the network posts a fake exit event", outcome: "ACCEPTED: no pole check",
                 alerts: [], good: false };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          return { title: "Someone on the network posts a fake exit event",
                   outcome: "Refused: not signed by a GB pole (401)", alerts: ["FAKE_GATE_EVENT"], good: true };
        }
        throw e;
      }
    });

  const referenceTest = () =>
    run("ref", async () => {
      const r = await gateApi.referenceTest("G1", {
        known_weight_t: Number(known), pad_reading_t: Number(reading), permit_id: permit.id,
      });
      return {
        title: `Reference weight test: a ${known} t load reads ${reading} t`,
        outcome: r.passed ? "Pad reads correctly" : `Pad is off by ${r.difference_t > 0 ? "+" : ""}${r.difference_t} t`,
        alerts: r.alerts, good: true,
      };
    });

  const insider = (action: "lower_weight" | "erase_illegal_trip") =>
    run(action, async () => {
      try {
        await gateApi.insiderEdit({ permit_id: permit.id, action, tonnes: 3 });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          throw new Error(action === "lower_weight"
            ? "No weighed trip yet in this session: run an honest entry and exit first."
            : "No illegal trip yet in this session: run the exit preset 'No pass, breaks through' first.");
        }
        throw e;
      }
      return {
        title: action === "lower_weight" ? "An insider takes 3 t off a recorded trip in the database"
          : "An insider deletes the illegal-trip record from the database",
        outcome: "Done quietly: no log line, no alert. Now run the record check.", alerts: [], good: false,
      };
    });

  const checkRecords = () =>
    run("check", async () => {
      const r = await gateApi.verifyRecords(permit.id);
      return {
        title: `Record check: ${r.checked} gate events in the hash chain`,
        outcome: r.intact ? "Intact: nothing edited or deleted" : r.problems.slice(0, 3).join("; "),
        alerts: r.alert ? [r.alert] : [], good: true,
      };
    });

  const b = (key: string) => busy === key;
  return (
    <section className="card gc-equipment">
      <header className="gc-panel-head">
        <LuShieldAlert /> <h3>Equipment &amp; records</h3>
        <span className="muted small">attacks on the GB's own equipment and records, and the checks that catch them</span>
      </header>
      <div className="gc-eq-actions">
        <button className="btn" disabled={!!busy} onClick={poleSilent}>
          <LuPlugZap /> {b("pole") ? "…" : `Pole goes silent ${SILENCE_MIN} min`}
        </button>
        <button className="btn" disabled={!!busy} onClick={fakeEvent}>
          <LuWifiOff /> {b("fake") ? "…" : "Post a fake gate event"}
        </button>
        <span className="gc-eq-ref">
          <LuScale />
          <input value={known} onChange={(e) => setKnown(e.target.value)} title="Reference load (t)" /> t load reads
          <input value={reading} onChange={(e) => setReading(e.target.value)} title="Pad reading (t)" /> t
          <button className="btn" disabled={!!busy} onClick={referenceTest}>{b("ref") ? "…" : "Reference weight test"}</button>
        </span>
      </div>
      <div className="gc-eq-actions">
        <button className="btn" disabled={!!busy} onClick={() => insider("lower_weight")}>
          <LuDatabase /> {b("lower_weight") ? "…" : "Insider shaves 3 t off a trip"}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => insider("erase_illegal_trip")}>
          <LuDatabase /> {b("erase_illegal_trip") ? "…" : "Insider deletes an illegal trip"}
        </button>
        <button className="btn primary" disabled={!!busy} onClick={checkRecords}>
          <LuShieldCheck /> {b("check") ? "…" : "Check records"}
        </button>
      </div>
      <ErrorNote error={error} />
      {results.length > 0 && (
        <ul className="gc-eq-results">
          {results.map((r, i) => (
            <li key={i} className={r.alerts.length ? "alerted" : r.good ? "ok" : "quiet"}>
              <strong>{r.title}</strong>
              <span>{r.outcome}</span>
              {r.alerts.length > 0 && <span className="mono bad-text">{r.alerts.join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
