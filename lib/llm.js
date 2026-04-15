// llm.js — unified LLM client with tool call loop

import * as openai from './providers/openai.js';
import * as anthropic from './providers/anthropic.js';

const SYSTEM_PROMPT = `You are PageTweaker, an assistant that modifies the visual appearance of web pages using CSS.

Your workflow:
1. When the user asks for a change, first call get_page_html to understand the page structure.
2. Write CSS to achieve the desired change and call inject_css with the complete CSS.
3. Call take_screenshot to verify your changes look correct.
4. Respond to the user with a summary of what you changed.

Important rules:
- Use !important on CSS properties to override site styles.
- Each inject_css call REPLACES all previously injected CSS. Include ALL desired styles every time.
- If a request requires JavaScript (toggling state, clicking buttons, modifying DOM attributes, adding event listeners), do NOT attempt it. Instead, explain what changes would be needed, why CSS alone cannot achieve it, and that JS injection support is not yet available.
- Keep CSS concise and targeted. Use specific selectors when possible.
- If you're unsure about the page structure, call get_page_html first.`;

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

    const response = await provider.chat(settings, fullMessages);

    if (response.type === 'text') {
      return { type: 'text', content: response.content };
    }

    // Handle tool calls
    const toolResults = [];
    let hasScreenshot = false;
    let screenshotCallId = null;
    let screenshotBase64 = null;

    for (const toolCall of response.toolCalls) {
      const result = await executeToolCall(toolCall.name, toolCall.arguments);

      if (toolCall.name === 'take_screenshot' && result.base64Image) {
        hasScreenshot = true;
        screenshotCallId = toolCall.id;
        screenshotBase64 = result.base64Image;
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
        response.raw, screenshotCallId, screenshotBase64, toolResults
      );
    } else {
      newMessages = provider.formatToolResults(response.raw, toolResults);
    }

    fullMessages.push(...newMessages);

    // Yield intermediate text content from Anthropic (it can include text + tool_use)
    if (response.textContent) {
      // Don't return yet — we need to process the tool calls
    }
  }

  return { type: 'text', content: 'Reached maximum tool call iterations. Please try a simpler request.' };
}
