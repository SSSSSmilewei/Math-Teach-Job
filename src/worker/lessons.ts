import type { LessonPayload, Pin, PinMessage, ProblemState, PublicProblem, Solution } from "../shared/api";
import { UNLOCK_AFTER_ATTEMPTS } from "../shared/answers";
import type { LessonContent, Problem } from "../shared/schema";
import { parseJson } from "./db";

export interface LessonRow {
  id: string;
  number: number;
  title: string;
  title_en: string | null;
  class_date: string | null;
  chapters: string | null;
  status: "draft" | "published";
  content: string;
  checks: string | null;
  source_notes: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export interface AttemptRow {
  problem_id: string;
  answer: string;
  correct: number;
  created_at: number;
}

export function lessonContent(row: LessonRow): LessonContent {
  return parseJson<LessonContent>(row.content, { review: { points: [], figures: [], examples: [], pitfalls: [] }, practice: { sections: [] } });
}

export function allProblems(content: LessonContent): Problem[] {
  return content.practice.sections.flatMap((s) => s.problems);
}

export function findProblem(content: LessonContent, id: string): { problem: Problem; index: number } | null {
  const list = allProblems(content);
  const index = list.findIndex((p) => p.id === id);
  return index < 0 ? null : { problem: list[index], index };
}

export function toPublic(p: Problem): PublicProblem {
  const { answer: _a, accept: _b, steps: _c, figure: _d, verified: _e, bankRef: _f, ...rest } = p;
  return rest;
}

export function solutionOf(p: Problem): Solution {
  let answer = p.answer;
  if (p.kind === "choice" && p.choices) {
    const idx = "ABCDEF".indexOf(p.answer.trim().toUpperCase());
    answer = `(${p.answer.trim().toUpperCase()}) ${p.choices[idx] ?? ""}`.trim();
  }
  return { steps: p.steps, figure: p.figure, answer };
}

export function problemState(p: Problem, attempts: AttemptRow[], unlockAll = false): ProblemState {
  const mine = attempts.filter((a) => a.problem_id === p.id);
  const correct = mine.some((a) => a.correct === 1);
  const unlocked = unlockAll || correct || mine.length >= UNLOCK_AFTER_ATTEMPTS;
  return {
    attempts: mine.length,
    correct,
    answers: mine.map((a) => a.answer),
    ...(unlocked ? { solution: solutionOf(p) } : {}),
  };
}

export async function loadPins(
  db: D1Database,
  where: { studentId?: string; lessonId?: string; status?: string; pinId?: string },
): Promise<Pin[]> {
  const cond: string[] = [];
  const args: unknown[] = [];
  if (where.studentId) {
    cond.push("p.student_id = ?");
    args.push(where.studentId);
  }
  if (where.lessonId) {
    cond.push("p.lesson_id = ?");
    args.push(where.lessonId);
  }
  if (where.status) {
    cond.push("p.status = ?");
    args.push(where.status);
  }
  if (where.pinId) {
    cond.push("p.id = ?");
    args.push(where.pinId);
  }
  const sql = `SELECT p.*, s.name AS student_name, l.number AS lesson_number
    FROM pins p LEFT JOIN students s ON s.id = p.student_id LEFT JOIN lessons l ON l.id = p.lesson_id
    ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""} ORDER BY p.created_at DESC LIMIT 200`;
  const rows = await db
    .prepare(sql)
    .bind(...args)
    .all<{
      id: string;
      lesson_id: string;
      lesson_number: number | null;
      anchor_key: string;
      anchor_label: string | null;
      x_pct: number;
      y_pct: number;
      snippet: string | null;
      status: Pin["status"];
      created_at: number;
      updated_at: number;
      student_seen_at: number | null;
      student_name: string | null;
    }>();
  if (rows.results.length === 0) return [];
  const ids = rows.results.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const msgs = await db
    .prepare(`SELECT id, pin_id, author, body, created_at FROM pin_messages WHERE pin_id IN (${placeholders}) ORDER BY created_at, id`)
    .bind(...ids)
    .all<{ id: number; pin_id: string; author: "student" | "teacher"; body: string; created_at: number }>();
  const byPin = new Map<string, PinMessage[]>();
  for (const m of msgs.results) {
    const list = byPin.get(m.pin_id) ?? [];
    list.push({ id: m.id, author: m.author, body: m.body, createdAt: m.created_at });
    byPin.set(m.pin_id, list);
  }
  return rows.results.map((r) => {
    const messages = byPin.get(r.id) ?? [];
    const lastTeacher = Math.max(0, ...messages.filter((m) => m.author === "teacher").map((m) => m.createdAt));
    return {
      id: r.id,
      lessonId: r.lesson_id,
      lessonNumber: r.lesson_number ?? undefined,
      anchorKey: r.anchor_key,
      anchorLabel: r.anchor_label,
      xPct: r.x_pct,
      yPct: r.y_pct,
      snippet: r.snippet,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      unseenReply: lastTeacher > (r.student_seen_at ?? 0),
      messages,
      studentName: r.student_name ?? undefined,
    };
  });
}

export async function buildPayload(
  db: D1Database,
  row: LessonRow,
  studentId: string | null,
  opts: { preview?: boolean } = {},
): Promise<LessonPayload> {
  const content = lessonContent(row);
  let attempts: AttemptRow[] = [];
  let pins: Pin[] = [];
  let practiceStartedAt: number | null = null;
  let submittedAt: number | null = null;
  if (studentId) {
    const [a, v, s] = await db.batch([
      db
        .prepare("SELECT problem_id, answer, correct, created_at FROM attempts WHERE student_id = ? AND lesson_id = ? ORDER BY created_at, id")
        .bind(studentId, row.id),
      db.prepare("SELECT first_at FROM lesson_views WHERE student_id = ? AND lesson_id = ? AND tab = 'practice'").bind(studentId, row.id),
      db.prepare("SELECT MAX(submitted_at) AS t FROM submissions WHERE student_id = ? AND lesson_id = ?").bind(studentId, row.id),
    ]);
    attempts = a.results as unknown as AttemptRow[];
    practiceStartedAt = (v.results[0] as { first_at?: number } | undefined)?.first_at ?? null;
    submittedAt = (s.results[0] as { t?: number | null } | undefined)?.t ?? null;
    pins = await loadPins(db, { studentId, lessonId: row.id });
  }
  const state: Record<string, ProblemState> = {};
  for (const p of allProblems(content)) state[p.id] = problemState(p, attempts, !!opts.preview);
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    titleEn: row.title_en,
    classDate: row.class_date,
    chapters: row.chapters,
    status: row.status,
    review: content.review,
    sections: content.practice.sections.map((s) => ({
      id: s.id,
      title: s.title,
      note: s.note,
      problems: s.problems.map(toPublic),
    })),
    state,
    pins,
    practiceStartedAt,
    submittedAt,
    ...(opts.preview ? { preview: true } : {}),
  };
}

export function lessonLabel(n: number): string {
  return `第 ${String(n).padStart(2, "0")} 课`;
}
