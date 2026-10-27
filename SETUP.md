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

# AI 도서 추천 설치 안내

## 어떻게 동작하나요
- 화면: `/recommend`, `/en/recommend` (로그인한 사람만). 도서관 선택 → 취향(연령대·성별·장르·재미있게 읽은 책) → 추천.
- 서버(`api/recommend.js`)가 순서대로 처리해요: 로그인 확인 → 입력 허용값 검증 → **하루 5회 확보(DB)** → 이 도서관 후보 수집(정보나루) → Claude(기본 Haiku 5.5)가 **후보 안에서만** 선택 → 서버가 ISBN을 다시 검증 → 대출 가능 여부 조회.
- 후보: 같은 성별·연령의 이 도서관 인기대출(소장이 확실한 책) + 최근 입수 도서. 어린이·학습참고서는 제외해요.
- 취향 단서: 좋아한 책을 읽은 다른 독자들이 함께 읽은 책(정보나루 마니아 추천)의 **제목만** Claude에게 힌트로 줘요. 후보가 아니라서 추천 대상은 아니에요.
- Claude에 보내는 글: 허용된 ID(연령대·성별·장르)를 정해진 라벨로 바꾼 것 + 정보나루가 준 책 제목·저자뿐이에요. 사용자가 입력한 글은 들어가지 않아요(좋아한 책은 검색해서 고른 ISBN만 서버로 보내고, 제목은 서버가 정보나루에서 다시 가져와요).
- 표지 이미지는 쓰지 않아요(아래 "이용 조건").
- 키(`LIBRARY_API_KEY`, `ANTHROPIC_API_KEY`)는 서버 환경변수에서만 읽어요. 브라우저 코드·응답·로그에 나가지 않아요.
- 정보나루 결과는 Vercel Runtime Cache에 저장해서 호출을 아껴요(인기 24시간, 최근 입수 24시간, 대출 가능 여부 12시간, 마니아 추천 7일, 책 정보 30일). 캐시에는 공개 도서 정보만 있고 사용자 정보는 없어요.
- 자동 시험: `npm test` (정보나루·Claude·Supabase를 가짜로 바꿔 입력 검증·후보 규칙·횟수 제한·오류 처리 확인)

## 내가 직접 해야 하는 설정 체크리스트
- [ ] **정보나루 인증키**: Vercel → Settings → Environment Variables에 `LIBRARY_API_KEY` 추가(Production). 일일 호출 한도는 마이페이지에서 확인해요. 테스트 단계라 서버 IP 등록은 하지 않아요 → 한도에 닿으면 화면에 "도서 정보 조회 한도" 안내가 나오고 내일 다시 쓸 수 있어요.
- [ ] **Anthropic API 키**: https://console.anthropic.com → API Keys → Create Key (**`sk-ant-api03-`로 시작**해야 해요). 결제 크레딧을 충전하고, 같은 콘솔에서 **월 사용 한도(Spend limit)** 를 낮게 설정해요(Haiku 5.5 기준 추천 1회에 약 0.001~0.003달러). Vercel에 `ANTHROPIC_API_KEY`로 추가해요. 키는 채팅에 붙이지 마세요.
- [ ] (선택) Vercel에 `RECOMMEND_MODEL`(기본 `claude-haiku-5-5`), `RECOMMEND_EFFORT`(기본 `low`)를 추가하면 코드 수정 없이 모델·생각 깊이를 바꿀 수 있어요.
- [ ] **Supabase SQL**: SQL Editor에서 `supabase/migrations/20261026000000_usage_limits.sql` 전체를 붙여 넣고 Run. (사용 기록 표 `usage_events` + 함수 3개. 여러 번 실행해도 안전해요)
  - 확인: `select relname, relrowsecurity from pg_class where relname = 'usage_events';` → `relrowsecurity`가 **true** 여야 해요.
  - 확인: `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'usage_events';` → 결과가 **비어 있어야** 해요(사용자가 표를 직접 못 건드려요).
- [ ] 위 환경변수를 넣은 뒤 **Redeploy**.
- [ ] **도서관 목록 갱신(분기에 한 번)**: 작업 폴더에서 `node scripts/sync-libraries.js`(정보나루 약 4회) 실행 → `data/libraries.json`이 바뀌면 커밋.

## 시나리오 시험 (배포 후)
> 일일 추천 한도는 5회예요. 시험하다 한도에 닿으면 내일 다시 하거나, SQL Editor에서 `delete from public.usage_events where user_id = '<내 사용자 id>';` 로 직접 비워도 돼요.
1. 로그아웃 상태로 `/recommend` 접속 → 로그인 화면으로 이동(내용이 안 보여야 해요). 로그인하면 `/recommend`로 돌아와요.
2. 홈의 **추천받기** 버튼으로도 들어가져요.
3. **경기 → 성남시 → 성남시 위례도서관**(하남시·송파구에도 같은 이름이 있으니 시·군·구를 꼭 확인) → 다음.
4. 20대·남성·소설·역사·여행, 좋아한 책에 "노인과 바다"를 검색해서 추가 → **추천 받기**. 로딩이 10~30초 보이고, 결과 카드(제목·저자·추천 이유·대출 가능 배지)와 "오늘 남은 추천 4/5회"가 나와요.
5. 결과의 책이 실제로 그 도서관에 있는지 도서관 누리집이나 정보나루에서 몇 권 확인해요.
6. 같은 방식으로 5번을 더 시도 → 6번째에 "오늘 추천 횟수를 모두 사용했어요" 안내.
7. `/en/recommend`에서 영어 화면과 영어 추천 이유 확인.
8. 일부러 오류 상황 확인: Vercel에서 `ANTHROPIC_API_KEY`를 잘못된 값으로 바꾸고 추천 → "추천을 만들지 못했어요 (오늘 횟수는 차감되지 않아요)"가 나오고 남은 횟수가 줄지 않아야 해요(되돌리기 확인). 시험 뒤 키를 원래대로 돌려 놓으세요.
9. Vercel → Logs에서 `api/recommend`의 `정보나루 호출`, `Claude 사용량` 줄로 호출 횟수·토큰을 확인해요(키·사용자 정보는 로그에 없어요).

## 이용 조건·주의 (정보나루 매뉴얼)
- **표지 이미지(`bookImageURL`)는 "비영리 서비스의 화면 표시에 한하여" 쓸 수 있고, 영리 목적 이용·복사·저장·재배포·AI 입력·학습은 금지**예요. 그래서 이 기능은 표지를 가져오지도, 보여 주지도, Claude에 보내지도 않아요. 유료 구독(영리)을 시작하기 전에 정보나루에 표지·데이터 이용 조건을 문의하세요.
- 대출 가능 여부는 **전날 기준**이라 실제와 다를 수 있어요(결과 화면에 안내 문구가 있어요).
- 정보나루 API는 오류도 HTTP 200으로 주고 본문의 `errCode`로 알려 줘요. 코드에서 모두 처리하고, 화면에는 정리된 문구만 보여요.

# 내 추천 설정 저장 (선호 설정)

로그인한 사용자가 도서관·연령대·성별·관심 장르·좋아한 책을 계정에 저장해 두고, 다음 추천 때 자동으로 채워 쓰는 기능이에요.

## 어떻게 동작하나요
- **저장**: 추천 화면의 취향 단계에 "이 설정을 내 계정에 저장해요" 체크박스가 있어요. **체크한 경우에만**, 추천이 성공한 뒤에 저장돼요(저장이 실패해도 추천 결과는 그대로 보여요). 이미 저장한 사람은 기본으로 체크돼 있고, 설정이 바뀌지 않았으면 다시 저장하지 않아요.
- **불러오기**: 추천 화면에 들어가면 저장된 설정이 자동으로 채워지고, 도서관 선택 단계에 "저장된 설정으로 바로 추천 받기" 버튼이 나와요.
- **관리**: 계정 페이지(`/account`)의 "내 추천 설정"에서 저장 내용을 보고 "설정 지우기"로 지울 수 있어요. 수정은 추천 화면에서 해요.
- **서버(`api/preferences.js`)**: 조회(GET)·저장(PUT)·삭제(DELETE). Origin 확인 → 로그인(`getUser`) → 허용 목록 검증. `user_id`는 요청이 아니라 로그인 정보에서만 가져와요.
- **좋아한 책**: 화면이 보낸 제목을 믿지 않고, 서버가 ISBN으로 정보나루에서 공식 제목·저자를 다시 가져와 저장해요. 이때 하루 책 검색 횟수(60회) 1회를 써요(정보나루 호출 남용 방지).
- **DB(`user_preferences`)**: RLS로 본인 행만 읽기·쓰기·삭제. 값 범위는 DB 제약(CHECK)으로도 막고, `user_id`는 만든 뒤 못 바꿔요. 계정이 삭제되면 같이 지워져요. `service_role` 키는 쓰지 않아요.

## 내가 직접 해야 하는 설정
- [ ] **Supabase SQL**: SQL Editor에서 `supabase/migrations/20261026010000_user_preferences.sql` 전체를 붙여 넣고 Run → `Success. No rows returned`가 나오면 정상이에요. (환경변수는 새로 필요 없어요)
  - 확인 1: `select relname, relrowsecurity from pg_class where relname = 'user_preferences';` → `relrowsecurity`가 **true**
  - 확인 2: `select policyname, cmd from pg_policies where tablename = 'user_preferences' order by cmd;` → `DELETE`, `INSERT`, `SELECT`, `UPDATE` 정책 4개
  - 확인 3: `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'user_preferences' and grantee = 'anon';` → **결과 없음**(로그인 안 한 사람은 권한 없음)
- [ ] 위 SQL을 실행한 **뒤에** 배포해요(표가 없는 상태로 배포되면 저장·조회가 "문제가 생겼어요"로 나와요).

## 시나리오 시험 (배포 후)
1. `/recommend` → 도서관·연령대·성별·장르를 고르고 좋아한 책을 검색해 추가 → **"이 설정을 내 계정에 저장해요" 체크** → 추천 받기 → 결과와 함께 "추천 설정을 저장했어요." 안내.
2. 새로고침(또는 로그아웃 후 다시 로그인) → `/recommend`에 저장된 설정이 자동으로 채워지고 "저장된 설정을 불러왔어요: …" 안내와 **바로 추천** 버튼이 보여요.
3. 바로 추천 버튼 → 곧바로 추천 결과(남은 횟수가 1 줄어요). 이때 "저장했어요" 안내는 안 나와야 해요(바뀐 게 없어서).
4. 연령대를 바꾸고 추천 → 다시 저장돼요. `/account`에서 바뀐 값 확인.
5. `/account` → "내 추천 설정"에서 **설정 지우기** → 확인창에서 취소하면 그대로, 확인하면 "저장된 설정을 지웠어요." 그리고 `/recommend`를 다시 열면 비어 있어요.
6. 다른 계정으로 로그인하면 내 설정이 보이지 않아야 해요(본인 것만).
7. 영어: `/en/recommend`, `/en/account`에서 같은 흐름.

## 개인정보 메모
- 연령대·성별은 개인정보예요. 사용자가 체크해서 동의한 경우에만 저장하고, 계정 페이지에서 언제든 지울 수 있어요.
- 저장한 값은 추천할 때 Claude에게 가는 입력(허용된 값을 정해진 라벨로 바꾼 것)에만 쓰여요. 로그나 정보나루 요청에 사용자 정보는 남기지 않아요.
- 영리 서비스를 시작하기 전에 개인정보 처리방침·이용약관에 "추천 설정(연령대·성별 등) 저장"을 반영하세요(아직 사이트에 방침 페이지가 없어요).


# 추천 기록

추천을 받으면 결과(책 목록·추천 이유·당시 대출 상태)와 고른 조건을 내 계정에 남기고, 나중에 `/history`(`/en/history`)에서 다시 볼 수 있어요.

## 어떻게 동작하나요
- **저장**: 추천 화면 취향 단계의 "추천 결과를 내 기록에 남기기"(기본 체크). 추천이 성공한 뒤에만 저장하고, 저장이 실패해도 추천 결과는 그대로 보여요(응답의 `historySaved`로 알려요). 체크를 끄면 저장하지 않아요.
- **보관**: 사용자당 최근 30개. 31번째가 생기면 가장 오래된 기록이 지워져요.
- **보기·삭제**: `/history`에서 목록 보기, 한 건 삭제, 전체 삭제. 대출 상태는 "추천받은 당시" 값이에요(다시 조회하지 않아요). 계정 페이지와 추천 결과 화면에서 링크로 와요.
- **이 조건으로 다시 추천**: `/recommend?from=<기록 id>`로 이동해 조건만 채우고 2단계에서 멈춰요. 추천은 사용자가 직접 눌러야 시작돼요(하루 5회 보호).
- **서버**: `api/history.js`(GET 목록/한 건, DELETE 한 건/전체), `api/_lib/history.js`. Origin 확인 → 로그인(`getUser`) → 본인 행만(`user_id` 조건 + RLS). 기록 id는 UUID 형식만 받아요. 저장 글자는 서버가 가진 값(정보나루 공식 제목·저자 + 검증을 통과한 AI 추천 이유)이고 길이를 제한해요.
- **DB(`recommendation_history`)**: RLS로 본인 행만 읽기·추가·삭제, 수정(UPDATE) 권한은 없어요. 값 범위는 CHECK로도 막아요. 계정이 삭제되면 같이 지워져요. `service_role` 키는 쓰지 않아요. 함수는 8개 → 9개(Vercel Hobby 한도 12).

## 내가 직접 해야 하는 설정
- [ ] **Supabase SQL**: SQL Editor에서 `supabase/migrations/20261027000000_recommendation_history.sql` 전체를 붙여 넣고 Run → `Success. No rows returned`가 나오면 정상이에요. (환경변수는 새로 필요 없어요)
  - 확인 1: `select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'recommendation_history';` → 둘 다 **true**
  - 확인 2: `select policyname, cmd from pg_policies where tablename = 'recommendation_history' order by cmd;` → `DELETE`, `INSERT`, `SELECT` 정책 3개 (UPDATE 없음)
  - 확인 3: `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'recommendation_history' and grantee = 'anon';` → **결과 없음**
- [ ] 위 SQL을 실행한 **뒤에** 배포해요(표가 없으면 기록이 저장되지 않고 `/history`가 "불러오지 못했어요"로 나와요. 추천 자체는 그대로 돼요).

## 시나리오 시험 (배포 후)
1. `/recommend` → 추천 받기(기록 체크 켠 채) → 결과 아래 "내 추천 기록 보기" 링크.
2. `/history` → 방금 추천이 맨 위에 있고 도서관·조건·책·이유·대출 상태가 보여요.
3. "이 조건으로 다시 추천" → 조건이 채워진 2단계 화면(자동으로 추천되지 않아요).
4. 기록 체크를 끄고 추천 → `/history`에 새 기록이 늘지 않아요.
5. 한 건 삭제(확인창) / 전체 삭제 → 목록이 줄어요.
6. 다른 계정으로 로그인하면 내 기록이 보이지 않아야 해요. 로그아웃 상태로 `/history`를 열면 로그인 화면으로 가요.
7. 영어: `/en/history`에서 같은 흐름.

## 개인정보 메모
- 연령대·성별과 추천 내용은 개인 취향 정보예요. 사용자가 체크를 끄면 저장하지 않고, 언제든 지울 수 있어요. 영리 서비스 전에 개인정보 처리방침에 "추천 기록 저장"을 반영하세요.


# 내 서재 (읽은 책) + 추천 확장

읽은 책을 서재에 모아 두면, 다음 추천에서 **읽은 책은 항상 빼고** 평가·최근 읽은 책을 취향 분석에 써요. 서재가 비어 있는 처음 사용자는 지금까지처럼 "재미있게 읽은 책 1~3권"으로 추천받아요.

## 어떻게 동작하나요
- **담기**: 추천 결과·추천 기록의 책마다 "읽었어요" 버튼, 그리고 `/library`(`/en/library`)의 제목 검색. 추천 결과/기록에서 담을 때는 내 추천 기록의 제목·저자를 쓰므로 정보나루 호출과 하루 검색 횟수(60회)를 쓰지 않아요. 검색으로 담을 때만 서버가 ISBN으로 정보나루에서 공식 제목·저자를 가져오고 검색 1회를 써요(실패하면 되돌려요).
- **평가(선택)**: 재밌었어요 / 보통 / 별로예요. 안 골라도 담겨요. `/library`에서 바꾸거나 해제할 수 있고, 책을 서재에서 뺄 수 있어요(전체 삭제 버튼은 없어요).
- **한도**: 사용자당 최대 300권(서버가 먼저 검사하고 DB 트리거도 막아요). 같은 책(ISBN)은 한 번만 담겨요.
- **추천에서 읽은 책 빼기**: 후보 목록에서 같은 ISBN이거나 같은 작품(제목 끝의 `(개정판)`·`[큰글자]` 같은 괄호 꼬리를 뗀 뒤 비교)이면 AI에게 보내기 전에 서버가 빼요. 읽은 책을 빼고 후보가 5권 미만이면 "후보가 부족해요" 안내가 나오고 추천 횟수는 차감되지 않아요.
- **취향 반영**: AI에게는 서재 제목·저자·평가(재밌게 읽음 최대 8권, 별로 5권, 그 밖 6권)만 `<read_books>`로 보내요. 사용자가 쓴 글은 보내지 않아요. 비슷한 책 조회(정보나루 `loanItemSrch`/`recommandList`)의 기준은 이번에 고른 책 + 서재의 "재밌게 읽음" 최근 책, 합쳐서 최대 3권이라 정보나루 호출 수는 그대로예요.
- **서버**: `api/library.js`(GET 목록 / POST 담기 / PUT 평가 / DELETE 빼기), `api/_lib/shelf.js`. Origin 확인 → 로그인(`getUser`) → 허용값 검증 → 본인 행만(`user_id` 조건 + RLS). 화면이 보낸 제목은 저장하지 않아요. 서재 조회가 실패해도 추천은 서재 없이 계속돼요. 함수는 9개 → 10개(Vercel Hobby 한도 12).
- **DB(`user_library`)**: RLS로 본인 행만 읽기·추가·평가 수정·삭제. 수정 가능한 칸은 `rating`뿐이에요. 값 범위는 CHECK로도 막아요. 계정이 삭제되면 같이 지워져요. `service_role` 키는 쓰지 않아요.

## 내가 직접 해야 하는 설정
- [ ] **Supabase SQL**: SQL Editor에서 `supabase/migrations/20261028000000_user_library.sql` 전체를 붙여 넣고 Run → `Success. No rows returned`가 나오면 정상이에요. (환경변수는 새로 필요 없어요)
  - 확인 1: `select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = 'user_library';` → 둘 다 **true**
  - 확인 2: `select policyname, cmd from pg_policies where tablename = 'user_library' order by cmd;` → `DELETE`, `INSERT`, `SELECT`, `UPDATE` 정책 4개
  - 확인 3: `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'user_library' and grantee = 'anon';` → **결과 없음**
  - 확인 4: `select grantee, column_name, privilege_type from information_schema.column_privileges where table_name = 'user_library' and grantee = 'authenticated' and privilege_type = 'UPDATE';` → `rating` **한 칸만**
- [ ] 위 SQL을 실행한 **뒤에** 배포해요(표가 없으면 서재 화면은 "불러오지 못했어요"가 나오고, 추천은 서재 없이 그대로 돼요).

## 시나리오 시험 (배포 후)
1. `/recommend`에서 추천 → 결과의 책에서 **읽었어요** → "서재에 담았어요"로 바뀌고, 취향 단계에 "내 서재 N권을 반영해요" 안내.
2. 같은 조건으로 다시 추천 → 담은 책이 결과에 나오지 않아요.
3. `/library` → 담은 책 확인, 평가 칩(재밌었어요/보통/별로예요) 누르기·다시 눌러 해제, "서재에서 빼기"(확인창).
4. `/library`의 검색 → 책 담기(하루 검색 횟수 1회 사용). 같은 책을 또 담아도 오류 없이 "담았어요".
5. `/history`의 책에서도 **읽었어요** 동작, 이미 담긴 책은 "서재에 담았어요"로 비활성.
6. 다른 계정으로 로그인하면 내 서재가 보이지 않아야 해요. 로그아웃 상태로 `/library`를 열면 로그인 화면으로 가요.
7. 영어: `/en/library`, `/en/recommend`에서 같은 흐름.

## 개인정보 메모
- 읽은 책 목록과 평가는 개인 취향 정보예요. 사용자가 직접 담은 것만 저장하고, 한 권씩 언제든 뺄 수 있어요. 영리 서비스 전에 개인정보 처리방침에 "내 서재(읽은 책·평가) 저장"을 반영하세요.
- AI(Claude)에는 서재의 제목·저자·평가만 가고, 이메일·이름 등 사용자 식별 정보는 가지 않아요.
