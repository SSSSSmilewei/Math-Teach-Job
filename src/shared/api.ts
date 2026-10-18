import type { FigureSpec, Problem, Review } from "./schema";

/** 学生端拿到的题目：去掉了答案、解析和解析里的图。 */
export type PublicProblem = Omit<Problem, "answer" | "accept" | "steps" | "figure" | "verified" | "bankRef">;

export interface Solution {
  steps: string[];
  figure?: FigureSpec;
  answer: string; // 展示用：选择题是 "(E) 18"，填空题是标准答案
}

export interface ProblemState {
  attempts: number;
  correct: boolean;
  answers: string[]; // 按时间顺序
  solution?: Solution; // 解锁后才有
}

export interface PinMessage {
  id: number;
  author: "student" | "teacher";
  body: string;
  createdAt: number;
}

export interface Pin {
  id: string;
  lessonId: string;
  lessonNumber?: number;
  anchorKey: string;
  anchorLabel: string | null;
  xPct: number;
  yPct: number;
  snippet: string | null;
  status: "open" | "answered" | "resolved";
  createdAt: number;
  updatedAt: number;
  unseenReply: boolean;
  messages: PinMessage[];
  studentName?: string;
}

export interface LessonSummary {
  id: string;
  number: number;
  title: string;
  titleEn: string | null;
  classDate: string | null;
  chapters: string | null;
  publishedAt: number | null;
  problemCount: number;
  correct: number;
  attempted: number;
  pinCount: number;
  unseenReplies: number;
  openPins: number;
  submittedAt: number | null;
  reviewStats: { points: number; figures: number; examples: number };
}

export interface LessonPayload {
  id: string;
  number: number;
  title: string;
  titleEn: string | null;
  classDate: string | null;
  chapters: string | null;
  status: "draft" | "published";
  review: Review;
  sections: { id: string; title: string; note?: string; problems: PublicProblem[] }[];
  state: Record<string, ProblemState>;
  pins: Pin[];
  practiceStartedAt: number | null;
  submittedAt: number | null;
  preview?: boolean;
}

export interface AttemptResult {
  correct: boolean;
  state: ProblemState;
}

export interface RedoItem {
  lessonNumber: number;
  lessonTitle: string;
  problemId: string;
  index: number;
  source: string | null;
  statement: string;
  wrongAttempts: number;
}

export interface Me {
  role: "student" | "admin" | null;
  student?: { id: string; name: string };
}
