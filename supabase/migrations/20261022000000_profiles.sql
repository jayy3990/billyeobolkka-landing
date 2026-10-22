-- 사용자 프로필 표 (회원가입 기능용)
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
--
-- 보안 원칙
--  1) RLS(행 단위 접근 제한)를 켜서, 로그인한 사용자는 "본인 행만" 읽고 고칠 수 있어요.
--  2) 로그인하지 않은 사람(anon)은 아무 권한이 없어요.
--  3) 행 만들기(INSERT)는 가입할 때 자동으로 도는 트리거만 해요. 사용자가 직접 만들거나 지울 수 없어요.
--  4) 고칠 수 있는 칸도 display_name 하나뿐이에요 (id, created_at 등은 못 바꿔요).
--  5) service_role 키는 필요 없어요.

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- 권한은 처음부터 모두 거두고, 필요한 것만 다시 줘요
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- INSERT / DELETE 정책은 일부러 만들지 않아요 (사용자가 직접 못 하게)

-- 수정 시각 자동 갱신
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 가입하면 프로필 행을 자동으로 만들어요 (security definer: 가입 처리 권한으로만 실행)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

-- 이 함수는 트리거로만 쓰고, 누구도 직접 부르지 못하게 해요
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 가입한 사용자가 있다면 프로필 행을 채워 줘요
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
