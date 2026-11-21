import { useCallback, useEffect, useRef, useState } from "react";
import type { UsuarioResponse } from "@stockagent/shared";
import type { StockAgentApiClient } from "../lib/api-client";

export const SESSION_STORAGE_KEY = "stockagent_session_v1";

export interface StoredSession {
  token: string;
  user: UsuarioResponse;
}

export function readInitialSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed && typeof parsed.token === "string" && parsed.user?.username) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(next: StoredSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!next) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // noop
  }
}

export function useSessionState() {
  const [session, setSession] = useState<StoredSession | null>(() =>
    readInitialSession()
  );
  const tokenRef = useRef<string | null>(session?.token ?? null);
  tokenRef.current = session?.token ?? null;

  const clearSession = useCallback(() => {
    setSession(null);
    persistSession(null);
  }, []);

  const saveLoginSession = useCallback(
    (token: string, user: UsuarioResponse) => {
      const next: StoredSession = { token, user };
      setSession(next);
      persistSession(next);
    },
    []
  );

  const markPasswordChanged = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const updated: StoredSession = {
        token: prev.token,
        user: { ...prev.user, must_change_password: false },
      };
      persistSession(updated);
      return updated;
    });
  }, []);

  return {
    session,
    tokenRef,
    setSession,
    clearSession,
    saveLoginSession,
    markPasswordChanged,
  };
}

export function useVerifyStoredSession(
  api: StockAgentApiClient,
  session: StoredSession | null,
  setSession: (next: StoredSession) => void
) {
  useEffect(() => {
    if (!session?.token || session.user.must_change_password) return;
    let active = true;
    void api
      .getMe()
      .then((freshUser) => {
        if (!active) return;
        const next: StoredSession = { token: session.token, user: freshUser };
        setSession(next);
        persistSession(next);
      })
      .catch(() => {
        // onUnauthorized limpia la sesión si expiró
      });
    return () => {
      active = false;
    };
  }, [api, session?.token, session?.user.must_change_password, setSession]);
}
