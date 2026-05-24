import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, Check } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [token] = useState(searchParams.get('token'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(t('errors.verification'));
    }
  }, [token, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    if (password.length < 8) {
      setError(t('common.passwordMin'));
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('errors.default'));
      }

      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md text-center space-y-6">
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
              {t('errors.verification')}
            </h1>
            <p className="text-muted-foreground">
              {t('auth.invalidLink')}
            </p>
          </div>
          <Button onClick={() => navigate('/forgot-password')} className="w-full">
            {t('auth.sendResetLink')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        {/* Back button */}
        <button
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 text-primary hover:text-primary-600 font-medium mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        {!success ? (
          <div className="space-y-8 animate-slide-up">
            <div className="text-center">
              <h1 className="text-3xl font-heading font-bold text-foreground mb-2">
                {t('auth.createNewPassword')}
              </h1>
              <p className="text-muted-foreground">
                {t('auth.passwordStrength')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  {t('auth.newPasswordLabel')}
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
                      'w-full pl-11 pr-4 py-3 bg-muted border-0 rounded-xl',
                      'text-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-card',
                      'transition-all duration-200'
                    )}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('common.passwordMin')}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm" className="text-sm font-medium text-foreground">
                  {t('auth.confirmPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t('auth.confirmPassword')}
                    className={cn(
                      'w-full pl-11 pr-4 py-3 bg-muted border-0 rounded-xl',
                      'text-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-card',
                      'transition-all duration-200'
                    )}
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                />
                <span className="text-muted-foreground">{t('auth.showPassword')}</span>
              </label>

              {error && (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-destructive text-xs">!</span>
                  </div>
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                isLoading={isLoading}
                className="w-full"
              >
                {t('auth.resetPassword')}
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-8 animate-slide-up text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-success" />
            </div>

            <div>
              <h2 className="text-2xl font-heading font-bold text-foreground mb-2">
                {t('auth.passwordResetSuccess')}
              </h2>
              <p className="text-muted-foreground">
                {t('auth.passwordResetComplete')}
              </p>
            </div>

            <Button
              onClick={() => navigate('/login')}
              size="lg"
              className="w-full"
            >
              {t('auth.returnToLogin')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
