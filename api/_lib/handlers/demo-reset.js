// 체험 데이터 초기화: 체험 계정의 서재·추천 기록·추천 설정을 모두 지워요 (다음 체험자를 위해).
// 보안: Origin 확인 → 로그인(getUser) → 로그인한 사람이 체험 계정일 때만 → 본인 행만 삭제(user_id 조건 + RLS).
//  일반 계정으로 부르면 403이라서 다른 사람의 데이터를 지울 수 없어요.
const A = require("../auth");
const demo = require("../demo");

const TABLES = ["user_library", "recommendation_history", "user_preferences"];

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;
  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    if (!demo.isDemoEmail(data.user.email)) return A.fail(res, 403, "forbidden");
    for (const t of TABLES) {
      const r = await supabase.from(t).delete().eq("user_id", data.user.id);
      if (r.error) { console.error("demo 초기화 실패", t, r.error.code); return A.fail(res, 500, "server"); }
    }
    return A.send(res, 200, { ok: true });
  } catch (e) {
    console.error("demo 초기화 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
