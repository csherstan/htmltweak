#!/usr/bin/env node
// repro-tool-loop.js — standalone repro for the tool loop stall bug (ht-8g7)
//
// Reproduces the issue where the model calls get_page_structure, receives the
// result, but then responds with text instead of proceeding to inject_css.
//
// Usage:
//   node debug/repro-tool-loop.js --base-url http://localhost:11434/v1 --model llama3.2-vision
//   node debug/repro-tool-loop.js --base-url https://api.openai.com/v1 --model gpt-4o --api-key sk-...
//
// This script does NOT require the Chrome extension — it calls the API directly
// and uses a mock tool result for get_page_structure.

const SYSTEM_PROMPT = `You are PageTweaker, an assistant that modifies the visual appearance of web pages using CSS.

Your tools for understanding the page:
- get_page_structure: Get a compact DOM tree overview. Call this first to understand the page layout.
- query_selector: Find elements by CSS selector.
- get_element_details: Get full details for a specific element.

Your tools for making changes:
- inject_css: Inject or replace CSS on the page.

Workflow:
1. Call get_page_structure to understand the page layout.
2. Use query_selector or get_element_details to find elements.
3. Write CSS and call inject_css with the complete CSS.

Important rules:
- Use !important on CSS properties to override site styles.
- Each inject_css call REPLACES all previously injected CSS.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'inject_css',
      description: 'Inject or replace CSS on the current page.',
      parameters: {
        type: 'object',
        properties: {
          css: { type: 'string', description: 'The complete CSS to inject.' },
        },
        required: ['css'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_structure',
      description: 'Get a compact structural overview of the page DOM.',
      parameters: {
        type: 'object',
        properties: {
          max_depth: { type: 'integer', description: 'Maximum depth (default: 6).' },
          root_selector: { type: 'string', description: 'CSS selector for root element.' },
        },
      },
    },
  },
];

// Mock tool results
const MOCK_PAGE_STRUCTURE = JSON.stringify({
  tag: 'body',
  children: [
    { tag: 'header', id: 'top-header', classes: ['site-header'], children: [
      { tag: 'nav', classes: ['main-nav'] },
    ]},
    { tag: 'main', id: 'content', children: [
      { tag: 'h1', text: 'Welcome' },
      { tag: 'div', classes: ['content-body'], children: [
        { tag: 'p' }, { tag: 'p' }, { tag: 'p' },
      ]},
    ]},
    { tag: 'footer', classes: ['site-footer'] },
  ],
}, null, 2);

async function callAPI(baseUrl, apiKey, model, messages) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const body = { model, messages, tools: TOOLS };

  console.log('\n--- REQUEST ---');
  console.log('Messages:');
  for (const m of messages) {
    const preview = typeof m.content === 'string'
      ? m.content.slice(0, 120) + (m.content.length > 120 ? '...' : '')
      : JSON.stringify(m.content).slice(0, 120);
    console.log(`  [${m.role}] ${m.tool_call_id ? `(tool_call_id: ${m.tool_call_id}) ` : ''}${m.tool_calls ? `(tool_calls: ${m.tool_calls.map(tc => tc.function.name)}) ` : ''}${preview}`);
  }

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const choice = data.choices[0];

  console.log('\n--- RESPONSE ---');
  console.log('finish_reason:', choice.finish_reason);
  console.log('message.content:', JSON.stringify(choice.message.content));
  console.log('message.tool_calls:', JSON.stringify(choice.message.tool_calls?.map(tc => ({
    id: tc.id, name: tc.function.name, args: tc.function.arguments,
  }))));

  return choice;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const baseUrl = getArg('--base-url') || 'http://localhost:11434/v1';
  const model = getArg('--model') || 'llama3.2-vision';
  const apiKey = getArg('--api-key') || '';

  console.log(`=== Tool Loop Repro (ht-8g7) ===`);
  console.log(`Endpoint: ${baseUrl}`);
  console.log(`Model: ${model}`);
  console.log(`API Key: ${apiKey ? '***' : '(none)'}`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: 'Set the background color to blue.' },
  ];

  // --- Iteration 1: expect get_page_structure call ---
  console.log('\n====== ITERATION 1 ======');
  const choice1 = await callAPI(baseUrl, apiKey, model, messages);
  const msg1 = choice1.message;

  if (!msg1.tool_calls || msg1.tool_calls.length === 0) {
    console.log('\n[BUG?] Model did not call any tool on first turn. Content:', msg1.content);
    process.exit(1);
  }

  const toolCall = msg1.tool_calls[0];
  console.log(`\nModel called: ${toolCall.function.name}`);

  if (toolCall.function.name !== 'get_page_structure') {
    console.log(`[INFO] Expected get_page_structure, got ${toolCall.function.name}`);
  }

  // Add assistant message to history (the raw message with tool_calls)
  // FIX: strip content when tool_calls present — this is the bug fix in openai.js
  const sanitizedMsg1 = { ...msg1 };
  if (sanitizedMsg1.tool_calls && sanitizedMsg1.content) {
    console.log(`\n[FIX] Stripping assistant content: "${sanitizedMsg1.content.slice(0, 100)}"`);
    console.log('[FIX] This text alongside tool_calls confuses some models on follow-up calls.');
    sanitizedMsg1.content = null;
  }
  messages.push(sanitizedMsg1);

  // Add tool result
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: MOCK_PAGE_STRUCTURE,
  });

  // --- Iteration 2: expect inject_css call ---
  console.log('\n====== ITERATION 2 ======');
  const choice2 = await callAPI(baseUrl, apiKey, model, messages);
  const msg2 = choice2.message;

  if (!msg2.tool_calls || msg2.tool_calls.length === 0) {
    console.log('\n=== BUG REPRODUCED ===');
    console.log('Model responded with text instead of calling inject_css.');
    console.log('Text:', msg2.content);
    console.log('\nThis confirms the tool loop stall: the model sees the page');
    console.log('structure but does not proceed to inject CSS.');

    // Diagnostic: dump the full message array for inspection
    console.log('\n--- Full message history (for debugging) ---');
    console.log(JSON.stringify(messages, null, 2));
    process.exit(0);
  }

  const toolCall2 = msg2.tool_calls[0];
  console.log(`\nModel called: ${toolCall2.function.name}`);

  if (toolCall2.function.name === 'inject_css') {
    console.log('\n=== NO BUG ===');
    console.log('Model correctly proceeded to inject_css.');
    console.log('CSS:', toolCall2.function.arguments);
  } else {
    console.log(`[INFO] Expected inject_css, got ${toolCall2.function.name}`);
    console.log('The model called a different tool — may need more iterations.');
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
