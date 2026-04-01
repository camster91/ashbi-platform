import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal, { ModalFooter } from './Modal';
import { api } from '../lib/api';

export default function CreateClientModal({ isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    domain: '',
    status: 'ACTIVE',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => api.createClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['clients']);
      onClose();
      setFormData({ name: '', domain: '', status: 'ACTIVE' });
      setError('');
    },
    onError: (err) => {
      setError(err.message || 'Failed to create client');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Client name is required');
      return;
    }
    mutation.mutate(formData);
  };

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setError('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Client">
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Acme Corporation"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Domain
            </label>
            <input
              type="text"
              name="domain"
              value={formData.domain}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="acmecorp.com"
            />
            <p className="mt-1 text-xs text-gray-500">
              Used for automatic email matching
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="CHURNED">Churned</option>
            </select>
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
            {mutation.isPending ? 'Creating...' : 'Create Client'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
