import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  FileText,
  Trash2,
  Plus,
  ArrowRight,
  Loader2,
  X,
  ListTodo,
  Clock,
  FolderOpen,
} from 'lucide-react';

const TYPE_LABELS = {
  WEBSITE: 'Website Redesign',
  BRANDING: 'Branding',
  MARKETING: 'Marketing Campaign',
  CUSTOM: 'Custom',
};

const TYPE_COLORS = {
  WEBSITE: 'bg-blue-100 text-blue-700',
  BRANDING: 'bg-purple-100 text-purple-700',
  MARKETING: 'bg-green-100 text-green-700',
  CUSTOM: 'bg-gray-100 text-gray-700',
};

export default function ProjectTemplates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectClientId, setNewProjectClientId] = useState('');
  const [expandedTemplate, setExpandedTemplate] = useState(null);

  // Fetch templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['project-templates'],
    queryFn: () => api.getProjectTemplates(),
  });

  // Fetch clients for the create dialog
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

  // Create from template
  const createFromTemplate = useMutation({
    mutationFn: (data) => api.createProjectFromTemplate(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowCreateDialog(false);
      setSelectedTemplate(null);
      setNewProjectName('');
      setNewProjectClientId('');
      navigate(`/project/${data.project.id}`);
    },
  });

  // Delete template
  const deleteTemplate = useMutation({
    mutationFn: (id) => api.deleteProjectTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-templates'] });
    },
  });

  const handleUseTemplate = (template) => {
    setSelectedTemplate(template);
    setNewProjectName('');
    setNewProjectClientId('');
    setShowCreateDialog(true);
  };

  const handleCreate = () => {
    if (!selectedTemplate || !newProjectName.trim() || !newProjectClientId) return;
    createFromTemplate.mutate({
      templateId: selectedTemplate.id,
      clientId: newProjectClientId,
      name: newProjectName.trim(),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" />
            Project Templates
          </h1>
          <p className="text-gray-500 mt-1">
            Reusable project structures with predefined milestones and tasks
          </p>
        </div>
        <button
          onClick={() => navigate('/project-planner')}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" />
          Create with AI
        </button>
      </div>

      {/* Template List */}
      {templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900">No templates yet</h3>
          <p className="text-gray-500 mt-1 mb-4">
            Create a project plan with AI, then save it as a template for reuse.
          </p>
          <button
            onClick={() => navigate('/project-planner')}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
          >
            Create Your First Template
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => {
            const taskCount = Array.isArray(template.tasks) ? template.tasks.length : 0;
            const milestoneCount = Array.isArray(template.milestones) ? template.milestones.length : 0;
            const isExpanded = expandedTemplate === template.id;

            return (
              <div
                key={template.id}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {template.name}
                        </h3>
                        {template.projectType && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            TYPE_COLORS[template.projectType] || TYPE_COLORS.CUSTOM
                          }`}>
                            {TYPE_LABELS[template.projectType] || template.projectType}
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {milestoneCount} milestones
                        </span>
                        <span className="flex items-center gap-1">
                          <ListTodo className="w-3.5 h-3.5" />
                          {taskCount} tasks
                        </span>
                        <span>
                          Created {new Date(template.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedTemplate(isExpanded ? null : template.id)}
                        className="px-3 py-1.5 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100"
                      >
                        {isExpanded ? 'Hide Details' : 'View Details'}
                      </button>
                      <button
                        onClick={() => handleUseTemplate(template)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
                      >
                        Use Template
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this template?')) {
                            deleteTemplate.mutate(template.id);
                          }
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                    {/* Milestones */}
                    {milestoneCount > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Milestones</h4>
                        <div className="flex flex-wrap gap-2">
                          {template.milestones.map((ms, i) => (
                            <div
                              key={i}
                              className="px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-sm"
                            >
                              <span className="font-medium text-blue-800">{ms.name}</span>
                              {ms.dueOffset && (
                                <span className="text-blue-500 ml-1">
                                  (Day {ms.dueOffset})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tasks */}
                    {taskCount > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Tasks</h4>
                        <div className="space-y-1">
                          {template.tasks.map((task, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-sm text-gray-700"
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                              <span>{task.title}</span>
                              {task.priority && task.priority !== 'NORMAL' && (
                                <span className="text-xs text-orange-600">({task.priority})</span>
                              )}
                              {task.estimatedTime && (
                                <span className="text-xs text-gray-400">{task.estimatedTime}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create From Template Dialog */}
      {showCreateDialog && selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Create from Template
              </h3>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-gray-500">
              Using template: <strong>{selectedTemplate.name}</strong>
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g., Acme Corp Website Redesign"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client
              </label>
              <select
                value={newProjectClientId}
                onChange={(e) => setNewProjectClientId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
              >
                <option value="">Select a client...</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {createFromTemplate.isError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {createFromTemplate.error?.message || 'Failed to create project'}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newProjectName.trim() || !newProjectClientId || createFromTemplate.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {createFromTemplate.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Project'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
