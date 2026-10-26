-- 사용자별 추천 선호 설정 저장 (도서관·연령대·성별·관심 장르·좋아한 책)
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
--
-- 보안·개인정보 원칙
--  1) RLS(행 단위 접근 제한): 로그인한 사용자는 "본인 행만" 읽고·쓰고·지울 수 있어요. 로그인 안 한 사람(anon)은 아무 권한이 없어요.
--  2) 사용자당 1행(user_id가 기본키)이고, user_id 칸은 한 번 만들면 못 바꿔요(칸 단위 권한).
--  3) 값의 범위는 DB 제약(CHECK)으로도 막아요. 서버(api/preferences.js)도 같은 허용 목록으로 먼저 검사해요.
--  4) 계정이 삭제되면 같이 지워져요(on delete cascade). 사용자는 계정 페이지에서 언제든 지울 수 있어요.
--  5) service_role 키는 필요 없어요. 서버는 로그인한 사용자 본인의 권한으로만 이 표를 다뤄요.

create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  lib_code   text check (lib_code is null or lib_code ~ '^[0-9]{5,8}$'),
  age_group  text not null default 'any' check (age_group in ('any', 'teen', '20s', '30s', '40s', '50s', '60s')),
  gender     text not null default 'any' check (gender in ('any', 'male', 'female')),
  genres     text[] not null default '{}'
             check (
               cardinality(genres) <= 3
               and genres <@ array['novel','poetry','essay','humanities','psychology','economy','society','science','tech','art','history']::text[]
             ),
  liked      jsonb not null default '[]'::jsonb
             check (jsonb_typeof(liked) = 'array' and jsonb_array_length(liked) <= 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

-- 권한은 처음부터 모두 거두고, 필요한 것만 다시 줘요 (user_id는 만들 때만 넣을 수 있고 고칠 수 없어요)
revoke all on public.user_preferences from anon, authenticated;
grant select on public.user_preferences to authenticated;
grant insert (user_id, lib_code, age_group, gender, genres, liked) on public.user_preferences to authenticated;
grant update (lib_code, age_group, gender, genres, liked) on public.user_preferences to authenticated;
grant delete on public.user_preferences to authenticated;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_preferences_delete_own" on public.user_preferences;
create policy "user_preferences_delete_own"
  on public.user_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 수정 시각 자동 갱신 (프로필 마이그레이션에서 만든 것과 같은 함수예요. 없으면 여기서 만들어요)
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

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();
