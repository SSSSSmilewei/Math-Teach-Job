import { z } from "zod";

/**
 * 课程内容的数据格式。前端渲染、后端校验、AI 生成都以这里为准。
 *
 * Rich 文本：普通文字 + `$...$` 行内公式 + `$$...$$` 独立公式（KaTeX 语法），
 * `**粗体**`，空行分段。不接受 HTML。
 */
export const Rich = z.string().min(1).max(20000);

const shortText = (max: number) => z.string().min(1).max(max);

export const FigureSpec = z.discriminatedUnion("type", [
  // 有重复字母的排列，例如 BANANA
  z.object({
    type: z.literal("multiset"),
    word: z.string().regex(/^[A-Za-z0-9]{2,12}$/, "word 只能是 2–12 个字母或数字"),
  }),
  // 网格最短路径；多段时依次相连（例如穿过公园）
  z.object({
    type: z.literal("grid-path"),
    segments: z
      .array(
        z.object({
          cols: z.number().int().min(1).max(8),
          rows: z.number().int().min(1).max(8),
          label: shortText(40).optional(),
        }),
      )
      .min(1)
      .max(3),
    connector: shortText(30).optional(),
  }),
  // 从 pool 里选 k 个，排成递增（组合 = 递增排列）
  z.object({
    type: z.literal("choose"),
    pool: z.array(z.union([shortText(4), z.number()])).min(2).max(10),
    k: z.number().int().min(1).max(6),
    prefix: z.string().max(6).optional(),
  }),
  // n 个人选 k 个，再看 k 个人的 k! 种排法：P = C · k!
  z.object({
    type: z.literal("select-arrange"),
    n: z.number().int().min(2).max(10),
    k: z.number().int().min(1).max(4),
  }),
  // 乘法原理：逐格填入选法数
  z.object({
    type: z.literal("slots"),
    slots: z
      .array(z.object({ label: shortText(12), count: z.number().int().min(1).max(100) }))
      .min(1)
      .max(8),
  }),
  // 隔板法
  z.object({
    type: z.literal("stars-bars"),
    stars: z.number().int().min(1).max(12),
    bins: z.number().int().min(2).max(6),
  }),
  // 帕斯卡三角；highlight 为 [行, 列]，都从 0 数
  z.object({
    type: z.literal("pascal"),
    rows: z.number().int().min(2).max(12),
    highlight: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(12).optional(),
  }),
  // 圆排列：转一圈算同一种
  z.object({
    type: z.literal("circle"),
    n: z.number().int().min(3).max(8),
  }),
  // 补集：全部 − 不满足的
  z.object({
    type: z.literal("complement"),
    total: z.number().int().positive(),
    excluded: z.number().int().min(0),
    totalLabel: shortText(30),
    excludedLabel: shortText(30),
  }),
]);
export type FigureSpec = z.infer<typeof FigureSpec>;

export const FIGURE_TYPES = [
  "multiset",
  "grid-path",
  "choose",
  "select-arrange",
  "slots",
  "stars-bars",
  "pascal",
  "circle",
  "complement",
] as const;

/** 检查图的参数之间是否自洽（zod 的 discriminatedUnion 里不方便写）。 */
export function figureProblems(spec: FigureSpec): string[] {
  const out: string[] = [];
  if (spec.type === "choose" && spec.k > spec.pool.length) out.push("choose: k 不能大于 pool 的长度");
  if (spec.type === "select-arrange" && spec.k > spec.n) out.push("select-arrange: k 不能大于 n");
  if (spec.type === "complement" && spec.excluded > spec.total) out.push("complement: excluded 不能大于 total");
  if (spec.type === "pascal")
    for (const [r, k] of spec.highlight ?? [])
      if (r >= spec.rows || k > r) out.push(`pascal: 高亮位置 [${r}, ${k}] 不在三角里`);
  return out;
}

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/, "id 只能用小写字母、数字和 -");

export const Problem = z
  .object({
    id,
    source: shortText(80).optional(),
    bankRef: shortText(60).optional(),
    statement: Rich,
    statementZh: Rich.optional(),
    kind: z.enum(["input", "choice"]),
    choices: z.array(Rich).min(2).max(6).optional(),
    answer: z.string().min(1).max(100),
    accept: z.array(z.string().min(1).max(100)).max(8).optional(),
    hint: Rich.optional(),
    steps: z.array(Rich).min(1).max(12),
    tags: z.array(shortText(20)).max(6).optional(),
    figure: FigureSpec.optional(),
    verified: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.kind === "choice") {
      if (!p.choices) ctx.addIssue({ code: "custom", message: "选择题需要 choices", path: ["choices"] });
      else {
        const idx = "ABCDEF".indexOf(p.answer.trim().toUpperCase());
        if (idx < 0 || idx >= p.choices.length)
          ctx.addIssue({ code: "custom", message: "选择题的 answer 必须是 A–F 中对应选项的字母", path: ["answer"] });
      }
    }
    if (p.figure) for (const m of figureProblems(p.figure)) ctx.addIssue({ code: "custom", message: m, path: ["figure"] });
  });
export type Problem = z.infer<typeof Problem>;

export const PracticeSection = z.object({
  id,
  title: shortText(30),
  note: shortText(80).optional(),
  problems: z.array(Problem).min(1).max(20),
});
export type PracticeSection = z.infer<typeof PracticeSection>;

export const ReviewFigure = z
  .object({
    id,
    title: shortText(40),
    caption: Rich,
    figure: FigureSpec,
  })
  .superRefine((f, ctx) => {
    for (const m of figureProblems(f.figure)) ctx.addIssue({ code: "custom", message: m, path: ["figure"] });
  });

export const Example = z.object({
  id,
  source: shortText(80).optional(),
  statement: Rich,
  statementZh: Rich.optional(),
  steps: z.array(Rich).min(1).max(12),
});

export const Review = z.object({
  points: z.array(z.object({ title: shortText(40).optional(), body: Rich })).max(8),
  figures: z.array(ReviewFigure).max(6),
  examples: z.array(Example).max(4),
  pitfalls: z.array(Rich).max(6),
});
export type Review = z.infer<typeof Review>;

export const LessonContent = z
  .object({
    review: Review,
    practice: z.object({ sections: z.array(PracticeSection).min(1).max(4) }),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.practice.sections.forEach((s, si) =>
      s.problems.forEach((p, pi) => {
        if (seen.has(p.id))
          ctx.addIssue({ code: "custom", message: `题目 id 重复：${p.id}`, path: ["practice", "sections", si, "problems", pi, "id"] });
        seen.add(p.id);
      }),
    );
    const figs = new Set<string>();
    c.review.figures.forEach((f, i) => {
      if (figs.has(f.id)) ctx.addIssue({ code: "custom", message: `图 id 重复：${f.id}`, path: ["review", "figures", i, "id"] });
      figs.add(f.id);
    });
  });
export type LessonContent = z.infer<typeof LessonContent>;

export const LessonMeta = z.object({
  number: z.number().int().min(0).max(999),
  title: shortText(60),
  titleEn: z.string().max(100).optional().nullable(),
  classDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  chapters: z.string().max(60).optional().nullable(),
});
export type LessonMeta = z.infer<typeof LessonMeta>;

/** 题库条目（老师从课本导入）。 */
export const BankProblem = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  book: shortText(40),
  chapter: z.string().max(20).optional().nullable(),
  section: z.string().max(40).optional().nullable(),
  kind: z.enum(["example", "exercise", "review", "challenge", "contest"]).default("exercise"),
  number: z.string().max(20).optional().nullable(),
  statement: z.string().min(1).max(8000),
  answer: z.string().max(200).optional().nullable(),
  solution: z.string().max(12000).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional().nullable(),
});
export type BankProblem = z.infer<typeof BankProblem>;

/** 把 zod 错误整理成老师看得懂的几行字。 */
export function formatIssues(err: z.ZodError, limit = 12): string[] {
  return err.issues.slice(0, limit).map((i) => `${i.path.join(".") || "(根)"}：${i.message}`);
}
