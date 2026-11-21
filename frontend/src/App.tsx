import { useState } from "react";
import type { IconType } from "react-icons";
import { LuBellRing, LuBuilding2, LuFlaskConical, LuLayoutDashboard, LuMenu, LuMonitorPlay, LuRadar, LuScanLine, LuTruck, LuWorkflow } from "react-icons/lu";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { OfficerProvider, useOfficer } from "./officer";
import Alerts from "./pages/Alerts";
import GateConsole from "./pages/GateConsole";
import GateEvents from "./pages/GateEvents";
import RegistryList from "./pages/RegistryList";
import SimRuns from "./pages/SimRuns";
import SolutionFlow from "./pages/SolutionFlow";
import TruckDetail from "./pages/TruckDetail";
import TruckForm from "./pages/TruckForm";
import Transporters from "./pages/Transporters";

const COLLAPSE_KEY = "sitewatch.navCollapsed";

const NAV: { to: string; label: string; Icon: IconType }[] = [
  { to: "/solution", label: "Solution flow", Icon: LuWorkflow },
  { to: "/registry", label: "Truck registry", Icon: LuTruck },
  { to: "/transporters", label: "Transporters", Icon: LuBuilding2 },
  { to: "/gate-console", label: "Gate console", Icon: LuMonitorPlay },
  { to: "/gate-events", label: "Gate events", Icon: LuScanLine },
  { to: "/alerts", label: "Alerts", Icon: LuBellRing },
  { to: "/scenario-runs", label: "Scenario runs", Icon: LuFlaskConical },
];

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
        <button className="nav-toggle" onClick={toggle} aria-label={collapsed ? "Expand menu" : "Collapse menu"}
                title={collapsed ? "Expand menu" : "Collapse menu"}>
          <LuMenu />
        </button>
        <div className="brand">
          <span className="brand-mark"><LuRadar /></span>
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
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} title={label}>
              <Icon className="nav-icon" />
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
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
          <Route path="/gate-console" element={<GateConsole />} />
          <Route path="/gate-events" element={<GateEvents />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/scenario-runs" element={<SimRuns />} />
          <Route path="/scenario-runs/:id" element={<SimRuns />} />
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
