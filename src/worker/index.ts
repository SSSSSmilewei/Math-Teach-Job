import { Hono } from "hono";
import { ZodError } from "zod";
import { formatIssues } from "../shared/schema";
import { ConfigError, readSession } from "./auth";
import { ensureSchema } from "./db";
import type { AppEnv, Env } from "./env";
import { flush } from "./notify";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { student } from "./routes/student";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  await ensureSchema(c.env.DB);
  c.set("session", await readSession(c));
  await next();
  c.header("cache-control", "no-store");
});

app.route("/api/auth", auth);
app.route("/api/admin", admin);
app.route("/api", student);

// 只报告各项设置“有没有”，不返回值，方便排查部署
app.get("/api/health", (c) => {
  const has = (k: keyof Env) => typeof c.env[k] === "string" && (c.env[k] as string).trim().length > 0;
  return c.json({
    ok: true,
    settings: {
      ADMIN_PASSWORD: has("ADMIN_PASSWORD"),
      SESSION_SECRET: has("SESSION_SECRET") && (c.env.SESSION_SECRET as string).length >= 16,
      SITE_URL: has("SITE_URL"),
      AI_API_KEY: has("AI_API_KEY"),
      WXPUSHER_SPT: has("WXPUSHER_SPT"),
      SERVERCHAN_KEY: has("SERVERCHAN_KEY"),
    },
  });
});

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "提交的内容格式不对", issues: formatIssues(err) }, 400);
  if (err instanceof ConfigError) return c.json({ error: err.message, config: true }, 500);
  if (err instanceof SyntaxError) return c.json({ error: "请求不是有效的 JSON" }, 400);
  console.error(JSON.stringify({ msg: "unhandled error", path: c.req.path, error: String(err), stack: (err as Error).stack }));
  return c.json({ error: "服务器出错了，请稍后再试" }, 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "没有这个接口" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      ensureSchema(env.DB)
        .then(() => flush(env, { force: true }))
        .catch((err) => console.error(JSON.stringify({ msg: "scheduled flush failed", error: String(err) }))),
    );
  },
};
