import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ClientDashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProjects();
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (err) {
      console.error('Failed to fetch user:', err);
    }
  };

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/client/projects', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Failed to load projects');
      const data = await res.json();
      setProjects(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/client/login');
  };

  return (
    <div className="min-h-screen bg-[#f8f4ef]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-[#1a2744]">Ashbi Client Portal</h1>
            <p className="text-gray-600 text-sm">Welcome, {user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-600">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600 text-sm font-medium">Active Projects</p>
            <p className="text-3xl font-bold text-[#1a2744]">
              {projects.filter((p) => p.status === 'ACTIVE').length}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600 text-sm font-medium">Completed</p>
            <p className="text-3xl font-bold text-[#c9a84c]">
              {projects.filter((p) => p.status === 'COMPLETED').length}
            </p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600 text-sm font-medium">Total Projects</p>
            <p className="text-3xl font-bold text-[#1a2744]">{projects.length}</p>
          </div>
        </div>

        {/* Projects */}
        <section>
          <h2 className="text-2xl font-bold text-[#1a2744] mb-6">Your Projects</h2>

          {loading ? (
            <div className="text-center text-gray-500 py-12">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="bg-white p-12 rounded-lg text-center">
              <p className="text-gray-600">No projects yet. Check back soon!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => navigate(`/client/project/${project.id}`)}
                  className="bg-white p-6 rounded-lg shadow hover:shadow-lg cursor-pointer transition"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-semibold text-[#1a2744]">{project.name}</h3>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${
                        project.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : project.status === 'COMPLETED'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>

                  <div className="mb-4">
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-gray-600">Progress</span>
                      <span className="text-sm font-semibold text-[#1a2744]">{project.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[#c9a84c] h-2 rounded-full transition-all"
                        style={{ width: `${project.progress || 0}%` }}
                      ></div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-500">
                    Updated {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'Never'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
