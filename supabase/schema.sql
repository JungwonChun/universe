-- ============================================================
-- Universe (동아리 운영 PWA) 데이터베이스 스키마 v2 — 통합 일정 시스템
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. (새 프로젝트용)
-- 기존 v1 스키마에서 업그레이드하려면 migration-v2.sql 을 실행하세요.
-- ============================================================

-- ────────────── 테이블 ──────────────

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '부원',
  created_at timestamptz not null default now()
);

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.org_codes (
  org_id uuid primary key references public.orgs on delete cascade,
  code text unique not null
);

create table public.memberships (
  org_id uuid not null references public.orgs on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null default 'member',        -- 'admin' | 'member'
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- 일정 (레슨·행사 통합)
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  type text not null default 'lesson',        -- 'lesson'(레슨) | 'event'(행사)
  title text not null,
  description text,
  location text,
  repeat_weekly boolean not null default false,
  day_of_week int,                            -- 반복 일정: 요일 (0=일 ~ 6=토)
  event_date date,                            -- 단일 일정: 날짜
  start_time time,
  end_time time,
  capacity int,                               -- null = 인원 제한 없음
  open_rule_day int,                          -- 반복 일정 신청 오픈 규칙: 요일 (null = 수동 오픈만)
  open_rule_time time,                        -- 반복 일정 신청 오픈 규칙: 시각
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (repeat_weekly = (day_of_week is not null)),
  check (repeat_weekly or event_date is not null),
  check (capacity is null or (capacity >= 0 and capacity <= 50))
);

-- 회차별 수동 오픈/마감 (관리자 오버라이드)
create table public.activity_opens (
  activity_id uuid not null references public.activities on delete cascade,
  occ_date date not null,
  state text not null,                        -- 'open' | 'closed'
  primary key (activity_id, occ_date)
);

-- 일정 참가 신청 (회차 단위)
create table public.activity_signups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  activity_id uuid not null references public.activities on delete cascade,
  occ_date date not null,                     -- 회차 날짜
  user_id uuid not null references public.profiles on delete cascade,
  status text not null,                       -- 'confirmed' | 'waitlist'
  created_at timestamptz not null default now(),
  unique (activity_id, occ_date, user_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  org_name text not null,
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  type text not null default 'play',          -- 'match'(교류전) | 'play'(같이 치기) | 'etc'(기타)
  title text not null,
  body text,
  meet_date date,
  location text,
  max_people int,
  visibility text not null default 'org',     -- 'org'(단체 내부) | 'public'(전체 공개)
  created_at timestamptz not null default now()
);

create table public.post_joins (
  post_id uuid not null references public.posts on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 7일 정지 방지용 핑 테이블
create table public.keepalive (
  id int primary key default 1,
  pinged_at timestamptz not null default now()
);
insert into public.keepalive (id) values (1);

-- ────────────── 헬퍼 함수 (RLS 재귀 방지) ──────────────

create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and role = 'admin');
$$;

-- ────────────── 회원가입 시 프로필 자동 생성 ──────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name', ''), '부원'));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────── 단체 생성 / 초대 코드 가입 ──────────────

create or replace function public.create_org(p_name text, p_desc text)
returns json language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into orgs (name, description, created_by)
    values (trim(p_name), p_desc, auth.uid()) returning id into v_org;
  insert into org_codes (org_id, code) values (v_org, v_code);
  insert into memberships (org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return json_build_object('org_id', v_org, 'code', v_code);
end $$;

create or replace function public.join_org(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select org_id into v_org from org_codes where code = upper(trim(p_code));
  if v_org is null then raise exception '초대 코드를 찾을 수 없어요'; end if;
  insert into memberships (org_id, user_id, role)
    values (v_org, auth.uid(), 'member')
    on conflict (org_id, user_id) do nothing;
  return v_org;
end $$;

-- ────────────── 일정 오픈 상태 계산 ──────────────
-- 'open' | 'closed' | 'before'(오픈 전) | 'ended'(종료)
-- 우선순위: 종료 여부 > 수동 오버라이드 > (단일: 항상 오픈) > (반복: 오픈 규칙)
-- 반복 일정의 오픈 규칙: 회차 날짜 직전의 open_rule_day open_rule_time 에 열림 (1~7일 전)

create or replace function public.activity_open_state(p_activity uuid, p_date date)
returns text language plpgsql stable security definer set search_path = public as $$
declare a record; v_state text; v_now timestamp; v_end timestamp; v_open_at timestamp; v_back int;
begin
  select * into a from activities where id = p_activity;
  if a.id is null then return 'ended'; end if;
  v_now := now() at time zone 'Asia/Seoul';
  v_end := p_date + coalesce(a.end_time, time '23:59:59');
  if v_now > v_end then return 'ended'; end if;
  select state into v_state from activity_opens where activity_id = p_activity and occ_date = p_date;
  if v_state is not null then return v_state; end if;
  if not a.repeat_weekly then return 'open'; end if;
  if a.open_rule_day is null or a.open_rule_time is null then return 'closed'; end if;
  v_back := ((extract(dow from p_date)::int - a.open_rule_day + 6) % 7) + 1;
  v_open_at := (p_date - v_back) + a.open_rule_time;
  if v_now < v_open_at then return 'before'; end if;
  return 'open';
end $$;

-- ────────────── 선착순 참가 / 취소 (동시 클릭 안전) ──────────────

create or replace function public.join_activity(p_activity uuid, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare a record; v_count int; v_status text; v_state text;
begin
  select * into a from activities where id = p_activity;
  if a.id is null then raise exception '존재하지 않는 일정이에요'; end if;
  if not is_member(a.org_id) then raise exception '단체 부원만 신청할 수 있어요'; end if;
  if a.repeat_weekly then
    if extract(dow from p_date)::int <> a.day_of_week then raise exception '이 일정의 요일이 아니에요'; end if;
  else
    if p_date <> a.event_date then raise exception '일정 날짜가 아니에요'; end if;
  end if;

  v_state := activity_open_state(p_activity, p_date);
  if v_state = 'ended' then raise exception '이미 끝난 일정이에요'; end if;
  if v_state <> 'open' then raise exception '지금은 신청 기간이 아니에요'; end if;

  -- 같은 일정·회차 요청을 한 줄로 세움 (마지막 한 자리 동시 클릭 문제 방지)
  perform pg_advisory_xact_lock(hashtext(p_activity::text || p_date::text));

  if exists (select 1 from activity_signups
             where activity_id = p_activity and occ_date = p_date and user_id = auth.uid()) then
    return 'already';
  end if;

  if a.capacity is null then
    v_status := 'confirmed';
  else
    select count(*) into v_count from activity_signups
      where activity_id = p_activity and occ_date = p_date and status = 'confirmed';
    v_status := case when v_count < a.capacity then 'confirmed' else 'waitlist' end;
  end if;

  insert into activity_signups (org_id, activity_id, occ_date, user_id, status)
    values (a.org_id, p_activity, p_date, auth.uid(), v_status);
  return v_status;
end $$;

create or replace function public.leave_activity(p_activity uuid, p_date date)
returns json language plpgsql security definer set search_path = public as $$
declare a record; v_was text; v_count int; v_promoted uuid; v_promoted_name text;
begin
  select * into a from activities where id = p_activity;
  if a.id is null then return json_build_object('cancelled', false); end if;
  perform pg_advisory_xact_lock(hashtext(p_activity::text || p_date::text));

  delete from activity_signups
    where activity_id = p_activity and occ_date = p_date and user_id = auth.uid()
    returning status into v_was;
  if v_was is null then return json_build_object('cancelled', false); end if;

  -- 확정 자리가 비면 대기 1번 자동 승급
  if v_was = 'confirmed' and a.capacity is not null then
    select count(*) into v_count from activity_signups
      where activity_id = p_activity and occ_date = p_date and status = 'confirmed';
    if v_count < a.capacity then
      select user_id into v_promoted from activity_signups
        where activity_id = p_activity and occ_date = p_date and status = 'waitlist'
        order by created_at asc limit 1;
      if v_promoted is not null then
        update activity_signups set status = 'confirmed'
          where activity_id = p_activity and occ_date = p_date and user_id = v_promoted;
        select name into v_promoted_name from profiles where id = v_promoted;
      end if;
    end if;
  end if;

  return json_build_object('cancelled', true, 'was', v_was, 'promoted_name', v_promoted_name);
end $$;

-- 회차 수동 오픈/마감 (p_state: 'open' | 'closed' | null=자동으로 복귀)
create or replace function public.set_activity_open(p_activity uuid, p_date date, p_state text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from activities where id = p_activity;
  if not is_admin(v_org) then raise exception '관리자만 변경할 수 있어요'; end if;
  if p_state is null then
    delete from activity_opens where activity_id = p_activity and occ_date = p_date;
  elsif p_state in ('open', 'closed') then
    insert into activity_opens (activity_id, occ_date, state) values (p_activity, p_date, p_state)
      on conflict (activity_id, occ_date) do update set state = p_state;
  else
    raise exception '잘못된 상태예요';
  end if;
end $$;

-- 정원이 늘었을 때 대기자 자동 승급
create or replace function public.promote_waitlist(p_activity uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_count int; v_next uuid;
begin
  select * into a from activities where id = p_activity;
  if not is_admin(a.org_id) then raise exception '관리자만 실행할 수 있어요'; end if;
  perform pg_advisory_xact_lock(hashtext(p_activity::text || p_date::text));
  loop
    select count(*) into v_count from activity_signups
      where activity_id = p_activity and occ_date = p_date and status = 'confirmed';
    exit when a.capacity is not null and v_count >= a.capacity;
    select user_id into v_next from activity_signups
      where activity_id = p_activity and occ_date = p_date and status = 'waitlist'
      order by created_at asc limit 1;
    exit when v_next is null;
    update activity_signups set status = 'confirmed'
      where activity_id = p_activity and occ_date = p_date and user_id = v_next;
  end loop;
end $$;

-- ────────────── RLS (행 수준 보안) ──────────────

alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.org_codes enable row level security;
alter table public.memberships enable row level security;
alter table public.activities enable row level security;
alter table public.activity_opens enable row level security;
alter table public.activity_signups enable row level security;
alter table public.posts enable row level security;
alter table public.post_joins enable row level security;
alter table public.keepalive enable row level security;

-- profiles: 로그인한 사용자는 이름 조회 가능, 본인 것만 수정
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update" on public.profiles for update to authenticated using (id = auth.uid());

-- orgs: 부원만 조회, 관리자만 수정 (생성은 create_org 함수로만)
create policy "orgs_select" on public.orgs for select to authenticated using (is_member(id));
create policy "orgs_update" on public.orgs for update to authenticated using (is_admin(id));

-- org_codes: 관리자만 조회 (가입은 join_org 함수로만)
create policy "org_codes_select" on public.org_codes for select to authenticated using (is_admin(org_id));

-- memberships: 같은 단체 부원 조회, 관리자는 역할 변경/강퇴, 본인은 탈퇴
create policy "memberships_select" on public.memberships for select to authenticated using (is_member(org_id));
create policy "memberships_update" on public.memberships for update to authenticated using (is_admin(org_id));
create policy "memberships_delete" on public.memberships for delete to authenticated
  using (user_id = auth.uid() or is_admin(org_id));

-- activities: 부원 조회, 관리자 관리
create policy "activities_select" on public.activities for select to authenticated using (is_member(org_id));
create policy "activities_insert" on public.activities for insert to authenticated with check (is_admin(org_id));
create policy "activities_update" on public.activities for update to authenticated using (is_admin(org_id));
create policy "activities_delete" on public.activities for delete to authenticated using (is_admin(org_id));

-- activity_opens: 부원 조회 (변경은 set_activity_open 함수로만)
create policy "activity_opens_select" on public.activity_opens for select to authenticated
  using (exists (select 1 from activities a where a.id = activity_id and is_member(a.org_id)));

-- activity_signups: 부원 조회만 가능 (신청/취소는 함수로만 — 정원·대기열 로직 우회 방지)
create policy "activity_signups_select" on public.activity_signups for select to authenticated using (is_member(org_id));

-- posts: 전체 공개 글은 누구나(로그인), 내부 글은 부원만
create policy "posts_select" on public.posts for select to authenticated
  using (visibility = 'public' or is_member(org_id));
create policy "posts_insert" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and is_member(org_id));
create policy "posts_delete" on public.posts for delete to authenticated
  using (author_id = auth.uid() or is_admin(org_id));

-- post_joins: 글을 볼 수 있으면 참여자 목록도 보임, 참여/취소는 본인만
create policy "post_joins_select" on public.post_joins for select to authenticated
  using (exists (select 1 from posts p where p.id = post_id and (p.visibility = 'public' or is_member(p.org_id))));
create policy "post_joins_insert" on public.post_joins for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from posts p where p.id = post_id and (p.visibility = 'public' or is_member(p.org_id))));
create policy "post_joins_delete" on public.post_joins for delete to authenticated using (user_id = auth.uid());

-- keepalive: 누구나 조회 가능 (GitHub Actions 핑용)
create policy "keepalive_select" on public.keepalive for select to anon, authenticated using (true);

-- ────────────── 실시간 구독 (신청/취소·일정 변경 즉시 반영) ──────────────
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.activity_opens;
alter publication supabase_realtime add table public.activity_signups;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_joins;

-- ============================================================
-- 대회(토너먼트) 기능  (v3에서 추가)
-- ============================================================

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  activity_id uuid references public.activities on delete cascade,
  title text not null,
  format text not null default 'knockout',     -- 'group'|'knockout'|'group_knockout'
  team_count int not null default 4,
  players_per_team int not null default 4,
  num_singles int not null default 0,
  num_doubles int not null default 0,
  num_groups int,
  advance_per_group int not null default 2,
  third_place boolean not null default false,
  games_to_win int not null default 6,
  tiebreak_at int not null default 5,
  tiebreak_points int not null default 7,
  stage text not null default 'setup',         -- 'setup'|'group'|'knockout'|'done'
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  name text not null,
  captain_id uuid references public.profiles(id),
  group_label text,
  seed int,
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
  stage text not null,
  group_label text,
  round int,
  bracket_index int,
  label text,
  team_a_id uuid references public.tournament_teams on delete cascade,
  team_b_id uuid references public.tournament_teams on delete cascade,
  next_tie_id uuid references public.tournament_ties on delete set null,
  next_slot text,
  court text,
  status text not null default 'pending',
  winner_team_id uuid references public.tournament_teams on delete set null,
  created_at timestamptz not null default now()
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  tie_id uuid not null references public.tournament_ties on delete cascade,
  slot_type text not null,
  slot_index int not null,
  order_index int not null default 0,
  a_players uuid[] not null default '{}',
  b_players uuid[] not null default '{}',
  games_a int, games_b int, tb_a int, tb_b int,
  winner text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create or replace function public.is_tie_captain(p_tie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tournament_ties t
    join tournament_teams tm on tm.id in (t.team_a_id, t.team_b_id)
    where t.id = p_tie and tm.captain_id = auth.uid()
  );
$$;

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
    if nullif(t->>'captain_id','') is not null then
      insert into tournament_team_members (tournament_id, team_id, user_id)
        values (p_tour, v_team, (t->>'captain_id')::uuid) on conflict do nothing;
    end if;
  end loop;
end $$;

create or replace function public.seed_bracket(p_tour uuid, p_stage text, p_groups jsonb, p_ties jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; g jsonb; t jsonb; m jsonb; v_map jsonb := '{}'::jsonb; v_id uuid;
begin
  select org_id into v_org from tournaments where id = p_tour;
  if not is_admin(v_org) then raise exception '관리자만 대진표를 만들 수 있어요'; end if;
  if p_groups is not null then
    for g in select * from jsonb_array_elements(p_groups) loop
      update tournament_teams set group_label = g->>'group_label'
        where id = (g->>'team_id')::uuid and tournament_id = p_tour;
    end loop;
  end if;
  delete from tournament_ties where tournament_id = p_tour and stage = p_stage;
  for t in select * from jsonb_array_elements(p_ties) loop
    v_map := v_map || jsonb_build_object(t->>'tmp_id', gen_random_uuid()::text);
  end loop;
  -- tie 먼저 전부 삽입 (next_tie_id는 나중에 — 자기참조 FK 위반 방지)
  for t in select * from jsonb_array_elements(p_ties) loop
    v_id := (v_map->>(t->>'tmp_id'))::uuid;
    insert into tournament_ties (id, tournament_id, stage, group_label, round, bracket_index, label,
      team_a_id, team_b_id, next_slot, status)
    values (v_id, p_tour, p_stage, t->>'group_label',
      nullif(t->>'round','')::int, nullif(t->>'bracket_index','')::int, t->>'label',
      nullif(t->>'team_a_id','')::uuid, nullif(t->>'team_b_id','')::uuid,
      nullif(t->>'next_slot',''),
      case when nullif(t->>'team_a_id','') is not null and nullif(t->>'team_b_id','') is not null then 'ongoing' else 'pending' end);
    for m in select * from jsonb_array_elements(coalesce(t->'matches','[]'::jsonb)) loop
      insert into tournament_matches (tournament_id, tie_id, slot_type, slot_index, order_index)
      values (p_tour, v_id, m->>'slot_type', (m->>'slot_index')::int, coalesce((m->>'order_index')::int, 0));
    end loop;
  end loop;
  for t in select * from jsonb_array_elements(p_ties) loop
    if nullif(t->>'next_tmp_id','') is not null then
      update tournament_ties set next_tie_id = (v_map->>(t->>'next_tmp_id'))::uuid
        where id = (v_map->>(t->>'tmp_id'))::uuid;
    end if;
  end loop;
  update tournaments set stage = p_stage where id = p_tour;
end $$;

create or replace function public.submit_order(p_tie uuid, p_side text, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_team uuid; a jsonb; v_match uuid; v_type text; v_players uuid[];
begin
  select t.org_id into v_org from tournaments t join tournament_ties ti on ti.tournament_id = t.id where ti.id = p_tie;
  if not is_admin(v_org) and not is_tie_captain(p_tie) then raise exception '관리자 또는 해당 팀 조장만 오더를 낼 수 있어요'; end if;
  if p_side not in ('a','b') then raise exception '잘못된 팀이에요'; end if;
  select case when p_side='a' then team_a_id else team_b_id end into v_team from tournament_ties where id = p_tie;
  for a in select * from jsonb_array_elements(p_assign) loop
    v_match := (a->>'match_id')::uuid;
    select slot_type into v_type from tournament_matches where id = v_match and tie_id = p_tie;
    if v_type is null then raise exception '경기를 찾을 수 없어요'; end if;
    select array_agg(x::uuid) into v_players from jsonb_array_elements_text(a->'players') x;
    v_players := coalesce(v_players, '{}');
    if array_length(v_players,1) is distinct from (case when v_type='singles' then 1 else 2 end) then
      raise exception '%: 출전 인원이 맞지 않아요', (case when v_type='singles' then '단식 1명' else '복식 2명' end);
    end if;
    if exists (select 1 from unnest(v_players) u where u not in (select user_id from tournament_team_members where team_id = v_team)) then
      raise exception '팀 명단에 없는 선수예요';
    end if;
    if p_side='a' then update tournament_matches set a_players = v_players where id = v_match;
    else update tournament_matches set b_players = v_players where id = v_match; end if;
  end loop;
end $$;

create or replace function public.record_match(p_match uuid, p_ga int, p_gb int, p_tba int, p_tbb int)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tie uuid; v_tour uuid; v_g2w int; v_tbat int; v_tbp int; v_winner text; v_hi int; v_lo int;
  v_total int; v_done int; v_awins int; v_bwins int; v_agames int; v_bgames int;
  v_team_a uuid; v_team_b uuid; v_tiewin uuid; v_next uuid; v_slot text;
begin
  select m.tie_id, m.tournament_id into v_tie, v_tour from tournament_matches m where m.id = p_match;
  if v_tie is null then raise exception '경기를 찾을 수 없어요'; end if;
  select org_id, games_to_win, tiebreak_at, tiebreak_points into v_org, v_g2w, v_tbat, v_tbp from tournaments where id = v_tour;
  if not is_admin(v_org) and not is_tie_captain(v_tie) then raise exception '관리자 또는 해당 팀 조장만 점수를 입력할 수 있어요'; end if;
  if p_ga is null or p_gb is null then raise exception '게임 점수를 입력해주세요'; end if;
  if p_ga = p_gb then raise exception '한 세트는 동점으로 끝날 수 없어요'; end if;
  v_hi := greatest(p_ga, p_gb); v_lo := least(p_ga, p_gb);
  if v_hi <> v_g2w then raise exception '승자는 %게임이어야 해요', v_g2w; end if;
  if v_lo < 0 or v_lo > v_tbat then raise exception '패자 게임 수가 올바르지 않아요'; end if;
  v_winner := case when p_ga > p_gb then 'a' else 'b' end;
  if v_lo = v_tbat then
    if p_tba is null or p_tbb is null then raise exception '5-5 타이브레이크 점수를 입력해주세요'; end if;
    if greatest(p_tba,p_tbb) < v_tbp or (greatest(p_tba,p_tbb) - least(p_tba,p_tbb)) < 2 then
      raise exception '타이브레이크는 %점 이상·2점차로 끝나야 해요', v_tbp; end if;
    if (case when p_tba > p_tbb then 'a' else 'b' end) <> v_winner then
      raise exception '타이브레이크 승자와 게임 승자가 일치해야 해요'; end if;
  else p_tba := null; p_tbb := null; end if;
  update tournament_matches set games_a=p_ga, games_b=p_gb, tb_a=p_tba, tb_b=p_tbb, winner=v_winner, status='done' where id=p_match;
  select team_a_id, team_b_id into v_team_a, v_team_b from tournament_ties where id = v_tie;
  select count(*), count(*) filter (where status='done'), count(*) filter (where winner='a'),
         count(*) filter (where winner='b'), coalesce(sum(games_a),0), coalesce(sum(games_b),0)
    into v_total, v_done, v_awins, v_bwins, v_agames, v_bgames from tournament_matches where tie_id = v_tie;
  if v_done < v_total then
    update tournament_ties set status='ongoing' where id=v_tie and status='pending';
    return;
  end if;
  if v_awins > v_bwins then v_tiewin := v_team_a;
  elsif v_bwins > v_awins then v_tiewin := v_team_b;
  elsif v_agames > v_bgames then v_tiewin := v_team_a;
  elsif v_bgames > v_agames then v_tiewin := v_team_b;
  else v_tiewin := null; end if;
  update tournament_ties set status='done', winner_team_id=v_tiewin where id=v_tie;
  if v_tiewin is not null then
    select next_tie_id, next_slot into v_next, v_slot from tournament_ties where id = v_tie;
    if v_next is not null and v_slot is not null then
      if v_slot='a' then update tournament_ties set team_a_id=v_tiewin where id=v_next;
      else update tournament_ties set team_b_id=v_tiewin where id=v_next; end if;
      update tournament_ties set status='ongoing' where id=v_next and team_a_id is not null and team_b_id is not null and status='pending';
    end if;
  end if;
end $$;

create or replace function public.reset_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tie uuid; v_next uuid; v_slot text; v_win uuid; v_nstatus text;
begin
  select m.tie_id, t.org_id into v_tie, v_org from tournament_matches m join tournaments t on t.id=m.tournament_id where m.id=p_match;
  if not is_admin(v_org) then raise exception '관리자만 점수를 초기화할 수 있어요'; end if;
  select next_tie_id, next_slot, winner_team_id into v_next, v_slot, v_win from tournament_ties where id=v_tie;
  if v_next is not null then
    select status into v_nstatus from tournament_ties where id=v_next;
    if v_nstatus='done' then raise exception '다음 대진이 이미 끝나 초기화할 수 없어요'; end if;
  end if;
  update tournament_matches set games_a=null, games_b=null, tb_a=null, tb_b=null, winner=null, status='pending' where id=p_match;
  if v_next is not null and v_win is not null and v_slot is not null then
    if v_slot='a' then update tournament_ties set team_a_id=null, status='pending' where id=v_next;
    else update tournament_ties set team_b_id=null, status='pending' where id=v_next; end if;
  end if;
  update tournament_ties set status='ongoing', winner_team_id=null where id=v_tie;
end $$;

create or replace function public.set_tie_winner(p_tie uuid, p_team uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_next uuid; v_slot text;
begin
  select t.org_id into v_org from tournaments t join tournament_ties ti on ti.tournament_id=t.id where ti.id=p_tie;
  if not is_admin(v_org) then raise exception '관리자만 가능해요'; end if;
  update tournament_ties set winner_team_id=p_team, status='done' where id=p_tie;
  select next_tie_id, next_slot into v_next, v_slot from tournament_ties where id=p_tie;
  if v_next is not null and v_slot is not null then
    if v_slot='a' then update tournament_ties set team_a_id=p_team where id=v_next;
    else update tournament_ties set team_b_id=p_team where id=v_next; end if;
    update tournament_ties set status='ongoing' where id=v_next and team_a_id is not null and team_b_id is not null and status='pending';
  end if;
end $$;

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.tournament_team_members enable row level security;
alter table public.tournament_ties enable row level security;
alter table public.tournament_matches enable row level security;

create policy "tournaments_select" on public.tournaments for select to authenticated using (is_member(org_id));
create policy "tt_select" on public.tournament_teams for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "ttm_select" on public.tournament_team_members for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "ties_select" on public.tournament_ties for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "matches_select" on public.tournament_matches for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));

alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_teams;
alter publication supabase_realtime add table public.tournament_team_members;
alter publication supabase_realtime add table public.tournament_ties;
alter publication supabase_realtime add table public.tournament_matches;

-- ============================================================
-- v4: 코트 배정 · 대회 공지 · 투표(설문) · 경기 결과 시각
-- ============================================================
-- ============================================================

-- ────────────── 대회: 코트 · 출전 순서 · 결과 시각 ──────────────

alter table public.tournaments add column if not exists courts text[] not null default '{}';
alter table public.tournament_ties add column if not exists play_order int;       -- 코트 내 진행 순서
alter table public.tournament_matches add column if not exists decided_at timestamptz; -- 결과 확정 시각 (피드용)

-- create_tournament: 코트 목록(p_courts) 추가 — 기존(12인자) 버전 제거 후 재정의
drop function if exists public.create_tournament(uuid, text, date, text, text, int, int, int, int, int, int, boolean);
create or replace function public.create_tournament(
  p_org uuid, p_title text, p_date date, p_location text,
  p_format text, p_team_count int, p_ppt int,
  p_singles int, p_doubles int, p_groups int, p_advance int, p_third boolean,
  p_courts text[] default '{}'
) returns json language plpgsql security definer set search_path = public as $$
declare v_act uuid; v_tour uuid;
begin
  if not is_admin(p_org) then raise exception '관리자만 대회를 만들 수 있어요'; end if;
  if coalesce(p_singles,0) + coalesce(p_doubles,0) < 1 then raise exception '단식·복식 합이 1경기 이상이어야 해요'; end if;
  insert into activities (org_id, type, title, description, location, repeat_weekly, event_date, created_by)
    values (p_org, 'tournament', p_title, null, p_location, false, p_date, auth.uid())
    returning id into v_act;
  insert into tournaments (org_id, activity_id, title, format, team_count, players_per_team,
    num_singles, num_doubles, num_groups, advance_per_group, third_place, courts, created_by)
    values (p_org, v_act, p_title, p_format, p_team_count, p_ppt,
      coalesce(p_singles,0), coalesce(p_doubles,0), p_groups, coalesce(p_advance,2), coalesce(p_third,false),
      coalesce(p_courts,'{}'), auth.uid())
    returning id into v_tour;
  return json_build_object('tournament_id', v_tour, 'activity_id', v_act);
end $$;

-- seed_bracket: court · play_order 저장 추가
create or replace function public.seed_bracket(p_tour uuid, p_stage text, p_groups jsonb, p_ties jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; g jsonb; t jsonb; m jsonb; v_map jsonb := '{}'::jsonb; v_id uuid;
begin
  select org_id into v_org from tournaments where id = p_tour;
  if not is_admin(v_org) then raise exception '관리자만 대진표를 만들 수 있어요'; end if;
  if p_groups is not null then
    for g in select * from jsonb_array_elements(p_groups) loop
      update tournament_teams set group_label = g->>'group_label'
        where id = (g->>'team_id')::uuid and tournament_id = p_tour;
    end loop;
  end if;
  delete from tournament_ties where tournament_id = p_tour and stage = p_stage;
  for t in select * from jsonb_array_elements(p_ties) loop
    v_map := v_map || jsonb_build_object(t->>'tmp_id', gen_random_uuid()::text);
  end loop;
  for t in select * from jsonb_array_elements(p_ties) loop
    v_id := (v_map->>(t->>'tmp_id'))::uuid;
    insert into tournament_ties (id, tournament_id, stage, group_label, round, bracket_index, label,
      team_a_id, team_b_id, next_slot, court, play_order, status)
    values (v_id, p_tour, p_stage, t->>'group_label',
      nullif(t->>'round','')::int, nullif(t->>'bracket_index','')::int, t->>'label',
      nullif(t->>'team_a_id','')::uuid, nullif(t->>'team_b_id','')::uuid,
      nullif(t->>'next_slot',''), nullif(t->>'court',''), nullif(t->>'play_order','')::int,
      case when nullif(t->>'team_a_id','') is not null and nullif(t->>'team_b_id','') is not null then 'ongoing' else 'pending' end);
    for m in select * from jsonb_array_elements(coalesce(t->'matches','[]'::jsonb)) loop
      insert into tournament_matches (tournament_id, tie_id, slot_type, slot_index, order_index)
      values (p_tour, v_id, m->>'slot_type', (m->>'slot_index')::int, coalesce((m->>'order_index')::int, 0));
    end loop;
  end loop;
  for t in select * from jsonb_array_elements(p_ties) loop
    if nullif(t->>'next_tmp_id','') is not null then
      update tournament_ties set next_tie_id = (v_map->>(t->>'next_tmp_id'))::uuid
        where id = (v_map->>(t->>'tmp_id'))::uuid;
    end if;
  end loop;
  update tournaments set stage = p_stage where id = p_tour;
end $$;

-- record_match: 결과 확정 시각 기록 (피드 정렬용) — 기존 함수 교체
create or replace function public.record_match(p_match uuid, p_ga int, p_gb int, p_tba int, p_tbb int)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tie uuid; v_tour uuid; v_g2w int; v_tbat int; v_tbp int; v_winner text; v_hi int; v_lo int;
  v_total int; v_done int; v_awins int; v_bwins int; v_agames int; v_bgames int;
  v_team_a uuid; v_team_b uuid; v_tiewin uuid; v_next uuid; v_slot text;
begin
  select m.tie_id, m.tournament_id into v_tie, v_tour from tournament_matches m where m.id = p_match;
  if v_tie is null then raise exception '경기를 찾을 수 없어요'; end if;
  select org_id, games_to_win, tiebreak_at, tiebreak_points into v_org, v_g2w, v_tbat, v_tbp from tournaments where id = v_tour;
  if not is_admin(v_org) and not is_tie_captain(v_tie) then raise exception '관리자 또는 해당 팀 조장만 점수를 입력할 수 있어요'; end if;
  if p_ga is null or p_gb is null then raise exception '게임 점수를 입력해주세요'; end if;
  if p_ga = p_gb then raise exception '한 세트는 동점으로 끝날 수 없어요'; end if;
  v_hi := greatest(p_ga, p_gb); v_lo := least(p_ga, p_gb);
  if v_hi <> v_g2w then raise exception '승자는 %게임이어야 해요', v_g2w; end if;
  if v_lo < 0 or v_lo > v_tbat then raise exception '패자 게임 수가 올바르지 않아요'; end if;
  v_winner := case when p_ga > p_gb then 'a' else 'b' end;
  if v_lo = v_tbat then
    if p_tba is null or p_tbb is null then raise exception '5-5 타이브레이크 점수를 입력해주세요'; end if;
    if greatest(p_tba,p_tbb) < v_tbp or (greatest(p_tba,p_tbb) - least(p_tba,p_tbb)) < 2 then
      raise exception '타이브레이크는 %점 이상·2점차로 끝나야 해요', v_tbp; end if;
    if (case when p_tba > p_tbb then 'a' else 'b' end) <> v_winner then
      raise exception '타이브레이크 승자와 게임 승자가 일치해야 해요'; end if;
  else p_tba := null; p_tbb := null; end if;
  update tournament_matches set games_a=p_ga, games_b=p_gb, tb_a=p_tba, tb_b=p_tbb, winner=v_winner,
    status='done', decided_at=now() where id=p_match;
  select team_a_id, team_b_id into v_team_a, v_team_b from tournament_ties where id = v_tie;
  select count(*), count(*) filter (where status='done'), count(*) filter (where winner='a'),
         count(*) filter (where winner='b'), coalesce(sum(games_a),0), coalesce(sum(games_b),0)
    into v_total, v_done, v_awins, v_bwins, v_agames, v_bgames from tournament_matches where tie_id = v_tie;
  if v_done < v_total then
    update tournament_ties set status='ongoing' where id=v_tie and status='pending';
    return;
  end if;
  if v_awins > v_bwins then v_tiewin := v_team_a;
  elsif v_bwins > v_awins then v_tiewin := v_team_b;
  elsif v_agames > v_bgames then v_tiewin := v_team_a;
  elsif v_bgames > v_agames then v_tiewin := v_team_b;
  else v_tiewin := null; end if;
  update tournament_ties set status='done', winner_team_id=v_tiewin where id=v_tie;
  if v_tiewin is not null then
    select next_tie_id, next_slot into v_next, v_slot from tournament_ties where id = v_tie;
    if v_next is not null and v_slot is not null then
      if v_slot='a' then update tournament_ties set team_a_id=v_tiewin where id=v_next;
      else update tournament_ties set team_b_id=v_tiewin where id=v_next; end if;
      update tournament_ties set status='ongoing' where id=v_next and team_a_id is not null and team_b_id is not null and status='pending';
    end if;
  end if;
end $$;

-- reset_match: decided_at도 비우기
create or replace function public.reset_match(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_tie uuid; v_next uuid; v_slot text; v_win uuid; v_nstatus text;
begin
  select m.tie_id, t.org_id into v_tie, v_org from tournament_matches m join tournaments t on t.id=m.tournament_id where m.id=p_match;
  if not is_admin(v_org) then raise exception '관리자만 점수를 초기화할 수 있어요'; end if;
  select next_tie_id, next_slot, winner_team_id into v_next, v_slot, v_win from tournament_ties where id=v_tie;
  if v_next is not null then
    select status into v_nstatus from tournament_ties where id=v_next;
    if v_nstatus='done' then raise exception '다음 대진이 이미 끝나 초기화할 수 없어요'; end if;
  end if;
  update tournament_matches set games_a=null, games_b=null, tb_a=null, tb_b=null, winner=null, status='pending', decided_at=null where id=p_match;
  if v_next is not null and v_win is not null and v_slot is not null then
    if v_slot='a' then update tournament_ties set team_a_id=null, status='pending' where id=v_next;
    else update tournament_ties set team_b_id=null, status='pending' where id=v_next; end if;
  end if;
  update tournament_ties set status='ongoing', winner_team_id=null where id=v_tie;
end $$;

-- ────────────── 대회 공지 ──────────────

create table if not exists public.tournament_posts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments on delete cascade,
  author_id uuid references public.profiles(id),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- 대회에 속한 어떤 팀의 조장인지
create or replace function public.is_tournament_captain(p_tour uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournament_teams where tournament_id = p_tour and captain_id = auth.uid());
$$;

create or replace function public.add_tournament_notice(p_tour uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_name text;
begin
  select org_id into v_org from tournaments where id = p_tour;
  if not is_admin(v_org) and not is_tournament_captain(p_tour) then
    raise exception '관리자 또는 조장만 공지를 쓸 수 있어요';
  end if;
  if coalesce(trim(p_body),'') = '' then raise exception '내용을 입력해주세요'; end if;
  select name into v_name from profiles where id = auth.uid();
  insert into tournament_posts (tournament_id, author_id, author_name, body)
    values (p_tour, auth.uid(), coalesce(v_name,'부원'), trim(p_body));
end $$;

create or replace function public.delete_tournament_notice(p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_author uuid;
begin
  select t.org_id, p.author_id into v_org, v_author
    from tournament_posts p join tournaments t on t.id = p.tournament_id where p.id = p_post;
  if v_author <> auth.uid() and not is_admin(v_org) then raise exception '작성자 또는 관리자만 삭제할 수 있어요'; end if;
  delete from tournament_posts where id = p_post;
end $$;

-- ────────────── 투표(설문) ──────────────

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  author_id uuid not null references public.profiles(id),
  author_name text not null,
  question text not null,
  options text[] not null,
  multi boolean not null default false,        -- 복수 선택 여부
  created_at timestamptz not null default now()
);

create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  user_name text not null,
  option_index int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_index)
);

create or replace function public.vote_poll(p_poll uuid, p_options int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_multi boolean; v_n int; v_name text; i int;
begin
  select org_id, multi, array_length(options,1) into v_org, v_multi, v_n from polls where id = p_poll;
  if v_org is null then raise exception '투표를 찾을 수 없어요'; end if;
  if not is_member(v_org) then raise exception '단체 부원만 투표할 수 있어요'; end if;
  if array_length(p_options,1) is null then raise exception '항목을 선택해주세요'; end if;
  if not v_multi and array_length(p_options,1) > 1 then raise exception '한 항목만 선택할 수 있어요'; end if;
  if exists (select 1 from unnest(p_options) o where o < 0 or o >= v_n) then raise exception '잘못된 항목이에요'; end if;
  select name into v_name from profiles where id = auth.uid();
  delete from poll_votes where poll_id = p_poll and user_id = auth.uid();
  foreach i in array p_options loop
    insert into poll_votes (poll_id, user_id, user_name, option_index)
      values (p_poll, auth.uid(), coalesce(v_name,'부원'), i);
  end loop;
end $$;

-- ────────────── RLS ──────────────

alter table public.tournament_posts enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;

create policy "tposts_select" on public.tournament_posts for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));

create policy "polls_select" on public.polls for select to authenticated using (is_member(org_id));
create policy "polls_insert" on public.polls for insert to authenticated
  with check (author_id = auth.uid() and is_member(org_id));
create policy "polls_delete" on public.polls for delete to authenticated
  using (author_id = auth.uid() or is_admin(org_id));

create policy "pvotes_select" on public.poll_votes for select to authenticated
  using (exists (select 1 from polls p where p.id = poll_id and is_member(p.org_id)));

-- ────────────── 실시간 구독 ──────────────
alter publication supabase_realtime add table public.tournament_posts;
alter publication supabase_realtime add table public.polls;
alter publication supabase_realtime add table public.poll_votes;

-- ============================================================
-- v5: 오더지 비공개 → 양 팀 제출 시 공개
-- ============================================================

alter table public.tournament_ties add column if not exists a_submitted boolean not null default false;
alter table public.tournament_ties add column if not exists b_submitted boolean not null default false;

-- submit_order: 제출하면 그 팀 오더가 잠기고, 양 팀 모두 제출하면 공개(클라이언트에서 판단).
-- 이미 제출한 팀의 오더는 관리자만 수정 가능.
create or replace function public.submit_order(p_tie uuid, p_side text, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_team uuid; v_admin boolean; v_submitted boolean; a jsonb; v_match uuid; v_type text; v_players uuid[];
begin
  select t.org_id into v_org from tournaments t
    join tournament_ties ti on ti.tournament_id = t.id where ti.id = p_tie;
  v_admin := is_admin(v_org);
  if not v_admin and not is_tie_captain(p_tie) then
    raise exception '관리자 또는 해당 팀 조장만 오더를 낼 수 있어요';
  end if;
  if p_side not in ('a','b') then raise exception '잘못된 팀이에요'; end if;

  select case when p_side='a' then team_a_id else team_b_id end,
         case when p_side='a' then a_submitted else b_submitted end
    into v_team, v_submitted from tournament_ties where id = p_tie;
  if v_submitted and not v_admin then raise exception '이미 오더를 제출했어요'; end if;

  for a in select * from jsonb_array_elements(p_assign) loop
    v_match := (a->>'match_id')::uuid;
    select slot_type into v_type from tournament_matches where id = v_match and tie_id = p_tie;
    if v_type is null then raise exception '경기를 찾을 수 없어요'; end if;
    select array_agg(x::uuid) into v_players from jsonb_array_elements_text(a->'players') x;
    v_players := coalesce(v_players, '{}');
    if array_length(v_players,1) is distinct from (case when v_type='singles' then 1 else 2 end) then
      raise exception '%: 출전 인원이 맞지 않아요', (case when v_type='singles' then '단식 1명' else '복식 2명' end);
    end if;
    if exists (select 1 from unnest(v_players) u where u not in
      (select user_id from tournament_team_members where team_id = v_team)) then
      raise exception '팀 명단에 없는 선수예요';
    end if;
    if p_side='a' then update tournament_matches set a_players = v_players where id = v_match;
    else update tournament_matches set b_players = v_players where id = v_match; end if;
  end loop;

  if p_side='a' then update tournament_ties set a_submitted = true where id = p_tie;
  else update tournament_ties set b_submitted = true where id = p_tie; end if;
end $$;

-- 관리자: 제출된 오더 잠금 해제 (수정 허용)
create or replace function public.unlock_order(p_tie uuid, p_side text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select t.org_id into v_org from tournaments t join tournament_ties ti on ti.tournament_id=t.id where ti.id=p_tie;
  if not is_admin(v_org) then raise exception '관리자만 가능해요'; end if;
  if p_side='a' then update tournament_ties set a_submitted=false where id=p_tie;
  else update tournament_ties set b_submitted=false where id=p_tie; end if;
end $$;

-- ============================================================
-- v6: 대회 참가 신청 · 조당 팀수 · 오더 본인 팀 제한
-- ============================================================

-- 조당 팀수 (조 개수 × 조당 팀수 = 총 팀수)
alter table public.tournaments add column if not exists teams_per_group int;

-- ────────────── 대회 참가 신청 ──────────────
create table if not exists public.tournament_participants (
  tournament_id uuid not null references public.tournaments on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  user_name text not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

alter table public.tournament_participants enable row level security;

create policy "tpart_select" on public.tournament_participants for select to authenticated
  using (exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
create policy "tpart_insert" on public.tournament_participants for insert to authenticated
  with check (
    exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id))
    and (user_id = auth.uid()
         or exists (select 1 from tournaments t where t.id = tournament_id and is_admin(t.org_id))));
create policy "tpart_delete" on public.tournament_participants for delete to authenticated
  using (user_id = auth.uid()
    or exists (select 1 from tournaments t where t.id = tournament_id and is_admin(t.org_id)));

alter publication supabase_realtime add table public.tournament_participants;

-- ────────────── 오더지: 본인 팀만 (상대 팀 오더 금지) ──────────────
create or replace function public.submit_order(p_tie uuid, p_side text, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_team uuid; v_admin boolean; v_cap uuid; v_submitted boolean; a jsonb; v_match uuid; v_type text; v_players uuid[];
begin
  select t.org_id into v_org from tournaments t
    join tournament_ties ti on ti.tournament_id = t.id where ti.id = p_tie;
  if p_side not in ('a','b') then raise exception '잘못된 팀이에요'; end if;
  v_admin := is_admin(v_org);

  select case when p_side='a' then team_a_id else team_b_id end,
         case when p_side='a' then a_submitted else b_submitted end
    into v_team, v_submitted from tournament_ties where id = p_tie;
  select captain_id into v_cap from tournament_teams where id = v_team;

  -- 본인 팀 조장 또는 관리자만 (상대 팀 오더 금지)
  if not v_admin and v_cap is distinct from auth.uid() then
    raise exception '본인 팀 조장만 오더를 낼 수 있어요';
  end if;
  if v_submitted and not v_admin then raise exception '이미 오더를 제출했어요'; end if;

  for a in select * from jsonb_array_elements(p_assign) loop
    v_match := (a->>'match_id')::uuid;
    select slot_type into v_type from tournament_matches where id = v_match and tie_id = p_tie;
    if v_type is null then raise exception '경기를 찾을 수 없어요'; end if;
    select array_agg(x::uuid) into v_players from jsonb_array_elements_text(a->'players') x;
    v_players := coalesce(v_players, '{}');
    if array_length(v_players,1) is distinct from (case when v_type='singles' then 1 else 2 end) then
      raise exception '%: 출전 인원이 맞지 않아요', (case when v_type='singles' then '단식 1명' else '복식 2명' end);
    end if;
    if exists (select 1 from unnest(v_players) u where u not in
      (select user_id from tournament_team_members where team_id = v_team)) then
      raise exception '팀 명단에 없는 선수예요';
    end if;
    if p_side='a' then update tournament_matches set a_players = v_players where id = v_match;
    else update tournament_matches set b_players = v_players where id = v_match; end if;
  end loop;

  if p_side='a' then update tournament_ties set a_submitted = true where id = p_tie;
  else update tournament_ties set b_submitted = true where id = p_tie; end if;
end $$;
