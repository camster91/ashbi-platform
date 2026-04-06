import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, CheckCircle, Layers } from 'lucide-react';

export default function ClientDashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAll = async () => {
      try {
        setLoading(true);
        const [projectsRes, userRes] = await Promise.all([
          fetch('/api/client/projects', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
          fetch('/api/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
        ]);
        if (!projectsRes.ok) throw new Error('Failed to load projects');
        const [projectsData, userData] = await Promise.all([projectsRes.json(), userRes.json()]);
        setProjects(Array.isArray(projectsData) ? projectsData : []);
        if (userRes.ok) setUser(userData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const activeCount = projects.filter(p => p.status === 'ACTIVE').length;
  const completedCount = projects.filter(p => p.status === 'COMPLETED').length;

  const statusColor = (status) => ({
    ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    COMPLETED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }[status] || 'bg-muted text-muted-foreground');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">Client Portal</h1>
            {user?.email && <p className="text-sm text-muted-foreground">Welcome, {user.email}</p>}
          </div>
          <button
            onClick={() => { localStorage.removeItem('token'); navigate('/client/login'); }}
            className="px-4 py-2 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-8">
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <FolderOpen className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Projects</p>
              <p className="text-2xl font-bold text-foreground">{activeCount}</p>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-foreground">{completedCount}</p>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 flex items-center gap-4">
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Projects</p>
              <p className="text-2xl font-bold text-foreground">{projects.length}</p>
            </div>
          </div>
        </div>

        {/* Projects */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">Your Projects</h2>

          {loading ? (
            <div className="text-center text-muted-foreground py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
              Loading projects...
            </div>
          ) : projects.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <FolderOpen className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground">No projects yet. Check back soon!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map(project => (
                <button
                  key={project.id}
                  onClick={() => navigate(`/client/project/${project.id}`)}
                  className="bg-card rounded-xl border border-border p-5 hover:border-primary/40 hover:shadow-md transition text-left"
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-foreground">{project.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(project.status)}`}>
                      {project.status}
                    </span>
                  </div>
                  <div className="mb-3">
                    <div className="flex justify-between mb-1 text-xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium text-foreground">{project.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${project.progress || 0}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'Never'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
