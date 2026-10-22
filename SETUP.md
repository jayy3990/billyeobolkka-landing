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
