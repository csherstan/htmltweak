// anthropic.js — Anthropic Claude provider

import { toAnthropicTools } from '../tools.js';

export async function chat(settings, messages) {
  // Anthropic uses a different message format: system is separate
  const systemMessage = messages.find(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  // Convert messages to Anthropic format
  const anthropicMessages = convertMessages(nonSystemMessages);

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };

  const body = {
    model: settings.model,
    max_tokens: 4096,
    messages: anthropicMessages,
    tools: toAnthropicTools(),
  };

  if (systemMessage) {
    body.system = systemMessage.content;
  }

  console.log(`[PageTweaker:Anthropic] Request to ${settings.baseUrl}/messages model=${settings.model}`);
  console.log('[PageTweaker:Anthropic] Request messages:', JSON.stringify(anthropicMessages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 120) + (m.content.length > 120 ? '...' : '') : (Array.isArray(m.content) ? `[${m.content.length} blocks: ${m.content.map(b => b.type).join(', ')}]` : typeof m.content),
  })), null, 2));

  const response = await fetch(`${settings.baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const data = await response.json();

  // Check for tool use in content blocks
  const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
  const textBlocks = data.content.filter(b => b.type === 'text');

  console.log(`[PageTweaker:Anthropic] Response stop_reason=${data.stop_reason} blocks=${data.content.length} (${toolUseBlocks.length} tool_use, ${textBlocks.length} text)`);
  if (toolUseBlocks.length > 0) {
    console.log('[PageTweaker:Anthropic] Tool calls:', toolUseBlocks.map(b => `${b.name}(${JSON.stringify(b.input).slice(0, 100)})`));
  }
  if (textBlocks.length > 0) {
    console.log('[PageTweaker:Anthropic] Text:', textBlocks.map(b => b.text.slice(0, 200)).join(' | '));
  }

  if (toolUseBlocks.length > 0) {
    return {
      type: 'tool_calls',
      toolCalls: toolUseBlocks.map(b => ({
        id: b.id,
        name: b.name,
        arguments: b.input,
      })),
      textContent: textBlocks.map(b => b.text).join('\n'),
      raw: data.content,
    };
  }

  return {
    type: 'text',
    content: textBlocks.map(b => b.text).join('\n'),
    raw: data.content,
  };
}

function convertMessages(messages) {
  const result = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      // Already in Anthropic format (content blocks)
      result.push({ role: 'assistant', content: msg.content });
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      // Convert from OpenAI-style assistant with tool_calls
      // (shouldn't happen but handle gracefully)
      const content = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      result.push({ role: 'assistant', content });
    } else if (msg.role === 'tool') {
      // Convert tool result to Anthropic format
      // Anthropic uses role: 'user' with tool_result content blocks
      const lastResult = result[result.length - 1];
      const toolContent = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      };

      if (lastResult && lastResult.role === 'user' && Array.isArray(lastResult.content) &&
          lastResult.content.every(c => c.type === 'tool_result' || c.type === 'image')) {
        lastResult.content.push(toolContent);
      } else {
        result.push({ role: 'user', content: [toolContent] });
      }
    } else if (msg.role === 'user' && Array.isArray(msg.content) &&
               msg.content[0]?.type === 'image_url') {
      // Screenshot image — merge into the last user message if it has tool_results
      const lastResult = result[result.length - 1];
      const dataUrl = msg.content[0].image_url.url;
      const match = dataUrl.match(/^data:(image\/[^;]+);base64,/);
      const detectedType = match ? match[1] : 'image/png';
      const imageBlock = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectedType,
          data: dataUrl.replace(/^data:image\/[^;]+;base64,/, ''),
        },
      };
      if (lastResult && lastResult.role === 'user' && Array.isArray(lastResult.content)) {
        lastResult.content.push(imageBlock);
      } else {
        result.push({ role: 'user', content: [imageBlock] });
      }
    } else {
      result.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  return result;
}

// Strip text blocks from assistant content when tool_use blocks are present.
// Mirrors the OpenAI provider's sanitization (content=null when tool_calls exist).
function stripTextFromToolUseContent(content) {
  if (!Array.isArray(content)) return content;
  const hasToolUse = content.some(b => b.type === 'tool_use');
  if (!hasToolUse) return content;
  const textBlocks = content.filter(b => b.type === 'text');
  if (textBlocks.length > 0) {
    console.log('[PageTweaker:Anthropic] Stripping text blocks from tool_use assistant message:', textBlocks.map(b => b.text.slice(0, 200)).join(' | '));
  }
  return content.filter(b => b.type !== 'text');
}

// Format tool results for Anthropic
export function formatToolResults(assistantContent, toolResults) {
  // Strip text blocks when tool_use blocks are present. The model sometimes
  // emits intent text ("I'll align it to the top-left") alongside tool_use
  // blocks. If that text stays in the conversation history, the model sees
  // itself as having "already described" the fix and responds with more text
  // instead of making the next tool call.
  const sanitized = stripTextFromToolUseContent(assistantContent);
  const messages = [
    { role: 'assistant', content: sanitized },
  ];

  const userContent = [];
  for (const result of toolResults) {
    userContent.push({
      type: 'tool_result',
      tool_use_id: result.id,
      content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    });
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

export function formatScreenshotMessages(assistantContent, toolCallId, base64Image, otherResults, mediaType = 'image/png') {
  const sanitized = stripTextFromToolUseContent(assistantContent);
  const messages = [
    { role: 'assistant', content: sanitized },
  ];

  const userContent = [];

  for (const result of otherResults) {
    userContent.push({
      type: 'tool_result',
      tool_use_id: result.id,
      content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    });
  }

  // Screenshot tool result
  userContent.push({
    type: 'tool_result',
    tool_use_id: toolCallId,
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Image,
        },
      },
    ],
  });

  messages.push({ role: 'user', content: userContent });
  return messages;
}
