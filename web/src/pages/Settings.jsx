import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Lock,
  Bell,
  Save,
  CheckCircle,
  Eye,
  EyeOff,
  Wrench,
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
