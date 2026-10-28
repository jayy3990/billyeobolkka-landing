// 대회 체험(임시 계정) 설정. 서버에서만 읽어요.
//  - 체험 기능은 환경변수 DEMO_MODE=on 일 때만 켜져요. 비우면 체험 계정 만들기가 통째로 꺼져요(대회가 끝나면 비우면 돼요).
//  - 임시 계정은 이메일·비밀번호 없이 Supabase "익명 로그인"으로 방문자마다 하나씩 만들어요. 공용 비밀번호가 없어서 지킬 비밀도 없어요.
const { getEnv } = require("./auth");

function enabled() {
  return ["on", "true", "1"].includes(getEnv("DEMO_MODE").trim().toLowerCase());
}

// Supabase가 확인해 준 사용자 정보에서 임시(익명) 계정인지 봐요
function isAnonymous(user) {
  return !!user && user.is_anonymous === true;
}

module.exports = { enabled, isAnonymous };
