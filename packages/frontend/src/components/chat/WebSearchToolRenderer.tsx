import React from 'react';
import { Globe, ExternalLink, Search } from 'lucide-react';
import type { WebSearchToolInput } from '@claude-code-webui/shared';

interface WebSearchToolRendererProps {
  input: WebSearchToolInput;
  result?: string;
  error?: string;
  className?: string;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const WebSearchToolRenderer: React.FC<WebSearchToolRendererProps> = ({
  input,
  result,
  error,
  className = ''
}) => {
  // Parse search results from the result string
  const parseSearchResults = (resultStr: string): SearchResult[] => {
    const results: SearchResult[] = [];

    // Match search result blocks that typically look like:
    // 1. [Title](URL)
    //    Snippet text...
    const blockRegex = /(\d+)\.\s+\[([^\]]+)\]\(([^)]+)\)\s*([^]*?)(?=\d+\.\s+\[|$)/g;
    let match;

    while ((match = blockRegex.exec(resultStr)) !== null) {
      const [, , title, url, snippet] = match;
      results.push({
        title: title?.trim() || '',
        url: url?.trim() || '',
        snippet: snippet?.trim() || ''
      });
    }

    // Fallback: try to parse markdown links if no blocks found
    if (results.length === 0) {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      while ((match = linkRegex.exec(resultStr)) !== null) {
        const [, title, url] = match;
        results.push({
          title: title?.trim() || '',
          url: url?.trim() || '',
          snippet: ''
        });
      }
    }

    return results;
  };

  const searchResults = result ? parseSearchResults(result) : [];

  return (
    <div className={`text-sm ${className}`}>
      {/* Search header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
        <Search className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span className="flex-1 font-medium text-foreground">{input.query}</span>
      </div>

      {/* Domain filters if any */}
      {(input.allowed_domains || input.blocked_domains) && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs">
          {input.allowed_domains && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-muted-foreground">Allowed domains:</span>
              <span className="text-green-600 dark:text-green-400">
                {input.allowed_domains.join(', ')}
              </span>
            </div>
          )}
          {input.blocked_domains && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Blocked domains:</span>
              <span className="text-red-600 dark:text-red-400">
                {input.blocked_domains.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Search results */}
      {result ? (
        searchResults.length > 0 ? (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {searchResults.map((searchResult, idx) => (
              <div key={idx} className="p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-medium text-blue-600 dark:text-blue-400 line-clamp-1">
                    {searchResult.title}
                  </h3>
                  <a
                    href={searchResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                    title="Open in new tab"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="text-xs text-green-600 dark:text-green-400 truncate mb-2">
                  {searchResult.url}
                </div>
                {searchResult.snippet && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {searchResult.snippet}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          // Fallback to showing raw result if parsing failed
          <div className="p-4">
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{result}</pre>
          </div>
        )
      ) : !error ? (
        <div className="px-4 py-3 text-center text-muted-foreground animate-pulse">
          Searching...
        </div>
      ) : null}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
          <pre className="whitespace-pre-wrap text-sm">{error}</pre>
        </div>
      )}

      {/* No results message */}
      {result && searchResults.length === 0 && !error && (
        <div className="px-4 py-8 text-center text-muted-foreground">
          <Globe className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No search results found</p>
        </div>
      )}
    </div>
  );
};