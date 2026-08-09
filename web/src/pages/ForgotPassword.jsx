import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui';
import { cn } from '../lib/utils';
import { useTranslation } from '../hooks/useTranslation';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('auth.somethingWentWrong'));
      }

      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        {/* Back button */}
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="min-h-11 inline-flex items-center gap-2 text-primary hover:text-primary-600 font-medium mb-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        {!submitted ? (
          <div className="space-y-8 animate-slide-up">
            <div className="text-center">
              <h1 className="text-3xl font-heading font-bold text-foreground mb-2">
                {t('auth.resetPassword')}
              </h1>
              <p className="text-muted-foreground">
                {t('auth.resetInstructions')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
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
                      'w-full pl-11 pr-4 py-3 bg-muted border-0 rounded-xl',
                      'text-foreground placeholder:text-muted-foreground',
                      'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-card',
                      'transition-all duration-200'
                    )}
                    required
                  />
                </div>
              </div>

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
                {t('auth.sendResetLink')}
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-8 animate-slide-up text-center">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-success" />
            </div>

            <div>
              <h2 className="text-2xl font-heading font-bold text-foreground mb-2">
                {t('auth.checkYourEmail')}
              </h2>
              <p className="text-muted-foreground">
                {t('auth.resetSent')} <span className="font-semibold text-foreground">{email}</span>
              </p>
              <p className="text-muted-foreground text-sm mt-2">
                {t('auth.linkExpiresIn')}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Didn't receive the email? Check your spam folder or{' '}
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setEmail('');
                  }}
                  className="min-h-11 inline-flex items-center text-primary hover:text-primary-600 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {t('auth.tryAgain')}
                </button>
              </p>

              <Button
                onClick={() => navigate('/login')}
                variant="outline"
                className="w-full"
              >
                {t('auth.returnToLogin')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
