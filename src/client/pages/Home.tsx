import type { LessonSummary, RedoItem } from "../../shared/api";
import { formatClassDate, formatDate, pad2, useApi } from "../api";
import { ErrorView, Loading } from "../components/Layout";
import { Rich } from "../rich";
import { Link } from "../router";

function practiceStatus(l: LessonSummary): string {
  if (l.submittedAt) return `已交，${l.correct} / ${l.problemCount}`;
  if (l.attempted === 0) return "未开始";
  return `${l.correct} / ${l.problemCount}`;
}

function pinStatus(l: LessonSummary): { text: string; blue: boolean } {
  if (l.pinCount === 0) return { text: "无", blue: false };
  if (l.unseenReplies > 0) return { text: `${l.unseenReplies} 条新回复`, blue: true };
  if (l.openPins > 0) return { text: `${l.openPins} 条等回复`, blue: true };
  return { text: `${l.pinCount} 条，已回复`, blue: false };
}

export function Home() {
  const { data: lessons, error } = useApi<LessonSummary[]>("/api/lessons");
  const { data: redo } = useApi<RedoItem[]>("/api/redo");
  if (error) return <ErrorView message={error.message} />;
  if (!lessons) return <Loading />;
  if (lessons.length === 0)
    return (
      <main className="wrap" style={{ paddingTop: 96 }}>
        <h1 style={{ fontSize: 32 }}>还没有发布的课</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          上完第一节课后，复习和作业会出现在这里。
        </p>
      </main>
    );
  const latest = lessons[0];
  const pct = latest.problemCount ? Math.round((latest.correct / latest.problemCount) * 100) : 0;
  const latestPins = pinStatus(latest);

  return (
    <main className="wrap" style={{ paddingBottom: 24 }}>
      <section className="hero" aria-labelledby="latest">
        <div>
          <div className="numeral">{pad2(latest.number)}</div>
          <div className="small muted" style={{ marginTop: 20 }}>
            最新一课{latest.publishedAt ? `，${formatDate(latest.publishedAt)}发布` : ""}
          </div>
        </div>
        <div>
          <h1 id="latest">{latest.title}</h1>
          {latest.titleEn && <span className="en">{latest.titleEn}</span>}
          <dl className="meta">
            {latest.classDate && (
              <div>
                <dt>上课</dt>
                <dd>{formatClassDate(latest.classDate)}</dd>
              </div>
            )}
            {latest.chapters && (
              <div>
                <dt>教材</dt>
                <dd>{latest.chapters}</dd>
              </div>
            )}
            <div>
              <dt>作业</dt>
              <dd>{latest.problemCount} 题</dd>
            </div>
          </dl>
          <div className="panels">
            <Link to={`/l/${latest.number}/review`} className="panel-link">
              <span className="t">课堂复习</span>
              <span className="d">
                {latest.reviewStats.points} 条要点，{latest.reviewStats.figures} 个可以动手的图
                {latest.reviewStats.examples ? `，${latest.reviewStats.examples} 道课上讲过的例题` : ""}
              </span>
              <span className="f" style={{ color: latestPins.blue ? "var(--blue)" : "var(--graphite)" }}>
                {latest.pinCount === 0 ? "看不懂的地方可以直接在页面上提问" : `你的疑问：${latestPins.text}`}
              </span>
            </Link>
            <Link to={`/l/${latest.number}/practice`} className="panel-link">
              <span className="t">课后练习</span>
              <span className="d">共 {latest.problemCount} 题。做完交作业，老师能看到每题对错。</span>
              <span className="f">
                <span className="bar">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{latest.submittedAt ? `已交，${formatDate(latest.submittedAt)}` : latest.attempted === 0 ? "未开始" : "做到一半"}</span>
                  <span className="tabnum muted">
                    {latest.correct} / {latest.problemCount}
                  </span>
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="all" style={{ marginTop: 112 }}>
        <div className="section-head">
          <h2 id="all">全部课程</h2>
          <span className="aside">已上 {lessons.length} 课</span>
        </div>
        <div className="scroll-x">
          <div className="lrow head">
            <span>课次</span>
            <span>主题</span>
            <span>教材</span>
            <span>上课日期</span>
            <span>练习</span>
            <span>疑问</span>
          </div>
          {lessons.map((l, i) => {
            const ps = pinStatus(l);
            return (
              <Link key={l.id} to={`/l/${l.number}/review`} className="lrow">
                <span className="n" style={i === 0 ? { color: "var(--red)" } : undefined}>
                  {pad2(l.number)}
                </span>
                <span>
                  <span className="tt">{l.title}</span>
                  {l.titleEn && <span className="te">{l.titleEn}</span>}
                </span>
                <span>{l.chapters ?? ""}</span>
                <span>{l.classDate ? formatClassDate(l.classDate).split("，")[0] : ""}</span>
                <span className="tabnum">{practiceStatus(l)}</span>
                <span style={{ color: ps.blue ? "var(--blue)" : "var(--graphite)" }}>{ps.text}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {redo && redo.length > 0 && (
        <section aria-labelledby="redo" style={{ marginTop: 96 }}>
          <div className="section-head">
            <h2 id="redo">待重做</h2>
            <Link to="/redo" className="aside">
              全部 {redo.length} 题
            </Link>
          </div>
          <div className="redo-grid">
            {redo.slice(0, 4).map((r) => (
              <RedoCard key={`${r.lessonNumber}-${r.problemId}`} item={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export function RedoCard({ item }: { item: RedoItem }) {
  return (
    <div className="redo-card">
      <span className="xsmall muted">
        第 {pad2(item.lessonNumber)} 课，第 {item.index} 题{item.source ? `　${item.source}` : ""}
      </span>
      <Rich className="st" text={item.statement} />
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginTop: 4 }}>
        <span className="red">答错 {item.wrongAttempts} 次</span>
        <Link to={`/l/${item.lessonNumber}/practice#problem-${item.problemId}`} style={{ fontWeight: 500 }}>
          重做这题
        </Link>
      </span>
    </div>
  );
}

export function RedoPage() {
  const { data, error } = useApi<RedoItem[]>("/api/redo");
  if (error) return <ErrorView message={error.message} />;
  if (!data) return <Loading />;
  return (
    <main className="wrap" style={{ paddingTop: 56 }}>
      <div className="section-head">
        <h1 style={{ fontSize: 28 }}>待重做</h1>
        <span className="aside">答错过、还没做对的题</span>
      </div>
      {data.length === 0 ? (
        <p className="muted" style={{ marginTop: 24 }}>
          没有待重做的题。做错的题会自动出现在这里，做对后消失。
        </p>
      ) : (
        <div className="redo-grid">
          {data.map((r) => (
            <RedoCard key={`${r.lessonNumber}-${r.problemId}`} item={r} />
          ))}
        </div>
      )}
    </main>
  );
}
