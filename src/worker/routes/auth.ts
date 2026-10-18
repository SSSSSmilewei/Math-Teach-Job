import { Hono } from "hono";
import { z } from "zod";
import type { Me } from "../../shared/api";
import {
  ConfigError,
  clientIp,
  endSession,
  hashPasscode,
  recordFailure,
  requireSecret,
  safeEqual,
  startSession,
  tooManyFailures,
} from "../auth";
import type { AppEnv } from "../env";
import { getSetting } from "../db";

export const auth = new Hono<AppEnv>();

auth.get("/me", async (c) => {
  const s = c.get("session");
  if (!s) return c.json({ role: null } satisfies Me);
  if (s.role === "admin") return c.json({ role: "admin" } satisfies Me);
  const row = await c.env.DB.prepare("SELECT id, name FROM students WHERE id = ? AND archived = 0")
    .bind(s.sid)
    .first<{ id: string; name: string }>();
  if (!row) {
    endSession(c);
    return c.json({ role: null } satisfies Me);
  }
  return c.json({ role: "student", student: row } satisfies Me);
});

auth.post("/student", async (c) => {
  const { code } = z.object({ code: z.string().trim().min(4).max(40) }).parse(await c.req.json());
  const ip = clientIp(c);
  if (await tooManyFailures(c.env.DB, ip)) return c.json({ error: "试错太多次了，请 10 分钟后再试" }, 429);
  const secret = requireSecret(c.env);
  const hash = await hashPasscode(secret, code);
  const row = await c.env.DB.prepare("SELECT id, name FROM students WHERE passcode_hash = ? AND archived = 0")
    .bind(hash)
    .first<{ id: string; name: string }>();
  if (!row) {
    await recordFailure(c.env.DB, ip);
    return c.json({ error: "口令不对，请检查一下或找老师确认" }, 401);
  }
  await startSession(c, { role: "student", sid: row.id });
  return c.json({ role: "student", student: row } satisfies Me);
});

auth.post("/admin", async (c) => {
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await c.req.json());
  // 优先用 Cloudflare 设置里的 ADMIN_PASSWORD；没有时用数据库里存的密码摘要（settings.admin_password_sha256）
  const fromEnv = c.env.ADMIN_PASSWORD?.trim();
  const storedHash = fromEnv ? null : await getSetting(c.env.DB, "admin_password_sha256");
  if (!fromEnv && !storedHash) throw new ConfigError("还没有设置 ADMIN_PASSWORD。");
  const ip = clientIp(c);
  if (await tooManyFailures(c.env.DB, ip)) return c.json({ error: "试错太多次了，请 10 分钟后再试" }, 429);
  const ok = fromEnv
    ? await safeEqual(requireSecret(c.env), password, fromEnv)
    : await safeEqual(requireSecret(c.env), await sha256Hex(password), storedHash!.toLowerCase());
  if (!ok) {
    await recordFailure(c.env.DB, ip);
    return c.json({ error: "密码不对" }, 401);
  }
  await startSession(c, { role: "admin" });
  return c.json({ role: "admin" } satisfies Me);
});

auth.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
