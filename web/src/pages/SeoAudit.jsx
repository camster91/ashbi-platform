import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Globe, Shield, Smartphone, Heading, Image, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

export default function SeoAudit() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [clientId, setClientId] = useState('');

  const { data: savedAudits = [], isLoading: loadingAudits } = useQuery({
    queryKey: ['seo-audits'],
    queryFn: () => api.getSeoAudits(),
  });

  const auditMutation = useMutation({
    mutationFn: (data) => api.runSeoAudit(data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteSeoAudit(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seo-audits'] }),
  });

  const [selectedAudit, setSelectedAudit] = useState(null);
  const audit = selectedAudit || auditMutation.data;

  const handleAudit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    auditMutation.mutate(
      { url, clientId: clientId || undefined },
      { onSuccess: (data) => setSelectedAudit(data) }
    );
  };

  const pageAnalysis = audit?.pageAnalysis || audit?.page_analysis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Search className="w-6 h-6 text-primary" />
          SEO Audit
        </h1>
        <p className="text-sm text-muted-foreground mt-1">AI-powered SEO analysis and recommendations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Audit Form */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Run Audit</h2>
            <form onSubmit={handleAudit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Website URL</label>
                <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Client ID (optional)</label>
                <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
                  placeholder="Associate with client"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
              </div>
              <Button type="submit" loading={auditMutation.isPending} className="w-full" leftIcon={<Globe className="w-4 h-4" />}>
                Run Audit
              </Button>
            </form>
          </Card>

          {/* Recent Audits */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Recent Audits</h3>
            {loadingAudits ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
            ) : savedAudits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audits yet</p>
            ) : (
              <div className="space-y-2">
                {savedAudits.slice(0, 5).map(a => (
                  <button key={a.id} onClick={() => setSelectedAudit(a)}
                    className="w-full text-left p-2 rounded-lg hover:bg-muted transition-colors">
                    <p className="text-sm font-medium text-foreground truncate">{a.url}</p>
                    <p className="text-xs text-muted-foreground">{new Date(a.createdAt || a.created_at).toLocaleDateString()}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {auditMutation.isPending ? (
            <Card className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Analyzing website SEO...</p>
            </Card>
          ) : audit ? (
            <>
              {/* Page Analysis */}
              {pageAnalysis && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card className="p-4 text-center">
                    <Shield className={`w-6 h-6 mx-auto mb-2 ${pageAnalysis.https ? 'text-emerald-500' : 'text-red-400'}`} />
                    <p className="text-xs text-muted-foreground">HTTPS</p>
                    <p className={`text-lg font-bold ${pageAnalysis.https ? 'text-emerald-500' : 'text-red-400'}`}>
                      {pageAnalysis.https ? 'Yes' : 'No'}
                    </p>
                  </Card>
                  <Card className="p-4 text-center">
                    <Smartphone className={`w-6 h-6 mx-auto mb-2 ${pageAnalysis.mobile ? 'text-emerald-500' : 'text-red-400'}`} />
                    <p className="text-xs text-muted-foreground">Mobile</p>
                    <p className={`text-lg font-bold ${pageAnalysis.mobile ? 'text-emerald-500' : 'text-red-400'}`}>
                      {pageAnalysis.mobile ? 'Ready' : 'Poor'}
                    </p>
                  </Card>
                  <Card className="p-4 text-center">
                    <Heading className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-xs text-muted-foreground">H1 Tags</p>
                    <p className="text-lg font-bold">{pageAnalysis.h1Count ?? pageAnalysis.h1_count ?? 0}</p>
                  </Card>
                  <Card className="p-4 text-center">
                    <Image className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-xs text-muted-foreground">Images</p>
                    <p className="text-lg font-bold">{pageAnalysis.imageCount ?? pageAnalysis.image_count ?? 0}</p>
                  </Card>
                </div>
              )}

              {/* AI Recommendations */}
              {(audit.aiRecommendations || audit.ai_recommendations) && (
                <Card className="p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    AI Recommendations
                  </h2>
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                    {audit.aiRecommendations || audit.ai_recommendations}
                  </div>
                </Card>
              )}

              {/* Audit meta */}
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="w-4 h-4" />
                    {audit.url}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    audit.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {audit.status || 'completed'}
                  </span>
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-12 text-center">
              <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-muted-foreground">Enter a URL and click Run Audit to get started</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}