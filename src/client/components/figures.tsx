import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FigureSpec } from "../../shared/schema";
import { Rich, Tex } from "../rich";

/* ============================================================
   参数化的计数动画。每个图只接收参数，数字全部在这里算，
   AI 生成时只需要填参数，不会出现“动画里的数算错”。
   ============================================================ */

/* ---------- 小工具 ---------- */
const fact = (n: number): bigint => {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
};
const binom = (n: number, k: number): bigint => (k < 0 || k > n ? 0n : fact(n) / (fact(k) * fact(n - k)));
const fmt = (x: bigint | number): string => {
  const s = x.toString();
  return s.length > 4 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, "{,}") : s;
};
const LETTERS = "ABCDEFGHIJ".split("");
const PEOPLE = "甲乙丙丁戊己".split("");

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

/** 用 tick 做种子的伪随机，保证同一帧重渲染结果不变。 */
function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function shuffled<T>(arr: T[], seed: number): T[] {
  const r = rng(seed + 1);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function useTicker(active: boolean, ms: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return t;
}

/* ---------- 各个图的步骤说明 ---------- */
export function stepsOf(spec: FigureSpec): string[] {
  switch (spec.type) {
    case "multiset": {
      const info = multisetInfo(spec.word);
      if (info.repeated.length === 0) return [`${info.word} 的 ${info.n} 个字母各不相同，直接排：$${info.n}! = ${fmt(fact(info.n))}$ 种。`];
      const top = info.repeated[0];
      const denom = info.repeated.map((g) => `${g.count}!`).join("\\,");
      return [
        `先把 ${info.word} 的 ${info.n} 个字母当成各不相同（同一个字母加下标区分）：$${info.n}! = ${fmt(fact(info.n))}$ 种。`,
        `交换两个 ${top.letter}：看起来完全一样，这不是一种新的排法。`,
        `所以每种真正的排法被重复数了 $${denom} = ${fmt(info.dup)}$ 次。`,
        `答案是 $\\dfrac{${info.n}!}{${denom}} = ${fmt(info.total)}$。`,
      ];
    }
    case "grid-path": {
      const segs = spec.segments;
      const counts = segs.map((s) => binom(s.cols + s.rows, s.rows));
      const out = [
        segs.length === 1
          ? `从左下角走到右上角，每一步只能向右或向上，走最短路。`
          : `路线分成 ${segs.length} 段${spec.connector ? `，中间${spec.connector}` : ""}，每段都只能向右或向上走最短路。`,
        `随便取一条最短路，把每一步记成 → 或 ↑。`,
      ];
      segs.forEach((s, i) =>
        out.push(
          `${segs.length > 1 ? `第 ${i + 1} 段：` : ""}共 ${s.cols + s.rows} 步，其中 ${s.rows} 步向上，选出哪几步向上：$\\binom{${s.cols + s.rows}}{${s.rows}} = ${fmt(counts[i])}$ 种。`,
        ),
      );
      if (segs.length > 1)
        out.push(`各段互不影响，相乘：$${counts.map(fmt).join(" \\times ")} = ${fmt(counts.reduce((a, b) => a * b, 1n))}$ 种。`);
      return out;
    }
    case "choose": {
      const n = spec.pool.length;
      return [
        `从 $\\{${spec.pool.join(", ")}\\}$ 里选 ${spec.k} 个${spec.prefix ? `，接在 ${spec.prefix} 后面` : ""}。`,
        `选定之后，从小到大排只有一种排法。`,
        `换一组也一样：每一组选法恰好对应一个递增的数。`,
        `所以个数就是选法数：$\\binom{${n}}{${spec.k}} = ${fmt(binom(n, spec.k))}$。`,
      ];
    }
    case "select-arrange": {
      const { n, k } = spec;
      const chosen = chosenIndices(n, k).map((i) => LETTERS[i]);
      return [
        `${n} 个人里选出 ${k} 个，不计顺序。`,
        `比如选中 $\\{${chosen.join(", ")}\\}$。`,
        `这 ${k} 个人排成一队有 $${k}! = ${fmt(fact(k))}$ 种方式，但它们都是同一个组合。`,
        `所以 $P(${n},${k}) = \\binom{${n}}{${k}}\\cdot ${k}! = ${fmt(binom(n, k))} \\times ${fmt(fact(k))} = ${fmt(fact(n) / fact(n - k))}$。`,
      ];
    }
    case "slots": {
      const total = spec.slots.reduce((a, s) => a * BigInt(s.count), 1n);
      return [
        ...spec.slots.map((s, i) => `${s.label}（第 ${i + 1} 格）：${s.count} 种选法。`),
        `每一格的选法数都不受前面影响，相乘：$${spec.slots.map((s) => s.count).join(" \\times ")} = ${fmt(total)}$。`,
      ];
    }
    case "stars-bars": {
      const { stars: s, bins: b } = spec;
      return [
        `把 ${s} 个相同的球分给 ${b} 个人，可以有人分不到。`,
        `把球排成一行，插入 ${b - 1} 块隔板：隔板之间的球归同一个人。`,
        `每种分法对应一种“球和隔板”的排列：${s + b - 1} 个位置里选 ${b - 1} 个放隔板。`,
        `共 $\\binom{${s + b - 1}}{${b - 1}} = ${fmt(binom(s + b - 1, b - 1))}$ 种分法。`,
      ];
    }
    case "pascal": {
      const out: string[] = [];
      for (let r = 0; r < spec.rows; r++)
        out.push(r === 0 ? "第 0 行只有一个 1。" : `第 ${r} 行：两端是 1，中间每个数等于它肩上两个数之和。`);
      if (spec.highlight?.length) {
        const hs = spec.highlight.map(([r, k]) => `\\binom{${r}}{${k}}`).join(" = ");
        const [r0, k0] = spec.highlight[0];
        out.push(`第 $n$ 行第 $k$ 个数（都从 0 数）就是 $\\binom{n}{k}$：$${hs} = ${fmt(binom(r0, k0))}$。`);
      }
      return out;
    }
    case "circle": {
      const n = spec.n;
      return [
        `${n} 个人围着圆桌坐。`,
        `所有人一起顺时针挪一个座位：每个人左右的邻居都没变。`,
        `一种坐法转一圈能得到 ${n} 种“排列”，它们其实是同一种坐法。`,
        `所以共有 $\\dfrac{${n}!}{${n}} = (${n}-1)! = ${fmt(fact(n - 1))}$ 种。`,
      ];
    }
    case "complement":
      return [
        `${spec.totalLabel}：一共 ${fmt(spec.total).replace(/\{,\}/g, ",")} 个。`,
        `其中「${spec.excludedLabel}」的有 ${fmt(spec.excluded).replace(/\{,\}/g, ",")} 个，比正面去数简单得多。`,
        `剩下的就是要求的：$${fmt(spec.total)} - ${fmt(spec.excluded)} = ${fmt(spec.total - spec.excluded)}$。`,
      ];
  }
}

/* ---------- 有重复字母的排列 ---------- */
function multisetInfo(word: string) {
  const w = word.toUpperCase();
  const letters = w.split("");
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const l of letters) {
    if (!count.has(l)) order.push(l);
    count.set(l, (count.get(l) ?? 0) + 1);
  }
  const repeated = order
    .filter((l) => (count.get(l) ?? 0) > 1)
    .map((l) => ({ letter: l, count: count.get(l) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const group = new Map(repeated.map((g, i) => [g.letter, i]));
  const dup = repeated.reduce((a, g) => a * fact(g.count), 1n);
  return { word: w, letters, n: letters.length, repeated, group, dup, total: fact(letters.length) / dup };
}

function Multiset({ spec, step }: { spec: Extract<FigureSpec, { type: "multiset" }>; step: number }) {
  const info = useMemo(() => multisetInfo(spec.word), [spec.word]);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const swapping = step === 1 && info.repeated.length > 0;
  const t = useTicker(swapping, 1400);
  const [dx, setDx] = useState({ x: 0, y: 0 });
  const pair = useMemo(() => {
    if (!info.repeated.length) return null;
    const l = info.repeated[0].letter;
    const idx = info.letters.map((x, i) => (x === l ? i : -1)).filter((i) => i >= 0);
    return [idx[0], idx[1]] as const;
  }, [info]);
  useLayoutEffect(() => {
    if (!pair) return;
    const a = refs.current[pair[0]];
    const b = refs.current[pair[1]];
    if (a && b) setDx({ x: b.offsetLeft - a.offsetLeft, y: b.offsetTop - a.offsetTop });
  }, [pair, step]);
  const swapped = swapping && t % 2 === 1;
  const sub = new Map<string, number>();
  const showSub = step === 0 || step === 2;
  return (
    <div>
      <div className="tiles">
        {info.letters.map((l, i) => {
          const g = info.group.get(l);
          const k = (sub.get(l) ?? 0) + 1;
          sub.set(l, k);
          let transform = "none";
          if (swapped && pair && i === pair[0]) transform = `translate(${dx.x}px, ${dx.y}px)`;
          if (swapped && pair && i === pair[1]) transform = `translate(${-dx.x}px, ${-dx.y}px)`;
          return (
            <span
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={`tile${g !== undefined ? ` g${Math.min(g, 3)}` : ""}`}
              style={{ transform }}
            >
              {l}
              {showSub && g !== undefined ? <sub>{k}</sub> : null}
            </span>
          );
        })}
      </div>
      <div className="fig-formula">
        {step >= 2 && info.repeated.length > 0 ? (
          <Tex src={`\\frac{${info.n}!}{${info.repeated.map((g) => `${g.count}!`).join("\\,")}}${step >= 3 ? ` = ${fmt(info.total)}` : ""}`} />
        ) : step === 0 ? (
          <Tex src={`${info.n}! = ${fmt(fact(info.n))}`} />
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 网格路径 ---------- */
function GridPath({ spec, step, tick }: { spec: Extract<FigureSpec, { type: "grid-path" }>; step: number; tick: number }) {
  const u = 48;
  const gapX = spec.segments.length > 1 ? 1.2 : 0;
  const layout = useMemo(() => {
    let x = 0;
    let y = 0;
    const boxes = spec.segments.map((s) => {
      const box = { x0: x, y0: y, cols: s.cols, rows: s.rows, label: s.label };
      x += s.cols + gapX;
      y += s.rows + gapX;
      return box;
    });
    const w = boxes.at(-1)!.x0 + boxes.at(-1)!.cols;
    const h = boxes.at(-1)!.y0 + boxes.at(-1)!.rows;
    return { boxes, w, h };
  }, [spec.segments, gapX]);
  const pad = 40;
  const W = layout.w * u + pad * 2 + (spec.connector ? 60 : 0);
  const H = layout.h * u + pad * 2 + 20;
  // 数学坐标 (x, y) → 画布坐标，y 轴朝上
  const px = (x: number) => pad + (spec.connector ? 60 : 0) + x * u;
  const py = (y: number) => H - pad - 10 - y * u;
  const showPath = step >= 1;
  const paths = layout.boxes.map((b, i) => {
    const moves = shuffled([...Array(b.cols).fill("R"), ...Array(b.rows).fill("U")] as string[], tick * 7 + i * 13);
    let x = b.x0;
    let y = b.y0;
    const pts = [`${px(x)},${py(y)}`];
    for (const m of moves) {
      if (m === "R") x += 1;
      else y += 1;
      pts.push(`${px(x)},${py(y)}`);
    }
    return { moves, pts: pts.join(" "), len: (b.cols + b.rows) * u };
  });
  const activeSeg = step >= 2 ? Math.min(step - 2, layout.boxes.length - 1) : -1;
  return (
    <div>
      <svg className="fig-svg" viewBox={`0 0 ${W} ${H}`} width={W} role="img" aria-label="网格路径示意图">
        {layout.boxes.map((b, i) => (
          <g key={i} opacity={activeSeg >= 0 && layout.boxes.length > 1 && step - 2 < layout.boxes.length && activeSeg !== i ? 0.35 : 1}>
            {Array.from({ length: b.cols + 1 }, (_, c) => (
              <line key={`v${c}`} x1={px(b.x0 + c)} y1={py(b.y0)} x2={px(b.x0 + c)} y2={py(b.y0 + b.rows)} stroke="#b9bcbf" strokeWidth={1} />
            ))}
            {Array.from({ length: b.rows + 1 }, (_, r) => (
              <line key={`h${r}`} x1={px(b.x0)} y1={py(b.y0 + r)} x2={px(b.x0 + b.cols)} y2={py(b.y0 + r)} stroke="#b9bcbf" strokeWidth={1} />
            ))}
            {showPath && (
              <polyline
                key={`p${tick}-${i}`}
                points={paths[i].pts}
                fill="none"
                stroke="#000"
                strokeWidth={3}
                strokeLinejoin="round"
                style={{ strokeDasharray: paths[i].len, strokeDashoffset: paths[i].len, animation: `draw 1.2s ease ${i * 0.5}s forwards` }}
              />
            )}
            {b.label && (
              <text className="fig-label" x={px(b.x0 + b.cols / 2)} y={i === 0 ? py(b.y0) + 22 : py(b.y0 + b.rows) - 12} textAnchor="middle">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {layout.boxes.slice(1).map((b, i) => {
          const prev = layout.boxes[i];
          const x1 = px(prev.x0 + prev.cols);
          const y1 = py(prev.y0 + prev.rows);
          const x2 = px(b.x0);
          const y2 = py(b.y0);
          return (
            <g key={`c${i}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth={2} strokeDasharray="5 4" />
              {spec.connector && (
                <text className="fig-label" x={(x1 + x2) / 2 - 10} y={(y1 + y2) / 2 - 4} textAnchor="end">
                  {spec.connector}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={px(0)} cy={py(0)} r={6} fill="#000" />
        <circle cx={px(layout.w)} cy={py(layout.h)} r={6} fill="#A31F34" />
      </svg>
      <div className="fig-formula" aria-live="polite">
        {showPath && (
          <span className="serif" style={{ letterSpacing: "0.12em" }}>
            {paths.map((p) => p.moves.map((m) => (m === "R" ? "→" : "↑")).join("")).join("  ·  ")}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- 组合 = 递增排列 ---------- */
function Choose({ spec, step, tick }: { spec: Extract<FigureSpec, { type: "choose" }>; step: number; tick: number }) {
  const combos = useMemo(() => combinations(spec.pool.length, spec.k), [spec.pool.length, spec.k]);
  const idx = step >= 2 ? (tick % combos.length) : 0;
  const cur = step >= 1 ? combos[idx] : [];
  const sortedVals = cur.map((i) => spec.pool[i]);
  return (
    <div>
      <div className="chips">
        {spec.pool.map((v, i) => (
          <span key={i} className={`chip-node${cur.includes(i) ? " on" : ""}`}>
            {v}
          </span>
        ))}
      </div>
      <div className="digits-out" aria-live="polite">
        {spec.prefix && <span className="fixed">{spec.prefix}</span>}
        {step >= 1 ? sortedVals.join("") : "_".repeat(spec.k)}
      </div>
      <div className="fig-formula small muted">
        {step >= 2 && step < 3 && `第 ${idx + 1} 组，共 ${combos.length} 组`}
        {step >= 3 && <Tex src={`\\binom{${spec.pool.length}}{${spec.k}} = ${fmt(binom(spec.pool.length, spec.k))}`} />}
      </div>
    </div>
  );
}

/* ---------- 选人再排队 ---------- */
function chosenIndices(n: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(Math.min(n - 1, Math.round(((i + 0.5) * n) / k - 0.5)));
  return [...new Set(out)];
}

function SelectArrange({ spec, step }: { spec: Extract<FigureSpec, { type: "select-arrange" }>; step: number }) {
  const chosen = chosenIndices(spec.n, spec.k);
  const names = chosen.map((i) => LETTERS[i]);
  const perms = useMemo(() => permutations(names).map((p) => p.join("")), [names.join("")]);
  return (
    <div>
      <div className="chips">
        {Array.from({ length: spec.n }, (_, i) => (
          <span key={i} className={`chip-node${step >= 1 && chosen.includes(i) ? " on" : ""}`}>
            {LETTERS[i]}
          </span>
        ))}
      </div>
      {step >= 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 20, alignItems: "center", marginTop: 24 }}>
          <div className="perm-grid" style={perms.length <= 6 ? { gridTemplateColumns: `repeat(${perms.length}, minmax(0,1fr))` } : undefined}>
            {perms.map((p, i) => (
              <span key={p} className={i === 0 ? "first" : undefined}>
                {p}
              </span>
            ))}
          </div>
          <div style={{ borderLeft: "1.5px solid #000", paddingLeft: 14 }}>
            <div className="serif" style={{ fontSize: 19 }}>{`{${names.join(", ")}}`}</div>
            <div className="xsmall muted">{perms.length} 种排法，只算 1 个组合</div>
          </div>
        </div>
      )}
      <div className="fig-formula">
        {step >= 3 && <Tex src={`P(${spec.n},${spec.k}) = \\binom{${spec.n}}{${spec.k}}\\cdot ${spec.k}! = ${fmt(fact(spec.n) / fact(spec.n - spec.k))}`} />}
      </div>
    </div>
  );
}

/* ---------- 乘法原理 ---------- */
function Slots({ spec, step }: { spec: Extract<FigureSpec, { type: "slots" }>; step: number }) {
  const last = spec.slots.length;
  const total = spec.slots.reduce((a, s) => a * BigInt(s.count), 1n);
  return (
    <div>
      <div className="slots">
        {spec.slots.map((s, i) => (
          <div className="slot" key={i}>
            <div className={`box${step === i ? " on" : ""}`}>{step >= i ? s.count : ""}</div>
            <div className="lab">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="fig-formula">{step >= last && <Tex src={`${spec.slots.map((s) => s.count).join(" \\times ")} = ${fmt(total)}`} />}</div>
    </div>
  );
}

/* ---------- 隔板法 ---------- */
function StarsBars({ spec, step, tick }: { spec: Extract<FigureSpec, { type: "stars-bars" }>; step: number; tick: number }) {
  const total = spec.stars + spec.bins - 1;
  const bars = useMemo(() => {
    const all = combinations(total, spec.bins - 1);
    return all[(tick * 37 + 5) % all.length];
  }, [total, spec.bins, tick]);
  const items = Array.from({ length: total }, (_, i) => (bars.includes(i) ? "bar" : "star"));
  const groups: number[] = [];
  let c = 0;
  for (const it of items) {
    if (it === "bar") {
      groups.push(c);
      c = 0;
    } else c++;
  }
  groups.push(c);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, minHeight: 56, flexWrap: "wrap" }}>
        {step === 0
          ? Array.from({ length: spec.stars }, (_, i) => (
              <span key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: "#000", display: "inline-block" }} />
            ))
          : items.map((it, i) =>
              it === "bar" ? (
                <span key={i} style={{ width: 3, height: 44, background: "#A31F34", display: "inline-block", margin: "0 6px" }} />
              ) : (
                <span key={i} style={{ width: 22, height: 22, borderRadius: "50%", background: "#000", display: "inline-block" }} />
              ),
            )}
      </div>
      <div className="fig-formula small">
        {step >= 1 && (
          <span>
            {groups.map((g, i) => `${PEOPLE[i] ?? `第${i + 1}人`} ${g}`).join("，")}
          </span>
        )}
      </div>
      <div className="fig-formula">{step >= 3 && <Tex src={`\\binom{${total}}{${spec.bins - 1}} = ${fmt(binom(total, spec.bins - 1))}`} />}</div>
    </div>
  );
}

/* ---------- 帕斯卡三角 ---------- */
function Pascal({ spec, step }: { spec: Extract<FigureSpec, { type: "pascal" }>; step: number }) {
  const shown = Math.min(step, spec.rows - 1);
  const final = step >= spec.rows;
  const hl = new Set((spec.highlight ?? []).map(([r, k]) => `${r},${k}`));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontFamily: "var(--serif)", fontSize: spec.rows > 9 ? 14 : 17 }}>
      {Array.from({ length: shown + 1 }, (_, r) => (
        <div key={r} style={{ display: "flex", gap: spec.rows > 9 ? 12 : 22 }}>
          {Array.from({ length: r + 1 }, (_, k) => {
            const on = final && hl.has(`${r},${k}`);
            const fresh = !final && r === shown && r > 0;
            return (
              <span
                key={k}
                className="tabnum"
                style={{
                  minWidth: "1.6em",
                  textAlign: "center",
                  color: on ? "#A31F34" : fresh ? "#000" : "#3c3f42",
                  fontWeight: on || fresh ? 600 : 400,
                  borderBottom: on ? "1.5px solid #A31F34" : "1.5px solid transparent",
                }}
              >
                {binom(r, k).toString()}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------- 圆排列 ---------- */
function Circle({ spec, step }: { spec: Extract<FigureSpec, { type: "circle" }>; step: number }) {
  const n = spec.n;
  const turning = step >= 1 && step <= 2;
  const t = useTicker(turning, 1500);
  const rot = turning ? (t % n) * (360 / n) : 0;
  const R = 70;
  const C = 110;
  return (
    <div>
      <svg className="fig-svg" viewBox="0 0 220 220" width={220} role="img" aria-label="圆桌座位示意图">
        <circle cx={C} cy={C} r={R - 26} fill="#fff" stroke="#000" strokeWidth={1.5} />
        <g style={{ transform: `rotate(${rot}deg)`, transformOrigin: `${C}px ${C}px`, transition: "transform 0.8s cubic-bezier(0.22,1,0.36,1)" }}>
          {Array.from({ length: n }, (_, i) => {
            const a = (2 * Math.PI * i) / n - Math.PI / 2;
            const x = C + R * Math.cos(a);
            const y = C + R * Math.sin(a);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={17} fill={i === 0 ? "#000" : "#fff"} stroke="#000" strokeWidth={1.5} />
                <text
                  x={x}
                  y={y + 6}
                  textAnchor="middle"
                  className="fig-text"
                  fontSize={17}
                  style={{ fill: i === 0 ? "#fff" : "#000", transform: `rotate(${-rot}deg)`, transformOrigin: `${x}px ${y}px`, transition: "transform 0.8s cubic-bezier(0.22,1,0.36,1)" }}
                >
                  {LETTERS[i]}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="fig-formula">{step >= 3 && <Tex src={`\\frac{${n}!}{${n}} = ${fmt(fact(n - 1))}`} />}</div>
    </div>
  );
}

/* ---------- 补集 ---------- */
function Complement({ spec, step }: { spec: Extract<FigureSpec, { type: "complement" }>; step: number }) {
  const keep = spec.total - spec.excluded;
  const show = step >= 1;
  return (
    <div>
      <div className="bar-diagram" role="img" aria-label="补集示意">
        <div className="keep" style={{ flexBasis: show ? `${(keep / spec.total) * 100}%` : "100%" }}>
          {show ? (step >= 2 ? `所求 ${keep}` : "") : `${spec.totalLabel} ${spec.total}`}
        </div>
        {show && (
          <div className="drop" style={{ flexBasis: `${(spec.excluded / spec.total) * 100}%` }}>
            {spec.excludedLabel} {spec.excluded}
          </div>
        )}
      </div>
      <div className="fig-formula">{step >= 2 && <Tex src={`${fmt(spec.total)} - ${fmt(spec.excluded)} = ${fmt(keep)}`} />}</div>
    </div>
  );
}

function FigureBody({ spec, step, tick }: { spec: FigureSpec; step: number; tick: number }) {
  switch (spec.type) {
    case "multiset":
      return <Multiset spec={spec} step={step} />;
    case "grid-path":
      return <GridPath spec={spec} step={step} tick={tick} />;
    case "choose":
      return <Choose spec={spec} step={step} tick={tick} />;
    case "select-arrange":
      return <SelectArrange spec={spec} step={step} />;
    case "slots":
      return <Slots spec={spec} step={step} />;
    case "stars-bars":
      return <StarsBars spec={spec} step={step} tick={tick} />;
    case "pascal":
      return <Pascal spec={spec} step={step} />;
    case "circle":
      return <Circle spec={spec} step={step} />;
    case "complement":
      return <Complement spec={spec} step={step} />;
  }
}

/* ---------- 图的外框：步进控制 ---------- */
export function FigureView({
  spec,
  title,
  caption,
  anchor,
  anchorLabel,
}: {
  spec: FigureSpec;
  title: string;
  caption?: string;
  anchor: string;
  anchorLabel: string;
}) {
  const steps = useMemo(() => stepsOf(spec), [spec]);
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const extra = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setStep((s) => {
        if (s < steps.length - 1) return s + 1;
        extra.current += 1;
        if (extra.current > 5) setPlaying(false);
        return s;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [playing, steps.length]);
  const atEnd = step === steps.length - 1;
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    extra.current = 0;
    if (atEnd) setStep(0);
    setPlaying(true);
  };
  return (
    <figure className="figure" data-anchor={anchor} data-anchor-label={anchorLabel}>
      <div className="figure-frame">
        <FigureBody spec={spec} step={step} tick={tick} />
        <div className="figure-step" aria-live="polite">
          <Rich text={steps[step]} />
        </div>
      </div>
      <div className="figure-bar">
        <figcaption>
          <b>{title}</b>
          {caption && <Rich as="span" text={caption} />}
        </figcaption>
        <div className="figure-controls">
          <button className="btn btn-icon" type="button" aria-label="上一步" disabled={step === 0} onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M9 2L4 7l5 5" />
            </svg>
          </button>
          <span className="count">
            {step + 1} / {steps.length}
          </span>
          <button className="btn btn-icon" type="button" aria-label="下一步" disabled={atEnd} onClick={() => { setPlaying(false); setTick((t) => t + 1); setStep((s) => Math.min(steps.length - 1, s + 1)); }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M5 2l5 5-5 5" />
            </svg>
          </button>
          <button className="btn btn-icon" type="button" aria-label={playing ? "暂停" : "自动播放"} onClick={togglePlay}>
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <rect x="3" y="2" width="3" height="10" />
                <rect x="8" y="2" width="3" height="10" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                <path d="M3 1.5v11l9-5.5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </figure>
  );
}
