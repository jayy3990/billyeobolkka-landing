// 로그인해야 볼 수 있는 페이지(/account, /reset-password)를 서버에서 만들어 줘요.
// 접근 제어는 여기(서버)에서 해요. 로그인 안 한 사람에게는 페이지 내용을 보내지 않고 로그인 화면으로 보내요.
// vercel.json의 rewrites가 /account → /api/page?name=account&lang=ko 로 연결해요.
const fs = require("fs");
const path = require("path");
const A = require("./_lib/auth");

const PAGES = ["account", "reset-password", "recommend", "history"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

module.exports = async (req, res) => {
  const name = typeof req.query.name === "string" ? req.query.name : "";
  const lang = A.normLang(req.query.lang);
  if (req.method !== "GET" || !PAGES.includes(name)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).end("Not found");
  }

  const ownPath = "/" + (lang === "en" ? "en/" : "") + name;
  const toLogin = () => A.redirect(res, `${A.loginPath(lang)}?next=${encodeURIComponent(ownPath)}`, 302);

  try {
    const supabase = A.deps.createSupabase(req, res);
    const { data, error } = await supabase.auth.getUser(); // 서버(Supabase)에서 검증
    if (error || !data || !data.user) return toLogin();

    // 비밀번호 재설정 화면은 메일 링크(recovery)로 들어온 사람만
    if (name === "reset-password" && !A.hasRecoveryFlag(req)) {
      return A.redirect(res, (lang === "en" ? "/en" : "") + "/forgot-password?error=link", 302);
    }

    let displayName = "";
    if (name === "account") {
      const r = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle();
      displayName = (r && r.data && r.data.display_name) || "";
    }
    const file = path.join(__dirname, "_pages", `${name}.${lang}.html`);
    const html = fs
      .readFileSync(file, "utf8")
      .replace(/\[\[email\]\]/g, esc(data.user.email || ""))
      .replace(/\[\[displayName\]\]/g, esc(displayName));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    console.error("page 오류", e && e.message);
    return toLogin();
  }
};
