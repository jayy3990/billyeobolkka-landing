// /api/library — 로그인한 사용자의 "내 서재"(읽은 책 목록)
//   GET                       : 내 서재 목록 (최신순, 최대 300권)
//   POST {isbn13, rating?, historyId?} : 책 담기. historyId가 있으면 내 추천 기록에서 제목·저자를 가져오고(정보나루 호출 없음),
//                                         없으면 정보나루에서 ISBN으로 공식 제목·저자를 가져와요(하루 검색 횟수 1회 사용)
//   PUT  {isbn13, rating}     : 평가 바꾸기 (rating: liked | ok | disliked | null)
//   DELETE ?isbn13=           : 한 권 빼기
// 보안: Origin 확인(변경 요청) → 로그인(getUser) → 허용값 검증 → 본인 행만(user_id 조건 + DB의 RLS).
//  user_id는 로그인 정보에서만, 제목·저자는 서버가 가진 값에서만 가져와요(화면이 보낸 제목은 저장하지 않아요).
const A = require("./_lib/auth");
const shelf = require("./_lib/shelf");
const history = require("./_lib/history");
const library = require("./_lib/library");
const core = require("./_lib/recommend-core");

async function refund(supabase, eventId) {
  if (!eventId || !supabase) return;
  try { await supabase.rpc("refund_usage", { p_event: eventId }); } catch (e) { /* 무시 */ }
}

module.exports = async (req, res) => {
  const method = req.method;
  if (method === "POST") { if (!A.sameOriginPost(req, res)) return; }
  else if (method === "PUT" || method === "DELETE") { if (!A.sameOriginMutation(req, res)) return; }
  else if (method !== "GET") return A.fail(res, 405, "method");

  // 입력 검증 (DB·정보나루에 가기 전에)
  const body = method === "POST" || method === "PUT" ? A.readBody(req) || {} : {};
  let isbn = null, rating = null, historyId = null;
  if (method !== "GET") {
    isbn = method === "DELETE" ? (req.query && req.query.isbn13) : body.isbn13;
    if (!shelf.isIsbn(isbn)) return A.fail(res, 400, "isbn");
  }
  if (method === "POST" || method === "PUT") {
    if (body.rating !== undefined && body.rating !== null && !shelf.isRating(body.rating)) return A.fail(res, 400, "rating");
    rating = body.rating == null ? null : body.rating;
    if (method === "POST" && body.historyId !== undefined && body.historyId !== null) {
      if (!history.isUuid(body.historyId)) return A.fail(res, 400, "history");
      historyId = body.historyId;
    }
  }

  let supabase, eventId = null;
  try {
    supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data || !data.user) return A.fail(res, 401, "auth");
    const uid = data.user.id;
    const T = shelf.TABLE;

    if (method === "GET") {
      const r = await supabase.from(T).select(shelf.COLUMNS).eq("user_id", uid).order("added_at", { ascending: false }).limit(shelf.MAX);
      if (r.error) { console.error("library 조회 실패", r.error.code); return A.fail(res, 500, "server"); }
      return A.send(res, 200, { ok: true, max: shelf.MAX, books: (r.data || []).map(shelf.toClient) });
    }

    if (method === "DELETE") {
      const d = await supabase.from(T).delete().eq("user_id", uid).eq("isbn13", isbn);
      if (d.error) { console.error("library 삭제 실패", d.error.code); return A.fail(res, 500, "server"); }
      return A.send(res, 200, { ok: true });
    }

    if (method === "PUT") {
      const u = await supabase.from(T).update({ rating }).eq("user_id", uid).eq("isbn13", isbn).select("isbn13");
      if (u.error) { console.error("library 평가 실패", u.error.code); return A.fail(res, 500, "server"); }
      if (!Array.isArray(u.data) || !u.data.length) return A.fail(res, 404, "not_found");
      return A.send(res, 200, { ok: true });
    }

    // POST: 이미 담긴 책이면 (평가가 왔을 때만 평가를 바꾸고) 그대로 성공
    const ex = await supabase.from(T).select("isbn13").eq("user_id", uid).eq("isbn13", isbn).maybeSingle();
    if (ex.error) { console.error("library 확인 실패", ex.error.code); return A.fail(res, 500, "server"); }
    if (ex.data) {
      if (rating) await supabase.from(T).update({ rating }).eq("user_id", uid).eq("isbn13", isbn);
      return A.send(res, 200, { ok: true, already: true });
    }
    const cnt = await supabase.from(T).select("isbn13").eq("user_id", uid).limit(shelf.MAX);
    if (cnt.error) { console.error("library 개수 실패", cnt.error.code); return A.fail(res, 500, "server"); }
    if ((cnt.data || []).length >= shelf.MAX) return A.fail(res, 409, "full");

    // 제목·저자 출처: 내 추천 기록 → 없으면 정보나루
    let book = null;
    if (historyId) {
      const h = await supabase.from(history.TABLE).select("items").eq("user_id", uid).eq("id", historyId).maybeSingle();
      if (h.error) { console.error("library 기록 조회 실패", h.error.code); return A.fail(res, 500, "server"); }
      const items = h.data && Array.isArray(h.data.items) ? h.data.items : [];
      book = items.find((it) => it && String(it.isbn13) === isbn) || null;
      if (!book) return A.fail(res, 400, "book");
    } else {
      const rs = await supabase.rpc("reserve_usage", { p_kind: "search" });
      const row = rs.error ? null : (Array.isArray(rs.data) ? rs.data[0] : rs.data);
      if (!row) return A.fail(res, 500, "server");
      if (!row.allowed) return A.send(res, 429, { ok: false, error: "limit" });
      eventId = row.event_id || null;
      book = await library.getBook(isbn);
      if (!book) { await refund(supabase, eventId); eventId = null; return A.fail(res, 400, "book"); }
    }
    const title = core.clean(book.title, 80);
    if (!title) { await refund(supabase, eventId); eventId = null; return A.fail(res, 400, "book"); }
    const ins = await supabase.from(T).insert({ user_id: uid, isbn13: isbn, title, author: core.clean(book.author, 40), rating });
    if (ins.error) {
      await refund(supabase, eventId); eventId = null;
      const code = String(ins.error.code);
      if (code === "23505") return A.send(res, 200, { ok: true, already: true }); // 동시에 두 번 눌렀을 때
      if (code === "P0001") return A.fail(res, 409, "full");
      console.error("library 저장 실패", code);
      return A.fail(res, 500, "server");
    }
    return A.send(res, 200, { ok: true, already: false });
  } catch (e) {
    await refund(supabase, eventId);
    if (e instanceof library.LibraryError) {
      console.error("library 실패(정보나루)", e.code);
      return e.code === "limit" ? A.fail(res, 503, "library_limit") : A.fail(res, 502, "library");
    }
    console.error("library 오류", e && e.message);
    return A.fail(res, 500, "server");
  }
};
