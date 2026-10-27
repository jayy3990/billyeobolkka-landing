// /api/mail/<동작> 한 곳으로 모아서 처리해요: send (이후 정기 구독 동작을 여기에 더해요)
// 이유: Vercel 무료(Hobby) 플랜은 한 배포에 서버 함수를 12개까지만 허용해서, 메일 관련 동작을 하나로 묶어요.
// 실제 처리 코드는 api/_lib/handlers/ 에 있어요 (밑줄(_) 폴더는 함수로 세지 않아요).
const handlers = {
  send: require("../_lib/handlers/mail-send"),
};

module.exports = (req, res) => {
  const action = req.query && typeof req.query.action === "string" ? req.query.action : "";
  if (!Object.prototype.hasOwnProperty.call(handlers, action)) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(404).send(JSON.stringify({ ok: false, error: "not_found" }));
  }
  return handlers[action](req, res);
};
