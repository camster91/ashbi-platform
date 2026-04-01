import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  FileText, Sparkles, X, Loader2, Check, Clock, Eye,
  ExternalLink, Trash2, CheckCircle, Send, PenSquare,
  Search, Tag
} from 'lucide-react';

const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', color: 'bg-gray-100 text-gray-600' },
  APPROVED: { label: 'Approved', color: 'bg-blue-100 text-blue-700' },
  PUBLISHED: { label: 'Published', color: 'bg-green-100 text-green-700' },
};

function GenerateBlogModal({ onClose, onGenerated }) {
  const [form, setForm] = useState({ topic: '', keywords: '', targetAudience: '', wordCount: 1200 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.seoBlogGenerateBlog(form);
      onGenerated();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to generate blog post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> SEO Blog Generator
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Topic</label>
            <input
              value={form.topic}
              onChange={e => setForm({ ...form, topic: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              placeholder="e.g. How to choose packaging that sells for DTC brands"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Target Keywords</label>
            <input
              value={form.keywords}
              onChange={e => setForm({ ...form, keywords: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              placeholder="e.g. DTC packaging design, CPG branding"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Target Audience</label>
              <input
                value={form.targetAudience}
                onChange={e => setForm({ ...form, targetAudience: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                placeholder="DTC brand founders"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Word Count</label>
              <select
                value={form.wordCount}
                onChange={e => setForm({ ...form, wordCount: parseInt(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              >
                <option value={800}>800 words</option>
                <option value={1000}>1,000 words</option>
                <option value={1200}>1,200 words</option>
                <option value={1500}>1,500 words</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !form.topic}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating (~30s)...</> : <><Sparkles className="w-4 h-4" /> Generate Blog Post</>}
          </button>
        </form>
      </div>
    </div>
  );
}

function PostPreviewModal({ post, onClose }) {
  if (!post) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-3xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{post.title}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        {post.metaDescription && (
          <div className="bg-muted rounded-lg p-3 mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-1">Meta Description:</p>
            <p className="text-sm">{post.metaDescription}</p>
          </div>
        )}
        {post.targetKeyword && (
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{post.targetKeyword}</span>
          </div>
        )}
        <div className="prose prose-sm max-w-none">
          <div dangerouslySetInnerHTML={{
            __html: (post.content || '')
              .replace(/^### (.*$)/gm, '<h3>$1</h3>')
              .replace(/^## (.*$)/gm, '<h2>$1</h2>')
              .replace(/^# (.*$)/gm, '<h1>$1</h1>')
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
              .replace(/\n/g, '<br />')
          }} />
        </div>
      </div>
    </div>
  );
}

export default function SeoBlog() {
  const queryClient = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);
  const [previewPost, setPreviewPost] = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['seo-blog-posts'],
    queryFn: () => api.seoBlogGetPosts(),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.seoBlogApprove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seo-blog-posts'] }),
  });

  const publishMutation = useMutation({
    mutationFn: (id) => api.seoBlogPublish(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seo-blog-posts'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.seoBlogDelete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seo-blog-posts'] }),
  });

  const fetchFullPost = async (id) => {
    const post = await api.seoBlogGetPost(id);
    setPreviewPost(post);
  };

  const drafts = posts.filter(p => p.status === 'DRAFT');
  const approved = posts.filter(p => p.status === 'APPROVED');
  const published = posts.filter(p => p.status === 'PUBLISHED');

  const filteredPosts = activeTab === 'all'
    ? posts
    : posts.filter(p => p.status === activeTab.toUpperCase());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <PenSquare className="w-6 h-6 text-primary" /> SEO Blog
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI blog post generator with WordPress publishing to ashbi.ca
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Generate Blog Post
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Posts</p>
          <p className="text-2xl font-bold">{posts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Drafts</p>
          <p className="text-2xl font-bold text-gray-600">{drafts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Approved</p>
          <p className="text-2xl font-bold text-blue-600">{approved.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Published</p>
          <p className="text-2xl font-bold text-green-600">{published.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'all', label: 'All Posts' },
          { key: 'draft', label: `Drafts (${drafts.length})` },
          { key: 'approved', label: `Approved (${approved.length})` },
          { key: 'published', label: `Published (${published.length})` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Posts Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No blog posts yet. Generate one to get started.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Keyword</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPosts.map(post => (
                <tr key={post.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => fetchFullPost(post.id)}
                      className="text-sm font-medium text-foreground hover:text-primary text-left"
                    >
                      {post.title}
                    </button>
                    {post.excerpt && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{post.excerpt}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {post.targetKeyword && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        {post.targetKeyword}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_CONFIG[post.status]?.color)}>
                      {STATUS_CONFIG[post.status]?.label || post.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(post.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => fetchFullPost(post.id)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {post.status === 'DRAFT' && (
                        <button
                          onClick={() => approveMutation.mutate(post.id)}
                          className="p-1.5 text-muted-foreground hover:text-blue-600 rounded hover:bg-muted"
                          title="Approve"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                      {(post.status === 'DRAFT' || post.status === 'APPROVED') && (
                        <button
                          onClick={() => publishMutation.mutate(post.id)}
                          className="p-1.5 text-muted-foreground hover:text-green-600 rounded hover:bg-muted"
                          title="Publish to WordPress"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      {post.wordpressPostId && (
                        <span className="p-1.5 text-green-600" title="On WordPress">
                          <ExternalLink className="w-4 h-4" />
                        </span>
                      )}
                      <button
                        onClick={() => deleteMutation.mutate(post.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showGenerate && (
        <GenerateBlogModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['seo-blog-posts'] })}
        />
      )}
      {previewPost && (
        <PostPreviewModal
          post={previewPost}
          onClose={() => setPreviewPost(null)}
        />
      )}
    </div>
  );
}
