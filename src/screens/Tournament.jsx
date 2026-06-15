import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import {
  ChevronLeft, Plus, Trash2, Trophy, Users, Pencil, Bell, MapPin, Megaphone, Send, Activity,
} from "lucide-react";
import { supabase } from "../supabase.js";
import { C, Card, Btn, Modal, SectionTitle, inputStyle, useToast, Confetti } from "../ui.jsx";
import {
  FORMAT_LABEL, buildBracket, buildGroups, standings, tieAgg, currentMatch, progress, courtSchedule,
  matchPlayers, matchScoreText, slotLabel,
} from "../lib/tournament.js";

export default function TournamentScreen({ tournamentId, orgId, uid, isAdmin, members, onBack }) {
  const [tour, setTour] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [ties, setTies] = useState([]);
  const [matches, setMatches] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selTie, setSelTie] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const nameOf = useCallback((id) => members.find((m) => m.user_id === id)?.profiles?.name || "?", [members]);

  const reload = useCallback(async () => {
    const [{ data: t }, { data: tm }, { data: tmem }, { data: ti }, { data: mt }, { data: po }] = await Promise.all([
      supabase.from("tournaments").select("*").eq("id", tournamentId).maybeSingle(),
      supabase.from("tournament_teams").select("*").eq("tournament_id", tournamentId).order("seed"),
      supabase.from("tournament_team_members").select("*").eq("tournament_id", tournamentId),
      supabase.from("tournament_ties").select("*").eq("tournament_id", tournamentId).order("round").order("bracket_index"),
      supabase.from("tournament_matches").select("*").eq("tournament_id", tournamentId).order("order_index"),
      supabase.from("tournament_posts").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: false }),
    ]);
    setTour(t); setTeams(tm || []); setTeamMembers(tmem || []); setTies(ti || []); setMatches(mt || []); setPosts(po || []);
    setLoaded(true);
  }, [tournamentId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const ch = supabase.channel("tour-" + tournamentId)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_ties", filter: `tournament_id=eq.${tournamentId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches", filter: `tournament_id=eq.${tournamentId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_teams", filter: `tournament_id=eq.${tournamentId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_posts", filter: `tournament_id=eq.${tournamentId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` }, reload)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tournamentId, reload]);

  // 내 팀이 진출/우승하면 축하 이펙트 (훅은 조기 반환보다 위에 있어야 함 — Rules of Hooks)
  const wonRef = useRef(null);
  const [celebrate, setCelebrate] = useState(null);
  useEffect(() => {
    if (!tour) return;
    const myTeamIds = new Set(teamMembers.filter((m) => m.user_id === uid).map((m) => m.team_id));
    const won = ties.filter((t) => t.stage === "knockout" && t.status === "done" && myTeamIds.has(t.winner_team_id)).length;
    const finalT = ties.find((t) => t.stage === "knockout" && t.label === "결승");
    const champ = finalT?.status === "done" && myTeamIds.has(finalT.winner_team_id);
    if (wonRef.current !== null && won > wonRef.current) {
      setCelebrate(champ ? "🏆 우승을 축하해요!" : "🎉 다음 라운드 진출!");
    }
    wonRef.current = won;
  }, [ties, teamMembers, uid, tour]);
  useEffect(() => {
    if (!celebrate) return;
    const id = setTimeout(() => setCelebrate(null), 4000);
    return () => clearTimeout(id);
  }, [celebrate]);

  if (!loaded) return <div style={{ padding: 40, textAlign: "center", color: C.sub2 }}>불러오는 중...</div>;
  if (!tour) return (
    <div style={{ padding: 20 }}>
      <BackBar onBack={onBack} />
      <Card><div style={{ textAlign: "center", color: C.sub2, padding: 20 }}>대회를 찾을 수 없어요</div></Card>
    </div>
  );

  const teamMemberIds = (teamId) => teamMembers.filter((m) => m.team_id === teamId).map((m) => m.user_id);
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const isCaptainOf = (teamId) => teamById[teamId]?.captain_id === uid;
  const canPostNotice = isAdmin || teams.some((t) => t.captain_id === uid);
  const courts = tour.courts || [];
  const prog = progress(matches);

  /* 내 차례 찾기 — 코트가 있으면 코트 스케줄 기준, 없으면 진행 중 대진의 현재 게임 */
  const sched = courts.length ? courtSchedule(courts, ties, matches) : [];
  let myTurn = null;
  if (courts.length) {
    for (const s of sched) {
      if (s.game && [...matchPlayers(s.game, "a"), ...matchPlayers(s.game, "b")].includes(uid)) {
        myTurn = { tie: s.tie, match: s.game, court: s.court }; break;
      }
    }
  } else {
    for (const tie of ties.filter((t) => t.status === "ongoing")) {
      const cm = currentMatch(tie, matches);
      if (cm && [...matchPlayers(cm, "a"), ...matchPlayers(cm, "b")].includes(uid)) {
        myTurn = { tie, match: cm }; break;
      }
    }
  }

  const tieMatches = (tieId) => matches.filter((m) => m.tie_id === tieId).sort((a, b) => a.order_index - b.order_index);

  /* ── 대진표 생성 ── */
  const generate = async () => {
    if (teams.length < 2) { toast("팀이 2팀 이상이어야 해요"); return; }
    setBusy(true);
    const sorted = [...teams].sort((a, b) => a.seed - b.seed);
    let p_stage, p_groups, p_ties;
    if (tour.format === "knockout") {
      ({ ties: p_ties } = buildBracket(tour, sorted.map((t) => t.id), "knockout"));
      p_stage = "knockout"; p_groups = null;
    } else {
      ({ groups: p_groups, ties: p_ties } = buildGroups(tour, sorted));
      p_stage = "group";
    }
    const { error } = await supabase.rpc("seed_bracket", { p_tour: tour.id, p_stage, p_groups, p_ties });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("대진표를 생성했어요 🎾");
    reload();
  };

  const genKnockout = async () => {
    const labels = [...new Set(teams.map((t) => t.group_label).filter(Boolean))].sort();
    const perGroup = labels.map((l) => standings(teams, ties, matches, l).slice(0, tour.advance_per_group));
    const ordered = [];
    for (let r = 0; r < tour.advance_per_group; r++) {
      const row = perGroup.map((g) => g[r]).filter(Boolean).map((s) => s.team.id);
      if (r % 2 === 1) row.reverse();
      ordered.push(...row);
    }
    if (ordered.length < 2) { toast("본선 진출 팀이 부족해요"); return; }
    setBusy(true);
    const { ties: kties } = buildBracket(tour, ordered, "knockout");
    const { error } = await supabase.rpc("seed_bracket", { p_tour: tour.id, p_stage: "knockout", p_groups: null, p_ties: kties });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast("본선 토너먼트를 생성했어요 🏆");
    reload();
  };

  const groupLabels = [...new Set(teams.map((t) => t.group_label).filter(Boolean))].sort();
  const groupDone = ties.filter((t) => t.stage === "group").length > 0
    && ties.filter((t) => t.stage === "group").every((t) => t.status === "done");
  const knockoutTies = ties.filter((t) => t.stage === "knockout");

  return (
    <div>
      {celebrate && <Confetti message={celebrate} />}
      <BackBar onBack={onBack} />

      {/* 헤더 */}
      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: C.orangeLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Trophy size={24} color={C.orange} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{tour.title}</div>
          <div style={{ fontSize: 13, color: C.sub2, marginTop: 2 }}>
            {FORMAT_LABEL[tour.format]} · {teams.length}팀 · 단식 {tour.num_singles} 복식 {tour.num_doubles}
          </div>
        </div>
      </Card>

      {/* 전체 진행률 */}
      {tour.stage !== "setup" && prog.total > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>대회 진행률</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.blue }}>{prog.pct}%</span>
          </div>
          <div style={{ height: 8, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${prog.pct}%`, height: "100%", background: C.blue, borderRadius: 4, transition: "width .4s ease" }} />
          </div>
          <div style={{ fontSize: 12, color: C.sub2, marginTop: 6 }}>{prog.done} / {prog.total} 경기 완료</div>
        </Card>
      )}

      {/* 내 차례 배너 */}
      {myTurn && (
        <Card style={{ marginTop: 12, background: C.blue, color: "#fff", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
          onClick={() => setSelTie(myTurn.tie.id)}>
          <Bell size={20} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>지금 당신 차례예요!{myTurn.court ? ` · ${myTurn.court}` : ""}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>
              {teamById[myTurn.tie.team_a_id]?.name} vs {teamById[myTurn.tie.team_b_id]?.name} · {slotLabel(myTurn.match)}
            </div>
          </div>
        </Card>
      )}

      {/* 코트별 지금 칠 경기 */}
      {tour.stage !== "setup" && courts.length > 0 && (
        <CourtBoard sched={sched} teamById={teamById} matches={matches} uid={uid} nameOf={nameOf} onTie={setSelTie} />
      )}

      {/* 공지 */}
      {tour.stage !== "setup" && (
        <NoticeSection posts={posts} canPost={canPostNotice} isAdmin={isAdmin} uid={uid} tournamentId={tournamentId} reload={reload} toast={toast} />
      )}

      {/* setup 단계 */}
      {tour.stage === "setup" && (
        isAdmin
          ? <SetupView tour={tour} teams={teams} teamMemberIds={teamMemberIds} members={members}
              nameOf={nameOf} onGenerate={generate} busy={busy} reload={reload} toast={toast} />
          : <Card style={{ marginTop: 12, textAlign: "center", padding: "40px 20px", color: C.sub2 }}>
              <Users size={28} color={C.sub2} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>대진표 준비 중</div>
              <div style={{ fontSize: 13.5, marginTop: 4 }}>관리자가 팀 편성과 대진표를 준비하고 있어요.</div>
            </Card>
      )}

      {/* 조별 리그 */}
      {tour.stage !== "setup" && groupLabels.length > 0 && (
        <>
          {groupLabels.map((g) => (
            <div key={g}>
              <SectionTitle>{g}조 순위</SectionTitle>
              <StandingsTable rows={standings(teams, ties, matches, g)} uid={uid} teamMemberIds={teamMemberIds} />
              <div style={{ marginTop: 8 }}>
                {ties.filter((t) => t.stage === "group" && t.group_label === g).map((tie) => (
                  <TieRow key={tie.id} tie={tie} teamById={teamById} matches={matches} onClick={() => setSelTie(tie.id)} />
                ))}
              </div>
            </div>
          ))}
          {tour.format === "group_knockout" && knockoutTies.length === 0 && isAdmin && (
            <Btn onClick={genKnockout} loading={busy} disabled={!groupDone} style={{ marginTop: 16 }}>
              {groupDone ? "본선 토너먼트 생성하기 🏆" : "조별 예선이 모두 끝나면 본선을 만들 수 있어요"}
            </Btn>
          )}
        </>
      )}

      {/* 토너먼트 대진표 (시각화) */}
      {knockoutTies.length > 0 && (
        <>
          <SectionTitle>본선 대진표</SectionTitle>
          <Bracket ties={knockoutTies} teamById={teamById} matches={matches} uid={uid} teamMemberIds={teamMemberIds} onTie={setSelTie} />
        </>
      )}

      {/* 경기 결과 피드 */}
      {tour.stage !== "setup" && (
        <ResultFeed ties={ties} matches={matches} teamById={teamById} nameOf={nameOf} />
      )}

      {/* 대진 상세 */}
      {selTie && (
        <TieDetail
          tie={ties.find((t) => t.id === selTie)} tour={tour} teamById={teamById}
          matches={tieMatches(selTie)} teamMemberIds={teamMemberIds} nameOf={nameOf}
          isAdmin={isAdmin} isCaptainOf={isCaptainOf} uid={uid} reload={reload} toast={toast}
          onClose={() => setSelTie(null)}
        />
      )}
    </div>
  );
}

/* ───────── 팀 편성 ───────── */
function SetupView({ tour, teams, teamMemberIds, members, nameOf, onGenerate, busy, reload, toast }) {
  const initial = teams.length
    ? teams.map((t) => ({ name: t.name, captain_id: t.captain_id || "", member_ids: teamMemberIds(t.id) }))
    : Array.from({ length: tour.team_count }, (_, i) => ({ name: `팀 ${i + 1}`, captain_id: "", member_ids: [] }));
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const upd = (i, patch) => setDraft(draft.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const toggleMember = (i, uid) => {
    const d = draft[i];
    const has = d.member_ids.includes(uid);
    const member_ids = has ? d.member_ids.filter((x) => x !== uid) : [...d.member_ids, uid];
    upd(i, { member_ids, captain_id: has && d.captain_id === uid ? "" : d.captain_id });
  };

  const save = async () => {
    setSaving(true);
    const payload = draft.map((d) => ({ name: d.name, captain_id: d.captain_id || null, member_ids: d.member_ids }));
    const { error } = await supabase.rpc("set_tournament_teams", { p_tour: tour.id, p_teams: payload });
    setSaving(false);
    if (error) { toast(error.message); return; }
    toast("팀을 저장했어요");
    reload();
  };

  return (
    <>
      <SectionTitle right={
        <button onClick={() => setDraft([...draft, { name: `팀 ${draft.length + 1}`, captain_id: "", member_ids: [] }])}
          style={addBtn}><Plus size={13} /> 팀 추가</button>
      }>팀 편성 ({draft.length}팀)</SectionTitle>

      {draft.map((d, i) => (
        <Card key={i} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={d.name}
              onChange={(e) => upd(i, { name: e.target.value })} placeholder={`팀 ${i + 1} 이름`} />
            <button onClick={() => setDraft(draft.filter((_, j) => j !== i))} style={{ ...iconBtn, background: C.redLight }}>
              <Trash2 size={15} color={C.red} />
            </button>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>팀원 선택 ({d.member_ids.length}명)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {members.map((m) => {
              const on = d.member_ids.includes(m.user_id);
              return (
                <button key={m.user_id} onClick={() => toggleMember(i, m.user_id)} style={{
                  border: on ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`, background: on ? C.blueLight : "#fff",
                  color: on ? C.blue : C.sub, borderRadius: 18, padding: "5px 11px", fontSize: 12.5, fontWeight: 700,
                  fontFamily: "inherit", cursor: "pointer",
                }}>{m.profiles?.name}</button>
              );
            })}
          </div>
          {d.member_ids.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>조장</div>
              <select value={d.captain_id} onChange={(e) => upd(i, { captain_id: e.target.value })}
                style={{ ...inputStyle, marginBottom: 0, color: d.captain_id ? C.text : C.sub2 }}>
                <option value="">조장 선택 (오더·점수 입력 권한)</option>
                {d.member_ids.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
              </select>
            </div>
          )}
        </Card>
      ))}

      <Btn onClick={save} loading={saving} variant="gray" style={{ marginTop: 4 }}>팀 저장</Btn>
      <Btn onClick={onGenerate} loading={busy} style={{ marginTop: 10 }}>대진표 생성하기</Btn>
      <div style={{ fontSize: 12.5, color: C.sub2, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
        팀을 저장한 뒤 대진표를 생성하세요. 생성 후에는 팀·형식을 바꿀 수 없어요.
      </div>
    </>
  );
}

/* ───────── 순위표 ───────── */
function StandingsTable({ rows, teamMemberIds, uid }) {
  return (
    <Card style={{ padding: "6px 14px" }}>
      <div style={{ display: "flex", fontSize: 11.5, fontWeight: 700, color: C.sub2, padding: "8px 4px", borderBottom: `1px solid ${C.bg}` }}>
        <span style={{ width: 22 }}>#</span>
        <span style={{ flex: 1 }}>팀</span>
        <span style={{ width: 36, textAlign: "center" }}>승</span>
        <span style={{ width: 36, textAlign: "center" }}>매치</span>
        <span style={{ width: 44, textAlign: "center" }}>득실</span>
      </div>
      {rows.map((r, i) => {
        const mine = teamMemberIds(r.team.id).includes(uid);
        return (
          <div key={r.team.id} style={{ display: "flex", alignItems: "center", fontSize: 13.5, padding: "9px 4px", borderBottom: i < rows.length - 1 ? `1px solid ${C.bg}` : "none" }}>
            <span style={{ width: 22, fontWeight: 800, color: i === 0 ? C.orange : C.sub2 }}>{i + 1}</span>
            <span style={{ flex: 1, fontWeight: 700, color: mine ? C.blue : C.text }}>{r.team.name}{mine ? " (우리팀)" : ""}</span>
            <span style={{ width: 36, textAlign: "center", fontWeight: 700 }}>{r.tieW}</span>
            <span style={{ width: 36, textAlign: "center", color: C.sub }}>{r.mW}-{r.mL}</span>
            <span style={{ width: 44, textAlign: "center", color: C.sub }}>{r.gf - r.ga > 0 ? "+" : ""}{r.gf - r.ga}</span>
          </div>
        );
      })}
    </Card>
  );
}

/* ───────── 대진 행 ───────── */
function TieRow({ tie, teamById, matches, onClick }) {
  const a = teamById[tie.team_a_id]?.name || "미정";
  const b = teamById[tie.team_b_id]?.name || "미정";
  const ag = tieAgg(tie, matches);
  const done = tie.status === "done";
  const winA = tie.winner_team_id === tie.team_a_id;
  const winB = tie.winner_team_id === tie.team_b_id;
  return (
    <Card onClick={onClick} style={{ marginBottom: 8, cursor: "pointer", padding: "13px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: winA ? 800 : 600, color: winA ? C.blue : C.text, textAlign: "right" }}>
          {winA && "🏆 "}{a}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.sub2, minWidth: 40, textAlign: "center" }}>
          {ag.done > 0 || done ? `${ag.aw} : ${ag.bw}` : "vs"}
        </span>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: winB ? 800 : 600, color: winB ? C.blue : C.text }}>
          {b}{winB && " 🏆"}
        </span>
      </div>
      <div style={{ textAlign: "center", marginTop: 6, display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}>
        {tie.court && (
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px", background: "#F0EBFE", color: "#7B5CF0", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <MapPin size={10} /> {tie.court}{tie.play_order ? ` ${tie.play_order}번째` : ""}
          </span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 8px",
          background: done ? C.bg : tie.status === "ongoing" ? C.greenLight : C.bg,
          color: done ? C.sub2 : tie.status === "ongoing" ? C.green : C.sub2,
        }}>
          {done ? "경기 종료" : tie.status === "ongoing" ? `진행 중 ${ag.done}/${ag.total}` : "대기"}
        </span>
      </div>
    </Card>
  );
}

/* ───────── 대회 공지 ───────── */
function NoticeSection({ posts, canPost, isAdmin, uid, tournamentId, reload, toast }) {
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim()) { toast("내용을 입력해주세요"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("add_tournament_notice", { p_tour: tournamentId, p_body: body.trim() });
    setBusy(false);
    if (error) { toast(error.message); return; }
    setBody(""); setOpen(false); toast("공지를 올렸어요 📣"); reload();
  };
  const remove = async (id) => {
    const { error } = await supabase.rpc("delete_tournament_notice", { p_post: id });
    if (error) toast(error.message); else { toast("공지를 삭제했어요"); reload(); }
  };

  return (
    <>
      <SectionTitle right={canPost && (
        <button onClick={() => setOpen(!open)} style={addBtn}><Megaphone size={13} /> 공지 쓰기</button>
      )}>대회 공지</SectionTitle>
      {open && (
        <Card style={{ marginBottom: 10 }}>
          <textarea style={{ ...inputStyle, resize: "none", marginBottom: 8 }} rows={3} placeholder="부원들에게 공지할 내용"
            value={body} onChange={(e) => setBody(e.target.value)} />
          <Btn onClick={submit} loading={busy}><Send size={14} style={{ marginRight: 4 }} /> 공지 올리기</Btn>
        </Card>
      )}
      {posts.length === 0 ? (
        <Card><div style={{ color: C.sub2, fontSize: 13.5, textAlign: "center", padding: 8 }}>아직 공지가 없어요</div></Card>
      ) : posts.map((p) => (
        <Card key={p.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{p.body}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: C.sub2 }}>
            <Megaphone size={12} color={C.orange} /> {p.author_name}
            <div style={{ flex: 1 }} />
            {(isAdmin || p.author_id === uid) && (
              <Trash2 size={13} color={C.sub2} style={{ cursor: "pointer" }} onClick={() => remove(p.id)} />
            )}
          </div>
        </Card>
      ))}
    </>
  );
}

/* ───────── 코트별 "지금 칠 경기" 보드 ───────── */
function CourtBoard({ sched, teamById, matches, uid, nameOf, onTie }) {
  const nm = (id) => teamById[id]?.name || "미정";
  const names = (m, side) => { const ids = matchPlayers(m, side); return ids.length ? ids.map(nameOf).join("·") : "?"; };
  return (
    <>
      <SectionTitle>지금 칠 경기 (코트별)</SectionTitle>
      {sched.map(({ court, game, tie }) => {
        const mine = game && [...matchPlayers(game, "a"), ...matchPlayers(game, "b")].includes(uid);
        return (
          <Card key={court} onClick={() => tie && onTie(tie.id)}
            style={{ marginBottom: 8, cursor: tie ? "pointer" : "default", border: mine ? `1.5px solid ${C.blue}` : undefined, background: mine ? C.blueLight : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: game ? 8 : 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: "#7B5CF0", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MapPin size={13} /> {court}
              </span>
              {game && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.green }}>· {slotLabel(game)}</span>}
              {mine && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.blue }}>· 내 경기</span>}
            </div>
            {game ? (
              <>
                <div style={{ fontSize: 13, color: C.sub2 }}>{tie.label} · {nm(tie.team_a_id)} vs {nm(tie.team_b_id)}</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, marginTop: 4 }}>
                  {names(game, "a")} <span style={{ color: C.sub2, fontWeight: 600 }}>vs</span> {names(game, "b")}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: C.sub2 }}>대기 중 — 칠 경기가 없어요</div>
            )}
          </Card>
        );
      })}
    </>
  );
}

/* ───────── 경기 결과 피드 ───────── */
function ResultFeed({ ties, matches, teamById, nameOf }) {
  const tieById = Object.fromEntries(ties.map((t) => [t.id, t]));
  const done = matches.filter((m) => m.status === "done" && m.decided_at)
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at))).slice(0, 8);
  if (done.length === 0) return null;
  return (
    <>
      <SectionTitle>최근 경기 결과</SectionTitle>
      <Card style={{ padding: "6px 16px" }}>
        {done.map((m, i) => {
          const tie = tieById[m.tie_id];
          const aNames = matchPlayers(m, "a").map(nameOf).join(", ");
          const bNames = matchPlayers(m, "b").map(nameOf).join(", ");
          return (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: i < done.length - 1 ? `1px solid ${C.bg}` : "none" }}>
              <Activity size={14} color={C.sub2} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.sub2 }}>{tie?.label} · {slotLabel(m)}</div>
                <div style={{ fontSize: 13.5, color: C.text, fontWeight: 600 }}>
                  <span style={{ color: m.winner === "a" ? C.blue : C.text, fontWeight: m.winner === "a" ? 800 : 600 }}>{aNames || "?"}</span>
                  {" vs "}
                  <span style={{ color: m.winner === "b" ? C.blue : C.text, fontWeight: m.winner === "b" ? 800 : 600 }}>{bNames || "?"}</span>
                </div>
              </div>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{matchScoreText(m)}</span>
            </div>
          );
        })}
      </Card>
    </>
  );
}

/* ───────── 토너먼트 대진표 시각화 (연결선 + 내 팀 강조) ───────── */
const MINE_BG = "#E5F9F1", MINE_COLOR = "#00A661"; // 내 팀 = 초록 강조

function Bracket({ ties, teamById, matches, uid, teamMemberIds, onTie }) {
  const rounds = [...new Set(ties.map((t) => t.round))].sort((a, b) => a - b);
  const nm = (id) => teamById[id]?.name || "미정";
  const mine = (teamId) => teamId && teamMemberIds(teamId).includes(uid);

  const wrapRef = useRef(null);
  const tieEls = useRef({});
  const [lines, setLines] = useState([]);

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const out = [];
    ties.forEach((t) => {
      if (!t.next_tie_id) return;
      const from = tieEls.current[t.id], to = tieEls.current[t.next_tie_id];
      if (!from || !to) return;
      const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
      const x1 = fr.right - base.left, y1 = fr.top + fr.height / 2 - base.top;
      const x2 = tr.left - base.left, y2 = tr.top + tr.height / 2 - base.top;
      const won = t.winner_team_id && mine(t.winner_team_id);
      out.push({ x1, y1, x2, y2, won, key: t.id });
    });
    setLines(out);
  }, [ties, teamById]); // eslint-disable-line

  useLayoutEffect(() => { recompute(); }, [recompute, matches]);
  useEffect(() => {
    const on = () => recompute();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [recompute]);

  return (
    <div style={{ overflowX: "auto", paddingBottom: 8 }}>
      <div ref={wrapRef} style={{ position: "relative", display: "flex", gap: 28, minWidth: "min-content", padding: "0 4px" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
          {lines.map((l) => {
            const mid = (l.x1 + l.x2) / 2;
            return (
              <path key={l.key} d={`M ${l.x1} ${l.y1} H ${mid} V ${l.y2} H ${l.x2}`}
                fill="none" stroke={l.won ? MINE_COLOR : C.border} strokeWidth={l.won ? 2.5 : 1.5} />
            );
          })}
        </svg>
        {rounds.map((rd) => (
          <div key={rd} style={{ minWidth: 148, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.sub2, textAlign: "center", marginBottom: 10 }}>
              {ties.find((t) => t.round === rd)?.label || `${rd}R`}
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 12, flex: 1 }}>
              {ties.filter((t) => t.round === rd).sort((a, b) => (a.bracket_index || 0) - (b.bracket_index || 0)).map((tie) => {
                const ag = tieAgg(tie, matches);
                const winA = tie.winner_team_id === tie.team_a_id;
                const winB = tie.winner_team_id === tie.team_b_id;
                const row = (teamId, win, score) => {
                  const isMine = mine(teamId);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 9px",
                      background: isMine ? MINE_BG : win ? C.blueLight : "#fff", borderRadius: 6 }}>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: win || isMine ? 800 : 600,
                        color: isMine ? MINE_COLOR : win ? C.blue : C.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {win && "🏆 "}{nm(teamId)}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.sub2 }}>{score}</span>
                    </div>
                  );
                };
                const involvesMine = mine(tie.team_a_id) || mine(tie.team_b_id);
                return (
                  <div key={tie.id} ref={(el) => (tieEls.current[tie.id] = el)} onClick={() => onTie(tie.id)}
                    style={{ cursor: "pointer", border: `1.5px solid ${involvesMine ? MINE_COLOR : C.border}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                    {row(tie.team_a_id, winA, tie.status !== "pending" ? ag.aw : "")}
                    <div style={{ height: 1, background: C.bg }} />
                    {row(tie.team_b_id, winB, tie.status !== "pending" ? ag.bw : "")}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── 대진 상세 (오더·점수) ───────── */
function TieDetail({ tie, tour, teamById, matches, teamMemberIds, nameOf, isAdmin, isCaptainOf, uid, reload, toast, onClose }) {
  const [orderSide, setOrderSide] = useState(null); // 'a'|'b'
  const [scoreMatch, setScoreMatch] = useState(null);
  if (!tie) return null;

  const teamA = teamById[tie.team_a_id], teamB = teamById[tie.team_b_id];
  const bothReady = teamA && teamB;
  const canA = isAdmin || isCaptainOf(tie.team_a_id);
  const canB = isAdmin || isCaptainOf(tie.team_b_id);
  const tied = tie.status === "done" && !tie.winner_team_id;

  // 오더 공개 규칙: 양 팀 모두 제출하면 공개. 그 전엔 자기 팀(조장)·관리자만.
  const revealed = tie.a_submitted && tie.b_submitted;
  const canSee = (side) => revealed || isAdmin || (side === "a" ? isCaptainOf(tie.team_a_id) : isCaptainOf(tie.team_b_id));
  const submitted = (side) => (side === "a" ? tie.a_submitted : tie.b_submitted);

  const playerNames = (m, side) => {
    if (!canSee(side)) return submitted(side) ? "오더 제출됨 (비공개)" : "오더 작성 중";
    const ids = matchPlayers(m, side);
    return ids.length ? ids.map(nameOf).join(", ") : "오더 미정";
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 4 }}>
        {teamA?.name || "미정"} vs {teamB?.name || "미정"}
      </div>
      <div style={{ fontSize: 13, color: C.sub2, marginBottom: 14 }}>
        {tie.label}{tie.court ? ` · ${tie.court}${tie.play_order ? ` ${tie.play_order}번째` : ""}` : ""}
      </div>

      {!bothReady && (
        <div style={{ fontSize: 13.5, color: C.sub2, background: C.bg, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
          아직 양 팀이 확정되지 않았어요. 이전 경기가 끝나면 자동으로 채워져요.
        </div>
      )}

      {/* 오더 제출 상태 */}
      {bothReady && tie.status !== "done" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["a", "b"].map((side) => {
            const tm = side === "a" ? teamA : teamB;
            return (
              <div key={side} style={{
                flex: 1, borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, textAlign: "center",
                background: submitted(side) ? C.greenLight : C.bg, color: submitted(side) ? C.green : C.sub2,
              }}>
                {tm?.name}: {submitted(side) ? "제출 완료" : "작성 중"}
              </div>
            );
          })}
        </div>
      )}
      {bothReady && tie.status !== "done" && !revealed && (
        <div style={{ fontSize: 12.5, color: C.sub2, marginBottom: 12, textAlign: "center" }}>
          🔒 양 팀이 모두 제출하면 오더가 서로에게 공개돼요
        </div>
      )}

      {/* 오더 입력 버튼 */}
      {bothReady && tie.status !== "done" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {canA && !tie.a_submitted && <button onClick={() => setOrderSide("a")} style={orderBtn}><Pencil size={12} /> {teamA.name} 오더 내기</button>}
          {canB && !tie.b_submitted && <button onClick={() => setOrderSide("b")} style={orderBtn}><Pencil size={12} /> {teamB.name} 오더 내기</button>}
          {isAdmin && tie.a_submitted && <button onClick={async () => { const { error } = await supabase.rpc("unlock_order", { p_tie: tie.id, p_side: "a" }); error ? toast(error.message) : reload(); }} style={orderBtn}>{teamA.name} 오더 수정</button>}
          {isAdmin && tie.b_submitted && <button onClick={async () => { const { error } = await supabase.rpc("unlock_order", { p_tie: tie.id, p_side: "b" }); error ? toast(error.message) : reload(); }} style={orderBtn}>{teamB.name} 오더 수정</button>}
        </div>
      )}

      {/* 경기 목록 */}
      {matches.map((m) => {
        const mine = [...(canSee("a") ? matchPlayers(m, "a") : []), ...(canSee("b") ? matchPlayers(m, "b") : [])].includes(uid);
        const canScore = (isAdmin || canA || canB) && revealed && matchPlayers(m, "a").length && matchPlayers(m, "b").length;
        return (
          <div key={m.id} style={{
            border: `1px solid ${mine ? C.blue : C.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8,
            background: mine ? C.blueLight : "#fff",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.blue }}>{slotLabel(m)}</span>
              {mine && <span style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>· 내 경기</span>}
              <div style={{ flex: 1 }} />
              {m.status === "done"
                ? <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{matchScoreText(m)}</span>
                : <span style={{ fontSize: 11.5, color: C.sub2 }}>미입력</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", fontSize: 13.5 }}>
              <span style={{ flex: 1, textAlign: "right", fontWeight: m.winner === "a" ? 800 : 600, color: m.winner === "a" ? C.blue : C.text }}>
                {playerNames(m, "a")}
              </span>
              <span style={{ color: C.sub2, padding: "0 10px", fontSize: 12 }}>vs</span>
              <span style={{ flex: 1, fontWeight: m.winner === "b" ? 800 : 600, color: m.winner === "b" ? C.blue : C.text }}>
                {playerNames(m, "b")}
              </span>
            </div>
            {bothReady && tie.status !== "done" && canScore && (
              <button onClick={() => setScoreMatch(m)} style={{ ...scoreBtn, marginTop: 10 }}>
                {m.status === "done" ? "점수 수정" : "점수 입력"}
              </button>
            )}
            {m.status === "done" && isAdmin && (
              <button onClick={async () => {
                const { error } = await supabase.rpc("reset_match", { p_match: m.id });
                if (error) toast(error.message); else { toast("점수를 초기화했어요"); reload(); }
              }} style={{ ...scoreBtn, marginTop: 8, background: C.redLight, color: C.red }}>점수 초기화</button>
            )}
          </div>
        );
      })}

      {/* 완전 동점 → 관리자 수동 판정 */}
      {tied && isAdmin && (
        <div style={{ marginTop: 10, background: C.orangeLight, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.orange, marginBottom: 8 }}>완전 동점이에요. 승리 팀을 지정해주세요.</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[teamA, teamB].map((tm) => (
              <button key={tm.id} onClick={async () => {
                const { error } = await supabase.rpc("set_tie_winner", { p_tie: tie.id, p_team: tm.id });
                if (error) toast(error.message); else { toast(`${tm.name} 승리로 처리했어요`); reload(); }
              }} style={{ ...orderBtn, flex: 1, justifyContent: "center" }}>{tm.name} 승</button>
            ))}
          </div>
        </div>
      )}

      {orderSide && (
        <OrderModal tie={tie} side={orderSide} team={orderSide === "a" ? teamA : teamB}
          matches={matches} teamMemberIds={teamMemberIds} nameOf={nameOf}
          onClose={() => setOrderSide(null)} reload={reload} toast={toast} />
      )}
      {scoreMatch && (
        <ScoreModal match={scoreMatch} tour={tour} onClose={() => setScoreMatch(null)} reload={reload} toast={toast} />
      )}
    </Modal>
  );
}

/* ───────── 오더지 입력 ───────── */
function OrderModal({ tie, side, team, matches, teamMemberIds, nameOf, onClose, reload, toast }) {
  const roster = teamMemberIds(team.id);
  const [assign, setAssign] = useState(() =>
    Object.fromEntries(matches.map((m) => [m.id, [...matchPlayers(m, side)]])));
  const [saving, setSaving] = useState(false);

  const need = (m) => (m.slot_type === "singles" ? 1 : 2);
  const toggle = (mId, pid) => {
    const cur = assign[mId] || [];
    const max = need(matches.find((m) => m.id === mId));
    let next;
    if (cur.includes(pid)) next = cur.filter((x) => x !== pid);
    else if (cur.length >= max) next = [...cur.slice(1), pid];
    else next = [...cur, pid];
    setAssign({ ...assign, [mId]: next });
  };

  const save = async () => {
    for (const m of matches) {
      const sel = assign[m.id] || [];
      if (sel.length !== need(m)) { toast(`${slotLabel(m)}: ${need(m)}명을 선택해주세요`); return; }
    }
    const payload = matches.map((m) => ({ match_id: m.id, players: assign[m.id] }));
    setSaving(true);
    const { error } = await supabase.rpc("submit_order", { p_tie: tie.id, p_side: side, p_assign: payload });
    setSaving(false);
    if (error) { toast(error.message); return; }
    toast("오더를 제출했어요 ✍️ 상대도 제출하면 공개돼요");
    reload(); onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 4 }}>{team.name} 오더지</div>
      <div style={{ fontSize: 13, color: C.sub2, marginBottom: 14 }}>
        모든 경기에 출전 선수를 채워 제출하세요. 한 선수가 여러 경기에 나갈 수 있어요.
        제출하면 상대 팀이 제출할 때까지 비공개이고, 제출 후엔 수정할 수 없어요(관리자만 가능).
      </div>
      {matches.map((m) => (
        <div key={m.id} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.blue, marginBottom: 6 }}>
            {slotLabel(m)} <span style={{ color: C.sub2, fontWeight: 600 }}>({need(m)}명)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {roster.map((pid) => {
              const on = (assign[m.id] || []).includes(pid);
              return (
                <button key={pid} onClick={() => toggle(m.id, pid)} style={{
                  border: on ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`, background: on ? C.blueLight : "#fff",
                  color: on ? C.blue : C.sub, borderRadius: 18, padding: "6px 12px", fontSize: 13, fontWeight: 700,
                  fontFamily: "inherit", cursor: "pointer",
                }}>{nameOf(pid)}</button>
              );
            })}
          </div>
        </div>
      ))}
      <Btn onClick={save} loading={saving}>오더 제출</Btn>
    </Modal>
  );
}

/* ───────── 점수 입력 ───────── */
function ScoreModal({ match, tour, onClose, reload, toast }) {
  const [ga, setGa] = useState(match.games_a ?? "");
  const [gb, setGb] = useState(match.games_b ?? "");
  const [tba, setTba] = useState(match.tb_a ?? "");
  const [tbb, setTbb] = useState(match.tb_b ?? "");
  const [saving, setSaving] = useState(false);

  const na = Number(ga), nb = Number(gb);
  const needTB = (na === tour.tiebreak_at && nb === tour.games_to_win) || (nb === tour.tiebreak_at && na === tour.games_to_win);

  const save = async () => {
    if (ga === "" || gb === "") { toast("게임 점수를 입력해주세요"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("record_match", {
      p_match: match.id, p_ga: na, p_gb: nb,
      p_tba: needTB && tba !== "" ? Number(tba) : null,
      p_tbb: needTB && tbb !== "" ? Number(tbb) : null,
    });
    setSaving(false);
    if (error) { toast(error.message); return; }
    toast("점수를 저장했어요 🎾");
    reload(); onClose();
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 4 }}>{slotLabel(match)} 점수</div>
      <div style={{ fontSize: 12.5, color: C.sub2, marginBottom: 16, lineHeight: 1.5 }}>
        {tour.games_to_win}게임 선취 · {tour.tiebreak_at}-{tour.tiebreak_at}이면 {tour.tiebreak_points}점 타이브레이크
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.sub }}>A팀 게임</span>
        <input type="number" min="0" max={tour.games_to_win} style={{ ...inputStyle, marginBottom: 0, width: 70, textAlign: "center" }}
          value={ga} onChange={(e) => setGa(e.target.value)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: needTB ? 8 : 4 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.sub }}>B팀 게임</span>
        <input type="number" min="0" max={tour.games_to_win} style={{ ...inputStyle, marginBottom: 0, width: 70, textAlign: "center" }}
          value={gb} onChange={(e) => setGb(e.target.value)} />
      </div>
      {needTB && (
        <div style={{ background: C.orangeLight, borderRadius: 12, padding: "12px 14px", margin: "8px 0 4px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.orange, marginBottom: 8 }}>타이브레이크 점수</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.sub }}>A팀</span>
            <input type="number" min="0" style={{ ...inputStyle, marginBottom: 0, width: 70, textAlign: "center" }}
              value={tba} onChange={(e) => setTba(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.sub }}>B팀</span>
            <input type="number" min="0" style={{ ...inputStyle, marginBottom: 0, width: 70, textAlign: "center" }}
              value={tbb} onChange={(e) => setTbb(e.target.value)} />
          </div>
        </div>
      )}
      <Btn onClick={save} loading={saving} style={{ marginTop: 12 }}>저장하기</Btn>
    </Modal>
  );
}

/* ───────── 공통 ───────── */
function BackBar({ onBack }) {
  return (
    <div onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: C.sub, fontSize: 14.5, fontWeight: 700, cursor: "pointer", margin: "4px 4px 12px" }}>
      <ChevronLeft size={18} /> 일정으로
    </div>
  );
}

const addBtn = {
  border: "none", background: C.blueLight, color: C.blue, borderRadius: 10, padding: "6px 11px",
  fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
};
const iconBtn = { border: "none", borderRadius: 10, width: 42, height: 42, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const orderBtn = {
  border: `1px solid ${C.border}`, background: "#fff", color: C.sub, borderRadius: 10, padding: "8px 12px",
  fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
};
const scoreBtn = {
  width: "100%", border: "none", background: C.blue, color: "#fff", borderRadius: 10, padding: "10px 0",
  fontSize: 13.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
};
