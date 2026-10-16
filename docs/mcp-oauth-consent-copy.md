# ChatGPT consent screen

The consent screen keeps read access as its default. It displays an optional
checkbox only when both the original request and the server's allowed choices
include that known capability. Both checkboxes start unchecked:

- Create client task proposals and confirm them.
- Publish saved client reports, including replacement or removal.

Selecting neither submits only `workspace:read` for a request that offered
optional actions. Read-only requests preserve their existing request format.
Cancel submits denial without selected scopes. The screen never adds a scope
that was absent from the original request. Server authorization, Origin checks,
recent authentication and the single-use nonce remain authoritative.

The selected capabilities are listed before approval. Copy explains that an
authorized ChatGPT/API caller can review a preview and call `confirm_action`;
this does not promise a separate human click in Hub for every action. These
scopes do not enable email sending or external provider actions. Existing
connections remain read-only. Revocation instructions show the matching grant
name: `ChatGPT (read-only MCP)` or `ChatGPT (scoped MCP actions)`.

A changed authorization request remounts consent state so selections, pending
state and nonce cannot carry over. Late responses from the previous request
cannot replace the new preview or redirect its page. While submission is
pending, choices and buttons are disabled; cancelled recent authentication
keeps the selection available for review and retry.

UI verification uses mocked consent responses and never creates an OAuth grant,
calls a provider, or confirms a real task or report action.
