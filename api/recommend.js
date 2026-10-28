// POST /api/recommend — 로그인한 사용자만. 도서관·연령·성별·장르·좋아한 책(ISBN) → 이 도서관 소장 도서 중 추천.
// 보안 순서: Origin 확인 → 로그인(getUser, 서버 검증) → 입력 허용값 검증 → 하루 횟수 확보(DB) → 추천 → 실패하면 횟수 되돌림
// 정보나루·Claude 키는 서버에서만 쓰고, 오류의 원문은 화면으로 내보내지 않아요(코드만).
const A = require("./_lib/auth");
const libs = require("./_lib/libs");
const core = require("./_lib/recommend-core");
const pipeline = require("./_lib/recommend-pipeline");
const history = require("./_lib/history");
const shelfLib = require("./_lib/shelf");
const { LibraryError } = require("./_lib/library");
const { ClaudeError } = require("./_lib/claude");

// reserve_usage 결과(배열 또는 객체) → { allowed, eventId, remaining }
function parseReserve(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { allowed: !!row.allowed, eventId: row.event_id || null, remaining: Number(row.remaining) || 0 };
}

module.exports = async (req, res) => {
  if (!A.sameOriginPost(req, res)) return;

  let supabase, eventId = null;
  try {
    supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser(); // 쿠키 값을 믿지 않고 Supabase 서버에 확인
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const uid = data.user.id;

    const v = core.validateInput(A.readBody(req), libs.isKnownLibrary);
    if (!v.ok) return A.fail(res, 400, v.error);

    const rs = await supabase.rpc("reserve_usage", { p_kind: "recommend" });
    const r = rs.error ? null : parseReserve(rs.data);
    if (!r) { console.error("reserve_usage 실패", rs.error && rs.error.code); return A.fail(res, 500, "server"); }
    if (!r.allowed) return A.send(res, 429, { ok: false, error: "limit", remaining: 0 });
    eventId = r.eventId;

    // 내 서재(읽은 책)가 있으면 추천에서 빼고 취향에 반영해요. 서재를 못 읽어도 추천은 계속해요
    const shelf = await shelfLib.load(supabase, uid);
    // 모험 추천이면 최근에 추천받은 책도 빼요(같은 모험이 반복되지 않게)
    const avoid = v.value.mode === "adventure" ? await history.recentBooks(supabase, uid) : [];
    const out = await pipeline.run({ ...v.value, shelf, avoid });
    // 추천 기록 저장 (사용자가 끄지 않았을 때만). 저장이 실패해도 추천 결과는 그대로 보여 줘요
    const historyId = v.value.saveHistory ? await history.save(supabase, uid, v.value, out) : null;
    return A.send(res, 200, { ok: true, items: out.items, remaining: r.remaining, historySaved: !!historyId, historyId, shelfCount: shelf.length });
  } catch (e) {
    // 추천이 만들어지지 못했으면 오늘 횟수를 되돌려 줘요 (되돌리기도 실패하면 그냥 둬요)
    if (eventId && supabase) { try { await supabase.rpc("refund_usage", { p_event: eventId }); } catch (x) { /* 무시 */ } }
    if (e instanceof LibraryError) {
      console.error("추천 실패(정보나루)", e.code);
      return e.code === "limit" ? A.fail(res, 503, "library_limit") : A.fail(res, 502, "library");
    }
    if (e instanceof ClaudeError) {
      console.error("추천 실패(Claude)", e.code);
      return A.fail(res, 502, "ai");
    }
    if (e instanceof core.PipelineError) return A.fail(res, e.code === "few" ? 422 : 502, e.code === "few" ? "few" : "ai");
    console.error("추천 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
