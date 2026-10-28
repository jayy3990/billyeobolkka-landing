-- 추천 기록에 "추천 방식"(일반/모험) 칸을 추가해요. 기존 기록은 모두 'normal'이 돼요.
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
-- 20261027000000_recommendation_history.sql 을 먼저 실행한 상태여야 해요.
--
-- 보안: 값은 두 가지로만 제한(CHECK)하고, 추가(insert) 권한만 이 칸에 줘요. 수정(update) 권한은 여전히 없어요.

alter table public.recommendation_history
  add column if not exists mode text not null default 'normal';

alter table public.recommendation_history drop constraint if exists recommendation_history_mode_check;
alter table public.recommendation_history
  add constraint recommendation_history_mode_check check (mode in ('normal', 'adventure'));

grant insert (mode) on public.recommendation_history to authenticated;
