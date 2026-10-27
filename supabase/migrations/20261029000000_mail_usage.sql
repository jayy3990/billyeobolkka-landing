-- "메일로 받기" 하루 횟수 제한을 위해 사용 종류에 'mail'(하루 5통)을 추가해요.
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
-- 20261026000000_usage_limits.sql 을 먼저 실행한 상태여야 해요. 기존 한도(추천 5회, 검색 60회)는 그대로예요.

alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events
  add constraint usage_events_kind_check check (kind in ('recommend', 'search', 'mail'));

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

  lim := case p_kind when 'recommend' then 5 when 'search' then 60 when 'mail' then 5 else null end;
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
  lim := case p_kind when 'recommend' then 5 when 'search' then 60 when 'mail' then 5 else null end;
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  select count(*) into used
  from public.usage_events e
  where e.user_id = uid and e.kind = p_kind and e.day = today and e.status = 'reserved';
  return greatest(lim - used, 0);
end;
$$;

revoke execute on function public.reserve_usage(text)   from public, anon;
revoke execute on function public.usage_remaining(text) from public, anon;
grant  execute on function public.reserve_usage(text)   to authenticated;
grant  execute on function public.usage_remaining(text) to authenticated;
