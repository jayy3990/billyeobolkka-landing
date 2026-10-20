// signups 표에 새 줄이 들어오면 Supabase 데이터베이스 웹훅이 이 함수를 불러요.
// 비밀 키는 코드에 없어요. Supabase 비밀값(secrets)에서만 읽어요:
//   RESEND_API_KEY  - Resend 키
//   WEBHOOK_SECRET  - 웹훅과 이 함수가 나눠 가진 암호 (엉뚱한 곳에서 부르는 걸 막아요)
//   FROM_EMAIL      - 보내는 사람 (기본: 빌려볼까 <onboarding@resend.dev>, 시험용)

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST만 받아요", { status: 405 });

  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("권한이 없어요", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rec = body?.record;
  if (body?.type !== "INSERT" || body?.table !== "signups" || !rec?.email || !rec?.name) {
    return new Response("대상이 아니에요", { status: 200 });
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return new Response("RESEND_API_KEY가 없어요", { status: 500 });
  const from = Deno.env.get("FROM_EMAIL") ?? "빌려볼까 <onboarding@resend.dev>";
  const name = esc(String(rec.name));

  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#f6f7fb;font-family:'Malgun Gothic','Noto Sans KR',Arial,sans-serif;color:#1d2230;">
<div style="max-width:520px;margin:0 auto;padding:32px 20px;">
  <div style="background:#4f46e5;color:#ffffff;border-radius:16px 16px 0 0;padding:24px 28px;font-size:22px;font-weight:800;">📖 빌려볼까</div>
  <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px;line-height:1.7;font-size:17px;">
    <p style="margin:0 0 14px;font-size:20px;font-weight:800;">${name}님, 사전신청 고마워요!</p>
    <p style="margin:0 0 14px;">신청이 잘 접수됐어요. 출시되면 가장 먼저 알려 드릴게요.</p>
    <p style="margin:0;color:#4f46e5;font-weight:800;">오늘 빌릴 책, 같이 골라 볼까요?</p>
  </div>
  <p style="margin:16px 4px 0;color:#5b6275;font-size:13px;">이 메일은 빌려볼까 사전신청을 하셔서 보냈어요. 신청하신 적이 없다면 무시해 주세요.</p>
</div></body></html>`;

  const text = `${rec.name}님, 사전신청 고마워요!\n신청이 잘 접수됐어요. 출시되면 가장 먼저 알려 드릴게요.\n\n오늘 빌릴 책, 같이 골라 볼까요?\n- 빌려볼까`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [rec.email], subject: "[빌려볼까] 사전신청 고마워요!", html, text }),
  });

  if (!r.ok) {
    // 이메일 주소 같은 개인정보는 로그에 남기지 않아요
    console.error("Resend 실패", r.status, await r.text());
    return new Response("메일 보내기 실패", { status: 502 });
  }
  return new Response("보냈어요", { status: 200 });
});
