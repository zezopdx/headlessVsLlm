import logging
import time

import anthropic
from mcp import ClientSession

log = logging.getLogger(__name__)

MAX_TOOL_ITERATIONS = 25

# Markers that indicate a tool result was actually an error.
_ERROR_MARKERS = (
    "sql compilation error",
    "invalid identifier",
    "does not exist or not authorized",
    "error in secure object",
    "tool execution failed",
    "syntax error",
)


def _looks_like_error(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in _ERROR_MARKERS)


async def stream_agent(
    anthropic_client: anthropic.AsyncAnthropic,
    mcp_session: ClientSession,
    system_prompt: str,
    messages: list[dict],
    model: str,
):
    """
    Run one conversational turn, yielding step events as they happen so the UI
    can show the agent's live train of thought.

    Yields dicts with a "type" field:
      - status        : high-level lifecycle message
      - thought       : interim natural-language reasoning from Claude
      - query         : a SQL/tool call about to run
      - query_result  : outcome of a tool call
      - final         : the finished turn + metrics (always last on success)
      - error         : something went wrong
    """
    start = time.monotonic()

    yield {"type": "status", "message": "Connecting to Snowflake MCP server\u2026"}
    tools_result = await mcp_session.list_tools()
    tools = [
        {
            "name": t.name,
            "description": t.description or "",
            "input_schema": t.inputSchema,
        }
        for t in tools_result.tools
    ]
    yield {
        "type": "status",
        "message": f"{len(tools)} MCP tool(s) available \u00b7 sending prompt to Claude\u2026",
    }

    working_messages = list(messages)
    total_input = 0
    total_output = 0
    query_count = 0
    queries: list[str] = []
    final_text = ""

    for iteration in range(MAX_TOOL_ITERATIONS):
        response = await anthropic_client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            tools=tools,
            messages=working_messages,
        )

        total_input += response.usage.input_tokens
        total_output += response.usage.output_tokens

        if response.stop_reason == "end_turn":
            final_text = next(
                (b.text for b in response.content if hasattr(b, "text")), ""
            )
            break

        if response.stop_reason != "tool_use":
            final_text = next(
                (b.text for b in response.content if hasattr(b, "text")),
                f"[Stopped: {response.stop_reason}]",
            )
            break

        # surface any interim reasoning text Claude emitted alongside tool calls
        for block in response.content:
            if block.type == "text" and block.text.strip():
                yield {"type": "thought", "message": block.text.strip()}

        assistant_content = []
        for block in response.content:
            if block.type == "text":
                assistant_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    }
                )

        working_messages.append({"role": "assistant", "content": assistant_content})

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            query_count += 1
            sql = (
                block.input.get("query")
                or block.input.get("sql")
                or block.input.get("statement")
                or str(block.input)
            )
            queries.append(sql)
            log.info("Snowflake query #%d via tool '%s'", query_count, block.name)
            yield {
                "type": "query",
                "n": query_count,
                "tool": block.name,
                "sql": sql.strip(),
            }

            try:
                mcp_result = await mcp_session.call_tool(block.name, block.input)
                result_text = "\n".join(
                    c.text for c in mcp_result.content if hasattr(c, "text")
                )
            except Exception as exc:
                result_text = f"Tool execution failed: {exc}"

            is_error = _looks_like_error(result_text)
            yield {
                "type": "query_result",
                "n": query_count,
                "ok": not is_error,
                "preview": result_text[:240],
            }

            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_text,
                }
            )

        working_messages.append({"role": "user", "content": tool_results})
    else:
        log.warning("Hit max tool iterations (%d)", MAX_TOOL_ITERATIONS)
        final_text = final_text or "[Max tool iterations reached]"

    latency_ms = int((time.monotonic() - start) * 1000)
    yield {
        "type": "final",
        "response": final_text,
        "input_tokens": total_input,
        "output_tokens": total_output,
        "latency_ms": latency_ms,
        "snowflake_queries": query_count,
        "queries": queries,
    }
