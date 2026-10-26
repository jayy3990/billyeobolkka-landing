-- 하루 사용 횟수 제한 (AI 도서 추천: 하루 5회, 책 검색: 하루 60회)
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
--
-- 보안 원칙
--  1) 사용 기록 표(usage_events)는 RLS를 켜고 정책을 하나도 만들지 않아요. → 로그인한 사용자도 표를 직접 읽거나 고칠 수 없어요.
--  2) 횟수는 아래 DB 함수로만 올리고 내려요. 함수가 호출한 사람(auth.uid())의 기록만 다뤄요.
--  3) "되돌리기(refund)"는 서버만 아는 event_id가 있어야 해요. 사용자는 표를 못 읽어서 id를 알 수 없고, 응답에도 id를 주지 않아요.
--  4) 한도는 함수 안에 고정돼 있어서 요청으로 바꿀 수 없어요. 날짜 기준은 한국 시간(KST) 자정이에요.
--  5) service_role 키는 필요 없어요.

create table if not exists public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('recommend', 'search')),
  day        date not null,
  status     text not null default 'reserved' check (status in ('reserved', 'refunded')),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_day_kind_idx
  on public.usage_events (user_id, day, kind)
  where status = 'reserved';

alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;
revoke all on public.usage_events from anon, authenticated;
-- 정책을 일부러 만들지 않아요 (표 직접 접근 불가)

-- 횟수 확보: 한도 안이면 기록을 하나 만들고 (allowed=true, event_id, 남은 횟수) 를 돌려줘요.
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

  lim := case p_kind when 'recommend' then 5 when 'search' then 60 else null end;
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  -- 같은 사용자가 동시에 여러 번 눌러도 한도를 넘지 못하게 줄을 세워요
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

-- 되돌리기: 방금(10분 안) 확보한 내 기록만, 한 번만. 추천이 만들어지지 못했을 때 서버가 불러요.
create or replace function public.refund_usage(p_event uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n   integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.usage_events
     set status = 'refunded'
   where id = p_event
     and user_id = uid
     and status = 'reserved'
     and created_at > now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- 오늘 남은 횟수 (화면 표시용)
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
  lim := case p_kind when 'recommend' then 5 when 'search' then 60 else null end;
  if lim is null then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  select count(*) into used
  from public.usage_events e
  where e.user_id = uid and e.kind = p_kind and e.day = today and e.status = 'reserved';
  return greatest(lim - used, 0);
end;
$$;

-- 로그인한 사용자만 이 함수들을 부를 수 있어요 (로그인 안 한 사람(anon)은 불가)
revoke execute on function public.reserve_usage(text)   from public, anon;
revoke execute on function public.refund_usage(uuid)    from public, anon;
revoke execute on function public.usage_remaining(text) from public, anon;
grant  execute on function public.reserve_usage(text)   to authenticated;
grant  execute on function public.refund_usage(uuid)    to authenticated;
grant  execute on function public.usage_remaining(text) to authenticated;

-- 오래된 기록 정리(선택): 30일이 지난 기록은 지워도 돼요. 필요하면 SQL Editor에서 수동으로 실행하세요.
-- delete from public.usage_events where created_at < now() - interval '30 days';
