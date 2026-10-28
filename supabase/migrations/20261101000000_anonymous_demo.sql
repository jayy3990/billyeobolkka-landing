-- 대회 체험을 "방문자마다 임시(익명) 계정"으로 바꿔요. 공용 체험 계정(demo_users)은 없애요.
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
-- 20261031000000_demo_account.sql 을 먼저 실행한 상태여야 해요. 일반 계정 한도(추천 5, 검색 60, 메일 5)는 그대로예요.
--
-- 임시 계정의 하루 한도: 추천 20회, 검색 100회, 메일 0통(이메일이 없어서 메일을 받을 수 없어요).
-- 한도는 DB 함수 안에서만 정해져요. 호출한 사람의 로그인 정보(JWT)의 is_anonymous 값을 보고 정하고, 요청으로 바꿀 수 없어요.

create or replace function public.usage_limit_for(p_uid uuid, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
      case p_kind when 'recommend' then 20 when 'search' then 100 when 'mail' then 0 else null end
    else
      case p_kind when 'recommend' then 5 when 'search' then 60 when 'mail' then 5 else null end
  end;
$$;
revoke execute on function public.usage_limit_for(uuid, text) from public, anon, authenticated;

-- 공용 체험 계정 목록은 더 쓰지 않아요
drop table if exists public.demo_users;

-- ▼ 행사가 끝난 뒤(선택): 임시 계정과 그 데이터(서재·기록·설정)를 모두 지워요. 먼저 개수를 확인하세요.
-- select count(*) from auth.users where is_anonymous;
-- delete from auth.users where is_anonymous;
