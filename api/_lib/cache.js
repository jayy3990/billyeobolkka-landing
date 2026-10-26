// 공용 캐시: Vercel Runtime Cache(@vercel/functions getCache)를 쓰고, 없으면(로컬·시험) 메모리에 저장해요.
// 캐시에는 정보나루의 공개 정보(도서 목록·소장 여부)만 넣어요. 사용자 정보는 절대 넣지 않아요.
// 값은 휘발성이에요(용량이 차면 오래된 것부터 지워져요). 지워져도 정보나루를 다시 부를 뿐이에요.

const PREFIX = "bb:v1:";
const MEM_MAX = 400;
const mem = new Map();

let runtime = null;
try {
  runtime = require("@vercel/functions").getCache();
} catch (e) {
  runtime = null;
}

const deps = { runtime };

async function get(key) {
  const k = PREFIX + key;
  try {
    if (deps.runtime) {
      const v = await deps.runtime.get(k);
      if (v !== null && v !== undefined) return v;
    }
  } catch (e) { /* 캐시 오류는 무시하고 원본을 다시 가져와요 */ }
  const m = mem.get(k);
  if (m && m.exp > Date.now()) return m.v;
  if (m) mem.delete(k);
  return null;
}

async function set(key, value, ttlSeconds) {
  const k = PREFIX + key;
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
  mem.set(k, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  try {
    if (deps.runtime) await deps.runtime.set(k, value, { ttl: ttlSeconds, name: key.split(":")[0] });
  } catch (e) { /* 무시 */ }
}

// 캐시에 있으면 그 값을, 없으면 fn()을 실행해서 저장해요. 같은 순간의 중복 호출은 하나로 합쳐요.
const inflight = new Map();
async function cached(key, ttlSeconds, fn) {
  const hit = await get(key);
  if (hit !== null) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const v = await fn();
    if (v !== null && v !== undefined) await set(key, v, ttlSeconds);
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function clearMemory() { mem.clear(); inflight.clear(); }

module.exports = { get, set, cached, clearMemory, deps };
