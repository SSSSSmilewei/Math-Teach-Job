import katex from "katex";
import { type ElementType, memo } from "react";

/**
 * Rich 文本渲染：先把所有文字做 HTML 转义，再处理
 *   $$...$$ 独立公式、$...$ 行内公式（KaTeX）、**粗体**、空行分段、换行。
 * 不接受任何 HTML，所以 AI 生成的内容不会注入脚本。
 */

const cache = new Map<string, string>();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function tex(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", trust: false, output: "html" });
  } catch {
    return `<code>${escapeHtml(src)}</code>`;
  }
}

function inline(text: string): string {
  // 先切出公式，剩下的文字再处理粗体
  const out: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$])+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(plain(text.slice(last, m.index)));
    out.push(m[1] !== undefined ? `<span class="math-display">${tex(m[1].trim(), true)}</span>` : tex(m[2], false));
    last = m.index + m[0].length;
  }
  out.push(plain(text.slice(last)));
  return out.join("");
}

function plain(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

export function renderRich(src: string, block = true): string {
  const key = `${block ? "b" : "i"}:${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let html: string;
  if (block) {
    const paras = src.split(/\n\s*\n/);
    html = paras.length === 1 ? inline(paras[0]) : paras.map((p) => `<p>${inline(p.trim())}</p>`).join("");
  } else html = inline(src);
  if (cache.size > 2000) cache.clear();
  cache.set(key, html);
  return html;
}

export const Rich = memo(function Rich({
  text,
  as: Tag = "div",
  className,
}: {
  text: string;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderRich(text) }} />;
});

export function texHtml(src: string, display = false): string {
  return tex(src, display);
}

export function Tex({ src, display = false }: { src: string; display?: boolean }) {
  return <span dangerouslySetInnerHTML={{ __html: tex(src, display) }} />;
}
