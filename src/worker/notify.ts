import { getSetting, setSetting } from "./db";
import type { Env } from "./env";

/**
 * 微信通知。事件先写进 outbox，再合并发送：
 * 两次推送之间至少隔 THROTTLE_MS，期间的新事件由定时任务（每 5 分钟）合并成一条。
 * 交作业这类重要事件会立即发送（连同之前攒下的）。
 *
 * 支持两个渠道，配置了哪个就发哪个：
 *  - WxPusher 极简推送（WXPUSHER_SPT）：微信扫码关注即可拿到 SPT
 *  - Server酱 Turbo（SERVERCHAN_KEY）
 */
const THROTTLE_MS = 2 * 60_000;

export type NotifyKind = "pin" | "followup" | "submission" | "test";

export interface NotifyItem {
  kind: NotifyKind;
  title: string;
  body: string;
  link?: string;
}

export function notifyConfigured(env: Env): string[] {
  const channels: string[] = [];
  if (env.WXPUSHER_SPT) channels.push("WxPusher");
  if (env.SERVERCHAN_KEY) channels.push("Server酱");
  return channels;
}

export async function enqueue(env: Env, item: NotifyItem) {
  await env.DB.prepare("INSERT INTO outbox (kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(item.kind, item.title, item.body, item.link ?? null, Date.now())
    .run();
}

export async function flush(env: Env, opts: { force: boolean }): Promise<{ sent: number; skipped?: string }> {
  if (notifyConfigured(env).length === 0) return { sent: 0, skipped: "没有配置通知渠道" };
  const pending = await env.DB.prepare(
    "SELECT id, kind, title, body, link FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 30",
  ).all<{ id: number; kind: NotifyKind; title: string; body: string; link: string | null }>();
  const items = pending.results;
  if (items.length === 0) return { sent: 0 };

  const last = Number((await getSetting(env.DB, "notify_last_sent")) ?? 0);
  if (!opts.force && Date.now() - last < THROTTLE_MS) return { sent: 0, skipped: "合并到下一次发送" };

  const summary =
    items.length === 1 ? items[0].title : `${items[0].title} 等 ${items.length} 条`;
  const text = items
    .map((it) => `${it.title}\n${it.body}${it.link ? `\n${it.link}` : ""}`)
    .join("\n\n————\n\n");
  const link = items.length === 1 ? items[0].link ?? undefined : adminLink(env, "/admin");

  await send(env, summary, text, link);

  const now = Date.now();
  await env.DB.batch([
    ...items.map((it) => env.DB.prepare("UPDATE outbox SET sent_at = ? WHERE id = ?").bind(now, it.id)),
  ]);
  await setSetting(env.DB, "notify_last_sent", String(now));
  return { sent: items.length };
}

export function adminLink(env: Env, path: string): string | undefined {
  const base = env.SITE_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
}

async function send(env: Env, summary: string, text: string, link?: string) {
  const tasks: Promise<void>[] = [];
  if (env.WXPUSHER_SPT) {
    tasks.push(
      postJson("https://wxpusher.zjiecode.com/api/send/message/simple-push", {
        content: text,
        summary: summary.slice(0, 90),
        contentType: 1,
        spt: env.WXPUSHER_SPT,
        ...(link ? { url: link } : {}),
      }),
    );
  }
  if (env.SERVERCHAN_KEY) {
    const key = env.SERVERCHAN_KEY;
    const body = new URLSearchParams({ title: summary.slice(0, 32), desp: text.replace(/\n/g, "\n\n") });
    tasks.push(
      fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Server酱 返回 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }),
    );
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === results.length && failed.length > 0) throw failed[0].reason;
  for (const f of failed) console.error(JSON.stringify({ msg: "notify channel failed", error: String(f.reason) }));
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`推送失败 ${r.status}: ${text.slice(0, 200)}`);
  try {
    const data = JSON.parse(text) as { success?: boolean; msg?: string };
    if (data.success === false) throw new Error(`推送失败：${data.msg ?? text.slice(0, 200)}`);
  } catch (err) {
    if (err instanceof SyntaxError) return;
    throw err;
  }
}
