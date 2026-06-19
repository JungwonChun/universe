import { useState, useEffect, useCallback, useRef, Component } from "react";
import { Home, MessagesSquare, CalendarDays, UserRound } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { supabase, configured } from "./supabase.js";
import { C, FONT, ToastProvider, Avatar } from "./ui.jsx";
import { ymd } from "./lib/schedule.js";
import AuthScreen from "./screens/Auth.jsx";
import OnboardingScreen from "./screens/Onboarding.jsx";
import HomeScreen from "./screens/Home.jsx";
import ScheduleScreen from "./screens/Schedule.jsx";
import CommunityScreen from "./screens/Community.jsx";
import MoreScreen from "./screens/More.jsx";
import TournamentScreen from "./screens/Tournament.jsx";

const TABS = [
  { id: "home", label: "홈", icon: Home },
  { id: "schedule", label: "일정", icon: CalendarDays },
  { id: "community", label: "모집", icon: MessagesSquare },
  { id: "more", label: "전체", icon: UserRound },
];

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[Universe] 화면 오류:", error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div style={{ padding: 20, fontFamily: FONT }}>
          <div style={{ background: "#FDEDEE", border: "1px solid #F04452", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F04452", marginBottom: 8 }}>⚠️ 화면을 그리는 중 오류가 났어요</div>
            <div style={{ fontSize: 13, color: "#191F28", fontWeight: 700, marginBottom: 6 }}>{String(e.message || e)}</div>
            <pre style={{ fontSize: 11, color: "#4E5968", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 220, overflow: "auto", background: "#fff", borderRadius: 8, padding: 10, margin: 0 }}>
              {String(e.stack || "").slice(0, 1500)}
            </pre>
            <button onClick={() => location.reload()} style={{ marginTop: 12, border: "none", background: "#3182F6", color: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function GlobalStyle() {
  return (
    <style>{`
      * { -webkit-tap-highlight-color: transparent; }
      body { overscroll-behavior-y: none; }
      @keyframes slideUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes toastIn { from { transform: translateY(-12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      input, textarea, select { font-family: inherit; }
    `}</style>
  );
}

export default function App() {
  if (!configured) {
    return (
      <div style={{ fontFamily: FONT, padding: 32, maxWidth: 480, margin: "0 auto", color: C.text }}>
        <h2>환경 변수가 필요해요</h2>
        <p style={{ color: C.sub, lineHeight: 1.6 }}>
          <code>.env</code> 파일(또는 Vercel 환경 변수)에 <code>VITE_SUPABASE_URL</code>과{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>를 설정한 뒤 다시 빌드해 주세요. README의 배포 가이드를 참고하세요.
        </p>
      </div>
    );
  }
  return (
    <ToastProvider>
      <GlobalStyle />
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [session, setSession] = useState(undefined); // undefined = 확인 중
  const [profile, setProfile] = useState(null);
  const [myOrgs, setMyOrgs] = useState(null); // [{org_id, role, orgs:{...}}]
  const [orgId, setOrgId] = useState(() => localStorage.getItem("universe_org") || null);
  const [addingOrg, setAddingOrg] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadMemberships = useCallback(async () => {
    if (!session) return;
    const uid = session.user.id;
    const [{ data: prof }, { data: mems }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("memberships").select("org_id, role, orgs(*)").eq("user_id", uid),
    ]);
    setProfile(prof || { id: uid, name: session.user.user_metadata?.name || "부원" });
    setMyOrgs(mems || []);
  }, [session]);

  useEffect(() => { if (session) loadMemberships(); }, [session, loadMemberships]);

  if (session === undefined) return <Splash />;
  if (!session) return <AuthScreen />;
  if (myOrgs === null) return <Splash />;

  const validOrg = myOrgs.find((m) => m.org_id === orgId);
  const activeMembership = validOrg || myOrgs[0] || null;

  if (!activeMembership || addingOrg) {
    return (
      <OnboardingScreen
        hasOrg={!!activeMembership}
        onBack={activeMembership ? () => setAddingOrg(false) : null}
        onDone={async (newOrgId) => {
          await loadMemberships();
          if (newOrgId) { setOrgId(newOrgId); localStorage.setItem("universe_org", newOrgId); }
          setAddingOrg(false);
        }}
      />
    );
  }

  return (
    <Shell
      key={activeMembership.org_id}
      session={session}
      profile={profile}
      membership={activeMembership}
      myOrgs={myOrgs}
      switchOrg={(id) => { setOrgId(id); localStorage.setItem("universe_org", id); }}
      addOrg={() => setAddingOrg(true)}
      reloadMemberships={loadMemberships}
    />
  );
}

function Splash() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: FONT, background: C.bg, gap: 12 }}>
      <div style={{ fontSize: 44 }}>🎾</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.sub2 }}>불러오는 중...</div>
    </div>
  );
}

/* ───────────── 로그인 + 단체 선택 후 메인 셸 ───────────── */
function Shell({ session, profile, membership, myOrgs, switchOrg, addOrg, reloadMemberships }) {
  const [tab, setTab] = useState("home");
  const [org, setOrg] = useState(membership.orgs);
  const [activities, setActivities] = useState([]);
  const [opens, setOpens] = useState([]);
  const [signups, setSignups] = useState([]);
  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [tourTeams, setTourTeams] = useState([]);
  const [tourTeamMembers, setTourTeamMembers] = useState([]);
  const [tourTies, setTourTies] = useState([]);
  const [tourMatches, setTourMatches] = useState([]);
  const [polls, setPolls] = useState([]);
  const [pollVotes, setPollVotes] = useState([]);
  const [tourParticipants, setTourParticipants] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [schedDate, setSchedDate] = useState(() => ymd(new Date()));
  const [tournamentId, setTournamentId] = useState(null);
  const scrollRef = useRef(null);

  const orgId = membership.org_id;
  const uid = session.user.id;
  const isAdmin = membership.role === "admin";

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  const reload = useCallback(async () => {
    const [{ data: orgRow }, { data: acts }, { data: su }, { data: po }, { data: mem }, { data: tours }, { data: pollRows }] = await Promise.all([
      supabase.from("orgs").select("*").eq("id", orgId).single(),
      supabase.from("activities").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("activity_signups").select("*, profiles(name)").eq("org_id", orgId).order("created_at"),
      supabase.from("posts").select("*, post_joins(user_id, user_name)").order("created_at", { ascending: false }).limit(200),
      supabase.from("memberships").select("user_id, role, profiles(name)").eq("org_id", orgId),
      supabase.from("tournaments").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("polls").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    const actIds = (acts || []).map((a) => a.id);
    const tourIds = (tours || []).map((t) => t.id);
    const pollIds = (pollRows || []).map((p) => p.id);
    const NONE = ["00000000-0000-0000-0000-000000000000"];
    const [{ data: ops }, { data: tTeams }, { data: tTmem }, { data: tTies }, { data: tMatches }, { data: pVotes }, { data: tParts }] = await Promise.all([
      supabase.from("activity_opens").select("*").in("activity_id", actIds.length ? actIds : NONE),
      supabase.from("tournament_teams").select("*").in("tournament_id", tourIds.length ? tourIds : NONE),
      supabase.from("tournament_team_members").select("*").in("tournament_id", tourIds.length ? tourIds : NONE),
      supabase.from("tournament_ties").select("*").in("tournament_id", tourIds.length ? tourIds : NONE),
      supabase.from("tournament_matches").select("*").in("tournament_id", tourIds.length ? tourIds : NONE),
      supabase.from("poll_votes").select("*").in("poll_id", pollIds.length ? pollIds : NONE),
      supabase.from("tournament_participants").select("*").in("tournament_id", tourIds.length ? tourIds : NONE),
    ]);
    if (orgRow) setOrg(orgRow);
    setActivities(acts || []); setOpens(ops || []);
    setSignups(su || []); setPosts(po || []); setMembers(mem || []); setTournaments(tours || []);
    setTourTeams(tTeams || []); setTourTeamMembers(tTmem || []); setTourTies(tTies || []); setTourMatches(tMatches || []);
    setPolls(pollRows || []); setPollVotes(pVotes || []); setTourParticipants(tParts || []);
    setLoaded(true);
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [tab]);

  // 실시간: 신청/취소·일정 변경·모집글 참여가 즉시 반영
  useEffect(() => {
    const ch = supabase
      .channel("org-" + orgId)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_signups", filter: `org_id=eq.${orgId}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "activities", filter: `org_id=eq.${orgId}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_opens" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "post_joins" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `org_id=eq.${orgId}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_ties" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_matches" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_teams" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_participants" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "polls", filter: `org_id=eq.${orgId}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId, reload]);

  const counts = {};
  for (const r of signups) if (r.status === "confirmed") counts[r.user_id] = (counts[r.user_id] || 0) + 1;

  const openTournament = (id) => { setTournamentId(id); setTab("tournament"); };

  const ctx = {
    uid, profile, org, orgId, isAdmin, activities, opens, signups, posts, members, counts, tournaments,
    tourTeams, tourTeamMembers, tourTies, tourMatches, tourParticipants, polls, pollVotes,
    reload, setTab, schedDate, setSchedDate, openTournament, myOrgs, switchOrg, addOrg, reloadMemberships,
  };

  const TITLES = {
    home: org.name, schedule: "일정", community: "모집 게시판", more: "전체", tournament: "대회",
  };

  return (
    <div style={{ fontFamily: FONT, background: C.bg, minHeight: "100vh" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column", background: C.bg }}>
        {/* 헤더 */}
        <div style={{
          position: "sticky", top: 0, zIndex: 30, background: "rgba(242,244,246,0.92)",
          backdropFilter: "blur(8px)", padding: "calc(12px + env(safe-area-inset-top)) 20px 12px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: "-0.5px" }}>
            {TITLES[tab]}
          </span>
          <div onClick={() => setTab("more")} style={{ cursor: "pointer" }}>
            <Avatar name={profile?.name} size={34} />
          </div>
        </div>

        {/* PWA 업데이트 배너 */}
        {needRefresh && (
          <div onClick={() => updateServiceWorker(true)} style={{
            margin: "0 16px 4px", background: C.text, color: "#fff", borderRadius: 14,
            padding: "12px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>새 버전이 나왔어요</span>
            <span style={{ color: "#7DB3FF" }}>업데이트</span>
          </div>
        )}

        {/* 콘텐츠 */}
        <div ref={scrollRef} style={{ flex: 1, padding: "4px 16px 24px" }}>
          {!loaded ? <Splash /> : (
            <ErrorBoundary resetKey={tab + ":" + tournamentId}>
              {tab === "home" && <HomeScreen {...ctx} />}
              {tab === "schedule" && <ScheduleScreen {...ctx} />}
              {tab === "community" && <CommunityScreen {...ctx} />}
              {tab === "more" && <MoreScreen {...ctx} />}
              {tab === "tournament" && tournamentId && (
                <TournamentScreen tournamentId={tournamentId} orgId={orgId} uid={uid}
                  isAdmin={isAdmin} members={members} onBack={() => setTab("schedule")} />
              )}
            </ErrorBoundary>
          )}
        </div>

        {/* 하단 탭바 */}
        <div style={{
          position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${C.border}`,
          display: "flex", padding: "8px 8px calc(10px + env(safe-area-inset-bottom))",
        }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id || (tab === "tournament" && t.id === "schedule");
            return (
              <div key={t.id} onClick={() => setTab(t.id)} style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                gap: 3, cursor: "pointer", padding: "4px 0",
              }}>
                <Icon size={22} color={active ? C.blue : C.sub2} strokeWidth={active ? 2.4 : 2} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 800 : 600, color: active ? C.blue : C.sub2 }}>
                  {t.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
