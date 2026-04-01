import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  Check,
  X,
  MessageSquare,
  User,
  Clock,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatRelativeTime, cn } from '../lib/utils';
import Modal, { ModalFooter } from '../components/Modal';

export default function PendingApprovals() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState(null);
  const [rejectModal, setRejectModal] = useState({ open: false, responseId: null });
  const [rejectReason, setRejectReason] = useState('');

  const { data: responses, isLoading } = useQuery({
    queryKey: ['pending-responses'],
    queryFn: () => api.getPendingResponses(),
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.approveResponse(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['pending-responses']);
      queryClient.invalidateQueries(['inbox']);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => api.rejectResponse(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries(['pending-responses']);
      setRejectModal({ open: false, responseId: null });
      setRejectReason('');
    },
  });

  const handleReject = () => {
    if (rejectModal.responseId && rejectReason.trim()) {
      rejectMutation.mutate({ id: rejectModal.responseId, reason: rejectReason });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Pending Approvals</h1>
        <span className="text-sm text-gray-500">
          {responses?.length || 0} responses awaiting review
        </span>
      </div>

      {responses?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Check className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">All caught up!</h3>
          <p className="text-gray-500 mt-1">
            No responses waiting for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {responses?.map((response) => (
            <div key={response.id} className="bg-white rounded-lg shadow">
              {/* Header */}
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() =>
                  setExpandedId(expandedId === response.id ? null : response.id)
                }
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium">
                      Re: {response.thread?.subject}
                    </div>
                    <div className="text-sm text-gray-500 flex items-center gap-2">
                      <User className="w-3 h-3" />
                      {response.draftedBy?.name || 'Unknown'}
                      <span>•</span>
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(response.createdAt)}
                      {response.aiGenerated && (
                        <>
                          <span>•</span>
                          <Sparkles className="w-3 h-3 text-blue-500" />
                          <span className="text-blue-600">AI Generated</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {expandedId !== response.id && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          approveMutation.mutate(response.id);
                        }}
                        disabled={approveMutation.isPending}
                        className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRejectModal({ open: true, responseId: response.id });
                        }}
                        className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {expandedId === response.id ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedId === response.id && (
                <div className="border-t">
                  <div className="grid grid-cols-2 divide-x">
                    {/* Original Message */}
                    <div className="p-4">
                      <h4 className="text-sm font-medium text-gray-500 mb-2">
                        Original Message
                      </h4>
                      <div className="bg-gray-50 rounded-lg p-3 text-sm">
                        {response.thread?.messages?.[0]?.bodyText || 'No message content'}
                      </div>
                    </div>

                    {/* Response Draft */}
                    <div className="p-4">
                      <h4 className="text-sm font-medium text-gray-500 mb-2">
                        Response Draft
                      </h4>
                      <div className="bg-blue-50 rounded-lg p-3">
                        <div className="text-sm font-medium mb-2">
                          Subject: {response.subject}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">
                          {response.body}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
                    <Link
                      to={`/thread/${response.thread?.id}`}
                      className="text-sm text-primary hover:text-primary/80"
                    >
                      View Full Thread
                    </Link>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setRejectModal({ open: true, responseId: response.id })
                        }
                        className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => approveMutation.mutate(response.id)}
                        disabled={approveMutation.isPending}
                        className="px-4 py-2 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Approve & Copy
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      <Modal
        isOpen={rejectModal.open}
        onClose={() => {
          setRejectModal({ open: false, responseId: null });
          setRejectReason('');
        }}
        title="Reject Response"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason for rejection
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            placeholder="Please provide feedback for the team member..."
            autoFocus
          />
        </div>

        <ModalFooter>
          <button
            onClick={() => {
              setRejectModal({ open: false, responseId: null });
              setRejectReason('');
            }}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleReject}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
            className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
          >
            {rejectMutation.isPending ? 'Rejecting...' : 'Reject Response'}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
