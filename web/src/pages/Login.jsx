import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { authFailureReason, useAuth } from '../hooks/useAuth';
import { useTranslation } from '../hooks/useTranslation';
import {
  Sparkles,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Zap,
  Users,
  MessageSquare,
  Globe
} from 'lucide-react';
import { cn } from '../lib/utils';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const { t, currentLang, setLang, languages } = useTranslation();
  const location = useLocation();
  const returnTo = location.state?.returnTo || '/dashboard';
  const sessionNotices = {
    expired: 'Your session expired. Sign in again to return to your work.',
    revoked: 'Your session was revoked. Sign in again to return to your work. If this is unexpected, contact an administrator.',
  };
  const sessionNotice = sessionNotices[location.state?.reason]
    ? (location.state?.message || sessionNotices[location.state.reason])
    : '';

  const features = [
    { icon: Zap, key: 'brand.feature1' },
    { icon: Users, key: 'brand.feature2' },
    { icon: MessageSquare, key: 'brand.feature3' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password, returnTo);
    } catch (err) {
      const reason = authFailureReason(err);
      const messages = {
        signed_out: t('auth.invalidCredentials'),
        forbidden: 'This account does not have access to this workspace.',
        offline: 'You appear to be offline. Reconnect and try again.',
        timeout: 'Sign-in timed out. Check your connection and try again.',
        server: 'Sign-in is temporarily unavailable. Please try again shortly.',
      };
      setError(messages[reason] || err.message || t('auth.invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <aside className="hidden lg:flex lg:w-1/2 xl:w-5/12 bg-[#2e2958] relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-[#e6f354] rounded-full blur-3xl opacity-10" />
          <div className="absolute bottom-[-5%] right-[-5%] w-[28rem] h-[28rem] bg-[#4a4294] rounded-full blur-3xl opacity-10" />
          <div className="absolute top-[40%] right-[10%] w-72 h-72 bg-[#d0dd9a] rounded-full blur-3xl opacity-10" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-[#e6f354] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#2e2958]" />
              </div>
              <span className="text-xl font-display font-bold">{t('brand.name')}</span>
            </div>

            <h2 className="text-4xl font-display mb-4 leading-tight">
              {t('brand.tagline').split(', ')[0]},<br />{t('brand.tagline').split(', ')[1]}
            </h2>
            <p className="text-white/70 text-lg max-w-md font-sans">
              {t('brand.description')}
            </p>
          </div>

          <div className="space-y-4">
            {features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
                  <feature.icon className="w-5 h-5 text-[#e6f354]" />
                </div>
                <span className="text-white/80">{t(feature.key)}</span>
              </div>
            ))}
          </div>

          <div className="text-sm text-white/70">
            {t('brand.copyright')}
          </div>
        </div>
      </aside>

      {/* Right side - Login form */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#2e2958] flex items-center justify-center">
              <Sparkles className="w-5 h-6 text-[#e6f354]" />
            </div>
            <span className="text-xl font-display font-bold text-foreground">{t('brand.name')}</span>
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-display text-foreground mb-2">
              {t('auth.welcomeBack')}
            </h1>
            <p className="text-muted-foreground">
              {t('auth.signInToContinue')}
            </p>
          </div>

          {sessionNotice && (
            <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
              {sessionNotice} Locally saved drafts remain on this device.
            </div>
          )}

          <form onSubmit={handleSubmit} aria-busy={isLoading} className="space-y-6">
            <div className="space-y-4">
              {/* Email field */}
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  {t('auth.emailLabel')}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder')}
                    className={cn(
                      'w-full pl-11 pr-4 py-3 bg-card border border-border rounded-xl',
                      'text-card-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                      'transition-all duration-200'
                    )}
                    required
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  {t('auth.passwordLabel')}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                    className={cn(
                      'w-full pl-11 pr-12 py-3 bg-card border border-border rounded-xl',
                      'text-card-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                      'transition-all duration-200'
                    )}
                    required
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-11 min-w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end text-sm">
                <Link to="/forgot-password" className="text-primary hover:text-primary/80 font-medium transition-colors">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div id="login-error" role="alert" className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 motion-safe:animate-shake">
                <div className="w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-destructive text-xs">!</span>
                </div>
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              aria-describedby={error ? 'login-error' : undefined}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 px-6',
                'bg-primary text-primary-foreground rounded-full',
                'hover:bg-primary/90',
                'shadow-md hover:shadow-lg',
                'motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98]',
                'transition-all duration-200',
                'font-semibold text-base',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100'
              )}
            >
              {isLoading ? (
                <>
                  <span aria-hidden="true" className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin motion-reduce:animate-none" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  {t('auth.signIn')}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          {/* Language switcher */}
          <div className="flex items-center justify-center gap-2 pt-4">
            <Globe className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <select
              id="language-switcher"
              value={currentLang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Language"
              className="text-sm bg-transparent border-none text-muted-foreground focus:ring-0 cursor-pointer"
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </main>
    </div>
  );
}
