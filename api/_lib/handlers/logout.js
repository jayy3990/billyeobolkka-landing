// 로그아웃: 이 기기의 세션을 끝내고 쿠키를 지워요.
const A = require("../auth");

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  try {
    const supabase = A.deps.createSupabase(req, res);
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("logout 오류", e && e.message);
  }
  A.clearSessionCookies(req, res); // 서버 호출이 실패해도 쿠키는 반드시 지워요
  A.setRecoveryFlag(res, false);
  return A.send(res, 200, { ok: true });
};
