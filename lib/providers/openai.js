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

  return {
    type: 'text',
    content: message.content || '',
    raw: message,
  };
}

// Format tool results for the next API call
export function formatToolResults(assistantMessage, toolResults) {
  const messages = [assistantMessage];
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
export function formatScreenshotResult(toolCallId, base64Image) {
  return {
    id: toolCallId,
    content: [
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${base64Image}` },
      },
    ],
  };
}

// For OpenAI, screenshot goes as a tool result with text, then a separate user message with the image
export function formatScreenshotMessages(assistantRaw, toolCallId, base64Image, otherResults) {
  const messages = [assistantRaw];

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
        image_url: { url: `data:image/png;base64,${base64Image}` },
      },
    ],
  });

  return messages;
}
