import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  History,
  FileCode,
  RefreshCw,
  ChevronDown,
  Loader2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { PushToGitHubDialog } from '@/components/github';
import { GitStatus } from './GitStatus';
import { GitCommit } from './GitCommit';
import { GitHistory } from './GitHistory';
import { GitDiffViewer } from './GitDiffViewer';
import type { ApiResponse, GitStatus as GitStatusType, GitBranch as GitBranchType } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitPanelProps {
  workingDirectory: string;
  className?: string;
}

type TabId = 'changes' | 'commit' | 'history';

export function GitPanel({ workingDirectory, className }: GitPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('changes');
  const [selectedDiff, setSelectedDiff] = useState<{ file: string; staged: boolean } | null>(null);
  const [showPushDialog, setShowPushDialog] = useState(false);
  const queryClient = useQueryClient();

  // Fetch git status to check if this is a git repo
  const { data: status, isLoading: statusLoading, refetch, isRefetching } = useQuery({
    queryKey: ['git-status', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitStatusType>>(
        `/api/git/status?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    retry: false,
  });

  // Fetch current branch
  const { data: branches } = useQuery({
    queryKey: ['git-branches', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<GitBranchType[]>>(
        `/api/git/branches?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    enabled: !!status,
    retry: false,
  });

  const currentBranch = branches?.find((b) => b.isCurrent);

  // Fetch remotes
  const { data: remotes } = useQuery({
    queryKey: ['git-remotes', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Array<{ name: string; url: string }>>>(
        `/api/git/remotes?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
    enabled: !!status,
    retry: false,
  });

  const handleFileSelect = (file: string, staged: boolean) => {
    setSelectedDiff({ file, staged });
  };

  if (statusLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <GitBranch className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">Not a git repository</p>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'changes', label: 'Changes', icon: <FileCode className="h-3.5 w-3.5" /> },
    { id: 'commit', label: 'Commit', icon: <GitCommitIcon className="h-3.5 w-3.5" /> },
    { id: 'history', label: 'History', icon: <History className="h-3.5 w-3.5" /> },
  ];

  const changesCount = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="shrink-0 p-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{currentBranch?.name || status.branch}</span>
            {changesCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500">
                {changesCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowPushDialog(true)}
              title="Push to GitHub"
            >
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={isRefetching}
              title="Refresh"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedDiff(null);
              }}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors',
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedDiff ? (
          <div className="h-full flex flex-col">
            <button
              onClick={() => setSelectedDiff(null)}
              className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="h-3 w-3 rotate-90" />
              Back to {activeTab}
            </button>
            <div className="flex-1 min-h-0">
              <GitDiffViewer
                workingDirectory={workingDirectory}
                file={selectedDiff.file}
                staged={selectedDiff.staged}
              />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto p-2">
            {activeTab === 'changes' && (
              <GitStatus
                workingDirectory={workingDirectory}
                onFileSelect={handleFileSelect}
              />
            )}
            {activeTab === 'commit' && (
              <GitCommit workingDirectory={workingDirectory} />
            )}
            {activeTab === 'history' && (
              <GitHistory workingDirectory={workingDirectory} />
            )}
          </div>
        )}
      </div>

      <PushToGitHubDialog
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        workingDirectory={workingDirectory}
        currentBranch={currentBranch?.name || status.branch}
        remotes={remotes}
        onPushed={() => {
          queryClient.invalidateQueries({ queryKey: ['git-status', workingDirectory] });
        }}
      />
    </div>
  );
}

export default GitPanel;
