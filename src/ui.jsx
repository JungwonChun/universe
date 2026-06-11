import { createContext, useContext, useState, useCallback } from "react";

/* ───────── 토스 스타일 토큰 ───────── */
export const C = {
  blue: "#3182F6", blueDark: "#1B64DA", blueLight: "#EBF3FE",
  bg: "#F2F4F6", white: "#FFFFFF",
  text: "#191F28", sub: "#4E5968", sub2: "#8B95A1", border: "#E5E8EB",
  red: "#F04452", redLight: "#FDEDEE",
  green: "#00C471", greenLight: "#E5F9F1",
  orange: "#FF9100", orangeLight: "#FFF3E0",
};

export const FONT = `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Segoe UI", sans-serif`;

const AVATAR_COLORS = ["#EBF3FE", "#E5F9F1", "#FFF3E0", "#FDEDEE", "#F0EBFE", "#E6F7FB"];
const AVATAR_TEXT = ["#3182F6", "#00A661", "#E08600", "#F04452", "#7B5CF0", "#0BA5C9"];

export function Avatar({ name = "?", size = 32 }) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const i = hash % AVATAR_COLORS.length;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: AVATAR_COLORS[i],
      color: AVATAR_TEXT[i], display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.42, fontWeight: 800, flexShrink: 0,
    }}>{String(name).slice(0, 1)}</div>
  );
}

export function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: C.white, borderRadius: 20, padding: 20,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)", ...style,
    }}>{children}</div>
  );
}

export function Btn({ children, onClick, variant = "primary", disabled, loading, style }) {
  const variants = {
    primary: { background: C.blue, color: "#fff" },
    danger: { background: C.redLight, color: C.red },
    gray: { background: C.bg, color: C.sub },
    waitlist: { background: C.orangeLight, color: C.orange },
  };
  const off = disabled || loading;
  return (
    <button
      onClick={off ? undefined : onClick}
      style={{
        width: "100%", border: "none", borderRadius: 14, padding: "15px 0",
        fontSize: 16, fontWeight: 700, fontFamily: FONT,
        cursor: off ? "default" : "pointer", letterSpacing: "-0.3px",
        transition: "transform .1s ease", opacity: off ? 0.45 : 1,
        ...variants[variant], ...style,
      }}
      onMouseDown={(e) => !off && (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >{loading ? "잠시만요..." : children}</button>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "26px 4px 12px" }}>
      <span style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: "-0.4px" }}>{children}</span>
      {right}
    </div>
  );
}

export const inputStyle = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 12,
  padding: "14px 14px", fontSize: 15.5, fontFamily: FONT, color: C.text,
  marginBottom: 10, outline: "none", background: "#fff",
};

export function Modal({ children, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", width: "100%", maxWidth: 480,
        borderRadius: "24px 24px 0 0", padding: "12px 20px",
        paddingBottom: "calc(28px + env(safe-area-inset-bottom))",
        maxHeight: "85vh", overflowY: "auto", animation: "slideUp .25s ease",
      }}>
        <div style={{ width: 40, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 16px" }} />
        {children}
      </div>
    </div>
  );
}

/* ───────── 토스트 ───────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div style={{
        position: "fixed", top: "calc(16px + env(safe-area-inset-top))", left: 0, right: 0,
        zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, pointerEvents: "none",
      }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            background: "rgba(25,31,40,0.92)", color: "#fff", borderRadius: 14,
            padding: "12px 18px", fontSize: 14, fontWeight: 600, maxWidth: "85%",
            textAlign: "center", animation: "toastIn .25s ease", fontFamily: FONT,
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
