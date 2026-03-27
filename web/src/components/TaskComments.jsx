import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function TaskComments({ taskId }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef(null);

  // Fetch comments
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => api.getTaskComments(taskId)
  });

  // Fetch mentionable users
  const { data: mentionableUsers = [] } = useQuery({
    queryKey: ['mentionable-users', mentionSearch],
    queryFn: () => api.getMentionableUsers(mentionSearch),
    enabled: showMentions
  });

  // Add comment mutation
  const addMutation = useMutation({
    mutationFn: (commentContent) => api.addTaskComment(taskId, commentContent),
    onSuccess: () => {
      queryClient.invalidateQueries(['task-comments', taskId]);
      setContent('');
    }
  });

  // Delete comment mutation
  const deleteMutation = useMutation({
    mutationFn: api.deleteComment,
    onSuccess: () => {
      queryClient.invalidateQueries(['task-comments', taskId]);
    }
  });

  // Handle input change and @mention detection
  const handleInputChange = (e) => {
    const value = e.target.value;
    const position = e.target.selectionStart;
    setContent(value);
    setCursorPosition(position);

    // Check for @mention
    const textBeforeCursor = value.slice(0, position);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      setShowMentions(true);
      setMentionSearch(mentionMatch[1]);
    } else {
      setShowMentions(false);
    }
  };

  // Insert mention
  const insertMention = (user) => {
    const textBeforeCursor = content.slice(0, cursorPosition);
    const textAfterCursor = content.slice(cursorPosition);
    const mentionStart = textBeforeCursor.lastIndexOf('@');
    const newContent = textBeforeCursor.slice(0, mentionStart) + `@${user.name} ` + textAfterCursor;

    setContent(newContent);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  // Submit comment
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    addMutation.mutate(content.trim());
  };

  // Format time
  const formatTime = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString();
  };

  // Highlight @mentions in content
  const renderContent = (text) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="text-blue-600 font-medium">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-gray-100 rounded h-12"></div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900">Comments ({comments.length})</h4>

      {/* Comments List */}
      <div className="space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
              {comment.author?.name?.charAt(0) || '?'}
            </div>

            {/* Content */}
            <div className="flex-1">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900 text-sm">
                    {comment.author?.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTime(comment.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {renderContent(comment.content)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => deleteMutation.mutate(comment.id)}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}

        {comments.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            No comments yet. Be the first to comment!
          </p>
        )}
      </div>

      {/* Add Comment Form */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={content}
              onChange={handleInputChange}
              placeholder="Write a comment... Use @name to mention someone"
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              rows={2}
            />

            {/* Mention Dropdown */}
            {showMentions && mentionableUsers.length > 0 && (
              <div className="absolute bottom-full left-0 w-full bg-white border rounded-lg shadow-lg mb-1 max-h-40 overflow-y-auto z-10">
                {mentionableUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => insertMention(user)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                  >
                    <span className="font-medium">{user.name}</span>
                    <span className="text-gray-500 ml-2">{user.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!content.trim() || addMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 self-end"
          >
            {addMutation.isPending ? '...' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}
