// 헤더의 로그인/로그아웃 버튼을 위한 상태 확인. 서버(Supabase)가 검증한 결과만 돌려줘요.
const A = require("../auth");
const demo = require("../demo");

module.exports = async (req, res) => {
  if (req.method !== "GET") return A.fail(res, 405, "method");
  if (!/(?:^|;\s*)sb-/.test(req.headers.cookie || "")) return A.send(res, 200, { ok: true, loggedIn: false });
  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.send(res, 200, { ok: true, loggedIn: false });
    return A.send(res, 200, { ok: true, loggedIn: true, email: data.user.email || "", anonymous: demo.isAnonymous(data.user) });
  } catch (e) {
    return A.send(res, 200, { ok: true, loggedIn: false });
  }
};
