/**
 * 判断学生的答案是否正确。
 * 只做"同一个数的不同写法"的归一化：全角/半角、空格、千分位逗号、
 * 分数与小数、前缀 "n =" 等。不做符号代数。
 */

const FULLWIDTH = /[０-９．／－＋]/g;

export function normalizeAnswer(raw: string): string {
  let s = raw.trim();
  s = s.replace(FULLWIDTH, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[−–—]/g, "-"); // 各种减号
  s = s.replace(/\$/g, "");
  s = s.replace(/\\dfrac|\\tfrac/g, "\\frac");
  // \frac{a}{b} → a/b
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  s = s.replace(/^[a-zA-Z]\s*=\s*/, ""); // "n = 10" → "10"
  s = s.replace(/[\s,，]/g, "");
  s = s.replace(/[。.]$/, "");
  s = s.replace(/^\((.*)\)$/, "$1");
  return s.toLowerCase();
}

/** 把 "12", "-3", "1.5", "3/4", "(3)/(4)" 解析成分数；不是数字就返回 null。 */
export function parseNumber(s: string): { n: bigint; d: bigint } | null {
  const frac = s.match(/^\(?(-?\d+)\)?\/\(?(-?\d+)\)?$/);
  if (frac) {
    const n = BigInt(frac[1]);
    const d = BigInt(frac[2]);
    if (d === 0n) return null;
    return reduce(n, d);
  }
  const dec = s.match(/^(-?)(\d*)\.?(\d*)$/);
  if (dec && (dec[2] || dec[3])) {
    const sign = dec[1] === "-" ? -1n : 1n;
    const intPart = dec[2] || "0";
    const fracPart = dec[3] || "";
    const d = 10n ** BigInt(fracPart.length);
    const n = BigInt(intPart + fracPart) * sign;
    return reduce(n, d);
  }
  return null;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function reduce(n: bigint, d: bigint) {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function answersMatch(given: string, expected: string): boolean {
  const a = normalizeAnswer(given);
  const b = normalizeAnswer(expected);
  if (!a) return false;
  if (a === b) return true;
  const x = parseNumber(a);
  const y = parseNumber(b);
  return !!x && !!y && x.n === y.n && x.d === y.d;
}

export function checkAnswer(
  problem: { kind: "input" | "choice"; answer: string; accept?: string[] },
  given: string,
): boolean {
  if (problem.kind === "choice") return given.trim().toUpperCase() === problem.answer.trim().toUpperCase();
  return [problem.answer, ...(problem.accept ?? [])].some((e) => answersMatch(given, e));
}

/** 答对之前最多可以试几次才自动解锁解析。 */
export const UNLOCK_AFTER_ATTEMPTS = 2;
