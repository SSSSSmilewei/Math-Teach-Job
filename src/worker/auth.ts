import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env, Session } from "./env";

const COOKIE = "hw_s";
const STUDENT_DAYS = 180;
const ADMIN_DAYS = 30;
const enc = new TextEncoder();

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string) {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function requireSecret(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) throw new ConfigError("还没有设置 SESSION_SECRET（至少 16 个字符）。");
  return s;
}

export class ConfigError extends Error {}

export async function signSession(secret: string, session: Session): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySession(secret: string, token: string): Promise<Session | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function readSession(c: Context<AppEnv>): Promise<Session | null> {
  const token = getCookie(c, COOKIE);
  const secret = c.env.SESSION_SECRET;
  if (!token || !secret) return null;
  return verifySession(secret, token);
}

export async function startSession(c: Context<AppEnv>, session: { role: "student"; sid: string } | { role: "admin" }) {
  const days = session.role === "admin" ? ADMIN_DAYS : STUDENT_DAYS;
  const full = { ...session, exp: Date.now() + days * 86400_000 } as Session;
  const token = await signSession(requireSecret(c.env), full);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: days * 86400,
  });
}

export function endSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** 口令统一成小写、去掉空格和连字符，方便学生输入。 */
export function normalizePasscode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export async function hashPasscode(secret: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:${normalizePasscode(code)}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generatePasscode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** 常量时间比较：两边都先做 HMAC，再逐字节比较摘要。 */
export async function safeEqual(secret: string, a: string, b: string): Promise<boolean> {
  const key = await hmacKey(secret);
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
}

export async function tooManyFailures(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, Date.now() - WINDOW_MS)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(db: D1Database, ip: string) {
  await db.batch([
    db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, Date.now()),
    db.prepare("DELETE FROM login_failures WHERE at < ?").bind(Date.now() - WINDOW_MS),
  ]);
}

export const requireStudent: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  if (!s || s.role !== "student") return c.json({ error: "请先输入口令登录" }, 401);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.get("session");
  if (!s || s.role !== "admin") return c.json({ error: "请先登录老师后台" }, 401);
  await next();
};

export function studentId(c: Context<AppEnv>): string {
  const s = c.get("session");
  if (!s || s.role !== "student") throw new Error("not a student session");
  return s.sid;
}
