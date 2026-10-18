import { useEffect, useMemo, useState } from "react";
import type { Pin } from "../../shared/api";
import type { LessonContent } from "../../shared/schema";
import { ApiError, api, formatDate, pad2, relativeTime, useApi } from "../api";
import { ErrorView, Loading } from "../components/Layout";
import { Rich, renderRich } from "../rich";
import { Link, navigate } from "../router";

/* ---------- 类型 ---------- */
interface LessonItem {
  id: string;
  number: number;
  title: string;
  titleEn: string | null;
  classDate: string | null;
  chapters: string | null;
  status: "draft" | "published";
  updatedAt: number;
  publishedAt: number | null;
  problemCount: number;
  warnings: number;
}
interface Check {
  problemId: string;
  level: "ok" | "warn";
  message: string;
}
interface SubmissionItem {
  id: number;
  lessonId: string;
  lessonNumber: number;
  lessonTitle: string;
  studentName: string;
  submittedAt: number;
  correct: number;
  total: number;
  summary: { items: { index: number; problemId: string; source: string | null; attempts: number; correct: boolean; firstTry: boolean; lastAnswer: string | null }[]; minutes: number | null };
}
interface Overview {
  config: { sessionSecret: boolean; ai: string | null; notify: string[]; siteUrl: string | null };
  students: number;
  lessons: LessonItem[];
  openPins: Pin[];
  submissions: SubmissionItem[];
}

const pinWhere = (p: Pin) => (p.anchorKey.startsWith("p.") || p.anchorKey === "lesson.practice" ? "practice" : "review");

/* ============================================================
   总览
   ============================================================ */
export function AdminHome() {
  const { data, error, reload } = useApi<Overview>("/api/admin/overview");
  if (error) return <ErrorView message={error.message} />;
  if (!data) return <Loading />;
  const latest = data.submissions[0];
  const missing = [
    !data.config.sessionSecret && "SESSION_SECRET（登录用的密钥）",
    !data.config.ai && "大模型 AI_API_KEY（生成新课要用）",
    data.config.notify.length === 0 && "微信通知 WXPUSHER_SPT 或 SERVERCHAN_KEY",
    !data.config.siteUrl && "SITE_URL（通知里的链接要用）",
  ].filter(Boolean) as string[];

  return (
    <main className="wrap-wide" style={{ paddingTop: 48 }}>
      {missing.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 40 }}>
          还没配置：{missing.join("；")}。在 Cloudflare 面板的 Worker 设置里添加（见仓库 README）。
        </div>
      )}
      {data.students === 0 && (
        <div className="notice info" style={{ marginBottom: 40 }}>
          还没有学生。先去 <Link to="/admin/students">学生</Link> 页面添加，系统会生成一个专属口令和登录链接。
        </div>
      )}
      <div className="cols">
        <section aria-labelledby="pins">
          <div className="section-head">
            <h1 id="pins" style={{ fontSize: 22 }}>
              待回复的疑问
            </h1>
            <span className="aside">{data.openPins.length} 条未回复</span>
          </div>
          {data.openPins.length === 0 && <p className="muted" style={{ paddingTop: 20 }}>没有待回复的疑问。</p>}
          {data.openPins.map((p) => (
            <InboxItem key={p.id} pin={p} onReplied={reload} />
          ))}
        </section>

        <section aria-labelledby="hw">
          <div className="section-head">
            <h2 id="hw">最近交的作业</h2>
            {latest && <span className="aside">{relativeTime(latest.submittedAt)}</span>}
          </div>
          {!latest ? (
            <p className="muted" style={{ paddingTop: 20 }}>
              还没有人交作业。
            </p>
          ) : (
            <SubmissionView s={latest} />
          )}
          {data.submissions.length > 1 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>更早</h3>
              {data.submissions.slice(1).map((s) => (
                <div key={s.id} className="res" style={{ gridTemplateColumns: "minmax(0,1fr) 80px 120px" }}>
                  <Link to={`/admin/lessons/${s.lessonId}`}>
                    {s.studentName}，第 {pad2(s.lessonNumber)} 课
                  </Link>
                  <span className="tabnum">
                    {s.correct} / {s.total}
                  </span>
                  <span className="muted">{formatDate(s.submittedAt, true)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="lessons" style={{ marginTop: 80 }}>
        <div className="section-head">
          <h2 id="lessons">课程</h2>
          <Link to="/admin/generate" className="aside">
            生成新课
          </Link>
        </div>
        <div className="scroll-x">
          <div className="arow head">
            <span>课次</span>
            <span>主题</span>
            <span>状态</span>
            <span>题目</span>
            <span />
          </div>
          {data.lessons.map((l) => (
            <div className="arow" key={l.id}>
              <span className="n">{pad2(l.number)}</span>
              <span>
                {l.title}
                {l.chapters && <span className="muted">　{l.chapters}</span>}
              </span>
              <span className={l.status === "draft" ? "red" : undefined}>
                {l.status === "draft" ? (l.warnings ? `草稿，${l.warnings} 处待核对` : "草稿") : "已发布"}
              </span>
              <span className="tabnum">{l.problemCount} 题</span>
              <span style={{ display: "flex", gap: 16 }}>
                <Link to={`/admin/lessons/${l.id}`}>{l.status === "draft" ? "检查并发布" : "编辑"}</Link>
                <Link to={`/admin/preview/${l.id}/review`} className="muted">
                  预览
                </Link>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 64 }}>
        <div className="section-head">
          <h2>设置</h2>
        </div>
        <ul className="config-list" style={{ marginTop: 16 }}>
          <li>
            <span className="muted">大模型</span>
            {data.config.ai ?? "未配置"}
          </li>
          <li>
            <span className="muted">微信通知</span>
            {data.config.notify.length ? data.config.notify.join("、") : "未配置"}
            {data.config.notify.length > 0 && <NotifyTest />}
          </li>
          <li>
            <span className="muted">学生</span>
            {data.students} 人
          </li>
        </ul>
      </section>
    </main>
  );
}

function NotifyTest() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        className="link-btn"
        type="button"
        onClick={async () => {
          setMsg("正在发送…");
          try {
            await api("/api/admin/notify/test", { body: {} });
            setMsg("已发送，看看微信有没有收到");
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      >
        发一条测试
      </button>
      {msg && <span className="muted">{msg}</span>}
    </>
  );
}

function InboxItem({ pin, onReplied }: { pin: Pin; onReplied: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = pin.messages.at(-1);
  return (
    <article className="inbox-item">
      <span className="dot" aria-hidden="true" />
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }} className="xsmall muted">
          <span>
            {pin.studentName ?? "学生"}，第 {pad2(pin.lessonNumber ?? 0)} 课{pinWhere(pin) === "practice" ? "课后练习" : "课堂复习"}
            {pin.anchorLabel ? `，${pin.anchorLabel}` : ""}
          </span>
          <span>{relativeTime(last?.createdAt ?? pin.createdAt)}</span>
        </div>
        {pin.messages.map((m) => (
          <div key={m.id} className={`msg ${m.author}`}>
            {m.author === "teacher" && <span className="who">你</span>}
            <span dangerouslySetInnerHTML={{ __html: renderRich(m.body, false) }} />
          </div>
        ))}
        {pin.snippet && (
          <div className="context-box">
            钉在：{pin.snippet.slice(0, 80)}
            {pin.snippet.length > 80 ? "…" : ""}
            <Link to={`/admin/preview/${pin.lessonId}/${pinWhere(pin)}?pin=${pin.id}`} className="blue">
              在页面上看
            </Link>
          </div>
        )}
        <form
          className="note-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            setBusy(true);
            setError(null);
            try {
              await api(`/api/admin/pins/${pin.id}/reply`, { body: { body: text.trim() } });
              setText("");
              onReplied();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="回复（支持 $公式$）" style={{ borderColor: "var(--ink)" }} />
          {error && <span className="error-text">{error}</span>}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-blue btn-sm" type="submit" disabled={busy || !text.trim()}>
              发送回复
            </button>
            <span className="xsmall muted">学生下次打开页面时会看到</span>
          </div>
        </form>
      </div>
    </article>
  );
}

function SubmissionView({ s }: { s: SubmissionItem }) {
  const firstTry = s.summary.items.filter((i) => i.firstTry).length;
  return (
    <div>
      <p className="small" style={{ marginTop: 12 }}>
        {s.studentName}，第 {pad2(s.lessonNumber)} 课 {s.lessonTitle}，{formatDate(s.submittedAt, true)}
      </p>
      <dl className="stats">
        <div>
          <dt>做对</dt>
          <dd>
            {s.correct}
            <small> / {s.total}</small>
          </dd>
        </div>
        <div>
          <dt>一次做对</dt>
          <dd>{firstTry}</dd>
        </div>
        <div>
          <dt>用时</dt>
          <dd>
            {s.summary.minutes ?? "—"}
            <small> 分钟</small>
          </dd>
        </div>
      </dl>
      <div className="res head">
        <span>题</span>
        <span>来源</span>
        <span>结果</span>
        <span>次数</span>
      </div>
      {s.summary.items.map((i) => (
        <div key={i.problemId} className={`res${i.attempts > 0 && !i.correct ? " bad" : ""}`}>
          <span>{i.index}</span>
          <span>{i.source ?? ""}</span>
          <span className={i.correct ? "green" : i.attempts ? "red" : "faint"}>{i.correct ? "✓" : i.attempts ? `✗ ${i.lastAnswer ?? ""}` : "没做"}</span>
          <span className="tabnum">{i.attempts}</span>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <Link to={`/admin/lessons/${s.lessonId}`} className="small">
          看这节课的全部作答
        </Link>
      </div>
    </div>
  );
}

/* ============================================================
   单节课：检查、编辑、发布
   ============================================================ */
interface LessonDetail extends LessonItem {
  content: LessonContent;
  checks: Check[];
  sourceNotes: string | null;
}
interface Results {
  problems: { id: string; index: number; source: string | null; answer: string; kind: string }[];
  students: { id: string; name: string; submittedAt: number | null; results: Record<string, { attempts: number; correct: boolean; answers: string[] }> }[];
}

export function AdminLesson({ id }: { id: string }) {
  const { data, error, reload } = useApi<LessonDetail>(`/api/admin/lessons/${id}`);
  const { data: results } = useApi<Results>(`/api/admin/lessons/${id}/results`);
  const [json, setJson] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; issues?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setJson(JSON.stringify(data.content, null, 2));
  }, [data]);

  if (error) return <ErrorView message={error.message} />;
  if (!data) return <Loading />;
  const problems = data.content.practice.sections.flatMap((s) => s.problems);
  const checkOf = new Map(data.checks.map((c) => [c.problemId, c]));
  const warnings = data.checks.filter((c) => c.level === "warn");

  const save = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/lessons/${id}`, { method: "PUT", body });
      setMsg({ ok: true, text: okText });
      reload();
    } catch (e) {
      const err = e as ApiError;
      setMsg({ ok: false, text: err.message, issues: err.issues });
    } finally {
      setBusy(false);
    }
  };

  const removeProblem = (pid: string) => {
    const content: LessonContent = {
      ...data.content,
      practice: { sections: data.content.practice.sections.map((s) => ({ ...s, problems: s.problems.filter((p) => p.id !== pid) })).filter((s) => s.problems.length > 0) },
    };
    save({ content }, "已删除这道题");
  };

  const publish = async (replace = false) => {
    if (!replace && warnings.length > 0 && !confirm(`还有 ${warnings.length} 道题没核对，确定发布吗？`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/lessons/${id}/publish`, { body: { replace } });
      setMsg({ ok: true, text: "已发布，学生现在能看到了" });
      reload();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.data?.clash && confirm(`${err.message}。用这个版本替换它吗？已有的作答和疑问会保留。`)) {
        setBusy(false);
        return publish(true);
      }
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wrap-wide" style={{ paddingTop: 48 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 28, flexWrap: "wrap" }}>
        <div className="numeral" style={{ fontSize: 88 }}>
          {pad2(data.number)}
        </div>
        <div>
          <h1 style={{ fontSize: 30 }}>{data.title}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {data.status === "draft" ? "草稿，学生看不到" : `已发布于 ${formatDate(data.publishedAt, true)}`}　最后修改 {formatDate(data.updatedAt, true)}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28, paddingBottom: 24, borderBottom: "1px solid var(--ink)" }}>
        <Link to={`/admin/preview/${id}/review`} className="btn">
          按学生视角预览
        </Link>
        {data.status === "draft" ? (
          <button className="btn btn-red" type="button" disabled={busy} onClick={() => publish()}>
            发布第 {pad2(data.number)} 课
          </button>
        ) : (
          <button className="btn" type="button" disabled={busy} onClick={async () => { await api(`/api/admin/lessons/${id}/unpublish`, { body: {} }); reload(); }}>
            撤回发布
          </button>
        )}
        {data.status === "draft" && (
          <button
            className="btn"
            type="button"
            style={{ border: 0, color: "var(--graphite)" }}
            onClick={async () => {
              if (!confirm("确定删除这份草稿？")) return;
              await api(`/api/admin/lessons/${id}`, { method: "DELETE" });
              navigate("/admin");
            }}
          >
            删除草稿
          </button>
        )}
      </div>
      {msg && (
        <div className={`notice ${msg.ok ? "info" : "warn"}`} style={{ marginTop: 20 }}>
          {msg.text}
          {msg.issues && (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {msg.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="cols" style={{ marginTop: 40 }}>
        <section>
          <MetaForm data={data} busy={busy} onSave={(meta) => save({ meta }, "课程信息已保存")} />

          <div className="section-head" style={{ marginTop: 48 }}>
            <h2>题目与答案</h2>
            <span className="aside">{warnings.length ? `${warnings.length} 道待核对` : "全部已核对"}</span>
          </div>
          {problems.map((p, i) => {
            const ch = checkOf.get(p.id);
            return (
              <div key={p.id} className={`drow${ch?.level === "warn" ? " warn" : ""}`} style={{ gridTemplateColumns: "28px minmax(0,1fr) auto" }}>
                <span className="muted">{i + 1}</span>
                <span>
                  <span className="xsmall muted" style={{ display: "block" }}>
                    {p.source ?? ""} {p.bankRef ? `（题库 ${p.bankRef}）` : ""}
                  </span>
                  <Rich text={p.statement.length > 160 ? `${p.statement.slice(0, 160)}…` : p.statement} />
                  <span style={{ display: "block", marginTop: 4 }}>
                    答案：<b>{p.kind === "choice" ? `(${p.answer}) ` : ""}</b>
                    {p.kind === "choice" && p.choices ? <Rich as="span" text={p.choices["ABCDEF".indexOf(p.answer)] ?? ""} /> : p.answer}
                  </span>
                  {ch && <span className={`xsmall ${ch.level === "ok" ? "green" : "red"}`}>{ch.message}</span>}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  {ch?.level === "warn" && (
                    <button className="link-btn small" type="button" onClick={() => save({ verified: [p.id] }, "已标记为核对过")}>
                      我核对过了
                    </button>
                  )}
                  <button className="link-btn small muted" type="button" onClick={() => confirm("删除这道题？") && removeProblem(p.id)}>
                    删除
                  </button>
                </span>
              </div>
            );
          })}

          <div style={{ marginTop: 32 }}>
            <button className="link-btn" type="button" onClick={() => setShowJson(!showJson)}>
              {showJson ? "收起完整内容（JSON）" : "直接编辑完整内容（JSON）"}
            </button>
            {showJson && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <p className="xsmall muted">要点、图、例题、题目、解析都在这里。公式写在 $...$ 里；图的参数见 README。保存前会自动校验格式。</p>
                <textarea className="textarea code-area" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
                <div>
                  <button
                    className="btn btn-ink"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      try {
                        save({ content: JSON.parse(json) }, "内容已保存");
                      } catch (e) {
                        setMsg({ ok: false, text: `JSON 写错了：${(e as Error).message}` });
                      }
                    }}
                  >
                    校验并保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>作答情况</h2>
          </div>
          {!results ? (
            <Loading />
          ) : results.students.length === 0 ? (
            <p className="muted" style={{ paddingTop: 16 }}>
              还没有学生。
            </p>
          ) : (
            results.students.map((st) => (
              <div key={st.id} style={{ marginTop: 20 }}>
                <p className="small">
                  <b style={{ fontWeight: 600 }}>{st.name}</b>
                  <span className="muted">　{st.submittedAt ? `${formatDate(st.submittedAt, true)} 交` : "还没交"}</span>
                </p>
                <div className="res head">
                  <span>题</span>
                  <span>作答</span>
                  <span>结果</span>
                  <span>次数</span>
                </div>
                {results.problems.map((p) => {
                  const r = st.results[p.id];
                  return (
                    <div key={p.id} className={`res${r.attempts && !r.correct ? " bad" : ""}`}>
                      <span>{p.index}</span>
                      <span className="muted" style={{ overflowWrap: "anywhere" }}>
                        {r.answers.join("，") || "—"}
                      </span>
                      <span className={r.correct ? "green" : r.attempts ? "red" : "faint"}>{r.correct ? "✓" : r.attempts ? "✗" : "没做"}</span>
                      <span className="tabnum">{r.attempts}</span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {data.sourceNotes && (
            <details style={{ marginTop: 40 }}>
              <summary className="small" style={{ cursor: "pointer" }}>
                生成时用的课堂纪要
              </summary>
              <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
                {data.sourceNotes}
              </p>
            </details>
          )}
        </section>
      </div>
    </main>
  );
}

function MetaForm({ data, busy, onSave }: { data: LessonDetail; busy: boolean; onSave: (meta: Record<string, unknown>) => void }) {
  const [meta, setMeta] = useState({
    number: String(data.number),
    title: data.title,
    titleEn: data.titleEn ?? "",
    classDate: data.classDate ?? "",
    chapters: data.chapters ?? "",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          number: Number(meta.number),
          title: meta.title,
          titleEn: meta.titleEn || null,
          classDate: meta.classDate || null,
          chapters: meta.chapters || null,
        });
      }}
      style={{ display: "grid", gridTemplateColumns: "170px minmax(0,1fr)", gap: 16 }}
    >
      <label className="field">
        课次
        <input className="input" value={meta.number} onChange={(e) => setMeta({ ...meta, number: e.target.value })} inputMode="numeric" />
      </label>
      <label className="field">
        标题
        <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        英文标题
        <input className="input" value={meta.titleEn} onChange={(e) => setMeta({ ...meta, titleEn: e.target.value })} />
      </label>
      <label className="field">
        上课日期
        <input className="input" type="date" value={meta.classDate} onChange={(e) => setMeta({ ...meta, classDate: e.target.value })} />
      </label>
      <label className="field">
        教材章节
        <input className="input" value={meta.chapters} onChange={(e) => setMeta({ ...meta, chapters: e.target.value })} placeholder="例如 Ch. 4.1–4.3" />
      </label>
      <div style={{ gridColumn: "1 / -1" }}>
        <button className="btn" type="submit" disabled={busy}>
          保存课程信息
        </button>
      </div>
    </form>
  );
}

/* ============================================================
   AI 生成新课
   ============================================================ */
interface BankGroup {
  key: string;
  book: string;
  chapter: string | null;
  section: string | null;
  kind: string;
  n: number;
  with_answer: number;
}
const KIND_LABEL: Record<string, string> = { example: "例题", exercise: "练习", review: "复习题", challenge: "挑战题", contest: "竞赛真题" };
const groupLabel = (g: BankGroup) => [g.book, g.chapter && `第 ${g.chapter} 章`, g.section, KIND_LABEL[g.kind] ?? g.kind].filter(Boolean).join("　");

export function AdminGenerate() {
  const { data: overview } = useApi<Overview>("/api/admin/overview");
  const { data: groups } = useApi<BankGroup[]>("/api/admin/bank/groups");
  const nextNumber = useMemo(() => Math.max(0, ...(overview?.lessons.map((l) => l.number) ?? [0])) + 1, [overview]);
  const [form, setForm] = useState({ number: "", classDate: new Date().toISOString().slice(0, 10), summary: "", bookCount: "6", contestCount: "4", notes: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ lessonId: string; checks: Check[] } | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string[] } | null>(null);

  const number = form.number || String(nextNumber);
  const toggle = (k: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const run = async () => {
    setRunning(true);
    setLog([]);
    setResult(null);
    setError(null);
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number: Number(number),
          classDate: form.classDate || null,
          groups: [...selected],
          summary: form.summary,
          bookCount: Number(form.bookCount),
          contestCount: Number(form.contestCount),
          notes: form.notes,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw Object.assign(new Error(d.error ?? `请求失败（${res.status}）`), { detail: d.issues });
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; lessonId?: string; checks?: Check[]; message?: string; detail?: string[] };
          if (ev.type === "stage" && ev.text) setLog((l) => [...l, ev.text as string]);
          if (ev.type === "done" && ev.lessonId) setResult({ lessonId: ev.lessonId, checks: ev.checks ?? [] });
          if (ev.type === "error") setError({ message: ev.message ?? "生成失败", detail: ev.detail });
        }
      }
    } catch (e) {
      setError({ message: (e as Error).message, detail: (e as { detail?: string[] }).detail });
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  };

  const books = groups?.filter((g) => g.kind !== "contest") ?? [];
  const contests = groups?.filter((g) => g.kind === "contest") ?? [];

  return (
    <main className="wrap-wide" style={{ paddingTop: 48 }}>
      <div className="cols-gen">
        <form
          style={{ display: "flex", flexDirection: "column", gap: 28 }}
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div>
            <h1 style={{ fontSize: 28 }}>生成第 {pad2(Number(number) || 0)} 课</h1>
            <p className="muted" style={{ marginTop: 6, fontSize: 15, lineHeight: 1.7 }}>
              把课后腾讯会议的纪要贴进来，选好教材范围。生成的是草稿，学生看不到，你检查完再发布。
            </p>
          </div>
          {overview && !overview.config.ai && <div className="notice warn">还没有配置大模型（AI_API_KEY），现在点生成会失败。</div>}
          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 16 }}>
            <label className="field">
              课次
              <input className="input" value={number} onChange={(e) => setForm({ ...form, number: e.target.value })} inputMode="numeric" />
            </label>
            <label className="field">
              上课日期
              <input className="input" type="date" value={form.classDate} onChange={(e) => setForm({ ...form, classDate: e.target.value })} />
            </label>
          </div>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="xsmall muted" style={{ padding: 0, marginBottom: 6 }}>
              教材范围（从题库里选）
            </legend>
            {!groups ? (
              <span className="small muted">正在读取题库…</span>
            ) : books.length === 0 ? (
              <div className="notice small">
                题库里还没有课本题目。可以先去 <Link to="/admin/bank">题库</Link> 导入；不导入也能生成，课本练习会改为 AI 按本课内容出题（需要你核对答案）。
              </div>
            ) : (
              books.map((g) => (
                <label className="chk" key={g.key}>
                  <input type="checkbox" checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
                  {groupLabel(g)}
                  <span className="xsmall muted" style={{ marginLeft: "auto" }}>
                    {g.n} 题，{g.with_answer} 题有答案
                  </span>
                </label>
              ))
            )}
            {contests.length > 0 && (
              <>
                <legend className="xsmall muted" style={{ padding: 0, margin: "16px 0 6px" }}>
                  竞赛真题（可选，优先从这里选 AMC 题）
                </legend>
                {contests.map((g) => (
                  <label className="chk" key={g.key}>
                    <input type="checkbox" checked={selected.has(g.key)} onChange={() => toggle(g.key)} />
                    {groupLabel(g)}
                    <span className="xsmall muted" style={{ marginLeft: "auto" }}>
                      {g.n} 题
                    </span>
                  </label>
                ))}
              </>
            )}
          </fieldset>
          <label className="field">
            腾讯会议纪要
            <textarea
              className="textarea"
              rows={10}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="粘贴腾讯会议的智能纪要或转写文字。写得越具体越好：讲了哪些题、学生在哪里卡住、强调了什么。"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 16 }}>
            <label className="field">
              课本练习题数
              <input className="input" value={form.bookCount} onChange={(e) => setForm({ ...form, bookCount: e.target.value })} inputMode="numeric" />
            </label>
            <label className="field">
              AMC 真题题数
              <input className="input" value={form.contestCount} onChange={(e) => setForm({ ...form, contestCount: e.target.value })} inputMode="numeric" />
            </label>
          </div>
          <label className="field">
            额外要求（可不填）
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="例如：多放一道需要用补集的题" />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <button className="btn btn-ink" type="submit" disabled={running || form.summary.trim().length < 20} style={{ height: 48, padding: "0 28px", fontSize: 15 }}>
              {running ? "正在生成…" : "生成草稿"}
            </button>
            <span className="xsmall muted">通常 1 到 3 分钟，生成时不要关掉这个页面</span>
          </div>
        </form>

        <section className="draft-box" aria-live="polite">
          <h2 style={{ fontSize: 22 }}>{result ? "草稿已生成" : running ? "正在生成" : "草稿"}</h2>
          {!running && !result && !error && (
            <p className="muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
              生成后这里会列出每道题的答案核对结果。课本题会和题库答案逐一比对；AMC 题由 AI 凭记忆给出，会标出来请你核对。
            </p>
          )}
          {(running || log.length > 0) && (
            <ul className="log" style={{ marginTop: 16 }}>
              {log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
              {running && <li className="muted">已用 {elapsed} 秒…</li>}
            </ul>
          )}
          {error && (
            <div className="notice warn" style={{ marginTop: 16 }}>
              {error.message}
              {error.detail && (
                <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                  {error.detail.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result && (
            <>
              <h3 style={{ margin: "24px 0 4px", fontSize: 15 }}>答案核对</h3>
              {result.checks.map((c, i) => (
                <div className={`drow${c.level === "warn" ? " warn" : ""}`} key={c.problemId}>
                  <span className="muted">{i + 1}</span>
                  <span>{c.problemId}</span>
                  <span className={`xsmall ${c.level === "ok" ? "green" : "red"}`}>{c.message}</span>
                </div>
              ))}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--ink)" }}>
                <Link to={`/admin/preview/${result.lessonId}/review`} className="btn">
                  按学生视角预览
                </Link>
                <Link to={`/admin/lessons/${result.lessonId}`} className="btn btn-red" style={{ color: "#fff" }}>
                  检查并发布
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
      <ImportLesson nextNumber={nextNumber} />
    </main>
  );
}

/* 导入在别处做好的整课 JSON（格式同“直接编辑完整内容”，外加课程信息） */
function ImportLesson({ nextNumber }: { nextNumber: number }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<{ text: string; issues?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section style={{ marginTop: 56, paddingTop: 24, borderTop: "1px solid var(--rule-light)" }}>
      <button className="link-btn small" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "收起" : "或者：导入做好的整课 JSON"}
      </button>
      {open && (
        <>
          <p className="small muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
            {`格式：{"number": ${nextNumber}, "title": "…", "titleEn": "…", "classDate": "YYYY-MM-DD", "chapters": "AoPS Ch. 2.2–2.4", "content": {"review": …, "practice": …}}。content 和课程页里“直接编辑完整内容”的格式相同。导入后是草稿，带 bankRef 的题会用题库核对答案。`}
          </p>
          <textarea className="textarea code-area" style={{ marginTop: 12, minHeight: 220 }} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button
              className="btn btn-ink"
              type="button"
              disabled={!json.trim() || busy}
              onClick={async () => {
                setMsg(null);
                setBusy(true);
                try {
                  const r = await api<{ id: string }>("/api/admin/lessons", { body: JSON.parse(json) });
                  navigate(`/admin/lessons/${r.id}`);
                } catch (e) {
                  if (e instanceof SyntaxError) setMsg({ text: `JSON 写错了：${e.message}` });
                  else setMsg({ text: (e as Error).message, issues: (e as ApiError).issues });
                } finally {
                  setBusy(false);
                }
              }}
            >
              导入为草稿
            </button>
            {msg && <span className="small red">{msg.text}</span>}
          </div>
          {msg?.issues && (
            <ul className="xsmall red" style={{ marginTop: 8 }}>
              {msg.issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ============================================================
   学生
   ============================================================ */
export function AdminStudents() {
  const { data, error, reload } = useApi<{ id: string; name: string; created_at: number; last_active: number | null }[]>("/api/admin/students");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ name: string; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorView message={error.message} />;
  const link = (code: string) => `${location.origin}/k/${code}`;
  return (
    <main className="wrap" style={{ paddingTop: 48, maxWidth: 900 }}>
      <div className="section-head">
        <h1 style={{ fontSize: 28 }}>学生</h1>
      </div>
      {secret && (
        <div className="secret-box" style={{ marginTop: 24 }}>
          <p>
            {secret.name} 的口令：<code>{secret.code}</code>
          </p>
          <p className="small" style={{ marginTop: 8 }}>
            登录链接（发给学生，点开即可进入）：<br />
            <code style={{ fontSize: 14 }}>{link(secret.code)}</code>
          </p>
          <p className="xsmall muted" style={{ marginTop: 8 }}>
            口令只显示这一次，系统只保存加密后的结果。丢了可以重新生成。
          </p>
          <button className="btn btn-sm" type="button" style={{ marginTop: 10 }} onClick={() => navigator.clipboard?.writeText(link(secret.code))}>
            复制登录链接
          </button>
        </div>
      )}
      <form
        style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 32, flexWrap: "wrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const r = await api<{ name: string; code: string }>("/api/admin/students", { body: { name } });
            setSecret(r);
            setName("");
            reload();
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
      >
        <label className="field" style={{ minWidth: 260 }}>
          学生名字
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 周同学" />
        </label>
        <button className="btn btn-ink" type="submit" disabled={!name.trim()}>
          添加并生成口令
        </button>
        {err && <span className="error-text">{err}</span>}
      </form>
      <div style={{ marginTop: 40 }}>
        {!data ? (
          <Loading />
        ) : (
          data.map((s) => (
            <div key={s.id} className="arow" style={{ gridTemplateColumns: "minmax(0,1fr) 200px 220px" }}>
              <span>{s.name}</span>
              <span className="small muted">{s.last_active ? `最近做题 ${relativeTime(s.last_active)}` : "还没做过题"}</span>
              <span style={{ display: "flex", gap: 16 }}>
                <button
                  className="link-btn small"
                  type="button"
                  onClick={async () => {
                    if (!confirm(`给 ${s.name} 重新生成口令？旧口令会失效。`)) return;
                    const r = await api<{ code: string }>(`/api/admin/students/${s.id}/reset`, { body: {} });
                    setSecret({ name: s.name, code: r.code });
                  }}
                >
                  重新生成口令
                </button>
                <button
                  className="link-btn small muted"
                  type="button"
                  onClick={async () => {
                    if (!confirm(`停用 ${s.name}？作答记录会保留。`)) return;
                    await api(`/api/admin/students/${s.id}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  停用
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

/* ============================================================
   题库
   ============================================================ */
export function AdminBank() {
  const { data: groups, reload } = useApi<BankGroup[]>("/api/admin/bank/groups");
  const [open, setOpen] = useState<string | null>(null);
  const { data: items } = useApi<{ id: string; number: string | null; statement: string; answer: string | null; source: string | null }[]>(
    open ? `/api/admin/bank?group=${encodeURIComponent(open)}` : null,
  );
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <main className="wrap-wide" style={{ paddingTop: 48 }}>
      <div className="cols">
        <section>
          <div className="section-head">
            <h1 style={{ fontSize: 28 }}>题库</h1>
            <span className="aside">{groups?.reduce((a, g) => a + g.n, 0) ?? 0} 道题</span>
          </div>
          {groups?.map((g) => (
            <div key={g.key}>
              <button className="chk" type="button" style={{ width: "100%", background: "none", border: 0, borderTop: "1px solid var(--rule-light)", cursor: "pointer", textAlign: "left" }} onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key}>
                {groupLabel(g)}
                <span className="xsmall muted" style={{ marginLeft: "auto" }}>
                  {g.n} 题，{g.with_answer} 题有答案
                </span>
              </button>
              {open === g.key && (
                <div style={{ padding: "8px 0 20px 28px" }}>
                  {!items ? (
                    <span className="small muted">正在读取…</span>
                  ) : (
                    items.map((it) => (
                      <div key={it.id} className="drow" style={{ gridTemplateColumns: "60px minmax(0,1fr) 100px" }}>
                        <span className="muted xsmall">{it.number ?? ""}</span>
                        <Rich text={it.statement.length > 220 ? `${it.statement.slice(0, 220)}…` : it.statement} />
                        <span className={it.answer ? undefined : "red xsmall"}>{it.answer ?? "无答案"}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
        <section>
          <div className="section-head">
            <h2>导入题目</h2>
          </div>
          <p className="small muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
            粘贴 JSON 数组。每道题的字段：id（唯一）、book（如 "AoPS ICP"）、chapter（如 "4"）、section（如 "4.2"）、kind（example / exercise / review / challenge / contest）、number、statement（公式写在 $...$ 里）、answer、solution、source。
            id 相同会覆盖。课本 PDF 可以先用 MinerU 转成 Markdown 再整理成这个格式。
          </p>
          <textarea
            className="textarea code-area"
            style={{ marginTop: 12, minHeight: 280 }}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            placeholder={'[\n  {"id": "icp-4-ex-1", "book": "AoPS ICP", "chapter": "4", "section": "4.2", "kind": "exercise", "number": "4.2.1", "statement": "Compute $\\\\binom{9}{3}$.", "answer": "84"}\n]'}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button
              className="btn btn-ink"
              type="button"
              disabled={!json.trim()}
              onClick={async () => {
                setMsg(null);
                try {
                  const r = await api<{ imported: number; errors: string[] }>("/api/admin/bank", { body: JSON.parse(json) });
                  setMsg(`导入了 ${r.imported} 道题${r.errors.length ? `；有问题的：${r.errors.join("；")}` : ""}`);
                  reload();
                } catch (e) {
                  setMsg(e instanceof SyntaxError ? `JSON 写错了：${e.message}` : (e as Error).message);
                }
              }}
            >
              导入
            </button>
            {msg && <span className="small">{msg}</span>}
          </div>
        </section>
      </div>
    </main>
  );
}

/* 微信里点进来的疑问链接：跳到页面上那个位置 */
export function AdminPinRedirect({ id }: { id: string }) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Pin>(`/api/admin/pins/${id}`)
      .then((p) => navigate(`/admin/preview/${p.lessonId}/${pinWhere(p)}?pin=${p.id}`, { replace: true }))
      .catch((e) => setErr((e as Error).message));
  }, [id]);
  return err ? <ErrorView message={err} /> : <Loading text="正在打开这条疑问…" />;
}
