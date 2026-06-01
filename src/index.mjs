const MODELS = {
  "sdxl": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
  "sdxl-lightning": "@cf/bytedance/stable-diffusion-xl-lightning",
  "dreamshaper": "@cf/lykon/dreamshaper-8-lcm",
  "flux-schnell": "@cf/black-forest-labs/flux-1-schnell",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

const bad = (msg, status = 400) => json({ error: msg }, status);

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractKey(request) {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const h = request.headers.get("x-api-key");
  if (h) return h.trim();
  return new URL(request.url).searchParams.get("api_key");
}

function authorize(request, env) {
  if (!env.API_KEY) {
    return bad("Server misconfigured: API_KEY secret not set", 500);
  }
  const provided = extractKey(request);
  if (!provided) {
    return new Response(
      JSON.stringify({ error: "Missing API key. Send `Authorization: Bearer <key>` or `x-api-key` header." }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="stable-diffusion-api"',
          ...CORS,
        },
      },
    );
  }
  if (!timingSafeEqual(provided, env.API_KEY)) {
    return json({ error: "Invalid API key" }, 403);
  }
  return null;
}

function resolveModel(name, fallback) {
  if (!name) return fallback;
  if (MODELS[name]) return MODELS[name];
  if (name.startsWith("@cf/")) return name;
  return null;
}

function buildInputs(params, model) {
  const {
    prompt,
    negative_prompt,
    num_steps,
    width,
    height,
    guidance,
    seed,
    strength,
  } = params;

  const inputs = { prompt };
  if (negative_prompt) inputs.negative_prompt = negative_prompt;
  if (num_steps != null) inputs.num_steps = Number(num_steps);
  if (width != null) inputs.width = Number(width);
  if (height != null) inputs.height = Number(height);
  if (guidance != null) inputs.guidance = Number(guidance);
  if (seed != null) inputs.seed = Number(seed);
  if (strength != null) inputs.strength = Number(strength);

  // flux-1-schnell uses `steps` (max 8) and returns base64 JSON, not a stream.
  if (model.includes("flux-1-schnell")) {
    if (inputs.num_steps != null) {
      inputs.steps = Math.min(inputs.num_steps, 8);
      delete inputs.num_steps;
    }
  }
  return inputs;
}

async function runModel(env, model, inputs) {
  const raw = await env.AI.run(model, inputs);

  // flux returns { image: "<base64>" }
  if (raw && typeof raw === "object" && !(raw instanceof ReadableStream) && raw.image) {
    const bytes = Uint8Array.from(atob(raw.image), (c) => c.charCodeAt(0));
    return { body: bytes, contentType: "image/jpeg" };
  }

  // Everything else: ReadableStream of JPEG bytes
  return { body: raw, contentType: "image/jpeg" };
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function streamToBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function handleGenerate(request, env) {
  let params;
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return bad("Content-Type must be application/json");
    }
    try {
      params = await request.json();
    } catch {
      return bad("Invalid JSON body");
    }
  } else {
    const url = new URL(request.url);
    params = Object.fromEntries(url.searchParams);
  }

  if (!params.prompt || typeof params.prompt !== "string") {
    return bad("`prompt` is required");
  }
  if (params.prompt.length > 2048) {
    return bad("`prompt` too long (max 2048 chars)");
  }

  const model = resolveModel(params.model, env.DEFAULT_MODEL);
  if (!model) return bad(`Unknown model. Available: ${Object.keys(MODELS).join(", ")}`);

  const inputs = buildInputs(params, model);
  const format = (params.format || "image").toLowerCase();

  try {
    const { body, contentType } = await runModel(env, model, inputs);

    if (format === "json" || format === "base64") {
      const bytes = body instanceof ReadableStream ? await streamToBytes(body) : body;
      return json({
        model,
        prompt: params.prompt,
        content_type: contentType,
        image_base64: bytesToBase64(bytes),
        data_url: `data:${contentType};base64,${bytesToBase64(bytes)}`,
      });
    }

    return new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
        ...CORS,
      },
    });
  } catch (err) {
    return bad(`Inference failed: ${err.message || String(err)}`, 500);
  }
}

const PLAYGROUND_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stable Diffusion API</title>
<style>
  body{font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem;color:#222}
  textarea,input,select,button{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;margin:.25rem 0}
  button{background:#0f62fe;color:#fff;border:0;cursor:pointer;padding:.7rem}
  .row{display:flex;gap:.5rem}.row>*{flex:1}
  img{max-width:100%;margin-top:1rem;border:1px solid #ddd}
  pre{background:#f4f4f4;padding:.5rem;overflow:auto;font-size:.85em}
</style></head><body>
<h1>Stable Diffusion on Cloudflare Workers AI</h1>
<form id="f">
  <label>API key<input name="api_key" type="password" placeholder="Bearer token" required></label>
  <label>Prompt<textarea name="prompt" rows="3" required>a cyberpunk cat sitting on a neon rooftop, ultra detailed</textarea></label>
  <label>Negative prompt<input name="negative_prompt" placeholder="blurry, low quality"></label>
  <div class="row">
    <label>Model<select name="model">
      <option value="sdxl">sdxl</option>
      <option value="sdxl-lightning">sdxl-lightning</option>
      <option value="dreamshaper">dreamshaper</option>
      <option value="flux-schnell">flux-schnell</option>
    </select></label>
    <label>Steps<input name="num_steps" type="number" value="20" min="1" max="20"></label>
  </div>
  <div class="row">
    <label>Width<input name="width" type="number" value="1024"></label>
    <label>Height<input name="height" type="number" value="1024"></label>
    <label>Guidance<input name="guidance" type="number" value="7.5" step="0.1"></label>
    <label>Seed<input name="seed" type="number" placeholder="random"></label>
  </div>
  <button>Generate</button>
</form>
<div id="out"></div>
<h3>API</h3>
<pre>POST /v1/generate
{ "prompt": "...", "model": "sdxl", "num_steps": 20, "width": 1024, "height": 1024 }

GET  /v1/generate?prompt=...&model=sdxl
GET  /v1/models</pre>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const out = document.getElementById('out');
  out.innerHTML = '<p>Generating…</p>';
  const body = {};
  for (const [k, v] of new FormData(e.target)) if (v !== '') body[k] = v;
  const key = body.api_key; delete body.api_key;
  const t = performance.now();
  const r = await fetch('/v1/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!r.ok) { out.innerHTML = '<p>Error: ' + await r.text() + '</p>'; return; }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  out.innerHTML = '<p>Done in ' + ((performance.now()-t)/1000).toFixed(2) + 's</p><img src="'+url+'">';
});
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "/playground") {
      return new Response(PLAYGROUND_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/v1/models") {
      return json({
        default: env.DEFAULT_MODEL,
        aliases: MODELS,
      });
    }

    if (url.pathname === "/v1/generate") {
      const denied = authorize(request, env);
      if (denied) return denied;
      return handleGenerate(request, env);
    }

    return bad("Not found", 404);
  },
};
