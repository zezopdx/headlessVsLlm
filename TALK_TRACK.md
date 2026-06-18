# Talk Track — LLM + Snowflake MCP vs. Headless AFD360

A reference for running the side-by-side demo. The goal is **not** to make one side
lose. Give both architectures their best shot at the same problem (a banker asking about
Julie Morris), then surface the differences that matter at enterprise scale.

Two apps, same underlying Snowflake dataset, same prompts, open side-by-side:
- **This app** — LLM (Anthropic) + Snowflake MCP. The "clever prototype."
- **The other app** — Salesforce Headless AFD360 (Data Cloud). The governed platform.

---

## The one-sentence framing

> This isn't LLM+MCP *vs.* AFD360 on capability — both can answer "tell me about Julie."
> It's the same demo showing two different **operating models**. The difference is
> everything that happens *around* the answer at enterprise scale.

---

## What the LLM + MCP architecture is genuinely great at

Lead with real strengths — the prototype earns them honestly:

- **Speed to first value.** One engineer, an API key, and an MCP server stood this up in
  days. No data model, no semantic layer, no admin config.
- **Open-ended exploration.** The model writes its own SQL and self-corrects, so it can
  answer questions you never anticipated. It's a flexible analyst, not a fixed workflow.
- **No schema lock-in.** Point it at any database and go.

**Best fit:** prototypes, hackathons, internal power-user tools, ad-hoc exploration,
validating "is this even useful?" — where speed-to-prototype matters more than governance.

**Honest one-liner:** *"This is the fastest way to get a clever answer. It's the right
tool when speed beats governance."*

---

## Where it strains — and where AFD360 wins

Use the live **Agent activity** box as Exhibit A: watching it guess table names, hit
errors, DESCRIBE, and retry is the cool part of the demo — and it's also the governance
problem in miniature.

| Dimension | LLM + MCP (this app) | Headless AFD360 |
|---|---|---|
| **Auditability** | Model decides what to query. You can log SQL, but there's no business-action record — "who did what to which record and why" is reconstructed, not native. | Every invocation is a named action against a record with an invocation ID. Audit is a first-class output. |
| **Consistency** | Re-run the same prompt → different SQL, different phrasing, sometimes different numbers. (Use the "give me that overview again" prompt to show this live.) | Deterministic. Same input → same governed action → same result. |
| **Governance / security** | Broad read access; queries improvised. Guardrails are prompt-based and best-effort. | Permissions, sharing rules, field-level security enforced by the platform, not a prompt. |
| **Semantic consistency** | "Relationship value" means whatever the model computes that run. | Defined once in the semantic model, identical everywhere. |
| **Cost predictability** | Token cost scales with question breadth + retries; Snowflake compute is opaque and scattered (hence "check Query History in another tab"). | Predictable, governed compute. |
| **Operationalization** | Hard to embed in a regulated workflow, certify, or hand to compliance. | Built to be operationalized — that's the point. |

**Honest one-liner for the platform:** *"AFD360 trades some flexibility and setup time for
the things a regulated enterprise can't live without: auditable, consistent, governed,
operationalizable by default."*

---

## The concurrency / multi-tenant argument (the strongest point)

A customer will rightly say: *"We'd have many bankers using this at once — isn't that the
real scenario? And can't you architect the MCP server/client to handle concurrent load?"*

**Concede the technical point — it's correct.** Concurrency is solvable:
- Client-side **session pool** (N warm MCP sessions, one per request).
- **HTTP-transport MCP** (streamable HTTP, not stdio), scaled horizontally behind a load
  balancer with a Snowflake connection pool.
- Snowflake connection pooling + warehouse auto-scaling for query concurrency.

So nobody should claim "MCP can't scale." Throughput is the easy 20%.

**Then pivot to the hard 80% that concurrency forces you to confront — identity, authz,
and audit:**

- **One shared service identity.** In this app, *every* request authenticates to Snowflake
  as a single service user (`MCP_SERVICE_USER` / `SYSADMIN`). Every banker queries with the
  same broad privileges. Banker A and Banker B are indistinguishable to the data layer.
- **No per-user entitlements.** "This banker can only see their own book of business" isn't
  enforceable without building a whole authorization layer — per-user credential brokering,
  query rewriting, row-level security tied to the caller.
- **Audit collapses.** Snowsight Query History shows 200 bankers' activity attributed to one
  service account. "Who accessed Julie's data, and were they entitled to?" is unanswerable.
  For a regulated bank, that's a compliance failure, not a nice-to-have.

**The line:**

> *"Concurrency is exactly the enterprise reality — and yes, you can pool sessions and scale
> the MCP server. But notice what that surfaces: in this prototype every banker is the same
> all-powerful service account. Making it production-safe for many bankers doesn't mean
> adding more connections — it means rebuilding identity, entitlements, and per-user audit.
> That's not a tweak to the prototype; that's rebuilding the platform. AFD360 starts where
> this finishes."*

The prototype's shortcuts are invisible at N=1 and become existential at N=200.

---

## The system prompt as a governance prop

Open the **System** tab during the demo:

> *"This entire architecture's behavior is governed by this editable text file. I can change
> the rules live and re-run. Edits are session-only and reset on refresh — but in the
> prototype, the 'policy' is just a prompt anyone can edit. Contrast that with AFD360, where
> behavior is governed by platform-enforced actions and permissions, not prose."*

The fragility *is* the point you're illustrating.

---

## The synthesis — don't pick a winner

Close with a **maturity curve, not a cage match:**

> *"Use the LLM + MCP pattern to explore and prototype — to discover what questions are worth
> answering. Then, when an answer needs to be trusted, repeated, audited, and run by
> non-experts at scale, you graduate it onto a governed platform like AFD360. The prototype
> proves the value; the platform makes it safe to operationalize. They're two ends of the
> same journey — and the live activity box you just watched is precisely the seam between
> them: flexibility on one side, governance on the other."*

This gives both architectures their best shot and makes the buyer feel smart for wanting
both, rather than defensive about choosing one.

---

## Suggested demo flow

1. **Open both apps side-by-side.** Same Snowflake data underneath.
2. **Opening prompt** (Prompts tab → "quick overview of Julie Morris"). Hits 4+ tables;
   watch the **Agent activity** box show MCP calls, table exploration, queries, retries.
3. **Point at the Metrics panel** — real token cost of that breadth. Note Snowflake compute
   is *not* here; open Snowsight Query History in another tab to show it's opaque/scattered.
4. **Follow-ups** (campaigns, cross-sell, affiliations) — show conversation memory working.
5. **Re-run the overview** — show run-to-run variance (consistency point).
6. **Open the System tab** — edit a rule live, re-run, then note it resets on refresh
   (governance-as-prose point).
7. **Raise concurrency yourself** if they don't — deliver the identity/audit pivot above.
8. **Close on the maturity curve** — prototype proves value, platform operationalizes it.

---

## Notes / open items

- Demo runs on a **single warm MCP session** (one Snowflake service identity). Fine for the
  expected demo scale; correct, isolated results, with at most minor queueing latency. A
  warm-session pool is the cheap next step if real concurrency is ever needed — intentionally
  left out per the "demo, not production" philosophy.
- System prompt edits are **browser/session-only**; the on-disk default is the single source
  of truth and is what deploys to Heroku. Refresh resets. Multi-user safe (no shared server
  state to corrupt).
