import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Palette,
  Code2,
  ClipboardList,
  Megaphone,
  Handshake,
  Scale,
  Sparkles,
  Send,
  Loader2,
  ChevronLeft,
  Bot,
} from 'lucide-react';

const ICON_MAP = {
  Palette,
  Code2,
  ClipboardList,
  Megaphone,
  HandshakeIcon: Handshake,
  Scale,
  Sparkles,
};

const COLOR_MAP = {
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30', ring: 'ring-blue-500/20', bubble: 'bg-blue-500/10 border-blue-500/20', solid: 'bg-blue-500' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/30', ring: 'ring-purple-500/20', bubble: 'bg-purple-500/10 border-purple-500/20', solid: 'bg-purple-500' },
  green: { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/30', ring: 'ring-green-500/20', bubble: 'bg-green-500/10 border-green-500/20', solid: 'bg-green-500' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30', ring: 'ring-orange-500/20', bubble: 'bg-orange-500/10 border-orange-500/20', solid: 'bg-orange-500' },
  yellow: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/30', ring: 'ring-yellow-500/20', bubble: 'bg-yellow-500/10 border-yellow-500/20', solid: 'bg-yellow-500' },
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/30', ring: 'ring-slate-500/20', bubble: 'bg-slate-500/10 border-slate-500/20', solid: 'bg-slate-500' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-500', border: 'border-pink-500/30', ring: 'ring-pink-500/20', bubble: 'bg-pink-500/10 border-pink-500/20', solid: 'bg-pink-500' },
};

export default function AiTeam() {
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [message, setMessage] = useState('');
  const [localMessages, setLocalMessages] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const { data: agents = [] } = useQuery({
    queryKey: ['ai-team-agents'],
    queryFn: () => api.getAiTeamAgents(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['ai-team-history', selectedAgent?.role],
    queryFn: () => api.getAiTeamHistory(selectedAgent.role),
    enabled: !!selectedAgent,
  });

  // Sync history into local messages when agent changes
  useEffect(() => {
    if (history.length > 0) {
      setLocalMessages(history.map(h => ({ role: h.role, content: h.content })));
    } else {
      setLocalMessages([]);
    }
  }, [history]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  // Focus input when agent selected
  useEffect(() => {
    if (selectedAgent) inputRef.current?.focus();
  }, [selectedAgent]);

  const chatMutation = useMutation({
    mutationFn: (payload) => api.aiTeamChat(payload),
    onSuccess: (data) => {
      setLocalMessages(prev => [...prev, { role: 'ASSISTANT', content: data.response }]);
      queryClient.invalidateQueries({ queryKey: ['ai-team-history', selectedAgent?.role] });
    },
  });

  const handleSend = (text) => {
    const msg = text || message.trim();
    if (!msg || chatMutation.isPending) return;

    setLocalMessages(prev => [...prev, { role: 'USER', content: msg }]);
    setMessage('');

    chatMutation.mutate({
      agentRole: selectedAgent.role,
      message: msg,
      clientId: selectedClientId || undefined,
      projectId: selectedProjectId || undefined,
      history: localMessages.slice(-20),
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const colors = selectedAgent ? COLOR_MAP[selectedAgent.color] : null;
  const AgentIcon = selectedAgent ? ICON_MAP[selectedAgent.icon] : null;

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-4">
      {/* Left Panel — Agent Cards */}
      <div className={cn(
        'w-80 flex-shrink-0 space-y-3 overflow-y-auto pr-2',
        selectedAgent && 'hidden lg:block'
      )}>
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-heading font-bold">AI Team</h1>
        </div>
        {agents.map((agent) => {
          const c = COLOR_MAP[agent.color];
          const Icon = ICON_MAP[agent.icon];
          const isActive = selectedAgent?.role === agent.role;
          return (
            <button
              key={agent.role}
              onClick={() => { setSelectedAgent(agent); setLocalMessages([]); }}
              className={cn(
                'w-full text-left p-4 rounded-xl border transition-all duration-200',
                isActive
                  ? `${c.bg} ${c.border} ring-2 ${c.ring}`
                  : 'bg-card border-border hover:border-muted-foreground/30'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', c.bg)}>
                  {Icon && <Icon className={cn('w-5 h-5', c.text)} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">{agent.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{agent.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Right Panel — Chat */}
      <div className={cn(
        'flex-1 flex flex-col bg-card rounded-xl border border-border overflow-hidden',
        !selectedAgent && 'hidden lg:flex items-center justify-center'
      )}>
        {!selectedAgent ? (
          <div className="text-center text-muted-foreground">
            <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select an agent to start chatting</p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className={cn('flex items-center gap-3 px-4 py-3 border-b border-border')}>
              <button
                onClick={() => setSelectedAgent(null)}
                className="lg:hidden p-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', colors.bg)}>
                {AgentIcon && <AgentIcon className={cn('w-4 h-4', colors.text)} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{selectedAgent.name}</p>
                <p className="text-xs text-muted-foreground">{selectedAgent.description}</p>
              </div>
              {/* Context dropdowns */}
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="text-xs bg-muted border-0 rounded-lg px-2 py-1.5 text-foreground max-w-[140px]"
              >
                <option value="">No client</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="text-xs bg-muted border-0 rounded-lg px-2 py-1.5 text-foreground max-w-[140px]"
              >
                <option value="">No project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {localMessages.length === 0 && (
                <div className="text-center py-8">
                  <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4', colors.bg)}>
                    {AgentIcon && <AgentIcon className={cn('w-8 h-8', colors.text)} />}
                  </div>
                  <p className="font-semibold mb-1">{selectedAgent.name}</p>
                  <p className="text-sm text-muted-foreground mb-6">{selectedAgent.description}</p>
                  {/* Quick Actions */}
                  <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
                    {selectedAgent.quickActions?.map((action) => (
                      <button
                        key={action}
                        onClick={() => handleSend(action)}
                        className={cn(
                          'px-3 py-1.5 text-xs rounded-full border transition-colors',
                          colors.border, 'hover:' + colors.bg, colors.text
                        )}
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {localMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'USER' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
                    msg.role === 'USER'
                      ? 'bg-primary text-primary-foreground'
                      : `border ${colors.bubble}`
                  )}>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}

              {chatMutation.isPending && (
                <div className="flex justify-start">
                  <div className={cn('rounded-2xl px-4 py-2.5 border', colors.bubble)}>
                    <Loader2 className={cn('w-4 h-4 animate-spin', colors.text)} />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${selectedAgent.name}...`}
                  rows={1}
                  className="flex-1 resize-none bg-muted rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground"
                  style={{ maxHeight: '120px' }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!message.trim() || chatMutation.isPending}
                  className={cn(
                    'p-2.5 rounded-xl transition-colors',
                    message.trim()
                      ? `${colors.solid} text-white hover:opacity-90`
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
