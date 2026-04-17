// tools.js — tool definitions and provider format converters

export const TOOLS = [
  {
    name: 'inject_css',
    description: 'Modify injected CSS on the current page using structured actions. Use "add" to append a new CSS change, "remove" to delete an existing change by index, or "replace" to swap an existing change at a given index. Use get_injected_css first to see current state before removing or replacing.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'remove', 'replace'],
          description: 'The action to perform: "add" appends a new change, "remove" deletes the change at the given index, "replace" swaps the change at the given index.',
        },
        index: {
          type: ['integer', 'null'],
          description: 'The index of the change to target (required for remove and replace, null for add). Use get_injected_css to see current indices.',
        },
        description: {
          type: ['string', 'null'],
          description: 'A short human-readable description of what this CSS change does (required for add and replace, null for remove).',
        },
        css: {
          type: ['string', 'null'],
          description: 'The CSS rules to inject. Use !important on properties to override site styles (required for add and replace, null for remove).',
        },
      },
      required: ['action', 'index', 'description', 'css'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_injected_css',
    description: 'Get the current CSS injection state for the active tab. Returns all individual changes with their descriptions and indices, plus the combined CSS currently applied.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
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
      required: ['max_depth', 'root_selector'],
      additionalProperties: false,
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
      required: ['selector', 'limit'],
      additionalProperties: false,
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
      required: ['selector', 'include_children'],
      additionalProperties: false,
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
      required: ['query', 'regex', 'limit'],
      additionalProperties: false,
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
      required: ['query', 'attribute', 'regex', 'limit'],
      additionalProperties: false,
    },
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot of the currently visible tab. Use this to verify your CSS changes look correct.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'reply',
    description: 'Send a text reply to the user and end your turn. This is the ONLY way to end a conversation turn — you must call this tool when you are done. Do not produce plain text responses; always use this tool to communicate your final message.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The message to display to the user.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'status_update',
    description: 'Send a progress update to the user while continuing to work. The message is displayed immediately in the chat. Use this to keep the user informed during multi-step operations. Can be called alongside other tools in the same turn.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The status message to display to the user.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

// Convert tools to OpenAI function calling format (with strict structured output)
export function toOpenAITools() {
  return TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: true,
    },
  }));
}

// Convert tools to Anthropic tools format (with strict structured output)
export function toAnthropicTools() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
