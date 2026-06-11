import { useState, useEffect, useCallback, useRef } from "react";
import { Home, Zap, MessagesSquare, CalendarDays, UserRound } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { supabase, configured } from "./supabase.js";
import { C, FONT, ToastProvider, Avatar } from "./ui.jsx";
import { currentCycle } from "./lib/schedule.js";
import AuthScreen from "./screens/Auth.jsx";
import OnboardingScreen from "./screens/Onboarding.jsx";
import HomeScreen from "./screens/Home.jsx";
import BookScreen from "./screens/Book.jsx";
import CommunityScreen from "./screens/Community.jsx";
import CalendarScreen from "./screens/Calendar.jsx";
import MoreScreen from "./screens/More.jsx";

const TABS = [
  { id: "home", label: "홈", icon: Home },
  { id: "book", label: "신청", icon: Zap },
  { id: "community", label: "모집", icon: MessagesSquare },
  { id: "calendar", label: "캘린더", icon: CalendarDays },
  { id: "more", label: "전체", icon: UserRound },
];

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
  const [slots, setSlots] = useState([]);
  const [signups, setSignups] = useState([]);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [allConfirmed, setAllConfirmed] = useState([]); // 참여 통계용
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef(null);

  const orgId = membership.org_id;
  const uid = session.user.id;
  const isAdmin = membership.role === "admin";
  const cycle = currentCycle(org, slots);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  const reload = useCallback(async () => {
    const { data: orgRow } = await supabase.from("orgs").select("*").eq("id", orgId).single();
    const { data: slotRows } = await supabase.from("class_slots").select("*").eq("org_id", orgId)
      .order("day_of_week").order("start_time");
    const freshOrg = orgRow || org;
    const freshSlots = slotRows || [];
    const wk = currentCycle(freshOrg, freshSlots).weekKey;
    const [{ data: su }, { data: ev }, { data: mem }, { data: ac }] = await Promise.all([
      supabase.from("signups").select("*, profiles(name)").eq("org_id", orgId).eq("week_key", wk).order("created_at"),
      supabase.from("events").select("*").eq("org_id", orgId).order("date"),
      supabase.from("memberships").select("user_id, role, profiles(name)").eq("org_id", orgId),
      supabase.from("signups").select("user_id").eq("org_id", orgId).eq("status", "confirmed"),
    ]);
    setOrg(freshOrg); setSlots(freshSlots);
    setSignups(su || []); setEvents(ev || []); setMembers(mem || []); setAllConfirmed(ac || []);
    setLoaded(true);
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [tab]);

  // 실시간: 누군가 신청/취소하면 즉시 반영
  useEffect(() => {
    const ch = supabase
      .channel("signups-" + orgId)
      .on("postgres_changes", { event: "*", schema: "public", table: "signups", filter: `org_id=eq.${orgId}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId, reload]);

  const counts = {};
  for (const r of allConfirmed) counts[r.user_id] = (counts[r.user_id] || 0) + 1;

  const ctx = {
    uid, profile, org, orgId, isAdmin, slots, signups, events, members, counts,
    cycle, reload, setTab, myOrgs, switchOrg, addOrg, reloadMemberships,
  };

  const TITLES = {
    home: org.name, book: "선착순 신청", community: "모집 게시판",
    calendar: "캘린더", more: "전체",
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
            <>
              {tab === "home" && <HomeScreen {...ctx} />}
              {tab === "book" && <BookScreen {...ctx} />}
              {tab === "community" && <CommunityScreen {...ctx} />}
              {tab === "calendar" && <CalendarScreen {...ctx} />}
              {tab === "more" && <MoreScreen {...ctx} />}
            </>
          )}
        </div>

        {/* 하단 탭바 */}
        <div style={{
          position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${C.border}`,
          display: "flex", padding: "8px 8px calc(10px + env(safe-area-inset-bottom))",
        }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
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
