import { Hono } from "hono";
import { z } from "zod";
import { BankProblem, LessonContent, LessonMeta, formatIssues } from "../../shared/schema";
import { modelConfig } from "../ai";
import { generatePasscode, hashPasscode, requireAdmin, requireSecret } from "../auth";
import { parseJson } from "../db";
import type { AppEnv } from "../env";
import { type BankRow, type Check, GenerateInput, type GenerateEvent, groupKey, runGeneration, verifyAgainstBank } from "../generate";
import { type LessonRow, allProblems, buildPayload, lessonContent, loadPins } from "../lessons";
import { enqueue, flush, notifyConfigured } from "../notify";

export const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

function lessonListItem(row: LessonRow) {
  const content = lessonContent(row);
  const checks = parseJson<Check[]>(row.checks, []);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    titleEn: row.title_en,
    classDate: row.class_date,
    chapters: row.chapters,
    status: row.status,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    problemCount: allProblems(content).length,
    warnings: checks.filter((c) => c.level === "warn").length,
  };
}

admin.get("/overview", async (c) => {
  const db = c.env.DB;
  const [lessons, students, subs] = await db.batch([
    db.prepare("SELECT * FROM lessons ORDER BY number DESC, updated_at DESC"),
    db.prepare("SELECT COUNT(*) AS n FROM students WHERE archived = 0"),
    db.prepare(
      `SELECT s.*, st.name AS student_name, l.number AS lesson_number, l.title AS lesson_title
       FROM submissions s JOIN students st ON st.id = s.student_id JOIN lessons l ON l.id = s.lesson_id
       ORDER BY s.submitted_at DESC LIMIT 8`,
    ),
  ]);
  const openPins = await loadPins(db, { status: "open" });
  const ai = modelConfig(c.env);
  return c.json({
    config: {
      sessionSecret: !!c.env.SESSION_SECRET && c.env.SESSION_SECRET.length >= 16,
      ai: ai ? `${ai.provider === "anthropic" ? "Anthropic" : "OpenAI 兼容接口"}：${ai.model}` : null,
      notify: notifyConfigured(c.env),
      siteUrl: c.env.SITE_URL ?? null,
    },
    students: (students.results[0] as { n: number }).n,
    lessons: (lessons.results as unknown as LessonRow[]).map(lessonListItem),
    openPins,
    submissions: (subs.results as unknown as {
      id: number;
      lesson_id: string;
      lesson_number: number;
      lesson_title: string;
      student_name: string;
      submitted_at: number;
      correct: number;
      total: number;
      summary: string;
    }[]).map((s) => ({
      id: s.id,
      lessonId: s.lesson_id,
      lessonNumber: s.lesson_number,
      lessonTitle: s.lesson_title,
      studentName: s.student_name,
      submittedAt: s.submitted_at,
      correct: s.correct,
      total: s.total,
      summary: parseJson(s.summary, { items: [], minutes: null }),
    })),
  });
});

/* ---------- 学生 ---------- */

admin.get("/students", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.created_at,
      (SELECT MAX(created_at) FROM attempts a WHERE a.student_id = s.id) AS last_active
     FROM students s WHERE s.archived = 0 ORDER BY s.created_at`,
  ).all();
  return c.json(rows.results);
});

admin.post("/students", async (c) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(30) }).parse(await c.req.json());
  const code = generatePasscode();
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO students (id, name, passcode_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, await hashPasscode(requireSecret(c.env), code), Date.now())
    .run();
  return c.json({ id, name, code });
});

admin.post("/students/:id/reset", async (c) => {
  const code = generatePasscode();
  const r = await c.env.DB.prepare("UPDATE students SET passcode_hash = ? WHERE id = ? AND archived = 0")
    .bind(await hashPasscode(requireSecret(c.env), code), c.req.param("id"))
    .run();
  if (!r.meta.changes) return c.json({ error: "找不到这个学生" }, 404);
  return c.json({ code });
});

admin.delete("/students/:id", async (c) => {
  await c.env.DB.prepare("UPDATE students SET archived = 1 WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- 课程 ---------- */

admin.get("/lessons/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(c.req.param("id")).first<LessonRow>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  return c.json({
    ...lessonListItem(row),
    content: lessonContent(row),
    checks: parseJson<Check[]>(row.checks, []),
    sourceNotes: row.source_notes,
  });
});

admin.get("/lessons/:id/preview", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM lessons WHERE id = ?").bind(c.req.param("id")).first<LessonRow>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  return c.json(await buildPayload(c.env.DB, row, null, { preview: true }));
});

admin.post("/lessons", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const metaParsed = LessonMeta.safeParse(body);
  if (!metaParsed.success) return c.json({ error: "课程信息有误", issues: formatIssues(metaParsed.error) }, 400);
  const meta = metaParsed.data;
  let checks: Check[] = [];
  let content: LessonContent;
  if (body.content !== undefined) {
    // 导入整课（例如在别处做好的 JSON）：校验格式，再用题库核对答案
    const parsed = LessonContent.safeParse(body.content);
    if (!parsed.success) return c.json({ error: "内容格式有误", issues: formatIssues(parsed.error) }, 400);
    content = parsed.data;
    const refs = [...new Set(allProblems(content).map((p) => p.bankRef).filter((r): r is string => !!r))];
    const bank = new Map<string, BankRow>();
    if (refs.length) {
      const rows = await c.env.DB.prepare(
        `SELECT id, book, chapter, section, kind, number, statement, answer, solution, source FROM bank_problems WHERE id IN (${refs.map(() => "?").join(",")})`,
      )
        .bind(...refs)
        .all<BankRow>();
      for (const r of rows.results) bank.set(r.id, r);
    }
    checks = verifyAgainstBank(content, bank);
  } else content = {
    review: { points: [{ body: "在这里写本课要点。" }], figures: [], examples: [], pitfalls: [] },
    practice: {
      sections: [
        {
          id: "a",
          title: "课本练习",
          problems: [{ id: "a1", statement: "Compute $5!$.", kind: "input", answer: "120", steps: ["$5! = 120$。"] }],
        },
      ],
    },
  };
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO lessons (id, number, title, title_en, class_date, chapters, status, content, checks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
  )
    .bind(id, meta.number, meta.title, meta.titleEn ?? null, meta.classDate ?? null, meta.chapters ?? null, JSON.stringify(content), JSON.stringify(checks), now, now)
    .run();
  return c.json({ id, checks });
});

admin.put("/lessons/:id", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(c.req.param("id")).first<LessonRow>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  const body = (await c.req.json()) as { meta?: unknown; content?: unknown; verified?: string[] };
  let meta = { number: row.number, title: row.title, titleEn: row.title_en, classDate: row.class_date, chapters: row.chapters };
  if (body.meta !== undefined) {
    const m = LessonMeta.safeParse(body.meta);
    if (!m.success) return c.json({ error: "课程信息有误", issues: formatIssues(m.error) }, 400);
    meta = { ...meta, ...m.data, titleEn: m.data.titleEn ?? null, classDate: m.data.classDate ?? null, chapters: m.data.chapters ?? null };
  }
  let content = lessonContent(row);
  if (body.content !== undefined) {
    const parsed = LessonContent.safeParse(body.content);
    if (!parsed.success) return c.json({ error: "内容格式有误", issues: formatIssues(parsed.error) }, 400);
    content = parsed.data;
  }
  let checks = parseJson<Check[]>(row.checks, []);
  if (body.verified) {
    const set = new Set(body.verified);
    for (const p of allProblems(content)) if (set.has(p.id)) p.verified = true;
    checks = checks.map((ch) => (set.has(ch.problemId) ? { ...ch, level: "ok", message: "老师已核对" } : ch));
  }
  // 题目被删掉后，相应的检查也去掉
  const ids = new Set(allProblems(content).map((p) => p.id));
  checks = checks.filter((ch) => ids.has(ch.problemId));
  await db
    .prepare("UPDATE lessons SET number = ?, title = ?, title_en = ?, class_date = ?, chapters = ?, content = ?, checks = ?, updated_at = ? WHERE id = ?")
    .bind(meta.number, meta.title, meta.titleEn, meta.classDate, meta.chapters, JSON.stringify(content), JSON.stringify(checks), Date.now(), row.id)
    .run();
  return c.json({ ok: true });
});

admin.post("/lessons/:id/publish", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(c.req.param("id")).first<LessonRow>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  const clash = await db
    .prepare("SELECT id FROM lessons WHERE number = ? AND status = 'published' AND id != ?")
    .bind(row.number, row.id)
    .first<{ id: string }>();
  const { replace } = z.object({ replace: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
  if (clash && !replace) return c.json({ error: `第 ${row.number} 课已经有一个发布的版本`, clash: clash.id }, 409);
  const now = Date.now();
  const stmts = [db.prepare("UPDATE lessons SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?").bind(now, now, row.id)];
  if (clash) {
    // 把旧版本的作答、疑问迁到新版本上（题目 id 相同的作答仍然有效）
    stmts.push(db.prepare("UPDATE lessons SET status = 'draft', updated_at = ? WHERE id = ?").bind(now, clash.id));
    for (const table of ["attempts", "pins", "lesson_views", "submissions"])
      stmts.push(db.prepare(`UPDATE ${table} SET lesson_id = ? WHERE lesson_id = ?`).bind(row.id, clash.id));
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});

admin.post("/lessons/:id/unpublish", async (c) => {
  await c.env.DB.prepare("UPDATE lessons SET status = 'draft', updated_at = ? WHERE id = ?").bind(Date.now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.delete("/lessons/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT status FROM lessons WHERE id = ?").bind(c.req.param("id")).first<{ status: string }>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  if (row.status === "published") return c.json({ error: "已发布的课要先撤回再删除" }, 409);
  await c.env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.get("/lessons/:id/results", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM lessons WHERE id = ?").bind(c.req.param("id")).first<LessonRow>();
  if (!row) return c.json({ error: "找不到这节课" }, 404);
  const problems = allProblems(lessonContent(row));
  const [students, attempts, subs] = await db.batch([
    db.prepare("SELECT id, name FROM students WHERE archived = 0 ORDER BY created_at"),
    db.prepare("SELECT student_id, problem_id, answer, correct, created_at FROM attempts WHERE lesson_id = ? ORDER BY created_at, id").bind(row.id),
    db.prepare("SELECT student_id, MAX(submitted_at) AS t FROM submissions WHERE lesson_id = ? GROUP BY student_id").bind(row.id),
  ]);
  const att = attempts.results as unknown as { student_id: string; problem_id: string; answer: string; correct: number; created_at: number }[];
  const subRows = subs.results as unknown as { student_id: string; t: number }[];
  return c.json({
    problems: problems.map((p, i) => ({ id: p.id, index: i + 1, source: p.source ?? null, answer: p.answer, kind: p.kind })),
    students: (students.results as unknown as { id: string; name: string }[]).map((s) => ({
      id: s.id,
      name: s.name,
      submittedAt: subRows.find((x) => x.student_id === s.id)?.t ?? null,
      results: Object.fromEntries(
        problems.map((p) => {
          const mine = att.filter((a) => a.student_id === s.id && a.problem_id === p.id);
          return [p.id, { attempts: mine.length, correct: mine.some((a) => a.correct === 1), answers: mine.map((a) => a.answer) }];
        }),
      ),
    })),
  });
});

/* ---------- 疑问 ---------- */

admin.get("/pins", async (c) => {
  const status = c.req.query("status");
  return c.json(await loadPins(c.env.DB, status && status !== "all" ? { status } : {}));
});

admin.get("/pins/:id", async (c) => {
  const [pin] = await loadPins(c.env.DB, { pinId: c.req.param("id") });
  if (!pin) return c.json({ error: "找不到这条疑问" }, 404);
  return c.json(pin);
});

admin.post("/pins/:id/reply", async (c) => {
  const db = c.env.DB;
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(await c.req.json());
  const id = c.req.param("id");
  const exists = await db.prepare("SELECT id FROM pins WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "找不到这条疑问" }, 404);
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO pin_messages (pin_id, author, body, created_at) VALUES (?, 'teacher', ?, ?)").bind(id, body, now),
    db.prepare("UPDATE pins SET status = 'answered', updated_at = ? WHERE id = ?").bind(now, id),
  ]);
  const [pin] = await loadPins(db, { pinId: id });
  return c.json(pin);
});

/* ---------- 题库 ---------- */

admin.get("/bank/groups", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT book, chapter, section, kind, COUNT(*) AS n, SUM(CASE WHEN answer IS NULL OR answer = '' THEN 0 ELSE 1 END) AS with_answer
     FROM bank_problems GROUP BY book, chapter, section, kind
     ORDER BY book, CAST(chapter AS INTEGER), chapter, section, kind`,
  ).all<{ book: string; chapter: string | null; section: string | null; kind: string; n: number; with_answer: number }>();
  return c.json(rows.results.map((r) => ({ ...r, key: groupKey(r) })));
});

admin.get("/bank", async (c) => {
  const key = c.req.query("group");
  const q = c.req.query("q");
  if (key) {
    const [book, chapter, section, kind] = key.split("|");
    const rows = await c.env.DB.prepare(
      "SELECT * FROM bank_problems WHERE book = ? AND IFNULL(chapter,'') = ? AND IFNULL(section,'') = ? AND kind = ? ORDER BY CAST(number AS INTEGER), number LIMIT 300",
    )
      .bind(book, chapter ?? "", section ?? "", kind ?? "exercise")
      .all();
    return c.json(rows.results);
  }
  const rows = await c.env.DB.prepare("SELECT * FROM bank_problems WHERE statement LIKE ? OR source LIKE ? ORDER BY created_at DESC LIMIT 100")
    .bind(`%${q ?? ""}%`, `%${q ?? ""}%`)
    .all();
  return c.json(rows.results);
});

admin.post("/bank", async (c) => {
  const raw = await c.req.json();
  const list = z.array(z.unknown()).max(2000).parse(Array.isArray(raw) ? raw : (raw as { problems?: unknown[] }).problems ?? []);
  const errors: string[] = [];
  const valid: z.infer<typeof BankProblem>[] = [];
  list.forEach((item, i) => {
    const r = BankProblem.safeParse(item);
    if (r.success) valid.push(r.data);
    else errors.push(`第 ${i + 1} 条：${formatIssues(r.error, 3).join("；")}`);
  });
  const db = c.env.DB;
  const now = Date.now();
  for (let i = 0; i < valid.length; i += 50) {
    await db.batch(
      valid.slice(i, i + 50).map((p) =>
        db
          .prepare(
            `INSERT INTO bank_problems (id, book, chapter, section, kind, number, statement, answer, solution, source, tags, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET book = excluded.book, chapter = excluded.chapter, section = excluded.section, kind = excluded.kind,
               number = excluded.number, statement = excluded.statement, answer = excluded.answer, solution = excluded.solution,
               source = excluded.source, tags = excluded.tags`,
          )
          .bind(p.id, p.book, p.chapter ?? null, p.section ?? null, p.kind, p.number ?? null, p.statement, p.answer ?? null, p.solution ?? null, p.source ?? null, p.tags ? JSON.stringify(p.tags) : null, now),
      ),
    );
  }
  return c.json({ imported: valid.length, errors: errors.slice(0, 30) });
});

admin.delete("/bank/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM bank_problems WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/* ---------- AI 生成 ---------- */

admin.post("/generate", async (c) => {
  const cfg = modelConfig(c.env);
  if (!cfg) return c.json({ error: "还没有配置大模型：请在 Cloudflare 里设置 AI_API_KEY（以及 AI_BASE_URL、AI_MODEL）" }, 400);
  const parsed = GenerateInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "填写有误", issues: formatIssues(parsed.error) }, 400);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;
  const emit = async (e: GenerateEvent) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`${JSON.stringify(e)}\n`));
    } catch {
      closed = true;
    }
  };
  const started = Date.now();
  const ping = setInterval(() => void emit({ type: "ping", elapsed: Math.round((Date.now() - started) / 1000) }), 8000);
  const task = runGeneration(c.env, cfg, parsed.data, emit).finally(async () => {
    clearInterval(ping);
    closed = true;
    await writer.close().catch(() => {});
  });
  c.executionCtx.waitUntil(task);
  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
});

admin.get("/generations", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, lesson_id, status, model, error, created_at, finished_at FROM generations ORDER BY created_at DESC LIMIT 20",
  ).all();
  return c.json(rows.results);
});

/* ---------- 通知 ---------- */

admin.post("/notify/test", async (c) => {
  if (notifyConfigured(c.env).length === 0)
    return c.json({ error: "还没有配置通知：在 Cloudflare 里设置 WXPUSHER_SPT 或 SERVERCHAN_KEY" }, 400);
  await enqueue(c.env, { kind: "test", title: "【测试】课程站通知", body: "能收到这条，说明微信通知已经接好了。" });
  try {
    const r = await flush(c.env, { force: true });
    return c.json(r);
  } catch (err) {
    return c.json({ error: `发送失败：${String(err)}` }, 502);
  }
});
