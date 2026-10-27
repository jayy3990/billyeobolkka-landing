-- 내 서재: 사용자가 읽은 책 목록 (+ 선택 평가)
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
--
-- 보안·개인정보 원칙
--  1) RLS(행 단위 접근 제한): 로그인한 사용자는 "본인 행만" 읽고·추가하고·평가를 바꾸고·지울 수 있어요. 로그인 안 한 사람(anon)은 권한이 없어요.
--  2) 같은 책(ISBN)은 사용자당 한 번만 담겨요(unique). user_id·isbn13·제목·저자는 담은 뒤 고칠 수 없고, 평가(rating)만 바꿀 수 있어요.
--  3) 제목·저자는 서버가 정보나루(또는 본인의 추천 기록)에서 가져온 값만 저장해요. 값의 범위는 CHECK로도 막아요.
--  4) 한 사용자가 300권을 넘기지 못하게 DB에서도 막아요(트리거).
--  5) 계정이 삭제되면 같이 지워져요(on delete cascade). service_role 키는 필요 없어요.

create table if not exists public.user_library (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  isbn13     text not null check (isbn13 ~ '^[0-9]{13}$'),
  title      text not null check (char_length(title) between 1 and 80),
  author     text not null default '' check (char_length(author) <= 40),
  rating     text check (rating is null or rating in ('liked', 'ok', 'disliked')),
  added_at   timestamptz not null default now(),
  unique (user_id, isbn13)
);

create index if not exists user_library_user_added_idx on public.user_library (user_id, added_at desc);

alter table public.user_library enable row level security;
alter table public.user_library force row level security;

revoke all on public.user_library from anon, authenticated;
grant select on public.user_library to authenticated;
grant insert (user_id, isbn13, title, author, rating) on public.user_library to authenticated;
grant update (rating) on public.user_library to authenticated;
grant delete on public.user_library to authenticated;

drop policy if exists "user_library_select_own" on public.user_library;
create policy "user_library_select_own"
  on public.user_library for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_library_insert_own" on public.user_library;
create policy "user_library_insert_own"
  on public.user_library for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_library_update_own" on public.user_library;
create policy "user_library_update_own"
  on public.user_library for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_library_delete_own" on public.user_library;
create policy "user_library_delete_own"
  on public.user_library for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 사용자당 300권 제한 (서버도 먼저 검사하지만 DB에서도 막아요)
create or replace function public.user_library_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.user_library where user_id = new.user_id) >= 300 then
    raise exception 'user_library_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.user_library_limit() from public, anon, authenticated;

drop trigger if exists user_library_limit_trg on public.user_library;
create trigger user_library_limit_trg
  before insert on public.user_library
  for each row execute function public.user_library_limit();
