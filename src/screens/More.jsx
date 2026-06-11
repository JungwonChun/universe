import { useState, useEffect } from "react";
import {
  Crown, Check, Plus, KeyRound,
  LogOut, ChevronRight, Trophy, Building2,
} from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, SectionTitle, Avatar, useToast } from "../ui.jsx";

export default function MoreScreen(ctx) {
  const { uid, profile, org, orgId, isAdmin, members, counts, reload, myOrgs, switchOrg, addOrg, reloadMemberships } = ctx;
  const [view, setView] = useState("main"); // main | ranking
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (isAdmin) {
      supabase.from("org_codes").select("code").eq("org_id", orgId).maybeSingle()
        .then(({ data }) => setCode(data?.code || null));
    }
  }, [isAdmin, orgId]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast("코드: " + code); }
  };

  const setRole = async (userId, role) => {
    const { error } = await supabase.from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId);
    if (error) toast(error.message);
    else { toast(role === "admin" ? "관리자로 지정했어요" : "관리자를 해제했어요"); reload(); reloadMemberships(); }
  };

  const kick = async (userId) => {
    const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
    if (error) toast(error.message);
    else { toast("내보냈어요"); reload(); }
  };

  const leave = async () => {
    if (!confirm(`${org.name}에서 탈퇴할까요?`)) return;
    await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", uid);
    reloadMemberships();
  };

  const logout = () => supabase.auth.signOut();

  /* ── 랭킹 서브뷰 ── */
  if (view === "ranking") {
    const ranked = members
      .map((m) => ({ ...m, count: counts[m.user_id] || 0 }))
      .sort((a, b) => b.count - a.count);
    const max = ranked[0]?.count || 1;
    return (
      <div>
        <div onClick={() => setView("main")} style={{ fontSize: 14.5, fontWeight: 700, color: C.sub, cursor: "pointer", margin: "4px 4px 14px" }}>
          ← 전체로 돌아가기
        </div>
        <Card style={{ padding: "8px 20px" }}>
          {ranked.map((m, i) => (
            <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0", borderBottom: i < ranked.length - 1 ? `1px solid ${C.bg}` : "none" }}>
              <div style={{ width: 26, textAlign: "center", fontSize: 15, fontWeight: 800, color: i < 3 ? C.blue : C.sub2 }}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
              </div>
              <Avatar name={m.profiles?.name} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: m.user_id === uid ? C.blue : C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  {m.profiles?.name}
                  {m.role === "admin" && <Crown size={13} color={C.orange} />}
                  {m.user_id === uid && <span style={{ fontSize: 11, background: C.blueLight, color: C.blue, borderRadius: 6, padding: "1px 6px" }}>나</span>}
                </div>
                <div style={{ height: 5, background: C.bg, borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
                  <div style={{ width: `${max ? (m.count / max) * 100 : 0}%`, height: "100%", background: i < 3 ? C.blue : "#B0C8F5", borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, width: 44, textAlign: "right" }}>{m.count}회</div>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  /* ── 메인 ── */
  return (
    <div>
      {/* 내 프로필 */}
      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={profile?.name} size={52} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
            {profile?.name}
            {isAdmin && <span style={{ fontSize: 11, background: C.orangeLight, color: C.orange, borderRadius: 6, padding: "2px 7px", fontWeight: 700 }}>관리자</span>}
          </div>
          <div style={{ fontSize: 13, color: C.sub2, marginTop: 2 }}>{org.name} · 총 {counts[uid] || 0}회 참여</div>
        </div>
      </Card>

      {/* 랭킹 진입 */}
      <Card onClick={() => setView("ranking")} style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: C.orangeLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Trophy size={20} color={C.orange} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text }}>참여 랭킹</div>
          <div style={{ fontSize: 13, color: C.sub2 }}>부원별 누적 참여 횟수</div>
        </div>
        <ChevronRight size={20} color={C.sub2} />
      </Card>

      {/* 단체 전환 */}
      <SectionTitle>내 단체</SectionTitle>
      <Card style={{ padding: "8px 20px" }}>
        {myOrgs.map((m, i) => (
          <div key={m.org_id} onClick={() => m.org_id !== orgId && switchOrg(m.org_id)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.bg}`, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Building2 size={17} color={C.blue} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{m.orgs?.name}</div>
              <div style={{ fontSize: 12.5, color: C.sub2 }}>{m.role === "admin" ? "관리자" : "부원"}</div>
            </div>
            {m.org_id === orgId && <Check size={18} color={C.blue} />}
          </div>
        ))}
        <div onClick={addOrg} style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 0", cursor: "pointer", color: C.blue, fontSize: 14, fontWeight: 700 }}>
          <Plus size={16} /> 단체 추가 가입 / 만들기
        </div>
      </Card>

      {isAdmin && (
        <>
          <SectionTitle>관리자 설정</SectionTitle>

          {/* 초대 코드 */}
          <Card onClick={code ? copyCode : undefined} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <KeyRound size={19} color={C.blue} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>초대 코드</div>
              <div style={{ fontSize: 13, color: C.sub2 }}>탭하면 복사돼요 · 새 부원에게 공유하세요</div>
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, color: C.blue, display: "flex", alignItems: "center", gap: 6 }}>
              {code || "..."} {copied && <Check size={16} color={C.green} />}
            </span>
          </Card>

          {/* 멤버 관리 */}
          <Card style={{ marginTop: 12, padding: "16px 20px 8px" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 6 }}>부원 관리 ({members.length}명)</div>
            {members.map((m, i) => (
              <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: i < members.length - 1 ? `1px solid ${C.bg}` : "none" }}>
                <Avatar name={m.profiles?.name} size={32} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 5 }}>
                  {m.profiles?.name} {m.role === "admin" && <Crown size={13} color={C.orange} />}
                </div>
                {m.user_id !== uid && (
                  <>
                    <button onClick={() => setRole(m.user_id, m.role === "admin" ? "member" : "admin")} style={miniBtn(C.bg, C.sub)}>
                      {m.role === "admin" ? "관리자 해제" : "관리자 지정"}
                    </button>
                    <button onClick={() => kick(m.user_id)} style={miniBtn(C.redLight, C.red)}>내보내기</button>
                  </>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {/* 계정 */}
      <SectionTitle>계정</SectionTitle>
      <Card style={{ padding: "6px 20px" }}>
        <div onClick={leave} style={rowStyle}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: C.sub }}>{org.name} 탈퇴하기</span>
        </div>
        <div onClick={logout} style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: C.red, display: "flex", alignItems: "center", gap: 6 }}>
            <LogOut size={15} /> 로그아웃
          </span>
        </div>
      </Card>

    </div>
  );
}

const miniBtn = (bg, color) => ({
  border: "none", borderRadius: 8, padding: "6px 9px", fontSize: 11.5, fontWeight: 700,
  fontFamily: "inherit", cursor: "pointer", background: bg, color,
});

const rowStyle = { padding: "14px 0", borderBottom: `1px solid ${C.bg}`, cursor: "pointer" };
