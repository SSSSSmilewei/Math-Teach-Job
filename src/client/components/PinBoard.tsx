import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Pin } from "../../shared/api";
import { api, formatDate } from "../api";
import { renderRich } from "../rich";

/**
 * 随处提问：点页面任意位置钉一个图钉，在页边（宽屏）或底部面板（手机）写疑问。
 *
 * 定位方法借鉴 SitePing：内容块带稳定的语义锚点 data-anchor，
 * 图钉存成“相对这个块的百分比坐标”，页面缩放、解析展开都不会错位。
 */

export interface Draft {
  anchorKey: string;
  anchorLabel: string | null;
  xPct: number;
  yPct: number;
  snippet: string | null;
}

type Role = "student" | "teacher" | "none";

interface Placed {
  key: string; // pin id 或 "draft"
  x: number;
  y: number;
}

const NOTE_GAP = 16;

export function usePinMode() {
  const [mode, setMode] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape") setMode(false);
      if ((e.key === "q" || e.key === "Q") && !e.metaKey && !e.ctrlKey && !e.altKey) setMode((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("pin-mode", mode);
    return () => document.body.classList.remove("pin-mode");
  }, [mode]);
  return [mode, setMode] as const;
}

export function PinModeButton({ mode, setMode }: { mode: boolean; setMode: (m: boolean) => void }) {
  return (
    <button className="btn btn-outline-blue" type="button" aria-pressed={mode} onClick={() => setMode(!mode)} title="快捷键 Q">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 0v4M8 12v4M0 8h4M12 8h4" />
      </svg>
      {mode ? "点一下要问的地方" : "在页面上提问"}
    </button>
  );
}

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1101px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function findAnchor(main: HTMLElement, key: string): HTMLElement | null {
  try {
    const el = main.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(key)}"]`);
    if (!el || el.getClientRects().length === 0) return null;
    return el;
  } catch {
    return null;
  }
}

export function PinBoard({
  lessonId,
  pins,
  onPinsChange,
  mode,
  setMode,
  role,
  rootAnchor,
  focusPinId,
  aside,
  children,
}: {
  lessonId: string;
  pins: Pin[];
  onPinsChange: (pins: Pin[]) => void;
  mode: boolean;
  setMode: (m: boolean) => void;
  role: Role;
  rootAnchor: string;
  focusPinId?: string | null;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const noteRefs = useRef(new Map<string, HTMLDivElement>());
  const wide = useWide();
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [marginBox, setMarginBox] = useState({ left: 0, width: 0, top: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [active, setActive] = useState<string | null>(focusPinId ?? null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const numbered = useMemo(() => {
    const sorted = [...pins].sort((a, b) => a.createdAt - b.createdAt);
    return new Map(sorted.map((p, i) => [p.id, i + 1]));
  }, [pins]);
  const nextNumber = pins.length + 1;

  /* ---------- 计算位置 ---------- */
  const measure = useCallback(() => {
    const body = bodyRef.current;
    const main = mainRef.current;
    if (!body || !main) return;
    const b = body.getBoundingClientRect();
    const items: Placed[] = [];
    const place = (key: string, anchorKey: string, xPct: number, yPct: number) => {
      const el = findAnchor(main, anchorKey);
      if (!el) return;
      const r = el.getBoundingClientRect();
      items.push({ key, x: r.left - b.left + xPct * r.width, y: r.top - b.top + yPct * r.height });
    };
    for (const p of pins) place(p.id, p.anchorKey, p.xPct, p.yPct);
    if (draft) place("draft", draft.anchorKey, draft.xPct, draft.yPct);
    items.sort((a, b2) => a.y - b2.y);
    setPlaced((prev) => (JSON.stringify(prev) === JSON.stringify(items) ? prev : items));
    const m = marginRef.current;
    if (m && m.offsetWidth > 0) {
      const mr = m.getBoundingClientRect();
      const hint = hintRef.current;
      const hintBottom = hint ? hint.getBoundingClientRect().bottom - b.top : 0;
      setMarginBox((prev) => {
        const next = { left: mr.left - b.left, width: mr.width, top: hintBottom + 24 };
        return prev.left === next.left && prev.width === next.width && prev.top === next.top ? prev : next;
      });
    }
  }, [pins, draft]);

  useLayoutEffect(() => {
    measure();
  }, [measure, layoutTick]);

  useEffect(() => {
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    if (bodyRef.current) ro.observe(bodyRef.current);
    if (mainRef.current) ro.observe(mainRef.current);
    const onResize = () => setLayoutTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(onResize).catch(() => {});
    const interval = setInterval(onResize, 1500); // 图里的动画会改变高度
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      clearInterval(interval);
    };
  }, []);

  /* 页边批注：按纵坐标排开，互不重叠 */
  useLayoutEffect(() => {
    if (!wide) return;
    const next: Record<string, number> = {};
    let bottom = marginBox.top - NOTE_GAP;
    for (const p of placed) {
      const h = noteRefs.current.get(p.key)?.offsetHeight ?? 60;
      const top = Math.max(p.y - 16, bottom + NOTE_GAP);
      next[p.key] = top;
      bottom = top + h;
    }
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  /* 有新回复的图钉，显示一会儿后标记为已读 */
  useEffect(() => {
    if (role !== "student") return;
    const visible = new Set(placed.map((p) => p.key));
    const unseen = pins.filter((p) => p.unseenReply && visible.has(p.id)).map((p) => p.id);
    if (unseen.length === 0) return;
    const t = setTimeout(() => {
      api("/api/pins/seen", { body: { ids: unseen } }).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [placed, pins, role]);

  /* 从列表跳过来时，滚到那个图钉 */
  useEffect(() => {
    if (!focusPinId) return;
    setActive(focusPinId);
    const p = placed.find((x) => x.key === focusPinId);
    const body = bodyRef.current;
    if (p && body) {
      const y = body.getBoundingClientRect().top + window.scrollY + p.y - window.innerHeight / 3;
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      if (!wide) setSheet(focusPinId);
    }
    // 只在第一次定位到时滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPinId, placed.length > 0]);

  /* ---------- 点击钉图钉 ---------- */
  const onClickCapture = (e: React.MouseEvent) => {
    if (role !== "student") return;
    if (!mode && !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const main = mainRef.current;
    if (!main) return;
    const target = e.target as HTMLElement;
    const anchorEl = (target.closest("[data-anchor]") as HTMLElement | null) ?? main;
    const el = main.contains(anchorEl) ? anchorEl : main;
    const r = el.getBoundingClientRect();
    const key = el === main ? rootAnchor : (el.dataset.anchor ?? rootAnchor);
    const label = el === main ? null : (el.dataset.anchorLabel ?? null);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    setDraft({
      anchorKey: key,
      anchorLabel: label,
      xPct: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
      yPct: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
      snippet: text || null,
    });
    setMode(false);
    setActive("draft");
    if (!wide) setSheet("draft");
  };

  const replacePin = (pin: Pin) => onPinsChange(pins.some((p) => p.id === pin.id) ? pins.map((p) => (p.id === pin.id ? pin : p)) : [...pins, pin]);

  const submitDraft = async (body: string) => {
    if (!draft) return;
    const pin = await api<Pin>("/api/pins", { body: { lessonId, ...draft, body } });
    onPinsChange([...pins, pin]);
    setDraft(null);
    setActive(pin.id);
    setSheet(null);
    setToast("已钉上，老师会收到通知");
    setTimeout(() => setToast(null), 2600);
  };

  const pinById = new Map(pins.map((p) => [p.id, p]));
  const leaders = wide
    ? placed
        .filter((p) => tops[p.key] !== undefined)
        .map((p) => {
          const ty = tops[p.key] + 11;
          const mx = marginBox.left;
          return {
            key: p.key,
            d: `M ${p.x + 13} ${p.y} L ${mx - 12} ${ty} L ${mx} ${ty}`,
          };
        })
    : [];

  const renderNote = (key: string, inSheet: boolean) => {
    if (key === "draft") {
      return draft ? (
        <DraftNote
          number={nextNumber}
          label={draft.anchorLabel}
          onCancel={() => {
            setDraft(null);
            setSheet(null);
          }}
          onSubmit={submitDraft}
        />
      ) : null;
    }
    const pin = pinById.get(key);
    if (!pin) return null;
    return (
      <PinNote
        pin={pin}
        number={numbered.get(pin.id) ?? 0}
        expanded={inSheet || active === pin.id}
        role={role}
        onExpand={() => setActive(pin.id)}
        onChange={replacePin}
        onRemove={() => {
          onPinsChange(pins.filter((p) => p.id !== pin.id));
          setSheet(null);
        }}
      />
    );
  };

  return (
    <div className="lesson-body" ref={bodyRef}>
      <div className="lesson-main" ref={mainRef} onClickCapture={onClickCapture} data-anchor={rootAnchor}>
        {children}
      </div>
      <aside className="lesson-margin" ref={marginRef} aria-label="疑问批注">
        <div ref={hintRef}>{aside}</div>
      </aside>

      <div className="pin-layer" aria-hidden={false}>
        <svg aria-hidden="true">
          {leaders.map((l) => (
            <path key={l.key} d={l.d} className={`leader${active === l.key ? " active" : ""}${l.key === "draft" ? " draft" : ""}`} />
          ))}
        </svg>
        {placed.map((p) => {
          const pin = pinById.get(p.key);
          const cls = p.key === "draft" ? "draft" : pin?.status === "resolved" ? "resolved" : pin?.messages.some((m) => m.author === "teacher") ? "answered" : "";
          const n = p.key === "draft" ? nextNumber : numbered.get(p.key);
          return (
            <button
              key={p.key}
              type="button"
              className={`pin-balloon ${cls}${active === p.key ? " active" : ""}${pin?.unseenReply ? " fresh" : ""}`}
              style={{ left: p.x, top: p.y }}
              aria-label={`疑问 ${n}`}
              onClick={() => {
                setActive(p.key);
                if (!wide) setSheet(p.key);
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {wide && (
        <div style={{ position: "absolute", left: marginBox.left, width: marginBox.width, top: 0 }}>
          {placed.map((p) => (
            <div
              key={p.key}
              ref={(el) => {
                if (el) noteRefs.current.set(p.key, el);
                else noteRefs.current.delete(p.key);
              }}
              className={`margin-note${p.key === "draft" ? " draft" : ""}${pinById.get(p.key)?.status === "resolved" ? " resolved" : ""}`}
              style={{ top: tops[p.key] ?? p.y, visibility: tops[p.key] === undefined ? "hidden" : "visible" }}
            >
              {renderNote(p.key, false)}
            </div>
          ))}
        </div>
      )}

      {!wide && sheet && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="疑问">
            <div className="grab" />
            {renderNote(sheet, true)}
          </div>
        </>
      )}
      {mode && <div className="pin-toast">点一下你有疑问的地方（按 Esc 取消）</div>}
      {toast && <div className="pin-toast">{toast}</div>}
    </div>
  );
}

function DraftNote({
  number,
  label,
  onCancel,
  onSubmit,
}: {
  number: number;
  label: string | null;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError("写一句你的疑问");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="note-form" onSubmit={submit}>
      <label className="note-head" htmlFor="pin-draft">
        <span className="dot draft">{number}</span>
        {label ? `在「${label}」这里提问` : "在这里提问"}
      </label>
      <textarea
        id="pin-draft"
        className="textarea"
        rows={3}
        autoFocus
        value={text}
        placeholder="这里哪一步没看懂？写一句就行"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      {error && <span className="error-text">{error}</span>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-blue" type="submit" disabled={busy}>
          {busy ? "正在钉上…" : "钉在这里"}
        </button>
        <button className="btn" type="button" style={{ border: 0, color: "var(--graphite)" }} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function PinNote({
  pin,
  number,
  expanded,
  role,
  onExpand,
  onChange,
  onRemove,
}: {
  pin: Pin;
  number: number;
  expanded: boolean;
  role: Role;
  onExpand: () => void;
  onChange: (pin: Pin) => void;
  onRemove: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = pin.messages.some((m) => m.author === "teacher");
  const first = pin.messages[0];
  const dotCls = pin.status === "resolved" ? "resolved" : answered ? "answered" : "";

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const url = role === "teacher" ? `/api/admin/pins/${pin.id}/reply` : `/api/pins/${pin.id}/messages`;
      onChange(await api<Pin>(url, { body: { body: text.trim() } }));
      setText("");
      setReplying(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <div className="note-collapsed" role="button" tabIndex={0} onClick={onExpand} onKeyDown={(e) => e.key === "Enter" && onExpand()}>
        <div className="note-head">
          <span className={`dot ${dotCls}`}>{number}</span>
          <span>
            {pin.anchorLabel ?? "疑问"}
            {pin.unseenReply ? <span className="blue">，老师回复了</span> : answered ? "，已回复" : "，等老师回复"}
          </span>
        </div>
        {first && <p className="msg" dangerouslySetInnerHTML={{ __html: renderRich(first.body, false) }} />}
      </div>
    );
  }

  return (
    <div>
      <div className="note-head">
        <span className={`dot ${dotCls}`}>{number}</span>
        {pin.anchorLabel ?? "疑问"}
        {pin.studentName && role === "teacher" ? `，${pin.studentName}` : ""}
      </div>
      {pin.messages.map((m) => (
        <div key={m.id} className={`msg ${m.author}`}>
          <span className="who">
            {m.author === "teacher" ? "老师" : role === "teacher" ? (pin.studentName ?? "学生") : "你"}，{formatDate(m.createdAt, true)}
          </span>
          <span dangerouslySetInnerHTML={{ __html: renderRich(m.body, false) }} />
        </div>
      ))}
      {role !== "none" && (
        <>
          {replying ? (
            <form className="note-form" onSubmit={send}>
              <textarea className="textarea" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={role === "teacher" ? "写下你的回复" : "还有哪里不明白？"} />
              {error && <span className="error-text">{error}</span>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-blue btn-sm" type="submit" disabled={busy}>
                  {role === "teacher" ? "发送回复" : "发送"}
                </button>
                <button className="link-btn muted" type="button" onClick={() => setReplying(false)}>
                  取消
                </button>
              </div>
            </form>
          ) : (
            <div className="note-actions">
              {role === "student" && answered && pin.status !== "resolved" && (
                <button
                  className="link-btn"
                  type="button"
                  onClick={async () => onChange(await api<Pin>(`/api/pins/${pin.id}/resolve`, { body: {} }))}
                >
                  明白了
                </button>
              )}
              <button className="link-btn muted" type="button" onClick={() => setReplying(true)}>
                {role === "teacher" ? "回复" : answered ? "接着问" : "补充一句"}
              </button>
              {role === "student" && !answered && (
                <button
                  className="link-btn muted"
                  type="button"
                  onClick={async () => {
                    await api(`/api/pins/${pin.id}`, { method: "DELETE" });
                    onRemove();
                  }}
                >
                  撤回
                </button>
              )}
              {pin.status === "resolved" && <span className="faint">已解决</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PinLegend() {
  return (
    <div className="margin-hint">
      <p>哪里没看懂，点右上角“在页面上提问”（或按 Q），再点那个位置，写一句话。老师回复后图钉会变成实心。</p>
      <div className="legend">
        <span>
          <span className="dot draft" />
          正在写
        </span>
        <span>
          <span className="dot" />
          等老师回复
        </span>
        <span>
          <span className="dot answered" />
          已回复
        </span>
      </div>
    </div>
  );
}
