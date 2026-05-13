import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, X, ArrowRight } from 'lucide-react';
import { Button } from './ui';

const STEPS = [
  {
    target: 'clients-link',
    title: 'Add Your First Client',
    description: 'Start by creating a client. This is where all client information and communication lives.',
    action: 'Create Client',
    link: '/clients',
  },
  {
    target: 'projects-link',
    title: 'Create a Project',
    description: 'Projects organize all the work for a client — tasks, time tracking, notes, and more.',
    action: 'Create Project',
    link: '/projects',
  },
  {
    target: 'proposals-link',
    title: 'Send a Proposal',
    description: 'Create professional proposals with line items, send them to clients, and track approvals.',
    action: 'Create Proposal',
    link: '/proposals',
  },
];

const STORAGE_KEY = 'ashbi_onboarding_completed';
const ONBOARDING_ENABLED_KEY = 'ashbi_onboarding_enabled';

export function isOnboardingComplete() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markOnboardingComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // localStorage might not be available
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage might not be available
  }
}

export function isOnboardingEnabled() {
  try {
    return localStorage.getItem(ONBOARDING_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setOnboardingEnabled(enabled) {
  try {
    localStorage.setItem(ONBOARDING_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage might not be available
  }
}

export default function OnboardingTour() {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // Show tour on first login
    const completed = isOnboardingComplete();
    const enabled = isOnboardingEnabled();
    if (!completed && enabled && !window._onboardingShown) {
      window._onboardingShown = true;
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const updatePosition = useCallback(() => {
    const step = STEPS[currentStep];
    if (!step) return;

    const targetEl = document.getElementById(step.target) || document.querySelector(`[data-tour="${step.target}"]`);
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 12,
        left: Math.max(16, Math.min(rect.left + rect.width / 2 - 180, window.innerWidth - 380)),
      });
    } else {
      // Fallback: center the tooltip
      setPosition({
        top: 120,
        left: Math.max(16, window.innerWidth / 2 - 180),
      });
    }
  }, [currentStep]);

  useEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [updatePosition]);

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinish = () => {
    markOnboardingComplete();
    setVisible(false);
  };

  const handleSkip = () => {
    markOnboardingComplete();
    setVisible(false);
  };

  if (!visible) return null;

  const step = STEPS[currentStep];
  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <>
      {/* Overlay highlighting the target */}
      <div className="fixed inset-0 z-40 bg-black/20 pointer-events-none" />

      {/* Tooltip */}
      <div
        className="fixed z-50 w-80 bg-card border border-border rounded-xl shadow-2xl"
        style={{ top: position.top, left: position.left }}
      >
        {/* Arrow */}
        <div className="absolute -top-2 left-8 w-4 h-4 bg-card border-l border-t border-border rotate-45 rounded-tl" />

        {/* Header */}
        <div className="px-5 pt-4 pb-1 flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`w-6 h-1 rounded-full transition-colors ${
                  idx === currentStep ? 'bg-primary' : 'bg-muted-foreground/20'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
          >
            Skip tour
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pt-2">
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          <h3 className="font-heading font-semibold text-base text-foreground mb-1">
            {step.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Step {currentStep + 1} of {STEPS.length}
          </div>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button size="sm" variant="ghost" onClick={handlePrev}>
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {currentStep < STEPS.length - 1 ? (
                <><span>Next</span> <ChevronRight className="w-3.5 h-3.5" /></>
              ) : (
                <><span>Done!</span> <ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
