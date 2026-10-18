import type { BankProblem, LessonContent } from "../shared/schema";

/**
 * 第一次部署时写入的初始数据：把原来 homework.html 的「练习一」迁成第 01 课，
 * 补上课堂复习部分，并把用到的 AMC 真题放进题库。
 */
export const LESSON_1 = {
  number: 1,
  title: "排列与组合：基本原理",
  titleEn: "Counting Basics: Permutations and Combinations",
  chapters: "AoPS Ch. 1–3",
};

export const LESSON_1_CONTENT: LessonContent = {
  review: {
    points: [
      {
        title: "乘法原理",
        body: "分几步完成一件事，每一步的选法数不受前面怎么选的影响时，总数等于各步选法数相乘。",
      },
      {
        title: "排列",
        body: "从 $n$ 个不同对象里选 $k$ 个并排好顺序：$$P(n,k)=\\frac{n!}{(n-k)!}=n(n-1)\\cdots(n-k+1)$$它只是乘法原理的速写。",
      },
      {
        title: "组合",
        body: "只选不排：$$\\binom{n}{k}=\\frac{n!}{k!\\,(n-k)!}$$每一组被排列多数了 $k!$ 次，所以 $P(n,k)=\\binom{n}{k}\\cdot k!$。",
      },
      {
        title: "有重复元素的排列",
        body: "先当所有元素都不同，再除掉相同元素互换造成的重复：$$\\frac{n!}{n_1!\\,n_2!\\cdots n_m!}$$",
      },
      {
        title: "补集计数",
        body: "题目里出现“至少一个”“含有”时，正面分类往往又乱又容易重复。先算全部，再减去“一个都没有”的情况。",
      },
    ],
    figures: [
      {
        id: "f1",
        title: "车牌号：逐格相乘",
        caption: "3 个字母接 3 个数字。每一格的选法数都固定，直接相乘：$26^3\\cdot 10^3$。",
        figure: {
          type: "slots",
          slots: [
            { label: "字母", count: 26 },
            { label: "字母", count: 26 },
            { label: "字母", count: 26 },
            { label: "数字", count: 10 },
            { label: "数字", count: 10 },
            { label: "数字", count: 10 },
          ],
        },
      },
      {
        id: "f2",
        title: "选人，再排队",
        caption: "6 个人里选 3 个。同一组 3 个人有 $3!=6$ 种排队方式，排列只比组合多出这个 $3!$。",
        figure: { type: "select-arrange", n: 6, k: 3 },
      },
      {
        id: "f3",
        title: "LEVEL 有几种排法",
        caption: "两个 L 互换、两个 E 互换都看不出区别，所以 $5!$ 要除以 $2!\\cdot 2!$。",
        figure: { type: "multiset", word: "LEVEL" },
      },
      {
        id: "f4",
        title: "网格上的最短路",
        caption: "每条最短路都是 4 个“右”和 3 个“上”的一种排列，所以共有 $\\binom{7}{3}$ 条。",
        figure: { type: "grid-path", segments: [{ cols: 4, rows: 3 }] },
      },
      {
        id: "f5",
        title: "至少有一个 7 的四位数",
        caption: "直接数“至少一个 7”要分很多类。先数全部四位数，再去掉一个 7 都没有的。",
        figure: { type: "complement", total: 9000, excluded: 5832, totalLabel: "所有四位数", excludedLabel: "一个 7 都没有" },
      },
    ],
    examples: [
      {
        id: "e1",
        source: "课上例题",
        statement:
          "A club has 10 members. In how many ways can it choose a president, a vice-president and a treasurer? In how many ways can it choose a 3-person committee?",
        statementZh: "一个社团有 10 人。选出主席、副主席、财务各一人有几种选法？选一个 3 人委员会有几种选法？",
        steps: [
          "三个职位各不相同，谁当主席、谁当财务是有区别的，所以是排列：$10\\times 9\\times 8=720$。",
          "委员会里 3 个人没有分工，交换他们不产生新的委员会，所以是组合。",
          "每个委员会在 720 种职位分配里被数了 $3!=6$ 次：$720\\div 6=120=\\binom{10}{3}$。",
          "判断方法：把选出来的人互换一下，结果变了就是排列，没变就是组合。",
        ],
      },
    ],
    pitfalls: [
      "有顺序还是没顺序：把选出来的对象互换一下，结果变了用排列，没变用组合。",
      "用补集时先确认“全部”的范围，例如“100 到 400 之间”包不包括端点。",
    ],
  },
  practice: {
    sections: [
      {
        id: "a",
        title: "基础巩固",
        note: "AoPS Introduction to Counting & Probability 第 1–3 章",
        problems: [
          {
            id: "a1",
            statement: "Compute $6!$.",
            statementZh: "计算 $6$ 的阶乘。",
            kind: "input",
            answer: "720",
            hint: "从 1 一直乘到 6。",
            steps: [
              "$6! = 6\\times 5\\times 4\\times 3\\times 2\\times 1$。",
              "从小往大乘：$2\\times 3=6$，$6\\times 4=24$，$24\\times 5=120$，$120\\times 6=720$。",
              "阶乘建议背到 $7!$：1, 2, 6, 24, 120, 720, 5040。AMC 不能用计算器，这些是基本功。",
            ],
            tags: ["阶乘"],
            verified: true,
          },
          {
            id: "a2",
            statement: "In how many ways can a 1st place and a 2nd place winner be chosen from 6 runners?",
            statementZh: "6 名选手中选出冠军和亚军（名次有区别），有多少种结果？",
            kind: "input",
            answer: "30",
            hint: "冠军和亚军是不同的名次，顺序有关。",
            steps: ["名次有先后，是排列：$P(6,2)$。", "冠军 6 种选法，亚军还剩 5 种：$6\\times 5=30$。"],
            tags: ["排列", "乘法原理"],
            verified: true,
          },
          {
            id: "a3",
            statement: "Compute $\\dbinom{8}{2}$.",
            statementZh: "计算组合数 $\\binom{8}{2}$。",
            kind: "input",
            answer: "28",
            hint: "从 8 个里选 2 个，不管谁先谁后。",
            steps: [
              "$\\binom{8}{2}=\\dfrac{8\\times 7}{2!}=\\dfrac{56}{2}=28$。",
              "$\\binom{n}{2}=\\dfrac{n(n-1)}{2}$ 最常用：$n$ 个人两两握手、$n$ 个点两两连线都是它。",
            ],
            tags: ["组合"],
            verified: true,
          },
          {
            id: "a4",
            statement: "A 4-digit passcode uses the digits 0–9, and no digit may repeat. How many different passcodes are possible?",
            statementZh: "4 位数字密码，每位可以是 0–9，数字不能重复，一共有多少种密码？",
            kind: "input",
            answer: "5040",
            hint: "一位一位地填，每填一位，能用的数字就少一个。",
            steps: [
              "第一位 10 种；用掉一个后，第二位 9 种；第三位 8 种；第四位 7 种。",
              "每一步的选法数是固定的，用乘法原理：$10\\times 9\\times 8\\times 7=5040$。",
              "这就是 $P(10,4)$。排列公式只是乘法原理的速写。",
            ],
            tags: ["乘法原理", "排列"],
            figure: {
              type: "slots",
              slots: [
                { label: "第 1 位", count: 10 },
                { label: "第 2 位", count: 9 },
                { label: "第 3 位", count: 8 },
                { label: "第 4 位", count: 7 },
              ],
            },
            verified: true,
          },
          {
            id: "a5",
            statement: "How many distinct arrangements are there of the letters in the word BANANA?",
            statementZh: "BANANA 的 6 个字母（1 个 B、3 个 A、2 个 N）有多少种不同的排法？",
            kind: "input",
            answer: "60",
            hint: "先当 6 个字母都不同，再想想每种排法被多数了几遍。",
            steps: [
              "先当 6 个字母全都不同：$6!=720$。",
              "3 个 A 互相交换看不出区别，每种真正的排法被数了 $3!=6$ 次；2 个 N 同理，$2!=2$ 次。",
              "除掉重复：$720\\div 6\\div 2=60$。",
              "一般地，$\\dfrac{n!}{n_1!\\,n_2!\\cdots n_m!}$，分母里每种重复的字母一项。",
            ],
            tags: ["有重复元素的排列"],
            figure: { type: "multiset", word: "BANANA" },
            verified: true,
          },
          {
            id: "a6",
            statement:
              "From 10 people, we either pick 4 to stand in a line, or pick 4 to form a committee. Find the ratio $P(10,4)\\div\\dbinom{10}{4}$.",
            statementZh: "10 人中选 4 人排成一队，和 10 人中选 4 人组成委员会，两种结果数相除等于多少？",
            kind: "choice",
            choices: ["$24$", "$4$", "$1$", "无法确定"],
            answer: "A",
            hint: "每选出一组 4 个人，他们可以排成几种队？",
            steps: [
              "排队（有序）：$P(10,4)=5040$。",
              "组委员会（无序）：$\\binom{10}{4}=210$。",
              "比值 $5040\\div 210=24=4!$。",
              "每一组人恰好对应 $4!$ 种排法，这正是组合公式分母里 $k!$ 的来历。",
            ],
            tags: ["排列与组合的关系"],
            figure: { type: "select-arrange", n: 10, k: 4 },
            verified: true,
          },
          {
            id: "a7",
            statement: "Find $n$ such that $\\dbinom{n}{2}=45$.",
            statementZh: "已知 $\\binom{n}{2}=45$，求 $n$。",
            kind: "input",
            answer: "10",
            hint: "$\\binom{n}{2}=\\frac{n(n-1)}{2}$，找两个相邻整数，乘积是 90。",
            steps: ["$\\dfrac{n(n-1)}{2}=45$，即 $n(n-1)=90$。", "$10\\times 9=90$，所以 $n=10$。", "验算：$\\binom{10}{2}=45$。"],
            tags: ["组合"],
            verified: true,
          },
        ],
      },
      {
        id: "b",
        title: "AMC 真题",
        note: "英文原题",
        problems: [
          {
            id: "b1",
            source: "2013 AMC 8 第 21 题",
            bankRef: "amc8-2013-21",
            statement:
              "Samantha lives 2 blocks west and 1 block south of the southwest corner of City Park. Her school is 2 blocks east and 2 blocks north of the northeast corner of City Park. On school days she bikes on streets to the southwest corner of City Park, then takes a diagonal path through the park to the northeast corner, and then bikes on streets to school. If her route is as short as possible, how many different routes can she take?",
            statementZh:
              "家到公园西南角：要向东 2 段、向北 1 段；穿过公园只有一条斜路；公园东北角到学校：向东 2 段、向北 2 段。路线最短时一共有几条？",
            kind: "choice",
            choices: ["$3$", "$6$", "$9$", "$12$", "$18$"],
            answer: "E",
            hint: "公园前后两段路互不影响，各自有几种走法？",
            steps: [
              "第一段是 2 个“东”和 1 个“北”的排列：$\\binom{3}{1}=3$ 条。",
              "穿过公园只有一条斜路。",
              "第二段是 2 个“东”和 2 个“北”的排列：$\\binom{4}{2}=6$ 条。",
              "三段互相独立，用乘法原理：$3\\times 1\\times 6=18$，选 (E)。",
              "路径计数可以转化成有重复字母的排列，这个对应以后会反复用到。",
            ],
            tags: ["网格路径", "乘法原理"],
            figure: {
              type: "grid-path",
              segments: [
                { cols: 2, rows: 1, label: "家 → 公园西南角" },
                { cols: 2, rows: 2, label: "公园东北角 → 学校" },
              ],
              connector: "穿过公园",
            },
            verified: true,
          },
          {
            id: "b2",
            source: "1985 AJHSME 第 15 题（今 AMC 8）",
            bankRef: "ajhsme-1985-15",
            statement: "How many whole numbers between 100 and 400 contain the digit 2?",
            statementZh: "100 到 400 之间，含有数字 2 的整数有多少个？",
            kind: "choice",
            choices: ["$100$", "$120$", "$138$", "$140$", "$148$"],
            answer: "C",
            hint: "直接数“含 2”很乱，试试数“不含 2”。",
            steps: [
              "正面分类会重复（比如 222），改用补集：全部减去不含 2 的。",
              "100 到 400 共 301 个数。端点 100 和 400 都不含 2，包不包括它们不影响答案。",
              "不含 2 的：百位只能是 1 或 3（2 种），十位、个位各 9 种（去掉 2），共 $2\\times 9\\times 9=162$ 个；再加上 400，共 163 个。",
              "含 2 的有 $301-163=138$ 个，选 (C)。",
              "看到“含有”“至少”这类词，先想反面。",
            ],
            tags: ["补集计数"],
            figure: { type: "complement", total: 301, excluded: 163, totalLabel: "100 到 400 的整数", excludedLabel: "不含 2" },
            verified: true,
          },
          {
            id: "b3",
            source: "2017 AMC 10A 第 8 题",
            bankRef: "amc10a-2017-8",
            statement:
              "At a gathering of 30 people, there are 20 people who all know each other and 10 people who know no one. People who know each other hug, and people who do not know each other shake hands. How many handshakes occur within the group?",
            statementZh: "30 人聚会：其中 20 人互相都认识（只拥抱），另外 10 人谁都不认识（和不认识的人握手）。一共握了多少次手？",
            kind: "choice",
            choices: ["$240$", "$245$", "$290$", "$480$", "$490$"],
            answer: "B",
            hint: "握手的两个人里至少有一个是“谁都不认识”的人，分两类数。",
            steps: [
              "握手只发生在至少有一个陌生人的两人之间，分两类：陌生人和陌生人、陌生人和熟人组。",
              "陌生人之间两两握手：$\\binom{10}{2}=45$。",
              "每个陌生人和 20 个熟人各握一次：$10\\times 20=200$。",
              "加法原理：$45+200=245$，选 (B)。",
              "AMC 10 前几题的典型结构：分类，再配一个组合数。",
            ],
            tags: ["分类计数", "组合"],
            verified: true,
          },
          {
            id: "b4",
            source: "2020 AMC 8 第 7 题",
            bankRef: "amc8-2020-7",
            statement:
              "How many integers between 2020 and 2400 have four distinct digits arranged in increasing order? (For example, 2347 is one integer.)",
            statementZh: "2020 到 2400 之间，四个数字互不相同且从左到右递增的整数有多少个？（例如 2347）",
            kind: "choice",
            choices: ["$9$", "$10$", "$15$", "$21$", "$28$"],
            answer: "C",
            hint: "千位、百位其实已经被范围卡死了，剩下两位只需要“选”。",
            steps: [
              "千位是 2。递增要求百位大于 2，而数又要小于 2400，所以百位只能是 3。",
              "数字形如 $\\overline{23ab}$，$a<b$ 都从 $\\{4,5,6,7,8,9\\}$ 里取。",
              "选定两个数字后，递增的排法只有一种，所以答案就是选法数：$\\binom{6}{2}=15$，选 (C)。",
              "看上去是排列，其实是组合，认出这一层是这题要考的。",
            ],
            tags: ["组合", "递增即组合"],
            figure: { type: "choose", pool: [4, 5, 6, 7, 8, 9], k: 2, prefix: "23" },
            verified: true,
          },
        ],
      },
    ],
  },
};

export const SEED_BANK: BankProblem[] = [
  {
    id: "amc8-2013-21",
    book: "AMC",
    chapter: null,
    section: "AMC 8",
    kind: "contest",
    number: "21",
    statement: LESSON_1_CONTENT.practice.sections[1].problems[0].statement,
    answer: "18",
    source: "2013 AMC 8 第 21 题",
    tags: ["网格路径"],
  },
  {
    id: "ajhsme-1985-15",
    book: "AMC",
    chapter: null,
    section: "AMC 8",
    kind: "contest",
    number: "15",
    statement: LESSON_1_CONTENT.practice.sections[1].problems[1].statement,
    answer: "138",
    source: "1985 AJHSME 第 15 题",
    tags: ["补集计数"],
  },
  {
    id: "amc10a-2017-8",
    book: "AMC",
    chapter: null,
    section: "AMC 10",
    kind: "contest",
    number: "8",
    statement: LESSON_1_CONTENT.practice.sections[1].problems[2].statement,
    answer: "245",
    source: "2017 AMC 10A 第 8 题",
    tags: ["分类计数"],
  },
  {
    id: "amc8-2020-7",
    book: "AMC",
    chapter: null,
    section: "AMC 8",
    kind: "contest",
    number: "7",
    statement: LESSON_1_CONTENT.practice.sections[1].problems[3].statement,
    answer: "15",
    source: "2020 AMC 8 第 7 题",
    tags: ["组合"],
  },
];

export async function seedDatabase(db: D1Database) {
  const done = await db.prepare("SELECT value FROM settings WHERE key = 'seeded'").first<{ value: string }>();
  if (done) return;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM lessons").first<{ n: number }>();
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if ((count?.n ?? 0) === 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO lessons (id, number, title, title_en, class_date, chapters, status, content, checks, created_at, updated_at, published_at)
           VALUES (?, ?, ?, ?, NULL, ?, 'published', ?, '[]', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), LESSON_1.number, LESSON_1.title, LESSON_1.titleEn, LESSON_1.chapters, JSON.stringify(LESSON_1_CONTENT), now, now, now),
    );
  }
  for (const b of SEED_BANK)
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO bank_problems (id, book, chapter, section, kind, number, statement, answer, solution, source, tags, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .bind(b.id, b.book, b.chapter ?? null, b.section ?? null, b.kind, b.number ?? null, b.statement, b.answer ?? null, b.source ?? null, JSON.stringify(b.tags ?? []), now),
    );
  stmts.push(db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', ?)").bind(String(now)));
  await db.batch(stmts);
}
