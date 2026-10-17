import { Hono } from "hono";
import { z } from "zod";
import type { AttemptResult, LessonSummary, RedoItem } from "../../shared/api";
import { checkAnswer } from "../../shared/answers";
import { requireStudent, studentId } from "../auth";
import type { AppEnv } from "../env";
import {
  type AttemptRow,
  type LessonRow,
  allProblems,
  buildPayload,
  findProblem,
  lessonContent,
  lessonLabel,
  loadPins,
  problemState,
} from "../lessons";
import { adminLink, enqueue, flush } from "../notify";

export const student = new Hono<AppEnv>();
// 只守住学生自己的路径；挂到 /api 下后不能写 "*"，否则会拦到 /api/admin
for (const path of ["/lessons", "/lessons/*", "/pins", "/pins/*", "/redo"]) student.use(path, requireStudent);

async function publishedLesson(db: D1Database, number: number) {
  return db
    .prepare("SELECT * FROM lessons WHERE number = ? AND status = 'published' ORDER BY published_at DESC LIMIT 1")
    .bind(number)
    .first<LessonRow>();
}

student.get("/lessons", async (c) => {
  const sid = studentId(c);
  const db = c.env.DB;
  const [lessons, attempts, pins, subs] = await db.batch([
    db.prepare("SELECT * FROM lessons WHERE status = 'published' ORDER BY number DESC"),
    db
      .prepare("SELECT lesson_id, problem_id, MAX(correct) AS ok FROM attempts WHERE student_id = ? GROUP BY lesson_id, problem_id")
      .bind(sid),
    db
      .prepare(
        `SELECT p.lesson_id, p.status, p.student_seen_at,
          (SELECT MAX(created_at) FROM pin_messages m WHERE m.pin_id = p.id AND m.author = 'teacher') AS last_reply
         FROM pins p WHERE p.student_id = ?`,
      )
      .bind(sid),
    db.prepare("SELECT lesson_id, MAX(submitted_at) AS t FROM submissions WHERE student_id = ? GROUP BY lesson_id").bind(sid),
  ]);
  const att = attempts.results as unknown as { lesson_id: string; problem_id: string; ok: number }[];
  const pinRows = pins.results as unknown as { lesson_id: string; status: string; student_seen_at: number | null; last_reply: number | null }[];
  const subRows = subs.results as unknown as { lesson_id: string; t: number }[];
  const out: LessonSummary[] = (lessons.results as unknown as LessonRow[]).map((row) => {
    const content = lessonContent(row);
    const ids = new Set(allProblems(content).map((p) => p.id));
    const mine = att.filter((a) => a.lesson_id === row.id && ids.has(a.problem_id));
    const lp = pinRows.filter((p) => p.lesson_id === row.id);
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      titleEn: row.title_en,
      classDate: row.class_date,
      chapters: row.chapters,
      publishedAt: row.published_at,
      problemCount: ids.size,
      correct: mine.filter((a) => a.ok === 1).length,
      attempted: mine.length,
      pinCount: lp.length,
      openPins: lp.filter((p) => p.status === "open").length,
      unseenReplies: lp.filter((p) => (p.last_reply ?? 0) > (p.student_seen_at ?? 0)).length,
      submittedAt: subRows.find((s) => s.lesson_id === row.id)?.t ?? null,
      reviewStats: {
        points: content.review.points.length,
        figures: content.review.figures.length,
        examples: content.review.examples.length,
      },
    };
  });
  return c.json(out);
});

student.get("/lessons/:number", async (c) => {
  const row = await publishedLesson(c.env.DB, Number(c.req.param("number")));
  if (!row) return c.json({ error: "这节课还没有发布" }, 404);
  return c.json(await buildPayload(c.env.DB, row, studentId(c)));
});

student.post("/lessons/:number/view", async (c) => {
  const row = await publishedLesson(c.env.DB, Number(c.req.param("number")));
  if (!row) return c.json({ error: "这节课还没有发布" }, 404);
  const { tab } = z.object({ tab: z.enum(["review", "practice", "questions"]) }).parse(await c.req.json());
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO lesson_views (student_id, lesson_id, tab, first_at, last_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_id, lesson_id, tab) DO UPDATE SET last_at = excluded.last_at`,
  )
    .bind(studentId(c), row.id, tab, now, now)
    .run();
  return c.json({ ok: true });
});

student.post("/lessons/:number/attempts", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const row = await publishedLesson(db, Number(c.req.param("number")));
  if (!row) return c.json({ error: "这节课还没有发布" }, 404);
  const body = z.object({ problemId: z.string().max(40), answer: z.string().trim().min(1).max(100) }).parse(await c.req.json());
  const found = findProblem(lessonContent(row), body.problemId);
  if (!found) return c.json({ error: "找不到这道题" }, 404);
  const { problem } = found;
  const previous = (
    await db
      .prepare("SELECT problem_id, answer, correct, created_at FROM attempts WHERE student_id = ? AND lesson_id = ? AND problem_id = ? ORDER BY created_at, id")
      .bind(sid, row.id, problem.id)
      .all<AttemptRow>()
  ).results;
  if (previous.some((a) => a.correct === 1)) {
    const result: AttemptResult = { correct: true, state: problemState(problem, previous) };
    return c.json(result);
  }
  const correct = checkAnswer(problem, body.answer);
  const now = Date.now();
  await db
    .prepare("INSERT INTO attempts (student_id, lesson_id, problem_id, answer, correct, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sid, row.id, problem.id, body.answer, correct ? 1 : 0, now)
    .run();
  const all = [...previous, { problem_id: problem.id, answer: body.answer, correct: correct ? 1 : 0, created_at: now }];
  const result: AttemptResult = { correct, state: problemState(problem, all) };
  return c.json(result);
});

student.post("/lessons/:number/submit", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const row = await publishedLesson(db, Number(c.req.param("number")));
  if (!row) return c.json({ error: "这节课还没有发布" }, 404);
  const content = lessonContent(row);
  const problems = allProblems(content);
  const [att, view, me] = await db.batch([
    db
      .prepare("SELECT problem_id, answer, correct, created_at FROM attempts WHERE student_id = ? AND lesson_id = ? ORDER BY created_at, id")
      .bind(sid, row.id),
    db.prepare("SELECT first_at FROM lesson_views WHERE student_id = ? AND lesson_id = ? AND tab = 'practice'").bind(sid, row.id),
    db.prepare("SELECT name FROM students WHERE id = ?").bind(sid),
  ]);
  const attempts = att.results as unknown as AttemptRow[];
  const items = problems.map((p, i) => {
    const mine = attempts.filter((a) => a.problem_id === p.id);
    const correct = mine.some((a) => a.correct === 1);
    return {
      index: i + 1,
      problemId: p.id,
      source: p.source ?? null,
      attempts: mine.length,
      correct,
      firstTry: mine[0]?.correct === 1,
      lastAnswer: mine.at(-1)?.answer ?? null,
    };
  });
  const correctCount = items.filter((i) => i.correct).length;
  const startedAt = (view.results[0] as { first_at?: number } | undefined)?.first_at ?? null;
  const now = Date.now();
  const minutes = startedAt ? Math.max(1, Math.round((now - startedAt) / 60000)) : null;
  const summary = { items, minutes };
  await db
    .prepare("INSERT INTO submissions (student_id, lesson_id, submitted_at, correct, total, summary) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sid, row.id, now, correctCount, problems.length, JSON.stringify(summary))
    .run();

  const name = (me.results[0] as { name?: string } | undefined)?.name ?? "学生";
  const wrong = items.filter((i) => i.attempts > 0 && !i.correct);
  const blank = items.filter((i) => i.attempts === 0);
  const lines = [
    `做对 ${correctCount} / ${problems.length}${minutes ? `，用时约 ${minutes} 分钟` : ""}`,
    wrong.length ? `做错：${wrong.map((w) => `第 ${w.index} 题（答 ${w.lastAnswer}）`).join("、")}` : "",
    blank.length ? `没做：${blank.map((b) => `第 ${b.index} 题`).join("、")}` : "",
  ].filter(Boolean);
  await enqueue(c.env, {
    kind: "submission",
    title: `【交作业】${name}，${lessonLabel(row.number)}`,
    body: lines.join("\n"),
    link: adminLink(c.env, `/admin/lessons/${row.id}`),
  });
  c.executionCtx.waitUntil(flush(c.env, { force: true }).catch((e) => console.error(JSON.stringify({ msg: "flush failed", error: String(e) }))));
  return c.json({ submittedAt: now, correct: correctCount, total: problems.length, minutes });
});

const PinInput = z.object({
  lessonId: z.string().max(60),
  anchorKey: z.string().min(1).max(120),
  anchorLabel: z.string().max(60).nullable().optional(),
  xPct: z.number().min(0).max(1),
  yPct: z.number().min(0).max(1),
  snippet: z.string().max(200).nullable().optional(),
  body: z.string().trim().min(1, "写一句你的疑问").max(1000),
});

student.post("/pins", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const input = PinInput.parse(await c.req.json());
  const lesson = await db
    .prepare("SELECT id, number FROM lessons WHERE id = ? AND status = 'published'")
    .bind(input.lessonId)
    .first<{ id: string; number: number }>();
  if (!lesson) return c.json({ error: "这节课还没有发布" }, 404);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO pins (id, student_id, lesson_id, anchor_key, anchor_label, x_pct, y_pct, snippet, status, created_at, updated_at, student_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .bind(id, sid, lesson.id, input.anchorKey, input.anchorLabel ?? null, input.xPct, input.yPct, input.snippet ?? null, now, now, now),
    db.prepare("INSERT INTO pin_messages (pin_id, author, body, created_at) VALUES (?, 'student', ?, ?)").bind(id, input.body, now),
  ]);
  const name = (await db.prepare("SELECT name FROM students WHERE id = ?").bind(sid).first<{ name: string }>())?.name ?? "学生";
  await enqueue(c.env, {
    kind: "pin",
    title: `【疑问】${name}，${lessonLabel(lesson.number)}${input.anchorLabel ? ` ${input.anchorLabel}` : ""}`,
    body: input.body,
    link: adminLink(c.env, `/admin/pins/${id}`),
  });
  c.executionCtx.waitUntil(flush(c.env, { force: false }).catch((e) => console.error(JSON.stringify({ msg: "flush failed", error: String(e) }))));
  const [pin] = await loadPins(db, { pinId: id });
  return c.json(pin);
});

async function ownPin(c: { env: AppEnv["Bindings"] }, sid: string, id: string) {
  return c.env.DB.prepare("SELECT p.id, p.lesson_id, p.anchor_label, l.number FROM pins p JOIN lessons l ON l.id = p.lesson_id WHERE p.id = ? AND p.student_id = ?")
    .bind(id, sid)
    .first<{ id: string; lesson_id: string; anchor_label: string | null; number: number }>();
}

student.post("/pins/:id/messages", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const pin = await ownPin(c, sid, c.req.param("id"));
  if (!pin) return c.json({ error: "找不到这条疑问" }, 404);
  const { body } = z.object({ body: z.string().trim().min(1).max(1000) }).parse(await c.req.json());
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO pin_messages (pin_id, author, body, created_at) VALUES (?, 'student', ?, ?)").bind(pin.id, body, now),
    db.prepare("UPDATE pins SET status = 'open', updated_at = ?, student_seen_at = ? WHERE id = ?").bind(now, now, pin.id),
  ]);
  const name = (await db.prepare("SELECT name FROM students WHERE id = ?").bind(sid).first<{ name: string }>())?.name ?? "学生";
  await enqueue(c.env, {
    kind: "followup",
    title: `【追问】${name}，${lessonLabel(pin.number)}${pin.anchor_label ? ` ${pin.anchor_label}` : ""}`,
    body,
    link: adminLink(c.env, `/admin/pins/${pin.id}`),
  });
  c.executionCtx.waitUntil(flush(c.env, { force: false }).catch((e) => console.error(JSON.stringify({ msg: "flush failed", error: String(e) }))));
  const [full] = await loadPins(db, { pinId: pin.id });
  return c.json(full);
});

student.post("/pins/:id/resolve", async (c) => {
  const sid = studentId(c);
  const pin = await ownPin(c, sid, c.req.param("id"));
  if (!pin) return c.json({ error: "找不到这条疑问" }, 404);
  const now = Date.now();
  await c.env.DB.prepare("UPDATE pins SET status = 'resolved', updated_at = ?, student_seen_at = ? WHERE id = ?").bind(now, now, pin.id).run();
  const [full] = await loadPins(c.env.DB, { pinId: pin.id });
  return c.json(full);
});

student.delete("/pins/:id", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const pin = await ownPin(c, sid, c.req.param("id"));
  if (!pin) return c.json({ error: "找不到这条疑问" }, 404);
  const replied = await db.prepare("SELECT 1 AS x FROM pin_messages WHERE pin_id = ? AND author = 'teacher' LIMIT 1").bind(pin.id).first();
  if (replied) return c.json({ error: "老师已经回复了，这条疑问不能撤回" }, 409);
  await db.batch([db.prepare("DELETE FROM pin_messages WHERE pin_id = ?").bind(pin.id), db.prepare("DELETE FROM pins WHERE id = ?").bind(pin.id)]);
  return c.json({ ok: true });
});

student.post("/pins/seen", async (c) => {
  const { ids } = z.object({ ids: z.array(z.string().max(60)).max(100) }).parse(await c.req.json());
  if (ids.length === 0) return c.json({ ok: true });
  const now = Date.now();
  const sid = studentId(c);
  await c.env.DB.batch(ids.map((id) => c.env.DB.prepare("UPDATE pins SET student_seen_at = ? WHERE id = ? AND student_id = ?").bind(now, id, sid)));
  return c.json({ ok: true });
});

student.get("/redo", async (c) => {
  const db = c.env.DB;
  const sid = studentId(c);
  const [lessons, attempts] = await db.batch([
    db.prepare("SELECT * FROM lessons WHERE status = 'published' ORDER BY number DESC"),
    db
      .prepare("SELECT lesson_id, problem_id, MAX(correct) AS ok, SUM(1 - correct) AS wrong FROM attempts WHERE student_id = ? GROUP BY lesson_id, problem_id")
      .bind(sid),
  ]);
  const att = attempts.results as unknown as { lesson_id: string; problem_id: string; ok: number; wrong: number }[];
  const out: RedoItem[] = [];
  for (const row of lessons.results as unknown as LessonRow[]) {
    const problems = allProblems(lessonContent(row));
    problems.forEach((p, i) => {
      const a = att.find((x) => x.lesson_id === row.id && x.problem_id === p.id);
      if (a && a.ok !== 1)
        out.push({
          lessonNumber: row.number,
          lessonTitle: row.title,
          problemId: p.id,
          index: i + 1,
          source: p.source ?? null,
          statement: p.statement,
          wrongAttempts: a.wrong,
        });
    });
  }
  return c.json(out);
});
