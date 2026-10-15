import type { ReactNode } from "react";
import type { Me } from "../../shared/api";
import { api } from "../api";
import { Link, navigate, useLocation } from "../router";

export function StudentHeader({ me, redoCount }: { me: Me; redoCount?: number }) {
  const { path } = useLocation();
  const logout = async () => {
    await api("/api/auth/logout", { body: {} });
    location.href = "/login";
  };
  return (
    <header className="site-header">
      <div className="wrap">
        <Link to="/" className="brand">
          <b>计数与概率</b>
          <span>Counting &amp; Probability</span>
        </Link>
        <nav className="site-nav" aria-label="主导航">
          <Link to="/" aria-current={path === "/" || path.startsWith("/l/") ? "page" : undefined}>
            课程
          </Link>
          <Link to="/redo" aria-current={path === "/redo" ? "page" : undefined}>
            待重做{redoCount ? <span className="tabnum" style={{ color: "var(--ink)", marginLeft: 4 }}>{redoCount}</span> : null}
          </Link>
          {me.student && <span className="muted">{me.student.name}</span>}
          <button className="link-btn muted" type="button" onClick={logout}>
            退出
          </button>
        </nav>
      </div>
    </header>
  );
}

export function AdminHeader() {
  const { path } = useLocation();
  const item = (to: string, label: string, exact = false) => (
    <Link to={to} aria-current={(exact ? path === to : path.startsWith(to)) ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <header className="site-header">
      <div className="wrap-wide">
        <Link to="/admin" className="brand">
          <b>计数与概率</b>
          <span>老师后台</span>
        </Link>
        <nav className="site-nav" aria-label="后台导航">
          {item("/admin", "总览", true)}
          {item("/admin/students", "学生")}
          {item("/admin/bank", "题库")}
          <Link to="/admin/generate" className="btn btn-red btn-sm" style={{ color: "#fff", borderBottom: 0, padding: "0 16px" }}>
            生成新课
          </Link>
          <button
            className="link-btn muted"
            type="button"
            onClick={async () => {
              await api("/api/auth/logout", { body: {} });
              navigate("/admin/login");
            }}
          >
            退出
          </button>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span>题目出自 AoPS《Introduction to Counting &amp; Probability》与历年 AMC 真题，仅供本课程学习使用。</span>
        <span>看不懂哪里，在那里点一下就能提问。</span>
      </div>
    </footer>
  );
}

export function Loading({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="wrap" style={{ padding: "96px 40px", color: "var(--graphite)" }}>
      {text}
    </div>
  );
}

export function ErrorView({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="wrap" style={{ padding: "96px 40px" }}>
      <p className="error-text" style={{ fontSize: 16 }}>
        {message}
      </p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
