import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Lock,
  Save,
  CheckCircle,
  Eye,
  EyeOff,
  Wrench,
  Bot,
  Zap,
  Key,
  Plus,
  Trash2,
  Copy,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Button, Card } from '../components/ui';

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

const TAG_COLORS = {
  vision:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  tools:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  thinking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  audio:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cloud:    'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
};

function AIModelSection() {
  const [saved, setSaved] = useState(false);

  const { data: aiData, isLoading } = useQuery({
    queryKey: ['ai-provider'],
    queryFn: () => api.getAIProvider(),
  });

  const { data: modelData } = useQuery({
    queryKey: ['ollama-models'],
    queryFn: () => api.getOllamaModels(),
  });

  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    if (aiData?.ollamaModel && !selectedModel) {
      setSelectedModel(aiData.ollamaModel);
    }
  }, [aiData]);

  const mutation = useMutation({
    mutationFn: (model) => api.setAIProvider('ollama', model),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const models = modelData?.models || aiData?.ollamaModels || {};

  // Group models by family
  const families = {};
  Object.entries(models).forEach(([key, val]) => {
    const family = val.family || 'Other';
    if (!families[family]) families[family] = [];
    families[family].push({ key, ...val });
  });

  return (
    <Section icon={Bot} title="AI Model" description="Choose which Ollama model powers all AI features">
      {isLoading ? (
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
      ) : (
        <div className="space-y-5">
          {Object.entries(families).map(([family, items]) => (
            <div key={family}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{family}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map(({ key, label, tags = [] }) => (
                  <button
                    key={key}
                    onClick={() => setSelectedModel(key)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      selectedModel === key
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      {selectedModel === key && <Zap className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tags.map(tag => (
                        <span key={tag} className={`text-xs px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[tag] || 'bg-muted text-muted-foreground'}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={() => mutation.mutate(selectedModel)}
              loading={mutation.isPending}
              disabled={!selectedModel || selectedModel === aiData?.ollamaModel}
              leftIcon={<Save className="w-4 h-4" />}
            >
              Apply Model
            </Button>
            {saved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved — restart may be needed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Current: <span className="font-mono font-medium">{aiData?.ollamaModel || '—'}</span>
          </p>
        </div>
      )}
    </Section>
  );
}

function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState(null);

  const { data: keysData = { keys: [] }, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.getApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (name) => api.createApiKey({ name }),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.deleteApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      {/* Create new key */}
      <div className="flex gap-2">
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Key name, e.g. OpenClaw Bot"
          className="flex-1 px-3 py-2 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newKeyName.trim()) {
              createMutation.mutate(newKeyName.trim());
            }
          }}
        />
        <Button
          onClick={() => createMutation.mutate(newKeyName.trim())}
          disabled={!newKeyName.trim() || createMutation.isPending}
          leftIcon={<Plus className="w-4 h-4" />}
          loading={createMutation.isPending}
        >
          Create Key
        </Button>
      </div>

      {/* Show newly created key (only shown once) */}
      {createdKey && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-1">
            API key created! Copy it now — you won't see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white dark:bg-card p-2 rounded font-mono break-all select-all">
              {createdKey}
            </code>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="p-1.5 text-muted-foreground hover:text-foreground"
              title="Copy to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="text-xs text-muted-foreground hover:text-foreground mt-2"
          >
            I've copied it — dismiss
          </button>
        </div>
      )}

      {/* Existing keys */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : keysData.keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet. Create one above.</p>
      ) : (
        <div className="space-y-2">
          {keysData.keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm font-medium">{key.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(key.createdAt).toLocaleDateString()}
                  {key.lastUsedAt && ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
                  {key.expiresAt && ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm('Revoke this API key? Any integrations using it will stop working.')) {
                    deleteMutation.mutate(key.id);
                  }
                }}
                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                title="Revoke key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Use your API key in the <code className="bg-muted px-1 rounded">x-api-key</code> header or as a <code className="bg-muted px-1 rounded">Bearer</code> token.
      </p>
    </div>
  );
}

export default function Settings() {
  const { user, checkAuth } = useAuth();
  const queryClient = useQueryClient();

  // Profile form
  const [profile, setProfile] = useState({ name: '', skills: '', capacity: 40 });
  const [profileSaved, setProfileSaved] = useState(false);

  // Password form
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.name || '',
        skills: (user.skills || []).join(', '),
        capacity: user.capacity || 40,
      });
    }
  }, [user]);

  const profileMutation = useMutation({
    mutationFn: (data) => api.updateProfile(data),
    onSuccess: () => {
      checkAuth();
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data) => api.changePassword(data),
    onSuccess: () => {
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSaved(true);
      setPwError('');
      setTimeout(() => setPwSaved(false), 3000);
    },
    onError: (err) => {
      setPwError(err.message || 'Failed to change password');
    },
  });

  const handleProfileSave = (e) => {
    e.preventDefault();
    profileMutation.mutate({
      name: profile.name,
      skills: profile.skills.split(',').map(s => s.trim()).filter(Boolean),
      capacity: parseInt(profile.capacity),
    });
  };

  const handlePasswordSave = (e) => {
    e.preventDefault();
    setPwError('');
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('New password must be at least 8 characters');
      return;
    }
    passwordMutation.mutate({
      currentPassword: pwForm.currentPassword,
      newPassword: pwForm.newPassword,
    });
  };

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Section icon={User} title="Profile" description="Update your name, skills, and weekly capacity">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Full Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-sm text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1">Contact an admin to change your email</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Skills</label>
            <input
              type="text"
              value={profile.skills}
              onChange={(e) => setProfile({ ...profile, skills: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              placeholder="e.g. design, react, shopify, branding"
            />
            <p className="text-xs text-muted-foreground mt-1">Comma-separated. Used for AI task assignment.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Weekly Capacity (hours)</label>
            <input
              type="number"
              min="1"
              max="80"
              value={profile.capacity}
              onChange={(e) => setProfile({ ...profile, capacity: e.target.value })}
              className="w-32 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={profileMutation.isPending} leftIcon={<Save className="w-4 h-4" />}>
              Save Profile
            </Button>
            {profileSaved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </form>
      </Section>

      {/* Password */}
      <Section icon={Lock} title="Password" description="Change your login password">
        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              required
            />
          </div>
          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={passwordMutation.isPending} leftIcon={<Lock className="w-4 h-4" />}>
              Change Password
            </Button>
            {pwSaved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> Password updated
              </span>
            )}
          </div>
        </form>
      </Section>

      {/* API Keys */}
      <Section icon={Key} title="API Keys" description="Manage API keys for external integrations like OpenClaw">
        <ApiKeysSection />
      </Section>

      {/* AI Model Picker — admin only */}
      {isAdmin && <AIModelSection />}

      {/* Admin links */}
      {isAdmin && (
        <Section icon={Wrench} title="Admin Settings" description="Additional configuration options">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Brand Settings', href: '/admin/brand', desc: 'Logo, colors, company info' },
              { label: 'AI Context', href: '/admin/settings/ai-context', desc: 'Custom AI instructions' },
              { label: 'Command Center', href: '/admin/command-center', desc: 'VPS & GitHub integrations' },
              { label: 'Automations', href: '/automations', desc: 'Workflow automation log' },
              { label: 'Credentials', href: '/credentials', desc: 'Stored API keys & passwords' },
              { label: 'Reports', href: '/reports', desc: 'P&L, team utilization' },
            ].map(({ label, href, desc }) => (
              <a
                key={href}
                href={href}
                className="p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Account info */}
      <div className="text-xs text-muted-foreground text-center pb-4">
        Logged in as <span className="font-medium">{user?.email}</span> ·{' '}
        <span className="capitalize">{user?.role?.toLowerCase()}</span>
      </div>
    </div>
  );
}
