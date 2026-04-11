import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2, FileText, Briefcase } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const PROJECT_TYPES = [
  'Website Redesign', 'Brand Identity', 'Logo Design', 'Marketing Campaign',
  'Social Media Strategy', 'Content Strategy', 'App Design', 'E-commerce',
  'SEO Optimization', 'Print Design'
];

export default function CreativeBriefGenerator() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [projectType, setProjectType] = useState('Website Redesign');
  const [notes, setNotes] = useState('');

  const { data: savedBriefs = [], isLoading } = useQuery({
    queryKey: ['creative-briefs'],
    queryFn: () => api.getCreativeBriefs(),
  });

  const generateMutation = useMutation({
    mutationFn: (data) => api.generateCreativeBrief(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creative-briefs'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteCreativeBrief(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creative-briefs'] }),
  });

  const handleGenerate = (e) => {
    e.preventDefault();
    generateMutation.mutate({
      clientId: clientId || undefined,
      projectType,
      notes,
    });
  };

  const brief = generateMutation.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Briefcase className="w-6 h-6 text-primary" />
          Creative Brief Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">AI-powered creative briefs with client context</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Generate Brief</h2>
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Client ID (optional)</label>
              <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="Enrich brief with client brain data"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Project Type</label>
              <select value={projectType} onChange={e => setProjectType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes / Requirements</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Describe the project goals, audience, constraints..."
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
            </div>
            <Button type="submit" loading={generateMutation.isPending} leftIcon={<Sparkles className="w-4 h-4" />}>
              Generate Brief
            </Button>
          </form>
        </Card>

        {/* Result */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Generated Brief</h2>
          {generateMutation.isPending ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
              Generating...
            </div>
          ) : brief?.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {brief.content}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">Fill in the form and click Generate</p>
            </div>
          )}
        </Card>
      </div>

      {/* Saved briefs */}
      {savedBriefs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Saved Briefs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {savedBriefs.slice(0, 9).map(b => (
              <Card key={b.id} className="p-4 cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => generateMutation.data !== b && null}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {b.projectType || b.project_type || 'Brief'}
                  </span>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this brief?')) deleteMutation.mutate(b.id); }}
                    className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-foreground line-clamp-3">{b.content?.substring(0, 150) || 'No content'}</p>
                <p className="text-xs text-muted-foreground mt-2">{new Date(b.createdAt || b.created_at).toLocaleDateString()}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}