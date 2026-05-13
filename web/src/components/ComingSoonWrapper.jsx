import { Construction } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ComingSoonWrapper({ title, children }) {
  const navigate = useNavigate();

  // In a real app we might check the flag by route, but for simplicity
  // any page wrapped with this renders the placeholder when comingSoon=true.
  // The caller should conditionally wrap: isComingSoon('upwork') ? <ComingSoonWrapper /> : <RealPage />
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Construction className="w-8 h-8 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title || 'Coming Soon'}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          This integration is currently in development. Check back soon for updates.
        </p>
      </div>
      <button
        onClick={() => navigate('/dashboard')}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
