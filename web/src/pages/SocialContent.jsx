import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import {
  Calendar, Plus, Sparkles, X, Loader2, Check, Clock,
  Instagram, Linkedin, Facebook, Twitter, Image, Send,
  ChevronLeft, ChevronRight, MoreHorizontal, Eye, Trash2
} from 'lucide-react';

const PLATFORM_CONFIG = {
  INSTAGRAM: { icon: Instagram, label: 'Instagram', color: 'bg-pink-100 text-pink-700' },
  LINKEDIN: { icon: Linkedin, label: 'LinkedIn', color: 'bg-blue-100 text-blue-700' },
  FACEBOOK: { icon: Facebook, label: 'Facebook', color: 'bg-indigo-100 text-indigo-700' },
  TWITTER: { icon: Twitter, label: 'Twitter/X', color: 'bg-sky-100 text-sky-700' },
};

const STATUS_COLORS = {
  DRAFT: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-yellow-100 text-yellow-700',
  PUBLISHED: 'bg-green-100 text-green-700',
};

function GenerateModal({ onClose, onGenerated }) {
  const [form, setForm] = useState({ topic: '', type: 'instagram', tone: '', audience: '', notes: '' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleGenerate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.socialContentGenerate(form);
      setResult(res);
    } catch (err) {
      setError(err.message || 'Failed to generate');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api.socialContentSave({
        platform: (result.platform || form.type).toUpperCase(),
        content: result.content,
        imagePrompt: result.imagePrompt,
      });
      onGenerated();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Content Generator
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!result ? (
          <form onSubmit={handleGenerate} className="space-y-3">
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div>
              <label className="block text-sm font-medium mb-1">Topic / Brief</label>
              <textarea
                value={form.topic}
                onChange={e => setForm({ ...form, topic: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                rows={3}
                placeholder="e.g. Behind the scenes of a packaging design project for a DTC skincare brand"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Platform</label>
              <div className="flex gap-2">
                {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm({ ...form, type: key.toLowerCase() })}
                    className={cn(
                      'px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border transition-colors',
                      form.type === key.toLowerCase()
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted'
                    )}
                  >
                    <cfg.icon className="w-4 h-4" /> {cfg.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'carousel' })}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 border transition-colors',
                    form.type === 'carousel'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <Image className="w-4 h-4" /> Carousel
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Tone</label>
                <input
                  value={form.tone}
                  onChange={e => setForm({ ...form, tone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                  placeholder="expert, casual, bold..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Target Audience</label>
                <input
                  value={form.audience}
                  onChange={e => setForm({ ...form, audience: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                  placeholder="DTC founders, brand managers..."
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !form.topic}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate Content</>}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', PLATFORM_CONFIG[result.platform?.toUpperCase()]?.color || 'bg-muted')}>
                {result.platform || form.type}
              </span>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm whitespace-pre-wrap">{result.content}</p>
            </div>
            {result.slides && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Carousel Slides:</p>
                {result.slides.map((slide, i) => (
                  <div key={i} className="bg-muted rounded-lg p-3">
                    <p className="text-sm font-semibold">Slide {i + 1}: {slide.headline}</p>
                    <p className="text-xs text-muted-foreground mt-1">{slide.body}</p>
                  </div>
                ))}
              </div>
            )}
            {result.imagePrompt && (
              <div className="bg-muted/50 rounded-lg p-3 border border-dashed border-border">
                <p className="text-xs font-medium text-muted-foreground mb-1">Image Prompt:</p>
                <p className="text-sm">{result.imagePrompt}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> Save as Draft
              </button>
              <button
                onClick={() => setResult(null)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted"
              >
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleModal({ post, onClose, onScheduled }) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSchedule = async () => {
    if (!scheduledAt) return;
    setLoading(true);
    try {
      await api.socialContentSchedule({
        platform: post.platform,
        content: post.content,
        imagePrompt: post.imagePrompt,
        scheduledAt,
      });
      // Delete the draft if it was saved separately
      if (post.status === 'DRAFT') {
        await api.socialContentUpdatePost(post.id, { status: 'SCHEDULED', scheduledAt });
      }
      onScheduled();
      onClose();
    } catch (err) {
      console.error('Schedule error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Schedule Post</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="bg-muted rounded-lg p-3 mb-4">
          <p className="text-sm line-clamp-3">{post.content}</p>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Schedule Date & Time</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
        </div>
        <button
          onClick={handleSchedule}
          disabled={!scheduledAt || loading}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
          Schedule
        </button>
      </div>
    </div>
  );
}

function PostCard({ post, onSchedule, onPublish, onDelete }) {
  const PlatformIcon = PLATFORM_CONFIG[post.platform]?.icon || Calendar;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', PLATFORM_CONFIG[post.platform]?.color || 'bg-muted')}>
            <PlatformIcon className="w-3 h-3 inline mr-1" />
            {PLATFORM_CONFIG[post.platform]?.label || post.platform}
          </span>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[post.status])}>
            {post.status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {post.status === 'DRAFT' && (
            <button
              onClick={() => onSchedule(post)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
              title="Schedule"
            >
              <Clock className="w-4 h-4" />
            </button>
          )}
          {(post.status === 'DRAFT' || post.status === 'SCHEDULED') && (
            <button
              onClick={() => onPublish(post.id)}
              className="p-1.5 text-muted-foreground hover:text-green-600 rounded hover:bg-muted"
              title="Mark Published"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onDelete(post.id)}
            className="p-1.5 text-muted-foreground hover:text-destructive rounded hover:bg-muted"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap line-clamp-4">{post.content}</p>
      {post.scheduledAt && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {new Date(post.scheduledAt).toLocaleString()}
        </p>
      )}
      {post.publishedAt && (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <Check className="w-3 h-3" />
          Published {new Date(post.publishedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

export default function SocialContent() {
  const queryClient = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);
  const [schedulePost, setSchedulePost] = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['social-content-posts'],
    queryFn: () => api.socialContentGetPosts(),
  });

  const publishMutation = useMutation({
    mutationFn: (id) => api.socialContentPublish(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-content-posts'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.socialContentDeletePost(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-content-posts'] }),
  });

  const filteredPosts = activeTab === 'all'
    ? posts
    : posts.filter(p => p.status === activeTab.toUpperCase());

  const drafts = posts.filter(p => p.status === 'DRAFT');
  const scheduled = posts.filter(p => p.status === 'SCHEDULED');
  const published = posts.filter(p => p.status === 'PUBLISHED');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" /> Content Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI content generation, scheduling, and approval queue
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Generate Content
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Posts</p>
          <p className="text-2xl font-bold">{posts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Drafts (Needs Approval)</p>
          <p className="text-2xl font-bold text-yellow-600">{drafts.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Scheduled</p>
          <p className="text-2xl font-bold text-blue-600">{scheduled.length}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Published</p>
          <p className="text-2xl font-bold text-green-600">{published.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'all', label: 'All' },
          { key: 'draft', label: `Approval Queue (${drafts.length})` },
          { key: 'scheduled', label: `Scheduled (${scheduled.length})` },
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

      {/* Posts Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No posts yet. Generate some content to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onSchedule={setSchedulePost}
              onPublish={(id) => publishMutation.mutate(id)}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['social-content-posts'] })}
        />
      )}
      {schedulePost && (
        <ScheduleModal
          post={schedulePost}
          onClose={() => setSchedulePost(null)}
          onScheduled={() => queryClient.invalidateQueries({ queryKey: ['social-content-posts'] })}
        />
      )}
    </div>
  );
}
