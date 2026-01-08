import { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, MessageSquare } from 'lucide-react';

interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect: boolean;
  }>;
  answers?: Record<string, string | string[]>;
}

interface AskUserQuestionRendererProps {
  input: AskUserQuestionInput;
  result?: string;
  error?: string;
}

export function AskUserQuestionRenderer({ input, result }: AskUserQuestionRendererProps) {
  const [expandedQuestions, setExpandedQuestions] = useState<Record<number, boolean>>({});

  const toggleQuestion = (index: number) => {
    setExpandedQuestions(prev => ({ ...prev, [index]: !prev[index] }));
  };

  // Parse the result to get answers if available
  let parsedAnswers: Record<string, string | string[]> = {};
  if (result) {
    // Try to parse the result string which might contain the answers
    try {
      // The result format is like: User has answered your questions: "0"="answer". You can now continue...
      const match = result.match(/User has answered your questions: (.+)\. You can now/);
      if (match && match[1]) {
        const answersStr = match[1];
        // Parse answers like "0"="answer", "1"="another"
        const answerPairs = answersStr.match(/"(\d+)"="([^"]+)"/g);
        if (answerPairs) {
          answerPairs.forEach(pair => {
            const pairMatch = pair.match(/"(\d+)"="([^"]+)"/);
            if (pairMatch && pairMatch[1] && pairMatch[2]) {
              parsedAnswers[pairMatch[1]] = pairMatch[2];
            }
          });
        }
      }
    } catch (e) {
      // If parsing fails, check if answers were provided in input
      if (input.answers) {
        parsedAnswers = input.answers;
      }
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-zinc-400">
        <HelpCircle className="h-4 w-4" />
        <span className="text-sm font-medium">Asked {input.questions.length} question{input.questions.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Questions */}
      <div className="space-y-2">
        {input.questions.map((q, index) => {
          const isExpanded = expandedQuestions[index] ?? false;
          const answer = parsedAnswers[String(index)];

          return (
            <div key={index} className="border border-zinc-800 rounded overflow-hidden">
              {/* Question header */}
              <button
                onClick={() => toggleQuestion(index)}
                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-zinc-900 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                )}
                <span className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] font-medium text-zinc-400">
                  {q.header}
                </span>
                <span className="text-xs text-zinc-300 flex-1 truncate">{q.question}</span>
                {answer && (
                  <span className="text-xs text-green-500 font-medium">Answered</span>
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-3 py-2 border-t border-zinc-800 space-y-2">
                  {/* Options */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Options {q.multiSelect && '(multiple choice)'}</span>
                    <div className="space-y-1">
                      {q.options.map((option, oIndex) => {
                        const isSelected = answer && (
                          Array.isArray(answer) ? answer.includes(option.label) : answer === option.label
                        );

                        return (
                          <div
                            key={oIndex}
                            className={`px-2 py-1 rounded text-xs ${
                              isSelected ? 'bg-green-900/20 border border-green-800' : 'bg-zinc-900'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`font-medium ${isSelected ? 'text-green-400' : 'text-zinc-300'}`}>
                                {option.label}
                              </span>
                              {option.description && (
                                <span className="text-zinc-500">- {option.description}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Show custom answer if it's not one of the options */}
                      {answer && !q.options.some(opt =>
                        Array.isArray(answer) ? answer.includes(opt.label) : answer === opt.label
                      ) && (
                        <div className="px-2 py-1 rounded text-xs bg-green-900/20 border border-green-800">
                          <div className="flex items-start gap-2">
                            <MessageSquare className="h-3 w-3 text-green-400 mt-0.5 flex-shrink-0" />
                            <span className="text-green-400">
                              Custom answer: {Array.isArray(answer) ? answer.join(', ') : answer}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Answer section */}
                  {answer && (
                    <div className="pt-2 border-t border-zinc-800">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">User's answer</span>
                      <div className="mt-1 text-xs text-green-400">
                        {Array.isArray(answer) ? answer.join(', ') : answer}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}