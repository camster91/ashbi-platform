import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Sparkles, Calendar, Trash2, CheckCircle, Instagram, Facebook, Twitter } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from '../components/ui';

const PLATFORMS = ['Instagram', 'Facebook', 'Twitter', 'LinkedIn', 'TikTok', 'Pinterest'];
const PLATFORM_ICONS = { Instagram, Facebook, Twitter };
const TONES = ['engaging', 'professional', 'casual', 'humorous', 'inspirational', 'educational'];

export default function SocialScheduler() {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState('Instagram');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('engaging');
  const [showSchedule, setShowSchedule] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [scheduleDate, setScheduleDate] = useState('');

  const generateMutation = useMutation({
    mutationFn: (data) => api.generateSocialPosts(data),
  });

  const scheduleMutation = useMutation({
    mutationFn: (data) => api.scheduleSocialPost(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-posts'] });
      setShowSchedule(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.updateSocialPostStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-posts'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteSchedulerPost(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-posts'] }),
  });

  const { data: scheduledPosts = [], isLoading } = useQuery({
    queryKey: ['social-posts'],
    queryFn: () => api.getScheduledPosts(),
  });

  const generatedPosts = generateMutation.data?.posts || [];

  const handleGenerate = (e) => {
    e.preventDefault();
    if (!topic.trim()) return;
    generateMutation.mutate({ platform, topic, tone, count: 5 });
  };

  const handleSchedule = () => {
    if (!selectedPost || !scheduleDate) return;
    scheduleMutation.mutate({
      platform: selectedPost.platform || platform,
      content: selectedPost.content,
      hashtags: selectedPost.hashtags?.join(',') || '',
      scheduledAt: scheduleDate,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Share2 className="w-6 h-6 text-primary" />
          Social Scheduler
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Generate and schedule AI-powered social posts</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Generator */}
        <div className="lg:col-span-1">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Generate Posts</h2>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Platform</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Topic</label>
                <textarea value={topic} onChange={e => setTopic(e.target.value)}
                  placeholder="What should the posts be about?"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tone</label>
                <select value={tone} onChange={e => setTone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm">
                  {TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <Button type="submit" loading={generateMutation.isPending} className="w-full" leftIcon={<Sparkles className="w-4 h-4" />}>
                Generate Posts
              </Button>
            </form>
          </Card>
        </div>

        {/* Generated posts */}
        <div className="lg:col-span-2">
          {generateMutation.isPending ? (
            <Card className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Generating posts...</p>
            </Card>
          ) : generatedPosts.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Generated Posts</h2>
              {generatedPosts.map((post, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{post.content}</p>
                      {post.hashtags && post.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {post.hashtags.map((tag, j) => (
                            <span key={j} className="text-xs text-primary">#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => {
                        setSelectedPost(post);
                        setShowSchedule(true);
                      }} leftIcon={<Calendar className="w-3.5 h-3.5" />}>
                        Schedule
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Share2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
              <p className="text-muted-foreground">Generated posts will appear here</p>
            </Card>
          )}
        </div>
      </div>

      {/* Scheduled posts */}
      {scheduledPosts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Scheduled Posts</h2>
          <div className="space-y-2">
            {scheduledPosts.map(post => (
              <Card key={post.id} className="p-3 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{post.content?.substring(0, 100)}{post.content?.length > 100 ? '...' : ''}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{post.platform}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.scheduledAt || post.scheduled_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    post.status === 'published' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    post.status === 'scheduled' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {post.status}
                  </span>
                  {post.status === 'scheduled' && (
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: post.id, status: 'published' })}
                      leftIcon={<CheckCircle className="w-3.5 h-3.5" />}>
                      Publish
                    </Button>
                  )}
                  <button onClick={() => { if (confirm('Delete?')) deleteMutation.mutate(post.id); }}
                    className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showSchedule && selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSchedule(false)}>
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Schedule Post</h3>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground line-clamp-3">{selectedPost.content}</p>
              <div>
                <label className="block text-sm font-medium mb-1">Schedule Date & Time</label>
                <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" required />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowSchedule(false)}>Cancel</Button>
                <Button onClick={handleSchedule} loading={scheduleMutation.isPending} leftIcon={<Calendar className="w-4 h-4" />}>
                  Schedule
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}