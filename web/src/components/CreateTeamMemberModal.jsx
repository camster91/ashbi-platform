import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Modal, { ModalFooter } from './Modal';
import { Alert, Button, Field, Input, Select } from './ui';
import { api } from '../lib/api';

const AVAILABLE_SKILLS = [
  'development',
  'design',
  'project_management',
  'support',
  'marketing',
  'technical',
  'debugging',
  'ui',
  'branding',
  'product',
];

export default function CreateTeamMemberModal({ isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    password: '',
    role: 'TEAM',
    skills: [],
    capacity: 100,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => api.createTeamMember(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      onClose();
      setFormData({
        email: '',
        name: '',
        password: '',
        role: 'TEAM',
        skills: [],
        capacity: 100,
      });
      setError('');
    },
    onError: (err) => {
      setError(err.message || 'Failed to create team member');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.email.trim()) {
      setError('Email is required');
      return;
    }
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!formData.password || formData.password.length < 6) {
      setError('Password must be at least 6 characters');
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

  const toggleSkill = (skill) => {
    setFormData((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((s) => s !== skill)
        : [...prev.skills, skill],
    }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Team Member" size="lg">
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name" required>
            <Input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="John Doe"
              autoComplete="name"
              autoFocus
            />
          </Field>

          <Field label="Email" required>
            <Input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="john@agency.com"
              autoComplete="email"
            />
          </Field>

          <Field label="Password" hint="At least 6 characters" required>
            <Input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Role">
            <Select name="role" value={formData.role} onChange={handleChange}>
              <option value="TEAM">Team Member</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>

          <Field label="Capacity (%)" hint="100% = full-time availability">
            <Input
              type="number"
              name="capacity"
              value={formData.capacity}
              onChange={handleChange}
              min="0"
              max="100"
            />
          </Field>
        </div>

        <fieldset className="mt-4">
          <legend className="block text-sm font-medium text-foreground mb-2">
            Skills
          </legend>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_SKILLS.map((skill) => (
              <button
                key={skill}
                type="button"
                aria-pressed={formData.skills.includes(skill)}
                onClick={() => toggleSkill(skill)}
                className={`min-h-11 px-3 py-1.5 text-sm rounded-lg border transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  formData.skills.includes(skill)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border/60 hover:border-primary'
                }`}
              >
                {skill.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Skills are used for intelligent thread routing
          </p>
        </fieldset>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {mutation.isPending ? 'Creating...' : 'Add Team Member'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
