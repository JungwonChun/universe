import { useState } from "react";
import { supabase } from "../supabase.js";
import { C, FONT, Card, Btn, inputStyle, useToast } from "../ui.jsx";

export default function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

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
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>🎾</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: "-0.6px" }}>Universe</div>
          <div style={{ fontSize: 14.5, color: C.sub2, marginTop: 6, fontWeight: 500 }}>
            선착순 신청부터 모집까지, 동아리 운영을 한 곳에서
          </div>
        </div>

        <Card>
          {mode === "signup" && (
            <input style={inputStyle} placeholder="이름 (동아리에서 쓰는 이름)" value={name}
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
          {mode === "login" ? (
            <>처음이신가요?{" "}
              <span onClick={() => setMode("signup")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>회원가입</span>
            </>
          ) : (
            <>이미 계정이 있나요?{" "}
              <span onClick={() => setMode("login")} style={{ color: C.blue, fontWeight: 700, cursor: "pointer" }}>로그인</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
