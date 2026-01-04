import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Store,
  Download,
  RefreshCw,
  Trash2,
  Plus,
  Github,
  GitBranch,
  Loader2,
  Check,
  Puzzle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@claude-code-webui/shared';

interface MarketplacePluginInfo {
  name: string;
  description: string;
  version: string;
  author?: { name: string; email?: string };
  category?: string;
}

interface MarketplaceInfo {
  id: string;
  name: string;
  source: { source: 'github' | 'git'; repo?: string; url?: string };
  installLocation: string;
  lastUpdated: string;
  plugins?: MarketplacePluginInfo[];
}

interface InstalledPluginInfo {
  id: string;
  name: string;
  marketplace?: string;
}

interface MarketplaceBrowserProps {
  onClose: () => void;
}

export function MarketplaceBrowser({ onClose }: MarketplaceBrowserProps) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null);
  const [newMarketplace, setNewMarketplace] = useState({
    name: '',
    source: 'github' as 'github' | 'git',
    repo: '',
    url: '',
  });

  // Fetch marketplaces
  const { data: marketplaces, isLoading: marketplacesLoading } = useQuery({
    queryKey: ['marketplaces'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<MarketplaceInfo[]>>('/api/claude-config/marketplaces');
      return response.data.data || [];
    },
  });

  // Fetch installed plugins to check which are already installed
  const { data: installedPlugins } = useQuery({
    queryKey: ['installed-plugins'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<InstalledPluginInfo[]>>('/api/claude-config/plugins');
      return response.data.data || [];
    },
  });

  // Add marketplace mutation
  const addMarketplaceMutation = useMutation({
    mutationFn: async (data: typeof newMarketplace) => {
      const response = await api.post<ApiResponse<MarketplaceInfo>>('/api/claude-config/marketplaces', data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaces'] });
      setShowAddForm(false);
      setNewMarketplace({ name: '', source: 'github', repo: '', url: '' });
      toast({ title: 'Marketplace added successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Refresh marketplace mutation
  const refreshMarketplaceMutation = useMutation({
    mutationFn: async (marketplaceId: string) => {
      const response = await api.post<ApiResponse<MarketplaceInfo>>(`/api/claude-config/marketplace/${marketplaceId}/refresh`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaces'] });
      toast({ title: 'Marketplace refreshed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete marketplace mutation
  const deleteMarketplaceMutation = useMutation({
    mutationFn: async (marketplaceId: string) => {
      await api.delete(`/api/claude-config/marketplace/${marketplaceId}`);
      return marketplaceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplaces'] });
      setSelectedMarketplace(null);
      toast({ title: 'Marketplace removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Install plugin mutation
  const installPluginMutation = useMutation({
    mutationFn: async ({ pluginName, marketplaceId }: { pluginName: string; marketplaceId: string }) => {
      const response = await api.post<ApiResponse<unknown>>('/api/claude-config/plugins/install', {
        pluginName,
        marketplaceId,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins'] });
      toast({ title: 'Plugin installed successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const isPluginInstalled = (pluginName: string, marketplaceId: string) => {
    const pluginId = `${pluginName}@${marketplaceId}`;
    return installedPlugins?.some((p: InstalledPluginInfo) => p.id === pluginId);
  };

  const selectedMarketplaceData = marketplaces?.find((m: MarketplaceInfo) => m.id === selectedMarketplace);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-card rounded-2xl border shadow-2xl overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b bg-muted/30">
          <div className="p-2.5 rounded-xl bg-violet-500/10">
            <Store className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Plugin Marketplaces</h2>
            <p className="text-sm text-muted-foreground">
              Browse and install plugins from marketplaces
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Marketplace List */}
          <div className="w-64 border-r bg-muted/20 flex flex-col">
            <div className="p-3 border-b">
              <Button
                size="sm"
                onClick={() => setShowAddForm(!showAddForm)}
                className="w-full gap-2 bg-violet-600 hover:bg-violet-700"
              >
                <Plus className="h-4 w-4" />
                Add Marketplace
              </Button>
            </div>

            {/* Add Marketplace Form */}
            {showAddForm && (
              <div className="p-3 border-b bg-violet-500/5 space-y-3">
                <Input
                  placeholder="Marketplace name"
                  value={newMarketplace.name}
                  onChange={(e) => setNewMarketplace({ ...newMarketplace, name: e.target.value })}
                  className="h-9 text-sm"
                />
                <select
                  value={newMarketplace.source}
                  onChange={(e) => setNewMarketplace({ ...newMarketplace, source: e.target.value as 'github' | 'git' })}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="github">GitHub</option>
                  <option value="git">Git URL</option>
                </select>
                {newMarketplace.source === 'github' ? (
                  <Input
                    placeholder="owner/repo"
                    value={newMarketplace.repo}
                    onChange={(e) => setNewMarketplace({ ...newMarketplace, repo: e.target.value })}
                    className="h-9 text-sm font-mono"
                  />
                ) : (
                  <Input
                    placeholder="https://git.example.com/repo.git"
                    value={newMarketplace.url}
                    onChange={(e) => setNewMarketplace({ ...newMarketplace, url: e.target.value })}
                    className="h-9 text-sm font-mono"
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => addMarketplaceMutation.mutate(newMarketplace)}
                    disabled={!newMarketplace.name || addMarketplaceMutation.isPending ||
                      (newMarketplace.source === 'github' && !newMarketplace.repo) ||
                      (newMarketplace.source === 'git' && !newMarketplace.url)}
                    className="flex-1 h-8"
                  >
                    {addMarketplaceMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Add'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowAddForm(false)}
                    className="h-8"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Marketplace List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {marketplacesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : marketplaces && marketplaces.length > 0 ? (
                marketplaces.map((mp: MarketplaceInfo) => (
                  <button
                    key={mp.id}
                    type="button"
                    onClick={() => setSelectedMarketplace(mp.id)}
                    className={cn(
                      "w-full flex items-center gap-2 p-2.5 rounded-lg text-left transition-colors",
                      selectedMarketplace === mp.id
                        ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                        : "hover:bg-muted"
                    )}
                  >
                    <div className={cn(
                      "p-1.5 rounded-md",
                      mp.source.source === 'github' ? "bg-gray-500/10" : "bg-orange-500/10"
                    )}>
                      {mp.source.source === 'github' ? (
                        <Github className="h-3.5 w-3.5" />
                      ) : (
                        <GitBranch className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{mp.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {mp.plugins?.length || 0} plugins
                      </p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-8 px-4">
                  <Store className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No marketplaces added</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Click "Add Marketplace" to get started
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Main Content - Plugin List */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedMarketplaceData ? (
              <>
                {/* Marketplace Header */}
                <div className="p-4 border-b bg-muted/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{selectedMarketplaceData.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedMarketplaceData.source.source === 'github'
                          ? selectedMarketplaceData.source.repo
                          : selectedMarketplaceData.source.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Updated {new Date(selectedMarketplaceData.lastUpdated).toLocaleDateString()}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => refreshMarketplaceMutation.mutate(selectedMarketplaceData.id)}
                        disabled={refreshMarketplaceMutation.isPending}
                        className="h-8 gap-1.5"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshMarketplaceMutation.isPending && "animate-spin")} />
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMarketplaceMutation.mutate(selectedMarketplaceData.id)}
                        disabled={deleteMarketplaceMutation.isPending}
                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Plugin Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                  {selectedMarketplaceData.plugins && selectedMarketplaceData.plugins.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedMarketplaceData.plugins.map((plugin: MarketplacePluginInfo) => {
                        const installed = isPluginInstalled(plugin.name, selectedMarketplaceData.id);
                        return (
                          <div
                            key={plugin.name}
                            className={cn(
                              "p-4 rounded-xl border bg-card transition-all hover:shadow-md",
                              installed ? "border-green-500/30 bg-green-500/5" : "hover:border-violet-500/30"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div className={cn(
                                "p-2 rounded-lg shrink-0",
                                installed
                                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                  : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                              )}>
                                <Puzzle className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <p className="font-semibold truncate">{plugin.name}</p>
                                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                    v{plugin.version}
                                  </span>
                                  {installed && (
                                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
                                      Installed
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {plugin.description || 'No description'}
                                </p>
                                {plugin.author && (
                                  <p className="text-xs text-muted-foreground/70 mt-1">
                                    by {plugin.author.name}
                                  </p>
                                )}
                                {plugin.category && (
                                  <span className="inline-block mt-2 px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                    {plugin.category}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 flex justify-end">
                              {installed ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  className="h-8 gap-1.5 text-green-600 border-green-500/30"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Installed
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => installPluginMutation.mutate({
                                    pluginName: plugin.name,
                                    marketplaceId: selectedMarketplaceData.id,
                                  })}
                                  disabled={installPluginMutation.isPending}
                                  className="h-8 gap-1.5 bg-violet-600 hover:bg-violet-700"
                                >
                                  {installPluginMutation.isPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5" />
                                  )}
                                  Install
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <AlertTriangle className="h-10 w-10 text-amber-500/50 mb-3" />
                      <p className="font-medium text-muted-foreground">No plugins found</p>
                      <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
                        This marketplace doesn't have a marketplace.json file or has no plugins listed.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Store className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <p className="font-medium text-muted-foreground">Select a marketplace</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs mt-1">
                  Choose a marketplace from the list to browse available plugins
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Dialog wrapper
interface MarketplaceBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MarketplaceBrowserDialog({ open, onOpenChange }: MarketplaceBrowserDialogProps) {
  if (!open) return null;

  return <MarketplaceBrowser onClose={() => onOpenChange(false)} />;
}
