import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, Sparkles, Copy, CheckCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './ui';

export default function TaskAIChat({ task, project, client }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('PROJECT_MANAGER');
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const messagesEndRef = useRef(null);

  // Load available AI agents
  useEffect(() => {
    api.getAIAgents().then(setAgents).catch(console.error);
  }, []);

  // Initialize with task context
  useEffect(() => {
    if (task) {
      const contextMessage = {
        id: 'context',
        role: 'system',
        content: `Task Context:
- Task: ${task.title}
- Status: ${task.status}
- Priority: ${task.priority}
- Due: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}
- Description: ${task.description || 'No description'}
${project ? `- Project: ${project.name} (${project.status})` : ''}
${client ? `- Client: ${client.name}` : ''}`,
        timestamp: new Date().toISOString()
      };
      setMessages([contextMessage]);
    }
  }, [task, project, client]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await api.chatWithAIAgent({
        agentRole: selectedAgent,
        message: input,
        clientId: client?.id,
        projectId: project?.id,
        taskId: task?.id,
        history: messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'user' ? 'USER' : 'ASSISTANT',
            content: m.content
          }))
      });

      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        agent: agents.find(a => a.role === selectedAgent)?.name || selectedAgent,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('AI chat error:', error);
      
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        isError: true,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action) => {
    const actions = {
      'Update status': `Update the status for task "${task.title}". Current status is ${task.status}. What should the next status be and why?`,
      'Break down': `Break down task "${task.title}" into smaller subtasks.`,
      'Estimate time': `Estimate time required for task "${task.title}".`,
      'Draft update': `Draft a status update about task "${task.title}" for the client.`,
      'Identify blockers': `Identify potential blockers for task "${task.title}".`,
      'Suggest resources': `Suggest resources needed for task "${task.title}".`
    };
    
    setInput(actions[action] || action);
  };

  const copyToClipboard = async (text, messageId) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const taskQuickActions = [
    'Update status',
    'Break down',
    'Estimate time',
    'Draft update',
    'Identify blockers',
    'Suggest resources'
  ];

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 to-primary/5 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-semibold text-foreground">Task AI Assistant</h3>
              <p className="text-xs text-muted-foreground">
                Get help with this task
              </p>
            </div>
          </div>
          
          {/* Agent Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Assistant:</span>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {agents.map(agent => (
                <option key={agent.role} value={agent.role}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {taskQuickActions.map(action => (
            <button
              key={action}
              onClick={() => handleQuickAction(action)}
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg hover:bg-muted transition-colors"
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Messages Container */}
      <div className="h-96 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Sparkles className="w-12 h-12 text-muted-foreground mb-4" />
            <h4 className="font-medium text-foreground mb-2">Task AI Assistant</h4>
            <p className="text-sm text-muted-foreground">
              Ask for help with this task. I can help break it down, estimate time, draft updates, and more.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
              >
                {message.role !== 'user' && message.role !== 'system' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                
                <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                  {message.role === 'system' ? (
                    <div className="text-xs text-muted-foreground italic p-2 bg-muted rounded">
                      Context loaded: {message.content.split('\n')[0]}
                    </div>
                  ) : (
                    <>
                      <div className={`rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-primary text-white' : message.isError ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200' : 'bg-background border border-border'}`}>
                        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                      </div>
                      
                      {message.agent && (
                        <div className="flex items-center justify-between mt-1">
                          <div className="text-xs text-muted-foreground ml-1">
                            {message.agent}
                          </div>
                          <button
                            onClick={() => copyToClipboard(message.content, message.id)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            {copiedMessageId === message.id ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-background border border-border rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this task..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            rows="2"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        
        {/* Task Info */}
        {task && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-4">
            <span>Task: <span className="font-medium">{task.title}</span></span>
            <span>Status: <span className="font-medium">{task.status}</span></span>
            <span>Priority: <span className="font-medium">{task.priority}</span></span>
          </div>
        )}
      </div>
    </div>
  );
}