#!/usr/bin/env node
/**
 * WebUI MCP Server
 *
 * Provides tools for Claude to interact with the WebUI, replacing built-in
 * tools that don't work well in a web context.
 *
 * Tools:
 * - ask_user: Ask the user questions via the WebUI (replaces AskUserQuestion)
 * - permission_prompt: Handle tool permissions via WebUI (replaces CLI prompts)
 * - confirm_plan: Request plan approval (works with ExitPlanMode hook)
 *
 * Environment variables:
 * - WEBUI_SESSION_ID: The session ID (required)
 * - WEBUI_BACKEND_URL: Backend URL (default: http://localhost:3006)
 * - WEBUI_PERMISSION_MODE: Permission mode (auto-accept, planning, danger)
 * - WEBUI_PROJECT_PATH: Project path for settings files
 *
 * This server implements the Model Context Protocol (MCP) to provide
 * WebUI-integrated tools that bypass Claude CLI limitations like timeouts
 * and terminal-based interactions.
 */

import * as readline from 'readline';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {URL} from 'url';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

// Settings file structure
interface ClaudeSettings {
    permissions?: {
        allow?: string[];
        deny?: string[];
    };
}

// Load settings from a JSON file
function loadSettings(filePath: string): ClaudeSettings | null {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as ClaudeSettings;
        }
    } catch (err) {
        log(`Failed to load settings from ${filePath}: ${err}`);
    }
    return null;
}

// Get all allowed patterns from global and project settings
function getAllowedPatterns(projectPath?: string): string[] {
    const patterns: string[] = [];

    // Load global settings (~/.claude/settings.json and ~/.claude/settings.local.json)
    const globalSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const globalSettings = loadSettings(globalSettingsPath);
    if (globalSettings?.permissions?.allow) {
        patterns.push(...globalSettings.permissions.allow);
        log(`Loaded ${globalSettings.permissions.allow.length} patterns from global settings`);
    }

    const globalLocalPath = path.join(os.homedir(), '.claude', 'settings.local.json');
    const globalLocalSettings = loadSettings(globalLocalPath);
    if (globalLocalSettings?.permissions?.allow) {
        patterns.push(...globalLocalSettings.permissions.allow);
        log(`Loaded ${globalLocalSettings.permissions.allow.length} patterns from global local settings`);
    }

    // Load project settings (<project>/.claude/settings.json and .claude/settings.local.json)
    if (projectPath) {
        const projectSettingsPath = path.join(projectPath, '.claude', 'settings.json');
        const projectSettings = loadSettings(projectSettingsPath);
        if (projectSettings?.permissions?.allow) {
            patterns.push(...projectSettings.permissions.allow);
            log(`Loaded ${projectSettings.permissions.allow.length} patterns from project settings`);
        }

        const projectLocalPath = path.join(projectPath, '.claude', 'settings.local.json');
        const projectLocalSettings = loadSettings(projectLocalPath);
        if (projectLocalSettings?.permissions?.allow) {
            patterns.push(...projectLocalSettings.permissions.allow);
            log(`Loaded ${projectLocalSettings.permissions.allow.length} patterns from project local settings`);
        }
    }

    return patterns;
}

// Tools that operate on files and should use glob patterns
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob'];

// Tools that use prefix matching with :*
const PREFIX_TOOLS = ['Bash'];

// Get the value to match against for a given tool
function getMatchValue(toolName: string, toolInput: unknown): string {
    if (!toolInput || typeof toolInput !== 'object') {
        return '';
    }

    const inputObj = toolInput as Record<string, unknown>;

    switch (toolName) {
        case 'Bash':
            return String(inputObj.command || '');
        case 'Read':
        case 'Write':
        case 'Edit':
        case 'Glob':
            return String(inputObj.file_path || inputObj.pattern || '');
        case 'Grep':
            return String(inputObj.pattern || '');
        case 'WebFetch':
            return String(inputObj.url || '');
        case 'WebSearch':
            return String(inputObj.query || '');
        default:
            return '';
    }
}

// Convert glob pattern to regex for file matching
function globToRegex(glob: string): RegExp {
    let regex = glob
        // Escape special regex chars except * and ?
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        // ** matches any path (including /)
        .replace(/\*\*/g, '.*')
        // * matches anything except /
        .replace(/(?<!\.)(\*)(?!\*)/g, '[^/]*')
        // ? matches single char
        .replace(/\?/g, '.');

    return new RegExp(`^${regex}$`);
}

// Check if a tool invocation matches a pattern
function matchesPattern(pattern: string, toolName: string, toolInput: unknown): boolean {
    // Parse pattern: Tool(content)
    const match = pattern.match(/^(\w+)\((.*)\)$/);
    if (!match) {
        // Simple pattern like "Bash" matches all Bash calls
        return pattern === toolName;
    }

    const [, patternTool, patternContent] = match;

    // Tool name must match
    if (patternTool !== toolName) {
        return false;
    }

    // Empty content matches everything for this tool
    if (!patternContent) {
        return true;
    }

    // Get the value to match against
    const matchValue = getMatchValue(toolName, toolInput);

    // For Bash and other prefix tools, use :* prefix matching
    if (PREFIX_TOOLS.includes(toolName) && patternContent.endsWith(':*')) {
        const prefix = patternContent.slice(0, -2);
        if (!prefix) {
            return true; // :* alone matches everything
        }
        return matchValue.startsWith(prefix);
    }

    // For file tools, use glob matching
    if (FILE_TOOLS.includes(toolName)) {
        // Check if it contains glob wildcards
        if (patternContent.includes('*') || patternContent.includes('?')) {
            const regex = globToRegex(patternContent);
            return regex.test(matchValue);
        }
        // Exact match fallback
        return matchValue === patternContent;
    }

    // Default: prefix matching with :*
    if (patternContent.endsWith(':*')) {
        const prefix = patternContent.slice(0, -2);
        if (!prefix) {
            return true;
        }
        return matchValue.startsWith(prefix);
    }

    // Exact match
    return matchValue === patternContent;
}

// Check if tool is auto-approved by any pattern
function isAutoApproved(toolName: string, toolInput: unknown, patterns: string[]): string | null {
    for (const pattern of patterns) {
        if (matchesPattern(pattern, toolName, toolInput)) {
            return pattern;
        }
    }
    return null;
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
                ...(options.body ? {'Content-Length': Buffer.byteLength(options.body)} : {}),
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

Returns JSON with one of:
- { behavior: "allow", updatedInput: <tool_input> } to approve
- { behavior: "deny", message: string } to reject`,
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
    {
        name: 'confirm_plan',
        description: `Request user approval for the implementation plan before exiting plan mode. This tool reads the most recent plan file and displays it to the user for approval.

Usage:
- Call this before attempting to use ExitPlanMode
- Once approved, ExitPlanMode will be allowed
- If rejected, you'll receive feedback to revise the plan`,
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'commit',
        description: `Create a git commit with user approval. Shows git status and allows the user to approve, deny, or choose to push.

Usage:
- Provide a commit message as input
- User will see git status, can approve/deny, and optionally push
- Returns result of commit operation`,
        inputSchema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The commit message',
                },
            },
            required: ['message'],
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

    // Check if this is an MCP tool (format: mcp__namespace__toolname)
    const isMcpTool = tool.startsWith('mcp__');

    // WebSearch doesn't support wildcards at all
    if (tool === 'WebSearch') {
        return tool;
    }

    if (!input || typeof input !== 'object') {
        if (isMcpTool) {
            // MCP tools use bare tool name without parentheses
            return tool;
        }
        if (FILE_TOOLS.includes(tool)) {
            return `${tool}(**)`;
        }
        return `${tool}(:*)`;
    }

    const inputObj = input as Record<string, unknown>;

    // For MCP tools, always return bare tool name
    if (isMcpTool) {
        return tool;
    }

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
        case 'WebSearch':
            // WebSearch uses domain: syntax for domain restrictions
            // Default to allowing all searches
            return tool;
        default:
            return `${tool}(:*)`;
    }
}

// Permission prompt response types (matching Claude Code's expected format)
// To allow: { behavior: "allow", updatedInput: <tool_input_object> }
// To deny: { behavior: "deny", message: string }
type PermissionPromptResult =
    | { behavior: 'allow'; updatedInput: Record<string, unknown> }
    | { behavior: 'deny'; message: string };

// Handle permission_prompt tool
async function handlePermissionPrompt(
    sessionId: string,
    backendUrl: string,
    input: PermissionInput
): Promise<PermissionPromptResult> {
    const requestId = crypto.randomUUID();

    // Log raw input for debugging
    log(`Raw permission input: ${JSON.stringify(input)}`);

    // Extract tool name from whichever field is provided
    const toolName = input.tool_name || input.toolName || 'Unknown';

    // Extract tool input from whichever field is provided
    const toolInput = input.tool_input || input.toolInput || input.input || {};

    log(`Handling permission_prompt for tool: ${toolName}`);
    log(`Tool input: ${JSON.stringify(toolInput)}`);

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
        return {behavior: 'deny', message: postResult.error || 'Backend error'};
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
        return {behavior: 'allow', updatedInput: toolInput};
    } else {
        log(`User denied permission: ${pollResult.error || 'denied'}`);
        return {behavior: 'deny', message: pollResult.error || 'User denied permission'};
    }
}

// Handle confirm_plan tool
async function handleConfirmPlan(
    sessionId: string,
    backendUrl: string
): Promise<{ approved: boolean; message?: string }> {
    const requestId = crypto.randomUUID();
    log(`Handling confirm_plan request`);

    // Read the most recent plan file
    let planContent: string | undefined;
    let planPath: string | undefined;

    try {
        const plansDir = '/home/nthalk/.claude/plans';
        const files = await fs.promises.readdir(plansDir);

        // Get all .md files with their stats
        const planFiles = await Promise.all(
            files
                .filter(f => f.endsWith('.md'))
                .map(async (file) => {
                    const filePath = path.join(plansDir, file);
                    const stats = await fs.promises.stat(filePath);
                    return { file, filePath, mtime: stats.mtime };
                })
        );

        // Sort by modification time (newest first)
        planFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        // Get the most recent plan
        if (planFiles.length > 0 && planFiles[0]) {
            planPath = planFiles[0].filePath;
            planContent = await fs.promises.readFile(planPath, 'utf-8');
            log(`Found plan at: ${planPath}`);
        } else {
            log('No plan files found');
            return {
                approved: false,
                message: 'No plan file found. Please create a plan before requesting approval.'
            };
        }
    } catch (err) {
        log(`Error reading plan files: ${err}`);
        return {
            approved: false,
            message: `Error reading plan files: ${err}`
        };
    }

    // POST the plan approval request to the backend
    const postResult = await makeRequest(`${backendUrl}/api/plan/request`, {
        method: 'POST',
        body: JSON.stringify({
            sessionId,
            requestId,
            planContent,
            planPath,
        }),
    }) as PermissionResponse;

    if (!postResult.success) {
        log(`Backend error: ${postResult.error}`);
        return {
            approved: false,
            message: postResult.error || 'Failed to request plan approval'
        };
    }

    // Long-poll for user response
    log(`Waiting for plan approval response...`);
    const pollResult = await makeRequest(
        `${backendUrl}/api/plan/response/${requestId}`,
        {
            method: 'GET',
            timeout: 300000, // 5 minutes - longer timeout for plan review
        }
    ) as { approved: boolean; reason?: string; error?: string };

    if (pollResult.approved) {
        log('User approved plan');
        // Store approval state in temp file so ExitPlanMode hook can check it
        // (hook runs in separate process, can't share process.env)
        const approvalFile = `/tmp/claude-plan-approved-${sessionId}`;
        try {
            await fs.promises.writeFile(approvalFile, Date.now().toString());
            log(`Wrote approval file: ${approvalFile}`);
        } catch (err) {
            log(`Failed to write approval file: ${err}`);
        }
        return { approved: true };
    } else {
        const message = pollResult.reason || pollResult.error || 'User denied plan. Please revise based on their feedback.';
        log(`User denied plan: ${message}`);
        return { approved: false, message };
    }
}

// Handle commit tool
async function handleCommit(
    sessionId: string,
    backendUrl: string,
    commitMessage: string
): Promise<{ success: boolean; message: string; pushed?: boolean }> {
    const requestId = crypto.randomUUID();
    log(`Handling commit request with message: ${commitMessage}`);

    // Get current git status
    let gitStatus: string;
    try {
        const { stdout } = await execAsync('git status --porcelain=v1', {
            cwd: process.env.WEBUI_PROJECT_PATH || process.cwd()
        });
        gitStatus = stdout;

        if (!gitStatus.trim()) {
            return {
                success: false,
                message: 'No changes to commit. Working directory is clean.'
            };
        }
    } catch (err) {
        log(`Error getting git status: ${err}`);
        return {
            success: false,
            message: `Failed to get git status: ${err instanceof Error ? err.message : String(err)}`
        };
    }

    // POST the commit request to the backend
    const postResult = await makeRequest(`${backendUrl}/api/commit/request`, {
        method: 'POST',
        body: JSON.stringify({
            sessionId,
            requestId,
            commitMessage,
            gitStatus,
        }),
    });

    if (!postResult.success) {
        log(`Backend error: ${postResult.error}`);
        return {
            success: false,
            message: postResult.error || 'Failed to request commit approval'
        };
    }

    // Long-poll for user response
    log(`Waiting for commit approval response...`);
    const pollResult = await makeRequest(
        `${backendUrl}/api/commit/response/${requestId}`,
        {
            method: 'GET',
            timeout: 120000, // 2 minutes
        }
    ) as { approved: boolean; push?: boolean; reason?: string; error?: string };

    if (!pollResult.approved) {
        const message = pollResult.reason || pollResult.error || 'User denied commit';
        log(`User denied commit: ${message}`);
        return { success: false, message };
    }

    log('User approved commit');

    // Execute the commit
    try {
        const cwd = process.env.WEBUI_PROJECT_PATH || process.cwd();
        await execAsync(`git add -A`, { cwd });
        await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd });
        log('Commit successful');

        // Push if requested
        if (pollResult.push) {
            log('User requested push, pushing to remote...');
            try {
                await execAsync('git push', { cwd });
                log('Push successful');
                return {
                    success: true,
                    message: 'Commit created and pushed successfully',
                    pushed: true
                };
            } catch (err) {
                log(`Push failed: ${err}`);
                return {
                    success: true,
                    message: `Commit created successfully but push failed: ${err instanceof Error ? err.message : String(err)}`,
                    pushed: false
                };
            }
        }

        return {
            success: true,
            message: 'Commit created successfully',
            pushed: false
        };
    } catch (err) {
        log(`Commit failed: ${err}`);
        return {
            success: false,
            message: `Failed to create commit: ${err instanceof Error ? err.message : String(err)}`
        };
    }
}

// MCP Server class
class WebUIMcpServer {
    private sessionId: string;
    private backendUrl: string;
    private permissionMode: string;
    private projectPath: string;
    private rl: readline.Interface;

    constructor() {
        this.sessionId = process.env.WEBUI_SESSION_ID || '';
        this.backendUrl = process.env.WEBUI_BACKEND_URL || 'http://localhost:3006';
        this.permissionMode = process.env.WEBUI_PERMISSION_MODE || 'auto-accept';
        this.projectPath = process.env.WEBUI_PROJECT_PATH || process.cwd();

        if (!this.sessionId) {
            log('WARNING: No WEBUI_SESSION_ID set, ask_user tool will not work');
        }

        log(`Starting WebUI MCP Server - session: ${this.sessionId}, backend: ${this.backendUrl}, mode: ${this.permissionMode}, project: ${this.projectPath}`);

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
        const {id, method, params} = request;

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
        const {name, arguments: args} = params;
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
                                text: JSON.stringify({answers}, null, 2),
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
                                text: JSON.stringify({behavior: 'deny', message: 'No session ID configured'}),
                            },
                        ],
                    },
                };
            }

            try {
                const input = args as unknown as PermissionInput;
                const toolName = input.tool_name || input.toolName || 'Unknown';
                const toolInput = input.tool_input || input.toolInput || input.input || {};

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
                                    text: JSON.stringify({behavior: 'allow', updatedInput: toolInput}),
                                },
                            ],
                        },
                    };
                }

                // In planning mode, always prompt user regardless of patterns
                if (this.permissionMode === 'planning') {
                    log(`Planning mode: always prompting for ${toolName}`);
                    // Skip pattern checking and go straight to user prompt
                } else {
                    // Check for auto-approval against settings files
                    const allowedPatterns = getAllowedPatterns(this.projectPath);
                    log(`Loaded ${allowedPatterns.length} allowed patterns for auto-approval check`);

                    const matchedPattern = isAutoApproved(toolName, toolInput, allowedPatterns);
                    if (matchedPattern) {
                        log(`Auto-approved ${toolName} by pattern: ${matchedPattern}`);
                        return {
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({behavior: 'allow', updatedInput: toolInput}),
                                    },
                                ],
                            },
                        };
                    }
                }

                log(`No matching pattern for ${toolName}, prompting user`);
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
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                log(`Permission prompt error: ${errorMessage}`);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify({behavior: 'deny', message: errorMessage}),
                            },
                        ],
                    },
                };
            }
        }

        if (name === 'confirm_plan') {
            if (!this.sessionId) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: 'Error: WEBUI_SESSION_ID not set. Cannot request plan approval.',
                            },
                        ],
                        isError: true,
                    },
                };
            }

            try {
                const result = await handleConfirmPlan(this.sessionId, this.backendUrl);

                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: result.approved
                                    ? 'Plan approved! You can now use ExitPlanMode to proceed with implementation.'
                                    : result.message || 'Plan denied. Please revise based on feedback.',
                            },
                        ],
                    },
                };
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: `Error: ${errorMessage}`,
                            },
                        ],
                        isError: true,
                    },
                };
            }
        }

        if (name === 'commit') {
            if (!this.sessionId) {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: 'Error: WEBUI_SESSION_ID not set. Cannot request commit approval.',
                            },
                        ],
                        isError: true,
                    },
                };
            }

            try {
                const input = args as unknown as { message: string };
                const result = await handleCommit(this.sessionId, this.backendUrl, input.message);

                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: result.message,
                            },
                        ],
                        isError: !result.success,
                    },
                };
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: `Error: ${errorMessage}`,
                            },
                        ],
                        isError: true,
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
