// Closed list: these receipts require their current client/source authority.
export const WORKSPACE_BOUND_ACTIONS = Object.freeze(['create_task_from_client_message', 'create_client_task']);
export const isWorkspaceBoundAction = name => WORKSPACE_BOUND_ACTIONS.includes(name);
