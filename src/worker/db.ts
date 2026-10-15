import { seedDatabase } from "./seed";

/**
 * 数据库结构。Worker 启动后第一次收到请求时自动建表/升级，
 * 部署时不需要另外跑迁移命令。新增结构时只在数组末尾追加。
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      passcode_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      title_en TEXT,
      class_date TEXT,
      chapters TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT NOT NULL,
      checks TEXT,
      source_notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS lessons_by_number ON lessons(number, status)`,
    `CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      answer TEXT NOT NULL,
      correct INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS attempts_by_student ON attempts(student_id, lesson_id, problem_id)`,
    `CREATE TABLE IF NOT EXISTS lesson_views (
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      tab TEXT NOT NULL,
      first_at INTEGER NOT NULL,
      last_at INTEGER NOT NULL,
      PRIMARY KEY (student_id, lesson_id, tab)
    )`,
    `CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      total INTEGER NOT NULL,
      summary TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS submissions_by_lesson ON submissions(lesson_id, student_id, submitted_at)`,
    `CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      anchor_key TEXT NOT NULL,
      anchor_label TEXT,
      x_pct REAL NOT NULL,
      y_pct REAL NOT NULL,
      snippet TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      student_seen_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS pins_by_student ON pins(student_id, lesson_id)`,
    `CREATE INDEX IF NOT EXISTS pins_by_status ON pins(status, updated_at)`,
    `CREATE TABLE IF NOT EXISTS pin_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pin_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS pin_messages_by_pin ON pin_messages(pin_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS bank_problems (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      chapter TEXT,
      section TEXT,
      kind TEXT NOT NULL,
      number TEXT,
      statement TEXT NOT NULL,
      answer TEXT,
      solution TEXT,
      source TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS bank_by_section ON bank_problems(book, chapter, section, kind)`,
    `CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      lesson_id TEXT,
      status TEXT NOT NULL,
      model TEXT,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS login_failures (
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS login_failures_by_ip ON login_failures(ip, at)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ],
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function migrate(db: D1Database) {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
    .run();
  const row = await db.prepare("SELECT MAX(version) AS v FROM _migrations").first<{ v: number | null }>();
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const statements = MIGRATIONS[i].map((sql) => db.prepare(sql));
    statements.push(db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").bind(i + 1, Date.now()));
    await db.batch(statements);
  }
  await seedDatabase(db);
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
