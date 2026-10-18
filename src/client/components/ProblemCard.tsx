import { useState } from "react";
import type { AttemptResult, ProblemState, PublicProblem } from "../../shared/api";
import { UNLOCK_AFTER_ATTEMPTS } from "../../shared/answers";
import { api, pad2 } from "../api";
import { Rich, renderRich } from "../rich";
import { FigureView } from "./figures";

const LETTERS = "ABCDEF";

export function ProblemCard({
  problem,
  index,
  state,
  lessonNumber,
  preview,
  onState,
}: {
  problem: PublicProblem;
  index: number;
  state: ProblemState;
  lessonNumber: number;
  preview: boolean;
  onState: (s: ProblemState) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [shake, setShake] = useState(false);
  const label = `第 ${index} 题`;
  const anchor = `p.${problem.id}`;

  const submit = async (answer: string) => {
    if (!answer.trim() || busy || state.correct) return;
    if (preview) return setError("预览模式下不记录作答");
    setBusy(true);
    setError(null);
    try {
      const r = await api<AttemptResult>(`/api/lessons/${lessonNumber}/attempts`, { body: { problemId: problem.id, answer: answer.trim() } });
      onState(r.state);
      if (!r.correct) {
        setShake(true);
        setTimeout(() => setShake(false), 450);
      } else setValue("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const last = state.answers.at(-1);
  const wrongLetters = problem.kind === "choice" ? new Set(state.answers.map((a) => a.toUpperCase())) : new Set<string>();
  const solution = state.solution;
  const toggle = () => {
    if (!open && !revealed) setRevealed(true);
    setOpen(!open);
  };

  return (
    <article className="problem" id={`problem-${problem.id}`}>
      <span className="num">{pad2(index)}</span>
      <div data-anchor={anchor} data-anchor-label={label}>
        {problem.source && <div className="src">{problem.source}</div>}
        <Rich className="statement" text={problem.statement} />
        {problem.statementZh && <Rich className="statement-zh" text={problem.statementZh} />}

        {problem.kind === "choice" && problem.choices ? (
          <div className={`choices${shake ? " shake" : ""}`} role="group" aria-label={`${label}的选项`}>
            {problem.choices.map((c, i) => {
              const letter = LETTERS[i];
              const isRight = state.correct && last?.toUpperCase() === letter;
              const isWrong = !isRight && wrongLetters.has(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  className={`choice${isRight ? " right" : ""}${isWrong ? " wrong" : ""}`}
                  disabled={state.correct || isWrong || busy}
                  onClick={() => submit(letter)}
                  aria-pressed={isRight || isWrong}
                >
                  <span className="letter">({letter})</span>
                  <span className="val" dangerouslySetInnerHTML={{ __html: renderRich(c) }} />
                </button>
              );
            })}
          </div>
        ) : (
          !state.correct && (
            <form
              className={`answer-row${shake ? " shake" : ""}`}
              onSubmit={(e) => {
                e.preventDefault();
                submit(value);
              }}
            >
              <label className="field">
                你的答案
                <input
                  className="input-line"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`${label}的答案`}
                />
              </label>
              <button className="btn btn-ink" type="submit" disabled={busy || !value.trim()}>
                提交
              </button>
            </form>
          )
        )}

        <div className="feedback" aria-live="polite">
          {state.correct && <span className="ok">✓ {problem.kind === "choice" ? `(${last?.toUpperCase()})` : last}，正确</span>}
          {!state.correct && state.attempts > 0 && <span className="no">✗ 不是 {problem.kind === "choice" ? `(${last?.toUpperCase()})` : last}</span>}
          {!state.correct && state.attempts > 0 && problem.hint && (
            <span className="hint">
              提示：<span dangerouslySetInnerHTML={{ __html: renderRich(problem.hint, false) }} />
            </span>
          )}
          {!state.correct && state.attempts > 0 && state.attempts < UNLOCK_AFTER_ATTEMPTS && !solution && (
            <span className="hint">再试一次后可以看解析。</span>
          )}
          {solution && (
            <button className="link-btn muted" type="button" onClick={toggle} aria-expanded={open}>
              {open ? "收起解析" : "展开解析"}
            </button>
          )}
          {error && <span className="error-text">{error}</span>}
        </div>

        {solution && open && (
          <div className="solution">
            <ol className={`steps${revealed ? " reveal" : ""}`}>
              {solution.steps.map((s, i) => (
                <li key={i} data-anchor={`${anchor}.step.${i + 1}`} data-anchor-label={`${label}解析第 ${i + 1} 步`} style={{ animationDelay: `${i * 0.25}s` }}>
                  <b>{i + 1}</b>
                  <Rich text={s} />
                </li>
              ))}
            </ol>
            {solution.figure && (
              <div style={{ marginTop: 20 }}>
                <FigureView spec={solution.figure} title="图" anchor={`${anchor}.fig`} anchorLabel={`${label}的图`} />
              </div>
            )}
            <div className="final-answer">
              答案：<span dangerouslySetInnerHTML={{ __html: renderRich(solution.answer, false) }} />
            </div>
            {problem.tags && problem.tags.length > 0 && (
              <div className="tags">
                <span className="k">知识点</span>
                {problem.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
