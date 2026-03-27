import { useState, useRef, useEffect } from 'react';
import { X, Send, Sparkles, Bot, User, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './ui';

export default function AIChatPanel({ 
  isOpen, 
  onClose, 
  context = {}, 
  position = 'bottom-right',
  initialMessage = ''
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load available AI agents
  useEffect(() => {
    if (isOpen) {
      api.getAIAgents().then(setAgents).catch(console.error);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Initialize with context if provided
  useEffect(() => {
    if (isOpen && context && Object.keys(context).length > 0) {
      const contextMessage = buildContextMessage(context);
      if (contextMessage) {
        setMessages([{
          id: 'context',
          role: 'system',
          content: contextMessage,
          timestamp: new Date().toISOString()
        }]);
      }
    }
  }, [isOpen, context]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle initial message
  useEffect(() => {
    if (initialMessage && isOpen && messages.length === 0) {
      handleSend(initialMessage);
    }
  }, [initialMessage, isOpen]);

  const buildContextMessage = (ctx) => {
    const parts = [];
    
    if (ctx.project) {
      parts.push(`Project: ${ctx.project.name} (${ctx.project.status})`);
      if (ctx.project.client) {
        parts.push(`Client: ${ctx.project.client.name}`);
      }
    }
    
    if (ctx.task) {
      parts.push(`Task: ${ctx.task.title} (${ctx.task.status}, ${ctx.task.priority})`);
    }
    
    if (ctx.client) {
      parts.push(`Client: ${ctx.client.name} (${ctx.client.status})`);
    }
    
    if (ctx.thread) {
      parts.push(`Thread: ${ctx.thread.subject} (${ctx.thread.priority})`);
    }
    
    if (ctx.page) {
      parts.push(`Current page: ${ctx.page}`);
    }
    
    return parts.length > 0 ? `Context:\n${parts.join('\n')}` : null;
  };

  const handleSend = async (text = input) => {
    if (!text.trim() || isLoading) return;

    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // If an agent is selected, use AI team chat
      if (selectedAgent) {
        const response = await api.chatWithAIAgent({
          agentRole: selectedAgent.role,
          message: text,
          clientId: context.client?.id,
          projectId: context.project?.id,
          history: messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'user' ? 'USER' : 'ASSISTANT',
            content: m.content
          }))
        });

        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response.response,
          agent: selectedAgent.name,
          timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Use general AI chat
        const response = await api.chatWithAI({
          message: text,
          context: buildContextMessage(context)
        });

        const assistantMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: response.message,
          timestamp: new Date().toISOString()
        };

        setMessages(prev => [...prev, assistantMessage]);
      }
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
    setInput(action);
    handleSend(action);
  };

  const positionClasses = {
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed ${positionClasses[position]} z-50 flex flex-col ${isExpanded ? 'w-[600px] h-[700px]' : 'w-[400px] h-[500px]'}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white rounded-t-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          <div>
            <h3 className="font-semibold">AI Assistant</h3>
            <p className="text-xs text-white/80">
              {selectedAgent ? `Talking to ${selectedAgent.name}` : 'General assistant'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-white/20 rounded"
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Agent Selector */}
      {agents.length > 0 && (
        <div className="bg-card border-x border-border px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setSelectedAgent(null)}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${!selectedAgent ? 'bg-primary text-white' : 'bg-muted hover:bg-muted/80'}`}
            >
              General
            </button>
            {agents.map(agent => (
              <button
                key={agent.role}
                onClick={() => setSelectedAgent(agent)}
                className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap ${selectedAgent?.role === agent.role ? 'bg-primary text-white' : 'bg-muted hover:bg-muted/80'}`}
              >
                {agent.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages Container */}
      <div className="flex-1 bg-background border-x border-border overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Sparkles className="w-12 h-12 text-muted-foreground mb-4" />
            <h4 className="font-medium text-foreground mb-2">AI Assistant</h4>
            <p className="text-sm text-muted-foreground mb-6">
              Ask me anything about your projects, clients, or tasks.
            </p>
            
            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
              <button
                onClick={() => handleQuickAction("What's my most urgent task?")}
                className="p-3 bg-card border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                Urgent tasks
              </button>
              <button
                onClick={() => handleQuickAction("Summarize active projects")}
                className="p-3 bg-card border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                Project summary
              </button>
              <button
                onClick={() => handleQuickAction("Which clients need follow-up?")}
                className="p-3 bg-card border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                Client follow-ups
              </button>
              <button
                onClick={() => handleQuickAction("Draft a status update")}
                className="p-3 bg-card border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                Draft update
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
              >
                {message.role !== 'user' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    {message.agent ? (
                      <Bot className="w-4 h-4 text-primary" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-primary" />
                    )}
                  </div>
                )}
                
                <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                  <div className={`rounded-2xl px-4 py-3 ${message.role === 'user' ? 'bg-primary text-white' : message.isError ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200' : 'bg-card border border-border'}`}>
                    <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                  </div>
                  
                  {message.agent && (
                    <div className="text-xs text-muted-foreground mt-1 ml-1">
                      {message.agent}
                    </div>
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
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-card border border-border rounded-2xl px-4 py-3">
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
      <div className="bg-card border border-border rounded-b-xl p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            rows="2"
            disabled={isLoading}
          />
          <Button
            onClick={() => handleSend()}
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
        
        {/* Context Info */}
        {context && Object.keys(context).length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Context: {buildContextMessage(context)?.replace(/\n/g, ' • ')}
          </div>
        )}
      </div>
    </div>
  );
}