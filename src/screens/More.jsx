import { useState, useEffect } from "react";
import {
  Crown, Copy, Check, Plus, Trash2, Users, BellRing, KeyRound,
  LogOut, ChevronRight, Trophy, Building2, Minus,
} from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Modal, SectionTitle, Avatar, inputStyle, useToast } from "../ui.jsx";
import { DAY_NAMES, fmtTime } from "../lib/schedule.js";

export default function MoreScreen(ctx) {
  const { uid, profile, org, orgId, isAdmin, slots, members, counts, cycle, reload, myOrgs, switchOrg, addOrg, reloadMemberships } = ctx;
  const [view, setView] = useState("main"); // main | ranking
  const [code, setCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotDraft, setSlotDraft] = useState({ day_of_week: 1, start_time: "18:00", end_time: "19:00", capacity: 6 });
  const [busy, setBusy] = useState(false);
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

  const updateOpen = async (field, value) => {
    const { error } = await supabase.from("orgs").update({ [field]: value }).eq("id", orgId);
    if (error) toast(error.message);
    else { toast("저장했어요"); reload(); }
  };

  const addSlot = async () => {
    if (slotDraft.start_time >= slotDraft.end_time) { toast("종료 시간이 시작보다 빨라요"); return; }
    setBusy(true);
    const { error } = await supabase.from("class_slots").insert({ org_id: orgId, ...slotDraft });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setShowSlotModal(false);
    toast("수업 타임을 추가했어요");
    reload();
  };

  const removeSlot = async (id) => {
    await supabase.from("class_slots").delete().eq("id", id);
    toast("타임을 삭제했어요");
    reload();
  };

  const changeCap = async (slot, delta) => {
    const next = Math.max(1, Math.min(50, slot.capacity + delta));
    if (next === slot.capacity) return;
    const { error } = await supabase.rpc("set_capacity", { p_slot: slot.id, p_week: cycle.weekKey, p_cap: next });
    if (error) toast(error.message);
    else reload();
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

          {/* 수업 타임 관리 */}
          <Card style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
                <Users size={15} color={C.blue} /> 수업 타임 · 정원 관리
              </div>
              <button onClick={() => setShowSlotModal(true)}
                style={{ border: "none", background: C.blueLight, color: C.blue, borderRadius: 10, padding: "6px 11px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                <Plus size={13} /> 타임 추가
              </button>
            </div>
            {slots.length === 0 && (
              <div style={{ fontSize: 13.5, color: C.sub2, padding: "10px 0" }}>
                아직 타임이 없어요. 요일·시간·정원을 추가해주세요. (예: 월 18:00–19:00, 6명)
              </div>
            )}
            {slots.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: i < slots.length - 1 ? `1px solid ${C.bg}` : "none" }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>
                    {DAY_NAMES[s.day_of_week]}요일 {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                  </div>
                  <div onClick={() => removeSlot(s.id)} style={{ fontSize: 12, color: C.red, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                    <Trash2 size={11} /> 삭제
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => changeCap(s, -1)} style={capBtn(C.bg)}><Minus size={15} color={C.sub} /></button>
                  <span style={{ fontSize: 16, fontWeight: 800, color: C.text, width: 38, textAlign: "center" }}>{s.capacity}명</span>
                  <button onClick={() => changeCap(s, 1)} style={capBtn(C.blueLight)}><Plus size={15} color={C.blue} /></button>
                </div>
              </div>
            ))}
          </Card>

          {/* 자동 오픈 스케줄 */}
          <Card style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <BellRing size={15} color={C.blue} /> 자동 오픈 스케줄
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={org.open_day} onChange={(e) => updateOpen("open_day", Number(e.target.value))} style={selectStyle}>
                {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
              </select>
              <select value={String(org.open_time).slice(0, 5)} onChange={(e) => updateOpen("open_time", e.target.value)} style={selectStyle}>
                {["08:00","09:00","10:00","12:00","18:00","19:00","20:00","21:00","22:00"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 12.5, color: C.sub2, marginTop: 10, lineHeight: 1.55 }}>
              매주 이 시각에 <b>다음 주</b> 수업 신청이 자동으로 열리고, 그 주 마지막 수업이 끝나면 자동 마감돼요.
              [신청] 탭에서 수동으로 열고 닫을 수도 있어요.
            </div>
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

      {/* 타임 추가 모달 */}
      {showSlotModal && (
        <Modal onClose={() => setShowSlotModal(false)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>수업 타임 추가</div>
          <select value={slotDraft.day_of_week} onChange={(e) => setSlotDraft({ ...slotDraft, day_of_week: Number(e.target.value) })}
            style={{ ...selectStyle, width: "100%", marginBottom: 10 }}>
            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={slotDraft.start_time}
              onChange={(e) => setSlotDraft({ ...slotDraft, start_time: e.target.value })} />
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={slotDraft.end_time}
              onChange={(e) => setSlotDraft({ ...slotDraft, end_time: e.target.value })} />
          </div>
          <input type="number" min="1" max="50" style={inputStyle} placeholder="정원 (명)" value={slotDraft.capacity}
            onChange={(e) => setSlotDraft({ ...slotDraft, capacity: Number(e.target.value) || 1 })} />
          <Btn onClick={addSlot} loading={busy} style={{ marginTop: 4 }}>추가하기</Btn>
        </Modal>
      )}
    </div>
  );
}

const capBtn = (bg) => ({
  width: 30, height: 30, borderRadius: 9, border: "none", background: bg,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
});

const miniBtn = (bg, color) => ({
  border: "none", borderRadius: 8, padding: "6px 9px", fontSize: 11.5, fontWeight: 700,
  fontFamily: "inherit", cursor: "pointer", background: bg, color,
});

const selectStyle = {
  flex: 1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 12px",
  fontSize: 14.5, fontWeight: 600, fontFamily: "inherit", color: C.text, background: "#fff",
};

const rowStyle = { padding: "14px 0", borderBottom: `1px solid ${C.bg}`, cursor: "pointer" };
