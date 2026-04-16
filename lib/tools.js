// tools.js — tool definitions and provider format converters

export const TOOLS = [
  {
    name: 'inject_css',
    description: 'Inject CSS on the current page. By default, CSS accumulates: each call adds new styles on top of previously injected CSS. Set replace=true to wipe all prior styles and start fresh.',
    parameters: {
      type: 'object',
      properties: {
        css: {
          type: 'string',
          description: 'The CSS to inject into the page. Use !important on properties to override site styles.',
        },
        replace: {
          type: 'boolean',
          description: 'If true, replace all previously injected CSS instead of accumulating. Use when the user asks to start over or undo all changes. Default: false.',
        },
      },
      required: ['css'],
    },
  },
  {
    name: 'get_page_structure',
    description: 'Get a compact structural overview of the page DOM. Returns a tree of elements with their tag names, IDs, class names, and roles — without text content or attributes. Use this first to understand the page layout before drilling into specific elements.',
    parameters: {
      type: 'object',
      properties: {
        max_depth: {
          type: 'integer',
          description: 'Maximum depth to traverse (default: 6). Increase for deeply nested pages.',
        },
        root_selector: {
          type: 'string',
          description: 'CSS selector for the root element to start from (default: "body"). Use to focus on a specific region.',
        },
      },
    },
  },
  {
    name: 'query_selector',
    description: 'Run a CSS selector query on the page and return matching elements with their tag, id, classes, and text preview. Use this to find specific elements by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to query (e.g. ".nav-item", "#header", "article > h2").',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 20).',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_element_details',
    description: 'Get detailed information about a specific element: all attributes, computed styles (for key CSS properties), dimensions, text content, and inner HTML preview. Use this to understand an element before writing CSS for it.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector that uniquely identifies the element. If multiple match, the first is used.',
        },
        include_children: {
          type: 'boolean',
          description: 'Whether to include a summary of direct children (default: true).',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'search_page_text',
    description: 'Search visible text content on the page. Returns elements whose text content matches the query. Supports regex patterns.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or regex pattern to search for in element text content.',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat query as a regex pattern (default: false).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 20).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_page_attributes',
    description: 'Search element attributes on the page. Finds elements with attributes matching the query by name, value, or both. Supports regex patterns. Useful for finding elements by data attributes, aria labels, href patterns, etc.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or regex pattern to match against attribute names and/or values.',
        },
        attribute: {
          type: 'string',
          description: 'Limit search to a specific attribute name (e.g. "data-testid", "href", "aria-label"). If omitted, searches all attributes.',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat query as a regex pattern (default: false).',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 20).',
        },
      },
      required: ['query'],
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
