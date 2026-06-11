import { useState } from "react";
import { ChevronLeft, KeyRound, Sparkles, Copy, Check } from "lucide-react";
import { supabase } from "../supabase.js";
import { C, FONT, Card, Btn, inputStyle, useToast } from "../ui.jsx";

export default function OnboardingScreen({ hasOrg, onBack, onDone }) {
  const [view, setView] = useState("pick"); // pick | join | create | created
  const [code, setCode] = useState("");
  const [orgName, setOrgName] = useState("");
  const [orgDesc, setOrgDesc] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [createdId, setCreatedId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const join = async () => {
    if (!code.trim()) { toast("초대 코드를 입력해주세요"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("join_org", { p_code: code.trim() });
      if (error) throw error;
      toast("가입 완료! 환영해요 🎉");
      onDone(data);
    } catch (e) {
      toast(String(e.message || e).includes("찾을 수 없") ? "초대 코드를 다시 확인해주세요" : String(e.message || e));
    } finally { setBusy(false); }
  };

  const create = async () => {
    if (!orgName.trim()) { toast("단체 이름을 입력해주세요"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_org", { p_name: orgName.trim(), p_desc: orgDesc.trim() || null });
      if (error) throw error;
      setCreatedCode(data.code);
      setCreatedId(data.org_id);
      setView("created");
    } catch (e) { toast(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(createdCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast("코드: " + createdCode); }
  };

  return (
    <div style={{ fontFamily: FONT, background: C.bg, minHeight: "100vh", padding: 20 }}>
      <div style={{ maxWidth: 440, margin: "0 auto", paddingTop: "calc(20px + env(safe-area-inset-top))" }}>
        {(onBack || view !== "pick") && view !== "created" && (
          <div onClick={() => (view === "pick" ? onBack?.() : setView("pick"))}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, color: C.sub, fontSize: 14.5, fontWeight: 700, cursor: "pointer", marginBottom: 14 }}>
            <ChevronLeft size={18} /> 뒤로
          </div>
        )}

        {view === "pick" && (
          <>
            <div style={{ margin: "8px 4px 22px" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.5px", lineHeight: 1.35 }}>
                {hasOrg ? "단체를 추가할까요?" : <>어떤 단체에서<br />활동하시나요?</>}
              </div>
              <div style={{ fontSize: 14.5, color: C.sub2, marginTop: 8 }}>이미 운영 중인 단체에 들어가거나, 새로 만들 수 있어요.</div>
            </div>

            <Card onClick={() => setView("join")} style={{ display: "flex", gap: 14, alignItems: "center", cursor: "pointer", marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <KeyRound size={22} color={C.blue} />
              </div>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 800, color: C.text }}>초대 코드로 가입하기</div>
                <div style={{ fontSize: 13.5, color: C.sub2, marginTop: 2 }}>관리자에게 받은 6자리 코드를 입력해요</div>
              </div>
            </Card>

            <Card onClick={() => setView("create")} style={{ display: "flex", gap: 14, alignItems: "center", cursor: "pointer" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: C.greenLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sparkles size={22} color={C.green} />
              </div>
              <div>
                <div style={{ fontSize: 16.5, fontWeight: 800, color: C.text }}>새 단체 만들기</div>
                <div style={{ fontSize: 13.5, color: C.sub2, marginTop: 2 }}>우리 동아리 공간을 만들고 관리자가 돼요</div>
              </div>
            </Card>
          </>
        )}

        {view === "join" && (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "4px 4px 18px" }}>초대 코드 입력</div>
            <Card>
              <input style={{ ...inputStyle, textAlign: "center", fontSize: 22, fontWeight: 800, letterSpacing: 6 }}
                placeholder="ABC123" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && join()} autoCapitalize="characters" />
              <Btn onClick={join} loading={busy}>가입하기</Btn>
            </Card>
            <div style={{ fontSize: 13, color: C.sub2, textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
              코드는 단체 관리자가 [전체 → 초대 코드]에서 확인해 공유할 수 있어요.
            </div>
          </>
        )}

        {view === "create" && (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: "4px 4px 18px" }}>새 단체 만들기</div>
            <Card>
              <input style={inputStyle} placeholder="단체 이름 (예: impact 테니스)" value={orgName}
                onChange={(e) => setOrgName(e.target.value)} />
              <textarea style={{ ...inputStyle, resize: "none" }} rows={3}
                placeholder="한 줄 소개 (선택)" value={orgDesc} onChange={(e) => setOrgDesc(e.target.value)} />
              <Btn onClick={create} loading={busy}>만들기</Btn>
            </Card>
            <div style={{ fontSize: 13, color: C.sub2, textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
              만든 사람이 관리자가 되고, 수업 시간·정원·오픈 시각을<br />[전체] 탭에서 자유롭게 설정할 수 있어요.
            </div>
          </>
        )}

        {view === "created" && (
          <div style={{ textAlign: "center", paddingTop: 30 }}>
            <div style={{ fontSize: 52 }}>🎉</div>
            <div style={{ fontSize: 23, fontWeight: 800, color: C.text, margin: "12px 0 6px" }}>{orgName} 개설 완료!</div>
            <div style={{ fontSize: 14.5, color: C.sub2, marginBottom: 22 }}>아래 초대 코드를 부원들에게 공유해주세요.</div>
            <Card onClick={copyCode} style={{ cursor: "pointer", marginBottom: 16 }}>
              <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 8, color: C.blue }}>{createdCode}</div>
              <div style={{ fontSize: 13, color: C.sub2, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                {copied ? <><Check size={14} color={C.green} /> 복사됐어요</> : <><Copy size={14} /> 탭해서 복사</>}
              </div>
            </Card>
            <Btn onClick={() => onDone(createdId)}>시작하기</Btn>
            <div style={{ fontSize: 13, color: C.sub2, marginTop: 14, lineHeight: 1.6 }}>
              초대 코드는 나중에도 [전체] 탭에서 언제든 볼 수 있어요.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
