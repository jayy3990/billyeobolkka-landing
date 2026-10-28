// /api/auth/<동작> 한 곳으로 모아서 처리해요: signup, login, logout, forgot, confirm, update-password, me, profile, demo, demo-reset
// 이유: Vercel 무료(Hobby) 플랜은 한 배포에 서버 함수를 12개까지만 허용해서, 인증 함수 8개를 하나로 묶었어요.
// 실제 처리 코드는 api/_lib/handlers/ 에 있어요 (밑줄(_) 폴더는 함수로 세지 않아요). 주소는 예전과 똑같아요.
const handlers = {
  signup: require("../_lib/handlers/signup"),
  login: require("../_lib/handlers/login"),
  logout: require("../_lib/handlers/logout"),
  forgot: require("../_lib/handlers/forgot"),
  confirm: require("../_lib/handlers/confirm"),
  "update-password": require("../_lib/handlers/update-password"),
  me: require("../_lib/handlers/me"),
  profile: require("../_lib/handlers/profile"),
  demo: require("../_lib/handlers/demo"),
  "demo-reset": require("../_lib/handlers/demo-reset"),
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
