// GET /api/usage — 로그인한 사용자의 오늘 남은 추천 횟수 (화면 표시용). 횟수 판정은 항상 서버·DB에서 해요.
const A = require("./_lib/auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return A.fail(res, 405, "method");
  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const rs = await supabase.rpc("usage_remaining", { p_kind: "recommend" });
    if (rs.error || typeof rs.data !== "number") return A.fail(res, 500, "server");
    // 내 하루 한도(체험 계정은 더 높아요). 못 읽으면 기본값 5
    const lm = await supabase.rpc("usage_limit", { p_kind: "recommend" });
    const limit = !lm.error && typeof lm.data === "number" ? lm.data : 5;
    return A.send(res, 200, { ok: true, remaining: rs.data, limit });
  } catch (e) {
    return A.fail(res, 500, "server");
  }
};
