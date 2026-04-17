// llm.js — unified LLM client with tool call loop

import * as openai from './providers/openai.js';
import * as anthropic from './providers/anthropic.js';

const SYSTEM_PROMPT = `You are PageTweaker, an assistant that modifies the visual appearance of web pages using CSS.

Your tools for understanding the page:
- get_page_structure: Get a compact DOM tree overview. Call this first to understand the page layout.
- query_selector: Find elements by CSS selector. Use after get_page_structure to locate specific elements.
- get_element_details: Get full details (attributes, computed styles, dimensions) for a specific element. Use to inspect an element before writing CSS.
- search_page_text: Search for elements by their text content. Supports regex.
- search_page_attributes: Search for elements by attribute names/values (data attributes, aria labels, hrefs, etc.). Supports regex.

Your tools for making changes:
- inject_css: Modify CSS on the page using structured actions (add, remove, replace). Each change has a description and CSS rules.
- get_injected_css: View the current CSS state — all changes with descriptions and indices, plus combined CSS.
- take_screenshot: Capture the visible tab to verify changes.

Your communication tools:
- reply — send a final text response to the user and end your turn. This is the ONLY way to finish a conversation turn. You MUST call reply when done.
- status_update — send a progress message to the user (displayed immediately) while continuing to work. Can be called alongside other tools.

Workflow:
1. Call get_page_structure to understand the page layout.
2. Use query_selector, search_page_text, or search_page_attributes to find the elements the user wants to change.
3. Call get_element_details on specific elements to understand their current styles and structure.
4. Call inject_css with action "add", a description, and the CSS rules.
5. Call take_screenshot to verify your changes look correct.
6. Call reply with a summary of what you changed.

CRITICAL: You MUST ONLY communicate by calling tools. NEVER produce a plain text response — always use the reply tool to send your final message. If you respond with plain text instead of calling reply, it will be treated as an error and you will be asked to try again.

Important rules:
- Use !important on CSS properties to override site styles.
- inject_css uses structured actions: "add" appends a new change, "remove" deletes by index, "replace" swaps by index.
- Use get_injected_css to see what's currently applied before removing or replacing changes.
- To undo a specific change, use "remove" with its index. To modify a change, use "replace" with its index.
- If a later change needs to override an earlier one, just write a more specific selector or re-declare the property — CSS cascade rules apply.
- If a request requires JavaScript (toggling state, clicking buttons, modifying DOM attributes, adding event listeners), do NOT attempt it. Instead, explain what changes would be needed, why CSS alone cannot achieve it, and that JS injection support is not yet available.
- Keep CSS concise and targeted. Use specific selectors when possible.
- Navigate the DOM progressively: start broad (get_page_structure), then narrow down (query_selector/search), then inspect (get_element_details). Avoid calling multiple tools when one will do.
- When the user requests multiple changes in one message, complete ALL of them before responding with text. Do not stop after the first change to describe what you will do next — instead, immediately proceed with tool calls for the remaining changes. Only respond with a text summary after every requested change has been applied.
- CRITICAL: NEVER describe CSS changes in text without calling inject_css. If you know what CSS to write, call inject_css immediately — do not show the CSS in your response and wait. Your job is to EXECUTE changes, not describe them. The user wants to see changes on the page, not read CSS in chat.
- CRITICAL: NEVER respond with plain text. You MUST always call the reply tool to communicate. Plain text responses are rejected.`;

const MAX_ITERATIONS = 10;

function getProvider(settings) {
  if (settings.provider === 'anthropic') {
    return anthropic;
  }
  return openai; // ollama, openai, openrouter all use OpenAI-compatible format
}

export async function runConversation(settings, messages, executeToolCall) {
  const provider = getProvider(settings);
  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    console.log(`[PageTweaker] Iteration ${iterations} — sending ${fullMessages.length} messages to ${settings.provider}/${settings.model}`);
    console.log('[PageTweaker] Messages:', JSON.stringify(fullMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 200) : (Array.isArray(m.content) ? `[${m.content.length} blocks]` : m.content),
      tool_calls: m.tool_calls?.map(tc => tc.function?.name || tc.name),
      tool_call_id: m.tool_call_id,
    })), null, 2));

    const response = await provider.chat(settings, fullMessages);

    console.log(`[PageTweaker] Response type: ${response.type}`);
    if (response.type === 'tool_calls') {
      console.log('[PageTweaker] Tool calls:', response.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`));
    }
    if (response.type === 'text') {
      console.log('[PageTweaker] Text response (rejected):', response.content?.slice(0, 300));
    }

    // Tool-only loop: plain text responses are rejected and re-prompted
    if (response.type === 'text') {
      console.warn(`[PageTweaker] ⚠ Model returned plain text — re-prompting to use reply tool. Text: ${(response.content || '').slice(0, 300)}`);
      fullMessages.push(
        { role: 'assistant', content: response.content },
        { role: 'user', content: 'You must use tools to communicate. Call the reply tool with your message instead of responding with plain text.' },
      );
      continue;
    }

    // Handle tool calls
    if (response.toolCalls.length === 0) {
      // finish_reason=tool_calls but no actual tool calls — model glitch.
      const stallText = response.raw.content || '';
      console.warn(`[PageTweaker] Empty tool_calls array — re-prompting model. Text: ${stallText.slice(0, 300)}`);
      if (stallText) {
        fullMessages.push({ role: 'assistant', content: stallText });
      }
      fullMessages.push({
        role: 'user',
        content: 'You indicated you would use tools but did not call any. Please proceed by calling the appropriate tool now.',
      });
      continue;
    }

    // Check for reply tool — terminates the loop
    const replyCall = response.toolCalls.find(tc => tc.name === 'reply');

    // Execute all non-reply, non-status_update tool calls
    const toolResults = [];
    let hasScreenshot = false;
    let screenshotCallId = null;
    let screenshotBase64 = null;
    let screenshotMediaType = 'image/png';
    let statusUpdates = [];

    for (const toolCall of response.toolCalls) {
      if (toolCall.name === 'reply') {
        // reply is handled after loop — just provide a confirmation result
        toolResults.push({ id: toolCall.id, content: 'Reply delivered.' });
        continue;
      }

      if (toolCall.name === 'status_update') {
        statusUpdates.push(toolCall.arguments.text);
        // Execute to notify sidepanel
        await executeToolCall('status_update', toolCall.arguments);
        toolResults.push({ id: toolCall.id, content: 'Status update sent.' });
        continue;
      }

      console.log(`[PageTweaker] Executing tool: ${toolCall.name}`);
      const result = await executeToolCall(toolCall.name, toolCall.arguments);
      console.log(`[PageTweaker] Tool result for ${toolCall.name}: ${JSON.stringify(result).slice(0, 200)}`);

      if (toolCall.name === 'take_screenshot' && result.base64Image) {
        hasScreenshot = true;
        screenshotCallId = toolCall.id;
        screenshotBase64 = result.base64Image;
        screenshotMediaType = result.mediaType || 'image/png';
      } else {
        toolResults.push({
          id: toolCall.id,
          content: result.content || result,
        });
      }
    }

    // If reply tool was called, return its text
    if (replyCall) {
      return { type: 'text', content: replyCall.arguments.text };
    }

    // Build follow-up messages with tool results
    let newMessages;
    if (hasScreenshot) {
      newMessages = provider.formatScreenshotMessages(
        response.raw, screenshotCallId, screenshotBase64, toolResults, screenshotMediaType
      );
    } else {
      newMessages = provider.formatToolResults(response.raw, toolResults);
    }

    console.log('[PageTweaker] Appending messages:', JSON.stringify(newMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 200) : (Array.isArray(m.content) ? `[${m.content.length} blocks]` : typeof m.content),
      tool_calls: m.tool_calls?.map(tc => tc.function?.name || tc.name),
      tool_call_id: m.tool_call_id,
    })), null, 2));

    fullMessages.push(...newMessages);

    // Yield intermediate text content from Anthropic (it can include text + tool_use)
    if (response.textContent) {
      // Don't return yet — we need to process the tool calls
    }
  }

  // Max iterations exhausted without a reply — auto-generate fallback
  return { type: 'text', content: 'I reached the maximum number of steps for this request. Here\'s where I got to: I was still working through your request when the iteration limit was hit. Please try again or simplify your request.' };
}
