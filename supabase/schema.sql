-- ============================================================
-- 스매시 (동아리 운영 PWA) 데이터베이스 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
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
  open_day int not null default 0,            -- 자동 오픈 요일 (0=일 ~ 6=토)
  open_time time not null default '21:00',    -- 자동 오픈 시각
  override_state text,                        -- 'open' | 'closed' | null(자동)
  override_week text,                         -- override가 적용되는 주 (해당 주 월요일 YYYY-MM-DD)
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

create table public.class_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  day_of_week int not null,                   -- 0=일 ~ 6=토
  start_time time not null,
  end_time time not null,
  capacity int not null default 6,
  created_at timestamptz not null default now()
);

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  slot_id uuid not null references public.class_slots on delete cascade,
  week_key text not null,                     -- 대상 주 월요일 (YYYY-MM-DD)
  user_id uuid not null references public.profiles on delete cascade,
  status text not null,                       -- 'confirmed' | 'waitlist'
  created_at timestamptz not null default now(),
  unique (slot_id, week_key, user_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  date date not null,
  title text not null,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
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

-- ────────────── 선착순 신청 / 취소 (동시 클릭 안전) ──────────────

create or replace function public.signup_slot(p_slot uuid, p_week text)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_cap int; v_count int; v_status text;
begin
  select org_id, capacity into v_org, v_cap from class_slots where id = p_slot;
  if v_org is null then raise exception '존재하지 않는 타임이에요'; end if;
  if not is_member(v_org) then raise exception '단체 부원만 신청할 수 있어요'; end if;

  -- 같은 슬롯·주에 대한 요청을 한 줄로 세움 (마지막 한 자리 동시 클릭 문제 방지)
  perform pg_advisory_xact_lock(hashtext(p_slot::text || p_week));

  if exists (select 1 from signups where slot_id = p_slot and week_key = p_week and user_id = auth.uid()) then
    return 'already';
  end if;

  select count(*) into v_count from signups
    where slot_id = p_slot and week_key = p_week and status = 'confirmed';
  v_status := case when v_count < v_cap then 'confirmed' else 'waitlist' end;

  insert into signups (org_id, slot_id, week_key, user_id, status)
    values (v_org, p_slot, p_week, auth.uid(), v_status);
  return v_status;
end $$;

create or replace function public.cancel_slot(p_slot uuid, p_week text)
returns json language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_was text; v_promoted uuid; v_promoted_name text;
begin
  select org_id into v_org from class_slots where id = p_slot;
  perform pg_advisory_xact_lock(hashtext(p_slot::text || p_week));

  delete from signups
    where slot_id = p_slot and week_key = p_week and user_id = auth.uid()
    returning status into v_was;
  if v_was is null then return json_build_object('cancelled', false); end if;

  -- 확정 자리가 비면 대기 1번 자동 승급
  if v_was = 'confirmed' then
    select s.user_id into v_promoted from signups s
      where s.slot_id = p_slot and s.week_key = p_week and s.status = 'waitlist'
      order by s.created_at asc limit 1;
    if v_promoted is not null then
      update signups set status = 'confirmed'
        where slot_id = p_slot and week_key = p_week and user_id = v_promoted;
      select name into v_promoted_name from profiles where id = v_promoted;
    end if;
  end if;

  return json_build_object('cancelled', true, 'was', v_was, 'promoted_name', v_promoted_name);
end $$;

-- 정원 변경 (늘어나면 대기자 자동 승급)
create or replace function public.set_capacity(p_slot uuid, p_week text, p_cap int)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_count int; v_next uuid;
begin
  select org_id into v_org from class_slots where id = p_slot;
  if not is_admin(v_org) then raise exception '관리자만 변경할 수 있어요'; end if;
  if p_cap < 0 or p_cap > 50 then raise exception '정원은 0~50명 사이여야 해요'; end if;

  perform pg_advisory_xact_lock(hashtext(p_slot::text || p_week));
  update class_slots set capacity = p_cap where id = p_slot;

  loop
    select count(*) into v_count from signups
      where slot_id = p_slot and week_key = p_week and status = 'confirmed';
    exit when v_count >= p_cap;
    select user_id into v_next from signups
      where slot_id = p_slot and week_key = p_week and status = 'waitlist'
      order by created_at asc limit 1;
    exit when v_next is null;
    update signups set status = 'confirmed'
      where slot_id = p_slot and week_key = p_week and user_id = v_next;
  end loop;
end $$;

-- ────────────── RLS (행 수준 보안) ──────────────

alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.org_codes enable row level security;
alter table public.memberships enable row level security;
alter table public.class_slots enable row level security;
alter table public.signups enable row level security;
alter table public.events enable row level security;
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

-- class_slots: 부원 조회, 관리자 관리
create policy "slots_select" on public.class_slots for select to authenticated using (is_member(org_id));
create policy "slots_insert" on public.class_slots for insert to authenticated with check (is_admin(org_id));
create policy "slots_update" on public.class_slots for update to authenticated using (is_admin(org_id));
create policy "slots_delete" on public.class_slots for delete to authenticated using (is_admin(org_id));

-- signups: 부원 조회만 가능 (신청/취소는 함수로만 — 정원·대기열 로직 우회 방지)
create policy "signups_select" on public.signups for select to authenticated using (is_member(org_id));

-- events: 부원 조회, 관리자 작성/수정/삭제
create policy "events_select" on public.events for select to authenticated using (is_member(org_id));
create policy "events_insert" on public.events for insert to authenticated with check (is_admin(org_id));
create policy "events_update" on public.events for update to authenticated using (is_admin(org_id));
create policy "events_delete" on public.events for delete to authenticated using (is_admin(org_id));

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

-- ────────────── 실시간 구독 (취소 시 즉시 자리 반영) ──────────────
alter publication supabase_realtime add table public.signups;
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_joins;
