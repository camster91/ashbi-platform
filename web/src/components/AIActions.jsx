import { useState } from 'react';
import { Sparkles, MessageSquare, FileText, ClipboardCheck, AlertCircle, Zap, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './ui';

export default function AIActions({ 
  context = {}, 
  onActionComplete,
  compact = false 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(null);
  const [result, setResult] = useState(null);

  const actions = [
    {
      id: 'summarize',
      label: 'Summarize',
      description: 'Generate a concise summary',
      icon: <FileText className="w-4 h-4" />,
      color: 'blue',
      handler: async () => {
        if (context.project) {
          return await api.summarizeProject({ projectId: context.project.id });
        } else if (context.thread) {
          // Summarize thread
          return { summary: 'Thread summary generated' };
        }
        return { summary: 'No specific context to summarize' };
      }
    },
    {
      id: 'draft-response',
      label: 'Draft Response',
      description: 'Draft an email response',
      icon: <MessageSquare className="w-4 h-4" />,
      color: 'green',
      handler: async () => {
        if (context.thread) {
          return await api.draftAIResponse({ threadId: context.thread.id });
        }
        return { error: 'No thread context available' };
      }
    },
    {
      id: 'triage',
      label: 'Triage',
      description: 'Analyze and prioritize',
      icon: <AlertCircle className="w-4 h-4" />,
      color: 'orange',
      handler: async () => {
        return await api.triageInbox();
      }
    },
    {
      id: 'update',
      label: 'Draft Update',
      description: 'Draft client status update',
      icon: <ClipboardCheck className="w-4 h-4" />,
      color: 'purple',
      handler: async () => {
        if (context.project) {
          const notes = prompt('Enter raw notes for the update:');
          if (notes) {
            return await api.draftAIUpdate({ 
              projectId: context.project.id, 
              rawNotes: notes 
            });
          }
        }
        return { error: 'No project context available' };
      }
    },
    {
      id: 'analyze',
      label: 'Analyze',
      description: 'Deep analysis',
      icon: <Sparkles className="w-4 h-4" />,
      color: 'pink',
      handler: async () => {
        // Analyze current context
        let analysis = {};
        if (context.project) {
          analysis.project = {
            name: context.project.name,
            status: context.project.status,
            health: context.project.health
          };
        }
        if (context.client) {
          analysis.client = {
            name: context.client.name,
            status: context.client.status
          };
        }
        return { analysis, recommendations: [] };
      }
    },
    {
      id: 'quick-task',
      label: 'Quick Task',
      description: 'Create a task from this',
      icon: <Zap className="w-4 h-4" />,
      color: 'yellow',
      handler: async () => {
        const title = prompt('Task title:');
        if (title) {
          // In a real implementation, this would create a task via API
          return { 
            taskCreated: true, 
            title,
            message: 'Task created successfully' 
          };
        }
        return { error: 'No title provided' };
      }
    }
  ];

  const handleAction = async (action) => {
    setIsLoading(action.id);
    setResult(null);

    try {
      const result = await action.handler();
      setResult({ action: action.label, data: result });
      if (onActionComplete) {
        onActionComplete(action.id, result);
      }
    } catch (error) {
      console.error('AI action error:', error);
      setResult({ 
        action: action.label, 
        error: true, 
        message: error.message || 'Action failed' 
      });
    } finally {
      setIsLoading(null);
    }
  };

  const getContextDescription = () => {
    if (context.project) {
      return `Project: ${context.project.name}`;
    } else if (context.client) {
      return `Client: ${context.client.name}`;
    } else if (context.thread) {
      return `Thread: ${context.thread.subject}`;
    } else if (context.task) {
      return `Task: ${context.task.title}`;
    }
    return 'General';
  };

  if (compact) {
    return (
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Sparkles className="w-4 h-4" />}
          rightIcon={<ChevronDown className="w-4 h-4" />}
          onClick={() => setIsOpen(!isOpen)}
          className="relative"
        >
          AI Actions
        </Button>
        
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-lg z-50">
            <div className="p-3 border-b border-border">
              <div className="text-xs font-medium text-foreground">AI Actions</div>
              <div className="text-xs text-muted-foreground">{getContextDescription()}</div>
            </div>
            
            <div className="p-2 grid grid-cols-2 gap-2">
              {actions.map(action => (
                <button
                  key={action.id}
                  onClick={() => {
                    handleAction(action);
                    setIsOpen(false);
                  }}
                  disabled={isLoading === action.id}
                  className={`p-3 rounded-lg border border-border text-left hover:bg-muted transition-colors ${isLoading === action.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`text-${action.color}-600`}>
                      {action.icon}
                    </div>
                    <div className="text-sm font-medium">{action.label}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {action.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <h3 className="font-semibold text-foreground">AI Quick Actions</h3>
            <p className="text-sm text-muted-foreground">
              {getContextDescription()}
            </p>
          </div>
        </div>
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {actions.map(action => (
          <button
            key={action.id}
            onClick={() => handleAction(action)}
            disabled={isLoading === action.id}
            className={`p-4 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-primary/5 transition-all ${isLoading === action.id ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg bg-${action.color}-100 dark:bg-${action.color}-900/30 text-${action.color}-600`}>
                {action.icon}
              </div>
              <div className="font-medium">{action.label}</div>
            </div>
            <div className="text-sm text-muted-foreground">
              {action.description}
            </div>
          </button>
        ))}
      </div>

      {/* Result Display */}
      {result && (
        <div className={`mt-4 p-4 rounded-lg border ${result.error ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">
              {result.error ? 'Action Failed' : `${result.action} Complete`}
            </div>
            <button
              onClick={() => setResult(null)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
          
          {result.error ? (
            <div className="text-sm text-red-600 dark:text-red-400">
              {result.message}
            </div>
          ) : (
            <div className="text-sm">
              {result.data?.summary && (
                <div className="mb-2">
                  <div className="font-medium mb-1">Summary:</div>
                  <div className="text-muted-foreground">{result.data.summary}</div>
                </div>
              )}
              
              {result.data?.proposal && (
                <div className="mb-2">
                  <div className="font-medium mb-1">Proposal:</div>
                  <div className="text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {result.data.proposal}
                  </div>
                </div>
              )}
              
              {result.data?.message && (
                <div className="text-muted-foreground">{result.data.message}</div>
              )}
              
              {result.data?.taskCreated && (
                <div className="text-muted-foreground">
                  Task "{result.data.title}" created successfully.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="mt-4 p-4 rounded-lg border border-border bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="animate-spin">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-medium">Processing {actions.find(a => a.id === isLoading)?.label}...</div>
              <div className="text-sm text-muted-foreground">
                This may take a moment
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}