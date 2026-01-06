import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderSearch,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus,
  FileJson,
  Clock,
  Cpu,
  DollarSign,
  Hash,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { Session, ApiResponse, Project } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function Projects() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [initialExpanded, setInitialExpanded] = useState(false);

  // Fetch all projects
  const { data: projects, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Project[]>>('/api/projects');
      if (response.data.success && response.data.data) {
        const projectData = response.data.data;

        // Auto-expand if there's only one project with sessions
        const firstProject = projectData[0];
        if (!initialExpanded && projectData.length === 1 && firstProject && firstProject.sessionCount && firstProject.sessionCount > 0) {
          setInitialExpanded(true);
          // Use setTimeout to ensure the component has rendered
          setTimeout(() => {
            toggleProject(firstProject.id, true);
          }, 0);
        }

        return projectData;
      }
      return [];
    },
    staleTime: 60000, // Cache for 1 minute
  });

  // Create session from project mutation
  const createMutation = useMutation({
    mutationFn: async (project: Project) => {
      const response = await api.post<ApiResponse<Session>>('/api/sessions', {
        name: `${project.name} - Session`,
        workingDirectory: project.path,
        projectId: project.id,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        toast({ title: 'Session created', description: `Started session for ${data.data.name}` });
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const toggleProject = async (projectId: string, forceExpand?: boolean) => {
    const project = projects?.find(p => p.id === projectId);
    if (!project) return;

    // If forceExpand is true, ensure we expand and load data
    if (forceExpand) {
      if (!project.sessions && project.sessionCount && project.sessionCount > 0) {
        // Fetch detailed project data with sessions
        try {
          const response = await api.get<ApiResponse<Project>>(`/api/projects/${projectId}`);
          if (response.data.success && response.data.data) {
            queryClient.setQueryData(['projects'], (old: Project[] | undefined) => {
              if (!old) return old;
              return old.map(p => p.id === projectId ? response.data.data! : p);
            });
          }
        } catch (error) {
          toast({ title: 'Error', description: 'Failed to load project details', variant: 'destructive' });
        }
      }
      setExpandedProjects(prev => new Set(prev).add(projectId));
      return;
    }

    // Normal toggle behavior
    if (!project.sessionCount || project.sessions) {
      // Toggle expansion only
      setExpandedProjects(prev => {
        const newSet = new Set(prev);
        if (newSet.has(projectId)) {
          newSet.delete(projectId);
        } else {
          newSet.add(projectId);
        }
        return newSet;
      });
    } else {
      // Fetch detailed project data with sessions
      try {
        const response = await api.get<ApiResponse<Project>>(`/api/projects/${projectId}`);
        if (response.data.success && response.data.data) {
          queryClient.setQueryData(['projects'], (old: Project[] | undefined) => {
            if (!old) return old;
            return old.map(p => p.id === projectId ? response.data.data! : p);
          });
          setExpandedProjects(prev => new Set(prev).add(projectId));
        }
      } catch (error) {
        toast({ title: 'Error', description: 'Failed to load project details', variant: 'destructive' });
      }
    }
  };

  if (isLoading) {
    return null;
  }

  if (!projects || projects.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <FolderSearch className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-lg">Projects</CardTitle>
            <span className="text-sm text-muted-foreground">({projects.length})</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              refetch();
            }}
            disabled={isRefetching}
            title="Refresh projects"
          >
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </Button>
        </div>
        {isExpanded && (
          <CardDescription>
            All projects with their sessions and token usage
          </CardDescription>
        )}
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-lg border p-3 transition-colors hover:border-primary"
              >
                <div className="space-y-2">
                  {/* Project header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="font-medium truncate">{project.name}</span>
                        {project.isDiscovered && (
                          <span className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Discovered
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-2">
                        {project.path}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(project.updatedAt)}
                        </span>
                        {project.sessionCount && project.sessionCount > 0 && (
                          <button
                            className="flex items-center gap-1 hover:text-foreground transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleProject(project.id);
                            }}
                          >
                            <FileJson className="h-3 w-3" />
                            {project.sessionCount} {project.sessionCount === 1 ? 'session' : 'sessions'}
                            {expandedProjects.has(project.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        )}
                        {project.totalTokens && project.totalTokens > 0 && (
                          <span className="flex items-center gap-1">
                            <Hash className="h-3 w-3" />
                            {formatTokenCount(project.totalTokens)} tokens
                          </span>
                        )}
                        {project.totalCostUsd && project.totalCostUsd > 0 && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {formatCost(project.totalCostUsd)}
                          </span>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Sessions list */}
                  {expandedProjects.has(project.id) && project.sessions && (
                    <div className="mt-3 pl-6 space-y-2 border-l-2 border-muted ml-2">
                      {project.sessions.length > 0 ? (
                        <>
                          {project.sessions.map((session) => (
                            <div
                              key={session.id}
                              className="text-sm p-2 rounded hover:bg-muted/50 cursor-pointer"
                              onClick={() => navigate(`/session/${session.id}`)}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <FileJson className="h-3 w-3 text-blue-500" />
                                  <span className="font-medium">{session.name}</span>
                                  <span className={cn(
                                    "inline-flex items-center text-xs px-2 py-0.5 rounded",
                                    session.status === 'running' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                                  )}>
                                    {session.status}
                                  </span>
                                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded border">
                                    <Cpu className="h-3 w-3 mr-1" />
                                    {session.model}
                                  </span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {formatRelativeTime(session.updatedAt)}
                                </span>
                              </div>
                              {session.tokenUsage && (
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                  <span>{formatTokenCount(session.tokenUsage.totalTokens)} tokens</span>
                                  <span>{formatCost(session.tokenUsage.totalCostUsd)}</span>
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Resume Last Session / New Session button */}
                          <div className="pt-2 flex justify-center">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={createMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Navigate to the most recent session
                                if (project.sessions && project.sessions[0]) {
                                  navigate(`/session/${project.sessions[0].id}`);
                                }
                              }}
                              className="w-full max-w-[200px]"
                            >
                              <ChevronRight className="h-3 w-3 mr-1" />
                              Resume Last Session
                            </Button>
                          </div>
                        </>
                      ) : (
                        // No sessions - show new session button
                        <div className="text-center py-3">
                          <p className="text-xs text-muted-foreground mb-2">No sessions yet</p>
                          <Button
                            size="sm"
                            variant="default"
                            disabled={createMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              createMutation.mutate(project);
                            }}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {createMutation.isPending ? 'Creating...' : 'Create First Session'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default Projects;