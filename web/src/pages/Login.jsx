import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
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
  const navigate = useNavigate();

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
      await login(email, password);
    } catch (err) {
      setError(err.message || t('auth.invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-5/12 bg-[#2e2958] relative overflow-hidden">
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

          <div className="text-sm text-white/40">
            {t('brand.copyright')}
          </div>
        </div>
      </div>

      {/* Right side - Login form */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8 lg:p-12 bg-background">
        <div className="w-full max-w-md space-y-8 animate-slide-up">
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

          <form onSubmit={handleSubmit} className="space-y-6">
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
                      'w-full pl-11 pr-4 py-3 bg-white border border-border rounded-xl',
                      'text-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-[#e6f354]/30 focus:border-transparent',
                      'transition-all duration-200'
                    )}
                    required
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
                      'w-full pl-11 pr-12 py-3 bg-white border border-border rounded-xl',
                      'text-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-[#e6f354]/30 focus:border-transparent',
                      'transition-all duration-200'
                    )}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {/* Remember me & Forgot password */}
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-border text-primary focus:ring-[#e6f354]/30" />
                  <span className="text-muted-foreground">{t('auth.rememberMe')}</span>
                </label>
                <a href="/forgot-password" className="text-[#2e2958] hover:text-[#3f3580] font-medium transition-colors">
                  {t('auth.forgotPassword')}
                </a>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3 animate-shake">
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
              className={cn(
                'w-full flex items-center justify-center gap-2 py-3 px-6',
                'bg-[#2e2958] text-white rounded-full',
                'hover:bg-[#3f3580]',
                'shadow-[0_4px_14px_rgba(46,41,88,0.35)] hover:shadow-[0_6px_20px_rgba(46,41,88,0.45)]',
                'hover:scale-[1.02] active:scale-[0.98]',
                'transition-all duration-200',
                'font-semibold text-base',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100'
              )}
            >
              {isLoading ? (
                <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
