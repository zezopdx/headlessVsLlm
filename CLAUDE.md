# CLAUDE.md — AFD360 vs. LLM + MCP Demo

## Project Intent

This project is a side-by-side architectural comparison demo:
- **Left side**: LLM + MCP to a hyperscaler (Snowflake) — representing the "clever prototype" architecture
- **Right side**: Salesforce Headless AFD360 — representing the enterprise-grade action platform architecture

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

Two parallel execution paths:
1. **MCP path**: user prompt → MCP server → Snowflake query → LLM response
2. **AFD360 path**: user prompt → Salesforce Headless API → Agent Action → Data Cloud → response (this is already built, see repo here: https://github.com/josers18/Headless-JDO)

Both paths share:
- The same prompt input
- The same underlying data
- A common response envelope that captures: response text, latency, token count, audit metadata

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

Minimal. Two panels, one shared prompt input, one "Run" button.
Display per-panel: response, latency, token count, audit trail (or its absence).
Log each run to a structured JSON file for metrics analysis.
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