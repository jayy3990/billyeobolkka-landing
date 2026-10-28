-- 대회 체험 계정의 하루 한도를 높여요 (추천 100회, 검색 300회, 메일 30통). 일반 계정은 그대로(5/60/5)예요.
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
-- 20261026000000_usage_limits.sql, 20261029000000_mail_usage.sql 을 먼저 실행한 상태여야 해요.
--
-- 보안 원칙
--  1) 체험 계정 목록(demo_users)은 RLS를 켜고 정책을 만들지 않아요 → 로그인한 사용자도 읽거나 고칠 수 없어요.
--  2) 한도는 DB 함수 안에서만 정해지고, 호출한 사람(auth.uid())이 목록에 있을 때만 높아져요. 요청으로 바꿀 수 없어요.
--  3) service_role 키는 필요 없어요.

create table if not exists public.demo_users (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.demo_users enable row level security;
alter table public.demo_users force row level security;
revoke all on public.demo_users from anon, authenticated;

-- 사용자별 한도 (함수 안에서만 써요)
create or replace function public.usage_limit_for(p_uid uuid, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.demo_users d where d.user_id = p_uid) then
      case p_kind when 'recommend' then 100 when 'search' then 300 when 'mail' then 30 else null end
    else
      case p_kind when 'recommend' then 5 when 'search' then 60 when 'mail' then 5 else null end
  end;
$$;
revoke execute on function public.usage_limit_for(uuid, text) from public, anon, authenticated;

create or replace function public.reserve_usage(p_kind text)
returns table (allowed boolean, event_id uuid, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := auth.uid();
  lim      integer;
  today    date := (now() at time zone 'Asia/Seoul')::date;
  used     integer;
  new_id   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  lim := public.usage_limit_for(uid, p_kind);
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text || ':' || p_kind, 0));

  select count(*) into used
  from public.usage_events e
  where e.user_id = uid and e.kind = p_kind and e.day = today and e.status = 'reserved';

  if used >= lim then
    return query select false, null::uuid, 0;
    return;
  end if;

  insert into public.usage_events (user_id, kind, day)
  values (uid, p_kind, today)
  returning id into new_id;

  return query select true, new_id, lim - used - 1;
end;
$$;

create or replace function public.usage_remaining(p_kind text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  lim   integer;
  today date := (now() at time zone 'Asia/Seoul')::date;
  used  integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  lim := public.usage_limit_for(uid, p_kind);
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  select count(*) into used
  from public.usage_events e
  where e.user_id = uid and e.kind = p_kind and e.day = today and e.status = 'reserved';
  return greatest(lim - used, 0);
end;
$$;

-- 화면 표시용: 내 하루 한도
create or replace function public.usage_limit(p_kind text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  lim := public.usage_limit_for(uid, p_kind);
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  return lim;
end;
$$;

revoke execute on function public.reserve_usage(text)   from public, anon;
revoke execute on function public.usage_remaining(text) from public, anon;
revoke execute on function public.usage_limit(text)     from public, anon;
grant  execute on function public.reserve_usage(text)   to authenticated;
grant  execute on function public.usage_remaining(text) to authenticated;
grant  execute on function public.usage_limit(text)     to authenticated;

-- ▼▼ 여기부터는 체험 계정을 만든 "뒤에" 따로 실행해요. 아래 이메일을 체험 계정의 이메일로 바꿔서 실행하세요. ▼▼
-- insert into public.demo_users (user_id)
--   select id from auth.users where email = '체험계정이메일@example.com'
--   on conflict do nothing;
