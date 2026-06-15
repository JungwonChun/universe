import { useState } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Clock, MapPin, Repeat, Trash2,
  Pencil, MessagesSquare, BellRing,
} from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Modal, SectionTitle, Avatar, inputStyle, useToast } from "../ui.jsx";
import { ymd, parseDate, DAY_NAMES, fmtTime, fmtMD, fmtDateTime, occursOn, openInfo } from "../lib/schedule.js";
import { Trophy } from "lucide-react";

const TYPE_META = {
  lesson: { label: "레슨", bg: C.blueLight, color: C.blue, dot: C.blue },
  event: { label: "행사", bg: C.orangeLight, color: C.orange, dot: C.orange },
  tournament: { label: "대회", bg: "#F0EBFE", color: "#7B5CF0", dot: "#7B5CF0" },
};
const POST_DOT = C.green;

const emptyDraft = {
  type: "lesson", title: "", description: "", location: "",
  repeat: false, day_of_week: "", event_date: "",
  start_time: "", end_time: "", capacity: "",
  open_rule_day: "", open_rule_time: "",
  // 대회 설정
  format: "knockout", team_count: 4, players_per_team: 4,
  num_singles: 1, num_doubles: 2, num_groups: 2, advance_per_group: 2, third_place: false,
};

export default function ScheduleScreen({ uid, orgId, isAdmin, activities, opens, signups, posts, tournaments, reload, setTab, schedDate, setSchedDate, openTournament }) {
  const today = new Date();
  const todayKey = ymd(today);
  const selKey = schedDate || todayKey;
  const selDate = parseDate(selKey);
  const [calMonth, setCalMonth] = useState(new Date(selDate.getFullYear(), selDate.getMonth(), 1));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // 수정 중인 activity
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  // 캘린더에 표시할 모집글: 우리 단체 글 전부 + 내가 참여한 외부 글 (날짜 있는 것만)
  const calPosts = posts.filter((p) =>
    p.meet_date && (p.org_id === orgId || p.post_joins.some((j) => j.user_id === uid)));

  // 내가 참가하는 날짜 (일정 신청 + 모집글 참여)
  const myDates = new Set([
    ...signups.filter((s) => s.user_id === uid).map((s) => s.occ_date),
    ...calPosts.filter((p) => p.post_joins.some((j) => j.user_id === uid)).map((p) => p.meet_date),
  ]);

  /* ── 액션 ── */
  const join = async (a) => {
    setBusy(a.id);
    const { data, error } = await supabase.rpc("join_activity", { p_activity: a.id, p_date: selKey });
    setBusy(null);
    if (error) { toast(error.message); return; }
    if (data === "confirmed") toast("신청 완료! 캘린더에 표시돼요 ✅");
    else if (data === "waitlist") toast("정원 마감! 대기열에 등록됐어요 ⏳");
    reload();
  };

  const leave = async (a) => {
    setBusy(a.id);
    const { data, error } = await supabase.rpc("leave_activity", { p_activity: a.id, p_date: selKey });
    setBusy(null);
    if (error) { toast(error.message); return; }
    if (data?.promoted_name) toast(`취소 완료 · ${data.promoted_name}님이 자동 승급됐어요 🔄`);
    else toast("취소했어요");
    reload();
  };

  const setOpenState = async (a, state) => {
    const { error } = await supabase.rpc("set_activity_open", { p_activity: a.id, p_date: selKey, p_state: state });
    if (error) { toast(error.message); return; }
    toast(state === "open" ? "이 회차 신청을 오픈했어요 🔔" : state === "closed" ? "이 회차 신청을 마감했어요 🔒" : "자동 규칙으로 돌아갔어요");
    reload();
  };

  const removeActivity = async (a) => {
    const msg = a.repeat_weekly
      ? `"${a.title}" 반복 일정 전체를 삭제할까요? 모든 회차의 신청 내역도 함께 사라져요.`
      : `"${a.title}" 일정을 삭제할까요?`;
    if (!confirm(msg)) return;
    await supabase.from("activities").delete().eq("id", a.id);
    toast("일정을 삭제했어요");
    reload();
  };

  const openCreate = () => {
    setEditing(null);
    setDraft({ ...emptyDraft, event_date: selKey >= todayKey ? selKey : "" });
    setShowModal(true);
  };

  const openEdit = (a) => {
    setEditing(a);
    setDraft({
      type: a.type, title: a.title, description: a.description || "", location: a.location || "",
      repeat: a.repeat_weekly,
      day_of_week: a.day_of_week ?? "", event_date: a.event_date || "",
      start_time: a.start_time ? fmtTime(a.start_time) : "", end_time: a.end_time ? fmtTime(a.end_time) : "",
      capacity: a.capacity ?? "",
      open_rule_day: a.open_rule_day ?? "", open_rule_time: a.open_rule_time ? fmtTime(a.open_rule_time) : "",
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!draft.title.trim()) { toast("제목을 입력해주세요"); return; }

    // 대회 생성 → create_tournament 후 대회 화면으로 이동
    if (draft.type === "tournament") {
      if (!draft.event_date) { toast("대회 날짜를 선택해주세요"); return; }
      if (Number(draft.num_singles) + Number(draft.num_doubles) < 1) { toast("단식·복식 합이 1경기 이상이어야 해요"); return; }
      const isGroup = draft.format !== "knockout";
      setBusy("save");
      const { data, error } = await supabase.rpc("create_tournament", {
        p_org: orgId, p_title: draft.title.trim(), p_date: draft.event_date, p_location: draft.location.trim() || null,
        p_format: draft.format, p_team_count: Number(draft.team_count), p_ppt: Number(draft.players_per_team),
        p_singles: Number(draft.num_singles), p_doubles: Number(draft.num_doubles),
        p_groups: isGroup ? Number(draft.num_groups) : null, p_advance: Number(draft.advance_per_group),
        p_third: draft.third_place,
      });
      setBusy(null);
      if (error) { toast(error.message); return; }
      setShowModal(false);
      toast("대회를 만들었어요 🏆 팀을 편성해보세요");
      reload();
      if (data?.tournament_id) openTournament(data.tournament_id);
      return;
    }

    if (draft.repeat && draft.day_of_week === "") { toast("반복 요일을 선택해주세요"); return; }
    if (!draft.repeat && !draft.event_date) { toast("날짜를 선택해주세요"); return; }
    if (draft.start_time && draft.end_time && draft.start_time >= draft.end_time) { toast("종료 시간이 시작보다 빨라요"); return; }
    let cap = null;
    if (draft.capacity !== "") {
      cap = Number(draft.capacity);
      if (!Number.isInteger(cap) || cap < 0 || cap > 50) { toast("정원은 0~50 사이로 입력해주세요"); return; }
    }
    if (draft.repeat && (draft.open_rule_day === "") !== (draft.open_rule_time === "")) {
      toast("신청 오픈 규칙은 요일과 시각을 함께 정해주세요"); return;
    }

    const payload = {
      org_id: orgId, type: draft.type, title: draft.title.trim(),
      description: draft.description.trim() || null, location: draft.location.trim() || null,
      repeat_weekly: draft.repeat,
      day_of_week: draft.repeat ? Number(draft.day_of_week) : null,
      event_date: draft.repeat ? null : draft.event_date,
      start_time: draft.start_time || null, end_time: draft.end_time || null,
      capacity: cap,
      open_rule_day: draft.repeat && draft.open_rule_day !== "" ? Number(draft.open_rule_day) : null,
      open_rule_time: draft.repeat && draft.open_rule_time ? draft.open_rule_time : null,
    };

    setBusy("save");
    let error;
    if (editing) {
      ({ error } = await supabase.from("activities").update(payload).eq("id", editing.id));
      // 정원이 늘었으면 보고 있는 회차의 대기자 자동 승급
      const capGrew = cap !== null && editing.capacity !== null && cap > editing.capacity;
      if (!error && capGrew && occursOn({ ...editing, ...payload }, selDate)) {
        await supabase.rpc("promote_waitlist", { p_activity: editing.id, p_date: selKey });
      }
    } else {
      ({ error } = await supabase.from("activities").insert({ ...payload, created_by: uid }));
    }
    setBusy(null);
    if (error) { toast(error.message); return; }
    setShowModal(false);
    toast(editing ? "일정을 수정했어요" : "일정을 추가했어요 📅");
    reload();
  };

  /* ── 캘린더 그리드 ── */
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const firstDow = new Date(y, mo, 1).getDay();
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const postDates = new Set(calPosts.map((p) => p.meet_date));

  const dayActs = activities
    .filter((a) => occursOn(a, selDate))
    .sort((a, b) => String(a.start_time || "99").localeCompare(String(b.start_time || "99")));
  const dayPosts = calPosts.filter((p) => p.meet_date === selKey);

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
            const date = new Date(y, mo, day);
            const dateStr = ymd(date);
            const dow = date.getDay();
            const kinds = new Set(activities.filter((a) => occursOn(a, date)).map((a) => a.type));
            const hasPost = postDates.has(dateStr);
            const isMine = myDates.has(dateStr);
            const isSel = dateStr === selKey;
            const isToday = dateStr === todayKey;
            return (
              <div key={day} onClick={() => setSchedDate(dateStr)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", padding: "3px 0" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: isSel || isToday ? 800 : 600, boxSizing: "border-box",
                  background: isSel ? C.blue : isToday ? C.blueLight : "transparent",
                  border: isMine && !isSel ? `2px solid ${C.green}` : "2px solid transparent",
                  color: isSel ? "#fff" : isToday ? C.blue : dow === 0 ? C.red : C.text,
                }}>{day}</div>
                <div style={{ display: "flex", gap: 3, height: 6, marginTop: 1 }}>
                  {kinds.has("lesson") && <span style={dot(TYPE_META.lesson.dot)} />}
                  {kinds.has("event") && <span style={dot(TYPE_META.event.dot)} />}
                  {kinds.has("tournament") && <span style={dot(TYPE_META.tournament.dot)} />}
                  {hasPost && <span style={dot(POST_DOT)} />}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.bg}`, flexWrap: "wrap" }}>
          <Legend color={TYPE_META.lesson.dot}>레슨</Legend>
          <Legend color={TYPE_META.event.dot}>행사</Legend>
          <Legend color={TYPE_META.tournament.dot}>대회</Legend>
          <Legend color={POST_DOT}>모집</Legend>
          <Legend ring>내 참가</Legend>
        </div>
      </Card>

      <SectionTitle right={isAdmin && (
        <button onClick={openCreate}
          style={{ border: "none", background: C.blue, color: "#fff", borderRadius: 10, padding: "7px 12px", fontSize: 13, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={14} /> 일정 만들기
        </button>
      )}>
        {parseInt(selKey.slice(5, 7))}월 {parseInt(selKey.slice(8, 10))}일 ({DAY_NAMES[selDate.getDay()]})
      </SectionTitle>

      {dayActs.length === 0 && dayPosts.length === 0 && (
        <Card><div style={{ color: C.sub2, fontSize: 14, textAlign: "center", padding: 8 }}>이 날은 일정이 없어요</div></Card>
      )}

      {dayActs.map((a) => a.type === "tournament" ? (
        <TournamentLink key={a.id} a={a} tournaments={tournaments} isAdmin={isAdmin}
          onOpen={openTournament} onRemove={removeActivity} />
      ) : (
        <ActivityCard key={a.id} a={a} uid={uid} isAdmin={isAdmin} selDate={selDate} selKey={selKey}
          opens={opens} signups={signups} busy={busy}
          onJoin={join} onLeave={leave} onOpenState={setOpenState} onEdit={openEdit} onRemove={removeActivity} />
      ))}

      {dayPosts.map((p) => {
        const joined = p.post_joins.some((j) => j.user_id === uid);
        return (
          <Card key={p.id} onClick={() => setTab("community")} style={{ marginBottom: 12, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: C.greenLight, color: C.green, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MessagesSquare size={11} /> 모집
              </span>
              {joined && <span style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ 참여 중</span>}
              <div style={{ flex: 1 }} />
              <ChevronRight size={16} color={C.sub2} />
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text, marginTop: 8 }}>{p.title}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 13, color: C.sub2, fontWeight: 600, flexWrap: "wrap" }}>
              {p.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> {p.location}</span>}
              <span>{p.post_joins.length}{p.max_people ? `/${p.max_people}` : ""}명 참여 · {p.org_name}</span>
            </div>
          </Card>
        );
      })}

      {/* 일정 만들기/수정 모달 */}
      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 14 }}>
            {editing ? "일정 수정" : "일정 만들기"}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {Object.entries(TYPE_META).filter(([id]) => !editing || id !== "tournament").map(([id, m]) => (
              <button key={id} onClick={() => setDraft({ ...draft, type: id })} style={{
                flex: 1, border: draft.type === id ? `2px solid ${m.color}` : `1px solid ${C.border}`,
                background: draft.type === id ? m.bg : "#fff", color: draft.type === id ? m.color : C.sub,
                borderRadius: 12, padding: "11px 0", fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}>{m.label}</button>
            ))}
          </div>

          <input style={inputStyle} placeholder="제목 (예: 정기 레슨, 6월 친선전)" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea style={{ ...inputStyle, resize: "none" }} rows={2} placeholder="설명 (선택)"
            value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input style={inputStyle} placeholder="장소 (선택)" value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })} />

          {draft.type === "tournament" ? (
            <TournamentConfig draft={draft} setDraft={setDraft} />
          ) : (
          <>
          {/* 반복 토글 */}
          <div onClick={() => setDraft({ ...draft, repeat: !draft.repeat })} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", borderRadius: 12,
            border: `1px solid ${C.border}`, marginBottom: 10, cursor: "pointer", background: "#fff",
          }}>
            <Repeat size={16} color={draft.repeat ? C.blue : C.sub2} />
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: draft.repeat ? C.text : C.sub }}>매주 반복</span>
            <div style={{
              width: 44, height: 26, borderRadius: 13, background: draft.repeat ? C.blue : C.border,
              position: "relative", transition: "background .15s ease",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2,
                left: draft.repeat ? 20 : 2, transition: "left .15s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
          </div>

          {draft.repeat ? (
            <select value={draft.day_of_week} onChange={(e) => setDraft({ ...draft, day_of_week: e.target.value })}
              style={{ ...selectStyle, width: "100%", marginBottom: 10, color: draft.day_of_week === "" ? C.sub2 : C.text }}>
              <option value="" disabled>반복 요일 선택</option>
              {DAY_NAMES.map((d, i) => <option key={i} value={i}>매주 {d}요일</option>)}
            </select>
          ) : (
            <input type="date" style={inputStyle} value={draft.event_date}
              onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} />
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={draft.start_time}
              onChange={(e) => setDraft({ ...draft, start_time: e.target.value })} />
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={draft.end_time}
              onChange={(e) => setDraft({ ...draft, end_time: e.target.value })} />
          </div>
          <input type="number" min="0" max="50" style={inputStyle} placeholder="정원 (비우면 인원 제한 없음)" value={draft.capacity}
            onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} />

          {draft.repeat ? (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: "6px 2px 8px", display: "flex", alignItems: "center", gap: 5 }}>
                <BellRing size={13} color={C.blue} /> 신청(투표) 오픈 규칙
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={draft.open_rule_day}
                  onChange={(e) => setDraft({ ...draft, open_rule_day: e.target.value })}
                  style={{ ...selectStyle, flex: 1, color: draft.open_rule_day === "" ? C.sub2 : C.text }}>
                  <option value="">수동 오픈만</option>
                  {DAY_NAMES.map((d, i) => <option key={i} value={i}>매주 {d}요일</option>)}
                </select>
                <input type="time" style={{ ...inputStyle, flex: 1, marginBottom: 0 }} value={draft.open_rule_time}
                  onChange={(e) => setDraft({ ...draft, open_rule_time: e.target.value })} />
              </div>
              <div style={{ fontSize: 12.5, color: C.sub2, margin: "8px 2px 14px", lineHeight: 1.55 }}>
                매 회차 직전 이 요일·시각에 신청이 자동으로 열려요. 비워두면 매번 캘린더에서 직접 오픈해요.
                자동이든 수동이든 회차별로 언제든 열고 닫을 수 있어요.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: C.sub2, margin: "0 2px 14px", lineHeight: 1.55 }}>
              단일 일정은 등록 즉시 신청을 받아요. 캘린더에서 수동으로 마감할 수 있어요.
            </div>
          )}
          </>
          )}

          <Btn onClick={save} loading={busy === "save"}>
            {draft.type === "tournament" ? "대회 만들기" : editing ? "저장하기" : "추가하기"}
          </Btn>
        </Modal>
      )}
    </div>
  );
}

/* ── 대회 설정 입력 ── */
function TournamentConfig({ draft, setDraft }) {
  const isGroup = draft.format !== "knockout";
  const FORMATS = [["knockout", "토너먼트"], ["group", "조별 리그"], ["group_knockout", "조별+본선"]];
  const numField = (key, label, min = 1) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 5 }}>{label}</div>
      <input type="number" min={min} style={{ ...inputStyle, marginBottom: 0 }} value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </div>
  );
  return (
    <>
      <input type="date" style={inputStyle} value={draft.event_date}
        onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} />

      <div style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: "4px 2px 8px" }}>대회 형식</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {FORMATS.map(([id, label]) => (
          <button key={id} onClick={() => setDraft({ ...draft, format: id })} style={{
            flex: 1, border: draft.format === id ? `2px solid ${TYPE_META.tournament.color}` : `1px solid ${C.border}`,
            background: draft.format === id ? TYPE_META.tournament.bg : "#fff",
            color: draft.format === id ? TYPE_META.tournament.color : C.sub,
            borderRadius: 10, padding: "10px 4px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {numField("team_count", "참가 팀 수", 2)}
        {numField("players_per_team", "팀당 인원", 1)}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {numField("num_singles", "단식 경기 수", 0)}
        {numField("num_doubles", "복식 경기 수", 0)}
      </div>
      {isGroup && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {numField("num_groups", "조 개수", 1)}
          {draft.format === "group_knockout" && numField("advance_per_group", "조별 진출 팀", 1)}
        </div>
      )}
      {draft.format !== "group" && (
        <div onClick={() => setDraft({ ...draft, third_place: !draft.third_place })} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12,
          border: `1px solid ${C.border}`, marginBottom: 12, cursor: "pointer", background: "#fff",
        }}>
          <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: draft.third_place ? C.text : C.sub }}>3·4위전</span>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: draft.third_place ? C.blue : C.border, position: "relative" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: draft.third_place ? 20 : 2, transition: "left .15s ease" }} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 12.5, color: C.sub2, margin: "0 2px 14px", lineHeight: 1.55 }}>
        만들면 대회 화면에서 팀을 편성하고 대진표를 생성해요. 각 팀 조장이 오더지를 내고 점수를 입력하면 순위가 자동 집계돼요.
      </div>
    </>
  );
}

/* ── 대회 일정 카드 ── */
function TournamentLink({ a, tournaments, isAdmin, onOpen, onRemove }) {
  const tour = (tournaments || []).find((t) => t.activity_id === a.id);
  const meta = TYPE_META.tournament;
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ background: meta.bg, color: meta.color, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Trophy size={11} /> 대회
        </span>
        {tour && <span style={{ fontSize: 12, fontWeight: 700, color: C.sub2 }}>{stageLabel(tour.stage)}</span>}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginTop: 10 }}>{a.title}</div>
      {a.location && (
        <div style={{ fontSize: 13, color: C.sub2, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <MapPin size={13} /> {a.location}
        </div>
      )}
      <Btn onClick={() => tour && onOpen(tour.id)} style={{ marginTop: 12 }}>대회 보기 / 관리</Btn>
      {isAdmin && (
        <div onClick={() => onRemove(a)} style={{ fontSize: 12.5, color: C.red, fontWeight: 600, cursor: "pointer", textAlign: "center", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Trash2 size={12} /> 대회 삭제
        </div>
      )}
    </Card>
  );
}

const stageLabel = (s) => ({ setup: "준비 중", group: "조별 예선", knockout: "본선", done: "종료" }[s] || s);

/* ── 일정 카드 ── */
function ActivityCard({ a, uid, isAdmin, selDate, selKey, opens, signups, busy, onJoin, onLeave, onOpenState, onEdit, onRemove }) {
  const meta = TYPE_META[a.type] || TYPE_META.event;
  const info = openInfo(a, selDate, opens);
  const confirmed = signups.filter((s) => s.activity_id === a.id && s.occ_date === selKey && s.status === "confirmed");
  const waitlist = signups.filter((s) => s.activity_id === a.id && s.occ_date === selKey && s.status === "waitlist");
  const iAmIn = confirmed.some((s) => s.user_id === uid);
  const myWaitIdx = waitlist.findIndex((s) => s.user_id === uid);
  const hasCap = a.capacity !== null;
  const isFull = hasCap && confirmed.length >= a.capacity;
  const ended = info.state === "ended";

  const stateChip = ended
    ? { label: "종료", bg: C.bg, color: C.sub2 }
    : info.state === "open"
      ? isFull ? { label: "정원 마감", bg: C.redLight, color: C.red } : { label: "모집 중", bg: C.greenLight, color: C.green }
      : info.state === "before"
        ? { label: `${fmtDateTime(info.opensAt)} 오픈`, bg: C.blueLight, color: C.blue }
        : { label: "신청 마감", bg: C.bg, color: C.sub2 };

  return (
    <Card style={{ marginBottom: 12, opacity: ended ? 0.65 : 1 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ background: meta.bg, color: meta.color, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 800 }}>
          {meta.label}{a.repeat_weekly ? " · 매주" : ""}
        </span>
        <span style={{ background: stateChip.bg, color: stateChip.color, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 700 }}>
          {stateChip.label}{info.isOverridden ? " (수동)" : ""}
        </span>
        {hasCap && (
          <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: isFull ? C.red : C.blue }}>
            {confirmed.length}/{a.capacity}
          </span>
        )}
      </div>

      <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginTop: 10 }}>{a.title}</div>
      {a.description && <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.description}</div>}
      <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 13, color: C.sub2, fontWeight: 600, flexWrap: "wrap" }}>
        {a.start_time && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Clock size={13} /> {fmtTime(a.start_time)}{a.end_time ? `–${fmtTime(a.end_time)}` : ""}
          </span>
        )}
        {a.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> {a.location}</span>}
      </div>

      {hasCap && (
        <div style={{ height: 8, background: C.bg, borderRadius: 4, margin: "12px 0 10px", overflow: "hidden" }}>
          <div style={{
            width: `${a.capacity > 0 ? Math.min(100, (confirmed.length / a.capacity) * 100) : 100}%`,
            height: "100%", background: isFull ? C.red : C.blue, transition: "width .4s ease",
          }} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: hasCap ? 0 : 12, minHeight: 26 }}>
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
        {confirmed.length === 0 && !ended && (
          <span style={{ fontSize: 13, color: C.sub2 }}>아직 참가자가 없어요 — 1번으로 신청해보세요!</span>
        )}
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

      {!ended && (
        <div style={{ marginTop: 14 }}>
          {iAmIn ? (
            <Btn variant="danger" loading={busy === a.id} onClick={() => onLeave(a)}>신청 취소하기</Btn>
          ) : myWaitIdx >= 0 ? (
            <Btn variant="waitlist" loading={busy === a.id} onClick={() => onLeave(a)}>
              대기 {myWaitIdx + 1}번 · 대기 취소하기
            </Btn>
          ) : info.state === "open" ? (
            isFull ? (
              <Btn variant="waitlist" loading={busy === a.id} onClick={() => onJoin(a)}>
                대기 등록하기 (현재 {waitlist.length}명 대기)
              </Btn>
            ) : (
              <Btn loading={busy === a.id} onClick={() => onJoin(a)}>{hasCap ? "선착순 신청하기" : "참가하기"}</Btn>
            )
          ) : (
            <Btn variant="gray" disabled>
              {info.state === "before" ? `${fmtDateTime(info.opensAt)}에 열려요` : "신청이 닫혀있어요"}
            </Btn>
          )}
        </div>
      )}

      {isAdmin && (
        <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.bg}` }}>
          {!ended && (info.state === "open" ? (
            <button onClick={() => onOpenState(a, "closed")} style={miniBtn(C.redLight, C.red)}>이 회차 마감</button>
          ) : (
            <button onClick={() => onOpenState(a, "open")} style={miniBtn(C.blueLight, C.blue)}>이 회차 오픈</button>
          ))}
          {info.isOverridden && (
            <button onClick={() => onOpenState(a, null)} style={miniBtn(C.bg, C.sub)}>자동</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => onEdit(a)} style={miniBtn(C.bg, C.sub)}><Pencil size={11} /> 수정</button>
          <button onClick={() => onRemove(a)} style={miniBtn(C.redLight, C.red)}><Trash2 size={11} /> 삭제</button>
        </div>
      )}
    </Card>
  );
}

/* ── 스타일 ── */
const navBtn = {
  border: "none", background: C.bg, borderRadius: 10, width: 32, height: 32,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};

const dot = (color) => ({ width: 5, height: 5, borderRadius: "50%", background: color });

const miniBtn = (bg, color) => ({
  border: "none", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700,
  fontFamily: "inherit", cursor: "pointer", background: bg, color,
  display: "inline-flex", alignItems: "center", gap: 3,
});

const selectStyle = {
  border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 12px", marginBottom: 10,
  fontSize: 14.5, fontWeight: 600, fontFamily: "inherit", color: C.text, background: "#fff",
};

function Legend({ color, ring, children }) {
  return (
    <span style={{ fontSize: 12, color: C.sub2, display: "flex", alignItems: "center", gap: 5 }}>
      {ring
        ? <span style={{ width: 8, height: 8, borderRadius: "50%", border: `2px solid ${C.green}`, boxSizing: "border-box" }} />
        : <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />}
      {children}
    </span>
  );
}
