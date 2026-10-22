# 확인 메일 설치 안내 (Supabase 방식)

신청 → `signups` 표에 새 줄 → **웹훅**이 **send-confirmation 함수**를 부름 → Resend로 확인 메일.
Resend 키는 웹페이지에 없고 Supabase 비밀값에만 들어가요. 표에 저장이 실패한 중복 신청은 웹훅이 안 울려서 메일도 안 가요.

아래는 모두 [supabase.com/dashboard](https://supabase.com/dashboard)에서 프로젝트를 열고 해요. (도구 설치 없이 화면에서만)

## 1. 함수 올리기
1. 왼쪽 **Edge Functions** → **Deploy a new function** → **Via Editor**
2. 이름: `send-confirmation`
3. `supabase/functions/send-confirmation/index.ts` 내용을 전부 복사해 붙여 넣기
4. **Deploy function**
5. 올린 뒤 함수 **Details/Settings**에서 **Verify JWT(Enforce JWT verification)** 를 **끄기** (웹훅은 로그인 정보 대신 아래 암호로 확인해요)

## 2. 비밀값 넣기
**Edge Functions → Secrets** (또는 Project Settings → Edge Functions)에서 추가:

| 이름 | 값 |
|---|---|
| `RESEND_API_KEY` | `.env`의 `RESEND_API_KEY` 값 |
| `WEBHOOK_SECRET` | 아무도 모를 긴 암호 (예: 영문+숫자 32자 이상). 3번에도 똑같이 넣어요 |
| `FROM_EMAIL` | (선택) 도메인 인증 전에는 비워 두세요. 기본값 `빌려볼까 <onboarding@resend.dev>` |

## 3. 웹훅 연결
**Database → Webhooks → Create a new hook**
- Name: `signups-confirmation`
- Table: `signups` / Events: **Insert** 만 체크
- Type: **HTTP Request** / Method: **POST**
- URL: `https://sylqxlanqizydatcrikj.supabase.co/functions/v1/send-confirmation`
- HTTP Headers: `Content-Type: application/json` 과 `x-webhook-secret: (2번의 WEBHOOK_SECRET 값)`
- **Create webhook**

## 4. 시험
1. 랜딩페이지에서 **내 메일**로 신청해요. (같은 이메일을 이미 넣었다면 다른 주소 또는 `+test` 별칭을 써요)
2. 몇 초 안에 "[빌려볼까] 사전신청 고마워요!" 메일이 오는지 확인해요. 스팸함도 봐요.
3. 안 오면 **Edge Functions → send-confirmation → Logs**를 봐요.
   - `401`: 웹훅 헤더의 암호가 2번과 달라요
   - `Resend 실패 403`: 도메인 인증 전이라 **Resend 가입 메일 주소로만** 보낼 수 있어요

## 지금 제한
- 도메인을 인증하기 전에는 Resend 가입 메일 주소 한 곳으로만 갈 수 있어요. 실제 방문자에게 보내려면 도메인 인증 후 `FROM_EMAIL`을 바꿔요.

# 홈페이지 문의 메일 설치 안내 (Vercel 방식)

홈페이지 맨 아래 **문의** 폼 → `api/contact.js`(Vercel 서버 함수) → Resend → 내 이메일. 받은 메일에서 바로 답장하면 문의한 사람에게 가요(reply-to).

Vercel → 프로젝트 → **Settings → Environment Variables**에 추가한 뒤 **다시 배포(Redeploy)** 해요.

| 이름 | 값 |
|---|---|
| `RESEND_API_KEY` | Resend 키 (사전신청 메일에 이미 넣었다면 그대로 써요) |
| `CONTACT_TO_EMAIL` | 문의를 받을 내 이메일. 도메인 인증 전에는 **Resend 가입 메일 주소**만 가능해요 |
| `CONTACT_FROM_EMAIL` | (선택) 기본값 `빌려볼까 <onboarding@resend.dev>` |

- 로컬 시험: 작업 폴더 맨 위 `.env`에 같은 이름으로 넣으면 함수가 읽어요. 실행은 `vercel dev`.
- 사전신청 페이지는 `/apply`, 홈페이지는 `/` 예요.

# 다국어(한국어·영어) 관리 안내

- 주소: 한국어 `/`, `/apply` · 영어 `/en`, `/en/apply`. 브라우저 언어를 보고 자동으로 옮기지 않고, 헤더의 **KO / EN** 버튼으로 직접 고르게 해요(보던 섹션은 그대로 유지).
- **문구를 고칠 때**: `i18n/ko.json`, `i18n/en.json`에서 같은 이름의 항목을 고쳐요. 코드는 안 건드려도 돼요.
  - 신청 안내 메일 문구만 `api/signup-mail.js` 맨 위 `MAIL` 안에 있어요.
- **페이지 모양을 고칠 때**: `src/index.template.html`, `src/apply.template.html`을 고쳐요. `{{항목.이름}}` 자리가 json 문구로 바뀌어요.
- **`index.html`, `apply.html`, `en/` 폴더는 만들어진 결과물**이라 직접 고치지 않아요(git에도 안 올라가요). 로컬에서 보려면 Node 20으로 `node build-i18n.js`를 실행해요. 배포(Vercel) 때는 `build.sh`가 자동으로 해요.
- **새 언어 추가** (예: 일본어 `ja`):
  1. `i18n/ko.json`을 `i18n/ja.json`으로 복사해서 번역해요. 항목이 하나라도 빠지면 빌드가 멈추고 알려 줘요.
  2. `build-i18n.js`의 `LANGS`에 한 줄 추가해요(`code`, `dir`, `locale`, `tag`, `font`).
  3. 템플릿의 언어 전환 버튼(`#langs`)에 링크를 추가하고, `sitemap.xml`에 주소를 더해요.
  4. `api/signup-mail.js`의 `MAIL`에 메일 문구를 추가해요.
- 문의 메일 제목에는 어느 언어 페이지에서 왔는지 표시돼요: `[홈페이지 문의][EN] 이름`

# 회원 인증 설치 안내 (회원가입 · 로그인 · 로그아웃 · 비밀번호 재설정)

## 어떻게 동작하나요
- 화면은 `/login` `/signup` `/forgot-password` `/reset-password` `/account` (영어는 앞에 `/en`).
- 모든 인증은 우리 서버 함수(`api/auth/*`)가 Supabase와 주고받아요. 로그인 토큰은 **httpOnly 쿠키**에만 있어서 브라우저 JS가 볼 수 없고 localStorage에도 저장하지 않아요.
- `/account`, `/reset-password`는 **서버가 Supabase에 물어서(getUser)** 로그인을 확인한 뒤에만 내용을 보내요. 아니면 로그인 화면으로 보내요.
- 메일 링크는 `/auth/confirm`에서 서버가 처리해요(token_hash → 세션 교환). 이동 주소(`next`)는 우리 사이트 안 경로만 허용해요.
- `service_role` 키는 쓰지 않아요. 프로필은 사용자 본인 권한(RLS)으로만 읽고 써요.
- 자동 시험: `npm test` (가짜 Supabase로 보안 규칙 22개 확인)

## 내가 직접 해야 하는 설정 체크리스트

### A. Cloudflare Turnstile (사람인지 확인)
- [ ] dash.cloudflare.com → **Turnstile** → **Add widget**. Domain에 `billyeobolkka-landing.vercel.app` (로컬 시험도 하려면 `localhost`도). Widget Mode는 Managed.
- [ ] **Site key**, **Secret key** 두 값을 복사해 둬요. (키를 채팅에 붙여 넣지 마세요)

### B. Supabase 대시보드 (supabase.com/dashboard → 프로젝트)
- [ ] **Authentication → URL Configuration**
  - Site URL: `https://billyeobolkka-landing.vercel.app` (Vercel의 `SITE_URL`과 똑같이, 끝에 `/` 없이)
  - Redirect URLs: `https://billyeobolkka-landing.vercel.app/**` (로컬 시험용 `http://localhost:3000/**`는 선택)
- [ ] **Authentication → Sign In / Providers → Email**: Email 로그인 켜짐, **Confirm email 켜짐**(지금도 켜져 있어요), 비밀번호 최소 길이 **8**. 가능하면 "영문+숫자 필수" 옵션도 선택해요(우리 서버도 따로 검사해서 필수는 아니에요. 메뉴 이름은 대시보드 버전에 따라 조금 다를 수 있어요).
- [ ] **Authentication → Bot and Abuse Protection**: **Enable CAPTCHA protection** 켜고 Provider **Turnstile**, A에서 받은 **Secret key** 입력 → Save.
- [ ] **Authentication → Emails → Templates**: 아래 두 파일 내용을 그대로 붙여 넣고 **Subject**를 맞춰요.
  - `Confirm sign up` ← `supabase/email-templates/confirm-signup.html`, 제목 `[빌려볼까 · Billyeobolkka] 이메일 인증 / Verify your email`
  - `Reset password` ← `supabase/email-templates/reset-password.html`, 제목 `[빌려볼까 · Billyeobolkka] 비밀번호 재설정 / Reset your password`
  - (한국어·영어를 한 메일에 같이 넣었어요. 링크는 `{{ .SiteURL }}/auth/confirm?token_hash=...` 형태예요.)
- [ ] **Authentication → Emails → SMTP Settings**: Custom SMTP 켜기. Resend를 쓰면 Host `smtp.resend.com`, Port `465`, Username `resend`, Password는 Resend API 키(대시보드 입력칸에 직접), Sender `onboarding@resend.dev`(시험용).
  - ⚠ Supabase 기본 메일은 시간당 2통 제한이에요. **도메인 인증 전에는 Resend 가입 메일 주소로만** 메일이 가서, 지금은 본인 주소로만 시험할 수 있어요. 실제 방문자 가입은 도메인 인증 후 Sender를 바꿔야 해요.
- [ ] **(선택) Authentication → Rate Limits**: 가입·로그인·메일 발송 한도를 확인해요.
- [ ] **(Pro 요금제만) Passwords → Leaked password protection** 켜기.
- [ ] **SQL Editor**에서 실행
  1. `supabase/migrations/20261022000000_profiles.sql` 전체 붙여 넣고 Run (프로필 표 + RLS + 가입 시 자동 생성)
  2. `supabase/checks/rls-audit.sql` Run → 결과에서 `rls_enabled`가 **false**인 표가 있으면 알려 주세요(`signups`는 true여야 해요)

### C. Vercel (프로젝트 → Settings)
- [ ] **Environment Variables**에 추가(Production): `SITE_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`는 이미 있어요. **`service_role` 키는 넣지 마세요.**)
- [ ] **Settings → General → Node.js Version**이 **24.x**인지 확인해요(`package.json`에도 24.x로 지정했어요).
- [ ] 저장 후 **Redeploy**.
- 참고: `TURNSTILE_SECRET_KEY`를 넣기 전에는 사전신청 메일 함수의 사람 확인이 꺼져 있어요. 넣으면 켜져요.

## 시나리오 시험 (배포 후, 브라우저에서 직접)
> 도메인 인증 전이라 메일은 **Resend 가입 메일 주소**로만 가요. 그 주소로 시험하세요.
1. **가입**: `/signup`에서 이메일, 비밀번호(8자+영문+숫자), 확인 입력 → "사람인지 확인" 통과 → 가입하기 → "메일을 확인해 주세요" 화면.
   - 약한 비밀번호(`abc12`), 확인이 다른 비밀번호는 서버를 부르기 전에 문구로 막혀요.
2. **인증 메일**: 메일의 "이메일 인증하기" 클릭 → 자동 로그인되어 `/account`로 이동.
3. **보호 페이지**: `/account`에 이메일이 보여요. 표시 이름을 적고 저장 → 새로고침해도 유지. 헤더에 "내 계정 / 로그아웃".
4. **쿠키 확인**: 개발자도구(F12) → Application → Cookies에서 `sb-…` 쿠키가 **HttpOnly ✓, Secure ✓**, Local Storage에 토큰이 없어야 해요.
5. **로그아웃**: 클릭 → 홈으로 이동, 헤더가 "로그인"으로 바뀜.
6. **로그아웃 상태로 보호 페이지**: 주소창에 `/account` 직접 입력 → `/login?next=%2Faccount`로 튕겨요(페이지 내용은 안 보임).
7. **로그인 실패 문구**: 틀린 비밀번호, 없는 이메일 모두 같은 문구 "이메일 또는 비밀번호가 올바르지 않습니다." 이어야 해요.
8. **원래 가려던 페이지로**: 6번에서 튕겨 온 로그인 화면에서 로그인 → `/account`. `/login?next=//evil.com`으로 로그인해도 `/account`로만 가야 해요.
9. **비밀번호 찾기**: `/forgot-password`에서 가입한 이메일과 가입 안 한 이메일 둘 다 같은 안내("가입된 이메일이라면 재설정 메일을 보냈습니다")가 나와야 해요. 가입한 쪽 메일함에는 재설정 메일이 와요.
10. **재설정**: 메일의 "새 비밀번호 정하기" → `/reset-password`. 약한 비밀번호는 거절, 정상 비밀번호는 변경 후 `/account`로 이동.
    - 같은 화면을 링크 없이 주소로만 열면 안 열려야 해요(로그인 화면 또는 비밀번호 찾기로 이동).
11. **새 비밀번호로 로그인**: 로그아웃 후 새 비밀번호로 로그인 성공, 옛 비밀번호는 실패.
12. **영어 확인**: `/en/signup`, `/en/login`, `/en/account`에서 같은 흐름을 한 번 더(문구·이동 주소가 `/en` 기준인지).
13. **보안 헤더**: 브라우저 주소 `https://securityheaders.com/?q=billyeobolkka-landing.vercel.app` 로 확인하거나, F12 → Network에서 응답 헤더에 `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`가 있는지 봐요.
