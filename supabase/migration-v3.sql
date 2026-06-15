-- ============================================================
-- v3 마이그레이션: 대회(토너먼트) 기능 추가
-- 이미 v2(통합 일정)까지 적용한 Supabase 프로젝트에서 한 번 실행하세요.
-- 기존 데이터는 그대로 유지됩니다 (새 테이블만 추가).
-- ============================================================

-- ────────────── 테이블 ──────────────

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  activity_id uuid references public.activities on delete cascade, -- 캘린더 일정 연결 (일정 삭제 시 대회도 삭제)
  title text not null,
  format text not null default 'knockout',     -- 'group'|'knockout'|'group_knockout'
  team_count int not null default 4,
  players_per_team int not null default 4,
  num_singles int not null default 0,          -- 대진당 단식 경기 수
  num_doubles int not null default 0,          -- 대진당 복식 경기 수
  num_groups int,                              -- 조 개수 (조별 형식)
  advance_per_group int not null default 2,    -- 조별 본선 진출 팀 수
  third_place boolean not null default false,  -- 3·4위전 여부
  games_to_win int not null default 6,         -- 6게임 선취
  tiebreak_at int not null default 5,          -- 5-5에서 타이브레이크
  tiebreak_points int not null default 7,      -- 7점 타이브레이크
  stage text not null default 'setup',         -- 'setup'|'group'|'knockout'|'done'
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null,
  captain_id uuid references public.profiles(id),
  group_label text,                            -- 'A'|'B'... (조별)
  seed int,                                    -- 배정/시드 순서
  created_at timestamptz not null default now()
);

create table public.tournament_team_members (
  tournament_id uuid not null references public.tournaments on delete cascade,
  team_id uuid not null references public.tournament_teams on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key (team_id, user_id)
);

create table public.tournament_ties (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  stage text not null,                         -- 'group'|'knockout'
  group_label text,
  round int,                                   -- 토너먼트 라운드 (1=첫 라운드)
  bracket_index int,                           -- 라운드 내 위치 (0부터)
  label text,                                  -- '결승','준결승','A조' 등
  team_a_id uuid references public.tournament_teams on delete cascade,
  team_b_id uuid references public.tournament_teams on delete cascade,
  next_tie_id uuid references public.tournament_ties on delete set null, -- 승자 진출처
  next_slot text,                              -- 'a'|'b'
  court text,
  status text not null default 'pending',      -- 'pending'|'ongoing'|'done'
  winner_team_id uuid references public.tournament_teams on delete set null,
  created_at timestamptz not null default now()
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  tie_id uuid not null references public.tournament_ties on delete cascade,
  slot_type text not null,                     -- 'singles'|'doubles'
  slot_index int not null,                     -- 타입 내 번호 (1부터)
  order_index int not null default 0,          -- 대진 내 출전 순서
  a_players uuid[] not null default '{}',
  b_players uuid[] not null default '{}',
  games_a int,
  games_b int,
  tb_a int,
  tb_b int,
  winner text,                                 -- 'a'|'b'
  status text not null default 'pending',      -- 'pending'|'live'|'done'
  created_at timestamptz not null default now()
);

-- ────────────── 권한 헬퍼 ──────────────

-- 대회 대진의 양 팀 중 한 팀의 조장인지
create or replace function public.is_tie_captain(p_tie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tournament_ties t
    join tournament_teams tm on tm.id in (t.team_a_id, t.team_b_id)
    where t.id = p_tie and tm.captain_id = auth.uid()
  );
$$;

-- ────────────── 대회 생성 ──────────────

create or replace function public.create_tournament(
  p_org uuid, p_title text, p_date date, p_location text,
  p_format text, p_team_count int, p_ppt int,
  p_singles int, p_doubles int, p_groups int, p_advance int, p_third boolean
) returns json language plpgsql security definer set search_path = public as $$
declare v_act uuid; v_tour uuid;
begin
  if not is_admin(p_org) then raise exception '관리자만 대회를 만들 수 있어요'; end if;
  if coalesce(p_singles,0) + coalesce(p_doubles,0) < 1 then raise exception '단식·복식 합이 1경기 이상이어야 해요'; end if;

  insert into activities (org_id, type, title, description, location, repeat_weekly, event_date, created_by)
    values (p_org, 'tournament', p_title, null, p_location, false, p_date, auth.uid())
    returning id into v_act;

  insert into tournaments (org_id, activity_id, title, format, team_count, players_per_team,
    num_singles, num_doubles, num_groups, advance_per_group, third_place, created_by)
    values (p_org, v_act, p_title, p_format, p_team_count, p_ppt,
      coalesce(p_singles,0), coalesce(p_doubles,0), p_groups, coalesce(p_advance,2), coalesce(p_third,false), auth.uid())
    returning id into v_tour;

  return json_build_object('tournament_id', v_tour, 'activity_id', v_act);
end $$;

-- 대회 설정 수정 (setup 단계에서만)
create or replace function public.update_tournament(
  p_tour uuid, p_title text, p_format text, p_team_count int, p_ppt int,
  p_singles int, p_doubles int, p_groups int, p_advance int, p_third boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_stage text; v_act uuid;
begin
  select org_id, stage, activity_id into v_org, v_stage, v_act from tournaments where id = p_tour;
  if not is_admin(v_org) then raise exception '관리자만 변경할 수 있어요'; end if;
  if v_stage <> 'setup' then raise exception '대진표 생성 후에는 형식을 바꿀 수 없어요'; end if;
  update tournaments set title = p_title, format = p_format, team_count = p_team_count,
    players_per_team = p_ppt, num_singles = coalesce(p_singles,0), num_doubles = coalesce(p_doubles,0),
    num_groups = p_groups, advance_per_group = coalesce(p_advance,2), third_place = coalesce(p_third,false)
    where id = p_tour;
  update activities set title = p_title where id = v_act;
end $$;

-- ────────────── 팀 편성 (전체 교체) ──────────────
-- p_teams: [{ "name": "...", "captain_id": "uuid|null", "member_ids": ["uuid", ...] }, ...]

create or replace function public.set_tournament_teams(p_tour uuid, p_teams jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_stage text; t jsonb; v_team uuid; v_seed int := 0; m text;
begin
  select org_id, stage into v_org, v_stage from tournaments where id = p_tour;
  if not is_admin(v_org) then raise exception '관리자만 팀을 편성할 수 있어요'; end if;
  if v_stage <> 'setup' then raise exception '대진표 생성 후에는 팀을 바꿀 수 없어요'; end if;

  delete from tournament_teams where tournament_id = p_tour;

  for t in select * from jsonb_array_elements(p_teams) loop
    v_seed := v_seed + 1;
    insert into tournament_teams (tournament_id, name, captain_id, seed)
      values (p_tour, coalesce(nullif(t->>'name',''), '팀 ' || v_seed),
              nullif(t->>'captain_id','')::uuid, v_seed)
      returning id into v_team;
    for m in select jsonb_array_elements_text(coalesce(t->'member_ids','[]'::jsonb)) loop
      insert into tournament_team_members (tournament_id, team_id, user_id)
        values (p_tour, v_team, m::uuid) on conflict do nothing;
    end loop;
    -- 조장이 명단에 없으면 추가
    if nullif(t->>'captain_id','') is not null then
      insert into tournament_team_members (tournament_id, team_id, user_id)
        values (p_tour, v_team, (t->>'captain_id')::uuid) on conflict do nothing;
    end if;
  end loop;
end $$;

-- ────────────── 대진표 생성 (조 배정·매칭은 클라이언트가 계산, 여기서 저장) ──────────────
-- p_groups: [{ "team_id": "uuid", "group_label": "A" }, ...]  (조별일 때만, 없으면 무시)
-- p_ties: [{ tmp_id, stage, group_label, round, bracket_index, label,
--            team_a_id, team_b_id, next_tmp_id, next_slot,
--            matches:[{ slot_type, slot_index, order_index }] }, ...]

create or replace function public.seed_bracket(p_tour uuid, p_stage text, p_groups jsonb, p_ties jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; g jsonb; t jsonb; m jsonb;
  v_map jsonb := '{}'::jsonb; v_id uuid;
begin
  select org_id into v_org from tournaments where id = p_tour;
  if not is_admin(v_org) then raise exception '관리자만 대진표를 만들 수 있어요'; end if;

  -- 조 라벨 반영
  if p_groups is not null then
    for g in select * from jsonb_array_elements(p_groups) loop
      update tournament_teams set group_label = g->>'group_label'
        where id = (g->>'team_id')::uuid and tournament_id = p_tour;
    end loop;
  end if;

  -- 해당 stage 기존 대진 제거 (matches는 cascade)
  delete from tournament_ties where tournament_id = p_tour and stage = p_stage;

  -- 1차: tie id 매핑
  for t in select * from jsonb_array_elements(p_ties) loop
    v_map := v_map || jsonb_build_object(t->>'tmp_id', gen_random_uuid()::text);
  end loop;

  -- 2차: tie + matches 삽입 (next_tie_id는 나중에 연결 — 자기참조 FK 위반 방지)
  for t in select * from jsonb_array_elements(p_ties) loop
    v_id := (v_map->>(t->>'tmp_id'))::uuid;
    insert into tournament_ties (id, tournament_id, stage, group_label, round, bracket_index, label,
      team_a_id, team_b_id, next_slot, status)
    values (v_id, p_tour, p_stage, t->>'group_label',
      nullif(t->>'round','')::int, nullif(t->>'bracket_index','')::int, t->>'label',
      nullif(t->>'team_a_id','')::uuid, nullif(t->>'team_b_id','')::uuid,
      nullif(t->>'next_slot',''),
      case when nullif(t->>'team_a_id','') is not null and nullif(t->>'team_b_id','') is not null
           then 'ongoing' else 'pending' end);

    for m in select * from jsonb_array_elements(coalesce(t->'matches','[]'::jsonb)) loop
      insert into tournament_matches (tournament_id, tie_id, slot_type, slot_index, order_index)
      values (p_tour, v_id, m->>'slot_type', (m->>'slot_index')::int, coalesce((m->>'order_index')::int, 0));
    end loop;
  end loop;

  -- 3차: 모든 tie가 존재한 뒤 승자 진출처(next_tie_id) 연결
  for t in select * from jsonb_array_elements(p_ties) loop
    if nullif(t->>'next_tmp_id','') is not null then
      update tournament_ties set next_tie_id = (v_map->>(t->>'next_tmp_id'))::uuid
        where id = (v_map->>(t->>'tmp_id'))::uuid;
    end if;
  end loop;

  update tournaments set stage = p_stage where id = p_tour;
end $$;

-- ────────────── 오더지 입력 ──────────────
-- p_assign: [{ "match_id": "uuid", "players": ["uuid", ...] }, ...]  (side='a'|'b')

create or replace function public.submit_order(p_tie uuid, p_side text, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_team uuid; a jsonb; v_match uuid; v_type text; v_players uuid[];
begin
  select t.org_id into v_org from tournaments t
    join tournament_ties ti on ti.tournament_id = t.id where ti.id = p_tie;
  if not is_admin(v_org) and not is_tie_captain(p_tie) then
    raise exception '관리자 또는 해당 팀 조장만 오더를 낼 수 있어요';
  end if;
  if p_side not in ('a','b') then raise exception '잘못된 팀이에요'; end if;
  select case when p_side='a' then team_a_id else team_b_id end into v_team
    from tournament_ties where id = p_tie;

  for a in select * from jsonb_array_elements(p_assign) loop
    v_match := (a->>'match_id')::uuid;
    select slot_type into v_type from tournament_matches where id = v_match and tie_id = p_tie;
    if v_type is null then raise exception '경기를 찾을 수 없어요'; end if;
    select array_agg(x::uuid) into v_players from jsonb_array_elements_text(a->'players') x;
    v_players := coalesce(v_players, '{}');
    if array_length(v_players,1) is distinct from (case when v_type='singles' then 1 else 2 end) then
      raise exception '%: 출전 인원이 맞지 않아요', (case when v_type='singles' then '단식 1명' else '복식 2명' end);
    end if;
    -- 출전 선수가 그 팀 소속인지 확인
    if exists (select 1 from unnest(v_players) u where u not in
      (select user_id from tournament_team_members where team_id = v_team)) then
      raise exception '팀 명단에 없는 선수예요';
    end if;
    if p_side='a' then
      update tournament_matches set a_players = v_players where id = v_match;
    else
      update tournament_matches set b_players = v_players where id = v_match;
    end if;
  end loop;
end $$;

-- ────────────── 점수 입력 (테니스 룰 검증 + 자동 진출) ──────────────

create or replace function public.record_match(p_match uuid, p_ga int, p_gb int, p_tba int, p_tbb int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_tie uuid; v_tour uuid; v_g2w int; v_tbat int; v_tbp int;
  v_winner text; v_hi int; v_lo int;
  v_total int; v_done int; v_awins int; v_bwins int; v_agames int; v_bgames int;
  v_team_a uuid; v_team_b uuid; v_tiewin uuid; v_next uuid; v_slot text;
begin
  select m.tie_id, m.tournament_id into v_tie, v_tour from tournament_matches m where m.id = p_match;
  if v_tie is null then raise exception '경기를 찾을 수 없어요'; end if;
  select org_id, games_to_win, tiebreak_at, tiebreak_points into v_org, v_g2w, v_tbat, v_tbp
    from tournaments where id = v_tour;
  if not is_admin(v_org) and not is_tie_captain(v_tie) then
    raise exception '관리자 또는 해당 팀 조장만 점수를 입력할 수 있어요';
  end if;

  -- 테니스 룰 검증: 승자는 정확히 6게임, 패자는 0~5게임. 5게임이면 타이브레이크 필수.
  if p_ga is null or p_gb is null then raise exception '게임 점수를 입력해주세요'; end if;
  if p_ga = p_gb then raise exception '한 세트는 동점으로 끝날 수 없어요'; end if;
  v_hi := greatest(p_ga, p_gb); v_lo := least(p_ga, p_gb);
  if v_hi <> v_g2w then raise exception '승자는 %게임이어야 해요', v_g2w; end if;
  if v_lo < 0 or v_lo > v_tbat then raise exception '패자 게임 수가 올바르지 않아요'; end if;
  v_winner := case when p_ga > p_gb then 'a' else 'b' end;

  if v_lo = v_tbat then
    -- 5-5 → 타이브레이크 필수, 7점·2점차, 타이브레이크 승자가 세트 승자와 일치
    if p_tba is null or p_tbb is null then raise exception '5-5 타이브레이크 점수를 입력해주세요'; end if;
    if greatest(p_tba,p_tbb) < v_tbp or (greatest(p_tba,p_tbb) - least(p_tba,p_tbb)) < 2 then
      raise exception '타이브레이크는 %점 이상·2점차로 끝나야 해요', v_tbp;
    end if;
    if (case when p_tba > p_tbb then 'a' else 'b' end) <> v_winner then
      raise exception '타이브레이크 승자와 게임 승자가 일치해야 해요';
    end if;
  else
    p_tba := null; p_tbb := null;
  end if;

  update tournament_matches
    set games_a = p_ga, games_b = p_gb, tb_a = p_tba, tb_b = p_tbb, winner = v_winner, status = 'done'
    where id = p_match;

  -- 대진 집계
  select team_a_id, team_b_id into v_team_a, v_team_b from tournament_ties where id = v_tie;
  select count(*),
         count(*) filter (where status='done'),
         count(*) filter (where winner='a'),
         count(*) filter (where winner='b'),
         coalesce(sum(games_a),0), coalesce(sum(games_b),0)
    into v_total, v_done, v_awins, v_bwins, v_agames, v_bgames
    from tournament_matches where tie_id = v_tie;

  if v_done < v_total then
    update tournament_ties set status = 'ongoing' where id = v_tie and status = 'pending';
    return;
  end if;

  -- 모든 경기 종료 → 대진 승자 결정 (매치 승수 → 게임 득실)
  if v_awins > v_bwins then v_tiewin := v_team_a;
  elsif v_bwins > v_awins then v_tiewin := v_team_b;
  elsif v_agames > v_bgames then v_tiewin := v_team_a;
  elsif v_bgames > v_agames then v_tiewin := v_team_b;
  else v_tiewin := null; -- 완전 동점: 관리자가 수동 판정
  end if;

  update tournament_ties set status = 'done', winner_team_id = v_tiewin where id = v_tie;

  -- 토너먼트면 승자 다음 대진으로 진출
  if v_tiewin is not null then
    select next_tie_id, next_slot into v_next, v_slot from tournament_ties where id = v_tie;
    if v_next is not null and v_slot is not null then
      if v_slot = 'a' then update tournament_ties set team_a_id = v_tiewin where id = v_next;
      else update tournament_ties set team_b_id = v_tiewin where id = v_next; end if;
      update tournament_ties set status = 'ongoing'
        where id = v_next and team_a_id is not null and team_b_id is not null and status = 'pending';
    end if;
  end if;
end $$;

-- 점수 초기화 (관리자, 다음 대진이 아직 시작 안 했을 때만)
create or replace function public.reset_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tie uuid; v_next uuid; v_slot text; v_win uuid; v_nstatus text;
begin
  select m.tie_id, t.org_id into v_tie, v_org
    from tournament_matches m join tournaments t on t.id = m.tournament_id where m.id = p_match;
  if not is_admin(v_org) then raise exception '관리자만 점수를 초기화할 수 있어요'; end if;

  select next_tie_id, next_slot, winner_team_id into v_next, v_slot, v_win from tournament_ties where id = v_tie;
  if v_next is not null then
    select status into v_nstatus from tournament_ties where id = v_next;
    if v_nstatus = 'done' then raise exception '다음 대진이 이미 끝나 초기화할 수 없어요'; end if;
  end if;

  update tournament_matches set games_a=null, games_b=null, tb_a=null, tb_b=null, winner=null, status='pending'
    where id = p_match;

  -- 다음 대진에 올라갔던 승자 제거
  if v_next is not null and v_win is not null and v_slot is not null then
    if v_slot='a' then update tournament_ties set team_a_id=null, status='pending' where id=v_next;
    else update tournament_ties set team_b_id=null, status='pending' where id=v_next; end if;
  end if;
  update tournament_ties set status='ongoing', winner_team_id=null where id=v_tie;
end $$;

-- 대진 승자 수동 지정 (완전 동점 시)
create or replace function public.set_tie_winner(p_tie uuid, p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_next uuid; v_slot text;
begin
  select t.org_id into v_org from tournaments t join tournament_ties ti on ti.tournament_id=t.id where ti.id=p_tie;
  if not is_admin(v_org) then raise exception '관리자만 가능해요'; end if;
  update tournament_ties set winner_team_id = p_team, status='done' where id = p_tie;
  select next_tie_id, next_slot into v_next, v_slot from tournament_ties where id = p_tie;
  if v_next is not null and v_slot is not null then
    if v_slot='a' then update tournament_ties set team_a_id=p_team where id=v_next;
    else update tournament_ties set team_b_id=p_team where id=v_next; end if;
    update tournament_ties set status='ongoing'
      where id=v_next and team_a_id is not null and team_b_id is not null and status='pending';
  end if;
end $$;

-- ────────────── RLS ──────────────

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_team_members enable row level security;
alter table public.tournament_ties enable row level security;
alter table public.tournament_matches enable row level security;

-- 조회는 부원만, 모든 쓰기는 위 함수(security definer)로만
create policy "tournaments_select" on public.tournaments for select to authenticated using (is_member(org_id));
create policy "tt_select" on public.tournament_teams for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "ttm_select" on public.tournament_team_members for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "ties_select" on public.tournament_ties for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "matches_select" on public.tournament_matches for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));

-- ────────────── 실시간 구독 ──────────────
alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_teams;
alter publication supabase_realtime add table public.tournament_team_members;
alter publication supabase_realtime add table public.tournament_ties;
alter publication supabase_realtime add table public.tournament_matches;
