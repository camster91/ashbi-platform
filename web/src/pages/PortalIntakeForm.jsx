import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Sparkles, CheckCircle, Loader2, AlertCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export default function PortalIntakeForm() {
  const { token } = useParams();
  const [respondentName, setRespondentName] = useState('');
  const [respondentEmail, setRespondentEmail] = useState('');
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const { data: form, isLoading, error } = useQuery({
    queryKey: ['portal-form', token],
    queryFn: () => api.getPortalForm(token),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: (data) => api.submitPortalForm(token, data),
    onSuccess: () => setSubmitted(true),
  });

  function updateAnswer(label, value) {
    setAnswers(prev => ({ ...prev, [label]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();

    // Validate required fields
    if (!respondentName.trim() || !respondentEmail.trim()) return;

    const fields = form?.fields || [];
    for (const field of fields) {
      if (field.required) {
        const val = answers[field.label];
        if (val === undefined || val === '' || val === null) {
          return;
        }
      }
    }

    submitMutation.mutate({
      respondentName,
      respondentEmail,
      answers,
    });
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Form Not Available</h1>
          <p className="text-slate-400">
            {error.status === 410
              ? 'This form is no longer accepting responses.'
              : 'The form you are looking for could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Thank You!</h1>
          <p className="text-slate-400">Your response has been submitted successfully. We'll review it and get back to you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 py-8 px-4">
      {/* Header */}
      <div className="max-w-2xl mx-auto mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <span className="text-lg font-bold text-white">Ashbi Design</span>
        </div>
        {form.clientName && (
          <p className="text-sm text-slate-500 mb-2">For {form.clientName}</p>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{form.name}</h1>
            {form.description && <p className="text-slate-400 mt-2">{form.description}</p>}
          </div>

          <hr className="border-slate-800" />

          {/* Name & Email (always shown) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Your Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={respondentName}
                onChange={e => setRespondentName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 placeholder-slate-500"
                placeholder="Enter your full name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Your Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={respondentEmail}
                onChange={e => setRespondentEmail(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 placeholder-slate-500"
                placeholder="Enter your email"
              />
            </div>
          </div>

          {/* Dynamic fields */}
          {form.fields.map((field, i) => (
            <div key={i}>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {field.label} {field.required && <span className="text-red-400">*</span>}
              </label>

              {field.type === 'TEXTAREA' ? (
                <textarea
                  value={answers[field.label] || ''}
                  onChange={e => updateAnswer(field.label, e.target.value)}
                  required={field.required}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 placeholder-slate-500"
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                />
              ) : field.type === 'SELECT' ? (
                <select
                  value={answers[field.label] || ''}
                  onChange={e => updateAnswer(field.label, e.target.value)}
                  required={field.required}
                  className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                >
                  <option value="">Select...</option>
                  {field.options?.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : field.type === 'CHECKBOX' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!answers[field.label]}
                    onChange={e => updateAnswer(field.label, e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
                  />
                  <span className="text-sm text-slate-400">Yes</span>
                </div>
              ) : field.type === 'FILE' ? (
                <div className="text-sm text-slate-500 italic px-3 py-2 rounded-lg border border-dashed border-slate-700 bg-slate-800/50">
                  File upload will be available after submission. Please describe your files in a text field.
                </div>
              ) : (
                <input
                  type={field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : field.type === 'PHONE' ? 'tel' : 'text'}
                  value={answers[field.label] || ''}
                  onChange={e => updateAnswer(field.label, e.target.value)}
                  required={field.required}
                  className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 placeholder-slate-500"
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                />
              )}
            </div>
          ))}

          {submitMutation.isError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {submitMutation.error?.message || 'Failed to submit. Please try again.'}
            </div>
          )}

          <button
            type="submit"
            disabled={submitMutation.isPending}
            className={cn(
              'w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all',
              'bg-amber-500 hover:bg-amber-600 text-slate-950',
              'focus:outline-none focus:ring-2 focus:ring-amber-500/50',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {submitMutation.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
              </span>
            ) : 'Submit'}
          </button>
        </div>

        <p className="text-center text-slate-600 text-xs mt-4">Powered by Ashbi Design Hub</p>
      </form>
    </div>
  );
}
