import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import {
  FileText, Sparkles, Plus, Edit3, Trash2, Globe, Clock,
  Tag, Search, ChevronRight, Loader2, X, Eye, EyeOff
} from 'lucide-react';

const STATUS_COLORS = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  PUBLISHED: 'bg-green-100 text-green-700',
};

function GenerateModal({ onClose, onGenerated }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async (e) => {
    e.preventDefault();
    if (!title.trim() || !keyword.trim()) return;
    setLoading(true);
    try {
      const post = await api.generateBlogPost({ title, keyword, saveAsDraft: true });
      onGenerated(post);
      onClose();
    } catch (err) {
      toast.error('Failed to generate: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Generate Blog Post</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={generate} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Blog Title *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. How to Design Packaging for a DTC Supplement Brand"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Target Keyword *</label>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="e.g. supplement packaging design"
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">Gemini will write a 1500+ word SEO blog post optimized for this keyword. This may take 15–30 seconds.</p>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating 1500+ words...</> : <><Sparkles className="w-4 h-4" /> Generate with Gemini</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function KeywordsModal({ onClose }) {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    try {
      const result = await api.generateBlogKeywords(topic);
      setKeywords(result.keywords || []);
    } catch (err) {
      toast.error('Failed to generate keywords: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const DIFFICULTY_COLORS = { low: 'text-green-600', medium: 'text-yellow-600', high: 'text-red-600' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Keyword Research</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex gap-2 mb-4">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && generate()}
            placeholder="e.g. packaging design, CPG branding"
            className="flex-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button onClick={generate} disabled={loading || !topic.trim()}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Research
          </button>
        </div>

        {keywords && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {keywords.map((kw, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{kw.keyword}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{kw.intent}</span>
                    <span className={cn('text-xs font-medium', DIFFICULTY_COLORS[kw.difficulty] || 'text-muted-foreground')}>
                      {kw.difficulty}
                    </span>
                  </div>
                  {kw.notes && <p className="text-xs text-muted-foreground mt-0.5">{kw.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PostEditor({ post, onClose, onSaved }) {
  const toast = useToast();
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content || '');
  const [keyword, setKeyword] = useState(post.targetKeyword || '');
  const [metaDesc, setMetaDesc] = useState(post.metaDescription || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateBlogPost(post.id, { title, content, targetKeyword: keyword, metaDescription: metaDesc });
      onSaved(updated);
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!confirm('Publish this post to ashbi.ca WordPress?')) return;
    setPublishing(true);
    try {
      const updated = await api.publishBlogPost(post.id);
      onSaved(updated);
      onClose();
    } catch (err) {
      toast.error('Failed to publish: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card overflow-hidden">
      {/* Editor header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        <div className="flex-1">
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="w-full text-lg font-semibold bg-transparent border-0 focus:outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview(p => !p)}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
            {preview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
          {post.status !== 'PUBLISHED' && (
            <button onClick={publish} disabled={publishing}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50">
              {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
              Publish to WP
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 border-r border-border p-4 space-y-4 flex-shrink-0 overflow-y-auto">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Target Keyword</label>
            <input value={keyword} onChange={e => setKeyword(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 text-xs bg-muted rounded border-0 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Meta Description</label>
            <textarea value={metaDesc} onChange={e => setMetaDesc(e.target.value)} rows={3}
              className="w-full mt-1 px-2 py-1.5 text-xs bg-muted rounded border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
            <p className={cn('text-xs mt-1', metaDesc.length > 160 ? 'text-destructive' : 'text-muted-foreground')}>
              {metaDesc.length}/160
            </p>
          </div>
          <div>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[post.status])}>
              {post.status}
            </span>
          </div>
        </div>

        {/* Editor / Preview */}
        <div className="flex-1 overflow-y-auto">
          {preview ? (
            <div className="max-w-3xl mx-auto px-8 py-6 prose prose-sm">
              <h1>{title}</h1>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{content}</pre>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full h-full px-8 py-6 text-sm font-mono leading-relaxed bg-transparent border-0 focus:outline-none resize-none"
              placeholder="Start writing your blog post in Markdown..."
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function Blog() {
  const [showGenerate, setShowGenerate] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['blog-posts', statusFilter],
    queryFn: () => api.getBlogPosts(statusFilter ? { status: statusFilter } : {}),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteBlogPost,
    onSuccess: () => queryClient.invalidateQueries(['blog-posts']),
  });

  const openEditor = async (post) => {
    // Load full content
    try {
      const full = await api.getBlogPost(post.id);
      setEditingPost(full);
    } catch {
      setEditingPost(post);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary" /> Blog Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate, edit, and publish SEO blog posts for ashbi.ca</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowKeywords(true)}
            className="flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium hover:bg-muted/80">
            <Search className="w-4 h-4" /> Keywords
          </button>
          <button onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
            <Sparkles className="w-4 h-4" /> Generate Post
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['', 'DRAFT', 'PUBLISHED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1 text-xs rounded-full transition-colors',
              statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Posts list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No blog posts yet</p>
          <p className="text-sm">Generate your first SEO blog post</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map(post => (
            <div key={post.id} className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors group">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEditor(post)}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[post.status])}>
                      {post.status}
                    </span>
                    {post.targetKeyword && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Tag className="w-3 h-3" /> {post.targetKeyword}
                      </span>
                    )}
                    {post.wordpressPostId && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <Globe className="w-3 h-3" /> WordPress #{post.wordpressPostId}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold group-hover:text-primary transition-colors">{post.title}</h3>
                  {post.excerpt && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{post.excerpt}</p>
                  )}
                  {post.metaDescription && (
                    <p className="text-xs text-muted-foreground mt-1 italic truncate">Meta: {post.metaDescription}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {post.publishedAt
                      ? `Published ${new Date(post.publishedAt).toLocaleDateString()}`
                      : `Created ${new Date(post.createdAt).toLocaleDateString()}`
                    }
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEditor(post)}
                    className="p-2 text-muted-foreground hover:text-foreground transition-colors">
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm('Delete this post?')) deleteMutation.mutate(post.id); }}
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => queryClient.invalidateQueries(['blog-posts'])}
        />
      )}
      {showKeywords && (
        <KeywordsModal onClose={() => setShowKeywords(false)} />
      )}
      {editingPost && (
        <PostEditor
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => {
            queryClient.invalidateQueries(['blog-posts']);
            setEditingPost(null);
          }}
        />
      )}
    </div>
  );
}
