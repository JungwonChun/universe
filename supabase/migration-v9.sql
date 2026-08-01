-- ============================================================
-- v9: 공동 조장(co-captain) 지원 + D팀에 이원준 공동 조장 추가
-- 이미 v8까지 적용한 프로젝트에서 한 번 실행하세요.
-- ============================================================

-- 1) 공동 조장 컬럼
alter table public.tournament_teams add column if not exists co_captains uuid[] not null default '{}';

-- 2) 권한 함수들: captain_id 뿐 아니라 co_captains 도 조장으로 인정
create or replace function public.is_tie_captain(p_tie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tournament_ties t
    join tournament_teams tm on tm.id in (t.team_a_id, t.team_b_id)
    where t.id = p_tie and (tm.captain_id = auth.uid() or auth.uid() = any(tm.co_captains))
  );
$$;

create or replace function public.is_tournament_captain(p_tour uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournament_teams
    where tournament_id = p_tour and (captain_id = auth.uid() or auth.uid() = any(co_captains)));
$$;

create or replace function public.submit_order(p_tie uuid, p_side text, p_assign jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_team uuid; v_admin boolean; v_cap uuid; v_cocaps uuid[]; v_submitted boolean; a jsonb; v_match uuid; v_type text; v_players uuid[];
begin
  select t.org_id into v_org from tournaments t
    join tournament_ties ti on ti.tournament_id = t.id where ti.id = p_tie;
  if p_side not in ('a','b') then raise exception '잘못된 팀이에요'; end if;
  v_admin := is_admin(v_org);
  select case when p_side='a' then team_a_id else team_b_id end,
         case when p_side='a' then a_submitted else b_submitted end
    into v_team, v_submitted from tournament_ties where id = p_tie;
  select captain_id, co_captains into v_cap, v_cocaps from tournament_teams where id = v_team;

  if not v_admin and v_cap is distinct from auth.uid() and not (auth.uid() = any(coalesce(v_cocaps,'{}'))) then
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

-- 3) D팀 공동 조장에 이원준 추가 (실전 + 연습 대회)
update public.tournament_teams
set co_captains = array['110cd330-ad58-4549-9093-6d907e471b62'::uuid]
where name = 'D팀'
  and tournament_id in ('cd439a21-c088-4072-a5b8-96b664958611','5f604aa8-7c5e-415f-bf46-15373caa5813');
