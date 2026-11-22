import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setActingOfficer, type Officer } from "./api";

type Ctx = { officers: Officer[]; acting: Officer | null; setActing: (id: number) => void };

const OfficerContext = createContext<Ctx>({ officers: [], acting: null, setActing: () => {} });
const STORAGE_KEY = "aphelion.actingOfficer";

function readStored(): number | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function OfficerProvider({ children }: { children: ReactNode }) {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [actingId, setActingId] = useState<number | null>(readStored);

  useEffect(() => {
    api.officers().then((list) => {
      setOfficers(list);
      // default to the first inspector if nothing (valid) is stored
      setActingId((cur) =>
        cur && list.some((o) => o.id === cur) ? cur : (list.find((o) => o.role === "inspector") ?? list[0])?.id ?? null,
      );
    });
  }, []);

  useEffect(() => {
    setActingOfficer(actingId);
    try {
      if (actingId != null) window.localStorage.setItem(STORAGE_KEY, String(actingId));
    } catch {
      /* storage unavailable: fine, it just won't be remembered */
    }
  }, [actingId]);

  const acting = officers.find((o) => o.id === actingId) ?? null;
  return (
    <OfficerContext.Provider value={{ officers, acting, setActing: setActingId }}>{children}</OfficerContext.Provider>
  );
}

export const useOfficer = () => useContext(OfficerContext);
