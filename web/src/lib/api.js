// API client for Agency Hub

import { uploadFileWithProgress } from './upload';

// Use VITE_API_URL for production (external backend), fallback to /api for dev (proxied)
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Default request timeout (30 seconds)
const DEFAULT_TIMEOUT = 30000;

class ApiError extends Error {
  constructor(message, status, data, retryAfterSeconds = null) {
    super(message);
    this.status = status;
    this.data = data;
    // Seconds from a 429/503 Retry-After header, when the server sent one.
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfterSeconds(response) {
  const value = Number.parseInt(response.headers?.get?.('retry-after') ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

class TimeoutError extends Error {
  constructor(timeout) {
    super(`Request timed out after ${timeout}ms`);
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Global error callback system for integration with React
 * Set these callbacks from your React app (e.g., in ErrorBoundary or App)
 */
let onUnauthorized = null;
let onApiError = null;

export function setUnauthorizedCallback(callback) {
  onUnauthorized = callback;
}

export function setApiErrorCallback(callback) {
  onApiError = callback;
}

/**
 * Step-up re-authentication (#416, docs/privileged-actions.md). Privileged
 * routes answer 403 { code: 'REAUTH_REQUIRED' } unless the user confirmed
 * their password or two-factor code in the last few minutes. The handler set
 * here (ReauthProvider) prompts for it and resolves true once
 * /auth/reauth succeeded, or false when the user cancels; the original
 * request is then retried exactly once.
 */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';
export const IMPERSONATION_ENDED = 'IMPERSONATION_ENDED';
let onReauthRequired = null;
let pendingReauth = null;

export function setReauthHandler(handler) {
  onReauthRequired = handler;
}

// Concurrent requests that hit REAUTH_REQUIRED share one prompt.
function requestReauth(endpoint) {
  if (!pendingReauth) {
    pendingReauth = Promise.resolve()
      .then(() => onReauthRequired({ endpoint }))
      .catch(() => false)
      .finally(() => { pendingReauth = null; });
  }
  return pendingReauth;
}

function dispatchApiError(error, endpoint, retry, userInitiated = false) {
  // A read the user explicitly asked for (a click, not a background query)
  // is reported like a write: the global handler toasts it.
  if (userInitiated && error && typeof error === 'object') error.userInitiated = true;
  // Response bodies and stack traces are for local debugging only; production
  // builds log a single line without them.
  if (import.meta.env.DEV) {
    console.group('%cAPI Error', 'color: #ef4444; font-weight: bold;');
    console.error('Endpoint:', endpoint);
    console.error('Error:', error.message);
    if (error.status) {
      console.error('Status:', error.status);
    }
    if (error.data) {
      console.error('Response data:', error.data);
    }
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.groupEnd();
  } else {
    console.error(`API error${error.status ? ` ${error.status}` : ''}: ${endpoint}`);
  }

  // Dispatch to global callback if set
  if (onApiError) {
    onApiError(error, endpoint, retry);
  }
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const silent = options.silent ?? false;
  const method = (options.method || 'GET').toUpperCase();
  const retry = method === 'GET' ? () => request(endpoint, options) : undefined;

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
    signal: controller.signal,
    method: options.method,
  };

  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  } else if (options.body) {
    config.body = options.body;
  }

  try {
    const response = await fetch(url, config);
    clearTimeout(timeoutId);

    // Handle 401 Unauthorized
    if (response.status === 401) {
      const data = await response.json().catch(() => ({}));
      const error = new ApiError(
        data.error || 'Session expired. Please log in again.',
        response.status,
        data
      );

      // Only dispatch global error/unauthorized events if not silenced
      // (e.g. /auth/me checks are expected to 401 when not logged in)
      // Auth endpoints (/auth/login, /auth/me) handle their own errors —
      // don't trigger global toast/logout for them
      const isAuthEndpoint = endpoint.startsWith('/auth/login') || endpoint.startsWith('/auth/me');
      if (!silent && !isAuthEndpoint) {
        dispatchApiError(error, endpoint, retry, options.userInitiated);
        if (onUnauthorized) {
          onUnauthorized(data.error || 'Session expired. Please log in again.');
        }
      }

      throw error;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new ApiError(
        data.error || 'Request failed',
        response.status,
        data,
        retryAfterSeconds(response)
      );
      // A support view ended while this screen still showed the viewed
      // person (#416): reload so nothing continues under the wrong identity.
      if (response.status === 409 && data.code === IMPERSONATION_ENDED && typeof window !== 'undefined') {
        window.location.reload();
        throw error;
      }
      if (response.status === 403 && data.code === REAUTH_REQUIRED && onReauthRequired && !options.reauthRetried) {
        if (await requestReauth(endpoint)) {
          return request(endpoint, { ...options, reauthRetried: true });
        }
        // Cancelled by the user: no global error toast.
        throw error;
      }
      if (!silent) {
        dispatchApiError(error, endpoint, retry, options.userInitiated);
      }
      throw error;
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle timeout errors
    if (error.name === 'AbortError') {
      const timeoutError = new TimeoutError(timeout);
      dispatchApiError(timeoutError, endpoint, retry, options.userInitiated);
      throw timeoutError;
    }

    // Handle network errors
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      const networkError = new Error('Network error. Please check your connection.');
      networkError.name = 'NetworkError';
      dispatchApiError(networkError, endpoint, retry, options.userInitiated);
      throw networkError;
    }

    // Re-throw ApiError instances
    if (error instanceof ApiError) {
      throw error;
    }

    // Log and re-throw other errors
    dispatchApiError(error, endpoint, retry, options.userInitiated);
    throw error;
  }
}

export const api = {
  // Raw request helper
  request,

  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password } }),
  // Second sign-in step for accounts with two-factor authentication. Kept
  // under /auth/login so a wrong code never triggers the global sign-out.
  loginMfa: ({ challengeToken, code, recoveryCode }) =>
    request('/auth/login/mfa', { method: 'POST', body: { challengeToken, code, recoveryCode } }),
  logout: () =>
    request('/auth/logout', { method: 'POST' }),
  me: () =>
    request('/auth/me', { silent: true }),
  clientLogin: (email, password) =>
    request('/auth/client/login', { method: 'POST', body: { email, password }, silent: true }),
  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: { email }, silent: true }),
  resetPassword: (token, newPassword) =>
    request('/auth/reset-password', { method: 'POST', body: { token, newPassword }, silent: true }),
  updateProfile: (data) =>
    request('/auth/me', { method: 'PUT', body: data }),
  changePassword: (data) =>
    request('/auth/change-password', { method: 'POST', body: data }),
  getMfaStatus: () =>
    request('/auth/mfa'),
  startMfaEnrollment: (password) =>
    request('/auth/mfa/enroll', { method: 'POST', body: { password } }),
  adminResetMfa: (userId, { password, code, recoveryCode }) =>
    request(`/auth/mfa/admin/users/${encodeURIComponent(userId)}/reset`, { method: 'POST', body: { password, code, recoveryCode } }),
  confirmMfaEnrollment: (code) =>
    request('/auth/mfa/confirm', { method: 'POST', body: { code } }),
  // Step-up re-authentication: { password } or { code } (TOTP or recovery
  // code). Silent so a wrong password never triggers the global sign-out.
  reauth: ({ password, code }) =>
    request('/auth/reauth', { method: 'POST', body: password ? { password } : { code }, silent: true }),
  disableMfa: ({ password, code, recoveryCode }) =>
    request('/auth/mfa/disable', { method: 'POST', body: { password, code, recoveryCode } }),
  // Support impersonation (#416, docs/privileged-actions.md): an admin views
  // the app as a team member or client user, read-only, for 30 minutes.
  // Starting needs recent re-authentication (handled by the reauth prompt).
  startImpersonation: (userId, reason) =>
    request('/auth/impersonation', { method: 'POST', body: { userId, reason } }),
  stopImpersonation: () =>
    request('/auth/impersonation/stop', { method: 'POST', silent: true }),
  getImpersonationSessions: () =>
    request('/auth/impersonation/sessions'),
  // Break-glass recovery link from a platform operator. Silent: a bad or
  // used link is shown on the page, never as a global sign-out.
  redeemBreakGlass: (token, newPassword) =>
    request('/auth/break-glass/redeem', { method: 'POST', body: { token, newPassword }, silent: true }),

  // Inbox
  getInbox: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/inbox${query ? `?${query}` : ''}`);
  },
  getInboxStats: () =>
    request('/inbox/stats'),
  getUnmatched: () =>
    request('/inbox/unmatched'),
  assignUnmatched: (id, data) =>
    request(`/inbox/unmatched/${id}/assign`, { method: 'POST', body: data }),
  ignoreUnmatched: (id) =>
    request(`/inbox/unmatched/${id}/ignore`, { method: 'POST' }),

  // Threads
  getThreads: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/threads${query ? `?${query}` : ''}`);
  },
  getThread: (id) =>
    request(`/threads/${id}`),
  updateThread: (id, data) =>
    request(`/threads/${id}`, { method: 'PUT', body: data }),
  assignThread: (id, data) =>
    request(`/threads/${id}/assign`, { method: 'POST', body: data }),
  snoozeThread: (id, until) =>
    request(`/threads/${id}/snooze`, { method: 'POST', body: { until } }),
  resolveThread: (id) =>
    request(`/threads/${id}/resolve`, { method: 'POST' }),
  analyzeThread: (id) =>
    request(`/threads/${id}/analyze`, { method: 'POST' }),
  addNote: (id, content) =>
    request(`/threads/${id}/notes`, { method: 'POST', body: { content } }),

  // Responses
  getPendingResponses: () =>
    request('/responses/pending'),
  createResponse: (threadId, data) =>
    request(`/responses/${threadId}/drafts`, { method: 'POST', body: data }),
  updateResponse: (id, data) =>
    request(`/responses/${id}`, { method: 'PUT', body: data }),
  submitResponse: (id) =>
    request(`/responses/${id}/submit`, { method: 'POST' }),
  approveResponse: (id) =>
    request(`/responses/${id}/approve`, { method: 'POST' }),
  rejectResponse: (id, reason) =>
    request(`/responses/${id}/reject`, { method: 'POST', body: { reason } }),

  // Clients
  getClients: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/clients${query ? `?${query}` : ''}`);
  },
  getClient: (id) =>
    request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: data }),
  updateClient: (id, data) =>
    request(`/clients/${id}`, { method: 'PUT', body: data }),
  getClientInsights: (id) =>
    request(`/clients/${id}/insights`),
  addClientNote: (clientId, content) =>
    request(`/clients/${clientId}/notes`, { method: 'POST', body: { content } }),

  // Projects
  getProjects: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects${query ? `?${query}` : ''}`);
  },
  getProject: (id) =>
    request(`/projects/${id}`),
  createProject: (data) =>
    request('/projects', { method: 'POST', body: data }),
  updateProject: (id, data) =>
    request(`/projects/${id}`, { method: 'PUT', body: data }),
  refreshProjectPlan: (id) =>
    request(`/projects/${id}/plan/refresh`, { method: 'POST' }),

  // AI Project Planner
  generateAiPlan: (id, data) =>
    request(`/projects/${id}/ai-plan`, { method: 'POST', body: data }),

  // Project Templates
  getProjectTemplates: () =>
    request('/projects/templates'),
  createProjectTemplate: (data) =>
    request('/projects/templates', { method: 'POST', body: data }),
  deleteProjectTemplate: (templateId) =>
    request(`/projects/templates/${templateId}`, { method: 'DELETE' }),
  createProjectFromTemplate: (data) =>
    request('/projects/from-template', { method: 'POST', body: data }),

  // Tasks
  getTasks: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tasks${query ? `?${query}` : ''}`);
  },
  getMyTasks: () =>
    request('/tasks/my'),
  getKanbanBoard: (projectId) =>
    request(`/tasks/kanban/${projectId}`),
  moveTask: (taskId, status) =>
    request(`/tasks/${taskId}/move`, { method: 'POST', body: { status } }),
  createQuickTask: (projectId, data) =>
    request(`/tasks/${projectId}/quick`, { method: 'POST', body: data }),
  updateTask: (id, data) =>
    request(`/tasks/${id}`, { method: 'PUT', body: data }),
  completeTask: (id) =>
    request(`/tasks/${id}/complete`, { method: 'POST' }),

  // Team
  getTeam: () =>
    request('/team'),
  getTeamMember: (id) =>
    request(`/team/${id}`),
  createTeamMember: (data) =>
    request('/team', { method: 'POST', body: data }),
  updateTeamMember: (id, data) =>
    request(`/team/${id}`, { method: 'PUT', body: data }),
  getWorkload: () =>
    request('/team/workload'),

  // Search
  search: (q, params = {}) => {
    const query = new URLSearchParams({ q, ...params }).toString();
    return request(`/search?${query}`);
  },

  // Dashboard command center
  getDashboardStats: () =>
    request('/dashboard/stats'),

  // AI
  draftResponse: (threadId) =>
    request('/ai/draft-response', { method: 'POST', body: { threadId } }),
  refineResponse: (responseId, instruction) =>
    request('/ai/refine-response', { method: 'POST', body: { responseId, instruction } }),
  askAI: (question, context = {}) =>
    request('/ai/ask', { method: 'POST', body: { question, ...context } }),
  aiChat: (data) =>
    request('/ai/chat', { method: 'POST', body: data }),
  generateProposal: (data) =>
    request('/ai/generate-proposal', { method: 'POST', body: data }),
  getClientHealth: () =>
    request('/ai/client-health', { method: 'POST' }),
  triageInbox: () =>
    request('/ai/triage-inbox', { method: 'POST' }),
  aiQuery: (query) =>
    request('/ai/query', { method: 'POST', body: { query } }),

  // Notifications
  getNotifications: (params = {}) =>
    request('/notifications?' + new URLSearchParams(params).toString()),
  getUnreadCount: () =>
    request('/notifications/unread-count'),
  markNotificationRead: (id) =>
    request('/notifications/' + id + '/read', { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    request('/notifications/read-all', { method: 'PATCH' }),

  // Push notification preferences
  getPushVapidKey: () => request('/push/vapid-key'),
  subscribePush: (subscription) =>
    request('/push/subscribe', { method: 'POST', body: subscription }),
  unsubscribePush: (endpoint) =>
    request('/push/unsubscribe', { method: 'POST', body: { endpoint } }),

  // Settings - Assignment Rules
  getAssignmentRules: () =>
    request('/settings/assignment-rules'),
  createAssignmentRule: (data) =>
    request('/settings/assignment-rules', { method: 'POST', body: data }),
  updateAssignmentRule: (id, data) =>
    request(`/settings/assignment-rules/${id}`, { method: 'PUT', body: data }),
  deleteAssignmentRule: (id) =>
    request(`/settings/assignment-rules/${id}`, { method: 'DELETE' }),

  // Settings - Templates
  getTemplates: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/settings/templates${query ? `?${query}` : ''}`);
  },
  getTemplate: (id) =>
    request(`/settings/templates/${id}`),
  createTemplate: (data) =>
    request('/settings/templates', { method: 'POST', body: data }),
  updateTemplate: (id, data) =>
    request(`/settings/templates/${id}`, { method: 'PUT', body: data }),
  deleteTemplate: (id) =>
    request(`/settings/templates/${id}`, { method: 'DELETE' }),
  renderTemplate: (id, variables) =>
    request(`/settings/templates/${id}/render`, { method: 'POST', body: { variables } }),

  // ==================== NEW FEATURES ====================

  // Project Chat
  getChatMessages: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/chat/projects/${projectId}/messages${query ? `?${query}` : ''}`);
  },
  sendChatMessage: (projectId, data) =>
    request(`/chat/projects/${projectId}/messages`, { method: 'POST', body: data }),
  editChatMessage: (projectId, messageId, content) =>
    request(`/chat/projects/${projectId}/messages/${messageId}`, { method: 'PUT', body: { content } }),
  deleteChatMessage: (projectId, messageId) =>
    request(`/chat/projects/${projectId}/messages/${messageId}`, { method: 'DELETE' }),
  addChatReaction: (projectId, messageId, emoji) =>
    request(`/chat/projects/${projectId}/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } }),
  removeChatReaction: (projectId, messageId, emoji) =>
    request(`/chat/projects/${projectId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }),

  // Notes
  getAllNotes: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/notes${query ? `?${query}` : ''}`);
  },
  getNotes: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects/${projectId}/notes${query ? `?${query}` : ''}`);
  },
  getNote: (id) =>
    request(`/notes/${id}`),
  getNoteTemplates: () =>
    request('/notes/templates'),
  createNote: (projectId, data) =>
    request(`/projects/${projectId}/notes`, { method: 'POST', body: data }),
  createNoteFromTemplate: (projectId, templateId, data) =>
    request(`/projects/${projectId}/notes/from-template/${templateId}`, { method: 'POST', body: data }),
  updateNote: (id, data) =>
    request(`/notes/${id}`, { method: 'PUT', body: data }),
  deleteNote: (id) =>
    request(`/notes/${id}`, { method: 'DELETE' }),
  restoreNote: (id) =>
    request(`/notes/${id}/restore`, { method: 'POST' }),
  restoreTrashItem: (trashId) =>
    request(`/trash/${trashId}/restore`, { method: 'POST' }),
  pinNote: (id) =>
    request(`/notes/${id}/pin`, { method: 'POST' }),

  // Milestones
  getMilestones: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects/${projectId}/milestones${query ? `?${query}` : ''}`);
  },
  getMilestone: (id) =>
    request(`/milestones/${id}`),
  createMilestone: (projectId, data) =>
    request(`/projects/${projectId}/milestones`, { method: 'POST', body: data }),
  updateMilestone: (id, data) =>
    request(`/milestones/${id}`, { method: 'PUT', body: data }),
  deleteMilestone: (id) =>
    request(`/milestones/${id}`, { method: 'DELETE' }),
  addTaskToMilestone: (milestoneId, taskId) =>
    request(`/milestones/${milestoneId}/tasks/${taskId}`, { method: 'POST' }),
  removeTaskFromMilestone: (milestoneId, taskId) =>
    request(`/milestones/${milestoneId}/tasks/${taskId}`, { method: 'DELETE' }),

  // Time Tracking
  getTimeEntries: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects/${projectId}/time-entries${query ? `?${query}` : ''}`);
  },
  getMyTimeEntries: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/time-entries/my${query ? `?${query}` : ''}`);
  },
  createTimeEntry: (data) =>
    request('/time-entries', { method: 'POST', body: data }),
  updateTimeEntry: (id, data) =>
    request(`/time-entries/${id}`, { method: 'PUT', body: data }),
  // Deletes a TimeEntry. (DELETE /time-tracking/:id deletes a timer session.)
  deleteTimeEntry: (id) =>
    request(`/time-entries/${id}`, { method: 'DELETE' }),
  getTimeSummary: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/time-tracking/summary${query ? `?${query}` : ''}`);
  },
  startTimer: (data) =>
    request('/time-tracking/start', { method: 'POST', body: data }),
  stopTimer: (id) =>
    request(`/time-tracking/${id}/stop`, { method: 'POST' }),
  stopAllTimers: () =>
    request('/time-tracking/stop-all', { method: 'POST' }),
  getRunningTimer: () =>
    request('/time-tracking/running'),
  createManualTimeEntry: (data) =>
    request('/time-tracking/manual', { method: 'POST', body: data }),

  // Time Sessions (live timer)
  startTimeSession: (data) =>
    request('/time-sessions', { method: 'POST', body: data }),
  stopTimeSession: (id) =>
    request(`/time-sessions/${id}/stop`, { method: 'POST' }),
  getRunningTimeSession: () =>
    request('/time-sessions/running'),

  // Task Comments
  getTaskComments: (taskId) =>
    request(`/tasks/${taskId}/comments`),
  addTaskComment: (taskId, content) =>
    request(`/tasks/${taskId}/comments`, { method: 'POST', body: { content } }),
  updateComment: (id, content) =>
    request(`/comments/${id}`, { method: 'PUT', body: { content } }),
  deleteComment: (id) =>
    request(`/comments/${id}`, { method: 'DELETE' }),
  getMentionableUsers: (query = '') =>
    request(`/users/mentionable${query ? `?query=${query}` : ''}`),

  // Calendar
  getCalendarEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/calendar${query ? `?${query}` : ''}`);
  },
  getMyCalendarEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/calendar/my${query ? `?${query}` : ''}`);
  },
  getCalendarEvent: (id) =>
    request(`/calendar/${id}`),
  createCalendarEvent: (data) =>
    request('/calendar', { method: 'POST', body: data }),
  updateCalendarEvent: (id, data) =>
    request(`/calendar/${id}`, { method: 'PUT', body: data }),
  deleteCalendarEvent: (id) =>
    request(`/calendar/${id}`, { method: 'DELETE' }),
  rsvpCalendarEvent: (id, status) =>
    request(`/calendar/${id}/rsvp`, { method: 'POST', body: { status } }),
  getUpcomingEvents: (limit = 5) =>
    request(`/calendar/upcoming?limit=${limit}`),

  // Google Calendar — the OAuth start endpoint deliberately navigates the
  // browser so the provider can set its own consent/session state.
  googleCalendarOAuthStartUrl: () => `${API_BASE}/google-calendar/oauth/start`,
  getGoogleCalendarConnection: () =>
    request('/google-calendar/connection'),
  disconnectGoogleCalendar: () =>
    request('/google-calendar/connection/disconnect', { method: 'POST' }),
  syncGoogleCalendarEvent: (eventId) =>
    request(`/google-calendar/events/${eventId}/sync`, { method: 'POST' }),

  // Slack installation/mapping administration is restricted by the server to
  // organization administrators. OAuth starts as a browser navigation.
  slackOAuthStartUrl: () => `${API_BASE}/slack/oauth/start`,
  getSlackInstallations: () =>
    request('/slack'),
  disconnectSlackInstallation: (installationId) =>
    request(`/slack/installations/${installationId}/disconnect`, { method: 'POST' }),
  createSlackChannelMapping: (installationId, data) =>
    request(`/slack/installations/${installationId}/mappings`, { method: 'POST', body: data }),

  // Attachments
  getIceServers: () => request('/realtime/ice-servers'),
  getAttachments: (entityType, entityId) =>
    request(`/attachments?entityType=${entityType}&entityId=${entityId}`),
  uploadAttachment: async (file, entityType, entityId) => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('entityType', entityType);
    form.append('entityId', entityId);
    const response = await fetch(`${API_BASE}/attachments`, {
      method: 'POST', body: form, credentials: 'include',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error || 'Upload failed', response.status, data);
    return data;
  },
  deleteAttachment: (id) =>
    request(`/attachments/${id}`, { method: 'DELETE' }),
  // Chat media (docs/chat-media.md): upload first as a pending chat upload,
  // then send the message with its `attachmentIds`.
  uploadChatFile: (projectId, file, options = {}) =>
    uploadFileWithProgress(`${API_BASE}/chat/projects/${projectId}/uploads`, file, options),
  discardChatUpload: (projectId, attachmentId) =>
    request(`/chat/projects/${projectId}/uploads/${attachmentId}`, { method: 'DELETE', silent: true }),
  attachmentFileUrl: (filename) => `${API_BASE}/attachments/uploads/${encodeURIComponent(filename)}`,
  // Note: File upload uses FormData, handled separately in components

  // Media review (#417, docs/media-review.md)
  getReviewSessions: (projectId) =>
    request(`/reviews?projectId=${encodeURIComponent(projectId)}`),
  createReviewSession: (data) =>
    request('/reviews', { method: 'POST', body: data }),
  getReviewSession: (id) =>
    request(`/reviews/${encodeURIComponent(id)}`),
  addReviewAnnotation: (id, data) =>
    request(`/reviews/${encodeURIComponent(id)}/annotations`, { method: 'POST', body: data }),
  resolveReviewAnnotation: (id, annotationId, resolved) =>
    request(`/reviews/${encodeURIComponent(id)}/annotations/${encodeURIComponent(annotationId)}/resolve`, { method: 'POST', body: { resolved } }),
  recordReviewDecision: (id, data) =>
    request(`/reviews/${encodeURIComponent(id)}/decisions`, { method: 'POST', body: data }),
  // Step-up: a 403 REAUTH_REQUIRED opens the re-authentication dialog.
  createReviewShareLink: (id, data) =>
    request(`/reviews/${encodeURIComponent(id)}/share-links`, { method: 'POST', body: data }),
  revokeReviewShareLink: (id, linkId) =>
    request(`/reviews/${encodeURIComponent(id)}/share-links/${encodeURIComponent(linkId)}/revoke`, { method: 'POST' }),
  getPortalReview: (token) =>
    request(`/portal/review/${encodeURIComponent(token)}`, { silent: true }),
  portalReviewFileUrl: (token) => `${API_BASE}/portal/review/${encodeURIComponent(token)}/file`,
  addPortalReviewAnnotation: (token, data) =>
    request(`/portal/review/${encodeURIComponent(token)}/annotations`, { method: 'POST', body: data, silent: true }),
  recordPortalReviewDecision: (token, data) =>
    request(`/portal/review/${encodeURIComponent(token)}/decisions`, { method: 'POST', body: data, silent: true }),

  // Kanban (using existing tasks endpoints)
  updateTaskPosition: (id, data) =>
    request(`/tasks/${id}`, { method: 'PUT', body: data }),
  bulkUpdateTasks: (updates) =>
    request('/tasks/bulk-update', { method: 'POST', body: { updates } }),

  // ===== REVISIONS =====
  getRevisions: (projectId) =>
    request(`/projects/${projectId}/revisions`),
  createRevision: (projectId, data = {}) =>
    request(`/projects/${projectId}/revisions`, { method: 'POST', body: data }),
  updateRevision: (id, data) =>
    request(`/revisions/${id}`, { method: 'PUT', body: data }),
  approveRevision: (id) =>
    request(`/revisions/${id}/approve`, { method: 'POST' }),

  // ===== CLIENT UPDATE DRAFTER =====
  draftProjectUpdate: (projectId, data) =>
    request('/ai/draft-update', { method: 'POST', body: { projectId, ...data } }),

  // ===== PASTE INTAKE =====
  pasteMessage: (data) =>
    request('/messages/paste', { method: 'POST', body: data }),

  // ===== AI PROVIDER =====
  getAIProvider: () =>
    request('/settings/ai-provider'),
  setAIProvider: (provider, model) =>
    request('/settings/ai-provider', { method: 'POST', body: { provider, model } }),
  getOllamaModels: () =>
    request('/settings/ai-provider/ollama-models'),
  setPlatformAiKillSwitch: (disabled) =>
    request('/settings/ai-kill-switch', { method: 'POST', body: { disabled } }),

  // ===== ORGANIZATION AI PROVIDER (BYOK, docs/ai-byok.md) =====
  // Connect, rotate, revoke and disable/enable answer REAUTH_REQUIRED until
  // the admin re-authenticates; request() prompts and retries once.
  getAiConnection: () => request('/ai-connections'),
  connectAiProvider: ({ baseUrl, apiKey, allowedModels, defaultModel, monthlyBudgetCents }) =>
    request('/ai-connections/connect', { method: 'POST', body: { baseUrl, apiKey, allowedModels, defaultModel, monthlyBudgetCents } }),
  validateAiConnection: () => request('/ai-connections/validate', { method: 'POST' }),
  rotateAiConnectionKey: (apiKey) => request('/ai-connections/rotate', { method: 'POST', body: { apiKey } }),
  revokeAiConnection: () => request('/ai-connections/revoke', { method: 'POST' }),
  updateAiConnectionSettings: (settings) => request('/ai-connections/settings', { method: 'PATCH', body: settings }),
  setOrganizationAiDisabled: (disabled) =>
    request(disabled ? '/ai-connections/disable' : '/ai-connections/enable', { method: 'POST' }),

  // Governed AI tool approvals and receipts (#413 slice 2). Approve and
  // reject need step-up re-authentication; the 403 opens ReauthDialog.
  getAiToolApprovals: () => request('/ai-tools/approvals'),
  getAiToolReceipts: (params = {}) => {
    const defined = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const query = new URLSearchParams(defined).toString();
    return request(`/ai-tools/receipts${query ? `?${query}` : ''}`);
  },
  approveAiToolAction: (id) => request(`/ai-tools/approvals/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} }),
  rejectAiToolAction: (id, reason = 'other') =>
    request(`/ai-tools/approvals/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } }),
  // One assistant tool session: up to six governed model turns, so allow
  // longer than the default timeout. Errors are shown inline by the form.
  runAiToolSession: (prompt) =>
    request('/ai-tools/sessions', { method: 'POST', body: { prompt }, timeout: 120_000, silent: true }),

  // ===== PROPOSALS =====
  getProposals: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/proposals${query ? `?${query}` : ''}`);
  },
  getProposal: (id) =>
    request(`/proposals/${id}`),
  createProposal: (data) =>
    request('/proposals', { method: 'POST', body: data }),
  updateProposal: (id, data) =>
    request(`/proposals/${id}`, { method: 'PUT', body: data }),
  deleteProposal: (id) =>
    request(`/proposals/${id}`, { method: 'DELETE' }),
  sendProposal: (id) =>
    request(`/proposals/${id}/send`, { method: 'POST' }),
  duplicateProposal: (id) =>
    request(`/proposals/${id}/duplicate`, { method: 'POST' }),
  // Bulk proposal actions
  bulkSendProposals: (ids) =>
    request('/proposals/bulk/send', { method: 'POST', body: { ids } }),
  bulkArchiveProposals: (ids) =>
    request('/proposals/bulk/archive', { method: 'POST', body: { ids } }),
  // Proposal versioning
  getProposalVersions: (id) =>
    request(`/proposals/${id}/versions`),
  restoreProposalVersion: (id, versionId) =>
    request(`/proposals/${id}/versions/${versionId}/restore`, { method: 'POST' }),

  // ===== PROPOSALS PIPELINE (Phase 3a) =====
  /** AI-generate a proposal from client + services */
  aiGenerateProposal: (data) =>
    request('/proposals/generate', { method: 'POST', body: data }),
  /** Convert proposal to PDF */
  proposalGeneratePdf: (id) =>
    request(`/proposals/${id}/pdf`, { method: 'POST' }),
  /** Send proposal via Gmail — body: { email, subject, body } */
  proposalSendViaGmail: (id, data = {}) =>
    request(`/proposals/${id}/send`, { method: 'POST', body: data }),

  // ===== CONTRACTS =====
  getContracts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/contracts${query ? `?${query}` : ''}`);
  },
  getContract: (id) =>
    request(`/contracts/${id}`),
  createContract: (data) =>
    request('/contracts', { method: 'POST', body: data }),
  createContractFromProposal: (proposalId) =>
    request(`/contracts/from-proposal/${proposalId}`, { method: 'POST' }),
  sendContract: (id) =>
    request(`/contracts/${id}/send`, { method: 'POST' }),

  // ===== INVOICES =====
  getInvoices: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/invoices${query ? `?${query}` : ''}`);
  },
  getInvoiceStats: () =>
    request('/invoices/stats'),
  getInvoice: (id) =>
    request(`/invoices/${id}`),
  createInvoice: (data) =>
    request('/invoices', { method: 'POST', body: data }),
  updateInvoice: (id, data) =>
    request(`/invoices/${id}`, { method: 'PUT', body: data }),
  deleteInvoice: (id) =>
    request(`/invoices/${id}`, { method: 'DELETE' }),
  undoInvoiceVoid: (id) =>
    request(`/invoices/${id}/undo-void`, { method: 'POST' }),
  createInvoiceFromProposal: (proposalId) =>
    request(`/invoices/from-proposal/${proposalId}`, { method: 'POST' }),
  sendInvoice: (id) =>
    request(`/invoices/${id}/send`, { method: 'POST' }),
  getInvoicePdf: (id) =>
    request(`/invoices/${id}/pdf`, { method: 'GET' }),
  markInvoicePaid: (id, data = {}) =>
    request(`/invoices/${id}/mark-paid`, { method: 'POST', body: data }),
  generateInvoicePaymentLink: (id) =>
    request(`/invoices/${id}/payment-link`, { method: 'POST' }),
  getInvoicePayments: (id) =>
    request(`/invoices/${id}/payments`),
  // Bulk invoice actions
  bulkMarkPaid: (ids, paymentMethod) =>
    request('/invoices/bulk/mark-paid', { method: 'POST', body: { ids, paymentMethod } }),
  bulkSendInvoices: (ids) =>
    request('/invoices/bulk/send', { method: 'POST', body: { ids } }),
  bulkArchiveInvoices: (ids) =>
    request('/invoices/bulk/archive', { method: 'POST', body: { ids } }),
  // Line item templates
  getLineItemTemplates: () =>
    request('/invoices/templates'),
  createLineItemTemplate: (data) =>
    request('/invoices/templates', { method: 'POST', body: data }),
  deleteLineItemTemplate: (id) =>
    request(`/invoices/templates/${id}`, { method: 'DELETE' }),

  // ===== EXPENSES =====
  getExpenses: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/expenses${query ? `?${query}` : ''}`);
  },
  getExpenseSummary: () =>
    request('/expenses/summary'),
  getExpense: (id) =>
    request(`/expenses/${id}`),
  createExpense: (data) =>
    request('/expenses', { method: 'POST', body: data }),
  updateExpense: (id, data) =>
    request(`/expenses/${id}`, { method: 'PUT', body: data }),
  deleteExpense: (id) =>
    request(`/expenses/${id}`, { method: 'DELETE' }),
  uploadReceipt: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE}/expenses/upload-receipt`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || 'Upload failed', res.status, data);
    }
    return res.json();
  },

  // ===== AUTOMATIONS =====
  getAutomationHistory: (offset = 0, limit = 25) =>
    request(`/automations/history?limit=${limit}&offset=${offset}`),

  // ===== UPWORK =====
  getUpworkTasks: (tags) => {
    const query = new URLSearchParams({ tags }).toString();
    return request(`/tasks?${query}`);
  },
  updateUpworkTask: (id, data) =>
    request(`/tasks/${id}`, { method: 'PUT', body: data }),

  // ===== NOTION-LIKE TASK PAGES =====
  getTaskPage: (id) =>
    request(`/tasks/${id}/page`),
  updateTaskContent: (id, data) =>
    request(`/tasks/${id}/content`, { method: 'PUT', body: data }),
  createSubpage: (id, data) =>
    request(`/tasks/${id}/subpage`, { method: 'POST', body: data }),
  getTaskBreadcrumbs: (id) =>
    request(`/tasks/${id}/breadcrumbs`),
  searchMentions: (query, projectId) =>
    request(`/tasks/mentions/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${projectId}` : ''}`),

  // ===== GANTT & DEPENDENCIES =====
  getGanttTasks: (projectId) => {
    const params = projectId ? `?projectId=${projectId}` : '';
    return request(`/tasks/gantt${params}`);
  },
  setTaskDependency: (taskId, dependsOnId) =>
    request(`/tasks/${taskId}/dependency`, { method: 'PUT', body: { dependsOnId } }),

  // ===== CREDENTIALS VAULT =====
  getCredentials: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/credentials${query ? `?${query}` : ''}`);
  },
  getCredential: (id, purpose = 'view credential detail') =>
    request(`/credentials/${id}`, { headers: { 'X-Credential-Purpose': purpose } }),
  getCredentialPassword: (id, purpose) =>
    request(`/credentials/${id}/password`, { headers: { 'X-Credential-Purpose': purpose }, userInitiated: true }),
  createCredential: (data) =>
    request('/credentials', { method: 'POST', body: data }),
  updateCredential: (id, data) =>
    request(`/credentials/${id}`, { method: 'PUT', body: data }),
  deleteCredential: (id) =>
    request(`/credentials/${id}`, { method: 'DELETE' }),

  // ===== CLIENT PORTAL =====
  getPortal: (token) =>
    request(`/portal/${token}`),

  // ===== PUBLIC PORTAL PAGES =====
  getPortalProposal: (token) =>
    request(`/portal/proposal/${token}`),
  respondPortalProposal: (token, data) =>
    request(`/portal/proposal/${token}/${data.action}`, { method: 'POST', body: data.action === 'decline' ? { reason: data.reason } : {} }),
  getPortalContract: (token) =>
    request(`/portal/contract/${token}`),
  signPortalContract: (token, data) =>
    request(`/portal/contract/${token}/sign`, { method: 'POST', body: data }),
  getPortalInvoice: (token) =>
    request(`/portal/invoice/${token}`),
  payPortalInvoice: (token) =>
    request(`/portal/invoice/${token}/pay`, { method: 'POST' }),
  getPortalBookingSlots: (date) =>
    request(`/portal/booking/availability?date=${date}`),
  createPortalBooking: (data) =>
    request('/portal/booking', { method: 'POST', body: data }),

  // ===== TASK TEMPLATES =====
  getTaskTemplates: () =>
    request('/templates'),
  createTaskTemplate: (data) =>
    request('/templates', { method: 'POST', body: data }),
  applyTemplate: (templateId, projectId) =>
    request(`/templates/${templateId}/apply/${projectId}`, { method: 'POST' }),
  updateTaskTemplate: (id, data) =>
    request(`/templates/${id}`, { method: 'PUT', body: data }),
  deleteTaskTemplate: (id) =>
    request(`/templates/${id}`, { method: 'DELETE' }),

  // AI Team
  getAiTeamAgents: () =>
    request('/ai-team/agents'),
  aiTeamChat: (data) =>
    request('/ai-team/chat', { method: 'POST', body: data }),
  getAiTeamHistory: (agentRole) =>
    request(`/ai-team/history/${agentRole}`),

  // ===== EMAIL TRIAGE AGENT =====
  scanEmailInbox: () =>
    request('/email-triage/scan', { method: 'POST' }),
  generateEmailDrafts: (messageId) =>
    request(`/email-triage/draft/${messageId}`, { method: 'POST' }),
  getEmailQueue: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/email-triage/queue${query ? `?${query}` : ''}`);
  },
  approveEmailDraft: (draftId) =>
    request(`/email-triage/approve/${draftId}`, { method: 'PUT' }),
  updateEmailDraft: (draftId, data) =>
    request(`/email-triage/update-draft/${draftId}`, { method: 'PUT', body: data }),
  archiveEmailItem: (itemId) =>
    request(`/email-triage/archive/${itemId}`, { method: 'PUT' }),

  // ===== PROPOSAL AI =====
  generateProposalAI: (data) =>
    request('/proposals-ai/generate', { method: 'POST', body: data }),
  generateSalesProposal: (data) =>
    request('/sales/proposal/generate', { method: 'POST', body: data }),

  // ===== INVOICE CHASER =====
  chaseInvoices: (data = {}) =>
    request('/invoice-chaser/chase', { method: 'POST', body: data }),
  getOverdueInvoices: () =>
    request('/invoice-chaser/overdue'),

  // ===== AI CONTEXT SETTINGS =====
  getAiContext: () =>
    request('/ai-context'),
  getAiContextPrompt: () =>
    request('/ai-context/prompt'),
  saveAiContext: ({ key, value }) =>
    request('/ai-context', { method: 'POST', body: { key, value } }),
  deleteAiContext: (key) =>
    request(`/ai-context/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // ===== COMMAND CENTER =====
  getCommandCenter: () =>
    request('/command-center'),
  pingCommandCenter: () =>
    request('/command-center/ping'),

  // ===== APPROVALS =====
  getApprovals: (filters = {}) => {
    const params = new URLSearchParams(filters).toString();
    return request(`/approvals${params ? '?' + params : ''}`);
  },
  getApproval: (id) =>
    request(`/approvals/${id}`),
  updateApproval: (id, data) =>
    request(`/approvals/${id}`, { method: 'PATCH', body: data }),
  getPendingApprovalCount: async () => {
    const data = await request('/approvals/pending-count');
    return data.count ?? 0;
  },

  // ===== PROJECT COMMUNICATIONS =====
  getProjectCommunications: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects/${projectId}/communications${query ? `?${query}` : ''}`);
  },
  getProjectCommunication: (projectId, communicationId) =>
    request(`/projects/${projectId}/communications/${communicationId}`),

  // ===== PROJECT CONTEXT =====
  getProjectContext: (projectId) =>
    request(`/projects/${projectId}/context`),
  updateProjectContext: (projectId, data) =>
    request(`/projects/${projectId}/context`, { method: 'POST', body: data }),

  // ===== GMAIL =====
  getGmailStatus: () =>
    request('/gmail/status'),
  gmailSend: (data) =>
    request('/gmail/send', { method: 'POST', body: data }),
  gmailDraftReply: (hubThreadId) =>
    request('/gmail/draft-reply', { method: 'POST', body: { hubThreadId } }),
  gmailSyncNow: () =>
    request('/gmail/sync-now', { method: 'POST' }),

  // ===== INTAKE FORMS (public portal) =====
  getPortalForm: (token) =>
    request(`/portal/form/${token}`),
  submitPortalForm: (token, data) =>
    request(`/portal/form/${token}`, { method: 'POST', body: data }),

  // ===== BRAND SETTINGS =====
  getBrandSettings: () =>
    request('/brand'),
  updateBrandSettings: (data) =>
    request('/brand', { method: 'PUT', body: data }),
  uploadBrandLogo: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE}/brand/logo`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || 'Upload failed', res.status, data);
    }
    return res.json();
  },

  // ===== ONBOARDING =====
  onboardClient: (data) =>
    request('/onboarding/client', { method: 'POST', body: data }),
  getOnboardingProgress: () =>
    request('/onboarding/progress', { silent: true }),
  startOnboarding: () =>
    request('/onboarding/progress/start', { method: 'POST', silent: true }),
  skipOnboardingTask: (taskId) =>
    request('/onboarding/progress/tasks/skip', { method: 'POST', body: { taskId }, silent: true }),
  skipOnboarding: () =>
    request('/onboarding/progress/skip', { method: 'POST', silent: true }),
  restartOnboarding: () =>
    request('/onboarding/progress/restart', { method: 'POST', silent: true }),

  // ===== EMAIL SEND =====
  sendEmail: (data) =>
    request('/mailgun/send', { method: 'POST', body: data }),

  // ===== RETAINERS =====
  getRetainerList: () =>
    request('/retainers'),
  getRetainerStatus: (clientId) =>
    request(`/retainers/${clientId}/status`),
  getAllRetainers: () =>
    request('/retainers/check-all', { method: 'POST' }),
  logRetainerHours: (clientId, data) =>
    request(`/retainers/${clientId}/log-hours`, { method: 'POST', body: data }),
  createRetainerPlan: (data) =>
    request('/retainers', { method: 'POST', body: data }),
  updateRetainerPlan: (clientId, data) =>
    request(`/retainers/${clientId}`, { method: 'PUT', body: data }),
  generateRetainerInvoice: (clientId, data) =>
    request(`/retainers/${clientId}/generate-invoice`, { method: 'POST', body: data }),

  // ===== DEAL PIPELINE =====
  getPipelineStages: () =>
    request('/pipeline'),
  getPipelineAnalytics: () =>
    request('/pipeline/analytics'),
  createPipelineStage: (data) =>
    request('/pipeline/stages', { method: 'POST', body: data }),
  updatePipelineStage: (id, data) =>
    request(`/pipeline/stages/${id}`, { method: 'PUT', body: data }),
  deletePipelineStage: (id, moveToStageId) =>
    request(`/pipeline/stages/${id}?moveToStageId=${moveToStageId || ''}`, { method: 'DELETE' }),
  createPipelineDeal: (data) =>
    request('/pipeline/deals', { method: 'POST', body: data }),
  updatePipelineDeal: (id, data) =>
    request(`/pipeline/deals/${id}`, { method: 'PUT', body: data }),
  deletePipelineDeal: (id) =>
    request(`/pipeline/deals/${id}`, { method: 'DELETE' }),

  // ===== SEMANTIC SEARCH (CLIENT BRAIN) =====
  semanticSearch: (query, limit, clientId) => {
    const params = { q: query };
    if (limit) params.limit = limit;
    if (clientId) params.clientId = clientId;
    const queryStr = new URLSearchParams(params).toString();
    return request(`/semantic-search/search?${queryStr}`);
  },
  getEmbeddingStats: () =>
    request('/semantic-search/stats'),
  createEmbedding: (data) =>
    request('/semantic-search/embed', { method: 'POST', body: data }),
  rebuildClientBrain: (clientId) =>
    request(`/semantic-search/rebuild/${clientId}`, { method: 'POST' }),
  deleteEmbedding: (source, sourceId) =>
    request(`/semantic-search/embeddings/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }),

  // ===== CREATIVE BRIEF =====
  generateCreativeBrief: (data) =>
    request('/creative-brief/generate', { method: 'POST', body: data }),
  getAllCreativeBriefs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/creative-brief${query ? `?${query}` : ''}`);
  },
  getCreativeBriefs: (clientId) =>
    request(`/creative-brief/client/${clientId}`),
  getCreativeBrief: (id) =>
    request(`/creative-brief/${id}`),
  updateCreativeBrief: (id, data) =>
    request(`/creative-brief/${id}`, { method: 'PATCH', body: data }),
  deleteCreativeBrief: (id) =>
    request(`/creative-brief/${id}`, { method: 'DELETE' }),

  // ===== ASSET LIBRARY =====
  getAssets: (clientId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/assets/client/${clientId}${query ? `?${query}` : ''}`);
  },
  getAsset: (id) =>
    request(`/assets/${id}`),
  createAsset: (data) =>
    request('/assets', { method: 'POST', body: data }),
  updateAsset: (id, data) =>
    request(`/assets/${id}`, { method: 'PATCH', body: data }),
  deleteAsset: (id) =>
    request(`/assets/${id}`, { method: 'DELETE' }),
  searchAssets: (q, limit = 20) =>
    request(`/assets/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getAssetGuidelines: () =>
    request('/assets/guidelines'),
  updateAssetGuidelines: (data) =>
    request('/assets/guidelines', { method: 'POST', body: data }),

  // Ash Chat
  getAshChatConversations: () => request('/ash-chat/conversations'),
  getAshChatMessages: (id) => request(`/ash-chat/conversations/${id}/messages`),
  deleteAshChatConversation: (id) => request(`/ash-chat/conversations/${id}`, { method: 'DELETE' }),
  sendAshChatMessage: (data) => request('/ash-chat/message', { method: 'POST', body: data }),

  // API Keys
  getApiKeys: () => request('/api-keys'),
  createApiKey: (data) => request('/api-keys', { method: 'POST', body: data }),
  deleteApiKey: (id) => request(`/api-keys/${id}`, { method: 'DELETE' }),

  // Audit event log (admin only, read-only)
  getAuditEvents: (params = {}) => {
    const defined = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const query = new URLSearchParams(defined).toString();
    return request(`/audit-events${query ? `?${query}` : ''}`);
  },
  getAuditEventCatalog: () => request('/audit-events/catalog'),

  // ===== ESTIMATES =====
  getEstimates: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/estimates${query ? `?${query}` : ''}`);
  },
  getEstimate: (id) => request(`/estimates/${id}`),
  createEstimate: (data) => request('/estimates', { method: 'POST', body: data }),
  updateEstimate: (id, data) => request(`/estimates/${id}`, { method: 'PUT', body: data }),
  deleteEstimate: (id) => request(`/estimates/${id}`, { method: 'DELETE' }),
  sendEstimate: (id) => request(`/estimates/${id}/send`, { method: 'POST' }),
  getEstimateByToken: (viewToken) => request(`/estimates/view/${viewToken}`),
  approveEstimateByToken: (viewToken, action) => request(`/estimates/view/${viewToken}/approve`, { method: 'POST', body: { action } }),
  convertEstimate: (id) => request(`/estimates/${id}/convert`, { method: 'POST' }),

  // ===== RATE CARDS =====
  getRateCards: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/rate-cards${query ? `?${query}` : ''}`);
  },
  getRateCard: (id) => request(`/rate-cards/${id}`),
  createRateCard: (data) => request('/rate-cards', { method: 'POST', body: data }),
  updateRateCard: (id, data) => request(`/rate-cards/${id}`, { method: 'PUT', body: data }),
  deleteRateCard: (id) => request(`/rate-cards/${id}`, { method: 'DELETE' }),

  // ===== BUDGET =====
  getProjectBudget: (projectId) => request(`/projects/${projectId}/budget`),

  // ===== RESOURCE ALLOCATIONS =====
  getTeamAllocations: () => request('/team/allocations'),

  // ===== INTEGRATIONS =====
  getIntegrations: () => request('/integrations'),
  connectIntegration: (type) => request(`/integrations/${type}/connect`, { method: 'POST' }),
  disconnectIntegration: (type) => request(`/integrations/${type}/disconnect`, { method: 'POST' }),
  syncIntegration: (type) => request(`/integrations/${type}/sync`, { method: 'POST' }),

  // ===== TIMESHEETS =====
  getWeeklyTimesheet: (weekStart) => {
    const query = weekStart ? `?weekStart=${weekStart}` : '';
    return request(`/timesheets/weekly${query}`);
  },
  approveTimesheetEntry: (id) => request(`/timesheets/${id}/approve`, { method: 'PATCH' }),
  rejectTimesheetEntry: (id, reason) => request(`/timesheets/${id}/reject`, { method: 'PATCH', body: { reason } }),

  // ===== AUTOSAVE DRAFT =====
  saveDraft: (entity, id, data, expectedRevision, baseUpdatedAt) =>
    request(`/draft/${entity}/${id}`, {
      method: 'PUT',
      body: { data, expectedRevision, baseUpdatedAt },
      silent: true,
    }),
  getDraft: (entity, id) =>
    request(`/draft/${entity}/${id}`),
  clearDraft: (entity, id, revision) =>
    request(`/draft/${entity}/${id}${revision ? `?revision=${revision}` : ''}`, { method: 'DELETE', silent: true }),
};

export default api;
