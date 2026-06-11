-- ============================================================
-- v1 → v2 마이그레이션: 수업 타임/행사를 통합 일정 시스템으로 교체
-- 이미 v1 schema.sql 을 실행한 Supabase 프로젝트에서 한 번 실행하세요.
-- ⚠️ 기존 수업 타임·신청·행사 데이터는 삭제됩니다.
-- ============================================================

-- 1) 기존 시스템 제거
drop function if exists public.signup_slot(uuid, text);
drop function if exists public.cancel_slot(uuid, text);
drop function if exists public.set_capacity(uuid, text, int);
drop table if exists public.signups;
drop table if exists public.class_slots;
drop table if exists public.events;
alter table public.orgs
  drop column if exists open_day,
  drop column if exists open_time,
  drop column if exists override_state,
  drop column if exists override_week;

-- 2) 통합 일정 테이블
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

create table public.activity_opens (
  activity_id uuid not null references public.activities on delete cascade,
  occ_date date not null,
  state text not null,                        -- 'open' | 'closed'
  primary key (activity_id, occ_date)
);

create table public.activity_signups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  activity_id uuid not null references public.activities on delete cascade,
  occ_date date not null,
  user_id uuid not null references public.profiles on delete cascade,
  status text not null,                       -- 'confirmed' | 'waitlist'
  created_at timestamptz not null default now(),
  unique (activity_id, occ_date, user_id)
);

-- 3) 함수
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

-- 4) RLS
alter table public.activities enable row level security;
alter table public.activity_opens enable row level security;
alter table public.activity_signups enable row level security;

create policy "activities_select" on public.activities for select to authenticated using (is_member(org_id));
create policy "activities_insert" on public.activities for insert to authenticated with check (is_admin(org_id));
create policy "activities_update" on public.activities for update to authenticated using (is_admin(org_id));
create policy "activities_delete" on public.activities for delete to authenticated using (is_admin(org_id));

create policy "activity_opens_select" on public.activity_opens for select to authenticated
  using (exists (select 1 from activities a where a.id = activity_id and is_member(a.org_id)));

create policy "activity_signups_select" on public.activity_signups for select to authenticated using (is_member(org_id));

-- 5) 실시간 구독
alter publication supabase_realtime add table public.activities;
alter publication supabase_realtime add table public.activity_opens;
alter publication supabase_realtime add table public.activity_signups;
