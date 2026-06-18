# LLM + Snowflake MCP — Demo App

A minimal web app that answers natural-language questions about a banking customer by
letting **Claude (Anthropic)** query **Snowflake** through the **Snowflake MCP server**.

It's one half of a two-app architectural comparison: this "clever prototype" (LLM + MCP)
shown side-by-side against a governed enterprise platform
([Salesforce Headless AFD360](https://github.com/josers18/Headless-JDO)). See
[`TALK_TRACK.md`](./TALK_TRACK.md) for the demo narrative, and [`CLAUDE.md`](./CLAUDE.md)
for the project intent and design philosophy.

## Architecture

```
user prompt → FastAPI → Anthropic API (Claude, tool-use loop) → Snowflake MCP (stdio) → Snowflake → response
```

The agent loop runs manually so we can capture per-turn token counts, latency, and every
SQL query. Steps stream to the UI live as an "agent activity" trace.

## Features

- Two-panel chat UI: conversation (left) + metrics (right)
- Live agent-activity trace (MCP calls, queries, retries) streamed as the agent works
- Editable, **session-only** system prompt (resets on refresh; never persisted server-side)
- Prepared demo prompts with copy / load
- Per-turn and cumulative metrics: tokens, latency, SQL query count, editable cost estimate
- Each turn appended to `logs/runs.jsonl` for post-demo analysis

## Prerequisites

- **Python 3.12** (see `.python-version`)
- An **Anthropic API key**
- A **Snowflake account** reachable via **key-pair authentication**, with a warehouse and
  role that can read the demo data
- macOS/Linux shell (examples use bash/zsh)

## Setup

```bash
# 1. Clone
git clone https://github.com/zezopdx/headlessVsLlm.git
cd headlessVsLlm

# 2. Create a virtual environment (Python 3.12)
python3.12 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt
```

### Snowflake key-pair authentication

Generate an RSA key pair and register the **public** key on your Snowflake user:

```bash
# private key (PKCS#8, unencrypted for the demo)
openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out snowflake_rsa_key.p8 -nocrypt
# public key
openssl rsa -in snowflake_rsa_key.p8 -pubout -out snowflake_rsa_key.pub
```

Then in Snowflake (run as a role that can alter the user):

```sql
ALTER USER <your_user> SET RSA_PUBLIC_KEY='<contents of snowflake_rsa_key.pub, no header/footer lines>';
```

> `snowflake_rsa_key.p8` / `.pub` are gitignored — never commit them.

### Environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `INFERENCE_KEY` | Heroku Managed Inference API key (enterprise-billed; no personal token) |
| `INFERENCE_URL` | Heroku inference base URL (e.g. `https://us.inference.heroku.com`) |
| `INFERENCE_MODEL_ID` | Provisioned model id (e.g. `claude-4-5-sonnet`) |
| `SNOWFLAKE_ACCOUNT` | Account identifier (e.g. `ORG-ACCOUNT`) |
| `SNOWFLAKE_USER` | Snowflake username |
| `SNOWFLAKE_PRIVATE_KEY_FILE` | **Local:** path to the `.p8` file |
| `SNOWFLAKE_PRIVATE_KEY_B64` | **Heroku:** base64 of the `.p8` contents (leave blank locally) |
| `SNOWFLAKE_WAREHOUSE` | Warehouse to run queries |
| `SNOWFLAKE_ROLE` | Role to assume |

The `INFERENCE_*` values come from a Heroku Managed Inference model resource (see Deploy
below). For local dev, pull them from the Heroku app:

```bash
heroku config:get INFERENCE_KEY -a <your-app>
heroku config:get INFERENCE_URL -a <your-app>
heroku config:get INFERENCE_MODEL_ID -a <your-app>
```

The set of tables the agent is told about lives in [`system_prompt.txt`](./system_prompt.txt);
the MCP server is restricted to read-only SQL via
[`services/configuration.yaml`](./services/configuration.yaml).

## Run locally

```bash
# load env vars into the shell, then start the server
set -a && source .env && set +a
.venv/bin/uvicorn app:app
```

Open http://localhost:8000. Watch for `MCP session ready` in the logs on first request.

> Run without `--reload`; the reloader watches `.venv` and can loop. If you want reload:
> `uvicorn app:app --reload --reload-exclude '.venv/*'`.

## Deploy to Heroku

The app is Heroku-ready (`Procfile`, `.python-version`, b64 key handling in `app.py`).

```bash
heroku login
heroku create <unique-app-name>

# LLM: provision Heroku Managed Inference (sets INFERENCE_KEY / INFERENCE_URL /
# INFERENCE_MODEL_ID automatically — enterprise-billed, no personal token)
heroku plugins:install @heroku/plugin-ai
heroku ai:models:create claude-4-5-sonnet -a <unique-app-name> --as INFERENCE

# Snowflake config vars
heroku config:set \
  SNOWFLAKE_ACCOUNT="..." \
  SNOWFLAKE_USER="..." \
  SNOWFLAKE_WAREHOUSE="..." \
  SNOWFLAKE_ROLE="..."

# private key: base64-encode the .p8 inline (do NOT set SNOWFLAKE_PRIVATE_KEY_FILE on Heroku)
heroku config:set SNOWFLAKE_PRIVATE_KEY_B64="$(base64 -i snowflake_rsa_key.p8)"

# single worker so only one MCP subprocess spawns (avoids R14 on a 512 MB dyno)
heroku config:set WEB_CONCURRENCY=1

git push heroku main
heroku logs --tail   # look for "MCP session ready"
heroku open
```

`app.py` decodes `SNOWFLAKE_PRIVATE_KEY_B64` to a temp file at boot, so no `.p8` file is
needed on Heroku's ephemeral filesystem.

## Project structure

```
app.py                      FastAPI server, MCP lifespan, /api/chat (streaming), system-prompt endpoint
agent.py                    Anthropic tool-use loop; yields step events + metrics
system_prompt.txt           Default agent instructions (table guide, query rules)
services/configuration.yaml Snowflake MCP config — read-only (SELECT + DESCRIBE)
static/                     UI (index.html, style.css, app.js)
requirements.txt            Python dependencies
Procfile, .python-version   Heroku deploy config
logs/runs.jsonl             Per-turn run log (gitignored)
```

## Notes

- **Single warm MCP session** is shared across requests — fine for demo-scale concurrency
  (read-only queries, results isolated per request). Not built for production multi-tenant
  load; see `TALK_TRACK.md` for the identity/audit discussion.
- **System prompt edits are session-only** (browser-side), so multiple people can demo
  simultaneously without affecting each other or any shared state.
- This is a demo, not a production system: no auth, no persistence layer, minimal error
  handling by design.
