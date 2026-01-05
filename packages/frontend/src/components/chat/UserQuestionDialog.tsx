import { useState, useCallback } from 'react';
import { HelpCircle, Check, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import type { PendingUserQuestion, UserQuestionAnswers } from '@claude-code-webui/shared';

interface UserQuestionDialogProps {
  question: PendingUserQuestion;
  onRespond: (answers: UserQuestionAnswers) => void;
}

export function UserQuestionDialog({ question, onRespond }: UserQuestionDialogProps) {
  // Track answers for each question
  // Key is question index (as string), value is selected option(s) or custom text
  const [answers, setAnswers] = useState<UserQuestionAnswers>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOptionSelect = useCallback(
    (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
      const key = String(questionIndex);

      setAnswers((prev) => {
        if (multiSelect) {
          // Multi-select: toggle the option in array
          const current = (prev[key] as string[]) || [];
          if (current.includes(optionLabel)) {
            return { ...prev, [key]: current.filter((o) => o !== optionLabel) };
          } else {
            return { ...prev, [key]: [...current, optionLabel] };
          }
        } else {
          // Single select: replace the value
          return { ...prev, [key]: optionLabel };
        }
      });

      // Hide custom input when selecting a predefined option
      setShowCustomInput((prev) => ({ ...prev, [key]: false }));
    },
    []
  );

  const handleCustomInputToggle = useCallback((questionIndex: number) => {
    const key = String(questionIndex);
    setShowCustomInput((prev) => ({ ...prev, [key]: !prev[key] }));
    // Clear predefined selection when showing custom input
    setAnswers((prev) => {
      const newAnswers = { ...prev };
      delete newAnswers[key];
      return newAnswers;
    });
  }, []);

  const handleCustomInputChange = useCallback((questionIndex: number, value: string) => {
    const key = String(questionIndex);
    setCustomInputs((prev) => ({ ...prev, [key]: value }));
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Ensure all questions have answers
      const finalAnswers: UserQuestionAnswers = {};
      for (let i = 0; i < question.questions.length; i++) {
        const key = String(i);
        const currentQuestion = question.questions[i];
        if (!currentQuestion) continue;

        if (showCustomInput[key]) {
          finalAnswers[key] = customInputs[key] || '';
        } else if (answers[key]) {
          finalAnswers[key] = answers[key];
        } else {
          // Default to first option if no answer
          finalAnswers[key] = currentQuestion.multiSelect ? [] : currentQuestion.options[0]?.label || '';
        }
      }

      await onRespond(finalAnswers);
    } finally {
      setIsSubmitting(false);
    }
  }, [question, answers, customInputs, showCustomInput, onRespond]);

  const isOptionSelected = (questionIndex: number, optionLabel: string, multiSelect: boolean) => {
    const key = String(questionIndex);
    const answer = answers[key];

    if (multiSelect) {
      return Array.isArray(answer) && answer.includes(optionLabel);
    } else {
      return answer === optionLabel;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <HelpCircle className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Claude has a question</h2>
            <p className="text-sm text-muted-foreground">
              Please answer the following to help Claude continue
            </p>
          </div>
        </div>

        {/* Questions */}
        <div className="p-4 space-y-6">
          {question.questions.map((q, qIndex) => (
            <div key={qIndex} className="space-y-3">
              {/* Question header chip */}
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-muted rounded text-xs font-medium text-muted-foreground">
                  {q.header}
                </span>
                {q.multiSelect && (
                  <span className="text-xs text-muted-foreground">(select multiple)</span>
                )}
              </div>

              {/* Question text */}
              <p className="font-medium">{q.question}</p>

              {/* Options */}
              <div className="space-y-2">
                {q.options.map((option, oIndex) => {
                  const isSelected = isOptionSelected(qIndex, option.label, q.multiSelect);

                  return (
                    <button
                      key={oIndex}
                      onClick={() => handleOptionSelect(qIndex, option.label, q.multiSelect)}
                      disabled={showCustomInput[String(qIndex)]}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-border hover:bg-muted/50'
                      } ${showCustomInput[String(qIndex)] ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-5 h-5 rounded ${
                            q.multiSelect ? 'rounded' : 'rounded-full'
                          } border-2 flex items-center justify-center ${
                            isSelected ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{option.label}</div>
                          {option.description && (
                            <div className="text-sm text-muted-foreground mt-1">
                              {option.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Other / Custom option */}
                <div className="border border-border rounded-lg">
                  <button
                    onClick={() => handleCustomInputToggle(qIndex)}
                    className="w-full p-3 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    {showCustomInput[String(qIndex)] ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span>Other (provide custom answer)</span>
                  </button>

                  {showCustomInput[String(qIndex)] && (
                    <div className="p-3 pt-0">
                      <textarea
                        value={customInputs[String(qIndex)] || ''}
                        onChange={(e) => handleCustomInputChange(qIndex, e.target.value)}
                        placeholder="Type your custom answer..."
                        className="w-full p-2 bg-muted/30 border border-border rounded text-sm resize-none"
                        rows={3}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Submit button */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
          >
            <Check className="h-5 w-5" />
            Submit Answers
          </button>
        </div>
      </div>
    </div>
  );
}
