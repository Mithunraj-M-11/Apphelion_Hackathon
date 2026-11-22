import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowRight,
  LuBan,
  LuCamera,
  LuCheck,
  LuConstruction,
  LuDatabase,
  LuFingerprint,
  LuFlag,
  LuLock,
  LuMonitor,
  LuMountain,
  LuRadar,
  LuRuler,
  LuScale,
  LuServer,
  LuShieldCheck,
  LuSiren,
  LuSmartphone,
  LuSun,
  LuTag,
  LuTicket,
  LuTruck,
  LuWifi,
  LuX,
} from "react-icons/lu";

// ================================================================ One trip: SVG flow diagram

const W = 900;
const CX = 250; // main column centre
const NODE_W = 340;
const NODE_H = 72;
const DIA_W = 280; // diamond width
const DIA_H = 150; // diamond height
const GAP = 34; // vertical gap between shapes
const BRANCH_X = 500;
const BRANCH_W = 380;
const BRANCH_H = 78;

type Lines = string[];

function Txt({ x, y, lines, cls, lh = 16, anchor = "middle" }: {
  x: number; y: number; lines: Lines; cls: string; lh?: number; anchor?: "middle" | "start";
}) {
  return (
    <text x={x} y={y} className={cls} textAnchor={anchor}>
      {lines.map((l, i) => (
        <tspan key={l} x={x} dy={i === 0 ? 0 : lh}>{l}</tspan>
      ))}
    </text>
  );
}

/** Rounded step box (or capsule for start/end) with an icon badge on the left. */
function StepNode({ y, Icon, title, sub, capsule }: { y: number; Icon: IconType; title: string; sub: Lines; capsule?: boolean }) {
  const x = CX - NODE_W / 2;
  return (
    <g>
      <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={capsule ? NODE_H / 2 : 12}
            className={capsule ? "tf-node tf-capsule" : "tf-node"} />
      <circle cx={x + 38} cy={y + NODE_H / 2} r={20} className="tf-badge" />
      <Icon x={x + 26} y={y + NODE_H / 2 - 12} size={24} className="tf-badge-icon" />
      <Txt x={x + 70} y={y + 28} lines={[title]} cls="tf-title" anchor="start" />
      <Txt x={x + 70} y={y + 47} lines={sub} cls="tf-sub" lh={15} anchor="start" />
    </g>
  );
}

/** Decision diamond: icon on top, question in the middle. */
function Decision({ cy, Icon, title, sub }: { cy: number; Icon: IconType; title: string; sub: Lines }) {
  const pts = [
    [CX, cy - DIA_H / 2],
    [CX + DIA_W / 2, cy],
    [CX, cy + DIA_H / 2],
    [CX - DIA_W / 2, cy],
  ].map((p) => p.join(",")).join(" ");
  return (
    <g>
      <polygon points={pts} className="tf-decision" />
      <Icon x={CX - 11} y={cy - 52} size={22} className="tf-decision-icon" />
      <Txt x={CX} y={cy - 8} lines={[title]} cls="tf-title" />
      <Txt x={CX} y={cy + 12} lines={sub} cls="tf-sub" lh={14} />
    </g>
  );
}

/** Side outcome box connected from (fromX, cy) with a labelled arrow. */
function Branch({ fromX, cy, tone, Icon, title, sub, label }: {
  fromX: number; cy: number; tone: "bad" | "warn"; Icon: IconType; title: string; sub: Lines; label: string;
}) {
  const y = cy - BRANCH_H / 2;
  return (
    <g>
      <line x1={fromX} y1={cy} x2={BRANCH_X - 8} y2={cy} className={`tf-edge tf-edge-${tone}`}
            markerEnd={`url(#tf-arrow-${tone})`} />
      <text x={(fromX + BRANCH_X) / 2} y={cy - 8} className={`tf-edge-label tf-${tone}-text`} textAnchor="middle">{label}</text>
      <rect x={BRANCH_X} y={y} width={BRANCH_W} height={BRANCH_H} rx={12} className={`tf-branch tf-branch-${tone}`} />
      <Icon x={BRANCH_X + 16} y={cy - 12} size={24} className={`tf-${tone}-text`} />
      <Txt x={BRANCH_X + 54} y={y + 30} lines={[title]} cls={`tf-title tf-${tone}-text`} anchor="start" />
      <Txt x={BRANCH_X + 54} y={y + 49} lines={sub} cls="tf-sub" lh={15} anchor="start" />
    </g>
  );
}

function Down({ y1, y2, label }: { y1: number; y2: number; label?: string }) {
  return (
    <g>
      <line x1={CX} y1={y1} x2={CX} y2={y2 - 6} className="tf-edge" markerEnd="url(#tf-arrow)" />
      {label && <text x={CX + 10} y={(y1 + y2) / 2 + 4} className="tf-edge-label">{label}</text>}
    </g>
  );
}

function TripFlow() {
  // vertical layout, top to bottom
  const yStart = 30;
  const d1 = yStart + NODE_H + GAP + DIA_H / 2; // Identify diamond centre
  const d2 = d1 + DIA_H + GAP; // Compare diamond centre
  const yPass = d2 + DIA_H / 2 + GAP;
  const yLoad = yPass + NODE_H + GAP;
  const d3 = yLoad + NODE_H + GAP + DIA_H / 2; // Exit gate diamond centre
  const yClosed = d3 + DIA_H / 2 + GAP;
  const yEnd = yClosed + NODE_H + GAP;
  const H = yEnd + NODE_H + 16;

  return (
    <div className="tf-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="tf-svg" role="img"
           aria-label="Flow of one trip from arrival to record, with every refused, blocked or flagged outcome">
        <defs>
          {[["tf-arrow", "tf-arrowhead"], ["tf-arrow-bad", "tf-arrowhead-bad"], ["tf-arrow-warn", "tf-arrowhead-warn"]].map(
            ([id, cls]) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" className={cls} />
              </marker>
            ),
          )}
        </defs>

        {/* lane labels */}
        <text x={CX} y={12} className="tf-lane" textAnchor="middle">NORMAL PATH</text>
        <text x={BRANCH_X + BRANCH_W / 2} y={12} className="tf-lane" textAnchor="middle">WAYS OUT OF IT</text>

        <StepNode y={yStart} Icon={LuTruck} title="Truck arrives empty" capsule
                  sub={["Radar + camera count it at entry;", "entry pad weighs it"]} />
        <Down y1={yStart + NODE_H} y2={d1 - DIA_H / 2} />

        <Decision cy={d1} Icon={LuFingerprint} title="Identify" sub={["Plate + FASTag + length", "match the GB registry?"]} />
        <Branch fromX={CX + DIA_W / 2} cy={d1} tone="bad" Icon={LuBan} label="No"
                title="No pass + alert" sub={["Unknown, unreadable or mismatch", "(default deny)"]} />
        <Down y1={d1 + DIA_H / 2} y2={d2 - DIA_H / 2} label="Yes" />

        <Decision cy={d2} Icon={LuScale} title="Compare" sub={["No open pass · quota left ·", "within hours · exit working?"]} />
        <Branch fromX={CX + DIA_W / 2} cy={d2} tone="bad" Icon={LuBan} label="No"
                title="No pass + reason" sub={["Clone alert, quota reached,", "outside hours…"]} />
        <Down y1={d2 + DIA_H / 2} y2={yPass} label="Yes" />

        <StepNode y={yPass} Icon={LuTicket} title="Pass issued"
                  sub={["Signed one-time QR (app) + SMS code;", "one trip reserved"]} />
        <Down y1={yPass + NODE_H} y2={yLoad} />

        <StepNode y={yLoad} Icon={LuMountain} title="Truck loads inside the site"
                  sub={["The GB doesn't need to watch", "this part"]} />
        <Down y1={yLoad + NODE_H} y2={d3 - DIA_H / 2} />

        <Decision cy={d3} Icon={LuConstruction} title="Exit gate: valid pass?" sub={["Counted · plate + FASTag ·", "pass checked · weighed"]} />
        <Branch fromX={CX + DIA_W / 2} cy={d3} tone="bad" Icon={LuSiren} label="No"
                title="Barrier stays down" sub={["Forced through = illegal trip,", "critical alert with video"]} />
        <Down y1={d3 + DIA_H / 2} y2={yClosed} label="Yes" />

        <StepNode y={yClosed} Icon={LuCheck} title="Pass closed, barrier lifts"
                  sub={["Legal trip with net tonnes;", "quota updated"]} />
        <Branch fromX={CX + NODE_W / 2} cy={yClosed + NODE_H / 2} tone="warn" Icon={LuFlag} label="If"
                title="Allowed but flagged" sub={["Overload, or closed without QR:", "goes to review"]} />
        <Down y1={yClosed + NODE_H} y2={yEnd} />

        <StepNode y={yEnd} Icon={LuLock} title="Recorded" capsule
                  sub={["Every step signed and chained;", "can't be edited"]} />
      </svg>
    </div>
  );
}

// ================================================================ installs & independence
const INSTALLS: { Icon: IconType; name: string; where: string }[] = [
  { Icon: LuRadar, name: "Pole: radar + camera + FASTag reader", where: "Every gate lane" },
  { Icon: LuScale, name: "Weigh pad", where: "Exit (and entry) lane" },
  { Icon: LuConstruction, name: "GB boom barrier", where: "Every exit lane" },
  { Icon: LuServer, name: "GB server", where: "Off site" },
  { Icon: LuSmartphone, name: "App + SMS pass", where: "Driver's phone" },
  { Icon: LuMonitor, name: "Dashboard", where: "GB office" },
];

const INDEPENDENCE: { vendor: string; answer: string; Icon: IconType }[] = [
  { vendor: "Power", answer: "Solar + battery on every GB device", Icon: LuSun },
  { vendor: "Network", answer: "Own 4G SIM; stores and uploads later", Icon: LuWifi },
  { vendor: "Gate staff", answer: "Fully automatic; barrier opened only by the GB system", Icon: LuShieldCheck },
  { vendor: "Truck list", answer: "GB enrolls trucks itself after physical inspection", Icon: LuDatabase },
  { vendor: "Passes", answer: "Only the GB can issue and close them", Icon: LuTicket },
  { vendor: "Their CCTV, weighbridge, records", answer: "Only compared against, never trusted", Icon: LuCamera },
];

// ================================================================ defence in depth
const CHECKS = [
  { key: "registry", label: "Registry", Icon: LuDatabase },
  { key: "fastag", label: "Plate vs FASTag", Icon: LuTag },
  { key: "length", label: "Radar length", Icon: LuRuler },
  { key: "deny", label: "Default deny", Icon: LuBan },
  { key: "pass", label: "Trip pass", Icon: LuTicket },
] as const;

type Cell = "catch" | "support" | "";
const TAMPER: { name: string; cells: Record<string, Cell>; tested?: boolean }[] = [
  { name: "Unregistered truck", cells: { registry: "catch", deny: "support", pass: "support" }, tested: true },
  { name: "Fake plate on a bigger truck", cells: { length: "catch", pass: "support" }, tested: true },
  { name: "Fake plate + stolen FASTag, same size", cells: { fastag: "catch", pass: "support" }, tested: true },
  { name: "Plate and FASTag removed", cells: { deny: "catch", pass: "support" }, tested: true },
  { name: "Two trucks swap plates", cells: { fastag: "catch", length: "support", pass: "support" } },
  { name: "Perfect clone (plate + cloned tag + same model)", cells: { pass: "catch" } },
  { name: "Leaves without a pass", cells: { pass: "catch" } },
];

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="sf-section">
      <h2>{title}</h2>
      {sub && <p className="muted sf-sub">{sub}</p>}
      {children}
    </section>
  );
}

export default function SolutionFlow() {
  return (
    <>
      <div className="sf-hero">
        <div className="sf-eyebrow">How SiteWatch works</div>
        <h1>The GB gets its own eyes, scales and gate at every exit.</h1>
        <p>
          It issues every trip pass itself and compares what physically happened with what was permitted, using no
          power, network, staff or records from the Vendor.
        </p>
      </div>

      <Section title="One trip, start to finish" sub="Every way out of the normal path is refused, blocked or flagged.">
        <TripFlow />
      </Section>

      <Section title="What the GB installs">
        <div className="sf-installs">
          {INSTALLS.map((x) => (
            <div key={x.name} className="sf-install">
              <x.Icon className="sf-install-icon" />
              <div className="sf-install-name">{x.name}</div>
              <div className="muted small">{x.where}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Why the Vendor can't switch it off" sub="Independence: nothing the Vendor controls is trusted.">
        <div className="sf-indep">
          {INDEPENDENCE.map((x) => (
            <div key={x.vendor} className="sf-indep-row">
              <div className="sf-indep-vendor"><LuX /> Vendor controls {x.vendor.toLowerCase()}</div>
              <LuArrowRight className="muted" />
              <div className="sf-indep-answer"><x.Icon /> {x.answer}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Defence in depth"
        sub="No single check has to be perfect: each tampering trick is caught by a different layer."
      >
        <div className="sf-matrix-wrap">
          <table className="table sf-matrix">
            <thead>
              <tr>
                <th>Tampering</th>
                {CHECKS.map((c) => (
                  <th key={c.key} className="center"><c.Icon /> <div>{c.label}</div></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TAMPER.map((t) => (
                <tr key={t.name}>
                  <td>
                    {t.name}
                    {t.tested && <span className="badge ok">Tested in PoC</span>}
                  </td>
                  {CHECKS.map((c) => (
                    <td key={c.key} className="center">
                      {t.cells[c.key] === "catch" && <span className="sf-dot sf-dot-catch" title="Catches it" />}
                      {t.cells[c.key] === "support" && <span className="sf-dot sf-dot-support" title="Backs it up" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sf-legend muted small">
          <span><span className="sf-dot sf-dot-catch" /> catches it</span>
          <span><span className="sf-dot sf-dot-support" /> backs it up</span>
        </div>
      </Section>
    </>
  );
}
