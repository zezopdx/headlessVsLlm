import base64
import json
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from pydantic import BaseModel

load_dotenv()

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "services" / "configuration.yaml"
SYSTEM_PROMPT_FILE = BASE_DIR / "system_prompt.txt"
LOG_FILE = BASE_DIR / "logs" / "runs.jsonl"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def _ensure_private_key_file() -> None:
    """On Heroku there is no .p8 file — decode SNOWFLAKE_PRIVATE_KEY_B64 to a temp file."""
    key_file = os.environ.get("SNOWFLAKE_PRIVATE_KEY_FILE")
    if key_file and Path(key_file).exists():
        return
    key_b64 = os.environ.get("SNOWFLAKE_PRIVATE_KEY_B64")
    if not key_b64:
        return
    fd, path = tempfile.mkstemp(suffix=".p8")
    with os.fdopen(fd, "wb") as f:
        f.write(base64.b64decode(key_b64))
    os.environ["SNOWFLAKE_PRIVATE_KEY_FILE"] = path
    log.info("Private key decoded to temp file: %s", path)


def _mcp_command() -> tuple[str, list[str]]:
    """Use the installed console script on Heroku; fall back to uvx locally."""
    config = str(CONFIG_FILE.resolve())
    installed = shutil.which("snowflake-labs-mcp")
    if installed:
        return installed, ["--service-config-file", config]
    return "uvx", ["snowflake-labs-mcp", "--service-config-file", config]


def _anthropic_client_and_model() -> tuple[anthropic.AsyncAnthropic, str]:
    """
    Prefer Heroku Managed Inference (enterprise-billed, no personal token) when the
    INFERENCE_* config vars are present; otherwise fall back to a direct Anthropic API
    key for local dev. Heroku's Claude endpoint speaks the native Anthropic Messages
    API, so the agent loop is unchanged — we only swap the base URL + auth.
    """
    inference_key = os.environ.get("INFERENCE_KEY")
    inference_url = os.environ.get("INFERENCE_URL")
    if inference_key and inference_url:
        model = os.environ.get("INFERENCE_MODEL_ID", "claude-4-5-sonnet")
        client = anthropic.AsyncAnthropic(auth_token=inference_key, base_url=inference_url)
        log.info("LLM: Heroku Managed Inference (%s) via %s", model, inference_url)
        return client, model
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    log.info("LLM: direct Anthropic API (%s)", model)
    return client, model


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_private_key_file()
    cmd, args = _mcp_command()
    log.info("Starting MCP server: %s %s", cmd, " ".join(args))

    server_params = StdioServerParameters(
        command=cmd,
        args=args,
        env=dict(os.environ),  # pass full env so Snowflake vars are visible
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            log.info("MCP session ready")
            app.state.session = session
            app.state.system_prompt = SYSTEM_PROMPT_FILE.read_text()
            client, model = _anthropic_client_and_model()
            app.state.anthropic = client
            app.state.model = model
            yield
    log.info("MCP session closed")


app = FastAPI(lifespan=lifespan)


class ChatRequest(BaseModel):
    messages: list[dict]
    system_prompt: str | None = None


@app.get("/api/system-prompt")
async def get_system_prompt():
    """Return the on-disk default. The browser holds and edits its own copy."""
    return {"prompt": app.state.system_prompt}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    from agent import stream_agent

    if not req.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    model = app.state.model

    # Browser may send a session-only edited prompt; fall back to the disk default.
    system_prompt = (req.system_prompt or "").strip() or app.state.system_prompt

    async def event_stream():
        final_event = None
        try:
            async for event in stream_agent(
                anthropic_client=app.state.anthropic,
                mcp_session=app.state.session,
                system_prompt=system_prompt,
                messages=req.messages,
                model=model,
            ):
                if event.get("type") == "final":
                    final_event = event
                yield json.dumps(event) + "\n"
        except Exception as e:
            log.exception("Agent error")
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            return

        if final_event:
            LOG_FILE.parent.mkdir(exist_ok=True)
            record = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "architecture": "mcp",
                "prompt": req.messages[-1].get("content", ""),
                **{k: v for k, v in final_event.items() if k != "type"},
            }
            with LOG_FILE.open("a") as f:
                f.write(json.dumps(record) + "\n")

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
