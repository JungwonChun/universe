import { useState, useEffect, useCallback } from "react";
import { Plus, Globe2, Building2, MapPin, CalendarDays, Trash2, Users, BarChart3, X } from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Modal, Avatar, inputStyle, useToast } from "../ui.jsx";
import PollCard from "./PollCard.jsx";

const TYPE_META = {
  match: { label: "교류전", bg: "#F0EBFE", color: "#7B5CF0" },
  play: { label: "같이 치기", bg: "#E5F9F1", color: "#00A661" },
  etc: { label: "기타", bg: "#F2F4F6", color: "#4E5968" },
};

const emptyPoll = { question: "", options: ["", ""], multi: false };

export default function CommunityScreen({ uid, profile, org, orgId, isAdmin, polls = [], pollVotes = [], members = [], reload }) {
  const [posts, setPosts] = useState(null);
  const [filter, setFilter] = useState("all"); // all | mine
  const [showWrite, setShowWrite] = useState(false);
  const [mode, setMode] = useState("post"); // post | poll
  const [draft, setDraft] = useState({ type: "play", title: "", body: "", meet_date: "", location: "", max_people: "", visibility: "org" });
  const [poll, setPoll] = useState(emptyPoll);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    // RLS가 알아서 걸러줌: 전체 공개 글 + 내 단체 내부 글
    const { data } = await supabase
      .from("posts")
      .select("*, post_joins(user_id, user_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    setPosts(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("community")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_joins" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const submit = async () => {
    if (!draft.title.trim()) { toast("제목을 입력해주세요"); return; }
    setBusy(true);
    const { error } = await supabase.from("posts").insert({
      org_id: orgId, org_name: org.name,
      author_id: uid, author_name: profile?.name || "부원",
      type: draft.type, title: draft.title.trim(), body: draft.body.trim() || null,
      meet_date: draft.meet_date || null, location: draft.location.trim() || null,
      max_people: draft.max_people ? Number(draft.max_people) : null,
      visibility: draft.visibility,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setShowWrite(false);
    setDraft({ type: "play", title: "", body: "", meet_date: "", location: "", max_people: "", visibility: "org" });
    toast(draft.visibility === "public" ? "전체 공개로 올렸어요 🌏" : "우리 단체에 올렸어요 📣");
    load();
  };

  const submitPoll = async () => {
    const opts = poll.options.map((o) => o.trim()).filter(Boolean);
    if (!poll.question.trim()) { toast("투표 질문을 입력해주세요"); return; }
    if (opts.length < 2) { toast("선택지를 2개 이상 입력해주세요"); return; }
    setBusy(true);
    const { error } = await supabase.from("polls").insert({
      org_id: orgId, author_id: uid, author_name: profile?.name || "부원",
      question: poll.question.trim(), options: opts, multi: poll.multi,
    });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setShowWrite(false); setPoll(emptyPoll);
    toast("투표를 올렸어요 🗳️ 홈에도 표시돼요");
    reload && reload();
  };

  const toggleJoin = async (post, joined) => {
    if (joined) {
      await supabase.from("post_joins").delete().eq("post_id", post.id).eq("user_id", uid);
      toast("참여를 취소했어요");
    } else {
      if (post.max_people && post.post_joins.length >= post.max_people) { toast("모집 인원이 가득 찼어요"); return; }
      const { error } = await supabase.from("post_joins").insert({ post_id: post.id, user_id: uid, user_name: profile?.name || "부원" });
      if (error) { toast(error.message); return; }
      toast(post.meet_date ? "참여 완료! [일정] 캘린더에 표시돼요 🙌" : "참여 완료! 🙌");
    }
    load();
  };

  const remove = async (post) => {
    await supabase.from("posts").delete().eq("id", post.id);
    toast("글을 삭제했어요");
    load();
  };

  const list = (posts || []).filter((p) => (filter === "mine" ? p.org_id === orgId : true));

  return (
    <div>
      {/* 필터 + 글쓰기 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 12px" }}>
        {[["all", "전체"], ["mine", "우리 단체"]].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{
            border: "none", borderRadius: 20, padding: "8px 15px", fontSize: 13.5, fontWeight: 700,
            fontFamily: "inherit", cursor: "pointer",
            background: filter === id ? C.text : "#fff", color: filter === id ? "#fff" : C.sub,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setMode("post"); setShowWrite(true); }} style={{
          border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 13.5, fontWeight: 700,
          fontFamily: "inherit", cursor: "pointer", background: C.blue, color: "#fff",
          display: "flex", alignItems: "center", gap: 4,
        }}><Plus size={15} /> 글쓰기</button>
      </div>

      {/* 투표 (우리 단체 전용 → '우리 단체' 필터에서만, '전체'에서도 노출) */}
      {polls.map((pl) => (
        <PollCard key={pl.id} poll={pl} votes={pollVotes.filter((v) => v.poll_id === pl.id)}
          uid={uid} memberCount={members.length} isAdmin={isAdmin} reload={reload} />
      ))}

      {posts === null ? (
        <Card><div style={{ textAlign: "center", color: C.sub2, fontSize: 14, padding: 12 }}>불러오는 중...</div></Card>
      ) : list.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.text }}>아직 모집 글이 없어요</div>
          <div style={{ fontSize: 13.5, color: C.sub2, marginTop: 4 }}>교류전이나 같이 칠 사람을 첫 번째로 모집해보세요!</div>
        </Card>
      ) : (
        list.map((p) => {
          const meta = TYPE_META[p.type] || TYPE_META.etc;
          const joined = p.post_joins.some((j) => j.user_id === uid);
          const isMine = p.author_id === uid;
          const isFull = p.max_people && p.post_joins.length >= p.max_people;
          return (
            <Card key={p.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ background: meta.bg, color: meta.color, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 800 }}>{meta.label}</span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 3, borderRadius: 8, padding: "3px 9px",
                  fontSize: 12, fontWeight: 700,
                  background: p.visibility === "public" ? C.blueLight : C.bg,
                  color: p.visibility === "public" ? C.blue : C.sub2,
                }}>
                  {p.visibility === "public" ? <><Globe2 size={11} /> 전체 공개</> : <><Building2 size={11} /> 단체 내부</>}
                </span>
                <div style={{ flex: 1 }} />
                {(isMine || (p.org_id === orgId && isAdmin)) && (
                  <Trash2 size={16} color={C.sub2} style={{ cursor: "pointer" }} onClick={() => remove(p)} />
                )}
              </div>

              <div style={{ fontSize: 16.5, fontWeight: 800, color: C.text, marginTop: 10 }}>{p.title}</div>
              {p.body && <div style={{ fontSize: 14, color: C.sub, marginTop: 5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{p.body}</div>}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 13, color: C.sub2, fontWeight: 600 }}>
                {p.meet_date && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CalendarDays size={13} /> {p.meet_date}</span>}
                {p.location && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> {p.location}</span>}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Users size={13} /> {p.post_joins.length}{p.max_people ? `/${p.max_people}` : ""}명 참여
                </span>
              </div>

              {p.post_joins.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {p.post_joins.map((j) => (
                    <span key={j.user_id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.bg, borderRadius: 16, padding: "3px 9px 3px 4px", fontSize: 12, fontWeight: 600, color: C.sub }}>
                      <Avatar name={j.user_name} size={18} />{j.user_name}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
                <Avatar name={p.author_name} size={24} />
                <span style={{ fontSize: 12.5, color: C.sub2, fontWeight: 600, flex: 1 }}>
                  {p.author_name} · {p.org_name}
                </span>
              </div>

              <div style={{ marginTop: 12 }}>
                {isMine ? null : joined ? (
                  <Btn variant="gray" onClick={() => toggleJoin(p, true)} style={{ padding: "12px 0", fontSize: 15 }}>참여 취소</Btn>
                ) : (
                  <Btn onClick={() => toggleJoin(p, false)} disabled={isFull} style={{ padding: "12px 0", fontSize: 15 }}>
                    {isFull ? "모집 마감" : "참여하기"}
                  </Btn>
                )}
              </div>
            </Card>
          );
        })
      )}

      {/* 글쓰기 모달 */}
      {showWrite && (
        <Modal onClose={() => setShowWrite(false)}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["post", "모집글"], ["poll", "투표"]].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} style={{
                flex: 1, border: mode === id ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
                background: mode === id ? C.blueLight : "#fff", color: mode === id ? C.blue : C.sub,
                borderRadius: 12, padding: "11px 0", fontSize: 14.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}>{label}</button>
            ))}
          </div>

          {mode === "poll" ? (
            <>
              <input style={inputStyle} placeholder="투표 질문 (예: 회식 언제가 좋아요?)" value={poll.question}
                onChange={(e) => setPoll({ ...poll, question: e.target.value })} />
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, margin: "2px 2px 8px" }}>선택지</div>
              {poll.options.map((opt, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} placeholder={`선택지 ${i + 1}`} value={opt}
                    onChange={(e) => setPoll({ ...poll, options: poll.options.map((o, j) => j === i ? e.target.value : o) })} />
                  {poll.options.length > 2 && (
                    <button onClick={() => setPoll({ ...poll, options: poll.options.filter((_, j) => j !== i) })}
                      style={{ border: "none", background: C.redLight, borderRadius: 10, width: 40, height: 40, cursor: "pointer", flexShrink: 0 }}>
                      <X size={15} color={C.red} />
                    </button>
                  )}
                </div>
              ))}
              {poll.options.length < 8 && (
                <button onClick={() => setPoll({ ...poll, options: [...poll.options, ""] })}
                  style={{ border: `1px dashed ${C.border}`, background: "#fff", color: C.sub, borderRadius: 10, padding: "10px 0", width: "100%", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginBottom: 12 }}>
                  + 선택지 추가
                </button>
              )}
              <div onClick={() => setPoll({ ...poll, multi: !poll.multi })} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12,
                border: `1px solid ${C.border}`, marginBottom: 14, cursor: "pointer",
              }}>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: poll.multi ? C.text : C.sub }}>복수 선택 허용</span>
                <div style={{ width: 44, height: 26, borderRadius: 13, background: poll.multi ? C.blue : C.border, position: "relative" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: poll.multi ? 20 : 2, transition: "left .15s ease" }} />
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: C.sub2, margin: "0 2px 12px", lineHeight: 1.5 }}>
                투표는 우리 단체 부원에게 보이고, 모두의 홈 화면에도 떠요.
              </div>
              <Btn onClick={submitPoll} loading={busy}>투표 올리기</Btn>
            </>
          ) : (
          <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {Object.entries(TYPE_META).map(([id, m]) => (
              <button key={id} onClick={() => setDraft({ ...draft, type: id })} style={{
                flex: 1, border: draft.type === id ? `2px solid ${m.color}` : `1px solid ${C.border}`,
                background: draft.type === id ? m.bg : "#fff", color: draft.type === id ? m.color : C.sub,
                borderRadius: 12, padding: "11px 0", fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}>{m.label}</button>
            ))}
          </div>

          <input style={inputStyle} placeholder="제목 (예: 토요일 오전 같이 치실 분!)" value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea style={{ ...inputStyle, resize: "none" }} rows={3} placeholder="내용 (실력대, 비용, 준비물 등)"
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1.2 }} type="date" value={draft.meet_date}
              onChange={(e) => setDraft({ ...draft, meet_date: e.target.value })} />
            <input style={{ ...inputStyle, flex: 1 }} type="number" placeholder="모집 인원" min="1" value={draft.max_people}
              onChange={(e) => setDraft({ ...draft, max_people: e.target.value })} />
          </div>
          <input style={inputStyle} placeholder="장소 (예: 장충 테니스장)" value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <div style={{ fontSize: 12.5, color: C.sub2, margin: "0 2px 10px" }}>
            날짜를 정하면 우리 단체 부원들의 [일정] 캘린더에 자동으로 표시돼요.
          </div>

          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: "6px 2px 8px" }}>공개 범위</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button onClick={() => setDraft({ ...draft, visibility: "org" })} style={{
              flex: 1, border: draft.visibility === "org" ? `2px solid ${C.text}` : `1px solid ${C.border}`,
              background: "#fff", borderRadius: 12, padding: "12px 8px", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 5 }}><Building2 size={14} /> 우리 단체만</div>
              <div style={{ fontSize: 11.5, color: C.sub2, marginTop: 3 }}>{org.name} 부원에게만 보여요</div>
            </button>
            <button onClick={() => setDraft({ ...draft, visibility: "public" })} style={{
              flex: 1, border: draft.visibility === "public" ? `2px solid ${C.blue}` : `1px solid ${C.border}`,
              background: "#fff", borderRadius: 12, padding: "12px 8px", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.blue, display: "flex", alignItems: "center", gap: 5 }}><Globe2 size={14} /> 전체 공개</div>
              <div style={{ fontSize: 11.5, color: C.sub2, marginTop: 3 }}>다른 동아리도 보고 참여할 수 있어요</div>
            </button>
          </div>

          <Btn onClick={submit} loading={busy}>올리기</Btn>
          </>
          )}
        </Modal>
      )}
    </div>
  );
}
