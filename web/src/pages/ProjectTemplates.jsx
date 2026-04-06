import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { FileText, Trash2, Plus, ArrowRight, Loader2, X, ListTodo, Clock, FolderOpen } from 'lucide-react';

const TYPE_LABELS = {
  WEBSITE: 'Website Redesign',
  BRANDING: 'Branding',
  MARKETING: 'Marketing Campaign',
  CUSTOM: 'Custom',
};

const TYPE_COLORS = {
  WEBSITE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  BRANDING: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  MARKETING: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CUSTOM: 'bg-muted text-muted-foreground',
};

export default function ProjectTemplates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectClientId, setNewProjectClientId] = useState('');
  const [expandedTemplate, setExpandedTemplate] = useState(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['project-templates'],
    queryFn: () => api.getProjectTemplates(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
  });

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

  const deleteTemplate = useMutation({
    mutationFn: (id) => api.deleteProjectTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-templates'] }),
  });

  const handleUseTemplate = (template) => {
    setSelectedTemplate(template);
    setNewProjectName('');
    setNewProjectClientId('');
    setShowCreateDialog(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-600" /> Project Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Reusable project structures with predefined milestones and tasks</p>
        </div>
        <button
          onClick={() => navigate('/project-planner')}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" /> Create with AI
        </button>
      </div>

      {/* Template List */}
      {templates.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-foreground">No templates yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">Create a project plan with AI, then save it as a template for reuse.</p>
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
              <div key={template.id} className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-semibold text-foreground">{template.name}</h3>
                        {template.projectType && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[template.projectType] || TYPE_COLORS.CUSTOM}`}>
                            {TYPE_LABELS[template.projectType] || template.projectType}
                          </span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {milestoneCount} milestones</span>
                        <span className="flex items-center gap-1"><ListTodo className="w-3.5 h-3.5" /> {taskCount} tasks</span>
                        <span>Created {new Date(template.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => setExpandedTemplate(isExpanded ? null : template.id)}
                        className="px-3 py-1.5 text-sm text-muted-foreground bg-muted border border-border rounded-lg hover:bg-muted/80"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                      <button
                        onClick={() => handleUseTemplate(template)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
                      >
                        Use Template <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Delete this template?')) deleteTemplate.mutate(template.id); }}
                        className="p-1.5 text-muted-foreground hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border px-5 py-4 bg-muted/30">
                    {milestoneCount > 0 && (
                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Milestones</h4>
                        <div className="flex flex-wrap gap-2">
                          {template.milestones.map((ms, i) => (
                            <div key={i} className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg text-sm">
                              <span className="font-medium text-blue-800 dark:text-blue-400">{ms.name}</span>
                              {ms.dueOffset && <span className="text-blue-500 ml-1">(Day {ms.dueOffset})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {taskCount > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tasks</h4>
                        <div className="space-y-1">
                          {template.tasks.map((task, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                              <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                              <span>{task.title}</span>
                              {task.priority && task.priority !== 'NORMAL' && (
                                <span className="text-xs text-orange-600">({task.priority})</span>
                              )}
                              {task.estimatedTime && (
                                <span className="text-xs text-muted-foreground">{task.estimatedTime}</span>
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
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Create from Template</h3>
              <button onClick={() => setShowCreateDialog(false)} className="p-1 text-muted-foreground hover:text-foreground rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">Using template: <strong className="text-foreground">{selectedTemplate.name}</strong></p>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Project Name</label>
              <input
                type="text"
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                placeholder="e.g., Acme Corp Website Redesign"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Client</label>
              <select
                value={newProjectClientId}
                onChange={e => setNewProjectClientId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="">Select a client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {createFromTemplate.isError && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {createFromTemplate.error?.message || 'Failed to create project'}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="px-4 py-2 text-sm text-muted-foreground bg-muted rounded-lg hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                onClick={() => createFromTemplate.mutate({ templateId: selectedTemplate.id, clientId: newProjectClientId, name: newProjectName.trim() })}
                disabled={!newProjectName.trim() || !newProjectClientId || createFromTemplate.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
              >
                {createFromTemplate.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
