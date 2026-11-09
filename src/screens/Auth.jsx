import { useState } from "react";
import { supabase } from "../supabase.js";
import { C, FONT, Card, Btn, inputStyle, useToast, InstallPrompt } from "../ui.jsx";

// 참가 코드 → 계정 매핑 (코드 자체가 로그인 자격)
const codeEmail = (c) => `${c}@impact-ob.com`;
const codePassword = (c) => `${c}-impactOB2026`;

export default function AuthScreen() {
  const [mode, setMode] = useState("code"); // code | login | signup
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const codeLogin = async () => {
    const c = code.trim().toLowerCase();
    if (!c) { toast("참가 코드를 입력해주세요 (예: a01)"); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: codeEmail(c), password: codePassword(c) });
    setBusy(false);
    if (error) toast("코드를 다시 확인해주세요 (예: a01, b03…)");
  };

  const submit = async () => {
    if (!email.trim() || !pw) { toast("이메일과 비밀번호를 입력해주세요"); return; }
    if (mode === "signup" && !name.trim()) { toast("이름을 입력해주세요"); return; }
    if (mode === "signup" && pw.length < 6) { toast("비밀번호는 6자 이상이어야 해요"); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password: pw,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) toast("가입 확인 메일을 확인해주세요 📬");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      }
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes("Invalid login")) toast("이메일 또는 비밀번호가 맞지 않아요");
      else if (msg.includes("already registered")) toast("이미 가입된 이메일이에요");
      else toast(msg);
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      fontFamily: FONT, background: C.bg, minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ marginBottom: 8 }}><InstallPrompt /></div>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🎾</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: "-0.6px" }}>새벽테니스</div>
          <div style={{ fontSize: 14.5, color: C.sub2, marginTop: 6, fontWeight: 500 }}>
            대회·일정·모집을 한 곳에서
          </div>
        </div>

        {mode === "code" ? (
          <>
            <Card>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 4 }}>참가 코드로 입장</div>
              <div style={{ fontSize: 13, color: C.sub2, marginBottom: 12 }}>대회 안내에서 받은 코드를 입력하세요 (예: a01)</div>
              <input style={{ ...inputStyle, textAlign: "center", fontSize: 22, fontWeight: 800, letterSpacing: 4 }}
                placeholder="a01" value={code} maxLength={12}
                onChange={(e) => setCode(e.target.value)} autoCapitalize="none"
                onKeyDown={(e) => e.key === "Enter" && codeLogin()} />
              <Btn onClick={codeLogin} loading={busy}>입장하기</Btn>
            </Card>
            <div style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: C.sub }}>
              관리자세요?{" "}
              <span onClick={() => setMode("login")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>이메일로 로그인</span>
            </div>
          </>
        ) : (
          <>
            <Card>
              {mode === "signup" && (
                <input style={inputStyle} placeholder="이름" value={name}
                  onChange={(e) => setName(e.target.value)} />
              )}
              <input style={inputStyle} type="email" placeholder="이메일" value={email}
                onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
              <input style={inputStyle} type="password" placeholder="비밀번호 (6자 이상)" value={pw}
                onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              <Btn onClick={submit} loading={busy} style={{ marginTop: 4 }}>
                {mode === "login" ? "로그인" : "가입하기"}
              </Btn>
            </Card>
            <div style={{ textAlign: "center", marginTop: 18, fontSize: 14, color: C.sub }}>
              <span onClick={() => setMode("code")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>← 참가 코드로 입장</span>
              <span style={{ margin: "0 8px", color: C.border }}>|</span>
              {mode === "login" ? (
                <span onClick={() => setMode("signup")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>회원가입</span>
              ) : (
                <span onClick={() => setMode("login")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>로그인</span>
              )}
            </div>
          </>
        )}

        {/* 배포 버전 표시 (Docker 빌드 시 커밋 SHA·빌드 시각이 들어감) */}
        <div style={{ textAlign: "center", marginTop: 28, fontSize: 11.5, color: C.sub2 }}>
          버전 {import.meta.env.VITE_APP_VERSION || "web"}
          {import.meta.env.VITE_BUILD_TIME && ` · ${import.meta.env.VITE_BUILD_TIME} 배포`}
        </div>
      </div>
    </div>
  );
}
