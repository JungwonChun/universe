import { Zap, Lock, ChevronRight, Clock } from "lucide-react";
import { C, Card, SectionTitle } from "../ui.jsx";
import { DAY_NAMES, fmtTime, fmtMD, slotDateInWeek } from "../lib/schedule.js";

export default function HomeScreen({ uid, profile, slots, signups, events, counts, cycle, setTab }) {
  const myConfirmed = signups.filter((s) => s.user_id === uid && s.status === "confirmed");
  const myWaits = signups.filter((s) => s.user_id === uid && s.status === "waitlist");
  const slotById = Object.fromEntries(slots.map((s) => [s.id, s]));
  const myCount = counts[uid] || 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = events.filter((e) => new Date(e.date + "T00:00:00") >= today).slice(0, 2);

  const waitPos = (s) => {
    const list = signups.filter((x) => x.slot_id === s.slot_id && x.status === "waitlist");
    return list.findIndex((x) => x.user_id === uid) + 1;
  };

  return (
    <div>
      {/* 인사 카드 */}
      <Card style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.blueDark})`, color: "#fff" }}>
        <div style={{ fontSize: 14, opacity: 0.85, fontWeight: 600 }}>안녕하세요, {profile?.name}님 👋</div>
        <div style={{ fontSize: 23, fontWeight: 800, margin: "6px 0 14px", letterSpacing: "-0.5px" }}>
          지금까지 <span style={{ fontSize: 27 }}>{myCount}회</span> 참여했어요
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {myConfirmed.length > 0 ? myConfirmed.map((s) => {
            const def = slotById[s.slot_id];
            return def ? (
              <span key={s.id} style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
                ✓ {DAY_NAMES[def.day_of_week]} {fmtTime(def.start_time)}
              </span>
            ) : null;
          }) : (
            <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 600 }}>
              이번 주 확정된 신청이 없어요
            </span>
          )}
        </div>
      </Card>

      {/* 오픈 상태 배너 */}
      <Card onClick={() => setTab("book")} style={{ marginTop: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 46, height: 46, borderRadius: 14, flexShrink: 0,
          background: cycle.open ? C.greenLight : C.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {cycle.open ? <Zap size={22} color={C.green} /> : <Lock size={20} color={C.sub2} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
            {cycle.open ? "선착순 신청이 열려있어요!" : "신청 대기 중"}
          </div>
          <div style={{ fontSize: 13, color: C.sub2, marginTop: 2, fontWeight: 500 }}>
            {cycle.open
              ? `${fmtMD(cycle.targetMonday)} 주 수업 · 마감 전에 자리를 잡아보세요`
              : `${fmtMD(cycle.nextOpen)} ${String(cycle.nextOpen.getHours()).padStart(2, "0")}:${String(cycle.nextOpen.getMinutes()).padStart(2, "0")} 오픈 예정`}
          </div>
        </div>
        <ChevronRight size={20} color={C.sub2} />
      </Card>

      {/* 대기 중 알림 */}
      {myWaits.length > 0 && (
        <Card style={{ marginTop: 12, background: C.orangeLight }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: C.orange, flexWrap: "wrap" }}>
            <Clock size={16} />
            {myWaits.map((s) => {
              const def = slotById[s.slot_id];
              return def ? `${DAY_NAMES[def.day_of_week]} ${fmtTime(def.start_time)} 대기 ${waitPos(s)}번` : "";
            }).filter(Boolean).join(" · ")}
          </div>
          <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>앞 순서가 취소하면 자동으로 확정돼요</div>
        </Card>
      )}

      {/* 행사 */}
      <SectionTitle right={
        <span onClick={() => setTab("calendar")} style={{ fontSize: 13, color: C.sub2, fontWeight: 600, cursor: "pointer" }}>전체보기</span>
      }>다가오는 행사</SectionTitle>
      {upcoming.length === 0 && (
        <Card><div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>예정된 행사가 없어요</div></Card>
      )}
      {upcoming.map((e) => (
        <Card key={e.id} style={{ marginBottom: 10, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, background: C.blueLight, flexShrink: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.blue }}>{parseInt(e.date.slice(5, 7))}월</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: C.blue, lineHeight: 1 }}>{parseInt(e.date.slice(8, 10))}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{e.title}</div>
            {e.description && (
              <div style={{ fontSize: 13, color: C.sub2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.description}
              </div>
            )}
          </div>
        </Card>
      ))}

      {/* 주간 현황 */}
      <SectionTitle>이번 신청 현황 한눈에</SectionTitle>
      <Card>
        {slots.length === 0 && (
          <div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>
            아직 등록된 수업 타임이 없어요. 관리자가 [전체] 탭에서 등록할 수 있어요.
          </div>
        )}
        {slots.map((d, i) => {
          const confirmed = signups.filter((s) => s.slot_id === d.id && s.status === "confirmed").length;
          const ratio = confirmed / d.capacity;
          const date = slotDateInWeek(cycle.weekKey, d.day_of_week);
          return (
            <div key={d.id} style={{ padding: "10px 0", borderBottom: i < slots.length - 1 ? `1px solid ${C.bg}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: C.text }}>
                <span>{fmtMD(date)} {fmtTime(d.start_time)}–{fmtTime(d.end_time)}</span>
                <span style={{ color: ratio >= 1 ? C.red : C.blue }}>{confirmed}/{d.capacity}{ratio >= 1 ? " 마감" : ""}</span>
              </div>
              <div style={{ height: 6, background: C.bg, borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: "100%", background: ratio >= 1 ? C.red : C.blue, borderRadius: 3, transition: "width .4s ease" }} />
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
