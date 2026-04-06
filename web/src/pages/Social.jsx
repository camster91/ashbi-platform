import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Instagram, Linkedin, Facebook, Sparkles, Plus, Edit3, Trash2,
  Calendar, CheckCircle, Clock, FileText, Loader2, X, Share2
} from 'lucide-react';

const PLATFORM_ICONS = {
  INSTAGRAM: Instagram,
  LINKEDIN: Linkedin,
  FACEBOOK: Facebook,
};

const PLATFORM_COLORS = {
  INSTAGRAM: 'text-pink-500 bg-pink-50',
  LINKEDIN: 'text-blue-600 bg-blue-50',
  FACEBOOK: 'text-blue-500 bg-blue-50',
};

const STATUS_COLORS = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-yellow-100 text-yellow-700',
  PUBLISHED: 'bg-green-100 text-green-700',
};

function GenerateModal({ onClose, onSaved }) {
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState('INSTAGRAM');
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setGenerated(null);
    try {
      const result = await api.generateSocialPost({ topic, platform });
      setGenerated(result);
    } catch (err) {
      alert('Failed to generate: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!generated) return;
    setSaving(true);
    try {
      const post = await api.saveSocialPost({
        platform,
        content: generated.content,
        imagePrompt: generated.imagePrompt,
        status: 'DRAFT',
      });
      onSaved(post);
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Generate Social Post</h2>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Platform</label>
            <div className="flex gap-2 mt-1">
              {['INSTAGRAM', 'LINKEDIN', 'FACEBOOK'].map(p => {
                const Icon = PLATFORM_ICONS[p];
                return (
                  <button key={p} onClick={() => setPlatform(p)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      platform === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}>
                    <Icon className="w-3.5 h-3.5" /> {p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Topic / Prompt</label>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generate()}
              placeholder="e.g. packaging design trends for supplements, brand refresh tips..."
              className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <button onClick={generate} disabled={loading || !topic.trim()}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate with Gemini</>}
          </button>

          {generated && (
            <div className="space-y-3 pt-2 border-t border-border">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Generated Content</label>
                <textarea
                  value={generated.content}
                  onChange={e => setGenerated(g => ({ ...g, content: e.target.value }))}
                  rows={6}
                  className="w-full mt-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>
              {generated.imagePrompt && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Image Idea</label>
                  <p className="mt-1 text-xs text-muted-foreground italic">{generated.imagePrompt}</p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={save} disabled={saving}
                  className="flex-1 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save as Draft
                </button>
                <button onClick={generate} disabled={loading}
                  className="py-2 px-3 text-sm text-muted-foreground hover:text-foreground">
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PostCard({ post, onEdit, onDelete, onPublish }) {
  const Icon = PLATFORM_ICONS[post.platform] || Share2;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('p-1.5 rounded-lg', PLATFORM_COLORS[post.platform])}>
            <Icon className="w-4 h-4" />
          </span>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[post.status])}>
            {post.status}
          </span>
        </div>
        <div className="flex gap-1">
          {post.status === 'DRAFT' && (
            <button onClick={() => onPublish(post)} title="Mark as published"
              className="p-1 text-muted-foreground hover:text-green-600 transition-colors">
              <CheckCircle className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => onEdit(post)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <Edit3 className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(post.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="text-sm text-foreground leading-relaxed line-clamp-4">{post.content}</p>

      {post.imagePrompt && (
        <p className="text-xs text-muted-foreground italic truncate">📸 {post.imagePrompt}</p>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Calendar className="w-3.5 h-3.5" />
        {post.scheduledAt
          ? `Scheduled: ${new Date(post.scheduledAt).toLocaleDateString()}`
          : post.publishedAt
          ? `Published: ${new Date(post.publishedAt).toLocaleDateString()}`
          : `Created: ${new Date(post.createdAt).toLocaleDateString()}`
        }
      </div>
    </div>
  );
}

function EditModal({ post, onClose, onSaved }) {
  const [content, setContent] = useState(post.content);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSocialPost(post.id, { content });
      onSaved(updated);
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Post</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={8}
          className="w-full px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Social() {
  const [showGenerate, setShowGenerate] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [platformFilter, setPlatformFilter] = useState('');
  const queryClient = useQueryClient();

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['social-posts', platformFilter],
    queryFn: () => api.getSocialPosts(platformFilter ? { platform: platformFilter } : {}),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteSocialPost,
    onSuccess: () => queryClient.invalidateQueries(['social-posts']),
  });

  const publishMutation = useMutation({
    mutationFn: (post) => api.updateSocialPost(post.id, { status: 'PUBLISHED' }),
    onSuccess: () => queryClient.invalidateQueries(['social-posts']),
  });

  const grouped = {
    DRAFT: posts.filter(p => p.status === 'DRAFT'),
    SCHEDULED: posts.filter(p => p.status === 'SCHEDULED'),
    PUBLISHED: posts.filter(p => p.status === 'PUBLISHED'),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
            <Share2 className="w-7 h-7 text-primary" /> Social Agent
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Generate and manage social content for Ashbi Design</p>
        </div>
        <button onClick={() => setShowGenerate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
          <Sparkles className="w-4 h-4" /> Generate Post
        </button>
      </div>

      {/* Platform filter */}
      <div className="flex gap-2 flex-wrap">
        {['', 'INSTAGRAM', 'LINKEDIN', 'FACEBOOK'].map(p => {
          const Icon = p ? PLATFORM_ICONS[p] : null;
          return (
            <button key={p} onClick={() => setPlatformFilter(p)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full transition-colors',
                platformFilter === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}>
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {p ? p.charAt(0) + p.slice(1).toLowerCase() : 'All Platforms'}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Share2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No posts yet</p>
          <p className="text-sm">Generate your first social post</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([status, statusPosts]) => (
            statusPosts.length > 0 && (
              <div key={status}>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{status} ({statusPosts.length})</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {statusPosts.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onEdit={setEditingPost}
                      onDelete={(id) => {
                        if (confirm('Delete this post?')) deleteMutation.mutate(id);
                      }}
                      onPublish={publishMutation.mutate}
                    />
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onSaved={() => queryClient.invalidateQueries(['social-posts'])}
        />
      )}
      {editingPost && (
        <EditModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => queryClient.invalidateQueries(['social-posts'])}
        />
      )}
    </div>
  );
}
