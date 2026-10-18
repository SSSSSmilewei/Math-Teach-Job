/**
 * 不装 wrangler 也能在本地跑起来的开发服务器（用 Bun 运行）：
 *  - 用 bun:sqlite 模拟 D1，数据存在 .local/dev.sqlite
 *  - 用 dist/client 模拟静态资源绑定（SPA 回退到 index.html）
 *  - 读取 .dev.vars 和 wrangler.jsonc 里的 vars
 *  - 推送请求（WxPusher / Server酱）只打印，不真的发出去
 *
 * 用法：npm run dev   （先构建前端，再启动 http://localhost:8787）
 * 部署环境用的是 wrangler，这个文件只用于本地调试。
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import worker from "../src/worker/index";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8787);
const dbFile = process.env.DEV_DB ?? join(root, ".local/dev.sqlite");
mkdirSync(join(root, ".local"), { recursive: true });

/* ---------- D1 ---------- */
type Value = string | number | bigint | null | Uint8Array;
function toSql(v: unknown): Value {
  if (v === undefined) throw new TypeError("D1_TYPE_ERROR: Type 'undefined' not supported");
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as Value;
}

class Statement {
  constructor(
    private db: Database,
    private sql: string,
    private args: Value[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toSql));
  }
  execSync() {
    const q = this.db.query(this.sql);
    if (q.columnNames.length > 0) return { results: q.all(...this.args) as Record<string, unknown>[], success: true, meta: {} };
    const r = q.run(...this.args);
    return { results: [], success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async first<T>() {
    const r = this.execSync().results[0];
    return (r ?? null) as T | null;
  }
  async all<T>() {
    return this.execSync() as unknown as D1Result<T>;
  }
  async run<T>() {
    return this.execSync() as unknown as D1Result<T>;
  }
}

class LocalD1 {
  constructor(private db: Database) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(stmts: Statement[]) {
    return this.db.transaction(() => stmts.map((s) => s.execSync()))();
  }
}

const sqlite = new Database(dbFile, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");

/* ---------- 静态资源 ---------- */
const clientDir = join(root, "dist/client");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};
const ASSETS = {
  async fetch(input: Request | string) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(clientDir, path);
    if (!file.startsWith(clientDir) || !existsSync(file) || path.endsWith("/")) file = join(clientDir, "index.html");
    const body = readFileSync(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const cache = file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(body, { headers: { "content-type": type, "cache-control": cache } });
  },
};

/* ---------- 环境变量 ---------- */
function readVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  const wr = readFileSync(join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const varsBlock = wr.match(/"vars"\s*:\s*(\{[^}]*\})/);
  if (varsBlock) Object.assign(vars, JSON.parse(varsBlock[1]));
  const devVars = join(root, ".dev.vars");
  if (existsSync(devVars))
    for (const line of readFileSync(devVars, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[2] !== "") vars[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("HW_")) vars[k.slice(3)] = v ?? "";
  return vars;
}

const env = { DB: new LocalD1(sqlite), ASSETS, ...readVars() } as unknown as import("../src/worker/env").Env;

/* ---------- 拦截推送 ---------- */
export const sentNotifications: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/wxpusher\.zjiecode\.com|sctapi\.ftqq\.com/.test(url)) {
    const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
    sentNotifications.push({ url, body });
    console.log(`[通知] ${url}\n${body.slice(0, 500)}\n`);
    return new Response(JSON.stringify({ code: 1000, success: true, msg: "ok(本地模拟)" }), {
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const pending = new Set<Promise<unknown>>();
const ctx = {
  waitUntil(p: Promise<unknown>) {
    pending.add(p);
    p.catch((e) => console.error("waitUntil error:", e)).finally(() => pending.delete(p));
  },
  passThroughOnException() {},
};

Bun.serve({
  port,
  idleTimeout: 255,
  fetch(req) {
    return worker.fetch(req, env, ctx);
  },
});

setInterval(() => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now() }, env, ctx), 5 * 60_000);
console.log(`本地服务已启动：http://localhost:${port}  （数据库 ${dbFile}）`);
