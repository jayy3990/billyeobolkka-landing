// 메일 링크 처리: /auth/confirm?token_hash=...&type=email|recovery&next=...
// token_hash를 서버에서 verifyOtp로 교환하고(PKCE 방식), 세션 쿠키를 심은 뒤 안전한 주소로 이동해요.
const A = require("../_lib/auth");

const TYPES = ["email", "signup", "recovery"];

module.exports = async (req, res) => {
  const q = req.query || {};
  const tokenHash = typeof q.token_hash === "string" ? q.token_hash : "";
  const type = typeof q.type === "string" ? q.type : "";
  const nextRaw = typeof q.next === "string" ? q.next : "";
  const lang = nextRaw.includes("/en/") || nextRaw.endsWith("/en") ? "en" : "ko";
  const fallback = type === "recovery" ? (lang === "en" ? "/en/reset-password" : "/reset-password") : A.defaultAccount(lang);
  const next = A.safeNext(nextRaw, fallback);
  const errorUrl = A.loginPath(lang) + "?error=link";

  if (req.method !== "GET" || !tokenHash || tokenHash.length > 300 || !TYPES.includes(type)) {
    return A.redirect(res, errorUrl);
  }
  try {
    const supabase = A.deps.createSupabase(req, res);
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      console.error("confirm 실패", error.status, error.code);
      return A.redirect(res, errorUrl);
    }
    if (type === "recovery") A.setRecoveryFlag(res, true); // 이 표시가 있어야 새 비밀번호를 정할 수 있어요
    return A.redirect(res, next);
  } catch (e) {
    console.error("confirm 오류", e && e.message);
    return A.redirect(res, errorUrl);
  }
};
