import { describe, expect, test } from "bun:test";
import { answersMatch, checkAnswer, normalizeAnswer } from "../src/shared/answers";
import { LessonContent, Problem, figureProblems } from "../src/shared/schema";
import { answerParts, verifyAgainstBank } from "../src/worker/generate";
import { LESSON_1_CONTENT, SEED_BANK } from "../src/worker/seed";

describe("答案判定", () => {
  test("同一个数的不同写法都算对", () => {
    expect(answersMatch("５０４０", "5040")).toBe(true);
    expect(answersMatch("5,040", "5040")).toBe(true);
    expect(answersMatch("n = 10", "10")).toBe(true);
    expect(answersMatch("0.75", "3/4")).toBe(true);
    expect(answersMatch("6/8", "3/4")).toBe(true);
    expect(answersMatch("$\\frac{3}{4}$", "3/4")).toBe(true);
    expect(answersMatch("−3", "-3")).toBe(true);
    expect(answersMatch(" 60 。", "60")).toBe(true);
  });
  test("不同的数不算对", () => {
    expect(answersMatch("61", "60")).toBe(false);
    expect(answersMatch("", "60")).toBe(false);
    expect(answersMatch("3/5", "3/4")).toBe(false);
  });
  test("选择题按字母判", () => {
    const p = { kind: "choice" as const, answer: "E" };
    expect(checkAnswer(p, "e")).toBe(true);
    expect(checkAnswer(p, "D")).toBe(false);
  });
  test("accept 里的备选答案也算对", () => {
    expect(checkAnswer({ kind: "input", answer: "120", accept: ["5!"] }, "5!")).toBe(true);
  });
  test("归一化", () => {
    expect(normalizeAnswer(" N = 12 ")).toBe("12");
  });
});

describe("初始数据", () => {
  test("第 01 课内容符合格式", () => {
    const r = LessonContent.safeParse(LESSON_1_CONTENT);
    if (!r.success) console.error(r.error.issues);
    expect(r.success).toBe(true);
  });
  test("第 01 课有 11 道题，选择题答案都在选项范围内", () => {
    const problems = LESSON_1_CONTENT.practice.sections.flatMap((s) => s.problems);
    expect(problems.length).toBe(11);
    for (const p of problems) if (p.kind === "choice") expect("ABCDEF".indexOf(p.answer)).toBeLessThan(p.choices!.length);
  });
  test("题库里的 AMC 答案和第 01 课一致", () => {
    const problems = LESSON_1_CONTENT.practice.sections.flatMap((s) => s.problems);
    for (const b of SEED_BANK) {
      const p = problems.find((x) => x.bankRef === b.id)!;
      const text = p.choices![("ABCDEF").indexOf(p.answer)];
      expect(answersMatch(text, b.answer!)).toBe(true);
    }
  });
});

describe("图的参数检查", () => {
  test("不合理的参数会被拦下", () => {
    expect(figureProblems({ type: "choose", pool: [1, 2], k: 3 }).length).toBe(1);
    expect(figureProblems({ type: "pascal", rows: 5, highlight: [[6, 2]] }).length).toBe(1);
    expect(figureProblems({ type: "complement", total: 5, excluded: 9, totalLabel: "a", excludedLabel: "b" }).length).toBe(1);
  });
  test("选择题答案超出选项会报错", () => {
    const r = Problem.safeParse({ id: "x1", statement: "s", kind: "choice", choices: ["1", "2"], answer: "C", steps: ["a"] });
    expect(r.success).toBe(false);
  });
});

describe("用题库核对 AI 生成的题", () => {
  const bank = new Map(
    [
      { id: "b-1", book: "AoPS", chapter: "4", section: "4.2", kind: "exercise", number: "1", statement: "Compute $\\binom{9}{3}$.", answer: "84", source: null },
      { id: "b-2", book: "AoPS", chapter: "4", section: "4.2", kind: "exercise", number: "2", statement: "Choose 2 of 6.", answer: "15", source: null },
      { id: "b-3", book: "AoPS", chapter: "4", section: "4.2", kind: "exercise", number: "3", statement: "No answer here.", answer: null, source: null },
    ].map((b) => [b.id, b]),
  );
  const content = (): LessonContent => ({
    review: { points: [], figures: [], examples: [], pitfalls: [] },
    practice: {
      sections: [
        {
          id: "a",
          title: "课本练习",
          problems: [
            { id: "a1", bankRef: "b-1", statement: "AI 改写的题干", kind: "input", answer: "84", steps: ["x"] },
            { id: "a2", bankRef: "b-2", statement: "x", kind: "input", answer: "10", steps: ["x"] },
            { id: "a3", bankRef: "b-3", statement: "x", kind: "input", answer: "7", steps: ["x"] },
            { id: "a4", bankRef: "nope", statement: "x", kind: "input", answer: "7", steps: ["x"] },
            { id: "b1", source: "2019 AMC 10A 第 5 题", statement: "x", kind: "choice", choices: ["1", "2"], answer: "A", steps: ["x"] },
          ],
        },
      ],
    },
  });
  test("答案一致的标记为已核对，并换回题库原文", () => {
    const c = content();
    const checks = verifyAgainstBank(c, bank);
    const p = c.practice.sections[0].problems;
    expect(checks[0].level).toBe("ok");
    expect(p[0].statement).toBe("Compute $\\binom{9}{3}$.");
    expect(p[0].verified).toBe(true);
  });
  test("答案不一致时改用题库答案并提醒", () => {
    const c = content();
    const checks = verifyAgainstBank(c, bank);
    expect(checks[1].level).toBe("warn");
    expect(c.practice.sections[0].problems[1].answer).toBe("15");
  });
  test("题库没答案、找不到、AMC 凭记忆，都要提醒", () => {
    const checks = verifyAgainstBank(content(), bank);
    expect(checks.slice(2).every((c) => c.level === "warn")).toBe(true);
    expect(checks[4].message).toContain("AMC");
  });
});

describe("多问题和非官方答案", () => {
  test("拆分多问答案", () => {
    expect(answerParts("(a) 12 (b) 6")).toEqual({ a: "12", b: "6" });
    expect(answerParts("(a) 15, 15 (b) 56, 56")).toEqual({ a: "15, 15", b: "56, 56" });
    expect(answerParts("336")).toBeNull();
  });
  const bank = new Map(
    [
      { id: "m", book: "AoPS ICP", chapter: "4", section: null, kind: "review", number: "4.21", statement: "(a) ... (b) ... (c) ...", answer: "(a) 19600 (b) 2 (c) 156800", solution: "答案由 Claude 解出，未对照官方答案册。", source: null },
      { id: "u", book: "AoPS ICP", chapter: "4", section: null, kind: "review", number: "4.16", statement: "Dodecagon triangles?", answer: "220", solution: "答案由 Claude 解出，未对照官方答案册。", source: null },
    ].map((b) => [b.id, b]),
  );
  const content = (): LessonContent => ({
    review: { points: [], figures: [], examples: [], pitfalls: [] },
    practice: {
      sections: [
        {
          id: "a",
          title: "课本练习",
          problems: [
            { id: "a1", bankRef: "m", statement: "AI 截取的 (c) 问", kind: "input", answer: "156800", steps: ["x"] },
            { id: "a2", bankRef: "m", statement: "x", kind: "input", answer: "7", steps: ["x"] },
            { id: "a3", bankRef: "u", statement: "x", kind: "input", answer: "220", steps: ["x"] },
          ],
        },
      ],
    },
  });
  test("多问题：答案对上某一问就通过，保留 AI 截取的题干；对不上不改答案", () => {
    const c = content();
    const checks = verifyAgainstBank(c, bank);
    const p = c.practice.sections[0].problems;
    expect(checks[0].level).toBe("ok");
    expect(checks[0].message).toContain("(c)");
    expect(p[0].statement).toBe("AI 截取的 (c) 问");
    expect(checks[1].level).toBe("warn");
    expect(p[1].answer).toBe("7");
  });
  test("题库答案是 Claude 解出的要说明", () => {
    const checks = verifyAgainstBank(content(), bank);
    expect(checks[2].level).toBe("ok");
    expect(checks[2].message).toContain("Claude 解出");
  });
});
