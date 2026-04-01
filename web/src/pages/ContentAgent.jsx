import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  FileText, Sparkles, Loader2, X, Check, Trash2, Edit3,
  Linkedin, Instagram, Facebook, ChevronRight, Clock, Eye, EyeOff
} from 'lucide-react';

const TYPE_LABELS = { BLOG: 'Blog Post', SOCIAL: 'Social Caption', LINKEDIN_ARTICLE: 'LinkedIn Article' };
const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  PUBLISHED: 'bg-blue-100 text-blue-700',
};
const PLATFORM_ICONS = { LINKEDIN: Linkedin, INSTAGRAM: Instagram, FACEBOOK: Facebook };

function BlogGenerator({ onClose, onGenerated }) {
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    try {
      await api.generateContentBlog({ topic, keywords });
      onGenerated();
      onClose();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Generate Blog Post</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Topic *</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. CPG packaging trends for 2026" required
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Keywords</label>
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="e.g. CPG packaging, DTC branding"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate Blog Post</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function SocialGenerator({ onClose, onGenerated }) {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!brief.trim()) return;
    setLoading(true);
    try {
      await api.generateContentSocial({ brief });
      onGenerated();
      onClose();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Generate Social Captions</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Brief *</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3} required
              placeholder="Describe what you want to post about..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>
          <p className="text-xs text-muted-foreground">Generates captions for LinkedIn, Instagram, and Facebook.</p>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate Captions</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function LinkedInGenerator({ onClose, onGenerated }) {
  const [topic, setTopic] = useState('');
  const [angle, setAngle] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setLoading(true);
    try {
      await api.generateContentLinkedIn({ topic, angle });
      onGenerated();
      onClose();
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Linkedin className="w-5 h-5 text-primary" /><h2 className="text-lg font-semibold">Generate LinkedIn Article</h2></div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Topic *</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Why DTC brands need custom packaging" required
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Angle</label>
            <input value={angle} onChange={e => setAngle(e.target.value)} placeholder="e.g. lessons from working with 50+ brands"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Linkedin className="w-4 h-4" /> Generate Article</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function ContentEditor({ draft, onClose, onSaved }) {
  const [title, setTitle] = useState(draft.title || '');
  const [content, setContent] = useState(draft.content || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateContentDraft(draft.id, { title, content });
      onSaved();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    try {
      await api.updateContentDraft(draft.id, { title, content, status: 'APPROVED' });
      onSaved();
      onClose();
    } catch (err) {
      alert('Approve failed: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        <div className="flex-1">
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full text-lg font-semibold bg-transparent border-0 focus:outline-none" placeholder="Title..." />
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[draft.status])}>{draft.status}</span>
        <span className="text-xs text-muted-foreground">{TYPE_LABELS[draft.type]}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview(p => !p)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted">
            {preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
          {draft.status === 'DRAFT' && (
            <button onClick={approve}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {preview ? (
          <div className="max-w-3xl mx-auto px-8 py-6 prose prose-sm">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{content}</pre>
          </div>
        ) : (
          <textarea value={content} onChange={e => setContent(e.target.value)}
            className="w-full h-full px-8 py-6 text-sm font-mono leading-relaxed bg-transparent border-0 focus:outline-none resize-none"
            placeholder="Content..." />
        )}
      </div>
    </div>
  );
}

export default function ContentAgent() {
  const [activeTab, setActiveTab] = useState('BLOG');
  const [showBlogGen, setShowBlogGen] = useState(false);
  const [showSocialGen, setShowSocialGen] = useState(false);
  const [showLinkedInGen, setShowLinkedInGen] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const queryClient = useQueryClient();

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ['content-drafts', activeTab],
    queryFn: () => api.getContentDrafts({ type: activeTab }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteContentDraft,
    onSuccess: () => queryClient.invalidateQueries(['content-drafts']),
  });

  const openEditor = async (draft) => {
    try {
      const full = await api.getContentDraft(draft.id);
      setEditingDraft(full);
    } catch {
      setEditingDraft(draft);
    }
  };

  const tabs = [
    { key: 'BLOG', label: 'Blog Posts', icon: FileText },
    { key: 'SOCIAL', label: 'Social Captions', icon: Instagram },
    { key: 'LINKEDIN_ARTICLE', label: 'LinkedIn Articles', icon: Linkedin },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary" /> Content Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate blog posts, social captions, and LinkedIn articles</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'BLOG' && (
            <button onClick={() => setShowBlogGen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Sparkles className="w-4 h-4" /> Generate Blog
            </button>
          )}
          {activeTab === 'SOCIAL' && (
            <button onClick={() => setShowSocialGen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Sparkles className="w-4 h-4" /> Generate Social
            </button>
          )}
          {activeTab === 'LINKEDIN_ARTICLE' && (
            <button onClick={() => setShowLinkedInGen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
              <Sparkles className="w-4 h-4" /> Generate Article
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors flex-1 justify-center',
              activeTab === tab.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Drafts list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : drafts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No {TYPE_LABELS[activeTab]?.toLowerCase() || 'content'} drafts yet</p>
          <p className="text-sm">Generate your first piece of content</p>
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map(draft => {
            const PlatformIcon = PLATFORM_ICONS[draft.platform] || FileText;
            return (
              <div key={draft.id} className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors group">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEditor(draft)}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[draft.status])}>{draft.status}</span>
                      {draft.platform && <PlatformIcon className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                    <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">{draft.title || draft.brief}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{draft.content?.substring(0, 150)}...</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" /> {new Date(draft.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEditor(draft)} className="p-2 text-muted-foreground hover:text-foreground"><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => { if (confirm('Delete?')) deleteMutation.mutate(draft.id); }}
                      className="p-2 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showBlogGen && <BlogGenerator onClose={() => setShowBlogGen(false)} onGenerated={() => queryClient.invalidateQueries(['content-drafts'])} />}
      {showSocialGen && <SocialGenerator onClose={() => setShowSocialGen(false)} onGenerated={() => queryClient.invalidateQueries(['content-drafts'])} />}
      {showLinkedInGen && <LinkedInGenerator onClose={() => setShowLinkedInGen(false)} onGenerated={() => queryClient.invalidateQueries(['content-drafts'])} />}
      {editingDraft && <ContentEditor draft={editingDraft} onClose={() => setEditingDraft(null)} onSaved={() => { queryClient.invalidateQueries(['content-drafts']); setEditingDraft(null); }} />}
    </div>
  );
}
