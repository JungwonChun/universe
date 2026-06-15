-- ============================================================
-- v5 마이그레이션: 오더지 비공개 → 양 팀 제출 시 공개
-- 이미 v4까지 적용한 Supabase 프로젝트에서 한 번 실행하세요.
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
