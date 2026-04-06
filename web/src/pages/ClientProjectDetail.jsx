import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function ClientProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/client/projects/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        if (!res.ok) throw new Error('Failed to load project');
        const data = await res.json();
        setProject(data);
        setMessages(data.messages || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 mb-4">
          {error || 'Project not found'}
        </div>
        <button
          onClick={() => navigate('/client/dashboard')}
          className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const statusColors = {
    ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    COMPLETED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    ON_HOLD: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/client/dashboard')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <h1 className="text-2xl font-heading font-bold text-foreground">{project.name}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: status + description + messages */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status & Progress */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-foreground">Project Status</h2>
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColors[project.status] || 'bg-muted text-muted-foreground'}`}>
                {project.status}
              </span>
            </div>
            <div className="mb-4">
              <div className="flex justify-between mb-1.5">
                <span className="text-sm text-muted-foreground">Progress</span>
                <span className="text-sm font-semibold text-foreground">{project.progress || 0}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all"
                  style={{ width: `${project.progress || 0}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="font-medium text-foreground">
                  {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Updated</p>
                <p className="font-medium text-foreground">
                  {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          {project.description && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-3">About This Project</h2>
              <p className="text-muted-foreground leading-relaxed">{project.description}</p>
            </div>
          )}

          {/* Messages */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-foreground">Messages</h2>
              {messages.length > 3 && (
                <button
                  onClick={() => navigate(`/client/thread/${project.threadId}`)}
                  className="text-sm text-primary hover:underline"
                >
                  View All →
                </button>
              )}
            </div>
            {messages.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">No messages yet</p>
            ) : (
              <div className="space-y-3">
                {messages.slice(0, 3).map((msg, idx) => (
                  <div key={idx} className="border-l-4 border-primary pl-4 py-1.5">
                    <div className="flex justify-between mb-0.5">
                      <p className="font-medium text-sm text-foreground">{msg.sender || 'Team'}</p>
                      <p className="text-xs text-muted-foreground">{new Date(msg.createdAt).toLocaleDateString()}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{msg.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4">Quick Info</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client</p>
                <p className="font-medium text-foreground mt-0.5">{project.client?.name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project Manager</p>
                <p className="font-medium text-foreground mt-0.5">{project.manager || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Team Size</p>
                <p className="font-medium text-foreground mt-0.5">{project.teamSize || 1} people</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
