import {useCallback, useState} from 'react';
import {
    Bug,
    Check,
    CheckCircle2,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Copy,
    Cpu,
    Edit3,
    FileText,
    FolderSearch,
    GitBranch,
    Globe,
    HelpCircle,
    Loader2,
    Search,
    Terminal,
    Wrench,
    XCircle,
} from 'lucide-react';
import type {
    BashToolInput,
    EditToolInput,
    GlobToolInput,
    GrepToolInput,
    ReadToolInput,
    TaskToolInput,
    ToolExecution,
    WebSearchToolInput
} from '@claude-code-webui/shared';
import {EditToolDiff} from '../EditToolDiff';
import {BashToolRenderer} from '../BashToolRenderer';
import {GrepToolRenderer} from '../GrepToolRenderer';
import {GlobToolRenderer} from '../GlobToolRenderer';
import {WebSearchToolRenderer} from '../WebSearchToolRenderer';
import {ReadToolRenderer} from '../ReadToolRenderer';
import {PlanRenderer} from '../PlanRenderer';
import {ExploreRenderer} from '../ExploreRenderer';
import {AskUserQuestionRenderer} from '../AskUserQuestionRenderer';
import {stripWorkingDirectory} from '@/lib/utils';

interface ToolExecutionCardProps {
    execution: ToolExecution;
    workingDirectory?: string;
}


// Map tool names to icons and labels
const getToolDisplay = (toolName: string): { icon: typeof Wrench; label: string; inputLabel: string } => {
    const toolMap: Record<string, { icon: typeof Wrench; label: string; inputLabel: string }> = {
        'Write': {icon: FileText, label: 'Write', inputLabel: 'File'},
        'Read': {icon: Search, label: 'Read', inputLabel: 'File'},
        'Edit': {icon: Edit3, label: 'Edit', inputLabel: 'File'},
        'Bash': {icon: Terminal, label: 'Bash', inputLabel: 'Command'},
        'WebFetch': {icon: Globe, label: 'Fetch', inputLabel: 'URL'},
        'WebSearch': {icon: Globe, label: 'Search', inputLabel: 'Query'},
        'Glob': {icon: FolderSearch, label: 'Glob', inputLabel: 'Pattern'},
        'Grep': {icon: Search, label: 'Grep', inputLabel: 'Pattern'},
        'LS': {icon: FolderSearch, label: 'List', inputLabel: 'Path'},
        'Task': {icon: Cpu, label: 'Agent', inputLabel: 'Task'},
        'TodoWrite': {icon: CheckSquare, label: 'Todo', inputLabel: 'Tasks'},
        'Git': {icon: GitBranch, label: 'Git', inputLabel: 'Command'},
        'AskUserQuestion': {icon: HelpCircle, label: 'Ask User', inputLabel: 'Questions'},
    };

    return toolMap[toolName] || {icon: Wrench, label: toolName, inputLabel: 'Input'};
};

// Extract description and command/detail for two-line preview
const getInputPreviewTwoLine = (toolName: string, input: unknown, workingDirectory?: string): {
    description: string;
    detail: string
} => {
    if (!input) return {description: '', detail: ''};
    if (typeof input === 'string') return {description: '', detail: input};

    const inputObj = input as Record<string, unknown>;

    switch (toolName) {
        case 'Bash':
            return {
                description: String(inputObj.description || ''),
                detail: String(inputObj.command || ''),
            };
        case 'Read':
        case 'Write':
            return {
                description: '',
                detail: stripWorkingDirectory(String(inputObj.file_path || ''), workingDirectory),
            };
        case 'Edit':
            return {
                description: '',
                detail: stripWorkingDirectory(String(inputObj.file_path || ''), workingDirectory),
            };
        case 'Glob':
            return {
                description: '',
                detail: String(inputObj.pattern || ''),
            };
        case 'Grep':
            return {
                description: '',
                detail: String(inputObj.pattern || ''),
            };
        case 'WebFetch':
            return {
                description: String(inputObj.prompt || ''),
                detail: String(inputObj.url || ''),
            };
        case 'WebSearch':
            return {
                description: '',
                detail: String(inputObj.query || ''),
            };
        case 'Task':
            return {
                description: String(inputObj.description || ''),
                detail: String(inputObj.subagent_type || ''),
            };
        case 'AskUserQuestion': {
            const questions = inputObj.questions as Array<{ question: string }> || [];
            const count = questions.length;
            const firstQ = questions[0]?.question || '';
            return {
                description: `${count} question${count !== 1 ? 's' : ''}`,
                detail: firstQ.length > 50 ? firstQ.substring(0, 50) + '...' : firstQ,
            };
        }
        default:
            return {description: '', detail: JSON.stringify(input).substring(0, 100)};
    }
};

// Format full input for expanded view
const formatInput = (toolName: string, input: unknown): { label: string; value: string }[] => {
    if (!input) return [];
    if (typeof input === 'string') return [{label: 'Input', value: input}];

    const inputObj = input as Record<string, unknown>;
    const result: { label: string; value: string }[] = [];

    switch (toolName) {
        case 'Bash':
            if (inputObj.command) result.push({label: 'Command', value: String(inputObj.command)});
            if (inputObj.description) result.push({label: 'Description', value: String(inputObj.description)});
            if (inputObj.timeout) result.push({label: 'Timeout', value: `${inputObj.timeout}ms`});
            break;
        case 'Read':
            if (inputObj.file_path) result.push({label: 'File', value: String(inputObj.file_path)});
            if (inputObj.offset) result.push({label: 'Offset', value: String(inputObj.offset)});
            if (inputObj.limit) result.push({label: 'Limit', value: String(inputObj.limit)});
            break;
        case 'Write':
            if (inputObj.file_path) result.push({label: 'File', value: String(inputObj.file_path)});
            if (inputObj.content) result.push({
                label: 'Content',
                value: String(inputObj.content).substring(0, 500) + (String(inputObj.content).length > 500 ? '...' : '')
            });
            break;
        case 'Edit':
            if (inputObj.file_path) result.push({label: 'File', value: String(inputObj.file_path)});
            if (inputObj.old_string) result.push({label: 'Find', value: String(inputObj.old_string)});
            if (inputObj.new_string) result.push({label: 'Replace', value: String(inputObj.new_string)});
            break;
        case 'Glob':
            if (inputObj.pattern) result.push({label: 'Pattern', value: String(inputObj.pattern)});
            if (inputObj.path) result.push({label: 'Path', value: String(inputObj.path)});
            break;
        case 'Grep':
            if (inputObj.pattern) result.push({label: 'Pattern', value: String(inputObj.pattern)});
            if (inputObj.path) result.push({label: 'Path', value: String(inputObj.path)});
            if (inputObj.glob) result.push({label: 'Glob', value: String(inputObj.glob)});
            break;
        case 'WebFetch':
            if (inputObj.url) result.push({label: 'URL', value: String(inputObj.url)});
            if (inputObj.prompt) result.push({label: 'Prompt', value: String(inputObj.prompt)});
            break;
        case 'WebSearch':
            if (inputObj.query) result.push({label: 'Query', value: String(inputObj.query)});
            break;
        case 'Task':
            if (inputObj.description) result.push({label: 'Description', value: String(inputObj.description)});
            if (inputObj.prompt) result.push({label: 'Prompt', value: String(inputObj.prompt)});
            if (inputObj.subagent_type) result.push({label: 'Agent Type', value: String(inputObj.subagent_type)});
            break;
        default:
            result.push({label: 'Input', value: JSON.stringify(input, null, 2)});
    }

    return result;
};

// Copy button component
const CopyButton = ({text}: { text: string }) => {
    const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

    const handleCopy = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(text);
            setStatus('copied');
            setTimeout(() => setStatus('idle'), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    }, [text]);

    const title = status === 'error'
        ? 'Copy requires HTTPS or localhost'
        : status === 'copied'
            ? 'Copied!'
            : 'Copy to clipboard';

    return (
        <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-muted transition-colors"
            title={title}
        >
            {status === 'copied' ? (
                <Check className="h-3 w-3 text-green-500"/>
            ) : status === 'error' ? (
                <XCircle className="h-3 w-3 text-red-400"/>
            ) : (
                <Copy className="h-3 w-3 text-zinc-500 hover:text-zinc-300"/>
            )}
        </button>
    );
};

// Status icon component
const StatusIcon = ({status}: { status: 'started' | 'completed' | 'error' }) => {
    switch (status) {
        case 'started':
            return <Loader2 className="h-4 w-4 text-blue-500 animate-spin"/>;
        case 'completed':
            return <CheckCircle2 className="h-4 w-4 text-green-500"/>;
        case 'error':
            return <XCircle className="h-4 w-4 text-red-500"/>;
    }
};

// Helper to ensure input is properly parsed
const parseInput = (input: unknown): unknown => {
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        } catch {
            return input;
        }
    }
    return input;
};

export function ToolExecutionCard({execution, workingDirectory}: ToolExecutionCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const {icon: Icon, label} = getToolDisplay(execution.toolName);

    // Parse input if it's a JSON string
    const parsedInput = parseInput(execution.input);

    const hasInput = parsedInput;
    const hasOutput = execution.result || execution.error;
    const isExpandable = hasInput || hasOutput;
    const isClickable = isExpandable; // Allow expansion even when started

    // Get two-line preview (description + detail)
    const {description, detail} = getInputPreviewTwoLine(execution.toolName, parsedInput, workingDirectory);
    const formattedInput = formatInput(execution.toolName, parsedInput);

    return (
        <div
            className="flex flex-col p-2 md:p-3 bg-black text-xs border border-zinc-800 overflow-hidden w-full">
            {/* Header row - tool icon, label, and status */}
            <div
                className={`flex items-center gap-2 ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`}
                onClick={() => isClickable && setExpanded(!expanded)}
            >
                <Icon className="h-4 w-4 text-zinc-400 flex-shrink-0"/>
                <span className="font-medium text-white">{label}</span>
                {description && (
                    <span className="text-zinc-400 truncate flex-1 text-xs">
                        {description}
                    </span>
                )}
                {/* Spacer when no description */}
                {!description && <span className="flex-1"/>}
                {/* Debug toggle button - only show when expanded and has result */}
                {expanded && execution.result && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowDebug(!showDebug);
                        }}
                        className={`p-0.5 rounded transition-colors ${
                            showDebug ? 'text-amber-400 bg-amber-400/10' : 'text-zinc-400 hover:text-zinc-300'
                        }`}
                        title={showDebug ? 'Hide raw JSON' : 'Show raw JSON'}
                    >
                        <Bug className="h-3 w-3" />
                    </button>
                )}
                {isExpandable && (
                    <>
                        {expanded ? (
                            <ChevronDown className="h-3 w-3 text-zinc-400 flex-shrink-0"/>
                        ) : (
                            <ChevronRight className="h-3 w-3 text-zinc-400 flex-shrink-0"/>
                        )}
                    </>
                )}
                <StatusIcon status={execution.status}/>
            </div>
            {/* Detail line - command/path/pattern */}
            {detail && (
                <div className="mt-1">
                    <code
                        className="text-zinc-400 truncate font-mono text-xs block overflow-hidden text-ellipsis whitespace-nowrap">
                        {detail}
                    </code>
                </div>
            )}

            {/* Expanded content */}
            {expanded && (
                <div className="mt-2 space-y-2">
                    {/* Show raw JSON when debug mode is enabled */}
                    {showDebug && execution.result ? (
                        <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                                <span className="text-amber-400 text-[10px] uppercase tracking-wide">Raw JSON Output</span>
                                <CopyButton text={execution.result}/>
                            </div>
                            <pre className="p-2 bg-zinc-900 border border-amber-400/20 rounded text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all text-amber-200/90 font-mono">
                                {(() => {
                                    try {
                                        const parsed = JSON.parse(execution.result);
                                        return JSON.stringify(parsed, null, 2);
                                    } catch {
                                        return execution.result;
                                    }
                                })()}
                            </pre>
                        </div>
                    ) : (
                    <>
                    {/* Special renderers for specific tools */}
                    {execution.toolName === 'Edit' && parsedInput && typeof parsedInput === 'object' ? (
                        <EditToolDiff
                            oldString={String((parsedInput as EditToolInput).old_string || '')}
                            newString={String((parsedInput as EditToolInput).new_string || '')}
                            filePath={String((parsedInput as EditToolInput).file_path || '')}
                            workingDirectory={workingDirectory}
                        />
                    ) : execution.toolName === 'Bash' && parsedInput && typeof parsedInput === 'object' ? (
                        <BashToolRenderer
                            input={parsedInput as BashToolInput}
                            result={execution.result}
                            error={execution.error}
                        />
                    ) : execution.toolName === 'Grep' && parsedInput && typeof parsedInput === 'object' ? (
                        <GrepToolRenderer
                            input={parsedInput as GrepToolInput}
                            result={execution.result}
                            error={execution.error}
                            workingDirectory={workingDirectory}
                        />
                    ) : execution.toolName === 'Glob' && parsedInput && typeof parsedInput === 'object' ? (
                        <GlobToolRenderer
                            input={parsedInput as GlobToolInput}
                            result={execution.result}
                            error={execution.error}
                            workingDirectory={workingDirectory}
                        />
                    ) : execution.toolName === 'WebSearch' && parsedInput && typeof parsedInput === 'object' ? (
                        <WebSearchToolRenderer
                            input={parsedInput as WebSearchToolInput}
                            result={execution.result}
                            error={execution.error}
                        />
                    ) : execution.toolName === 'Read' && parsedInput && typeof parsedInput === 'object' ? (
                        <ReadToolRenderer
                            input={parsedInput as ReadToolInput}
                            result={execution.result}
                            error={execution.error}
                            workingDirectory={workingDirectory}
                        />
                    ) : execution.toolName === 'Task' && parsedInput && typeof parsedInput === 'object' ? (
                        // Check subagent_type to determine which renderer to use
                        (parsedInput as TaskToolInput).subagent_type === 'Explore' ||
                        (parsedInput as TaskToolInput).subagent_type === 'explore' ? (
                            <ExploreRenderer
                                input={parsedInput as TaskToolInput}
                                result={execution.result}
                                error={execution.error}
                                status={execution.status}
                            />
                        ) : (
                            <PlanRenderer
                                input={parsedInput as TaskToolInput}
                                result={execution.result}
                                error={execution.error}
                                status={execution.status}
                            />
                        )
                    ) : execution.toolName === 'AskUserQuestion' && parsedInput && typeof parsedInput === 'object' ? (
                        <AskUserQuestionRenderer
                            input={parsedInput as any}
                            result={execution.result}
                            error={execution.error}
                        />
                    ) : (
                        <>
                            {/* Default renderer for other tools */}
                            {/* Input details */}
                            {formattedInput.length > 0 && (
                                <div className="space-y-1">
                                    {formattedInput.map((item, idx) => (
                                        <div key={idx} className="flex flex-col gap-0.5">
                                            <span
                                                className="text-zinc-500 text-[10px] uppercase tracking-wide">{item.label}</span>
                                            <pre
                                                className="p-2 bg-zinc-900 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-zinc-100 font-mono">
                        {item.value}
                      </pre>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Output/Result */}
                            {execution.result && (
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1">
                                        <span
                                            className="text-zinc-500 text-[10px] uppercase tracking-wide">Output</span>
                                        <CopyButton text={execution.result}/>
                                    </div>
                                    <pre
                                        className="p-2 bg-zinc-900 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap break-all text-zinc-100 font-mono">
                    {execution.result}
                  </pre>
                                </div>
                            )}
                            {/* Error */}
                            {execution.error && (
                                <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1">
                                        <span className="text-red-400 text-[10px] uppercase tracking-wide">Error</span>
                                        <CopyButton text={execution.error}/>
                                    </div>
                                    <pre
                                        className="p-2 bg-red-950 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-red-400 font-mono">{execution.error}</pre>
                                </div>
                            )}
                        </>
                    )}
                    </>
                    )}
                </div>
            )}
        </div>
    );
}
