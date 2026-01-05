#!/usr/bin/env node
/**
 * WebUI MCP Server
 *
 * Provides tools for Claude to interact with the WebUI, replacing built-in
 * tools that don't work well in a web context.
 *
 * Tools:
 * - ask_user: Ask the user questions via the WebUI (replaces AskUserQuestion)
 *
 * Environment variables:
 * - WEBUI_SESSION_ID: The session ID (required)
 * - WEBUI_BACKEND_URL: Backend URL (default: http://localhost:3006)
 */

import * as readline from 'readline';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as crypto from 'crypto';

// MCP Protocol types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

// Question types (matching AskUserQuestion)
interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface AskUserInput {
  questions: Question[];
}

interface BackendResponse {
  success: boolean;
  requestId?: string;
  answers?: Record<string, string | string[]>;
  approved?: boolean;
  error?: string;
}

// Permission request input (from --permission-prompt-tool)
// Claude may use different field names, so we accept multiple variants
interface PermissionInput {
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface PermissionResponse {
  success: boolean;
  requestId?: string;
  approved?: boolean;
  pattern?: string;
  error?: string;
}

// Logging to stderr (doesn't interfere with MCP protocol on stdout)
function log(message: string): void {
  process.stderr.write(`[WEBUI-MCP] ${message}\n`);
}

// HTTP request helper
function makeRequest(
  url: string,
  options: {
    method: 'GET' | 'POST';
    body?: string;
    timeout?: number;
  }
): Promise<BackendResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}),
      },
      timeout: options.timeout || 130000,
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as BackendResponse;
          resolve(parsed);
        } catch {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'ask_user',
    description: `Ask the user questions via the WebUI interface. Use this when you need to gather user preferences, clarify requirements, get decisions on implementation choices, or offer choices about what direction to take.

Usage notes:
- Users can select from predefined options or provide custom text input
- Use multiSelect: true to allow multiple answers for a question
- Each question should have 2-4 options
- Keep headers short (max 12 chars)`,
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions to ask the user (1-4 questions)',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The complete question to ask the user',
              },
              header: {
                type: 'string',
                description: 'Very short label displayed as a chip/tag (max 12 chars)',
              },
              options: {
                type: 'array',
                description: 'Available choices (2-4 options)',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Display text for this option (1-5 words)',
                    },
                    description: {
                      type: 'string',
                      description: 'Explanation of what this option means',
                    },
                  },
                  required: ['label'],
                },
              },
              multiSelect: {
                type: 'boolean',
                description: 'Allow multiple selections',
              },
            },
            required: ['question', 'header', 'options', 'multiSelect'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'permission_prompt',
    description: `Request permission from the user to execute a tool. This is called by Claude Code when it needs user approval to run a tool.

Returns JSON with:
- behavior: "allow" to approve, "deny" to reject
- updatedInput: optionally modified tool input`,
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The name of the tool requesting permission',
        },
        tool_input: {
          type: 'object',
          description: 'The input parameters for the tool',
        },
      },
      required: ['tool_name', 'tool_input'],
    },
  },
];

// Handle ask_user tool
async function handleAskUser(
  sessionId: string,
  backendUrl: string,
  input: AskUserInput
): Promise<Record<string, string | string[]>> {
  const requestId = crypto.randomUUID();
  log(`Handling ask_user with ${input.questions.length} questions`);

  // POST the question request to the backend
  const postResult = await makeRequest(`${backendUrl}/api/user-questions/request`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      requestId,
      toolUseId: requestId, // Use same ID since we're handling it directly
      questions: input.questions,
    }),
  });

  if (!postResult.success) {
    throw new Error(postResult.error || 'Backend error');
  }

  // Long-poll for user response
  log(`Waiting for user response...`);
  const pollResult = await makeRequest(
    `${backendUrl}/api/user-questions/response/${requestId}`,
    {
      method: 'GET',
      timeout: 120000, // 2 minutes
    }
  );

  if (pollResult.success && pollResult.answers) {
    log('User answered questions');
    return pollResult.answers;
  } else {
    throw new Error(pollResult.error || 'User did not answer questions');
  }
}

// Format a description of the permission request
function formatDescription(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return `${tool} tool`;
  }

  const inputObj = input as Record<string, unknown>;

  switch (tool) {
    case 'Bash':
      return `Run command: ${String(inputObj.command || '').substring(0, 100)}`;
    case 'Read':
      return `Read file: ${inputObj.file_path}`;
    case 'Write':
      return `Write file: ${inputObj.file_path}`;
    case 'Edit':
      return `Edit file: ${inputObj.file_path}`;
    case 'Glob':
      return `Search files: ${inputObj.pattern}`;
    case 'Grep':
      return `Search content: ${inputObj.pattern}`;
    case 'WebFetch':
      return `Fetch URL: ${inputObj.url}`;
    case 'WebSearch':
      return `Web search: ${inputObj.query}`;
    default:
      return `${tool} tool`;
  }
}

// Generate a suggested pattern for the permission
function generateSuggestedPattern(tool: string, input: unknown): string {
  const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob'];

  if (!input || typeof input !== 'object') {
    if (FILE_TOOLS.includes(tool)) {
      return `${tool}(**)`;
    }
    return `${tool}(:*)`;
  }

  const inputObj = input as Record<string, unknown>;

  switch (tool) {
    case 'Bash': {
      const command = String(inputObj.command || '');
      const parts = command.split(/\s+/);
      if (parts.length >= 2) {
        return `Bash(${parts[0]} ${parts[1]}:*)`;
      }
      return `Bash(${parts[0]}:*)`;
    }
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = String(inputObj.file_path || '');
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = filePath.substring(0, lastSlash + 1);
        return `${tool}(${dir}**)`;
      }
      return `${tool}(**)`;
    }
    case 'Glob': {
      const pattern = String(inputObj.pattern || '');
      if (pattern.includes('/')) {
        const lastSlash = pattern.lastIndexOf('/');
        const dir = pattern.substring(0, lastSlash + 1);
        return `Glob(${dir}**)`;
      }
      return `Glob(**)`;
    }
    default:
      return `${tool}(:*)`;
  }
}

// Handle permission_prompt tool
async function handlePermissionPrompt(
  sessionId: string,
  backendUrl: string,
  input: PermissionInput
): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown> }> {
  const requestId = crypto.randomUUID();

  // Extract tool name from whichever field is provided
  const toolName = input.tool_name || input.toolName || 'Unknown';

  // Extract tool input from whichever field is provided
  const toolInput = input.tool_input || input.toolInput || input.input || {};

  log(`Handling permission_prompt for tool: ${toolName}`);

  // POST the permission request to the backend
  const postResult = await makeRequest(`${backendUrl}/api/permissions/request`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      requestId,
      toolName,
      toolInput,
      description: formatDescription(toolName, toolInput),
      suggestedPattern: generateSuggestedPattern(toolName, toolInput),
    }),
  }) as PermissionResponse;

  if (!postResult.success) {
    log(`Backend error: ${postResult.error}`);
    return { behavior: 'deny' };
  }

  // Long-poll for user response
  log(`Waiting for user response...`);
  const pollResult = await makeRequest(
    `${backendUrl}/api/permissions/response/${requestId}`,
    {
      method: 'GET',
      timeout: 120000, // 2 minutes
    }
  ) as PermissionResponse;

  if (pollResult.approved) {
    log('User approved permission');
    return { behavior: 'allow' };
  } else {
    log(`User denied permission: ${pollResult.error || 'denied'}`);
    return { behavior: 'deny' };
  }
}

// MCP Server class
class WebUIMcpServer {
  private sessionId: string;
  private backendUrl: string;
  private permissionMode: string;
  private rl: readline.Interface;

  constructor() {
    this.sessionId = process.env.WEBUI_SESSION_ID || '';
    this.backendUrl = process.env.WEBUI_BACKEND_URL || 'http://localhost:3006';
    this.permissionMode = process.env.WEBUI_PERMISSION_MODE || 'auto-accept';

    if (!this.sessionId) {
      log('WARNING: No WEBUI_SESSION_ID set, ask_user tool will not work');
    }

    log(`Starting WebUI MCP Server - session: ${this.sessionId}, backend: ${this.backendUrl}, mode: ${this.permissionMode}`);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => {
      log('stdin closed, exiting');
      process.exit(0);
    });
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;

    try {
      const request: JsonRpcRequest = JSON.parse(line);
      log(`Received: ${request.method}`);

      const response = await this.handleRequest(request);
      this.sendResponse(response);
    } catch (err) {
      log(`Error parsing request: ${err}`);
      // Send error response
      this.sendResponse({
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'webui',
                version: '1.0.0',
              },
            },
          };

        case 'notifications/initialized':
          // Client notification, no response needed but we return empty for protocol
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools,
            },
          };

        case 'tools/call':
          return await this.handleToolCall(id, params as ToolCallParams);

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log(`Error handling ${method}: ${message}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message,
        },
      };
    }
  }

  private async handleToolCall(
    id: string | number,
    params: ToolCallParams
  ): Promise<JsonRpcResponse> {
    const { name, arguments: args } = params;
    log(`Tool call: ${name}`);

    if (name === 'ask_user') {
      if (!this.sessionId) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Error: WEBUI_SESSION_ID not set. Cannot ask user questions.',
              },
            ],
            isError: true,
          },
        };
      }

      try {
        const input = args as unknown as AskUserInput;
        const answers = await handleAskUser(this.sessionId, this.backendUrl, input);

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ answers }, null, 2),
              },
            ],
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error: ${message}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    if (name === 'permission_prompt') {
      if (!this.sessionId) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ behavior: 'deny' }),
              },
            ],
          },
        };
      }

      try {
        const input = args as unknown as PermissionInput;
        const toolName = input.tool_name || input.toolName || 'Unknown';

        // In danger mode, auto-approve all permissions
        if (this.permissionMode === 'danger') {
          log(`Danger mode: auto-approving ${toolName}`);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ behavior: 'allow' }),
                },
              ],
            },
          };
        }

        const result = await handlePermissionPrompt(this.sessionId, this.backendUrl, input);

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log(`Permission prompt error: ${message}`);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ behavior: 'deny' }),
              },
            ],
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32602,
        message: `Unknown tool: ${name}`,
      },
    };
  }

  private sendResponse(response: JsonRpcResponse): void {
    const json = JSON.stringify(response);
    log(`Sending: ${json.substring(0, 200)}...`);
    console.log(json);
  }
}

// Start the server
new WebUIMcpServer();
