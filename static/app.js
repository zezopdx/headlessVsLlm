'use strict';

// ── Prepared demo prompts ────────────────────────────────────────────────────
const DEMO_PROMPTS = [
  {
    group: 'Opening (sets the scene)',
    prompts: [
      'Give me a quick overview of Julie Morris — her accounts, recent transactions, and any open cases or opportunities.',
    ],
  },
  {
    group: 'Follow-ups (show conversation memory)',
    prompts: [
      'What campaigns is she currently enrolled in?',
      'Based on her transaction history, are there any cross-sell opportunities I should bring up in our next conversation?',
      'Does she have any affiliations with other accounts?',
    ],
  },
  {
    group: 'Power prompt (one question, many queries)',
    prompts: [
      'Help me prepare for a call with Julie. What do I need to know?',
    ],
  },
  {
    group: 'Extra angles',
    prompts: [
      'Are there any risk or fraud signals in Julie\u2019s recent activity I should be aware of?',
      'Summarize Julie\u2019s open service cases and tell me which are most urgent.',
      'What is Julie\u2019s total relationship value across all products?',
      'Give me that same overview of Julie again.',
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  messages: [],
  session: { turns: 0, inputTokens: 0, outputTokens: 0 },
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const messagesEl    = document.getElementById('messages');
const promptInput   = document.getElementById('prompt-input');
const sendBtn       = document.getElementById('send-btn');
const clearBtn      = document.getElementById('clear-btn');
const priceInputEl  = document.getElementById('price-input');
const priceOutputEl = document.getElementById('price-output');

const activityEl       = document.getElementById('activity');
const activityToggle   = document.getElementById('activity-toggle');
const activityBody     = document.getElementById('activity-body');
const activityStatusEl = document.getElementById('activity-status');

// ── Helpers ────────────────────────────────────────────────────────────────
function calcCost(inputTokens, outputTokens) {
  const pIn  = parseFloat(priceInputEl.value)  || 0;
  const pOut = parseFloat(priceOutputEl.value) || 0;
  return (inputTokens / 1000) * pIn + (outputTokens / 1000) * pOut;
}

const fmt = n => (typeof n === 'number' ? n.toLocaleString() : n);

// ── Metrics ────────────────────────────────────────────────────────────────
function updateMetrics(lastTurn) {
  const { turns, inputTokens, outputTokens } = state.session;
  document.getElementById('total-turns').textContent        = turns;
  document.getElementById('total-input-tokens').textContent  = fmt(inputTokens);
  document.getElementById('total-output-tokens').textContent = fmt(outputTokens);
  document.getElementById('total-cost').textContent =
    `$${calcCost(inputTokens, outputTokens).toFixed(4)}`;

  if (lastTurn) {
    document.getElementById('last-latency').textContent       = `${fmt(lastTurn.latency_ms)} ms`;
    document.getElementById('last-input-tokens').textContent  = fmt(lastTurn.input_tokens);
    document.getElementById('last-output-tokens').textContent = fmt(lastTurn.output_tokens);
    document.getElementById('last-sf-queries').textContent    = lastTurn.snowflake_queries;
  }
}

// ── Messages ─────────────────────────────────────────────────────────────────
function renderMessages() {
  if (state.messages.length === 0) {
    messagesEl.innerHTML =
      '<div class="empty-state">Ask a question about a customer to get started.</div>';
    return;
  }
  messagesEl.innerHTML = '';
  for (const msg of state.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (msg.role === 'user') {
      bubble.textContent = msg.content;
    } else {
      bubble.innerHTML = typeof marked !== 'undefined'
        ? marked.parse(msg.content)
        : msg.content.replace(/\n/g, '<br>');
    }
    div.appendChild(bubble);
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Activity box ──────────────────────────────────────────────────────────────
function setActivityRunning(running, statusText) {
  activityEl.classList.toggle('running', running);
  if (statusText !== undefined) activityStatusEl.textContent = statusText;
  if (running) activityEl.classList.remove('collapsed');
}

function clearActivity() {
  activityBody.innerHTML =
    '<div class="activity-empty">Step-by-step activity will appear here while the agent works.</div>';
  activityStatusEl.textContent = 'idle';
  activityEl.classList.remove('running');
}

function addActivityLine(kind, tag, body) {
  const empty = activityBody.querySelector('.activity-empty');
  if (empty) empty.remove();
  const line = document.createElement('div');
  line.className = `activity-line ${kind}`;
  const tagEl = document.createElement('span');
  tagEl.className = 'tag';
  tagEl.textContent = tag;
  const bodyEl = document.createElement('span');
  bodyEl.className = 'body';
  bodyEl.textContent = body;
  line.appendChild(tagEl);
  line.appendChild(bodyEl);
  activityBody.appendChild(line);
  activityBody.scrollTop = activityBody.scrollHeight;
}

function handleEvent(event) {
  switch (event.type) {
    case 'status':
      addActivityLine('status', 'MCP', event.message);
      setActivityRunning(true, 'working…');
      break;
    case 'thought':
      addActivityLine('thought', 'think', event.message);
      break;
    case 'query':
      addActivityLine('query', `SQL #${event.n}`,
        event.sql.replace(/\s+/g, ' ').trim());
      setActivityRunning(true, `query #${event.n}…`);
      break;
    case 'query_result':
      addActivityLine(event.ok ? 'ok' : 'err',
        event.ok ? `✓ #${event.n}` : `✗ #${event.n}`,
        event.ok ? 'rows returned' : `error — ${event.preview}`);
      break;
    case 'final':
      state.messages.push({ role: 'assistant', content: event.response });
      state.session.turns        += 1;
      state.session.inputTokens  += event.input_tokens;
      state.session.outputTokens += event.output_tokens;
      renderMessages();
      updateMetrics(event);
      addActivityLine('status', 'done',
        `${event.snowflake_queries} queries · ${fmt(event.input_tokens)} in / ${fmt(event.output_tokens)} out · ${fmt(event.latency_ms)} ms`);
      setActivityRunning(false, `done · ${event.snowflake_queries} queries`);
      break;
    case 'error':
      state.messages.push({ role: 'assistant', content: `**Error:** ${event.message}` });
      renderMessages();
      addActivityLine('err', 'error', event.message);
      setActivityRunning(false, 'error');
      break;
  }
}

// ── Send (streaming) ──────────────────────────────────────────────────────────
async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || sendBtn.disabled) return;

  promptInput.value = '';
  sendBtn.disabled = true;

  state.messages.push({ role: 'user', content: prompt });
  renderMessages();

  // reset + open the activity box for this turn
  activityBody.innerHTML = '';
  setActivityRunning(true, 'connecting…');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: state.messages,
        system_prompt: systemPromptText.value,  // session-only edited copy
      }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) handleEvent(JSON.parse(line));
      }
    }
    if (buffer.trim()) handleEvent(JSON.parse(buffer.trim()));

  } catch (err) {
    handleEvent({ type: 'error', message: err.message });
    console.error('chat error:', err);
  } finally {
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

// ── Clear ──────────────────────────────────────────────────────────────────
function clearChat() {
  state.messages = [];
  state.session  = { turns: 0, inputTokens: 0, outputTokens: 0 };
  renderMessages();
  updateMetrics(null);
  ['last-latency', 'last-input-tokens', 'last-output-tokens', 'last-sf-queries']
    .forEach(id => { document.getElementById(id).textContent = '—'; });
  clearActivity();
}

// ── Tabs ───────────────────────────────────────────────────────────────────
const TABS = ['metrics', 'prompts', 'system'];

function switchTab(which) {
  for (const tab of TABS) {
    const active = tab === which;
    document.getElementById(`tab-${tab}`).classList.toggle('hidden', !active);
    document.getElementById(`tab-btn-${tab}`).classList.toggle('active', active);
  }
}

// ── Prepared prompts ──────────────────────────────────────────────────────────
function renderPrompts() {
  const list = document.getElementById('prompts-list');
  list.innerHTML = '';

  for (const group of DEMO_PROMPTS) {
    const label = document.createElement('div');
    label.className = 'prompt-group-label';
    label.textContent = group.group;
    list.appendChild(label);

    for (const text of group.prompts) {
      const card = document.createElement('div');
      card.className = 'prompt-card';

      const textEl = document.createElement('div');
      textEl.className = 'prompt-card-text';
      textEl.textContent = text;
      textEl.title = 'Click to load into the input';
      textEl.addEventListener('click', () => {
        promptInput.value = text;
        promptInput.focus();
      });

      const actions = document.createElement('div');
      actions.className = 'prompt-card-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'prompt-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        copyBtn.textContent = 'Copied';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('copied');
        }, 1200);
      });

      const useBtn = document.createElement('button');
      useBtn.className = 'prompt-btn';
      useBtn.textContent = 'Use';
      useBtn.addEventListener('click', () => {
        promptInput.value = text;
        switchTab('metrics');
        promptInput.focus();
      });

      actions.appendChild(copyBtn);
      actions.appendChild(useBtn);
      card.appendChild(textEl);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }
}

// ── Events ─────────────────────────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);
clearBtn.addEventListener('click', clearChat);

promptInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

priceInputEl.addEventListener('input',  () => updateMetrics(null));
priceOutputEl.addEventListener('input', () => updateMetrics(null));

activityToggle.addEventListener('click', () => activityEl.classList.toggle('collapsed'));
document.getElementById('tab-btn-metrics').addEventListener('click', () => switchTab('metrics'));
document.getElementById('tab-btn-prompts').addEventListener('click', () => switchTab('prompts'));
document.getElementById('tab-btn-system').addEventListener('click', () => switchTab('system'));

// ── System prompt (session-only; default lives on disk) ───────────────────────
const systemPromptText   = document.getElementById('system-prompt-text');
const systemPromptStatus = document.getElementById('system-prompt-status');
const systemPromptReset  = document.getElementById('system-prompt-reset');

function setSystemStatus(text, cls) {
  systemPromptStatus.textContent = text;
  systemPromptStatus.className = `system-prompt-status${cls ? ' ' + cls : ''}`;
}

// fetch the on-disk default into the editor (also used by "Reset to default")
async function loadSystemPrompt(announce) {
  setSystemStatus('loading…');
  try {
    const res = await fetch('/api/system-prompt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    systemPromptText.value = data.prompt;
    if (announce) {
      setSystemStatus('reset to default', 'saved');
      setTimeout(() => setSystemStatus(''), 2000);
    } else {
      setSystemStatus('');
    }
  } catch (err) {
    setSystemStatus(`load failed: ${err.message}`, 'error');
  }
}

// edits are session-only — flag when the editor diverges from the default
systemPromptText.addEventListener('input', () => setSystemStatus('edited · applies next turn'));

systemPromptReset.addEventListener('click', () => loadSystemPrompt(true));

// ── Init ───────────────────────────────────────────────────────────────────
renderPrompts();
updateMetrics(null);
loadSystemPrompt();
