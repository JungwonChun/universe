-- ============================================================
-- v4 마이그레이션: 코트 배정 · 대회 공지 · 투표(설문) · 경기 결과 시각
-- 이미 v3(대회)까지 적용한 Supabase 프로젝트에서 한 번 실행하세요.
-- 기존 데이터는 유지됩니다 (컬럼/테이블 추가).
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
