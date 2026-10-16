/** Default budget stays unchanged for every tool outside the closed list. */
export const MAX_TOOL_INPUT_BYTES = 16 * 1024;
export const MAX_RESOURCE_LINK_INPUT_BYTES = 512 * 1024;

// The domain allows 500 reorder entries with IDs up to 100 UTF-16 units.
// JSON escaping can consume six bytes per unit: under 325 KiB including
// revisions, target and fingerprint. A create with both 8192-unit URLs and
// maximal immutable provenance remains under 115 KiB. The 512 KiB bound
// covers those complete inputs without a caller- or tool-configurable limit.
const expandedResourceLinkTools = new Set([
  'preview_create_resource_link', 'create_resource_link',
  'preview_update_resource_link', 'update_resource_link',
  'preview_reorder_resource_links', 'reorder_resource_links',
]);

export const toolInputByteLimit = name => expandedResourceLinkTools.has(name)
  ? MAX_RESOURCE_LINK_INPUT_BYTES : MAX_TOOL_INPUT_BYTES;
