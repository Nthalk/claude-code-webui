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
  percentUsed: number;
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

function ModeDropdown({
  mode,
  onModeChange,
  compact = false,
}: {
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const currentMode = modeConfig[mode];
  const Icon = currentMode.icon;

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
        className="fixed z-[101] w-56 rounded-xl border bg-card shadow-lg overflow-hidden animate-scale-in"
        style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
      >
        {(Object.entries(modeConfig) as [SessionMode, typeof modeConfig[SessionMode]][]).map(
          ([key, config]) => {
            const ModeIcon = config.icon;
            return (
              <button
                key={key}
                onClick={() => {
                  onModeChange(key);
                  setIsOpen(false);
                }}
                className={cn(
                  'flex items-start gap-3 w-full p-3 text-left transition-colors hover:bg-muted/50',
                  mode === key && 'bg-muted'
                )}
              >
                <ModeIcon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
                <div>
                  <div className={cn('text-sm font-medium', mode === key && config.color)}>
                    {config.label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {config.description}
                  </div>
                </div>
              </button>
            );
          }
        )}
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
          'gap-1.5',
          compact ? 'h-7 px-2' : 'h-8 px-3',
          currentMode.bgColor,
          currentMode.color
        )}
      >
        <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        <span className={cn("font-medium", compact ? "text-[10px]" : "text-xs")}>
          {compact ? currentMode.shortLabel : currentMode.label}
        </span>
        <ChevronDown className={cn('transition-transform', compact ? 'h-2.5 w-2.5' : 'h-3 w-3', isOpen && 'rotate-180')} />
      </Button>
      {dropdown}
    </div>
  );
}

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(percent, 100)}%` }}
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

// Compact stat pill for condensed view
function StatPill({ label, value, percent }: { label: string; value: string; percent?: number }) {
  const getTextColor = (p: number) => {
    if (p >= 90) return 'text-red-500';
    if (p >= 70) return 'text-amber-500';
    return 'text-muted-foreground';
  };

  return (
    <span className={cn(
      "text-[11px] font-mono",
      percent !== undefined ? getTextColor(percent) : 'text-muted-foreground'
    )}>
      <span className="text-muted-foreground/70">{label}</span>
      <span className="ml-0.5">{value}</span>
    </span>
  );
}

interface ProjectedUsage {
  percentAtReset: number;
  willDeplete: boolean;
  depleteTime?: string;
}

// Shared dropdown content for stats details
function StatsDropdownContent({
  fullModel,
  currentModelType,
  onModelChange,
  contextPercent,
  totalTokens,
  contextWindow,
  cost,
  sessionPercent,
  weeklyAllPercent,
  weeklySonnetPercent,
  weeklyAllProjection,
  weeklySonnetProjection,
}: {
  fullModel: string;
  currentModelType: ModelType;
  onModelChange?: (model: ModelType) => void;
  contextPercent: number;
  totalTokens: number;
  contextWindow: number;
  cost: number;
  sessionPercent: number;
  weeklyAllPercent: number;
  weeklySonnetPercent: number;
  weeklyAllProjection: ProjectedUsage | null;
  weeklySonnetProjection: ProjectedUsage | null;
}) {
  const getColor = (p: number) => {
    if (p >= 90) return 'bg-red-500';
    if (p >= 70) return 'bg-amber-500';
    return 'bg-green-500';
  };

  const getTextColor = (p: number) => {
    if (p >= 90) return 'text-red-500';
    if (p >= 70) return 'text-amber-500';
    return 'text-foreground';
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
          <span className="text-xs font-medium">Context</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <UsageBar percent={contextPercent} color={getColor(contextPercent)} />
          <span className={cn('text-xs font-mono font-medium', getTextColor(contextPercent))}>
            {contextPercent}%
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatTokens(totalTokens)} / {formatTokens(contextWindow)}
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Session Limit</span>
          <span className={cn('text-xs font-mono', getTextColor(sessionPercent))}>
            {sessionPercent}%
          </span>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Weekly (All)</span>
            <span className={cn('text-xs font-mono', getTextColor(weeklyAllPercent))}>
              {weeklyAllPercent}%
            </span>
          </div>
          {weeklyAllProjection && (
            <div className={cn("text-[10px] mt-0.5", weeklyAllProjection.willDeplete ? "text-red-500" : "text-muted-foreground")}>
              {weeklyAllProjection.willDeplete
                ? `⚠ Depletes ${weeklyAllProjection.depleteTime}`
                : `→ ${weeklyAllProjection.percentAtReset}% at reset`}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Weekly (Sonnet)</span>
            <span className={cn('text-xs font-mono', getTextColor(weeklySonnetPercent))}>
              {weeklySonnetPercent}%
            </span>
          </div>
          {weeklySonnetProjection && (
            <div className={cn("text-[10px] mt-0.5", weeklySonnetProjection.willDeplete ? "text-red-500" : "text-muted-foreground")}>
              {weeklySonnetProjection.willDeplete
                ? `⚠ Depletes ${weeklySonnetProjection.depleteTime}`
                : `→ ${weeklySonnetProjection.percentAtReset}% at reset`}
            </div>
          )}
        </div>
      </div>
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
  const contextPercent = usage?.contextUsedPercent ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;
  const contextWindow = usage?.contextWindow ?? 200000;
  const cost = usage?.totalCostUsd ?? 0;
  const model = usage?.model ?? 'Not connected';

  // Determine current model type from full model string
  const currentModelType: ModelType = model.includes('opus') ? 'opus' :
                                       model.includes('haiku') ? 'haiku' : 'sonnet';

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
    resetsAt: sessionLimit?.resetsAt ?? new Date(Date.now() + 1 * 60 * 60 * 1000 + 57 * 60 * 1000),
  };

  const defaultWeeklyAll: UsageLimitInfo = {
    percentUsed: weeklyAllModels?.percentUsed ?? 0,
    resetsAt: weeklyAllModels?.resetsAt ?? getNextThursday(9, 59),
  };

  const defaultWeeklySonnet: UsageLimitInfo = {
    percentUsed: weeklySonnet?.percentUsed ?? 0,
    resetsAt: weeklySonnet?.resetsAt ?? getNextThursday(9, 59),
  };

  // Calculate projected usage at reset time for weekly limits
  // Returns { percentAtReset, willDeplete, depleteTime } or null
  function getProjectedUsage(percentUsed: number, resetsAt?: Date): { percentAtReset: number; willDeplete: boolean; depleteTime?: string } | null {
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
    const willDeplete = projectedAtReset >= 100;

    if (!willDeplete) {
      return { percentAtReset: Math.round(projectedAtReset), willDeplete: false };
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

    return { percentAtReset: Math.round(projectedAtReset), willDeplete: true, depleteTime };
  }

  const weeklyAllProjection = getProjectedUsage(defaultWeeklyAll.percentUsed, defaultWeeklyAll.resetsAt);
  const weeklySonnetProjection = getProjectedUsage(defaultWeeklySonnet.percentUsed, defaultWeeklySonnet.resetsAt);

  // Get model config for display
  const currentModelConfig = modelConfig[currentModelType];
  const ModelIcon = currentModelConfig.icon;

  // State for stats dropdown
  const [showStatsDropdown, setShowStatsDropdown] = useState(false);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const usageButtonRef = useRef<HTMLButtonElement>(null);
  const [statsDropdownPosition, setStatsDropdownPosition] = useState({ top: 0, left: 0, right: 0 });
  const [clickedButton, setClickedButton] = useState<'model' | 'usage'>('usage');

  useEffect(() => {
    if (!showStatsDropdown) return;

    const buttonRef = clickedButton === 'model' ? modelButtonRef : usageButtonRef;
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setStatsDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        right: window.innerWidth - rect.right,
      });
    }
  }, [showStatsDropdown, clickedButton]);

  const isCompact = true; // Both variants now use compact mode with dropdown
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
          totalTokens={totalTokens}
          contextWindow={contextWindow}
          cost={cost}
          sessionPercent={defaultSessionLimit.percentUsed}
          weeklyAllPercent={defaultWeeklyAll.percentUsed}
          weeklySonnetPercent={defaultWeeklySonnet.percentUsed}
          weeklyAllProjection={weeklyAllProjection}
          weeklySonnetProjection={weeklySonnetProjection}
        />
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="flex items-center gap-2 md:gap-3 h-7 text-xs">
      {/* Model indicator */}
      <button
        ref={modelButtonRef}
        onClick={() => {
          setClickedButton('model');
          setShowStatsDropdown(true);
        }}
        className={cn(
          "flex items-center gap-1 px-1.5 md:px-2 py-1 rounded transition-colors hover:bg-muted/50",
          currentModelConfig.color
        )}
        title={model}
      >
        <ModelIcon className="h-3 w-3" />
        <span className="text-[10px] font-medium hidden sm:inline">
          {currentModelConfig.shortLabel}
        </span>
      </button>
      <div className="h-3 w-px bg-border/50" />
      <ModeDropdown mode={mode} onModeChange={onModeChange} compact={isCompact} />
      <div className="h-3 w-px bg-border/50" />
      <button
        ref={usageButtonRef}
        onClick={() => {
          setClickedButton('usage');
          setShowStatsDropdown(true);
        }}
        className="flex items-center gap-2 md:gap-3 hover:bg-muted/50 px-1.5 md:px-2 py-1 rounded transition-colors"
      >
        <StatPill label="ctx" value={`${contextPercent}%`} percent={contextPercent} />
        {cost > 0 && <StatPill label="$" value={formatCost(cost).replace('$', '')} />}
        <StatPill label="sess" value={`${defaultSessionLimit.percentUsed}%`} percent={defaultSessionLimit.percentUsed} />
        <StatPill label="wk" value={`${defaultWeeklyAll.percentUsed}%`} percent={defaultWeeklyAll.percentUsed} />
      </button>
      {statsDropdown}
    </div>
  );
}
