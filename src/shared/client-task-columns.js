// The client portal's task board columns, shared by the API (which groups
// tasks into them, GET /api/client-portal/projects/:id/tasks) and the web
// app's public project link (imported there as `@shared/client-task-columns`).
// Plain JavaScript with no imports so both runtimes can load it.
//
// Every task status maps to exactly one column, so no task disappears from
// the board; WAITING_CLIENT gets its own "Waiting on you" column, and the
// internal WAITING_US reads as "In Progress" to the client.
export const CLIENT_TASK_COLUMN_STATUSES = Object.freeze({
  TODO: Object.freeze(['PENDING', 'UPCOMING', 'IMMEDIATE', 'TODO']),
  IN_PROGRESS: Object.freeze(['IN_PROGRESS', 'WAITING_US']),
  WAITING_CLIENT: Object.freeze(['WAITING_CLIENT']),
  REVIEW: Object.freeze(['REVIEW']),
  BLOCKED: Object.freeze(['BLOCKED']),
  DONE: Object.freeze(['COMPLETED']),
});
