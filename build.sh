#!/bin/sh
# 방문자용(공개) 값만 config.js로 만든다: Supabase URL·공개 키, Turnstile 사이트 키 (다른 비밀 키는 옮기지 않음)
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
# Turnstile 사이트 키는 공개용이에요 (시크릿 키는 여기에 넣지 않아요). 없으면 빈 값
tskey=$(get TURNSTILE_SITE_KEY | tr -cd 'A-Za-z0-9_-')
# 체험 로그인 버튼을 보여 줄지(true/false)만 알려요. 이메일·비밀번호는 절대 여기에 넣지 않아요 (서버 환경변수에만 있어요)
if [ -n "$(get DEMO_EMAIL)" ] && [ -n "$(get DEMO_PASSWORD)" ]; then demo=true; else demo=false; fi
printf 'window.SUPABASE_URL = "%s";\nwindow.SUPABASE_ANON_KEY = "%s";\nwindow.TURNSTILE_SITE_KEY = "%s";\nwindow.DEMO_ENABLED = %s;\n' "$url" "$key" "$tskey" "$demo" > "$here/config.js"
echo "config.js 만들었어요"
