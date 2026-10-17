// 打包前端到 dist/client：esbuild 打包 React + KaTeX（含字体），复制 public/，生成 index.html。
// Worker 本身由 wrangler deploy 打包，不在这里处理。
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist/client");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });

const result = await build({
  entryPoints: { app: join(root, "src/client/main.tsx") },
  bundle: true,
  format: "esm",
  splitting: false,
  minify: true,
  sourcemap: true,
  target: ["es2022", "safari16"],
  jsx: "automatic",
  outdir: join(out, "assets"),
  entryNames: "[name]-[hash]",
  assetNames: "[name]-[hash]",
  loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
  external: ["/fonts/*"], // public/ 下的字体按原路径提供
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
});

if (existsSync(join(root, "public"))) cpSync(join(root, "public"), out, { recursive: true });

const outputs = Object.keys(result.metafile.outputs).map((p) => p.replace(/\\/g, "/"));
const js = outputs.find((p) => /assets\/app-[^/]+\.js$/.test(p));
const css = outputs.find((p) => /assets\/app-[^/]+\.css$/.test(p));
const rel = (p) => `/${p.slice(p.indexOf("assets/"))}`;

writeFileSync(
  join(out, "index.html"),
  `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff">
<meta name="robots" content="noindex">
<title>计数与概率</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/plex/IBMPlexSans-Regular-Latin1.woff2" as="font" type="font/woff2" crossorigin>
${css ? `<link rel="stylesheet" href="${rel(css)}">` : ""}
<script type="module" src="${rel(js)}"></script>
</head>
<body>
<div id="root"></div>
<noscript>这个网站需要开启 JavaScript。</noscript>
</body>
</html>
`,
);

const size = (p) => (result.metafile.outputs[p]?.bytes / 1024).toFixed(0);
console.log(`前端已打包：${rel(js)} (${size(js)} KB)${css ? `，${rel(css)} (${size(css)} KB)` : ""}`);
