import { Zap, ChevronRight, Clock, CalendarDays } from "lucide-react";
import { C, Card, SectionTitle } from "../ui.jsx";
import { ymd, parseDate, fmtTime, fmtMD, occursOn, nextOccDate, openInfo } from "../lib/schedule.js";

export default function HomeScreen({ uid, profile, activities, opens, signups, counts, setTab, setSchedDate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = ymd(today);
  const myCount = counts[uid] || 0;

  const actById = Object.fromEntries(activities.map((a) => [a.id, a]));
  const myUpcoming = signups
    .filter((s) => s.user_id === uid && s.status === "confirmed" && s.occ_date >= todayKey && actById[s.activity_id])
    .sort((a, b) => a.occ_date.localeCompare(b.occ_date))
    .slice(0, 4);
  const myWaits = signups.filter((s) => s.user_id === uid && s.status === "waitlist" && s.occ_date >= todayKey && actById[s.activity_id]);

  const waitPos = (s) => {
    const list = signups.filter((x) => x.activity_id === s.activity_id && x.occ_date === s.occ_date && x.status === "waitlist");
    return list.findIndex((x) => x.user_id === uid) + 1;
  };

  // 지금 신청 받는 일정 (다음 회차가 오픈 상태)
  const openNow = activities
    .map((a) => {
      const d = nextOccDate(a);
      if (!d) return null;
      const info = openInfo(a, d, opens);
      if (info.state !== "open") return null;
      const key = ymd(d);
      const confirmed = signups.filter((s) => s.activity_id === a.id && s.occ_date === key && s.status === "confirmed").length;
      return { a, d, key, confirmed };
    })
    .filter(Boolean)
    .sort((x, y) => x.key.localeCompare(y.key));

  // 다가오는 일정 (14일 내 모든 회차)
  const upcoming = [];
  for (let i = 0; i < 14 && upcoming.length < 5; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    for (const a of activities) {
      if (occursOn(a, d)) upcoming.push({ a, d, key: ymd(d) });
      if (upcoming.length >= 5) break;
    }
  }

  const goDate = (key) => { setSchedDate(key); setTab("schedule"); };

  return (
    <div>
      {/* 인사 카드 */}
      <Card style={{ background: `linear-gradient(135deg, ${C.blue}, ${C.blueDark})`, color: "#fff" }}>
        <div style={{ fontSize: 14, opacity: 0.85, fontWeight: 600 }}>안녕하세요, {profile?.name}님 👋</div>
        <div style={{ fontSize: 23, fontWeight: 800, margin: "6px 0 14px", letterSpacing: "-0.5px" }}>
          지금까지 <span style={{ fontSize: 27 }}>{myCount}회</span> 참여했어요
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {myUpcoming.length > 0 ? myUpcoming.map((s) => {
            const a = actById[s.activity_id];
            return (
              <span key={s.id} onClick={() => goDate(s.occ_date)}
                style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ✓ {fmtMD(parseDate(s.occ_date))} {a.title}
              </span>
            );
          }) : (
            <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 600 }}>
              다가오는 참가 일정이 없어요
            </span>
          )}
        </div>
      </Card>

      {/* 대기 중 알림 */}
      {myWaits.length > 0 && (
        <Card style={{ marginTop: 12, background: C.orangeLight }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: C.orange, flexWrap: "wrap" }}>
            <Clock size={16} />
            {myWaits.map((s) => {
              const a = actById[s.activity_id];
              return `${fmtMD(parseDate(s.occ_date))} ${a.title} 대기 ${waitPos(s)}번`;
            }).join(" · ")}
          </div>
          <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>앞 순서가 취소하면 자동으로 확정돼요</div>
        </Card>
      )}

      {/* 지금 신청 받는 일정 */}
      <SectionTitle>지금 신청 받는 일정</SectionTitle>
      {openNow.length === 0 && (
        <Card><div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>지금 열려있는 신청이 없어요</div></Card>
      )}
      {openNow.map(({ a, d, key, confirmed }) => {
        const isFull = a.capacity !== null && confirmed >= a.capacity;
        return (
          <Card key={a.id + key} onClick={() => goDate(key)}
            style={{ marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 14, flexShrink: 0,
              background: isFull ? C.bg : C.greenLight,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Zap size={22} color={isFull ? C.sub2 : C.green} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text }}>{a.title}</div>
              <div style={{ fontSize: 13, color: C.sub2, marginTop: 2, fontWeight: 500 }}>
                {fmtMD(d)}{a.start_time ? ` ${fmtTime(a.start_time)}` : ""}
                {a.capacity !== null ? ` · ${confirmed}/${a.capacity}명${isFull ? " (대기 가능)" : ""}` : ` · ${confirmed}명 참가`}
              </div>
            </div>
            <ChevronRight size={20} color={C.sub2} />
          </Card>
        );
      })}

      {/* 다가오는 일정 */}
      <SectionTitle right={
        <span onClick={() => setTab("schedule")} style={{ fontSize: 13, color: C.sub2, fontWeight: 600, cursor: "pointer" }}>전체보기</span>
      }>다가오는 일정</SectionTitle>
      {upcoming.length === 0 && (
        <Card>
          <div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>
            예정된 일정이 없어요. 관리자가 [일정] 탭에서 만들 수 있어요.
          </div>
        </Card>
      )}
      {upcoming.map(({ a, d, key }) => (
        <Card key={a.id + key} onClick={() => goDate(key)}
          style={{ marginBottom: 10, display: "flex", gap: 14, alignItems: "center", cursor: "pointer" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, background: a.type === "lesson" ? C.blueLight : C.orangeLight, flexShrink: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: a.type === "lesson" ? C.blue : C.orange }}>{d.getMonth() + 1}월</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: a.type === "lesson" ? C.blue : C.orange, lineHeight: 1 }}>{d.getDate()}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{a.title}</div>
            <div style={{ fontSize: 13, color: C.sub2, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
              <CalendarDays size={12} />
              {fmtMD(d)}{a.start_time ? ` ${fmtTime(a.start_time)}–${a.end_time ? fmtTime(a.end_time) : ""}` : ""}
              {a.repeat_weekly ? " · 매주" : ""}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
