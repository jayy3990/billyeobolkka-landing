-- 추천 기록 (사용자가 받은 AI 도서 추천 결과를 계정에 남겨 두고 다시 볼 수 있게)
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run. (여러 번 실행해도 안전해요)
--
-- 보안·개인정보 원칙
--  1) RLS(행 단위 접근 제한): 로그인한 사용자는 "본인 기록만" 읽고·추가하고·지울 수 있어요. 로그인 안 한 사람(anon)은 아무 권한이 없어요.
--  2) 기록은 수정할 수 없어요(UPDATE 권한·정책 없음). 추가와 삭제만 가능해요.
--  3) 추가할 때 user_id는 로그인한 본인 id여야만 통과해요(정책의 WITH CHECK). id·created_at은 자동으로 채워져요.
--  4) 값의 범위는 DB 제약(CHECK)으로도 막아요. 서버(api/recommend.js)도 같은 허용 목록·길이 제한을 먼저 적용해요.
--  5) 오래된 기록은 서버가 추천 직후에 정리해요(사용자당 최근 30건만 보관). 계정이 삭제되면 같이 지워져요.
--  6) service_role 키는 필요 없어요. 서버는 로그인한 사용자 본인의 권한으로만 이 표를 다뤄요.

create table if not exists public.recommendation_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  lang       text not null default 'ko' check (lang in ('ko', 'en')),
  lib_code   text not null check (lib_code ~ '^[0-9]{5,8}$'),
  age_group  text not null default 'any' check (age_group in ('any', 'teen', '20s', '30s', '40s', '50s', '60s')),
  gender     text not null default 'any' check (gender in ('any', 'male', 'female')),
  genres     text[] not null
             check (
               cardinality(genres) between 1 and 3
               and genres <@ array['novel','poetry','essay','humanities','psychology','economy','society','science','tech','art','history']::text[]
             ),
  liked      jsonb not null default '[]'::jsonb
             check (jsonb_typeof(liked) = 'array' and jsonb_array_length(liked) <= 3),
  items      jsonb not null
             check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 8)
);

create index if not exists recommendation_history_user_created_idx
  on public.recommendation_history (user_id, created_at desc);

alter table public.recommendation_history enable row level security;
alter table public.recommendation_history force row level security;

-- 권한은 처음부터 모두 거두고, 필요한 것만 다시 줘요 (수정 권한은 주지 않아요)
revoke all on public.recommendation_history from anon, authenticated;
grant select on public.recommendation_history to authenticated;
grant insert (user_id, lang, lib_code, age_group, gender, genres, liked, items) on public.recommendation_history to authenticated;
grant delete on public.recommendation_history to authenticated;

drop policy if exists "recommendation_history_select_own" on public.recommendation_history;
create policy "recommendation_history_select_own"
  on public.recommendation_history for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "recommendation_history_insert_own" on public.recommendation_history;
create policy "recommendation_history_insert_own"
  on public.recommendation_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "recommendation_history_delete_own" on public.recommendation_history;
create policy "recommendation_history_delete_own"
  on public.recommendation_history for delete to authenticated
  using ((select auth.uid()) = user_id);
