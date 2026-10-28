// 대회 체험용 계정 설정. 서버에서만 읽어요.
//  - 이메일·비밀번호는 환경변수(DEMO_EMAIL, DEMO_PASSWORD)에만 있어요. 코드·화면·응답에는 절대 나가지 않아요.
//  - 두 값이 모두 있어야 체험 기능이 켜져요. 비우면 체험 로그인·초기화가 통째로 꺼져요(대회가 끝나면 비우면 돼요).
const { getEnv } = require("./auth");

function creds() {
  const email = getEnv("DEMO_EMAIL").trim().toLowerCase();
  const password = getEnv("DEMO_PASSWORD");
  return email && password ? { email, password } : null;
}

// 지금 로그인한 사람이 체험 계정인지 (이메일만 비교해요)
function isDemoEmail(email) {
  const c = creds();
  return !!c && typeof email === "string" && email.trim().toLowerCase() === c.email;
}

module.exports = { creds, isDemoEmail };
