// /api/preferences — 로그인한 사용자의 추천 선호 설정 (도서관·연령대·성별·관심 장르·좋아한 책)
//   GET    : 내 설정 조회 (없으면 prefs: null)
//   PUT    : 내 설정 저장 (사용자당 1건. 있으면 덮어써요)
//   DELETE : 내 설정 지우기
// 보안: Origin 확인 → 로그인(getUser, 서버 검증) → 허용 목록으로 입력 검증 → 본인(user_id=로그인한 사람) 행만 다뤄요.
//  - user_id는 요청 본문이 아니라 로그인 정보에서만 가져와요. DB의 RLS가 한 번 더 막아요.
//  - 좋아한 책의 제목·저자는 화면이 보낸 값이 아니라, 서버가 정보나루에서 ISBN으로 다시 가져온 공식 값만 저장해요.
const A = require("./_lib/auth");
const libs = require("./_lib/libs");
const core = require("./_lib/recommend-core");
const library = require("./_lib/library");

const TABLE = "user_preferences";
const COLUMNS = "lib_code, age_group, gender, genres, liked";

// DB 행 → 화면에 줄 모양 (도서관 이름·지역은 스냅샷에서 찾아요. 스냅샷에서 사라진 도서관은 null)
function toClient(row) {
  if (!row) return null;
  const lib = row.lib_code ? libs.getLibrary(row.lib_code) : null;
  const liked = Array.isArray(row.liked) ? row.liked.filter((b) => b && /^\d{13}$/.test(String(b.isbn13))).slice(0, 3) : [];
  return {
    libCode: lib ? row.lib_code : null,
    libName: lib ? lib.n : null,
    libSido: lib ? lib.s : null,
    libGu: lib ? lib.g : null,
    ageGroup: row.age_group,
    gender: row.gender,
    genres: Array.isArray(row.genres) ? row.genres : [],
    liked: liked.map((b) => ({ isbn13: String(b.isbn13), title: String(b.title || ""), author: String(b.author || "") })),
  };
}

// 저장이 끝나지 못했으면 방금 확보한 횟수를 되돌려요 (되돌리기도 실패하면 그냥 둬요)
async function refund(supabase, eventId) {
  if (!eventId || !supabase) return;
  try { await supabase.rpc("refund_usage", { p_event: eventId }); } catch (e) { /* 무시 */ }
}

module.exports = async (req, res) => {
  const method = req.method;
  if (method !== "GET" && !A.sameOriginMutation(req, res)) return;
  if (method !== "GET" && method !== "PUT" && method !== "DELETE") return A.fail(res, 405, "method");

  let supabase, eventId = null;
  try {
    supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const uid = data.user.id;

    if (method === "GET") {
      const r = await supabase.from(TABLE).select(COLUMNS).eq("user_id", uid).maybeSingle();
      if (r.error) { console.error("preferences 조회 실패", r.error.code); return A.fail(res, 500, "server"); }
      return A.send(res, 200, { ok: true, prefs: toClient(r.data) });
    }

    if (method === "DELETE") {
      const r = await supabase.from(TABLE).delete().eq("user_id", uid);
      if (r.error) { console.error("preferences 삭제 실패", r.error.code); return A.fail(res, 500, "server"); }
      return A.send(res, 200, { ok: true });
    }

    // PUT: 저장
    const v = core.validatePrefs(A.readBody(req), libs.isKnownLibrary);
    if (!v.ok) return A.fail(res, 400, v.error);
    const input = v.value;

    // 좋아한 책: 정보나루에서 공식 제목·저자 확인 (정보나루 호출을 아끼려고 하루 검색 한도에서 1회로 계산해요)
    let liked = [];
    if (input.liked.length) {
      const rs = await supabase.rpc("reserve_usage", { p_kind: "search" });
      const row = rs.error ? null : (Array.isArray(rs.data) ? rs.data[0] : rs.data);
      if (!row) return A.fail(res, 500, "server");
      if (!row.allowed) return A.send(res, 429, { ok: false, error: "limit" });
      eventId = row.event_id || null;
      const books = await Promise.all(input.liked.map((i) => library.getBook(i)));
      if (books.some((b) => !b)) { await refund(supabase, eventId); return A.fail(res, 400, "liked"); }
      liked = books.map((b) => ({ isbn13: b.isbn13, title: core.clean(b.title, 80), author: core.clean(b.author, 40) }));
    }

    const row = { user_id: uid, lib_code: input.libCode, age_group: input.ageGroup, gender: input.gender, genres: input.genres, liked };
    const r = await supabase.from(TABLE).upsert(row, { onConflict: "user_id" });
    if (r.error) { console.error("preferences 저장 실패", r.error.code); throw new Error("db"); }
    return A.send(res, 200, { ok: true, prefs: toClient({ lib_code: input.libCode, age_group: input.ageGroup, gender: input.gender, genres: input.genres, liked }) });
  } catch (e) {
    await refund(supabase, eventId);
    if (e instanceof library.LibraryError) {
      console.error("preferences 실패(정보나루)", e.code);
      return e.code === "limit" ? A.fail(res, 503, "library_limit") : A.fail(res, 502, "library");
    }
    console.error("preferences 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
