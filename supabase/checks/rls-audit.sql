-- RLS 점검: public 스키마에서 RLS(행 단위 접근 제한)가 꺼진 표를 찾아요.
-- 실행 방법: Supabase 대시보드 > SQL Editor 에 붙여 넣고 Run (읽기만 하고 아무것도 바꾸지 않아요).
-- 결과의 rls_enabled 가 false 인 표는 공개(anon) 키로 누구나 읽거나 고칠 수 있을 수 있어요.
-- → 그런 표가 있으면 `alter table public.표이름 enable row level security;` 후 필요한 정책만 추가하세요.

select
  c.relname                as table_name,
  c.relrowsecurity         as rls_enabled,
  c.relforcerowsecurity    as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')   -- 일반 표, 파티션 표
order by c.relrowsecurity, c.relname;

-- (참고) anon/authenticated 에게 열려 있는 표 권한 확인
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee
order by table_name, grantee;
