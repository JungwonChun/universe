import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X, Megaphone } from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Modal, SectionTitle, inputStyle, useToast } from "../ui.jsx";
import { ymd, DAY_NAMES, fmtTime } from "../lib/schedule.js";

export default function CalendarScreen({ uid, isAdmin, orgId, slots, events, reload }) {
  const today = new Date();
  const [calMonth, setCalMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(ymd(today));
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState({ date: "", title: "", description: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const firstDow = new Date(y, mo, 1).getDay();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const eventDates = new Set(events.map((e) => e.date));
  const classDows = new Set(slots.map((s) => s.day_of_week));
  const selEvents = events.filter((e) => e.date === selectedDate);
  const selDow = selectedDate ? new Date(selectedDate + "T00:00:00").getDay() : -1;
  const daySlots = slots.filter((s) => s.day_of_week === selDow);
  const todayStr = ymd(today);

  const addEvent = async () => {
    if (!draft.date || !draft.title.trim()) { toast("날짜와 제목을 입력해주세요"); return; }
    setBusy(true);
    const { error } = await supabase.from("events").insert({
      org_id: orgId, date: draft.date, title: draft.title.trim(),
      description: draft.description.trim() || null, created_by: uid,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setShowModal(false);
    setDraft({ date: "", title: "", description: "" });
    toast("행사 일정을 등록했어요 📣");
    reload();
  };

  const deleteEvent = async (id) => {
    await supabase.from("events").delete().eq("id", id);
    toast("일정을 삭제했어요");
    reload();
  };

  return (
    <div>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <button onClick={() => setCalMonth(new Date(y, mo - 1, 1))} style={navBtn}><ChevronLeft size={18} color={C.sub} /></button>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{y}년 {mo + 1}월</span>
          <button onClick={() => setCalMonth(new Date(y, mo + 1, 1))} style={navBtn}><ChevronRight size={18} color={C.sub} /></button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", textAlign: "center", marginBottom: 8 }}>
          {DAY_NAMES.map((d, i) => (
            <span key={d} style={{ fontSize: 12, fontWeight: 700, color: i === 0 ? C.red : C.sub2 }}>{d}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", rowGap: 4 }}>
          {cells.map((day, i) => {
            if (day === null) return <div key={"x" + i} />;
            const dateStr = ymd(new Date(y, mo, day));
            const dow = (firstDow + day - 1) % 7;
            const hasEvent = eventDates.has(dateStr);
            const isClass = classDows.has(dow);
            const isSel = dateStr === selectedDate;
            const isToday = dateStr === todayStr;
            return (
              <div key={day} onClick={() => setSelectedDate(dateStr)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", padding: "3px 0" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: isSel || isToday ? 800 : 600,
                  background: isSel ? C.blue : isToday ? C.blueLight : "transparent",
                  color: isSel ? "#fff" : isToday ? C.blue : dow === 0 ? C.red : C.text,
                }}>{day}</div>
                <div style={{ display: "flex", gap: 3, height: 6, marginTop: 1 }}>
                  {isClass && <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.blue, opacity: 0.45 }} />}
                  {hasEvent && <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.orange }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.bg}` }}>
          <Legend color={C.blue} dim>정기 수업</Legend>
          <Legend color={C.orange}>동아리 행사</Legend>
        </div>
      </Card>

      <SectionTitle right={isAdmin && (
        <button onClick={() => { setDraft({ date: selectedDate || "", title: "", description: "" }); setShowModal(true); }}
          style={{ border: "none", background: C.blue, color: "#fff", borderRadius: 10, padding: "7px 12px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={14} /> 일정 등록
        </button>
      )}>
        {selectedDate ? `${parseInt(selectedDate.slice(5, 7))}월 ${parseInt(selectedDate.slice(8, 10))}일` : "날짜를 선택하세요"}
      </SectionTitle>

      {daySlots.length > 0 && (
        <Card style={{ marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: C.blueLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🎾</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>정기 수업 ({DAY_NAMES[selDow]}요일)</div>
            <div style={{ fontSize: 13, color: C.sub2 }}>
              {daySlots.map((s) => `${fmtTime(s.start_time)}–${fmtTime(s.end_time)}`).join(" · ")}
            </div>
          </div>
        </Card>
      )}

      {selEvents.length === 0 && daySlots.length === 0 && (
        <Card><div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>이 날은 일정이 없어요</div></Card>
      )}
      {selEvents.map((e) => (
        <Card key={e.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{e.title}</div>
            {isAdmin && (
              <button onClick={() => deleteEvent(e.id)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2 }}>
                <X size={16} color={C.sub2} />
              </button>
            )}
          </div>
          {e.description && <div style={{ fontSize: 14, color: C.sub, marginTop: 6, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{e.description}</div>}
          <div style={{ fontSize: 12, color: C.sub2, marginTop: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <Megaphone size={12} /> 관리자 공지
          </div>
        </Card>
      ))}

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>행사 일정 등록</div>
          <input type="date" style={inputStyle} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          <input style={inputStyle} placeholder="행사 제목 (예: 6월 정기 친선전)" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea style={{ ...inputStyle, resize: "none" }} rows={3} placeholder="행사 내용"
            value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <Btn onClick={addEvent} loading={busy} style={{ marginTop: 4 }}>등록하기</Btn>
        </Modal>
      )}
    </div>
  );
}

const navBtn = {
  border: "none", background: C.bg, borderRadius: 10, width: 32, height: 32,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};

function Legend({ color, dim, children }) {
  return (
    <span style={{ fontSize: 12, color: C.sub2, display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: dim ? 0.45 : 1 }} />
      {children}
    </span>
  );
}
