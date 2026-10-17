import { z } from "zod";
import { answersMatch } from "../shared/answers";
import { LessonContent, PracticeSection, Review, formatIssues, type Problem } from "../shared/schema";
import { type ModelConfig, ModelError, complete, extractJson } from "./ai";
import type { Env } from "./env";

export const GenerateInput = z.object({
  number: z.number().int().min(0).max(999),
  classDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  groups: z.array(z.string().max(200)).max(30).default([]),
  summary: z.string().trim().min(20, "请贴上课堂纪要（至少 20 个字）").max(30000),
  bookCount: z.number().int().min(0).max(12).default(6),
  contestCount: z.number().int().min(0).max(8).default(4),
  notes: z.string().max(1000).optional().default(""),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

export interface Check {
  problemId: string;
  level: "ok" | "warn";
  message: string;
}

export type GenerateEvent =
  | { type: "stage"; text: string }
  | { type: "ping"; elapsed: number }
  | { type: "done"; lessonId: string; checks: Check[] }
  | { type: "error"; message: string; detail?: string[] };

interface BankRow {
  id: string;
  book: string;
  chapter: string | null;
  section: string | null;
  kind: string;
  number: string | null;
  statement: string;
  answer: string | null;
  solution?: string | null;
  source: string | null;
}

/** 课本里依赖图、题库没能用文字描述的题，题干以此开头。 */
const NEEDS_FIGURE = "【需配图";
/** 题库答案不是课本给出的，而是解题后填的。 */
const unofficial = (b: BankRow) => !!b.solution?.startsWith("答案由 Claude 解出");

/** 多问题的答案 "(a) 12 (b) 6" 拆成 {a: "12", b: "6"}；不是多问返回 null。 */
export function answerParts(answer: string): Record<string, string> | null {
  const re = /\(([a-z])\)\s*(.*?)(?=\s*\([a-z]\)|$)/gs;
  const parts: Record<string, string> = {};
  for (const m of answer.matchAll(re)) parts[m[1]] = m[2].trim();
  return Object.keys(parts).length >= 2 ? parts : null;
}

const KIND_ZH: Record<string, string> = { example: "例题", exercise: "练习", review: "复习题", challenge: "挑战题", contest: "竞赛真题" };

export function groupKey(r: { book: string; chapter: string | null; section: string | null; kind: string }): string {
  return [r.book, r.chapter ?? "", r.section ?? "", r.kind].join("|");
}

const FIGURE_CATALOG = `- {"type":"multiset","word":"BANANA"}：有重复字母的排列，n! 除以各重复字母个数的阶乘。word 为 2–12 个字母。
- {"type":"grid-path","segments":[{"cols":4,"rows":3}]}：网格最短路径数 C(cols+rows, rows)。必须经过某点或中间有捷径时写成多段（最多 3 段），每段可加 "label"，段之间可加 "connector"（例如 "穿过公园"）。cols、rows 为 1–8。
- {"type":"choose","pool":[4,5,6,7,8,9],"k":2,"prefix":"23"}：从 pool 选 k 个排成递增，递增排列和组合一一对应。prefix 是固定在前面的字符，可省略。pool 最多 10 个。
- {"type":"select-arrange","n":6,"k":3}：n 个人选 k 个再排队，P(n,k)=C(n,k)·k!。n ≤ 10，k ≤ 4。
- {"type":"slots","slots":[{"label":"第 1 位","count":10},{"label":"第 2 位","count":9}]}：乘法原理逐格填数，最多 8 格。
- {"type":"stars-bars","stars":7,"bins":3}：隔板法，把相同的球分给不同的盒子（可以为空），C(stars+bins−1, bins−1)。stars ≤ 12，bins ≤ 6。
- {"type":"pascal","rows":7,"highlight":[[6,2],[6,4]]}：帕斯卡三角，rows 为 2–12，highlight 为 [行, 列]，都从 0 数。
- {"type":"circle","n":5}：n 人围圆桌，旋转算同一种，(n−1)!。n 为 3–8。
- {"type":"complement","total":9000,"excluded":5832,"totalLabel":"所有四位数","excludedLabel":"一个 7 都没有"}：补集，全部减去不满足的。`;

const SYSTEM = `你是带 AMC 10/12 的资深竞赛数学教练，在给一名 10 年级 IB MYP 学生准备课后材料。学生基础扎实、学得快、挑剔，不喜欢重复学校内容和空话，喜欢题目和例子结合、把“为什么”讲清楚。

只输出一个 JSON 对象，不要输出任何其他文字，不要用 Markdown 代码块。

所有文字字段的写法：
- 公式用 KaTeX：行内 $...$，单独一行 $$...$$。组合数写 \\binom{n}{k}，排列写 P(n,k)。
- 可以用 **粗体**。不要用 HTML、Markdown 标题或列表。
- 讲解用简体中文，简洁直接；AMC 和课本原题的题干保留英文原文。
- 注意 JSON 字符串里的反斜杠要写成两个，例如 "$\\\\binom{8}{2}$"。`;

function lessonLabel(n: number) {
  return `第 ${String(n).padStart(2, "0")} 课`;
}

function bankLines(rows: BankRow[], withAnswer: boolean, maxChars = 600): string {
  return rows
    .map((r) => {
      const st = r.statement.replace(/\s+/g, " ").slice(0, maxChars);
      const tag = [r.chapter && `Ch.${r.chapter}`, r.section, r.kind, r.number && `#${r.number}`, r.source].filter(Boolean).join(" ");
      return `[${r.id}] (${tag}) ${st}${withAnswer && r.answer ? ` || 答案：${r.answer}` : ""}${withAnswer && r.answer && answerParts(r.answer) ? "（多问）" : ""}`;
    })
    .join("\n");
}

function reviewPrompt(input: GenerateInput, bank: BankRow[], previous: string[], groupsText: string): string {
  return `## 任务
根据课堂纪要和教材范围，写${lessonLabel(input.number)}的「课堂复习」。只复习课上实际讲过的内容，纪要里没有的不要编；纪要里学生卡住、问过的地方要重点讲清楚。

## 课堂信息
上课日期：${input.classDate ?? "未填"}
教材范围：${groupsText || "（老师没有选）"}
之前的课：${previous.length ? previous.join("；") : "无"}
老师的额外要求：${input.notes || "无"}

## 腾讯会议纪要
<<<
${input.summary}
>>>

## 教材里相关的例题和习题（供参考）
${bank.length ? bankLines(bank.slice(0, 40), false, 400) : "（题库里没有这些章节）"}

## 可以用的图
图的作用是让学生“看见”为什么这样计数。选和本课最贴合的 2–4 张，参数必须严格符合说明：
${FIGURE_CATALOG}

## 输出格式
{
  "title": "本课中文标题，12 字以内",
  "titleEn": "English title",
  "review": {
    "points": [{"title": "可省略，8 字以内", "body": "一条结论或方法，1–3 句，带公式"}],
    "figures": [{"id": "f1", "title": "图的标题，14 字以内", "caption": "一两句话说明这张图说明了什么", "figure": {"type": "..."}}],
    "examples": [{"id": "e1", "source": "出处，例如 2017 AMC 10A 第 8 题；课上自编的写“课上例题”", "statement": "题干", "statementZh": "题干是英文时给中文意思，可省略", "steps": ["每步一个想法，3–6 步"]}],
    "pitfalls": ["易错点：一句话说清怎么判断"]
  }
}
points 3–5 条，examples 1–2 道（课上讲过的），pitfalls 1–3 条。`;
}

function practicePrompt(input: GenerateInput, allBank: BankRow[], groupsText: string): string {
  // 依赖图的题和没答案的题不给 AI 选
  const bank = allBank.filter((b) => b.answer && !b.statement.startsWith(NEEDS_FIGURE));
  const hasBook = bank.some((b) => b.kind !== "contest");
  const bookRule = hasBook
    ? `只能从下面题库里选，每道写上 bankRef（题库里方括号中的 id），题干照抄题库原文。标了“多问”的题只出其中一问：题干改写成只问这一问（保留英文原文的说法），answer 填这一问的答案；问的是证明、解释或公式的小问不要选。由易到难，覆盖本课的每个要点，最后 1–2 道要有挑战性。`
    : `题库里没有这些章节的题。请按本课内容出 AoPS 课本风格的基础题，source 写“自编”，不写 bankRef。`;
  return `## 任务
给${lessonLabel(input.number)}出「课后练习」，分两部分：
1. 课本练习 ${input.bookCount} 道：${bookRule}
2. AMC 真题 ${input.contestCount} 道：选你确定记得原题和答案的 AMC 8/10/12 真题，和本课方法直接相关，难度从 AMC 10 前 10 题逐渐到中段。source 写成 "2017 AMC 10A 第 8 题" 这种格式；题干用英文原文，给出原题的 5 个选项。题库里有 contest 类的题时优先用，并写 bankRef。拿不准原题的不要出。
${input.bookCount === 0 ? "（本次不要课本练习部分）" : ""}${input.contestCount === 0 ? "（本次不要 AMC 部分）" : ""}

## 课堂纪要
<<<
${input.summary}
>>>

## 题库（${groupsText || "未选择"}）
每行：[id] (章节 类型 编号) 题干 || 答案
${bank.length ? bankLines(bank, true) : "（空）"}

老师的额外要求：${input.notes || "无"}

## 每道题怎么写
- id：课本题用 "a1"、"a2"…，AMC 用 "b1"、"b2"…
- statement：题干；statementZh：中文意思（AMC 题建议给，课本题可省略）
- kind："input"（填一个数）或 "choice"（五选一）。choice 时 choices 是 5 个选项的内容（不写字母），answer 写正确选项字母 A–E；input 时 answer 写最简结果，整数或最简分数（如 3/4）
- hint：答错后看到的一句提示，指方向，不给答案
- steps：解析 3–6 步，每步一个想法，最后一步给出答案并点明这题用的方法
- tags：1–3 个知识点，如 "补集计数"、"有重复元素的排列"
- figure：可选，解析需要图时才加，规则同下
- source：出处，例如 "AoPS 第 4 章复习题"、"2013 AMC 8 第 21 题"

## 可以用的图
${FIGURE_CATALOG}

## 输出格式
{
  "sections": [
    {"id": "a", "title": "课本练习", "note": "出处说明，30 字以内", "problems": []},
    {"id": "b", "title": "AMC 真题", "note": "英文原题", "problems": []}
  ]
}
某部分题数为 0 时省略那一部分。`;
}

const ReviewPart = z.object({ title: z.string().min(1).max(60), titleEn: z.string().max(100).optional(), review: Review });
const PracticePart = z.object({ sections: z.array(PracticeSection).min(1).max(4) });

async function askJson<T>(cfg: ModelConfig, schema: z.ZodType<T>, user: string, maxTokens: number): Promise<T> {
  const first = await complete(cfg, { system: SYSTEM, user, maxTokens, json: true });
  let parsed: unknown;
  let problems: string[] = [];
  try {
    parsed = extractJson(first.text);
    const r = schema.safeParse(parsed);
    if (r.success) return r.data;
    problems = formatIssues(r.error, 20);
  } catch (err) {
    problems = [`JSON 解析失败：${String(err)}${first.truncated ? "（输出被截断）" : ""}`];
  }
  // 修一次
  const repair = `你上一次的输出不符合格式要求，问题如下：
${problems.map((p) => `- ${p}`).join("\n")}

这是你上一次的输出：
<<<
${first.text.slice(0, 24000)}
>>>

请修正这些问题，重新输出完整的 JSON（同样的格式要求，只输出 JSON）。原始任务如下：
${user}`;
  const second = await complete(cfg, { system: SYSTEM, user: repair, maxTokens, json: true });
  const parsed2 = extractJson(second.text);
  const r2 = schema.safeParse(parsed2);
  if (!r2.success) {
    const err = new ModelError("模型两次输出都不符合格式");
    (err as ModelError & { detail?: string[] }).detail = formatIssues(r2.error, 20);
    throw err;
  }
  return r2.data;
}

function choiceText(p: Problem): string | null {
  if (p.kind !== "choice" || !p.choices) return null;
  return p.choices["ABCDEF".indexOf(p.answer.trim().toUpperCase())] ?? null;
}

/** 用题库核对答案，并把题干换回题库原文。 */
export function verifyAgainstBank(content: LessonContent, bank: Map<string, BankRow>): Check[] {
  const checks: Check[] = [];
  for (const section of content.practice.sections) {
    for (const p of section.problems) {
      if (!p.bankRef) {
        p.verified = false;
        checks.push({
          problemId: p.id,
          level: "warn",
          message: p.source?.includes("AMC") ? "AMC 题由 AI 凭记忆给出，请核对题干和答案" : "这道题不在题库里，请核对答案",
        });
        continue;
      }
      const b = bank.get(p.bankRef);
      if (!b) {
        p.verified = false;
        checks.push({ problemId: p.id, level: "warn", message: `题库里找不到 ${p.bankRef}，请核对` });
        continue;
      }
      const parts = b.answer ? answerParts(b.answer) : null;
      // 多问题 AI 只截取了一问，保留它改写的题干
      if (!parts) p.statement = b.statement;
      if (!p.source) p.source = b.source ?? [b.chapter && `AoPS 第 ${b.chapter} 章`, b.number && `#${b.number}`].filter(Boolean).join(" ");
      if (!b.answer) {
        p.verified = false;
        checks.push({ problemId: p.id, level: "warn", message: "题库没有这道题的答案，请核对" });
        continue;
      }
      const given = p.kind === "choice" ? (choiceText(p) ?? "") : p.answer;
      const note = unofficial(b) ? "（题库答案非课本给出，由 Claude 解出）" : "";
      if (parts) {
        const hit = Object.entries(parts).find(([, v]) => answersMatch(given, v) || answersMatch(p.answer, v));
        p.verified = false;
        checks.push(
          hit
            ? { problemId: p.id, level: "ok", message: `与题库第 (${hit[0]}) 问答案一致${note}。题干是 AI 从多问题里截出的，请看一眼` }
            : { problemId: p.id, level: "warn", message: `多问题，AI 的答案 ${p.answer} 和题库各问答案（${b.answer}）都对不上，请核对` },
        );
        continue;
      }
      if (answersMatch(given, b.answer) || answersMatch(p.answer, b.answer)) {
        p.verified = true;
        checks.push({ problemId: p.id, level: "ok", message: `与题库答案一致${note}` });
      } else if (p.kind === "input") {
        checks.push({ problemId: p.id, level: "warn", message: `AI 算出 ${p.answer}，题库答案是 ${b.answer}。已改用题库答案，请检查解析${note}` });
        p.answer = b.answer;
        p.verified = false;
      } else {
        p.verified = false;
        checks.push({ problemId: p.id, level: "warn", message: `AI 选的答案和题库答案 ${b.answer} 对不上，请核对` });
      }
    }
  }
  return checks;
}

export async function runGeneration(
  env: Env,
  cfg: ModelConfig,
  input: GenerateInput,
  emit: (e: GenerateEvent) => Promise<void>,
): Promise<void> {
  const db = env.DB;
  const genId = crypto.randomUUID();
  const started = Date.now();
  await db
    .prepare("INSERT INTO generations (id, status, model, input, created_at) VALUES (?, 'running', ?, ?, ?)")
    .bind(genId, `${cfg.provider}:${cfg.model}`, JSON.stringify(input), started)
    .run();

  try {
    // 1. 取题库
    const groups = input.groups.map((g) => g.split("|"));
    const bank: BankRow[] = [];
    for (const [book, chapter, section, kind] of groups) {
      const rows = await db
        .prepare(
          "SELECT id, book, chapter, section, kind, number, statement, answer, solution, source FROM bank_problems WHERE book = ? AND IFNULL(chapter,'') = ? AND IFNULL(section,'') = ? AND kind = ? ORDER BY CAST(number AS INTEGER), number LIMIT 80",
        )
        .bind(book, chapter ?? "", section ?? "", kind ?? "exercise")
        .all<BankRow>();
      bank.push(...rows.results);
    }
    const bankMap = new Map(bank.map((b) => [b.id, b]));
    const groupsText = groups
      .map(([book, chapter, section, kind]) => [book, chapter && `第 ${chapter} 章`, section, KIND_ZH[kind] ?? kind].filter(Boolean).join(" "))
      .join("；");
    // 课程页上显示的教材范围，例如 "AoPS ICP Ch. 4.2, 4.3"
    const byBook = new Map<string, Set<string>>();
    for (const [book, chapter, section, kind] of groups) {
      if (kind === "contest") continue;
      const set = byBook.get(book) ?? new Set<string>();
      set.add(section || chapter || "");
      byBook.set(book, set);
    }
    const chaptersText = [...byBook.entries()]
      .map(([book, set]) => `${book} Ch. ${[...set].filter(Boolean).join(", ")}`.trim())
      .join("；");
    const prev = await db
      .prepare("SELECT number, title FROM lessons WHERE status = 'published' AND number < ? ORDER BY number DESC LIMIT 6")
      .bind(input.number)
      .all<{ number: number; title: string }>();
    const previous = prev.results.reverse().map((r) => `${lessonLabel(r.number)} ${r.title}`);

    await emit({ type: "stage", text: `已读取题库 ${bank.length} 道题，正在同时生成课堂复习和课后练习` });

    // 2. 两部分并行生成
    const [reviewPart, practicePart] = await Promise.all([
      askJson(cfg, ReviewPart, reviewPrompt(input, bank, previous, groupsText), 8000).then(async (r) => {
        await emit({ type: "stage", text: "课堂复习已生成" });
        return r;
      }),
      askJson(cfg, PracticePart, practicePrompt(input, bank, groupsText), 8000).then(async (r) => {
        await emit({ type: "stage", text: "课后练习已生成" });
        return r;
      }),
    ]);

    // 3. 合并、校验、核对答案
    const merged = LessonContent.safeParse({ review: reviewPart.review, practice: { sections: practicePart.sections } });
    if (!merged.success) {
      const err = new ModelError("合并后的内容不符合格式");
      (err as ModelError & { detail?: string[] }).detail = formatIssues(merged.error);
      throw err;
    }
    const content = merged.data;
    // 引用了没选中的题库题（例如没勾选的 AMC 分组）也去题库里查
    const missing = [...new Set(content.practice.sections.flatMap((sec) => sec.problems.map((p) => p.bankRef)).filter((r): r is string => !!r && !bankMap.has(r)))];
    if (missing.length) {
      const extra = await db
        .prepare(`SELECT id, book, chapter, section, kind, number, statement, answer, solution, source FROM bank_problems WHERE id IN (${missing.map(() => "?").join(",")})`)
        .bind(...missing)
        .all<BankRow>();
      for (const r of extra.results) bankMap.set(r.id, r);
    }
    const checks = verifyAgainstBank(content, bankMap);

    const lessonId = crypto.randomUUID();
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          `INSERT INTO lessons (id, number, title, title_en, class_date, chapters, status, content, checks, source_notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        )
        .bind(
          lessonId,
          input.number,
          reviewPart.title,
          reviewPart.titleEn ?? null,
          input.classDate ?? null,
          chaptersText.slice(0, 60) || null,
          JSON.stringify(content),
          JSON.stringify(checks),
          input.summary,
          now,
          now,
        ),
      db
        .prepare("UPDATE generations SET status = 'done', lesson_id = ?, output = ?, finished_at = ? WHERE id = ?")
        .bind(lessonId, JSON.stringify({ title: reviewPart.title, checks }), now, genId),
    ]);
    await emit({ type: "done", lessonId, checks });
  } catch (err) {
    const detail = (err as { detail?: string[] }).detail;
    const message = err instanceof Error ? err.message : String(err);
    await db
      .prepare("UPDATE generations SET status = 'failed', error = ?, finished_at = ? WHERE id = ?")
      .bind(JSON.stringify({ message, detail }), Date.now(), genId)
      .run();
    await emit({ type: "error", message, detail });
  }
}
