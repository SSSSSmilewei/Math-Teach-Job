import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: string[],
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; issues?: string[] };
    throw new ApiError(d.error ?? `请求失败（${res.status}）`, res.status, d.issues, data as Record<string, unknown>);
  }
  return data as T;
}

/** 读取接口数据；返回 [数据, 错误, 重新加载, 本地修改]。 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError(null);
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: ApiError) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [path, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, setData };
}

export function formatDate(ms: number | null | undefined, withTime = false): string {
  if (!ms) return "";
  const d = new Date(ms);
  const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  if (!withTime) return date;
  return `${date} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatClassDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  const week = "日一二三四五六"[new Date(`${iso}T00:00:00`).getDay()];
  return `${m} 月 ${d} 日，周${week}`;
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return formatDate(ms, true);
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
