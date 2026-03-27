import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import Modal from './Modal';

export default function Milestones({ projectId }) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState(null);

  // Fetch milestones
  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api.getMilestones(projectId)
  });

  // Create milestone
  const createMutation = useMutation({
    mutationFn: (data) => api.createMilestone(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['milestones', projectId]);
      setShowCreateModal(false);
    }
  });

  // Update milestone
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateMilestone(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['milestones', projectId]);
      setSelectedMilestone(null);
    }
  });

  // Delete milestone
  const deleteMutation = useMutation({
    mutationFn: api.deleteMilestone,
    onSuccess: () => {
      queryClient.invalidateQueries(['milestones', projectId]);
      setSelectedMilestone(null);
    }
  });

  // Format date
  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Get days until due
  const getDaysUntil = (date) => {
    const now = new Date();
    const due = new Date(date);
    const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-gray-100 rounded-lg h-20"></div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Milestones</h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Milestone
        </button>
      </div>

      {/* Timeline View */}
      {milestones.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No milestones yet</p>
          <p className="text-sm mt-1">Add milestones to track project progress</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>

          <div className="space-y-6">
            {milestones.map((milestone, index) => {
              const daysUntil = getDaysUntil(milestone.dueDate);
              const isOverdue = daysUntil < 0 && milestone.status !== 'COMPLETED';
              const isUpcoming = daysUntil >= 0 && daysUntil <= 7;

              return (
                <div
                  key={milestone.id}
                  className="relative pl-10"
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-2 w-4 h-4 rounded-full border-2 ${
                      milestone.status === 'COMPLETED'
                        ? 'bg-green-500 border-green-500'
                        : isOverdue
                        ? 'bg-red-500 border-red-500'
                        : isUpcoming
                        ? 'bg-yellow-500 border-yellow-500'
                        : 'bg-white border-gray-300'
                    }`}
                    style={{ top: '1rem' }}
                  ></div>

                  {/* Milestone Card */}
                  <div
                    onClick={() => setSelectedMilestone(milestone)}
                    className={`bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow ${
                      milestone.status === 'COMPLETED' ? 'opacity-75' : ''
                    }`}
                    style={{ borderLeftColor: milestone.color, borderLeftWidth: '4px' }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-medium text-gray-900">{milestone.name}</h4>
                        {milestone.description && (
                          <p className="text-sm text-gray-500 mt-1">{milestone.description}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-medium ${
                          milestone.status === 'COMPLETED' ? 'text-green-600' :
                          isOverdue ? 'text-red-600' :
                          isUpcoming ? 'text-yellow-600' :
                          'text-gray-600'
                        }`}>
                          {milestone.status === 'COMPLETED'
                            ? 'Completed'
                            : isOverdue
                            ? `${Math.abs(daysUntil)} days overdue`
                            : daysUntil === 0
                            ? 'Due today'
                            : `${daysUntil} days left`}
                        </span>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(milestone.dueDate)}
                        </p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>{milestone.completedTasks} of {milestone.totalTasks} tasks</span>
                        <span>{milestone.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${milestone.progress}%`,
                            backgroundColor: milestone.color
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <MilestoneModal
          onSave={(data) => createMutation.mutate(data)}
          onClose={() => setShowCreateModal(false)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* Edit Modal */}
      {selectedMilestone && (
        <MilestoneModal
          milestone={selectedMilestone}
          onSave={(data) => updateMutation.mutate({ id: selectedMilestone.id, data })}
          onDelete={() => deleteMutation.mutate(selectedMilestone.id)}
          onClose={() => setSelectedMilestone(null)}
          isLoading={updateMutation.isPending}
        />
      )}
    </div>
  );
}

function MilestoneModal({ milestone, onSave, onDelete, onClose, isLoading }) {
  const [formData, setFormData] = useState({
    name: milestone?.name || '',
    description: milestone?.description || '',
    dueDate: milestone?.dueDate
      ? new Date(milestone.dueDate).toISOString().split('T')[0]
      : '',
    status: milestone?.status || 'PENDING',
    color: milestone?.color || '#3B82F6'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Modal
      onClose={onClose}
      title={milestone ? 'Edit Milestone' : 'Create Milestone'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full border rounded-lg px-3 py-2"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="w-full h-10 border rounded"
            />
          </div>
        </div>

        {milestone && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        )}

        {milestone?.tasks?.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tasks ({milestone.tasks.length})
            </label>
            <div className="max-h-40 overflow-y-auto border rounded-lg">
              {milestone.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between px-3 py-2 border-b last:border-b-0"
                >
                  <span className={`text-sm ${task.status === 'COMPLETED' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                    {task.title}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    task.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                    task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4 border-t">
          <div>
            {milestone && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-red-600 hover:text-red-700"
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
