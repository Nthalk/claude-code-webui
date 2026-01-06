import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Brain,
  CheckCircle,
  Hand,
  Zap,
  ChevronDown,
  Sparkles,
  Cpu,
  Rabbit,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UsageData, SessionMode, ModelType } from '@claude-code-webui/shared';

interface UsageLimitInfo {
  percentUsed: number;  // Percentage that has been used (0-100)
  percentRemaining: number;  // Percentage that remains (0-100)
  resetsAt?: Date;
  resetsIn?: string;
}

interface SessionControlsProps {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  onModelChange?: (model: ModelType) => void;
  usage?: UsageData;
  sessionLimit?: UsageLimitInfo;
  weeklyAllModels?: UsageLimitInfo;
  weeklySonnet?: UsageLimitInfo;
  variant?: 'desktop' | 'mobile';
}

const modelConfig: Record<ModelType, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Sparkles;
  color: string;
}> = {
  opus: {
    label: 'Claude Opus',
    shortLabel: 'Opus',
    description: 'Most capable, best for complex tasks',
    icon: Sparkles,
    color: 'text-purple-500',
  },
  sonnet: {
    label: 'Claude Sonnet',
    shortLabel: 'Sonnet',
    description: 'Balanced performance and speed',
    icon: Cpu,
    color: 'text-blue-500',
  },
  haiku: {
    label: 'Claude Haiku',
    shortLabel: 'Haiku',
    description: 'Fast and efficient for simple tasks',
    icon: Rabbit,
    color: 'text-green-500',
  },
};

const modeConfig: Record<SessionMode, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Brain;
  color: string;
  bgColor: string;
}> = {
  planning: {
    label: 'Plan Mode',
    shortLabel: 'Plan',
    description: 'Claude plans but asks before executing',
    icon: Brain,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 hover:bg-blue-500/20',
  },
  'auto-accept': {
    label: 'Auto Accept',
    shortLabel: 'Auto',
    description: 'Automatically approve safe operations',
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10 hover:bg-green-500/20',
  },
  manual: {
    label: 'Manual',
    shortLabel: 'Manual',
    description: 'Approve each operation manually',
    icon: Hand,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10 hover:bg-amber-500/20',
  },
  danger: {
    label: 'YOLO Mode',
    shortLabel: 'YOLO',
    description: 'Skip all confirmations (dangerous!)',
    icon: Zap,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10 hover:bg-red-500/20',
  },
};


function UsageBar({ percent, color, useGradient = false }: { percent: number; color: string; useGradient?: boolean }) {
  const gradientStyle = useGradient ? {
    width: `${Math.min(percent, 100)}%`,
    backgroundColor: getGradientColor(percent)
  } : { width: `${Math.min(percent, 100)}%` };

  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', !useGradient && color)}
        style={gradientStyle}
      />
    </div>
  );
}

function formatTokens(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

// Helper to interpolate between two RGB colors
function interpolateColor(color1: [number, number, number], color2: [number, number, number], factor: number): string {
  const r = Math.round(color1[0] + (color2[0] - color1[0]) * factor);
  const g = Math.round(color1[1] + (color2[1] - color1[1]) * factor);
  const b = Math.round(color1[2] + (color2[2] - color1[2]) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

// Get gradient color based on percentage (0-100)
function getGradientColor(percent: number): string {
  // Define color stops (percent, RGB)
  const stops: [number, [number, number, number]][] = [
    [0, [239, 68, 68]],    // red-500
    [10, [239, 68, 68]],   // red-500
    [25, [251, 146, 60]],  // orange-500
    [50, [245, 158, 11]],  // amber-500
    [75, [250, 204, 21]],  // yellow-500
    [100, [34, 197, 94]],  // green-500
  ];

  // Find the two stops to interpolate between
  for (let i = 0; i < stops.length - 1; i++) {
    const stop1 = stops[i];
    const stop2 = stops[i + 1];
    if (!stop1 || !stop2) continue;

    const [p1, color1] = stop1;
    const [p2, color2] = stop2;

    if (percent >= p1 && percent <= p2) {
      const factor = (percent - p1) / (p2 - p1);
      return interpolateColor(color1, color2, factor);
    }
  }

  return 'rgb(34, 197, 94)'; // green-500 as default
}

// Get color class for text based on percentage or projection
function getTextColorForLimit(
  percentUsed: number,
  projection?: ProjectedUsage | null
): string {
  // If will deplete, always red
  if (projection?.willDeplete) {
    return 'text-red-500';
  }

  // If we have a projection, use the projected remaining percentage
  if (projection) {
    const projectedRemaining = projection.percentRemainingAtReset;
    if (projectedRemaining <= 10) return 'text-red-500';
    if (projectedRemaining <= 25) return 'text-orange-500';
    if (projectedRemaining <= 50) return 'text-amber-500';
    if (projectedRemaining <= 75) return 'text-yellow-500';
    return 'text-green-500';
  }

  // Otherwise use current remaining percentage for color
  const percentRemaining = 100 - percentUsed;
  if (percentRemaining <= 10) return 'text-red-500';
  if (percentRemaining <= 25) return 'text-orange-500';
  if (percentRemaining <= 50) return 'text-amber-500';
  if (percentRemaining <= 75) return 'text-yellow-500';
  return 'text-green-500';
}

// Compact stat pill for condensed view
function StatPill({
  label,
  value,
  percent,
  projection,
  useGradient = false
}: {
  label: string;
  value: string;
  percent?: number;
  projection?: ProjectedUsage | null;
  useGradient?: boolean;
}) {
  const getColor = () => {
    if (projection !== undefined) {
      return getTextColorForLimit(100 - (percent || 0), projection);
    }
    if (percent !== undefined) {
      if (percent <= 10) return 'text-red-500';
      if (percent <= 25) return 'text-orange-500';
      if (percent <= 50) return 'text-amber-500';
      if (percent <= 75) return 'text-yellow-500';
      return 'text-green-500';
    }
    return 'text-muted-foreground';
  };

  const gradientStyle = useGradient && percent !== undefined
    ? { color: getGradientColor(percent) }
    : undefined;

  return (
    <span
      className={cn(
        "text-[11px] font-mono",
        !gradientStyle && getColor()
      )}
      style={gradientStyle}
    >
      <span className="text-muted-foreground/70">{label}</span>
      <span className="ml-0.5">{value}</span>
    </span>
  );
}

interface ProjectedUsage {
  percentAtReset: number;  // This is percentUsed at reset
  percentRemainingAtReset: number;  // This is percentRemaining at reset (can be negative)
  willDeplete: boolean;
  depleteTime?: string;
  resetTime?: string;
}

interface SessionProjection {
  willDeplete: boolean;
  depleteTime?: string;
  remainingTime?: string;
}

// Shared dropdown content for stats details
function StatsDropdownContent({
  fullModel,
  currentModelType,
  onModelChange,
  contextPercent,
  rawContextPercent,
  totalTokens,
  contextWindow,
  cost,
  sessionPercent,
  weeklyAllPercent,
  weeklySonnetPercent,
  weeklyAllProjection,
  weeklySonnetProjection,
  sessionProjection,
}: {
  fullModel: string;
  currentModelType: ModelType;
  onModelChange?: (model: ModelType) => void;
  contextPercent: number;
  rawContextPercent: number;
  totalTokens: number;
  contextWindow: number;
  cost: number;
  sessionPercent: number;
  weeklyAllPercent: number;
  weeklySonnetPercent: number;
  weeklyAllProjection: ProjectedUsage | null;
  weeklySonnetProjection: ProjectedUsage | null;
  sessionProjection: SessionProjection | null;
}) {
  const getColor = (p: number) => {
    if (p <= 10) return 'bg-red-500';
    if (p <= 25) return 'bg-orange-500';
    if (p <= 50) return 'bg-amber-500';
    if (p <= 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getTextColor = (p: number) => {
    if (p <= 10) return 'text-red-500';
    if (p <= 25) return 'text-orange-500';
    if (p <= 50) return 'text-amber-500';
    if (p <= 75) return 'text-yellow-500';
    return 'text-green-500';
  };

  const currentModel = modelConfig[currentModelType];
  const ModelIcon = currentModel.icon;

  return (
    <div className="space-y-3">
      {/* Model Section */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <ModelIcon className={cn('h-4 w-4', currentModel.color)} />
          <div>
            <div className={cn('text-sm font-medium', currentModel.color)}>
              {currentModel.label}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {fullModel}
            </div>
          </div>
        </div>
        {onModelChange && (
          <div className="flex gap-1">
            {(Object.entries(modelConfig) as [ModelType, typeof modelConfig[ModelType]][]).map(
              ([key, config]) => {
                const Icon = config.icon;
                const isActive = key === currentModelType;
                return (
                  <button
                    key={key}
                    onClick={() => onModelChange(key)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded text-[10px] font-medium transition-colors',
                      isActive
                        ? `bg-muted ${config.color}`
                        : 'hover:bg-muted/50 text-muted-foreground'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {config.shortLabel}
                  </button>
                );
              }
            )}
          </div>
        )}
      </div>

      {/* Context */}
      <div className="pt-2 border-t">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium">Context Remaining</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <UsageBar percent={contextPercent} color={getColor(contextPercent)} useGradient={rawContextPercent >= 0} />
          <span className={cn('text-xs font-mono font-medium', rawContextPercent < 0 ? 'text-red-500' : getTextColor(contextPercent))}>
            {rawContextPercent < 0 ? 'Exceeded' : `${contextPercent}%`}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatTokens(totalTokens)} / {formatTokens(contextWindow)}
          {rawContextPercent < 0 && ` (${Math.abs(rawContextPercent)}% over)`}
        </div>
      </div>

      {/* Cost */}
      {cost > 0 && (
        <div className="flex items-center justify-between py-1 border-t">
          <span className="text-xs text-muted-foreground">Session Cost</span>
          <span className="text-sm font-mono font-medium">{formatCost(cost)}</span>
        </div>
      )}

      {/* Limits */}
      <div className="space-y-2 pt-1 border-t">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Session Remaining</span>
            <span className={cn('text-xs font-mono', getTextColor(sessionPercent))}>
              {sessionPercent}%
            </span>
          </div>
          {sessionProjection && (
            <div className={cn("text-[10px] mt-0.5", sessionProjection.willDeplete ? "text-red-500" : "text-muted-foreground")}>
              {sessionProjection.willDeplete
                ? `⚠ Depletes ${sessionProjection.depleteTime}`
                : `Ends ${sessionProjection.remainingTime}`}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Weekly (All) Remaining</span>
            <span className={cn('text-xs font-mono', getTextColor(weeklyAllPercent))}>
              {weeklyAllPercent}%
            </span>
          </div>
          {weeklyAllProjection && (
            <div className={cn("text-[10px] mt-0.5", weeklyAllProjection.willDeplete ? "text-red-500" : "text-muted-foreground")}>
              {weeklyAllProjection.willDeplete
                ? `⚠ Depletes ${weeklyAllProjection.depleteTime}`
                : `→ ${weeklyAllProjection.percentRemainingAtReset}% at reset (${weeklyAllProjection.resetTime})`}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Weekly (Sonnet) Remaining</span>
            <span className={cn('text-xs font-mono', getTextColor(weeklySonnetPercent))}>
              {weeklySonnetPercent}%
            </span>
          </div>
          {weeklySonnetProjection && (
            <div className={cn("text-[10px] mt-0.5", weeklySonnetProjection.willDeplete ? "text-red-500" : "text-muted-foreground")}>
              {weeklySonnetProjection.willDeplete
                ? `⚠ Depletes ${weeklySonnetProjection.depleteTime}`
                : `→ ${weeklySonnetProjection.percentRemainingAtReset}% at reset (${weeklySonnetProjection.resetTime})`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Unified dropdown component that includes both model and mode
function UnifiedDropdown({
  mode,
  onModeChange,
  modelType,
  onModelChange,
}: {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  modelType: ModelType;
  onModelChange?: (model: ModelType) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const currentMode = modeConfig[mode];
  const currentModel = modelConfig[modelType];
  const ModeIcon = currentMode.icon;
  const ModelIcon = currentModel.icon;

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
  }, [isOpen]);

  const dropdown = isOpen ? createPortal(
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={() => setIsOpen(false)}
      />
      <div
        className="fixed z-[101] w-64 rounded-xl border bg-card shadow-lg overflow-hidden animate-scale-in"
        style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
      >
        {/* Model Section */}
        {onModelChange && (
          <div className="p-2 border-b">
            <div className="text-[10px] font-medium text-muted-foreground px-2 pb-1.5 uppercase tracking-wider">Model</div>
            <div className="space-y-0.5">
              {(Object.entries(modelConfig) as [ModelType, typeof modelConfig[ModelType]][]).map(
                ([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        onModelChange(key);
                      }}
                      className={cn(
                        'flex items-center gap-2.5 w-full px-2 py-1.5 text-left rounded-md transition-colors hover:bg-muted/50',
                        modelType === key && 'bg-muted'
                      )}
                    >
                      <Icon className={cn('h-4 w-4', config.color)} />
                      <div className="flex-1">
                        <div className={cn('text-xs font-medium', modelType === key && config.color)}>
                          {config.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {config.description}
                        </div>
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* Mode Section */}
        <div className="p-2">
          <div className="text-[10px] font-medium text-muted-foreground px-2 pb-1.5 uppercase tracking-wider">Mode</div>
          <div className="space-y-0.5">
            {(Object.entries(modeConfig) as [SessionMode, typeof modeConfig[SessionMode]][]).map(
              ([key, config]) => {
                const Icon = config.icon;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      onModeChange(key);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'flex items-center gap-2.5 w-full px-2 py-1.5 text-left rounded-md transition-colors hover:bg-muted/50',
                      mode === key && 'bg-muted'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', config.color)} />
                    <div className="flex-1">
                      <div className={cn('text-xs font-medium', mode === key && config.color)}>
                        {config.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {config.description}
                      </div>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'gap-1.5 h-7 px-2',
          'hover:bg-muted/50'
        )}
      >
        <div className="flex items-center gap-1">
          <ModelIcon className={cn("h-3 w-3", currentModel.color)} />
          <span className={cn("text-[10px] font-medium", currentModel.color)}>
            {currentModel.shortLabel}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">•</div>
        <div className="flex items-center gap-1">
          <ModeIcon className={cn("h-3 w-3", currentMode.color)} />
          <span className={cn("text-[10px] font-medium", currentMode.color)}>
            {currentMode.shortLabel}
          </span>
        </div>
        <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', isOpen && 'rotate-180')} />
      </Button>
      {dropdown}
    </div>
  );
}

export function SessionControls({
  mode,
  onModeChange,
  onModelChange,
  usage,
  sessionLimit,
  weeklyAllModels,
  weeklySonnet,
  variant = 'desktop',
}: SessionControlsProps) {
  // Context window data from Claude CLI
  // Clamp context percent to 0-100 range (can be negative when exceeded)
  const rawContextPercent = usage?.contextRemainingPercent ?? 100;
  const contextPercent = Math.max(0, Math.min(100, rawContextPercent));
  const totalTokens = usage?.totalTokens ?? 0;
  const contextWindow = usage?.contextWindow ?? 200000;
  const cost = usage?.totalCostUsd ?? 0;
  const model = usage?.model ?? 'Not connected';

  // Determine current model type from full model string
  const currentModelType: ModelType = model.includes('opus') ? 'opus' :
                                       model.includes('haiku') ? 'haiku' :
                                       model.includes('sonnet') ? 'sonnet' : 'opus';

  // Helper to get next Thursday at specific time
  function getNextThursday(hour: number, minute: number): Date {
    const now = new Date();
    const result = new Date(now);
    const daysUntilThursday = (4 - now.getDay() + 7) % 7 || 7;
    result.setDate(now.getDate() + daysUntilThursday);
    result.setHours(hour, minute, 0, 0);
    return result;
  }

  // Actual limit values - ensure resetsAt is always set for projection calculation
  const defaultSessionLimit: UsageLimitInfo = {
    percentUsed: sessionLimit?.percentUsed ?? 0,
    percentRemaining: 100 - (sessionLimit?.percentUsed ?? 0),
    resetsAt: sessionLimit?.resetsAt ?? new Date(Date.now() + 1 * 60 * 60 * 1000 + 57 * 60 * 1000),
  };

  const defaultWeeklyAll: UsageLimitInfo = {
    percentUsed: weeklyAllModels?.percentUsed ?? 0,
    percentRemaining: 100 - (weeklyAllModels?.percentUsed ?? 0),
    resetsAt: weeklyAllModels?.resetsAt ?? getNextThursday(9, 59),
  };

  const defaultWeeklySonnet: UsageLimitInfo = {
    percentUsed: weeklySonnet?.percentUsed ?? 0,
    percentRemaining: 100 - (weeklySonnet?.percentUsed ?? 0),
    resetsAt: weeklySonnet?.resetsAt ?? getNextThursday(9, 59),
  };

  // Calculate projected usage at reset time for weekly limits
  function getProjectedUsage(percentUsed: number, resetsAt?: Date): ProjectedUsage | null {
    if (!resetsAt || percentUsed <= 0) return null;

    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const timeUntilReset = resetsAt.getTime() - now.getTime();
    if (timeUntilReset <= 0) return null;

    const timeElapsed = weekMs - timeUntilReset;
    if (timeElapsed <= 0) return null;

    const rate = percentUsed / timeElapsed;
    if (rate <= 0) return null;

    // Project what percent will be used by reset time
    const projectedAtReset = percentUsed + (rate * timeUntilReset);
    const percentRemainingAtReset = 100 - projectedAtReset;
    const willDeplete = projectedAtReset >= 100;

    // Format reset time
    const resetDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const resetDay = resetDays[resetsAt.getDay()];
    const resetHours = resetsAt.getHours().toString().padStart(2, '0');
    const resetMinutes = resetsAt.getMinutes().toString().padStart(2, '0');
    const resetTime = `${resetDay} ${resetHours}:${resetMinutes}`;

    if (!willDeplete) {
      return {
        percentAtReset: Math.round(projectedAtReset),
        percentRemainingAtReset: Math.round(percentRemainingAtReset),
        willDeplete: false,
        resetTime
      };
    }

    // Calculate when depletion will occur
    const remainingPercent = 100 - percentUsed;
    const msToDepletion = remainingPercent / rate;
    const depletionDate = new Date(now.getTime() + msToDepletion);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const day = days[depletionDate.getDay()];
    const hours = depletionDate.getHours().toString().padStart(2, '0');
    const minutes = depletionDate.getMinutes().toString().padStart(2, '0');

    const hoursUntil = msToDepletion / (1000 * 60 * 60);
    let depleteTime: string;
    if (hoursUntil < 1) {
      depleteTime = `~${Math.round(msToDepletion / (1000 * 60))}m`;
    } else if (hoursUntil < 24) {
      depleteTime = `~${Math.round(hoursUntil)}h`;
    } else {
      depleteTime = `${day} ${hours}:${minutes}`;
    }

    return {
      percentAtReset: Math.round(projectedAtReset),
      percentRemainingAtReset: Math.round(percentRemainingAtReset),
      willDeplete: true,
      depleteTime,
      resetTime
    };
  }

  const weeklyAllProjection = getProjectedUsage(defaultWeeklyAll.percentUsed, defaultWeeklyAll.resetsAt);
  const weeklySonnetProjection = getProjectedUsage(defaultWeeklySonnet.percentUsed, defaultWeeklySonnet.resetsAt);

  // Calculate session end time projection
  function getSessionProjection(percentUsed: number, resetsAt?: Date): SessionProjection | null {
    if (!resetsAt || percentUsed <= 0) return null;

    const now = new Date();
    const timeRemaining = resetsAt.getTime() - now.getTime();

    if (timeRemaining <= 0) return null;

    // Format the remaining time
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

    let remainingTime: string;
    if (hours > 0) {
      remainingTime = `in ${hours}h ${minutes}m`;
    } else {
      remainingTime = `in ${minutes}m`;
    }

    // Check if session will deplete before natural end (using conservative estimate)
    // Assuming linear usage, project if we'll hit 100% before reset
    const sessionDuration = 2 * 60 * 60 * 1000; // 2 hours default
    const elapsed = sessionDuration - timeRemaining;
    if (elapsed > 0 && percentUsed > 0) {
      const rate = percentUsed / elapsed;
      const projectedAtEnd = percentUsed + (rate * timeRemaining);

      if (projectedAtEnd >= 100) {
        const remainingPercent = 100 - percentUsed;
        const msToDepletion = remainingPercent / rate;

        const hoursUntil = msToDepletion / (1000 * 60 * 60);
        let depleteTime: string;
        if (hoursUntil < 1) {
          depleteTime = `in ~${Math.round(msToDepletion / (1000 * 60))}m`;
        } else {
          depleteTime = `in ~${Math.round(hoursUntil)}h`;
        }

        return { willDeplete: true, depleteTime, remainingTime };
      }
    }

    return { willDeplete: false, remainingTime };
  }

  const sessionProjection = getSessionProjection(defaultSessionLimit.percentUsed, defaultSessionLimit.resetsAt);

  // State for stats dropdown
  const [showStatsDropdown, setShowStatsDropdown] = useState(false);
  const usageButtonRef = useRef<HTMLButtonElement>(null);
  const [statsDropdownPosition, setStatsDropdownPosition] = useState({ top: 0, left: 0, right: 0 });

  useEffect(() => {
    if (!showStatsDropdown) return;

    if (usageButtonRef.current) {
      const rect = usageButtonRef.current.getBoundingClientRect();
      setStatsDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        right: window.innerWidth - rect.right,
      });
    }
  }, [showStatsDropdown]);

  void variant; // Used for potential future variant-specific styling

  const statsDropdown = showStatsDropdown ? createPortal(
    <>
      <div
        className="fixed inset-0 z-[100]"
        onClick={() => setShowStatsDropdown(false)}
      />
      <div
        className="fixed z-[101] w-64 rounded-xl border bg-card shadow-lg p-3 animate-scale-in"
        style={{
          top: statsDropdownPosition.top,
          right: Math.max(8, statsDropdownPosition.right), // Ensure at least 8px from right edge
        }}
      >
        <StatsDropdownContent
          fullModel={model}
          currentModelType={currentModelType}
          onModelChange={onModelChange}
          contextPercent={contextPercent}
          rawContextPercent={rawContextPercent}
          totalTokens={totalTokens}
          contextWindow={contextWindow}
          cost={cost}
          sessionPercent={defaultSessionLimit.percentRemaining}
          weeklyAllPercent={defaultWeeklyAll.percentRemaining}
          weeklySonnetPercent={defaultWeeklySonnet.percentRemaining}
          weeklyAllProjection={weeklyAllProjection}
          weeklySonnetProjection={weeklySonnetProjection}
          sessionProjection={sessionProjection}
        />
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 md:gap-2 text-xs">
      {/* Unified Model/Mode Dropdown */}
      <UnifiedDropdown
        mode={mode}
        onModeChange={onModeChange}
        modelType={currentModelType}
        onModelChange={onModelChange}
      />

      {/* Condensed usage stats */}
      <button
        ref={usageButtonRef}
        onClick={() => setShowStatsDropdown(true)}
        className="flex items-center gap-1.5 md:gap-2 hover:bg-muted/50 px-1.5 md:px-2 py-1 rounded transition-colors h-7"
      >
        {/* Show critical stats with abbreviations */}
        <StatPill
          label="ctx"
          value={rawContextPercent < 0 ? "0%" : `${contextPercent}%`}
          percent={contextPercent}
          useGradient={!rawContextPercent || rawContextPercent >= 0}  // No gradient when exceeded
        />
        <StatPill
          label="ses"
          value={`${defaultSessionLimit.percentRemaining}%`}
          percent={defaultSessionLimit.percentRemaining}
          projection={sessionProjection ? {
            percentAtReset: 100,  // For session, if it depletes it's at 100%
            percentRemainingAtReset: sessionProjection.willDeplete ? 0 : defaultSessionLimit.percentRemaining,
            willDeplete: sessionProjection.willDeplete,
            depleteTime: sessionProjection.depleteTime,
            resetTime: sessionProjection.remainingTime
          } : undefined}
        />
        <StatPill
          label="wk"
          value={`${defaultWeeklyAll.percentRemaining}%`}
          percent={defaultWeeklyAll.percentRemaining}
          projection={weeklyAllProjection}
        />
        {cost > 0 && <StatPill label="$" value={formatCost(cost).replace('$', '')} />}
      </button>
      {statsDropdown}
    </div>
  );
}
