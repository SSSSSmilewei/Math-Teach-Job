import { useEffect, useMemo, useState } from "react";
import type { LessonPayload, Pin, ProblemState } from "../../shared/api";
import type { Review } from "../../shared/schema";
import { api, formatClassDate, formatDate, pad2, relativeTime, useApi } from "../api";
import { ErrorView, Loading } from "../components/Layout";
import { PinBoard, PinLegend, PinModeButton, usePinMode } from "../components/PinBoard";
import { ProblemCard } from "../components/ProblemCard";
import { FigureView } from "../components/figures";
import { Rich, renderRich } from "../rich";
import { Link, navigate, useLocation } from "../router";

type Tab = "review" | "practice" | "questions";

export function LessonPage({
  number,
  previewId,
  tab: rawTab,
}: {
  number?: number;
  previewId?: string;
  tab?: string;
}) {
  const tab: Tab = rawTab === "practice" || rawTab === "questions" ? rawTab : "review";
  const preview = !!previewId;
  const { search } = useLocation();
  const focusPin = new URLSearchParams(search).get("pin");
  const path = preview ? `/api/admin/lessons/${previewId}/preview` : `/api/lessons/${number}`;
  const { data, error, setData } = useApi<LessonPayload>(path);
  const [mode, setMode] = usePinMode();
  const base = preview ? `/admin/preview/${previewId}` : `/l/${number}`;

  // 老师在预览里查看某条疑问
  useEffect(() => {
    if (!preview || !focusPin || !data) return;
    if (data.pins.some((p) => p.id === focusPin)) return;
    api<Pin>(`/api/admin/pins/${focusPin}`)
      .then((pin) => setData((d) => (d ? { ...d, pins: [pin] } : d)))
      .catch(() => {});
  }, [preview, focusPin, data, setData]);

  useEffect(() => {
    if (preview || !data || number === undefined) return;
    api(`/api/lessons/${number}/view`, { body: { tab } })
      .then(() => {
        if (tab === "practice" && !data.practiceStartedAt) setData((d) => (d ? { ...d, practiceStartedAt: Date.now() } : d));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, data?.id]);

  // #problem-xx 跳到题目
  useEffect(() => {
    if (!data || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }, [data, tab]);

  if (error) return <ErrorView message={error.message} action={<Link to="/">回到课程首页</Link>} />;
  if (!data) return <Loading />;

  const problems = data.sections.flatMap((s) => s.problems);
  const correct = problems.filter((p) => data.state[p.id]?.correct).length;
  const role = preview ? (focusPin ? "teacher" : "none") : "student";
  const setPins = (pins: Pin[]) => setData((d) => (d ? { ...d, pins } : d));

  return (
    <>
      {preview && (
        <div className="preview-banner">
          <div className="wrap">
            <span>
              学生视角预览{data.status === "draft" ? "（草稿，学生还看不到）" : ""}。预览中所有解析都已展开，作答不会被记录。
            </span>
            <Link to={`/admin/lessons/${previewId}`}>回到编辑</Link>
          </div>
        </div>
      )}
      <div className="wrap lesson-head">
        <div className="row">
          <div className="numeral">{pad2(data.number)}</div>
          <div style={{ paddingBottom: 2 }}>
            <h1>{data.title}</h1>
            <span className="en">
              {[data.titleEn, data.chapters, data.classDate && formatClassDate(data.classDate)].filter(Boolean).join("　")}
            </span>
          </div>
        </div>
        <div className="tabs-row">
          <nav className="tabs" aria-label="本课内容">
            <Link to={`${base}/review`} aria-current={tab === "review" ? "page" : undefined}>
              课堂复习
            </Link>
            <Link to={`${base}/practice`} aria-current={tab === "practice" ? "page" : undefined}>
              课后练习{" "}
              <span className="tabnum">
                {correct}/{problems.length}
              </span>
            </Link>
            {!preview && (
              <Link to={`${base}/questions`} aria-current={tab === "questions" ? "page" : undefined}>
                我的疑问 {data.pins.length > 0 && <span className="blue">{data.pins.length}</span>}
              </Link>
            )}
          </nav>
          {!preview && tab !== "questions" && <PinModeButton mode={mode} setMode={setMode} />}
        </div>
      </div>

      {tab === "practice" && (
        <ProgressStrip data={data} correct={correct} total={problems.length} />
      )}

      <main className="wrap" style={{ paddingBottom: 40 }}>
        {tab === "questions" ? (
          <QuestionsList pins={data.pins} base={base} />
        ) : (
          <PinBoard
            key={tab}
            lessonId={data.id}
            pins={data.pins}
            onPinsChange={setPins}
            mode={mode}
            setMode={setMode}
            role={role}
            rootAnchor={`lesson.${tab}`}
            focusPinId={focusPin}
            aside={!preview ? <PinLegend /> : null}
          >
            {tab === "review" ? (
              <ReviewView review={data.review} />
            ) : (
              <PracticeView data={data} setData={setData} preview={preview} correct={correct} total={problems.length} />
            )}
          </PinBoard>
        )}
      </main>
    </>
  );
}

function ProgressStrip({ data, correct, total }: { data: LessonPayload; correct: number; total: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const problems = data.sections.flatMap((s) => s.problems);
  const minutes = data.practiceStartedAt ? Math.max(0, Math.round((Date.now() - data.practiceStartedAt) / 60000)) : null;
  return (
    <div className="progress-strip">
      <div className="wrap">
        <span className="small tabnum" style={{ whiteSpace: "nowrap" }}>
          做对 {correct} 题，共 {total} 题
        </span>
        <span className="segments" aria-hidden="true">
          {problems.map((p) => {
            const s = data.state[p.id];
            return <span key={p.id} className={s?.correct ? "ok" : s && s.attempts > 0 ? "bad" : undefined} />;
          })}
        </span>
        {minutes !== null && (
          <span className="small muted tabnum" style={{ whiteSpace: "nowrap" }}>
            已用 {minutes} 分钟
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewView({ review }: { review: Review }) {
  return (
    <>
      {review.points.length > 0 && (
        <section className="block">
          <h2>本课要点</h2>
          <div>
            {review.points.map((p, i) => (
              <div className="point" key={i} data-anchor={`review.point.${i + 1}`} data-anchor-label={`要点 ${i + 1}`}>
                <span className="lbl">
                  要点 {i + 1}
                  {p.title && <b>{p.title}</b>}
                </span>
                <Rich text={p.body} />
              </div>
            ))}
          </div>
        </section>
      )}
      {review.figures.length > 0 && (
        <section className="block">
          <h2>图</h2>
          {review.figures.map((f, i) => (
            <FigureView
              key={f.id}
              spec={f.figure}
              title={`图 ${i + 1}　${f.title}`}
              caption={f.caption}
              anchor={`review.fig.${f.id}`}
              anchorLabel={`图 ${i + 1}`}
            />
          ))}
        </section>
      )}
      {review.examples.length > 0 && (
        <section className="block">
          <h2>课上例题</h2>
          {review.examples.map((e, i) => (
            <ExampleView key={e.id} example={e} index={i + 1} />
          ))}
        </section>
      )}
      {review.pitfalls.length > 0 && (
        <section className="block">
          <h2>容易出错的地方</h2>
          <div>
            {review.pitfalls.map((p, i) => (
              <div className="pitfall" key={i} data-anchor={`review.pitfall.${i + 1}`} data-anchor-label={`易错点 ${i + 1}`}>
                <Rich text={p} />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ExampleView({ example, index }: { example: Review["examples"][number]; index: number }) {
  const [shown, setShown] = useState(1);
  const all = shown >= example.steps.length;
  return (
    <div style={{ borderTop: "1px solid var(--ink)", paddingTop: 20, marginBottom: 48 }}>
      <div data-anchor={`review.ex.${example.id}`} data-anchor-label={`例 ${index}`}>
        <div className="xsmall muted">
          例 {index}
          {example.source ? `　${example.source}` : ""}
        </div>
        <Rich className="statement" text={example.statement} />
        {example.statementZh && <Rich className="statement-zh" text={example.statementZh} />}
      </div>
      <ol className="steps reveal" style={{ marginTop: 20 }}>
        {example.steps.slice(0, shown).map((s, i) => (
          <li key={i} data-anchor={`review.ex.${example.id}.step.${i + 1}`} data-anchor-label={`例 ${index} 第 ${i + 1} 步`}>
            <b>{i + 1}</b>
            <Rich text={s} />
          </li>
        ))}
      </ol>
      {!all && (
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          <button className="btn" type="button" onClick={() => setShown((n) => n + 1)}>
            显示下一步
          </button>
          <button className="btn" type="button" style={{ border: 0, color: "var(--graphite)" }} onClick={() => setShown(example.steps.length)}>
            全部显示
          </button>
        </div>
      )}
    </div>
  );
}

function PracticeView({
  data,
  setData,
  preview,
  correct,
  total,
}: {
  data: LessonPayload;
  setData: (f: (d: LessonPayload | null) => LessonPayload | null) => void;
  preview: boolean;
  correct: number;
  total: number;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const problems = data.sections.flatMap((s) => s.problems);
  const indexOf = useMemo(() => new Map(problems.map((p, i) => [p.id, i + 1])), [problems]);
  const attempted = problems.filter((p) => (data.state[p.id]?.attempts ?? 0) > 0).length;
  const wrong = attempted - correct;
  const blank = total - attempted;
  const setState = (id: string, s: ProblemState) => setData((d) => (d ? { ...d, state: { ...d.state, [id]: s } } : d));

  const submit = async () => {
    if (blank > 0 && !confirm(`还有 ${blank} 题没做，确定现在交吗？交了以后还可以继续做、再交一次。`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ submittedAt: number }>(`/api/lessons/${data.number}/submit`, { body: {} });
      setData((d) => (d ? { ...d, submittedAt: r.submittedAt } : d));
      setMsg("已交，老师会收到通知。");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="practice-intro">
        先自己做。每题提交后马上知道对错；答对，或者试过两次以后，可以展开解析。全部做完点最下面的“交作业”，老师会收到你的结果。
      </p>
      {data.sections.map((s) => (
        <section key={s.id} style={{ marginBottom: 56 }}>
          <div className="section-head">
            <h2>{s.title}</h2>
            <span className="aside">
              {s.note ? `${s.note}，` : ""}
              {s.problems.length} 题
            </span>
          </div>
          {s.problems.map((p) => (
            <ProblemCard
              key={p.id}
              problem={p}
              index={indexOf.get(p.id) ?? 0}
              state={data.state[p.id] ?? { attempts: 0, correct: false, answers: [] }}
              lessonNumber={data.number}
              preview={preview}
              onState={(st) => setState(p.id, st)}
            />
          ))}
        </section>
      ))}
      {!preview && (
        <section className="submit-box" aria-labelledby="submit-h">
          <div>
            <h2 id="submit-h">交作业</h2>
            <p className="muted" style={{ marginTop: 6, fontSize: 15 }}>
              做对 {correct} 题{wrong > 0 ? `，做错 ${wrong} 题` : ""}
              {blank > 0 ? `，还有 ${blank} 题没做` : ""}。
              {data.submittedAt ? `上次在 ${formatDate(data.submittedAt, true)} 交过，可以再交一次更新结果。` : "交了以后老师会收到通知，你仍然可以继续改。"}
            </p>
            {msg && (
              <p className="small" style={{ marginTop: 8, color: msg.startsWith("已交") ? "var(--green)" : "var(--red)" }}>
                {msg}
              </p>
            )}
          </div>
          <button className="btn btn-red" type="button" style={{ height: 48, padding: "0 28px", fontSize: 15 }} disabled={busy} onClick={submit}>
            {data.submittedAt ? "再交一次" : "交作业"}
          </button>
        </section>
      )}
    </>
  );
}

function QuestionsList({ pins, base }: { pins: Pin[]; base: string }) {
  const sorted = [...pins].sort((a, b) => a.createdAt - b.createdAt);
  if (sorted.length === 0)
    return (
      <div style={{ paddingTop: 48 }}>
        <p className="muted">还没有提过疑问。在复习或练习页面点“在页面上提问”，再点你没看懂的地方就行。</p>
      </div>
    );
  return (
    <div style={{ paddingTop: 40, maxWidth: 820 }}>
      {sorted.map((p, i) => {
        const answered = p.messages.some((m) => m.author === "teacher");
        const where = p.anchorKey.startsWith("p.") || p.anchorKey === "lesson.practice" ? "practice" : "review";
        return (
          <div className="q-item" key={p.id}>
            <span className={`dot ${p.status === "resolved" ? "resolved" : answered ? "answered" : ""}`}>{i + 1}</span>
            <div>
              <div className="where">
                <span>
                  {where === "practice" ? "课后练习" : "课堂复习"}
                  {p.anchorLabel ? `，${p.anchorLabel}` : ""}
                </span>
                <span>{p.status === "resolved" ? "已解决" : answered ? (p.unseenReply ? "老师回复了，还没看" : "已回复") : `等老师回复，${relativeTime(p.createdAt)}`}</span>
              </div>
              {p.messages.map((m) => (
                <div key={m.id} className={`msg ${m.author}`}>
                  {m.author === "teacher" && <span className="who">老师，{formatDate(m.createdAt, true)}</span>}
                  <span dangerouslySetInnerHTML={{ __html: renderRich(m.body, false) }} />
                </div>
              ))}
              <div className="note-actions">
                <button className="link-btn" type="button" onClick={() => navigate(`${base}/${where}?pin=${p.id}`)}>
                  在页面上看
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
