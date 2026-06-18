# CLAUDE.md — AFD360 vs. LLM + MCP Demo

## Project Intent

This is one half of a two-app architectural comparison demo:
- **This app**: LLM (Anthropic API) + Snowflake MCP — the "clever prototype" architecture
- **The other app** (already built): Salesforce Headless AFD360 at https://github.com/josers18/Headless-JDO

Both apps are deployed separately on Heroku. During the demo, both are open in the browser simultaneously.
The comparison is run by submitting the same prompt to each app and observing the differences.

The goal is NOT to make one side lose. It's to give both architectures their best possible shot at the same problem,
then surface the architectural differences that matter at enterprise scale:
auditability, governance, semantic consistency, cost predictability, and operationalization.

## Demo Persona

All prompts and scenarios are centered on a single synthetic demo persona ("Julie Morris"). Julie is a customer at fictional bank, and we have data of her in our CRM as well as in our Snowflake. Some of that CRM data is also virtualized in Snowflake.
Julie's data lives in Snowflake and is zero-copied into Salesforce Data Cloud (JDO). Mainly her financial transaction data.
Both sides of the demo read from the same underlying dataset — no cherry-picking.

## Snowflake Schema

The demo dataset lives in a Snowflake datashare. The relevant schema contains views for:
- Financial accounts and transactions
- CRM objects: accounts, contacts, opportunities, cases, affiliations, campaigns


Do not hardcode connection strings or credentials. Reference them via environment variables only.
See `.env.example` for the expected variable names.

## Architecture

Keep it simple. This is a demo, not a production system.

Single execution path for this app:
**user prompt → Anthropic API (Claude) → Snowflake MCP (stdio subprocess) → Snowflake query → response**

The app is a minimal web server that:
1. Accepts a prompt via a simple UI
2. Calls the Anthropic API with MCP tool access to Snowflake
3. Returns the response with latency, token count, and any available audit metadata

## Coding Philosophy (ponytail: https://github.com/DietrichGebert/ponytail)

Follow the ponytail decision ladder for every implementation decision:
1. Does this need to exist? → If no, skip it (YAGNI)
2. Stdlib does it? → Use it
3. Native platform feature? → Use it
4. Installed dependency? → Use it
5. One line? → One line
6. Only then: the minimum that works

Never cut: input validation, error handling, security boundaries, or credential safety.
Never over-engineer: no caching layers, no abstractions, no classes where a function works, 
no config systems where an env var works.

## UI

Chat interface that mirrors how a customer would actually build this (Claude.ai / ChatGPT style).
Two columns:

**Left (~70%): Conversation panel**
- Full conversation history, passed to the API on every turn
- User and assistant message bubbles
- Prompt input + Send button at the bottom

**Right (~30%): Metrics panel**
- Editable price-per-1K-tokens inputs (input and output), defaulting to Anthropic list price
- Cost recalculates live as prices are edited
- Cumulative session totals: turns, total input/output tokens, estimated LLM cost
- Last-turn breakdown: latency, input/output tokens, Snowflake queries run
- "Clear chat" button — resets conversation and all metrics

**Snowflake compute costs:** not shown in-app. During the demo, open Snowsight → Query History
in a separate browser tab to show per-query execution and compute cost. This is intentional —
it illustrates that infra costs are opaque and scattered vs. a governed platform.

Each turn is appended to a local JSON log file for post-demo analysis.
No auth, no persistence layer, no fancy UI framework unless it's already a dependency.

## Metrics to Capture Per Run

Each run should emit a structured record with:
- Prompt text
- Architecture (mcp | afd360)
- Response text
- Latency (ms)
- Token count (input + output)
- Audit metadata (action name, record touched, invocation ID — or null if unavailable)
- Consistency score (captured manually across repeated runs)
- Notes field (free text for qualitative observations)

Need to be conscious of where I need to get all this data. If I'm creating an LLM api for example, need to highlight to look at the LLM account usage and billing data for example. 

## What "Done" Looks Like

A working demo that:
- Accepts a natural language prompt about Julie
- I can fire both architecures in parallel by having both UIs open in my browser
- Displays both responses side by side with captured metrics
- Logs results for post-demo analysis

That's it. Ship that first. Everything else is optional.

The AFD360 Horizon headless app is hosted on Heroku, I can do the same for the new LLM + MCP setup.

## Out of Scope (for now)

- Auth / multi-user support
- Persistent database
- Production error handling
- Any feature not directly needed for the live demo




Build plan
Phase 1 — Verify prerequisites (no code)

Source .env and confirm the Anthropic key works (/v1/models returns 200)
Confirm snowflake_rsa_key.pub is registered on the Snowflake user (ALTER USER ... SET RSA_PUBLIC_KEY=...) and a quick SELECT works
Decide Snowflake warehouse/role values are correct for EOB55465
Phase 2 — Core orchestration 4. services/configuration.yaml — MCP service config, read-only SQL 5. mcp_client.py — spawn MCP server, list tools, execute tool calls 6. agent.py — Anthropic agentic loop; collects tokens, latency, query count 7. app.py — FastAPI: POST /api/chat (conversation in → answer + metrics out), static serving, JSON logging

Phase 3 — UI 8. static/index.html + style.css + app.js — left conversation (~70%), right metrics (~30%): editable input/output price-per-1K (defaults $0.003 / $0.015 for Sonnet 4.5), live cost recalc, cumulative session totals, last-turn breakdown (latency, tokens, # Snowflake queries), Clear chat

Phase 4 — Run locally & validate 9. requirements.txt, run, fire a Julie Morris prompt, confirm SQL hits Snowflake and metrics populate

Phase 5 — Deploy to Heroku 10. Procfile, .python-version, heroku login, heroku create, set config vars (incl. SNOWFLAKE_PRIVATE_KEY), git push heroku main

Target file tree:


headlessVsLlm/
├── app.py
├── agent.py
├── mcp_client.py
├── requirements.txt
├── Procfile
├── .python-version
├── services/configuration.yaml
├── static/{index.html,style.css,app.js}
├── logs/runs.jsonl   (gitignored)
├── system_prompt.txt
└── .env / .env.example