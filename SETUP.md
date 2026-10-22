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
