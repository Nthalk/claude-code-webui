import React from 'react';

interface EditToolDiffProps {
  oldString: string;
  newString: string;
  filePath?: string;
  workingDirectory?: string;
  className?: string;
}

// Simple line-by-line diff implementation
function computeSimpleDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: Array<{ type: 'unchanged' | 'removed' | 'added'; value: string }> = [];

  // Simple algorithm: find longest common subsequence
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      // Remaining new lines are additions
      while (newIdx < newLines.length) {
        result.push({ type: 'added', value: newLines[newIdx] || '' });
        newIdx++;
      }
    } else if (newIdx >= newLines.length) {
      // Remaining old lines are deletions
      while (oldIdx < oldLines.length) {
        result.push({ type: 'removed', value: oldLines[oldIdx] || '' });
        oldIdx++;
      }
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      // Lines match
      result.push({ type: 'unchanged', value: oldLines[oldIdx] || '' });
      oldIdx++;
      newIdx++;
    } else {
      // Try to find if current old line exists ahead in new lines
      const currentOldLine = oldLines[oldIdx];
      if (currentOldLine !== undefined) {
        const futureMatch = newLines.indexOf(currentOldLine, newIdx);
        if (futureMatch !== -1 && futureMatch - newIdx <= 3) {
          // Add the intermediate new lines as additions
          while (newIdx < futureMatch) {
            result.push({ type: 'added', value: newLines[newIdx] || '' });
            newIdx++;
          }
        } else {
          // Mark old line as removed
          result.push({ type: 'removed', value: currentOldLine });
          oldIdx++;
          // If new line doesn't match, add it
          if (newIdx < newLines.length && oldIdx < oldLines.length && oldLines[oldIdx] !== newLines[newIdx]) {
            result.push({ type: 'added', value: newLines[newIdx] || '' });
            newIdx++;
          }
        }
      }
    }
  }

  return result;
}

export const EditToolDiff: React.FC<EditToolDiffProps> = ({
  oldString,
  newString,
  filePath: _filePath, // Prefix with _ to indicate intentionally unused
  workingDirectory: _workingDirectory, // Prefix with _ to indicate intentionally unused
  className = ''
}) => {
  const changes = computeSimpleDiff(oldString, newString);

  // Count changes for summary
  const stats = changes.reduce((acc, change) => {
    if (change.type === 'added') acc.additions++;
    else if (change.type === 'removed') acc.deletions++;
    return acc;
  }, { additions: 0, deletions: 0 });

  return (
    <div className={`font-mono text-xs ${className}`}>
      <div className="flex items-center gap-4 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-t">
        <span className="text-green-600 dark:text-green-400">
          +{stats.additions} addition{stats.additions !== 1 ? 's' : ''}
        </span>
        <span className="text-red-600 dark:text-red-400">
          -{stats.deletions} deletion{stats.deletions !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="overflow-auto max-h-96 rounded-b border border-t-0 border-gray-200 dark:border-gray-700">
        <pre className="p-3 bg-gray-50 dark:bg-gray-900/50">
          {changes.map((change, index) => {
            const key = `${index}`;

            if (change.type === 'added') {
              return (
                <div
                  key={key}
                  className="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-l-2 border-green-500"
                >
                  <span className="inline-block w-6 text-center select-none">+</span>
                  <span>{change.value}</span>
                </div>
              );
            }

            if (change.type === 'removed') {
              return (
                <div
                  key={key}
                  className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-l-2 border-red-500"
                >
                  <span className="inline-block w-6 text-center select-none">-</span>
                  <span>{change.value}</span>
                </div>
              );
            }

            return (
              <div key={key} className="text-gray-600 dark:text-gray-400">
                <span className="inline-block w-6 text-center select-none"> </span>
                <span>{change.value}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};