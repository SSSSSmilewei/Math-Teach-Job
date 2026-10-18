import { useEffect, useState } from "react";
import type { Me } from "../../shared/api";
import { api } from "../api";
import { navigate } from "../router";

export function StudentLogin({ initialCode, onLogin }: { initialCode?: string; onLogin: (me: Me) => void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await api<Me>("/api/auth/student", { body: { code: c } });
      onLogin(me);
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialCode) submit(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="login">
      <h1>计数与概率</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        输入老师给你的口令。登录一次后，这台设备会记住你。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
      >
        <label className="field">
          口令
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" placeholder="例如 abcd-efgh-jkmn" />
        </label>
        {error && <span className="error-text">{error}</span>}
        <button className="btn btn-ink" type="submit" disabled={busy || code.trim().length < 4}>
          {busy ? "正在进入…" : "进入"}
        </button>
      </form>
    </main>
  );
}

export function AdminLogin({ onLogin }: { onLogin: (me: Me) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <h1>老师后台</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const me = await api<Me>("/api/auth/admin", { body: { password } });
            onLogin(me);
            navigate("/admin", { replace: true });
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <label className="field">
          密码
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <span className="error-text">{error}</span>}
        <button className="btn btn-ink" type="submit" disabled={busy || !password}>
          登录
        </button>
      </form>
    </main>
  );
}
