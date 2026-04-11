import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Copy, CheckCircle, Trash2, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const PLATFORMS = ['Google', 'Facebook', 'Instagram', 'LinkedIn', 'Twitter'];
const TONES = ['professional', 'casual', 'urgent', 'friendly', 'luxurious', 'playful'];

export default function AdCopyGenerator() {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState('Google');
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('professional');
  const [keywords, setKeywords] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const { data: savedCopies = [], isLoading: loadingCopies } = useQuery({
    queryKey: ['ad-copies'],
    queryFn: () => api.getAdCopies(),
  });

  const generateMutation = useMutation({
    mutationFn: (data) => api.generateAdCopy(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ad-copies'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteAdCopy(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ad-copies'] }),
  });

  const handleGenerate = (e) => {
    e.preventDefault();
    if (!product.trim()) return;
    generateMutation.mutate({ platform, product, audience, tone, keywords: keywords.split(',').map(k => k.trim()).filter(Boolean) });
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const result = generateMutation.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Ad Copy Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Generate AI-powered ad copy for any platform</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input form */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Generate Ad Copy</h2>
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Platform</label>
              <select value={platform} onChange={e => setPlatform(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Product / Service</label>
              <input type="text" value={product} onChange={e => setProduct(e.target.value)}
                placeholder="e.g. Premium web design services"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Target Audience</label>
              <input type="text" value={audience} onChange={e => setAudience(e.target.value)}
                placeholder="e.g. Small business owners"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tone</label>
              <select value={tone} onChange={e => setTone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                {TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Keywords (comma-separated)</label>
              <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)}
                placeholder="e.g. design, agency, professional"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <Button type="submit" loading={generateMutation.isPending} leftIcon={<Sparkles className="w-4 h-4" />}>
              Generate
            </Button>
          </form>
        </Card>

        {/* Result */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Generated Copy</h2>
          {generateMutation.isPending ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mr-3" />
              Generating...
            </div>
          ) : result?.variants ? (
            <div className="space-y-4">
              {result.variants.map((variant, i) => (
                <div key={i} className="p-4 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">Variant {i + 1}</span>
                    <button onClick={() => handleCopy(variant.headline || variant.content, `v${i}`)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
                      {copiedId === `v${i}` ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  {variant.headline && (
                    <p className="font-semibold text-foreground mb-1">{variant.headline}</p>
                  )}
                  {variant.description && (
                    <p className="text-sm text-muted-foreground mb-1">{variant.description}</p>
                  )}
                  {variant.cta && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                      {variant.cta}
                    </span>
                  )}
                  {variant.content && !variant.headline && (
                    <p className="text-sm text-foreground whitespace-pre-wrap">{variant.content}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">Fill in the form and click Generate</p>
            </div>
          )}
        </Card>
      </div>

      {/* Saved copies */}
      {savedCopies.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Saved Copies</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {savedCopies.slice(0, 12).map(copy => (
              <Card key={copy.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {copy.platform || 'Ad'}
                  </span>
                  <button onClick={() => { if (confirm('Delete this ad copy?')) deleteMutation.mutate(copy.id); }}
                    className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm font-medium text-foreground line-clamp-2">{copy.product || copy.content}</p>
                {copy.audience && <p className="text-xs text-muted-foreground mt-1">{copy.audience}</p>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}