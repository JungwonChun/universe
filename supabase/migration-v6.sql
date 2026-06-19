-- ============================================================
-- v6 마이그레이션: 대회 참가 신청 · 조당 팀수 · 오더 본인 팀 제한
-- 이미 v5까지 적용한 Supabase 프로젝트에서 한 번 실행하세요.
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
  with check (user_id = auth.uid()
    and exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id)));
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
