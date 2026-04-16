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
- inject_css: Inject CSS on the page. CSS accumulates across calls — only send NEW styles each time.
- take_screenshot: Capture the visible tab to verify changes.

Workflow:
1. Call get_page_structure to understand the page layout.
2. Use query_selector, search_page_text, or search_page_attributes to find the elements the user wants to change.
3. Call get_element_details on specific elements to understand their current styles and structure.
4. Write CSS and call inject_css with only the NEW CSS for this change.
5. Call take_screenshot to verify your changes look correct.
6. Respond to the user with a summary of what you changed.

Important rules:
- Use !important on CSS properties to override site styles.
- Each inject_css call ADDS to previously injected CSS. Only send the new styles for the current change — prior styles are preserved automatically.
- To start over or undo all changes, call inject_css with replace=true.
- If a later change needs to override an earlier one, just write a more specific selector or re-declare the property — CSS cascade rules apply.
- If a request requires JavaScript (toggling state, clicking buttons, modifying DOM attributes, adding event listeners), do NOT attempt it. Instead, explain what changes would be needed, why CSS alone cannot achieve it, and that JS injection support is not yet available.
- Keep CSS concise and targeted. Use specific selectors when possible.
- Navigate the DOM progressively: start broad (get_page_structure), then narrow down (query_selector/search), then inspect (get_element_details). Avoid calling multiple tools when one will do.`;

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
  let lastIterationTools = [];

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    console.log(`[PageTweaker] Iteration ${iterations} — sending ${fullMessages.length} messages to ${settings.provider}/${settings.model}`);
    console.log(`[PageTweaker] Iteration ${iterations} — previous tools: [${lastIterationTools.join(', ')}]`);
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
      console.log('[PageTweaker] Text response:', response.content?.slice(0, 300));
    }

    if (response.type === 'text') {
      if (lastIterationTools.includes('take_screenshot')) {
        console.warn(`[PageTweaker] ⚠ Model returned text after screenshot iteration — possible stall. Text: ${response.content?.slice(0, 300)}`);
      }
      return { type: 'text', content: response.content };
    }

    // Handle tool calls
    if (response.toolCalls.length === 0) {
      // finish_reason=tool_calls but no actual tool calls — model glitch.
      // Return whatever text content exists rather than looping endlessly.
      console.warn('[PageTweaker] Empty tool_calls array — breaking loop');
      return { type: 'text', content: response.raw.content || 'The model returned an empty response. Please try again.' };
    }

    const toolResults = [];
    let hasScreenshot = false;
    let screenshotCallId = null;
    let screenshotBase64 = null;
    let screenshotMediaType = 'image/png';

    for (const toolCall of response.toolCalls) {
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
    lastIterationTools = response.toolCalls.map(tc => tc.name);

    // Yield intermediate text content from Anthropic (it can include text + tool_use)
    if (response.textContent) {
      // Don't return yet — we need to process the tool calls
    }
  }

  return { type: 'text', content: 'Reached maximum tool call iterations. Please try a simpler request.' };
}
