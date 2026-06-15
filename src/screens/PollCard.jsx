import { useState } from "react";
import { BarChart3, Check, Trash2, Users } from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Avatar, useToast } from "../ui.jsx";

// poll: { id, question, options[], multi, author_name, author_id }
// votes: 이 투표의 poll_votes 배열 [{ user_id, user_name, option_index }]
export default function PollCard({ poll, votes, uid, memberCount, isAdmin, reload, style }) {
  const toast = useToast();
  const myVotes = votes.filter((v) => v.user_id === uid).map((v) => v.option_index);
  const [sel, setSel] = useState(myVotes);
  const [busy, setBusy] = useState(false);
  const [showVoters, setShowVoters] = useState(false);

  const voters = new Set(votes.map((v) => v.user_id));
  const changed = sel.slice().sort().join(",") !== myVotes.slice().sort().join(",");

  const toggle = (i) => {
    if (poll.multi) setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]);
    else setSel([i]);
  };

  const submit = async () => {
    if (!sel.length) { toast("항목을 선택해주세요"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("vote_poll", { p_poll: poll.id, p_options: sel });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("투표했어요 🗳️"); reload && reload();
  };

  const remove = async () => {
    if (!confirm("이 투표를 삭제할까요?")) return;
    const { error } = await supabase.from("polls").delete().eq("id", poll.id);
    if (error) toast(error.message); else { toast("투표를 삭제했어요"); reload && reload(); }
  };

  const total = voters.size;
  return (
    <Card style={{ marginBottom: 12, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ background: C.blueLight, color: C.blue, borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <BarChart3 size={11} /> 투표{poll.multi ? " · 복수" : ""}
        </span>
        <div style={{ flex: 1 }} />
        {(isAdmin || poll.author_id === uid) && <Trash2 size={15} color={C.sub2} style={{ cursor: "pointer" }} onClick={remove} />}
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: "10px 0 4px" }}>{poll.question}</div>
      <div style={{ fontSize: 12.5, color: C.sub2, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
        <Users size={12} /> {memberCount}명 중 {total}명 참여
        {votes.length > 0 && (
          <span onClick={() => setShowVoters(!showVoters)} style={{ color: C.blue, fontWeight: 700, cursor: "pointer", marginLeft: 6 }}>
            {showVoters ? "투표자 숨기기" : "누가 투표했는지 보기"}
          </span>
        )}
      </div>

      {poll.options.map((opt, i) => {
        const optVotes = votes.filter((v) => v.option_index === i);
        const pct = total ? Math.round((optVotes.length / total) * 100) : 0;
        const picked = sel.includes(i);
        return (
          <div key={i} onClick={() => toggle(i)} style={{
            position: "relative", border: `1.5px solid ${picked ? C.blue : C.border}`, borderRadius: 12,
            padding: "11px 13px", marginBottom: 8, cursor: "pointer", overflow: "hidden", background: "#fff",
          }}>
            <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: picked ? C.blueLight : C.bg, transition: "width .4s ease" }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 18, height: 18, borderRadius: poll.multi ? 5 : "50%", flexShrink: 0,
                border: `2px solid ${picked ? C.blue : C.sub2}`, background: picked ? C.blue : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{picked && <Check size={11} color="#fff" />}</div>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.text }}>{opt}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.sub }}>{optVotes.length}표 · {pct}%</span>
            </div>
            {showVoters && optVotes.length > 0 && (
              <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {optVotes.map((v) => (
                  <span key={v.user_id} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "2px 8px 2px 3px", fontSize: 11.5, fontWeight: 600, color: C.sub }}>
                    <Avatar name={v.user_name} size={16} />{v.user_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {changed && (
        <button onClick={submit} disabled={busy} style={{
          width: "100%", border: "none", background: C.blue, color: "#fff", borderRadius: 12, padding: "12px 0",
          fontSize: 14.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", marginTop: 2, opacity: busy ? 0.5 : 1,
        }}>{myVotes.length ? "투표 변경하기" : "투표하기"}</button>
      )}
    </Card>
  );
}
