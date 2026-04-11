import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  StickyNote,
  Mail,
  Clock,
} from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelativeTime } from '../../lib/utils';

export default function ProjectContextCard({ projectId }) {
  const queryClient = useQueryClient();
  const [localNotes, setLocalNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  const { data: context, isLoading } = useQuery({
    queryKey: ['project-context', projectId],
    queryFn: () => api.getProjectContext(projectId),
  });

  useEffect(() => {
    if (context?.humanNotes !== undefined && !notesDirty) {
      setLocalNotes(context.humanNotes || '');
    }
  }, [context?.humanNotes, notesDirty]);

  const saveMutation = useMutation({
    mutationFn: (humanNotes) => api.updateProjectContext(projectId, { humanNotes }),
    onSuccess: () => {
      setNotesDirty(false);
      queryClient.invalidateQueries({ queryKey: ['project-context', projectId] });
    },
  });

  function handleBlur() {
    if (notesDirty) {
      saveMutation.mutate(localNotes);
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-border p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3"></div>
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-border">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          Project Context
        </h3>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Mail className="w-3 h-3" />
            {context?.emailCount || 0} emails
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* AI Summary */}
        {context?.aiSummary ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-gray-500 uppercase">AI Summary</h4>
              {context.lastCompactedAt && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(context.lastCompactedAt)}
                </span>
              )}
            </div>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-gray-700 whitespace-pre-wrap">
              {context.aiSummary}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic">
            No AI context summary yet. The email agent will generate one as communications are logged.
          </div>
        )}

        {/* Human Notes */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Notes</h4>
            {saveMutation.isPending && (
              <span className="text-xs text-muted-foreground">Saving...</span>
            )}
          </div>
          <textarea
            value={localNotes}
            onChange={(e) => {
              setLocalNotes(e.target.value);
              setNotesDirty(true);
            }}
            onBlur={handleBlur}
            rows={4}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y"
            placeholder="Add notes about this project's communications..."
          />
        </div>
      </div>
    </div>
  );
}
