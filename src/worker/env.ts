export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  ADMIN_PASSWORD?: string;
  AI_PROVIDER?: string; // "openai"（OpenAI 兼容接口）或 "anthropic"
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  WXPUSHER_SPT?: string;
  SERVERCHAN_KEY?: string;
  SITE_URL?: string;
}

export type Session = { role: "student"; sid: string; exp: number } | { role: "admin"; exp: number };

export type AppEnv = {
  Bindings: Env;
  Variables: { session: Session | null };
};
