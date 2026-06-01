# Stable Diffusion API on Cloudflare Workers

A serverless **text-to-image generation API** built on [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Generate images from text prompts using Stable Diffusion XL, SDXL-Lightning, DreamShaper, and FLUX.1 [schnell] — all from a single Worker, with API-key auth and zero infrastructure to manage.

<p align="center">
  <img src="https://developers.cloudflare.com/_astro/workers-ai-logo.BMSEDtRz_2pUEni.svg" alt="Cloudflare Workers AI" width="420">
</p>

<p align="center">
  <a href="https://developers.cloudflare.com/workers-ai/"><img alt="Workers AI" src="https://img.shields.io/badge/Cloudflare-Workers%20AI-F38020?logo=cloudflare&logoColor=white"></a>
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-V8%20isolates-blue">
  <img alt="Language" src="https://img.shields.io/badge/lang-JavaScript%20ESM-yellow">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Features

- **Multi-model**: SDXL, SDXL-Lightning (fast), DreamShaper (photoreal), FLUX.1 [schnell]
- **API-key auth** — `Authorization: Bearer`, `x-api-key`, or `?api_key=` (timing-safe comparison)
- **Browser playground** at `/` — try prompts without writing any code
- **Two output modes** — raw `image/jpeg` (streamed) or `application/json` (base64 + data URL)
- **GET and POST** both supported on `/v1/generate`
- **CORS-enabled** out of the box — call it from any frontend
- **Observability enabled** — view logs and metrics in the Cloudflare dashboard
- **One file** of Worker code, no build step, no runtime npm bloat

---

## Available models

| Alias            | Model ID                                              | Best for                          |
|------------------|-------------------------------------------------------|-----------------------------------|
| `sdxl`           | `@cf/stabilityai/stable-diffusion-xl-base-1.0`        | High-quality general purpose      |
| `sdxl-lightning` | `@cf/bytedance/stable-diffusion-xl-lightning`         | Fast 1024px in ~4 steps           |
| `dreamshaper`    | `@cf/lykon/dreamshaper-8-lcm`                         | Photorealism                      |
| `flux-schnell`   | `@cf/black-forest-labs/flux-1-schnell`                | Fast, high quality (max 8 steps)  |

You can also pass any other Workers AI text-to-image model by its full `@cf/...` ID.

---

## Quick start

### 1. Install

```bash
git clone <this-repo>
cd cloudflare-api
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 3. Set the API key

Production (encrypted secret on Cloudflare):

```bash
npx wrangler secret put API_KEY
# paste your key when prompted
```

Local dev — put it in `.dev.vars` (already gitignored):

```bash
echo 'API_KEY=local-dev-key' > .dev.vars
```

### 4. Run locally

> Workers AI **always runs remotely on Cloudflare's edge**, even via `wrangler dev`. Usage is billed against your Cloudflare account.

```bash
npm run dev
# → http://localhost:8787
```

Open the URL in a browser to use the **playground UI** (it'll ask for your API key).

### 5. Deploy

```bash
npm run deploy
# → https://stable-diffusion-api.<your-subdomain>.workers.dev
```

---

## Authentication

Every request to `/v1/generate` must include your API key in one of three places:

| Method                    | Example                                   | Notes                  |
|---------------------------|-------------------------------------------|------------------------|
| `Authorization` header    | `Authorization: Bearer <key>`             | Preferred              |
| `x-api-key` header        | `x-api-key: <key>`                        |                        |
| `api_key` query parameter | `?api_key=<key>`                          | Useful for quick tests; avoid in logs |

`/v1/models` and the playground at `/` are **public** (no auth needed).

---

## API reference

Base URL when deployed: `https://stable-diffusion-api.<subdomain>.workers.dev`
Base URL locally:       `http://localhost:8787`

### `GET /`
Returns the HTML playground.

### `GET /v1/models`
Lists available model aliases and the configured default model. **No auth required.**

```bash
curl http://localhost:8787/v1/models
```

```json
{
  "default": "@cf/stabilityai/stable-diffusion-xl-base-1.0",
  "aliases": {
    "sdxl":           "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "sdxl-lightning": "@cf/bytedance/stable-diffusion-xl-lightning",
    "dreamshaper":    "@cf/lykon/dreamshaper-8-lcm",
    "flux-schnell":   "@cf/black-forest-labs/flux-1-schnell"
  }
}
```

### `POST /v1/generate`

**Headers**: `Content-Type: application/json` + an API key (see [Authentication](#authentication)).

**Body**:

| Field             | Type    | Default       | Notes                                                       |
|-------------------|---------|---------------|-------------------------------------------------------------|
| `prompt`          | string  | **required**  | Up to 2048 chars                                            |
| `negative_prompt` | string  | —             | What to avoid                                               |
| `model`           | string  | server default | Alias from the table above or a full `@cf/...` ID          |
| `num_steps`       | int     | 20            | Max 20 (SDXL) / 8 (FLUX)                                    |
| `width`           | int     | 1024          | 256–2048                                                    |
| `height`          | int     | 1024          | 256–2048                                                    |
| `guidance`        | number  | 7.5           | Prompt adherence; higher = more literal                     |
| `seed`            | int     | random        | For reproducible results                                    |
| `strength`        | number  | 1             | (img2img only) 0–1                                          |
| `format`          | string  | `image`       | `image` → JPEG bytes, `json` → `{ image_base64, data_url }` |

**Response**: raw `image/jpeg` by default, or JSON if `format: "json"`.

### `GET /v1/generate?prompt=...&model=sdxl&api_key=...`
Convenience GET form — all parameters as query strings. Returns a JPEG.

---

## Curl examples

> All examples assume `API_KEY` is exported in your shell: `export API_KEY=...`

### Basic generation (save to file)

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{"prompt":"a red panda astronaut floating in space, ultra detailed"}' \
  --output out.jpg
```

### SDXL Lightning (fast — 4 steps)

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "prompt": "a cyberpunk cat on a neon rooftop at night",
    "model": "sdxl-lightning",
    "num_steps": 4,
    "width": 1024,
    "height": 1024
  }' \
  --output cat.jpg
```

### DreamShaper (photoreal)

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "prompt": "portrait of an old fisherman, weathered face, golden hour, 85mm photo",
    "model": "dreamshaper",
    "negative_prompt": "cartoon, painting, blurry",
    "guidance": 8
  }' \
  --output fisherman.jpg
```

### FLUX.1 [schnell]

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "prompt": "an art deco poster of a mountain sunrise",
    "model": "flux-schnell",
    "num_steps": 8
  }' \
  --output poster.jpg
```

### GET request (quick browser test)

```bash
curl "http://localhost:8787/v1/generate?prompt=a%20golden%20retriever%20surfing&model=sdxl-lightning&api_key=$API_KEY" \
  --output dog.jpg
```

### JSON output (base64 + data URL)

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{
    "prompt": "isometric pixel art of a tiny island",
    "model": "sdxl",
    "format": "json"
  }' | jq .
```

### Reproducible output (fixed seed)

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "authorization: Bearer $API_KEY" \
  -d '{"prompt":"a hot air balloon over Cappadocia","seed":42}' \
  --output balloon.jpg
```

### Using `x-api-key` instead of Bearer

```bash
curl -X POST http://localhost:8787/v1/generate \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"prompt":"a futuristic city at dusk"}' \
  --output city.jpg
```

### List available models (no auth)

```bash
curl http://localhost:8787/v1/models | jq .
```

---

## Wrangler command reference

All commands assume you're inside this project directory.

### Development

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler dev`                           | Start local dev server (Workers AI is remote)  |
| `npx wrangler dev --port 3000`               | Use a custom port                              |
| `npx wrangler dev --remote`                  | Run the Worker itself on the edge              |
| `npx wrangler dev --live-reload`             | Reload on HTML changes                         |

### Deployment

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler deploy`                        | Deploy to production                           |
| `npx wrangler deploy --dry-run`              | Validate without uploading                     |
| `npx wrangler deploy --minify`               | Deploy with minified output                    |
| `npx wrangler deploy --keep-vars`            | Preserve dashboard-set vars                    |

### Secrets

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler secret put API_KEY`            | Set/rotate the API key (prompts securely)      |
| `npx wrangler secret list`                   | List secret names                              |
| `npx wrangler secret delete API_KEY`         | Remove the secret                              |

### Logs & observability

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler tail`                          | Stream live logs                               |
| `npx wrangler tail --status error`           | Errors only                                    |
| `npx wrangler tail --format json`            | JSON output (pipe to `jq`)                     |
| `npx wrangler tail --search "generate"`      | Filter by string                               |

### Versions & rollback

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler versions list`                 | Show recent deployed versions                  |
| `npx wrangler versions view <VERSION_ID>`    | Inspect a specific version                     |
| `npx wrangler rollback`                      | Roll back to the previous version              |
| `npx wrangler rollback <VERSION_ID>`         | Roll back to a specific version                |

### Workers AI

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler ai models`                     | List all Workers AI models available           |
| `npx wrangler ai finetune list`              | List your fine-tuned models                    |

### Account & config

| Command                                      | What it does                                   |
|----------------------------------------------|------------------------------------------------|
| `npx wrangler login`                         | Log in to your Cloudflare account              |
| `npx wrangler whoami`                        | Show the logged-in account                     |
| `npx wrangler types`                         | Generate TypeScript types from `wrangler.jsonc` |
| `npx wrangler check startup`                 | Profile Worker startup time                    |
| `npx wrangler delete`                        | Delete the deployed Worker                     |

---

## Project layout

```
cloudflare-api/
├── src/
│   └── index.mjs       # Worker entrypoint — routes, auth, AI calls, playground HTML
├── wrangler.jsonc      # Worker config (AI binding, vars, compatibility date)
├── package.json
├── .gitignore
└── README.md
```

### `wrangler.jsonc`

```jsonc
{
  "name": "stable-diffusion-api",
  "main": "src/index.mjs",
  "compatibility_date": "2026-05-01",
  "ai": { "binding": "AI" },
  "observability": { "enabled": true },
  "vars": {
    "DEFAULT_MODEL": "@cf/stabilityai/stable-diffusion-xl-base-1.0"
  }
}
```

The `API_KEY` is a **secret**, not a `var` — set it with `wrangler secret put API_KEY`, not in the config file.

---

## Configuration

### Change the default model

Edit `wrangler.jsonc`:

```jsonc
"vars": {
  "DEFAULT_MODEL": "@cf/bytedance/stable-diffusion-xl-lightning"
}
```

Then redeploy:

```bash
npm run deploy
```

### Rotate the API key

```bash
npx wrangler secret put API_KEY
```

### Custom domain

After deploying, attach a custom domain via the Cloudflare dashboard (Workers & Pages → your Worker → Settings → Domains) or by adding `routes` to `wrangler.jsonc`.

---

## Troubleshooting

| Symptom                                         | Likely cause / fix                                                                                  |
|-------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `401 Missing API key`                           | Send `Authorization: Bearer <key>`, `x-api-key: <key>`, or `?api_key=<key>`                          |
| `403 Invalid API key`                           | Key doesn't match the secret on the Worker. Re-run `npx wrangler secret put API_KEY`                |
| `500 Server misconfigured: API_KEY secret not set` | Run `npx wrangler secret put API_KEY` (prod) or add `API_KEY=...` to `.dev.vars` (local)         |
| `401 Unauthorized` from Workers AI              | Run `npx wrangler login` and confirm `npx wrangler whoami`                                          |
| `Unknown model` response                        | Use an alias from `/v1/models` or a full `@cf/...` model ID                                         |
| Generation is slow                              | Use `sdxl-lightning` or `flux-schnell` with low `num_steps` (4–8)                                   |
| Image is grainy at small sizes                  | Use `width`/`height` ≥ 1024 — SDXL was trained at 1024×1024                                          |
| CORS errors from a frontend                     | Already handled; ensure your fetch sends `content-type: application/json`                            |
| Local dev still bills me                        | Yes — Workers AI is always remote. Use a cheap model for dev or stub `env.AI.run` in tests          |

---

## License

MIT
