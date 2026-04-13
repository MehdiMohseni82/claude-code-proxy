# Claude Code Proxy

An OpenAI-compatible API proxy server that routes requests through the [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). Any application or tool that speaks the OpenAI API format -- Cursor, Continue, the `openai` Python/JS SDK, or any HTTP client -- can point at this proxy and use Claude as the backend.

It also exposes the native Anthropic Messages API (`/v1/messages`), so Anthropic SDK clients work too.

## Why This Exists

The Claude Code Agent SDK authenticates via OAuth tokens from a Claude Pro/Max subscription -- not standard API keys. This proxy wraps the SDK behind a standard API interface, adding the management layer you'd expect from a production service: API keys, rate limits, budgets, request logging, and an admin dashboard.

## Features

- **Dual API support** -- OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` endpoints
- **Embeddings** -- OpenAI-compatible `/v1/embeddings` endpoint backed by local Ollama (nomic-embed-text)
- **Model mapping** -- Send `gpt-4o` and it routes to `claude-sonnet-4-6`; `text-embedding-3-small` routes to `nomic-embed-text`
- **Full streaming** -- Server-sent events on both endpoints
- **Tool use** -- User-defined tools (function calling), Anthropic server tools (`web_search`, etc.), and Claude Code built-in tools (`Bash`, `Read`, `Edit`, `Grep`, ...)
- **API key management** -- Create, revoke, and configure keys through the admin UI
- **Per-key controls** -- Rate limits (RPM/TPM), monthly spending budgets, model restrictions, custom system prompts
- **Request history** -- Full prompt/response logging with search, filtering, and CSV/JSON export
- **Live task monitoring** -- See and cancel active requests in real time
- **Admin dashboard** -- Next.js web UI for managing everything
- **Token management via UI** -- Set the Claude OAuth token through the dashboard, no environment variables required
- **Docker deployment** -- Ready-to-deploy with Docker Compose, nginx, and Let's Encrypt SSL

---

## Architecture

```
                                 +-----------------+
  OpenAI SDK / Cursor / etc. --->|                 |---> Claude Code Agent SDK ---> Claude
                                 |  Express Server |
  Anthropic SDK / HTTP --------->|  (port 3456)    |---> Ollama (local embeddings)
                                 |                 |
                                 +-----------------+
                                        |
                                   SQLite DB
                                 (keys, history,
                                   settings)

                                 +-----------------+
  Browser ---------------------->|  Next.js Admin  |---> Express Admin API
                                 |  (port 3000)    |
                                 +-----------------+
```

The Express server handles all API traffic. The Next.js admin dashboard is a separate service that calls the Express admin API internally. In production, nginx sits in front and routes traffic to the right service.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- A Claude OAuth token (from `claude setup-token` with a Pro/Max subscription) or an Anthropic API key

### Local Development

```bash
# Clone the repo
git clone https://github.com/MehdiMohseni82/claude-code-proxy.git
cd claude-code-proxy

# Install dependencies
npm install
cd admin && npm install && cd ..

# Configure the Express server
cp .env.example .env
# Edit .env -- at minimum set ADMIN_API_SECRET

# Configure the admin dashboard
cp admin/.env.local.example admin/.env.local
# Edit admin/.env.local -- set matching ADMIN_API_SECRET and passwords

# Start the Express server
npm run dev

# In a second terminal, start the admin dashboard
cd admin && npm run dev
```

The API is now available at `http://localhost:3456` and the admin dashboard at `http://localhost:3000/admin`.

> **Note:** You can set the Claude token either as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable or through the admin dashboard Settings page after startup.

### Docker Compose (with SSL)

```bash
cp .env.example .env
# Edit .env with your domain, passwords, and secrets

# Get SSL certificate
chmod +x init-letsencrypt.sh
./init-letsencrypt.sh yourdomain.com you@email.com

# Start everything
docker-compose up -d
```

This starts four containers: the Express API server, Next.js admin, nginx reverse proxy, and certbot for automatic SSL renewal.

---

## Environment Variables

### Express Server (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3456` | Server port |
| `DATABASE_PATH` | No | `./data/proxy.db` | SQLite database path |
| `ADMIN_API_SECRET` | Yes | | Shared secret for admin API authentication |
| `AUTH_DISABLED` | No | `false` | Set to `true` to disable API key checks |
| `CLAUDE_CODE_OAUTH_TOKEN` | No* | | OAuth token from `claude setup-token` |
| `ANTHROPIC_API_KEY` | No* | | Standard Anthropic API key |

*At least one token must be configured -- either via environment variable or through the admin Settings page.

### Admin Dashboard (`admin/.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_SECRET` | Yes | | JWT signing secret (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | | Dashboard URL (e.g., `http://localhost:3000/admin`) |
| `ADMIN_USER` | Yes | | Admin login username |
| `ADMIN_PASSWORD` | Yes | | Admin login password |
| `INTERNAL_API_URL` | No | `http://localhost:3456` | Express server URL (internal) |
| `ADMIN_API_SECRET` | Yes | | Must match the Express server value |

### Docker Compose (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DOMAIN` | Yes | Your domain name (used by nginx and NextAuth) |
| `ADMIN_API_SECRET` | Yes | Shared secret between services |
| `NEXTAUTH_SECRET` | Yes | JWT signing secret |
| `ADMIN_USER` | Yes | Dashboard login username |
| `ADMIN_PASSWORD` | Yes | Dashboard login password |
| `CLAUDE_CODE_OAUTH_TOKEN` | No | Optional -- can be set via admin UI instead |

---

## API Reference

### Authentication

All `/v1/*` endpoints require an API key in one of two formats:

```
Authorization: Bearer sk-your-api-key
```
```
x-api-key: sk-your-api-key
```

Create API keys through the admin dashboard at `/admin/keys`.

### Models

| Client Sends | Routes To |
|---|---|
| `gpt-4o`, `gpt-4`, `gpt-4-turbo` | `claude-sonnet-4-6` |
| `gpt-3.5-turbo` | `claude-haiku-4-5` |
| `claude-opus-4-6` | `claude-opus-4-6` |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` |
| `claude-haiku-4-5` | `claude-haiku-4-5` |
| `text-embedding-ada-002` | `nomic-embed-text` (via Ollama) |
| `text-embedding-3-small` | `nomic-embed-text` (via Ollama) |
| `text-embedding-3-large` | `nomic-embed-text` (via Ollama) |
| `nomic-embed-text` | `nomic-embed-text` (via Ollama) |
| Any other string | Passed through as-is |

### OpenAI-Compatible Endpoints

#### `GET /v1/models`

Returns the list of available models in OpenAI format.

#### `POST /v1/chat/completions`

Standard OpenAI chat completion. Supports streaming, tool/function calling, and multi-turn conversations.

```bash
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**With tool/function calling:**

```bash
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }]
  }'
```

### Anthropic Native Endpoints

#### `POST /v1/messages`

Native Anthropic Messages API with full support for content blocks, tools, and streaming.

```bash
curl https://your-domain/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**With server-side tools (web search, etc.):**

```bash
curl https://your-domain/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "tools": [{"type": "web_search_20260209", "name": "web_search"}],
    "messages": [{"role": "user", "content": "What are the latest Mars rover discoveries?"}]
  }'
```

**With Claude Code built-in tools:**

```bash
curl https://your-domain/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "x-enable-builtin-tools: true" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "messages": [{"role": "user", "content": "List files in the current directory and summarize any README"}]
  }'
```

> Built-in tools must be enabled per API key through the admin dashboard.

### Embeddings

#### `POST /v1/embeddings`

OpenAI-compatible embeddings endpoint, backed by a local Ollama instance running `nomic-embed-text`. Accepts OpenAI model names -- they're mapped to the local model automatically.

```bash
curl https://your-domain/v1/embeddings \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "text-embedding-3-small", "input": "Hello world"}'
```

**Batch embeddings:**

```bash
curl https://your-domain/v1/embeddings \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "nomic-embed-text", "input": ["First text", "Second text", "Third text"]}'
```

Response follows the OpenAI format:
```json
{
  "object": "list",
  "data": [
    {"object": "embedding", "embedding": [0.123, -0.456, ...], "index": 0}
  ],
  "model": "nomic-embed-text",
  "usage": {"prompt_tokens": 2, "total_tokens": 2}
}
```

> Requires Ollama running with the model pulled. See [Ollama Setup](#ollama-setup-embeddings) below.

### Health Check

#### `GET /health`

```json
{
  "status": "ok",
  "backend": "claude-code-sdk",
  "db_status": "ok",
  "active_tasks": 0,
  "token_configured": true,
  "token_source": "database"
}
```

---

## Tool Support

The proxy supports three levels of tool use:

### 1. User-Defined Tools (Function Calling)

Works on both `/v1/chat/completions` (OpenAI format) and `/v1/messages` (Anthropic format). The proxy intercepts tool calls and returns them to the client for execution -- standard multi-turn function calling.

### 2. Server-Side Tools

Anthropic's built-in tools like `web_search` and `code_execution`. When these tools are in the request, the proxy lets Claude execute them internally and returns the final answer. No client-side tool handling needed.

### 3. Claude Code Built-In Tools

The full Claude Code toolset: `Bash`, `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `NotebookEdit`, and `Agent`. Enable per API key in the admin dashboard, then send the `x-enable-builtin-tools: true` header. Each key gets its own isolated workspace directory.

---

## Per-Key Settings

Every API key can be independently configured through the admin dashboard:

| Setting | Description | Default |
|---|---|---|
| **Built-in Tools** | Allow Claude Code native tools | Off |
| **Rate Limit (RPM)** | Max requests per minute | 30 |
| **Rate Limit (TPM)** | Max tokens per minute | Unlimited |
| **Monthly Budget** | Cost ceiling per calendar month (USD) | Unlimited |
| **Allowed Models** | Restrict to specific models | All models |
| **System Prompt** | Prepended to every request | None |
| **Cache TTL** | Cache identical requests (seconds) | No caching |

When a limit is exceeded:
- **Rate limit** returns `429 Too Many Requests` with a `Retry-After` header
- **Budget exceeded** returns `402 Payment Required`
- **Model not allowed** returns `403 Forbidden`

---

## Admin Dashboard

Access at `/admin` (login required).

### Dashboard
Overview stats: active tasks, requests today, token usage, cost, breakdown by model and status.

### API Keys
Create, configure, and revoke keys. Click any key row to expand its settings panel with inline editing for all per-key options.

### Active Tasks
Real-time view of running requests. Auto-refreshes every 3 seconds. Cancel any task with one click.

### Request History
Searchable, filterable, paginated log of all requests. Click any row to expand and see the full prompt, full response, error messages, and metadata. Export filtered results as CSV or JSON.

### Settings
Manage the Claude authentication token. Set it through the browser instead of SSH-ing into the server to edit environment variables. Shows token status, source (database vs. environment), and a masked preview.

---

## Production Deployment

### Option 1: Self-Contained (Docker Compose with nginx + SSL)

Uses the included `docker-compose.yml` which runs nginx and certbot alongside the app:

```bash
cp .env.example .env
# Edit .env with production values

./init-letsencrypt.sh yourdomain.com you@email.com
docker-compose up -d
```

### Option 2: Existing Server (Docker Compose + external nginx)

Uses `docker-compose.prod.yml` for servers that already have nginx and SSL configured:

```bash
# On the server
docker-compose -f docker-compose.prod.yml up -d --build

# Copy the nginx config
cp deploy/nginx-claudeproxy.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

The app container listens on `127.0.0.1:9026` and the admin on `127.0.0.1:9027`.

---

## Ollama Setup (Embeddings)

The proxy uses [Ollama](https://ollama.com) for local embeddings. The Ollama container is included in Docker Compose but starts empty -- you need to pull the embedding model once:

```bash
# After docker-compose up
docker exec claudeproxy-ollama ollama pull nomic-embed-text
```

This downloads ~274MB. The model is cached in the `ollama-data` volume and persists across restarts.

**For local development** (without Docker), install Ollama directly and pull the model:

```bash
# Install Ollama (see https://ollama.com/download)
ollama pull nomic-embed-text

# Set the URL in .env
OLLAMA_URL=http://localhost:11434
```

**Model quality:** `nomic-embed-text` scores 62.39 on the [MTEB benchmark](https://huggingface.co/spaces/mteb/leaderboard), matching OpenAI's `text-embedding-3-small` (62.3). It runs on CPU without requiring a GPU.

---

## Using with Popular Tools

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-domain/v1",
    api_key="sk-your-proxy-key"
)

response = client.chat.completions.create(
    model="gpt-4o",  # maps to claude-sonnet-4-6
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# Embeddings
embeddings = client.embeddings.create(
    model="text-embedding-3-small",  # maps to nomic-embed-text
    input=["Hello world", "How are you?"]
)
print(len(embeddings.data[0].embedding))  # 768 dimensions
```

### OpenAI Node.js SDK

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-domain/v1",
  apiKey: "sk-your-proxy-key",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://your-domain/v1",
    api_key="sk-your-proxy-key"
)

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Cursor / Continue

Set the API base URL to `https://your-domain/v1` and use your proxy API key. Model names like `gpt-4o` are automatically mapped to Claude.

### curl

```bash
# OpenAI format
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hi"}]}'

# Anthropic format
curl https://your-domain/v1/messages \
  -H "x-api-key: sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'
```

---

## Database

SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3). The database file is created automatically on first startup. Migrations run automatically.

**Tables:**

- `api_keys` -- Keys, permissions, and per-key settings
- `request_log` -- Full request/response history with token counts and cost
- `settings` -- Server configuration (OAuth token)

Default location: `./data/proxy.db` (configurable via `DATABASE_PATH`).

---

## Project Structure

```
claude-code-proxy/
  src/
    server.ts              # Entry point
    app.ts                 # Express app setup and middleware pipeline
    config.ts              # Environment variable loading
    models.ts              # Model name mapping
    db/
      connection.ts        # SQLite connection
      migrations.ts        # Schema DDL and migrations
    middleware/
      apiKeyAuth.ts        # API key validation
      adminAuth.ts         # Admin secret validation
      rateLimiter.ts       # RPM/TPM rate limiting
      budgetCheck.ts       # Monthly spending limits
      errorHandler.ts      # Centralized error responses
    routes/
      proxy.ts             # /v1/chat/completions, /v1/models
      anthropic.ts         # /v1/messages
      embeddings.ts        # /v1/embeddings (proxied to Ollama)
      adminApi.ts          # /api/admin/* (keys, tasks, history, settings)
      health.ts            # /health
    services/
      sdkBridge.ts         # Claude Code SDK wrapper
      toolBridge.ts        # MCP tool interception
      openaiToolTranslator.ts  # OpenAI <-> Anthropic format conversion
      apiKeyService.ts     # Key CRUD and validation
      historyService.ts    # Request logging and queries
      settingsService.ts   # Token and settings management
      taskTracker.ts       # Active task registry
    types/
      index.ts             # Core type definitions
      toolBridge.ts        # Tool-related types
  admin/                   # Next.js admin dashboard
    app/admin/
      login/               # Login page
      (authenticated)/
        page.tsx            # Dashboard
        keys/               # API key management
        tasks/              # Active task monitoring
        history/            # Request history
        settings/           # Token configuration
    components/
      Sidebar.tsx           # Navigation sidebar
    lib/
      api.ts               # Server-side API client
      client-api.ts        # Browser-side API client
      auth.ts              # NextAuth configuration
  deploy/
    nginx-claudeproxy.conf # Production nginx config
  docker-compose.yml       # Full stack (app + admin + nginx + certbot)
  docker-compose.prod.yml  # App + admin only (for existing nginx setups)
  Dockerfile               # Express server image
  admin/Dockerfile          # Next.js admin image
  init-letsencrypt.sh      # SSL certificate bootstrapping
```

---

## Development

```bash
# Type-check the Express server
npx tsc --noEmit

# Type-check the admin dashboard
cd admin && npx tsc --noEmit

# Build the Express server
npm run build

# Run in dev mode (auto-reload)
npm run dev
```

---

## License

MIT
