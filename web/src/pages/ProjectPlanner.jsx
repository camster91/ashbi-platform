import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Sparkles,
  Loader2,
  CheckCircle,
  Clock,
  AlertTriangle,
  Save,
  ArrowRight,
  ChevronDown,
  FolderOpen,
  ListTodo,
  Milestone as MilestoneIcon,
} from 'lucide-react';

const PROJECT_TYPES = [
  { value: 'WEBSITE', label: 'Website Redesign' },
  { value: 'BRANDING', label: 'Branding' },
  { value: 'MARKETING', label: 'Marketing Campaign' },
  { value: 'CUSTOM', label: 'Custom' },
];

const PRIORITY_COLORS = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200',
  NORMAL: 'bg-blue-100 text-blue-700 border-blue-200',
  LOW: 'bg-gray-100 text-gray-600 border-gray-200',
};

const CATEGORY_LABELS = {
  IMMEDIATE: 'Immediate',
  THIS_WEEK: 'This Week',
  UPCOMING: 'Upcoming',
};

export default function ProjectPlanner() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const preselectedProjectId = searchParams.get('projectId');

  const [selectedProjectId, setSelectedProjectId] = useState(preselectedProjectId || '');
  const [brief, setBrief] = useState('');
  const [projectType, setProjectType] = useState('WEBSITE');
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Fetch projects for dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });

  // Generate AI plan mutation
  const generatePlan = useMutation({
    mutationFn: ({ projectId, data }) => api.generateAiPlan(projectId, data),
    onSuccess: (data) => {
      setGeneratedPlan(data);
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  // Save as template mutation
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
    generatePlan.mutate({
      projectId: selectedProjectId,
      data: { brief: brief.trim(), projectType },
    });
  };

  const handleSaveAsTemplate = () => {
    if (!saveTemplateName.trim() || !selectedProjectId) return;
    saveTemplate.mutate({
      projectId: selectedProjectId,
      name: saveTemplateName.trim(),
      projectType,
    });
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            AI Project Planner
          </h1>
          <p className="text-gray-500 mt-1">
            Generate structured project plans with AI from a brief
          </p>
        </div>
        <button
          onClick={() => navigate('/project-templates')}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          View Templates
        </button>
      </div>

      {/* Input Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Project Details</h2>

        {/* Project Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project
          </label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="">Select a project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.client?.name ? `(${p.client.name})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Project Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project Type
          </label>
          <div className="flex gap-2 flex-wrap">
            {PROJECT_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => setProjectType(type.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  projectType === type.value
                    ? 'bg-purple-50 border-purple-300 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Brief */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Project Brief
          </label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Describe the project goals, deliverables, and any constraints. The more detail you provide, the better the plan will be..."
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y"
          />
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!selectedProjectId || !brief.trim() || generatePlan.isPending}
          className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {generatePlan.isPending ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Generating Plan...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              Generate Plan with AI
            </>
          )}
        </button>

        {generatePlan.isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {generatePlan.error?.message || 'Failed to generate plan. Please try again.'}
          </div>
        )}
      </div>

      {/* Generated Plan Display */}
      {generatedPlan && (
        <div className="space-y-6">
          {/* Success Banner */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Plan Generated Successfully</p>
                <p className="text-sm text-green-600">
                  {generatedPlan.milestones?.length || 0} milestones and{' '}
                  {generatedPlan.tasks?.length || 0} tasks created
                  {generatedPlan.plan?.timeline?.estimatedWeeks && (
                    <> &middot; Estimated {generatedPlan.plan.timeline.estimatedWeeks} weeks</>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSaveDialog(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100"
              >
                <Save className="w-4 h-4" />
                Save as Template
              </button>
              {selectedProjectId && (
                <button
                  onClick={() => navigate(`/project/${selectedProjectId}`)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
                >
                  View Project
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Save Template Dialog */}
          {showSaveDialog && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-gray-900">Save as Template</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={saveTemplateName}
                  onChange={(e) => setSaveTemplateName(e.target.value)}
                  placeholder="Template name..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
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
                  className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
              {saveTemplate.isSuccess && (
                <p className="text-sm text-green-600">Template saved successfully!</p>
              )}
            </div>
          )}

          {/* Milestones Timeline */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Milestones
            </h2>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

              <div className="space-y-4">
                {(generatedPlan.milestones || []).map((ms, index) => (
                  <div key={ms.id || index} className="relative flex items-start gap-4 pl-10">
                    {/* Timeline dot */}
                    <div className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow" />
                    <div className="flex-1 bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-gray-900">{ms.name}</h3>
                        <span className="text-xs text-gray-500">
                          {ms.dueDate ? new Date(ms.dueDate).toLocaleDateString() : ''}
                        </span>
                      </div>
                      {ms.description && (
                        <p className="text-sm text-gray-600 mt-1">{ms.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tasks Grouped by Milestone */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-green-600" />
              Tasks ({generatedPlan.tasks?.length || 0})
            </h2>

            {(generatedPlan.milestones || []).map((ms, msIndex) => {
              const milestoneTasks = (generatedPlan.tasks || []).filter(
                t => t.milestoneId === ms.id
              );
              if (milestoneTasks.length === 0) return null;

              return (
                <div key={ms.id || msIndex} className="mb-6 last:mb-0">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {ms.name}
                  </h3>
                  <div className="space-y-2">
                    {milestoneTasks.map((task, taskIndex) => (
                      <div
                        key={task.id || taskIndex}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {task.estimatedTime && (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {task.estimatedTime}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.NORMAL
                          }`}>
                            {task.priority}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Unassigned tasks (no milestone) */}
            {(() => {
              const milestoneIds = (generatedPlan.milestones || []).map(m => m.id);
              const unassigned = (generatedPlan.tasks || []).filter(
                t => !t.milestoneId || !milestoneIds.includes(t.milestoneId)
              );
              if (unassigned.length === 0) return null;

              return (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    General Tasks
                  </h3>
                  <div className="space-y-2">
                    {unassigned.map((task, index) => (
                      <div
                        key={task.id || index}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {task.estimatedTime && (
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {task.estimatedTime}
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.NORMAL
                          }`}>
                            {task.priority}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
