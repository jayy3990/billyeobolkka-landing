// Claude(Anthropic) 호출. 서버에서만 실행돼요. 키(ANTHROPIC_API_KEY)는 서버 환경변수에서만 읽어요.
//  - 모델은 RECOMMEND_MODEL 환경변수로 바꿀 수 있어요 (기본 claude-haiku-5-5: 후보 중 고르기엔 가볍고 저렴한 모델)
//  - 응답은 JSON 스키마(output_config.format)로 받아요. 이 요청 형식을 거절하면 형식 없이 한 번 더 시도하고 직접 파싱해요.
//  - 원본 오류 문구는 화면에 내보내지 않고 코드(ClaudeError.code)로만 구분해요.

const { getEnv } = require("./auth");
const { extractJson } = require("./recommend-core");

class ClaudeError extends Error {
  constructor(code) { super("claude:" + code); this.code = code; } // "config" | "auth" | "rate" | "billing" | "refusal" | "parse" | "api"
}

const DEFAULT_MODEL = "claude-haiku-5-5";
const deps = { createClient: null }; // 시험에서 가짜 클라이언트를 끼울 수 있게

function client() {
  if (deps.createClient) return deps.createClient();
  const apiKey = getEnv("ANTHROPIC_API_KEY");
  if (!apiKey) throw new ClaudeError("config");
  const Anthropic = require("@anthropic-ai/sdk");
  const Ctor = Anthropic.default || Anthropic;
  return new Ctor({ apiKey, maxRetries: 1, timeout: 45000 });
}

function textOf(res) {
  return (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function create(c, req) {
  try {
    return await c.messages.create(req);
  } catch (e) {
    const status = e && e.status;
    const detail = String((e && e.error && e.error.error && e.error.error.message) || (e && e.message) || "");
    if (status === 401 || status === 403) throw new ClaudeError("auth"); // 키가 틀렸거나 권한 없음
    if (status === 429) throw new ClaudeError("rate");
    // 크레딧(잔액) 부족은 400으로 와요. 형식 문제와 구분해서, 형식 없이 다시 시도하지 않고 로그에 원인을 남겨요
    if (status === 400 && /credit balance|billing|payment|spend limit|usage limit/i.test(detail)) throw new ClaudeError("billing");
    const err = new ClaudeError("api");
    err.status = status;
    throw err;
  }
}

// { system, user, schema } → { data(파싱된 JSON), usage }
async function recommend({ system, user, schema }) {
  const c = client();
  const model = getEnv("RECOMMEND_MODEL") || DEFAULT_MODEL;
  const effort = getEnv("RECOMMEND_EFFORT") || "low";
  const base = { model, max_tokens: 3000, system, messages: [{ role: "user", content: user }] };

  let res;
  try {
    res = await create(c, { ...base, output_config: { effort, format: { type: "json_schema", schema } } });
  } catch (e) {
    // 요청 형식(output_config) 때문에 거절당한 경우에만, 형식 없이 한 번 더 (인증·한도 오류는 그대로 전달)
    if (e.code === "api" && e.status === 400) {
      console.error("Claude: output_config 형식이 거절되어 형식 없이 재시도");
      res = await create(c, base);
    } else {
      throw e;
    }
  }
  if (res.stop_reason === "refusal") throw new ClaudeError("refusal");
  const data = extractJson(textOf(res));
  if (!data) throw new ClaudeError("parse");
  const u = res.usage || {};
  console.log("Claude 사용량", model, "입력", u.input_tokens, "출력", u.output_tokens); // 키·사용자 정보는 출력하지 않아요
  return { data, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0 } };
}

module.exports = { ClaudeError, recommend, deps, DEFAULT_MODEL };
