// API client for Agency Hub

// Use VITE_API_URL for production (external backend), fallback to /api for dev (proxied)
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Default request timeout (30 seconds)
const DEFAULT_TIMEOUT = 30000;

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
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

function dispatchApiError(error, endpoint) {
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

  // Dispatch to global callback if set
  if (onApiError) {
    onApiError(error, endpoint);
  }
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const silent = options.silent ?? false;

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
        dispatchApiError(error, endpoint);
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
        data
      );
      if (!silent) {
        dispatchApiError(error, endpoint);
      }
      throw error;
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle timeout errors
    if (error.name === 'AbortError') {
      const timeoutError = new TimeoutError(timeout);
      dispatchApiError(timeoutError, endpoint);
      throw timeoutError;
    }

    // Handle network errors
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      const networkError = new Error('Network error. Please check your connection.');
      networkError.name = 'NetworkError';
      dispatchApiError(networkError, endpoint);
      throw networkError;
    }

    // Re-throw ApiError instances
    if (error instanceof ApiError) {
      throw error;
    }

    // Log and re-throw other errors
    dispatchApiError(error, endpoint);
    throw error;
  }
}

export const api = {
  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password } }),
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

  // Analytics (legacy)
  getDashboard: () =>
    request('/analytics/dashboard'),
  getOverview: (days = 30) =>
    request(`/analytics/overview?days=${days}`),
  getResponseTimes: (days = 30) =>
    request(`/analytics/response-times?days=${days}`),
  getTeamAnalytics: (days = 30) =>
    request(`/analytics/team?days=${days}`),
  getAnalyticsTrends: (days = 30) =>
    request(`/analytics/trends?days=${days}`),
  getAiAccuracy: (days = 30) =>
    request(`/analytics/ai-accuracy?days=${days}`),

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
  getClientHealthDashboard: (status = 'ACTIVE') =>
    request(`/client-health/health/dashboard?status=${status}`),
  getClientHealthAtRisk: () =>
    request('/client-health/health/at-risk'),
  getClientHealthRecommendations: () =>
    request('/client-health/health/recommendations'),
  recalculateClientHealth: (clientId) =>
    request('/client-health/health/recalculate', { method: 'POST', body: clientId ? { clientId } : {} }),
  getSingleClientHealth: (clientId) =>
    request(`/client-health/health/${clientId}`),
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
  createNote: (projectId, data) =>
    request(`/projects/${projectId}/notes`, { method: 'POST', body: data }),
  updateNote: (id, data) =>
    request(`/notes/${id}`, { method: 'PUT', body: data }),
  deleteNote: (id) =>
    request(`/notes/${id}`, { method: 'DELETE' }),
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
    request('/time-tracking', { method: 'POST', body: data }),
  updateTimeEntry: (id, data) =>
    request(`/time-tracking/${id}`, { method: 'PUT', body: data }),
  deleteTimeEntry: (id) =>
    request(`/time-tracking/${id}`, { method: 'DELETE' }),
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

  // Activity Feed
  getProjectActivity: (projectId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/projects/${projectId}/activity${query ? `?${query}` : ''}`);
  },
  getActivity: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/activity${query ? `?${query}` : ''}`);
  },
  getMyActivity: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/activity/my${query ? `?${query}` : ''}`);
  },
  getActivitySummary: (days = 7) =>
    request(`/activity/summary?days=${days}`),

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

  // Attachments
  getAttachments: (entityType, entityId) =>
    request(`/attachments?entityType=${entityType}&entityId=${entityId}`),
  deleteAttachment: (id) =>
    request(`/attachments/${id}`, { method: 'DELETE' }),
  // Note: File upload uses FormData, handled separately in components

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
  getCredential: (id) =>
    request(`/credentials/${id}`),
  getCredentialPassword: (id) =>
    request(`/credentials/${id}/password`),
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
    request(`/portal/proposal/${token}/respond`, { method: 'POST', body: data }),
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

  // ===== OUTREACH =====
  getOutreachLeads: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/outreach/leads${query ? `?${query}` : ''}`);
  },
  addOutreachLead: (data) =>
    request('/outreach/leads', { method: 'POST', body: data }),
  searchOutreachLeads: (data) =>
    request('/outreach/leads/search', { method: 'POST', body: data }),
  updateOutreachLead: (id, data) =>
    request(`/outreach/leads/${id}`, { method: 'PATCH', body: data }),
  generateOutreachEmail: (data) =>
    request('/outreach/email/generate', { method: 'POST', body: data }),
  getOutreachSequences: () =>
    request('/outreach/sequences'),
  createOutreachSequence: (data) =>
    request('/outreach/sequences', { method: 'POST', body: data }),
  updateOutreachSequence: (id, data) =>
    request(`/outreach/sequences/${id}`, { method: 'PATCH', body: data }),
  runOutreachSequence: (id) =>
    request(`/outreach/sequences/${id}/run`, { method: 'POST' }),

  // ===== SOCIAL =====
  getSocialPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/social/posts${query ? `?${query}` : ''}`);
  },
  generateSocialPost: (data) =>
    request('/social/generate', { method: 'POST', body: data }),
  saveSocialPost: (data) =>
    request('/social/posts', { method: 'POST', body: data }),
  updateSocialPost: (id, data) =>
    request(`/social/posts/${id}`, { method: 'PUT', body: data }),
  deleteSocialPost: (id) =>
    request(`/social/posts/${id}`, { method: 'DELETE' }),

  // ===== BLOG =====
  getBlogPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/blog/posts${query ? `?${query}` : ''}`);
  },
  getBlogPost: (id) =>
    request(`/blog/posts/${id}`),
  generateBlogPost: (data) =>
    request('/blog/generate', { method: 'POST', body: data }),
  generateBlogKeywords: (topic) =>
    request('/blog/keywords', { method: 'POST', body: { topic } }),
  updateBlogPost: (id, data) =>
    request(`/blog/posts/${id}`, { method: 'PUT', body: data }),
  publishBlogPost: (id) =>
    request(`/blog/publish/${id}`, { method: 'POST' }),
  deleteBlogPost: (id) =>
    request(`/blog/posts/${id}`, { method: 'DELETE' }),

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

  // ===== CONTENT WRITER AGENT =====
  generateContentBlog: (data) =>
    request('/content-writer/blog', { method: 'POST', body: data }),
  generateContentSocial: (data) =>
    request('/content-writer/social', { method: 'POST', body: data }),
  generateContentLinkedIn: (data) =>
    request('/content-writer/linkedin-article', { method: 'POST', body: data }),
  getContentDrafts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/content-writer/drafts${query ? `?${query}` : ''}`);
  },
  getContentDraft: (id) =>
    request(`/content-writer/drafts/${id}`),
  updateContentDraft: (id, data) =>
    request(`/content-writer/drafts/${id}`, { method: 'PUT', body: data }),
  deleteContentDraft: (id) =>
    request(`/content-writer/drafts/${id}`, { method: 'DELETE' }),

  // ===== LINKEDIN OUTREACH AGENT =====
  generateLinkedInSequence: (data) =>
    request('/linkedin-outreach/sequence', { method: 'POST', body: data }),
  getLinkedInSequences: () =>
    request('/linkedin-outreach/sequences'),
  getLinkedInSequence: (id) =>
    request(`/linkedin-outreach/sequences/${id}`),
  deleteLinkedInSequence: (id) =>
    request(`/linkedin-outreach/sequences/${id}`, { method: 'DELETE' }),
  importLinkedInProspects: (data) =>
    request('/linkedin-outreach/prospects', { method: 'POST', body: data }),
  getLinkedInProspects: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/linkedin-outreach/prospects${query ? `?${query}` : ''}`);
  },

  // ===== COLD EMAIL AGENT =====
  generateColdEmailSequence: (data) =>
    request('/cold-email/sequence', { method: 'POST', body: data }),
  getColdEmailSequences: () =>
    request('/cold-email/sequences'),
  getColdEmailSequence: (id) =>
    request(`/cold-email/sequences/${id}`),
  deleteColdEmailSequence: (id) =>
    request(`/cold-email/sequences/${id}`, { method: 'DELETE' }),
  importColdEmailProspects: (data) =>
    request('/cold-email/prospects', { method: 'POST', body: data }),
  getColdEmailProspects: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/cold-email/prospects${query ? `?${query}` : ''}`);
  },

  // ===== CALL SCREENER AGENT =====
  screenCall: (data) =>
    request('/call-screener/screen', { method: 'POST', body: data }),
  saveCallSummary: (data) =>
    request('/call-screener/summary', { method: 'POST', body: data }),
  getCallLog: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/call-screener/calls${query ? `?${query}` : ''}`);
  },
  generateCallFollowUp: (callId) =>
    request(`/call-screener/follow-up/${callId}`, { method: 'POST' }),

  // ===== LEAD GEN — Lead Pipeline =====
  leadGenFindLeads: (data) =>
    request('/lead-gen/find-leads', { method: 'POST', body: data }),
  leadGenGenerateSequence: (prospectId) =>
    request(`/lead-gen/sequence/${prospectId}`, { method: 'POST' }),
  leadGenGetPipeline: () =>
    request('/lead-gen/pipeline'),
  leadGenUpdateStatus: (id, data) =>
    request(`/lead-gen/status/${id}`, { method: 'PUT', body: data }),

  // ===== SOCIAL CONTENT — Content Studio =====
  socialContentGenerate: (data) =>
    request('/social-content/generate', { method: 'POST', body: data }),
  socialContentGetCalendar: () =>
    request('/social-content/calendar'),
  socialContentSchedule: (data) =>
    request('/social-content/schedule', { method: 'POST', body: data }),
  socialContentPublish: (id) =>
    request(`/social-content/publish/${id}`, { method: 'POST' }),
  socialContentGetPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/social-content/posts${query ? `?${query}` : ''}`);
  },
  socialContentSave: (data) =>
    request('/social-content/save', { method: 'POST', body: data }),
  socialContentApprove: (id) =>
    request(`/social-content/approve/${id}`, { method: 'PUT' }),
  socialContentUpdatePost: (id, data) =>
    request(`/social-content/posts/${id}`, { method: 'PUT', body: data }),
  socialContentDeletePost: (id) =>
    request(`/social-content/posts/${id}`, { method: 'DELETE' }),

  // ===== SEO BLOG =====
  seoBlogGenerateBlog: (data) =>
    request('/seo-blog/blog', { method: 'POST', body: data }),
  seoBlogGetPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/seo-blog/posts${query ? `?${query}` : ''}`);
  },
  seoBlogGetPost: (id) =>
    request(`/seo-blog/posts/${id}`),
  seoBlogUpdatePost: (id, data) =>
    request(`/seo-blog/posts/${id}`, { method: 'PUT', body: data }),
  seoBlogApprove: (id) =>
    request(`/seo-blog/approve/${id}`, { method: 'PUT' }),
  seoBlogPublish: (id) =>
    request(`/seo-blog/publish/${id}`, { method: 'POST' }),
  seoBlogDelete: (id) =>
    request(`/seo-blog/posts/${id}`, { method: 'DELETE' }),

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
    request('/settings/ai-context'),
  getAiContextPrompt: () =>
    request('/settings/ai-context/prompt'),
  saveAiContext: ({ key, value }) =>
    request('/settings/ai-context', { method: 'POST', body: { key, value } }),
  deleteAiContext: (key) =>
    request(`/settings/ai-context/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // ===== COMMAND CENTER =====
  getCommandCenter: () =>
    request('/command-center'),
  pingCommandCenter: () =>
    request('/command-center/ping'),

  // GitHub integration
  getGithubRepos: () =>
    request('/integrations/github/repos'),
  getGithubPulls: () =>
    request('/integrations/github/pulls'),
  getGithubDeploys: () =>
    request('/integrations/github/deploys'),
  triggerDeploy: (appUuid) =>
    request(`/integrations/github/deploy/${appUuid}`, { method: 'POST' }),

  // VPS / Coolify
  getVpsHealth: () =>
    request('/integrations/vps/health'),
  restartApp: (uuid) =>
    request(`/integrations/vps/restart/${uuid}`, { method: 'POST' }),
  stopApp: (uuid) =>
    request(`/integrations/vps/stop/${uuid}`, { method: 'POST' }),
  startApp: (uuid) =>
    request(`/integrations/vps/start/${uuid}`, { method: 'POST' }),
  getAppLogs: (uuid, lines = 100) =>
    request(`/integrations/vps/logs/${uuid}?lines=${lines}`),

  // Hostinger sites
  getHostingerSites: () =>
    request('/integrations/hostinger/sites'),
  getHostingerStores: () =>
    request('/integrations/hostinger/stores'),
  probeSite: (domain) =>
    request(`/integrations/hostinger/sites/${encodeURIComponent(domain)}`),

  // Agents
  getAgentsStatus: () =>
    request('/agents/status'),
  runAgent: (name) =>
    request(`/agents/run/${name}`, { method: 'POST' }),
  getAgentLogs: () =>
    request('/agents/logs'),
  getAgentLog: (date) =>
    request(`/agents/logs/${date}`),

  // ===== UPWORK CONTRACT TRACKER =====
  getUpworkContracts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/upwork-contracts${query ? `?${query}` : ''}`);
  },
  getUpworkContract: (id) =>
    request(`/upwork-contracts/${id}`),
  createUpworkContract: (data) =>
    request('/upwork-contracts', { method: 'POST', body: data }),
  updateUpworkContract: (id, data) =>
    request(`/upwork-contracts/${id}`, { method: 'PUT', body: data }),
  deleteUpworkContract: (id) =>
    request(`/upwork-contracts/${id}`, { method: 'DELETE' }),

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

  // ===== INTAKE FORMS =====
  getIntakeForms: () =>
    request('/intake-forms'),
  getIntakeForm: (id) =>
    request(`/intake-forms/${id}`),
  createIntakeForm: (data) =>
    request('/intake-forms', { method: 'POST', body: data }),
  updateIntakeForm: (id, data) =>
    request(`/intake-forms/${id}`, { method: 'PUT', body: data }),
  deleteIntakeForm: (id) =>
    request(`/intake-forms/${id}`, { method: 'DELETE' }),
  // Public portal form
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

  // ===== REVENUE =====
  getRevenueDashboard: (refresh = false) =>
    request(`/revenue/dashboard${refresh ? '?refresh=true' : ''}`),
  getRevenueMrr: () =>
    request('/revenue/mrr'),
  getRevenueTrends: () =>
    request('/revenue/trends'),

  // ===== ONBOARDING =====
  onboardClient: (data) =>
    request('/onboarding/client', { method: 'POST', body: data }),

  // ===== EMAIL SEND =====
  sendEmail: (data) =>
    request('/mailgun/send', { method: 'POST', body: data }),

  // ===== RETAINERS =====
  getRetainerList: () =>
    request('/retainer'),
  getRetainerStatus: (clientId) =>
    request(`/retainer/${clientId}/status`),
  getAllRetainers: () =>
    request('/retainer/check-all', { method: 'POST' }),
  logRetainerHours: (clientId, data) =>
    request(`/retainer/${clientId}/log-hours`, { method: 'POST', body: data }),
  createRetainerPlan: (data) =>
    request('/retainer', { method: 'POST', body: data }),
  updateRetainerPlan: (clientId, data) =>
    request(`/retainer/${clientId}`, { method: 'PUT', body: data }),
  generateRetainerInvoice: (clientId, data) =>
    request(`/retainer/${clientId}/generate-invoice`, { method: 'POST', body: data }),

  // ===== FINANCIAL REPORTS =====
  getReportsPnl: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/reports/pnl${query ? `?${query}` : ''}`);
  },
  getClientProfitability: () =>
    request('/reports/client-profitability'),
  getTeamUtilization: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/reports/team-utilization${query ? `?${query}` : ''}`);
  },
  getPipeline: () =>
    request('/reports/pipeline'),

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
    request(`/semantic-search/embeddings/${source}/${sourceId}`, { method: 'DELETE' }),

  // ===== AD COPY GENERATOR =====
  generateAdCopy: (data) =>
    request('/ad-copy/generate', { method: 'POST', body: data }),
  getAdCopies: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/ad-copy${query ? `?${query}` : ''}`);
  },
  getAdCopy: (id) =>
    request(`/ad-copy/${id}`),
  updateAdCopyStatus: (id, status) =>
    request(`/ad-copy/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteAdCopy: (id) =>
    request(`/ad-copy/${id}`, { method: 'DELETE' }),

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

  // ===== SEO AUDIT =====
  runSeoAudit: (data) =>
    request('/seo/audit', { method: 'POST', body: data }),
  getAllSeoAudits: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/seo${query ? `?${query}` : ''}`);
  },
  getSeoAudits: (clientId) =>
    request(`/seo/client/${clientId}`),
  getSeoAudit: (id) =>
    request(`/seo/${id}`),
  deleteSeoAudit: (id) =>
    request(`/seo/${id}`, { method: 'DELETE' }),

  // ===== CONTENT CALENDAR =====
  getContentEvents: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/content/events${query ? `?${query}` : ''}`);
  },
  getContentEvent: (id) =>
    request(`/content/events/${id}`),
  createContentEvent: (data) =>
    request('/content/events', { method: 'POST', body: data }),
  updateContentEvent: (id, data) =>
    request(`/content/events/${id}`, { method: 'PATCH', body: data }),
  updateContentEventStatus: (id, status) =>
    request(`/content/events/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteContentEvent: (id) =>
    request(`/content/events/${id}`, { method: 'DELETE' }),
  getUpcomingContent: (limit = 10) =>
    request(`/content/upcoming?limit=${limit}`),

  // ===== SOCIAL SCHEDULER =====
  generateSocialPosts: (data) =>
    request('/scheduler/generate', { method: 'POST', body: data }),
  scheduleSocialPost: (data) =>
    request('/scheduler/schedule', { method: 'POST', body: data }),
  getScheduledPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/scheduler/posts${query ? `?${query}` : ''}`);
  },
  getSocialPost: (id) =>
    request(`/scheduler/posts/${id}`),
  updateSocialPostStatus: (id, status) =>
    request(`/scheduler/posts/${id}/status`, { method: 'PATCH', body: { status } }),
  deleteSchedulerPost: (id) =>
    request(`/scheduler/posts/${id}`, { method: 'DELETE' }),
  getSocialAnalytics: () =>
    request('/scheduler/analytics'),

  // ===== SNIPPET LIBRARY =====
  getSnippets: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/snippets${query ? `?${query}` : ''}`);
  },
  searchSnippets: (q, limit = 20) =>
    request(`/snippets/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getPopularSnippets: (limit = 10) =>
    request(`/snippets/popular?limit=${limit}`),
  getSnippet: (id) =>
    request(`/snippets/${id}`),
  createSnippet: (data) =>
    request('/snippets', { method: 'POST', body: data }),
  updateSnippet: (id, data) =>
    request(`/snippets/${id}`, { method: 'PATCH', body: data }),
  deleteSnippet: (id) =>
    request(`/snippets/${id}`, { method: 'DELETE' }),

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

  // ===== WP BRIDGE =====
  listWPSites: () =>
    request('/wp-bridge'),
  registerWPSite: (data) =>
    request('/wp-bridge', { method: 'POST', body: data }),
  updateWPSiteHealth: (data) =>
    request('/wp-bridge', { method: 'PUT', body: data }),
  deleteWPSite: (id) =>
    request(`/wp-bridge?id=${id}`, { method: 'DELETE' }),
  generateWPMagicLogin: (siteId) =>
    request(`/wp-bridge/magic-login?siteId=${siteId}`),

  // ===== SURVEYS / NPS =====
  submitSurvey: (data) =>
    request('/surveys/submit', { method: 'POST', body: data }),
  getSurveyResponses: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/surveys/responses${query ? `?${query}` : ''}`);
  },
  getNpsMetrics: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/surveys/metrics${query ? `?${query}` : ''}`);
  },
  getAtRiskClients: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/surveys/at-risk-clients${query ? `?${query}` : ''}`);
  },
  getClientSurveyHistory: (clientId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/surveys/clients/${clientId}${query ? `?${query}` : ''}`);
  },

  // Ash Chat
  getAshChatConversations: () => request('/ash-chat/conversations'),
  getAshChatMessages: (id) => request(`/ash-chat/conversations/${id}/messages`),
  deleteAshChatConversation: (id) => request(`/ash-chat/conversations/${id}`, { method: 'DELETE' }),
  sendAshChatMessage: (data) => request('/ash-chat/message', { method: 'POST', body: data }),

  // API Keys
  getApiKeys: () => request('/api-keys'),
  createApiKey: (data) => request('/api-keys', { method: 'POST', body: data }),
  deleteApiKey: (id) => request(`/api-keys/${id}`, { method: 'DELETE' }),
};

export default api;
