"use client";

import { useCallback, useEffect, useState } from "react";

type State<T> = {
  data: T | null;
  error: string | null;
  status: number | null;
  loading: boolean;
};

// Loads JSON from an API route when the page opens, when the url changes, and
// again whenever reload() is called. The session cookie is sent automatically,
// so the API decides what this user may see.
export function useFetch<T>(url: string) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    status: null,
    loading: true,
  });
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State<T>;
      try {
        const res = await fetch(url);
        const body = await res.json().catch(() => ({}));
        next = res.ok
          ? { data: body as T, error: null, status: res.status, loading: false }
          : { data: null, error: body.error ?? "Request failed", status: res.status, loading: false };
      } catch {
        next = { data: null, error: "Could not reach the server", status: null, loading: false };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, refreshCount]);

  const reload = useCallback(() => setRefreshCount((n) => n + 1), []);

  return { ...state, reload };
}

// POSTs JSON and reports success, or the server's error message.
export async function postJson(
  url: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, error: res.ok ? null : (data.error ?? "Request failed") };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server" };
  }
}
