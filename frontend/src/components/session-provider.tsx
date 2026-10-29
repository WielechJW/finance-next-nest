"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { SessionStore, type SessionState } from "@/lib/session-store";

const SessionContext = createContext<{
  state: SessionState;
  store: SessionStore;
} | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SessionStore());
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const pathname = usePathname();

  useEffect(() => {
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined")
        channel = new BroadcastChannel("finance-session");
    } catch {
      /* Focus revalidation still works if cross-tab messaging is unavailable. */
    }
    store.setChangeListener(() => channel?.postMessage("session-changed"));
    const sync = () => {
      if (document.visibilityState === "visible") void store.refresh();
    };
    const changed = (event: MessageEvent) => {
      if (event.data === "session-changed") {
        store.invalidate();
        void store.refresh();
      }
    };
    const hidden = () => store.invalidate();
    channel?.addEventListener("message", changed);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("pagehide", hidden);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener(UNAUTHORIZED_EVENT, store.markUnauthorized);
    return () => {
      channel?.close();
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("pagehide", hidden);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener(UNAUTHORIZED_EVENT, store.markUnauthorized);
      store.cancel();
    };
  }, [store]);

  useEffect(() => {
    void store.refresh();
  }, [pathname, store]);

  const value = useMemo(() => ({ state, store }), [state, store]);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider is required");
  return session;
}
