#!/bin/sh
# Supabase 방문자용 값 두 개만 config.js로 만든다 (다른 비밀 키는 옮기지 않음)
# 값은 환경변수(Vercel)에서 먼저 찾고, 없으면 작업 폴더의 .env에서 읽는다
here="$(cd "$(dirname "$0")" && pwd)"
# 한국어·영어 페이지 만들기 (src/*.template.html + i18n/*.json)
node "$here/build-i18n.js" || exit 1
envfile="$here/../../.env"
get() { # 이름 -> 값
  eval "v=\${$1:-}"
  [ -z "$v" ] && [ -f "$envfile" ] && v=$(grep "^$1=" "$envfile" | cut -d= -f2- | tr -d '\r"')
  printf '%s' "$v"
}
url=$(get SUPABASE_URL); key=$(get SUPABASE_ANON_KEY)
[ -z "$url" ] || [ -z "$key" ] && { echo "SUPABASE_URL 또는 SUPABASE_ANON_KEY가 비어 있어요" >&2; exit 1; }
printf 'window.SUPABASE_URL = "%s";\nwindow.SUPABASE_ANON_KEY = "%s";\n' "$url" "$key" > "$here/config.js"
echo "config.js 만들었어요"
