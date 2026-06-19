-- ============================================================
-- v7 마이그레이션: 관리자가 대회 참가자를 직접 추가할 수 있도록 허용
-- 이미 v6까지 적용한 Supabase 프로젝트에서 한 번 실행하세요.
-- ============================================================

drop policy if exists "tpart_insert" on public.tournament_participants;
create policy "tpart_insert" on public.tournament_participants for insert to authenticated
  with check (
    exists (select 1 from tournaments t where t.id = tournament_id and is_member(t.org_id))
    and (user_id = auth.uid()
         or exists (select 1 from tournaments t where t.id = tournament_id and is_admin(t.org_id)))
  );
