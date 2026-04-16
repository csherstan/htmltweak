// openai.js — OpenAI-compatible provider (OpenAI, OpenRouter, Ollama)

import { toOpenAITools } from '../tools.js';

export async function chat(settings, messages) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (settings.apiKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
  }

  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = chrome.runtime.getURL('/');
    headers['X-Title'] = 'PageTweaker';
  }

  const body = {
    model: settings.model,
    messages: messages,
    tools: toOpenAITools(),
  };

  console.log(`[PageTweaker:OpenAI] Request to ${settings.baseUrl}/chat/completions`);
  console.log('[PageTweaker:OpenAI] Request body (messages summary):', JSON.stringify(messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 120) + (m.content.length > 120 ? '...' : '') : m.content,
    tool_calls: m.tool_calls ? m.tool_calls.map(tc => ({ id: tc.id, name: tc.function?.name })) : undefined,
    tool_call_id: m.tool_call_id,
  })), null, 2));

  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${settings.provider} API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const choice = data.choices[0];
  const message = choice.message;

  console.log('[PageTweaker:OpenAI] Response finish_reason:', choice.finish_reason);
  console.log('[PageTweaker:OpenAI] Response message:', JSON.stringify({
    role: message.role,
    content: message.content?.slice(0, 300),
    tool_calls: message.tool_calls?.map(tc => ({ id: tc.id, name: tc.function?.name })),
  }));

  // Extract tool calls if present
  if (message.tool_calls && message.tool_calls.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      raw: message,
    };
  }

  // Edge case: finish_reason says tool_calls but message.tool_calls is absent/empty.
  // Some models set finish_reason='tool_calls' without providing the array.
  // Treat as a stall — return empty tool_calls so the caller can detect and recover.
  if (choice.finish_reason === 'tool_calls') {
    console.warn('[PageTweaker:OpenAI] finish_reason=tool_calls but no tool_calls in message — returning empty tool_calls to prevent misclassification as text');
    return {
      type: 'tool_calls',
      toolCalls: [],
      raw: message,
    };
  }

  return {
    type: 'text',
    content: message.content || '',
    raw: message,
  };
}

// Format tool results for the next API call
export function formatToolResults(assistantMessage, toolResults) {
  // Sanitize the assistant message: when tool_calls are present, content must
  // be null per the OpenAI spec. Some models return thinking text alongside
  // tool_calls (e.g. "Let me look at the page structure"), which confuses
  // certain endpoints on the follow-up call — the model sees the non-null
  // content and responds with text instead of making the next tool call.
  const sanitized = { ...assistantMessage };
  if (sanitized.tool_calls && sanitized.tool_calls.length > 0) {
    if (sanitized.content) {
      console.log('[PageTweaker:OpenAI] Stripping assistant content from tool_calls message:', sanitized.content.slice(0, 200));
    }
    sanitized.content = null;
  }
  const messages = [sanitized];
  for (const result of toolResults) {
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
    messages.push({
      role: 'tool',
      tool_call_id: result.id,
      content: content,
    });
  }
  return messages;
}

// Format a screenshot result for OpenAI (image_url in a user message)
export function formatScreenshotResult(toolCallId, base64Image, mediaType = 'image/png') {
  return {
    id: toolCallId,
    content: [
      {
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${base64Image}` },
      },
    ],
  };
}

// For OpenAI, screenshot goes as a tool result with text, then a separate user message with the image
export function formatScreenshotMessages(assistantRaw, toolCallId, base64Image, otherResults, mediaType = 'image/png') {
  // Sanitize: strip content when tool_calls present (same as formatToolResults)
  const sanitized = { ...assistantRaw };
  if (sanitized.tool_calls && sanitized.tool_calls.length > 0) {
    sanitized.content = null;
  }
  const messages = [sanitized];

  // Add all tool results (screenshot as text placeholder)
  for (const result of otherResults) {
    messages.push({
      role: 'tool',
      tool_call_id: result.id,
      content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    });
  }

  // Screenshot tool result
  messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: 'Screenshot captured. See the image below.',
  });

  // Image as user message
  messages.push({
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: { url: `data:${mediaType};base64,${base64Image}` },
      },
    ],
  });

  return messages;
}
