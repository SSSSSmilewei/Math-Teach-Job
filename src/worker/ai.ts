import type { Env } from "./env";

/**
 * 极简的大模型客户端，支持两类接口：
 *  - OpenAI 兼容的 /chat/completions（DeepSeek、通义千问、Kimi、智谱、OpenRouter 等）
 *  - Anthropic Messages API
 *
 * 这里故意不用流式解析：Workers 免费版每个请求只有 10ms CPU，
 * 逐块解析几千个 SSE 片段可能超限；一次性收完整 JSON 只需要解析一次。
 * 长时间等待由调用方往浏览器发心跳来保持连接。
 */
export interface ModelConfig {
  provider: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function modelConfig(env: Env): ModelConfig | null {
  if (!env.AI_API_KEY) return null;
  const provider = env.AI_PROVIDER === "anthropic" ? "anthropic" : "openai";
  const baseUrl = (env.AI_BASE_URL || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.deepseek.com")).replace(/\/$/, "");
  const model = env.AI_MODEL || (provider === "openai" ? "deepseek-chat" : "");
  if (!model) return null;
  return { provider, baseUrl, model, apiKey: env.AI_API_KEY };
}

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  json: boolean;
}

export class ModelError extends Error {}

export async function complete(cfg: ModelConfig, req: CompletionRequest): Promise<{ text: string; truncated: boolean }> {
  return cfg.provider === "anthropic" ? anthropic(cfg, req) : openai(cfg, req, true);
}

async function openai(cfg: ModelConfig, req: CompletionRequest, withFormat: boolean): Promise<{ text: string; truncated: boolean }> {
  // 例：https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1、https://openrouter.ai/api/v1
  const url = `${cfg.baseUrl}/chat/completions`;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    max_tokens: req.maxTokens,
    temperature: 0.3,
    stream: false,
  };
  if (req.json && withFormat) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    if (withFormat && res.status === 400 && /response_format|json_object/i.test(text)) return openai(cfg, req, false);
    throw new ModelError(`模型接口返回 ${res.status}：${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new ModelError(`模型没有返回内容：${data.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  return { text, truncated: choice?.finish_reason === "length" };
}

async function anthropic(cfg: ModelConfig, req: CompletionRequest): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens,
      temperature: 0.3,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });
  if (!res.ok) throw new ModelError(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text) throw new ModelError("模型没有返回内容");
  return { text, truncated: data.stop_reason === "max_tokens" };
}

/** 从模型输出里取出 JSON（去掉可能的 ``` 包裹和前后多余文字）。 */
export function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ModelError("模型输出里没有 JSON");
  return JSON.parse(s.slice(start, end + 1));
}
