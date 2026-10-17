import { useEffect, useState } from "react";
import type { Me, RedoItem } from "../shared/api";
import { api } from "./api";
import { AdminHeader, Footer, Loading, StudentHeader } from "./components/Layout";
import { AdminBank, AdminGenerate, AdminHome, AdminLesson, AdminPinRedirect, AdminStudents } from "./pages/Admin";
import { Home, RedoPage } from "./pages/Home";
import { LessonPage } from "./pages/Lesson";
import { AdminLogin, StudentLogin } from "./pages/Login";
import { matchPath, navigate, useLocation } from "./router";

export function App() {
  const { path } = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [redoCount, setRedoCount] = useState(0);

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch(() => setMe({ role: null }));
  }, []);

  useEffect(() => {
    if (me?.role !== "student") return;
    api<RedoItem[]>("/api/redo")
      .then((r) => setRedoCount(r.length))
      .catch(() => {});
  }, [me, path]);

  // 页面标题
  useEffect(() => {
    document.title = path.startsWith("/admin") ? "老师后台 · 计数与概率" : "计数与概率";
  }, [path]);

  const k = matchPath("/k/:code", path);
  if (k) return <StudentLogin initialCode={k.code} onLogin={setMe} />;
  if (!me) return <Loading />;

  /* ---------- 老师后台 ---------- */
  if (path.startsWith("/admin")) {
    if (path === "/admin/login") return <AdminLogin onLogin={setMe} />;
    if (me.role !== "admin") {
      queueMicrotask(() => navigate("/admin/login", { replace: true }));
      return null;
    }
    const preview = matchPath("/admin/preview/:id/:tab?", path);
    const lesson = matchPath("/admin/lessons/:id", path);
    const pin = matchPath("/admin/pins/:id", path);
    let page: React.ReactNode;
    if (preview) page = <LessonPage previewId={preview.id} tab={preview.tab} />;
    else if (lesson) page = <AdminLesson id={lesson.id} />;
    else if (pin) page = <AdminPinRedirect id={pin.id} />;
    else if (path === "/admin/generate") page = <AdminGenerate />;
    else if (path === "/admin/students") page = <AdminStudents />;
    else if (path === "/admin/bank") page = <AdminBank />;
    else page = <AdminHome />;
    return (
      <>
        <AdminHeader />
        {page}
        <div style={{ height: 96 }} />
      </>
    );
  }

  /* ---------- 学生端 ---------- */
  if (path === "/login" || me.role !== "student") {
    if (me.role === "admin" && path !== "/login") {
      queueMicrotask(() => navigate("/admin", { replace: true }));
      return null;
    }
    return <StudentLogin onLogin={setMe} />;
  }
  const lesson = matchPath("/l/:number/:tab?", path);
  let page: React.ReactNode;
  if (lesson) page = <LessonPage key={lesson.number} number={Number(lesson.number)} tab={lesson.tab} />;
  else if (path === "/redo") page = <RedoPage />;
  else page = <Home />;
  return (
    <>
      <StudentHeader me={me} redoCount={redoCount} />
      {page}
      <Footer />
    </>
  );
}
