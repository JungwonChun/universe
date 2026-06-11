import { useState } from "react";
import { Lock, Clock } from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Avatar, useToast } from "../ui.jsx";
import { fmtTime, fmtMD, slotDateInWeek } from "../lib/schedule.js";

export default function BookScreen({ uid, isAdmin, org, slots, signups, cycle, reload }) {
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  const setOverride = async (state) => {
    const { error } = await supabase.from("orgs").update({
      override_state: state, override_week: state ? cycle.weekKey : null,
    }).eq("id", org.id);
    if (error) { toast(error.message); return; }
    toast(state === "open" ? "신청을 오픈했어요! 🔔" : state === "closed" ? "신청을 마감했어요 🔒" : "자동 스케줄로 돌아갔어요");
    reload();
  };

  const apply = async (slotId) => {
    setBusy(slotId);
    const { data, error } = await supabase.rpc("signup_slot", { p_slot: slotId, p_week: cycle.weekKey });
    setBusy(null);
    if (error) { toast(error.message); return; }
    if (data === "confirmed") toast("신청 완료! 코트에서 만나요 🎾");
    else if (data === "waitlist") toast("정원 마감! 대기열에 등록됐어요 ⏳");
    reload();
  };

  const cancel = async (slotId) => {
    setBusy(slotId);
    const { data, error } = await supabase.rpc("cancel_slot", { p_slot: slotId, p_week: cycle.weekKey });
    setBusy(null);
    if (error) { toast(error.message); return; }
    if (data?.promoted_name) toast(`취소 완료 · ${data.promoted_name}님이 자동 승급됐어요 🔄`);
    else toast("취소했어요");
    reload();
  };

  const openTimeStr = `${["일","월","화","수","목","금","토"][org.open_day]}요일 ${String(org.open_time).slice(0, 5)}`;

  return (
    <div>
      {/* 상태 헤더 */}
      <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: 16 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
          background: cycle.open ? C.green : C.sub2,
          boxShadow: cycle.open ? `0 0 0 4px ${C.greenLight}` : "none",
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
            {cycle.open ? "신청 진행 중" : "신청 마감"} · {fmtMD(cycle.targetMonday)} 주
            {cycle.isOverridden && <span style={{ fontSize: 11, color: C.orange, marginLeft: 6 }}>수동</span>}
          </div>
          <div style={{ fontSize: 12.5, color: C.sub2, fontWeight: 500 }}>
            매주 {openTimeStr} 자동 오픈 · 취소 시 대기 1번 자동 승급
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setOverride(cycle.open ? "closed" : "open")}
              style={{
                border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700,
                fontFamily: "inherit", cursor: "pointer",
                background: cycle.open ? C.redLight : C.blue, color: cycle.open ? C.red : "#fff",
              }}>
              {cycle.open ? "마감" : "오픈"}
            </button>
            {cycle.isOverridden && (
              <button onClick={() => setOverride(null)}
                style={{ border: "none", borderRadius: 10, padding: "8px 10px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", background: C.bg, color: C.sub }}>
                자동
              </button>
            )}
          </div>
        )}
      </Card>

      {slots.length === 0 ? (
        <Card style={{ marginTop: 12, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>아직 수업 타임이 없어요</div>
          <div style={{ fontSize: 14, color: C.sub2, marginTop: 6, lineHeight: 1.5 }}>
            관리자가 [전체 → 수업 타임 관리]에서<br />요일·시간·정원을 등록하면 신청이 시작돼요.
          </div>
        </Card>
      ) : !cycle.open ? (
        <Card style={{ marginTop: 12, textAlign: "center", padding: "44px 20px" }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Lock size={28} color={C.sub2} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>아직 신청 시간이 아니에요</div>
          <div style={{ fontSize: 14, color: C.sub2, marginTop: 6, lineHeight: 1.5 }}>
            매주 <b style={{ color: C.blue }}>{openTimeStr}</b>에 자동으로 열려요.
          </div>
        </Card>
      ) : (
        slots.map((d) => {
          const confirmed = signups.filter((s) => s.slot_id === d.id && s.status === "confirmed");
          const waitlist = signups.filter((s) => s.slot_id === d.id && s.status === "waitlist");
          const isFull = confirmed.length >= d.capacity;
          const iAmIn = confirmed.some((s) => s.user_id === uid);
          const myWaitIdx = waitlist.findIndex((s) => s.user_id === uid);
          const date = slotDateInWeek(cycle.weekKey, d.day_of_week);
          return (
            <Card key={d.id} style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>{fmtMD(date)}</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: C.text, letterSpacing: "-0.4px" }}>
                    {fmtTime(d.start_time)} – {fmtTime(d.end_time)}
                  </div>
                </div>
                <div style={{
                  borderRadius: 10, padding: "6px 11px", fontSize: 13, fontWeight: 800,
                  background: isFull ? C.redLight : C.blueLight, color: isFull ? C.red : C.blue,
                }}>
                  {isFull ? "마감" : "모집중"} {confirmed.length}/{d.capacity}
                </div>
              </div>

              <div style={{ height: 8, background: C.bg, borderRadius: 4, margin: "14px 0", overflow: "hidden" }}>
                <div style={{ width: `${d.capacity > 0 ? Math.min(100, (confirmed.length / d.capacity) * 100) : 100}%`, height: "100%", background: isFull ? C.red : C.blue, transition: "width .4s ease" }} />
              </div>

              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, minHeight: 30 }}>
                {confirmed.map((s) => (
                  <span key={s.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    background: s.user_id === uid ? C.blueLight : C.bg,
                    borderRadius: 20, padding: "4px 11px 4px 5px", fontSize: 13, fontWeight: 600,
                    color: s.user_id === uid ? C.blue : C.sub,
                  }}>
                    <Avatar name={s.profiles?.name} size={22} />{s.profiles?.name}
                  </span>
                ))}
                {confirmed.length === 0 && <span style={{ fontSize: 13, color: C.sub2 }}>1번으로 신청해보세요!</span>}
              </div>

              {waitlist.length > 0 && (
                <div style={{ marginTop: 12, background: C.orangeLight, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.orange, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={13} /> 대기열 {waitlist.length}명
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {waitlist.map((s, i) => (
                      <span key={s.id} style={{ fontSize: 12.5, fontWeight: 600, color: C.sub, background: "#fff", borderRadius: 8, padding: "3px 9px" }}>
                        {i + 1}. {s.profiles?.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                {iAmIn ? (
                  <Btn variant="danger" loading={busy === d.id} onClick={() => cancel(d.id)}>신청 취소하기</Btn>
                ) : myWaitIdx >= 0 ? (
                  <Btn variant="waitlist" loading={busy === d.id} onClick={() => cancel(d.id)}>
                    대기 {myWaitIdx + 1}번 · 대기 취소하기
                  </Btn>
                ) : isFull ? (
                  <Btn variant="waitlist" loading={busy === d.id} onClick={() => apply(d.id)}>
                    대기 등록하기 (현재 {waitlist.length}명 대기)
                  </Btn>
                ) : (
                  <Btn loading={busy === d.id} onClick={() => apply(d.id)}>신청하기</Btn>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
