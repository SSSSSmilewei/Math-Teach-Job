import { type AnchorHTMLAttributes, type MouseEvent, createContext, useContext, useEffect, useState } from "react";

/** 一个很小的路由：history API + 路径模式匹配，够这个站用。 */

const LocationContext = createContext<{ path: string; search: string }>({ path: "/", search: "" });

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!to.includes("#")) window.scrollTo(0, 0);
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const onPop = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return <LocationContext.Provider value={loc}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  return useContext(LocationContext);
}

/** "/l/:number/:tab?" → 匹配结果 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < Math.max(p.length, s.length); i++) {
    const seg = p[i];
    if (seg === undefined) return null;
    const optional = seg.endsWith("?");
    const name = seg.replace(/^:/, "").replace(/\?$/, "");
    if (seg.startsWith(":")) {
      if (s[i] === undefined) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(s[i]);
    } else if (seg !== s[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
