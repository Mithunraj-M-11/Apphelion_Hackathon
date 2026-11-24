import { useState } from "react";
import type { IconType } from "react-icons";
import {
  LuBellRing,
  LuBuilding2,
  LuCalendarClock,
  LuChevronDown,
  LuChevronRight,
  LuFlaskConical,
  LuGauge,
  LuLayers,
  LuLayoutDashboard,
  LuMenu,
  LuMonitorPlay,
  LuRadar,
  LuScanLine,
  LuShieldCheck,
  LuTag,
  LuTruck,
  LuWorkflow,
} from "react-icons/lu";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { OfficerProvider, useOfficer } from "./officer";
import Alerts from "./pages/Alerts";
import EdgeRecovery from "./pages/EdgeRecovery";
import GateConsole from "./pages/GateConsole";
import GateEvents from "./pages/GateEvents";
import RegistryList from "./pages/RegistryList";
import RfidStickers from "./pages/RfidStickers";
import SimRuns from "./pages/SimRuns";
import SiteRuns from "./pages/SiteRuns";
import SolutionFlow from "./pages/SolutionFlow";
import Transporters from "./pages/Transporters";
import TripPasses from "./pages/TripPasses";
import TripQuotas from "./pages/TripQuotas";
import TruckDetail from "./pages/TruckDetail";
import TruckForm from "./pages/TruckForm";

const COLLAPSE_KEY = "sitewatch.navCollapsed";

type NavItem = { to: string; label: string; Icon: IconType; children?: NavItem[] };

const NAV: NavItem[] = [
  { to: "/solution", label: "Solution flow", Icon: LuWorkflow },
  { to: "/registry", label: "Truck registry", Icon: LuTruck },
  { to: "/transporters", label: "Transporters", Icon: LuBuilding2 },
  {
    to: "/gate-console", label: "Gate console", Icon: LuMonitorPlay,
    children: [ // operational views, folded away under the console
      { to: "/trip-passes", label: "Trip passes", Icon: LuLayers },
      { to: "/rfid-stickers", label: "RFID stickers", Icon: LuTag },
      { to: "/trip-quotas", label: "Trip quotas", Icon: LuGauge },
      { to: "/edge-recovery", label: "Edge & recovery", Icon: LuShieldCheck },
    ],
  },
  { to: "/gate-events", label: "Gate events", Icon: LuScanLine },
  { to: "/alerts", label: "Alerts", Icon: LuBellRing },
  { to: "/scenario-runs", label: "Scenario runs", Icon: LuFlaskConical },
  { to: "/site-runs", label: "Site runs", Icon: LuCalendarClock },
];

/** A sidebar entry; one with children has a toggle that shows them underneath (open while one of them is open). */
function NavEntry({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const childActive = !!item.children?.some((c) => pathname.startsWith(c.to));
  const [open, setOpen] = useState(childActive);
  const shown = open || childActive;
  const { to, label, Icon, children } = item;
  if (!children) {
    return (
      <NavLink to={to} title={label}>
        <Icon className="nav-icon" />
        <span className="nav-label">{label}</span>
      </NavLink>
    );
  }
  return (
    <div className="nav-group">
      <div className="nav-group-head">
        <NavLink to={to} title={label}>
          <Icon className="nav-icon" />
          <span className="nav-label">{label}</span>
        </NavLink>
        <button className="nav-group-toggle" onClick={() => setOpen(!shown)}
                aria-label={shown ? `Hide ${label} pages` : `Show ${label} pages`} title={shown ? "Hide" : "More"}>
          {shown ? <LuChevronDown /> : <LuChevronRight />}
        </button>
      </div>
      {shown && (
        <div className="nav-sub">
          {children.map((c) => <NavEntry key={c.to} item={c} />)}
        </div>
      )}
    </div>
  );
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function ActingAs() {
  const { officers, acting, setActing } = useOfficer();
  return (
    <label className="acting-as">
      Acting as
      <select value={acting?.id ?? ""} onChange={(e) => setActing(Number(e.target.value))}>
        {officers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.role})
          </option>
        ))}
      </select>
    </label>
  );
}

function Home() {
  return (
    <div className="empty-state">
      <LuLayoutDashboard className="empty-icon" />
      <h2>SiteWatch</h2>
      <p className="muted">Choose a section from the sidebar to get started.</p>
    </div>
  );
}

function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* not remembered; fine */
      }
      return !c;
    });

  return (
    <div className={`shell${collapsed ? " nav-collapsed" : ""}`}>
      <header className="topbar">
        <button
          className="nav-toggle"
          onClick={toggle}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <LuMenu />
        </button>
        <div className="brand">
          <span className="brand-mark">
            <LuRadar />
          </span>
          <div>
            <div className="brand-title">SiteWatch</div>
            <div className="brand-sub">Independent site monitoring · Governing Body</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <ActingAs />
      </header>

      <aside className="sidenav">
        <nav>
          {NAV.map((item) => <NavEntry key={item.to} item={item} />)}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/registry" element={<RegistryList />} />
          <Route path="/registry/new" element={<TruckForm />} />
          <Route path="/registry/:id" element={<TruckDetail />} />
          <Route path="/registry/:id/edit" element={<TruckForm />} />
          <Route path="/transporters" element={<Transporters />} />
          <Route path="/solution" element={<SolutionFlow />} />
          <Route path="/about" element={<SolutionFlow />} />
          <Route path="/equipment" element={<SolutionFlow />} />
          <Route path="/gate-console" element={<GateConsole />} />
          <Route path="/trip-passes" element={<TripPasses />} />
          <Route path="/rfid-stickers" element={<RfidStickers />} />
          <Route path="/trip-quotas" element={<TripQuotas />} />
          <Route path="/edge-recovery" element={<EdgeRecovery />} />
          <Route path="/gate-events" element={<GateEvents />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/scenario-runs" element={<SimRuns />} />
          <Route path="/scenario-runs/:id" element={<SimRuns />} />
          <Route path="/site-runs" element={<SiteRuns />} />
          <Route path="/site-runs/:id" element={<SiteRuns />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <OfficerProvider>
        <Layout />
      </OfficerProvider>
    </BrowserRouter>
  );
}
