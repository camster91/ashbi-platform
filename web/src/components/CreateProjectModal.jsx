import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal, { ModalFooter } from './Modal';
import { api } from '../lib/api';

export default function CreateProjectModal({ isOpen, onClose, preselectedClientId }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    clientId: preselectedClientId || '',
    defaultOwnerId: '',
  });
  const [error, setError] = useState('');

  // Fetch clients for dropdown
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.getClients(),
    enabled: isOpen,
  });

  // Fetch team members for default owner
  const { data: team } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
    enabled: isOpen,
  });

  const mutation = useMutation({
    mutationFn: (data) => api.createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['projects']);
      queryClient.invalidateQueries(['client']);
      onClose();
      setFormData({ name: '', description: '', clientId: '', defaultOwnerId: '' });
      setError('');
    },
    onError: (err) => {
      setError(err.message || 'Failed to create project');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Project name is required');
      return;
    }
    if (!formData.clientId) {
      setError('Please select a client');
      return;
    }
    mutation.mutate({
      ...formData,
      defaultOwnerId: formData.defaultOwnerId || null,
    });
  };

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setError('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Project">
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Website Redesign"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client *
            </label>
            <select
              name="clientId"
              value={formData.clientId}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select a client</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              placeholder="Brief description of the project..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Owner
            </label>
            <select
              name="defaultOwnerId"
              value={formData.defaultOwnerId}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">No default owner</option>
              {team?.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.role})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              New threads for this project will be assigned to this person by default
            </p>
          </div>
        </div>

        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Project'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
