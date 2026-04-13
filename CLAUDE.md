# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project does

OpenAI-compatible API server that proxies requests to the Claude Code Agent SDK (`@anthropic-ai/claude-agent-sdk`). Clients using the OpenAI API format (e.g. the `openai` Python/JS SDK, Cursor, Continue) can point at this server and transparently use Claude Code as the backend.

## Commands

- `npm run dev` — run the server in dev mode (tsx, no build step)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server from `dist/server.js`
- `npx tsc --noEmit` — type-check without emitting

No test framework is set up yet.

## Architecture

The entire server lives in `src/server.ts` — a single-file Express app with three concerns:

1. **Model mapping** — `MODEL_MAP` translates OpenAI model names (e.g. `gpt-4o`) to Claude model identifiers. Unknown model names are passed through as-is, so native Claude model IDs also work.

2. **Message conversion** — `messagesToPrompt()` flattens the OpenAI `messages` array into a single prompt string for the SDK's `query()` function. Single user messages are passed through directly; multi-message conversations are formatted with role prefixes.

3. **Request handling** — Two code paths based on `stream`:
   - `handleNonStreamingRequest` — collects all `assistant` and `result` messages from the SDK async generator, returns a single JSON response.
   - `handleStreamingRequest` — uses `includePartialMessages: true` to get `stream_event` messages, forwards `text_delta` events as SSE chunks in OpenAI's `chat.completion.chunk` format, ending with `data: [DONE]`.

Both paths set `maxTurns: 1` on the SDK query to keep responses single-turn.

## Key SDK types

The SDK's `query()` returns an `AsyncGenerator<SDKMessage>`. The message types that matter here:
- `assistant` — contains `message.content` blocks (filter for `type === "text"`)
- `result` — has `usage.input_tokens` / `usage.output_tokens` and `total_cost_usd`; `result` text field only exists when `subtype === "success"`
- `stream_event` — wraps raw Anthropic API stream events; text deltas are at `event.delta.text` when `event.type === "content_block_delta"` and `event.delta.type === "text_delta"`

## Environment

- `PORT` — server port (default: `3456`)
- The server requires a valid Claude Code / Anthropic API authentication (inherited from the environment where Claude Code CLI is authenticated)
