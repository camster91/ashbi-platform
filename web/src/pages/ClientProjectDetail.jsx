import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ClientProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/client/projects/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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

  if (loading) {
    return <div className="p-12 text-center">Loading project...</div>;
  }

  if (error) {
    return (
      <div className="p-12">
        <div className="bg-red-50 p-4 rounded border border-red-200 text-red-600 mb-4">{error}</div>
        <button
          onClick={() => navigate('/client/dashboard')}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!project) {
    return <div className="p-12 text-center">Project not found</div>;
  }

  return (
    <div className="min-h-screen bg-[#f8f4ef]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <button
            onClick={() => navigate('/client/dashboard')}
            className="text-[#c9a84c] hover:text-[#b89840] text-sm font-medium mb-4"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-3xl font-bold text-[#1a2744]">{project.name}</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Project Info */}
          <div className="lg:col-span-2">
            {/* Status & Progress */}
            <div className="bg-white p-6 rounded-lg shadow mb-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-[#1a2744]">Project Status</h2>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                  {project.status}
                </span>
              </div>

              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-600">Progress</span>
                  <span className="font-semibold text-[#1a2744]">{project.progress || 0}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-[#c9a84c] h-3 rounded-full transition-all"
                    style={{ width: `${project.progress || 0}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Started</p>
                  <p className="font-semibold text-[#1a2744]">
                    {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Last Updated</p>
                  <p className="font-semibold text-[#1a2744]">
                    {project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            {project.description && (
              <div className="bg-white p-6 rounded-lg shadow mb-6">
                <h2 className="text-xl font-semibold text-[#1a2744] mb-4">About This Project</h2>
                <p className="text-gray-700 leading-relaxed">{project.description}</p>
              </div>
            )}

            {/* Messages */}
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-[#1a2744]">Messages</h2>
                {messages.length > 3 && (
                  <button
                    onClick={() => navigate(`/client/thread/${project.threadId}`)}
                    className="text-[#c9a84c] hover:text-[#b89840] text-sm font-medium"
                  >
                    View All →
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {messages.length === 0 ? (
                  <p className="text-gray-500 text-center py-6">No messages yet</p>
                ) : (
                  messages.slice(0, 3).map((msg, idx) => (
                    <div key={idx} className="border-l-4 border-[#c9a84c] pl-4 py-2">
                      <div className="flex justify-between mb-1">
                        <p className="font-semibold text-gray-700">{msg.sender || 'Team'}</p>
                        <p className="text-sm text-gray-500">{new Date(msg.createdAt).toLocaleDateString()}</p>
                      </div>
                      <p className="text-gray-600">{msg.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div>
            {/* Quick Info */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold text-[#1a2744] mb-4">Quick Info</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-600 uppercase tracking-wide">Client</p>
                  <p className="font-semibold text-[#1a2744]">{project.client?.name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase tracking-wide">Project Manager</p>
                  <p className="font-semibold text-[#1a2744]">{project.manager || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase tracking-wide">Team Size</p>
                  <p className="font-semibold text-[#1a2744]">{project.teamSize || 1} people</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
