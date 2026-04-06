import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Sparkles, Loader2, CheckCircle, Clock, Save, ArrowRight, ListTodo } from 'lucide-react';

const PROJECT_TYPES = [
  { value: 'WEBSITE', label: 'Website Redesign' },
  { value: 'BRANDING', label: 'Branding' },
  { value: 'MARKETING', label: 'Marketing Campaign' },
  { value: 'CUSTOM', label: 'Custom' },
];

const PRIORITY_COLORS = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
  NORMAL: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  LOW: 'bg-muted text-muted-foreground border-border',
};

export default function ProjectPlanner() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [brief, setBrief] = useState('');
  const [projectType, setProjectType] = useState('WEBSITE');
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  const generatePlan = useMutation({
    mutationFn: ({ projectId, data }) => api.generateAiPlan(projectId, data),
    onSuccess: (data) => {
      setGeneratedPlan(data);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: (data) => api.createProjectTemplate(data),
    onSuccess: () => {
      setShowSaveDialog(false);
      setSaveTemplateName('');
      queryClient.invalidateQueries({ queryKey: ['project-templates'] });
    },
  });

  const handleGenerate = () => {
    if (!selectedProjectId || !brief.trim()) return;
    generatePlan.mutate({ projectId: selectedProjectId, data: { brief: brief.trim(), projectType } });
  };

  const handleSaveAsTemplate = () => {
    if (!saveTemplateName.trim() || !selectedProjectId) return;
    saveTemplate.mutate({ projectId: selectedProjectId, name: saveTemplateName.trim(), projectType });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            AI Project Planner
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Generate structured project plans with AI from a brief</p>
        </div>
        <button
          onClick={() => navigate('/project-templates')}
          className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
        >
          View Templates
        </button>
      </div>

      {/* Input */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Project Details</h2>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Project</label>
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary focus:border-primary outline-none"
          >
            <option value="">Select a project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.client?.name ? ` (${p.client.name})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Project Type</label>
          <div className="flex gap-2 flex-wrap">
            {PROJECT_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => setProjectType(type.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  projectType === type.value
                    ? 'bg-purple-100 border-purple-300 text-purple-700 dark:bg-purple-900/30 dark:border-purple-700 dark:text-purple-400'
                    : 'bg-background border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Project Brief</label>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="Describe the project goals, deliverables, and any constraints. The more detail you provide, the better the plan will be..."
            rows={6}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-primary outline-none resize-y"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={!selectedProjectId || !brief.trim() || generatePlan.isPending}
          className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generatePlan.isPending ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Generating Plan...</>
          ) : (
            <><Sparkles className="w-5 h-5" /> Generate Plan with AI</>
          )}
        </button>

        {generatePlan.isError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {generatePlan.error?.message || 'Failed to generate plan. Please try again.'}
          </div>
        )}
      </div>

      {/* Generated Plan */}
      {generatedPlan && (
        <div className="space-y-6">
          {/* Success banner */}
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-400">Plan Generated Successfully</p>
                <p className="text-sm text-green-600 dark:text-green-500">
                  {generatedPlan.milestones?.length || 0} milestones and{' '}
                  {generatedPlan.tasks?.length || 0} tasks created
                  {generatedPlan.plan?.timeline?.estimatedWeeks && (
                    <> · Estimated {generatedPlan.plan.timeline.estimatedWeeks} weeks</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50"
              >
                <Save className="w-4 h-4" /> Save as Template
              </button>
              {selectedProjectId && (
                <button
                  onClick={() => navigate(`/project/${selectedProjectId}`)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
                >
                  View Project <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Save template dialog */}
          {showSaveDialog && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-foreground">Save as Template</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
                />
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={!saveTemplateName.trim() || saveTemplate.isPending}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50"
                >
                  {saveTemplate.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="px-4 py-2 text-muted-foreground bg-muted rounded-lg hover:bg-muted/80"
                >
                  Cancel
                </button>
              </div>
              {saveTemplate.isSuccess && <p className="text-sm text-green-600">Template saved!</p>}
            </div>
          )}

          {/* Milestones */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" /> Milestones
            </h2>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
              <div className="space-y-4">
                {(generatedPlan.milestones || []).map((ms, i) => (
                  <div key={ms.id || i} className="relative flex items-start gap-4 pl-10">
                    <div className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-card shadow" />
                    <div className="flex-1 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-foreground">{ms.name}</h3>
                        <span className="text-xs text-muted-foreground">
                          {ms.dueDate ? new Date(ms.dueDate).toLocaleDateString() : ''}
                        </span>
                      </div>
                      {ms.description && <p className="text-sm text-muted-foreground mt-1">{ms.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tasks */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-green-600" /> Tasks ({generatedPlan.tasks?.length || 0})
            </h2>

            {(generatedPlan.milestones || []).map((ms, msIdx) => {
              const mTasks = (generatedPlan.tasks || []).filter(t => t.milestoneId === ms.id);
              if (!mTasks.length) return null;
              return (
                <div key={ms.id || msIdx} className="mb-6 last:mb-0">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{ms.name}</h3>
                  <TaskList tasks={mTasks} />
                </div>
              );
            })}

            {(() => {
              const milestoneIds = (generatedPlan.milestones || []).map(m => m.id);
              const unassigned = (generatedPlan.tasks || []).filter(t => !t.milestoneId || !milestoneIds.includes(t.milestoneId));
              if (!unassigned.length) return null;
              return (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">General Tasks</h3>
                  <TaskList tasks={unassigned} />
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskList({ tasks }) {
  return (
    <div className="space-y-2">
      {tasks.map((task, i) => (
        <div key={task.id || i} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border">
          <div className="flex-1">
            <p className="font-medium text-foreground text-sm">{task.title}</p>
            {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.estimatedTime && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {task.estimatedTime}
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              { CRITICAL: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
                HIGH: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
                NORMAL: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
                LOW: 'bg-muted text-muted-foreground border-border' }[task.priority] || 'bg-muted text-muted-foreground border-border'
            }`}>
              {task.priority}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
