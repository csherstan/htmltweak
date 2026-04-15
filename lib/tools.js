// tools.js — tool definitions and provider format converters

export const TOOLS = [
  {
    name: 'inject_css',
    description: 'Inject or replace CSS on the current page. The CSS you provide will completely replace any previously injected CSS. Include ALL desired styles each time you call this tool.',
    parameters: {
      type: 'object',
      properties: {
        css: {
          type: 'string',
          description: 'The complete CSS to inject into the page. Use !important on properties to override site styles.',
        },
      },
      required: ['css'],
    },
  },
  {
    name: 'get_page_html',
    description: 'Get the current page HTML (truncated, scripts/styles stripped). Call this first to understand the page structure before making CSS changes.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot of the currently visible tab. Use this to verify your CSS changes look correct.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

// Convert tools to OpenAI function calling format
export function toOpenAITools() {
  return TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// Convert tools to Anthropic tools format
export function toAnthropicTools() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
