// Controlled, one-way import of a Slack workspace export into project chat
// (#414). Playbook: docs/slack-export-migration.md.
//
// Mirrors the Notion Markdown importer's contract: a dry run plans without
// writing; a live run writes everything in one transaction and rolls back on
// any reconciliation finding; every imported message gets a durable
// reconciliation record keyed by Slack channel id + message ts, so reruns do
// not duplicate and a changed source is reported rather than overwritten.
// Each live run is recorded in `import_runs` and can be rolled back by id.
//
// Only an already-extracted export directory is accepted (as with Notion).
// Every path is resolved inside the export root, symlinks are refused and
// JSON files are size-capped before they are read.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { recordAuditEvent } from './audit-event.service.js';

export const SLACK_IMPORT_SOURCE = 'SLACK_EXPORT';
const SLACK_EXTERNAL_SOURCE = 'SLACK';
const SOURCE_PREFIX = 'slack-export:';
export const MAX_EXPORT_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CHAT_EMOJI_LENGTH = 20; // chat reaction validator limit
const QUERY_CHUNK = 500;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10 * 60_000 };

// Slack message subtypes that carry a person's message. Everything else
// (joins, topic changes, bot posts, tombstones, ...) is skipped and counted.
const IMPORTABLE_SUBTYPES = new Set([undefined, 'thread_broadcast', 'file_share', 'me_message']);
const KNOWN_TOP_LEVEL_FILES = new Set(['channels.json', 'users.json', 'groups.json', 'dms.json', 'mpims.json']);
const CHANNEL_ID = /^[CG][A-Z0-9]{2,40}$/;
const CHANNEL_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/;

const EMOJI = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', heart: '❤️', smile: '😄',
  slightly_smiling_face: '🙂', joy: '😂', laughing: '😆', tada: '🎉', white_check_mark: '✅',
  heavy_check_mark: '✔️', eyes: '👀', pray: '🙏', fire: '🔥', raised_hands: '🙌', clap: '👏',
  100: '💯', rocket: '🚀', ok_hand: '👌', thinking_face: '🤔', wave: '👋', x: '❌', star: '⭐',
};

export class SlackExportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Raised inside the live transaction so every write in it is rolled back. */
export class SlackImportBlockedError extends Error {
  constructor(report) {
    super('Live import cannot complete with unresolved reconciliation findings');
    this.code = 'IMPORT_BLOCKED';
    this.report = report;
  }
}

export function slackSourceKey(channelId, ts) {
  return `${SOURCE_PREFIX}${channelId}:${ts}`;
}

function compareTs(left, right) {
  const [leftSeconds, leftMicros = '0'] = left.split('.');
  const [rightSeconds, rightMicros = '0'] = right.split('.');
  return (Number(leftSeconds) - Number(rightSeconds)) || (Number(leftMicros.padEnd(9, '0')) - Number(rightMicros.padEnd(9, '0')));
}

function tsToDate(ts) {
  const date = new Date(Math.round(Number(ts) * 1000));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve a relative export path inside `root`. Rejects absolute paths,
 * `..` segments and anything that resolves outside the root (zip-slip style
 * traversal via crafted channel names).
 */
export function resolveInsideExport(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new SlackExportError('UNSAFE_PATH', 'Slack export paths must be relative to the export root');
  }
  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) {
    throw new SlackExportError('UNSAFE_PATH', 'Slack export paths must be relative to the export root');
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new SlackExportError('UNSAFE_PATH', 'Slack export paths must be relative to the export root');
  }
  return resolved;
}

async function lstatInside(root, relativePath) {
  const target = resolveInsideExport(root, relativePath);
  try {
    return { target, stat: await fs.lstat(target) };
  } catch (error) {
    if (error.code === 'ENOENT') return { target, stat: null };
    throw error;
  }
}

async function readExportJson(root, relativePath, { required = false } = {}) {
  const { target, stat } = await lstatInside(root, relativePath);
  if (!stat) {
    if (required) throw new SlackExportError('MISSING_FILE', `Slack export is missing ${relativePath}`);
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new SlackExportError('UNSAFE_PATH', `${relativePath} must be a regular file, not a link or directory`);
  }
  if (stat.size > MAX_EXPORT_JSON_BYTES) {
    throw new SlackExportError('FILE_TOO_LARGE', `${relativePath} exceeds the ${MAX_EXPORT_JSON_BYTES}-byte import limit`);
  }
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    throw new SlackExportError('INVALID_JSON', `${relativePath} is not valid JSON`);
  }
}

export const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * Make export-supplied text safe to store and print: strip control and
 * format characters (including bidi overrides and zero-width marks),
 * collapse whitespace, and cap the length.
 */
export function sanitizeDisplayText(value, max = MAX_DISPLAY_NAME_LENGTH) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? [...cleaned].slice(0, max).join('') : null;
}

function displayName(user) {
  const profile = user?.profile ?? {};
  for (const value of [profile.display_name, profile.real_name, user?.real_name, user?.name]) {
    const cleaned = sanitizeDisplayText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => file && typeof file === 'object')
    // URLs are never kept: export file URLs can embed access tokens.
    .map((file) => ({
      id: typeof file.id === 'string' ? file.id : null,
      name: typeof file.name === 'string' ? file.name : (typeof file.title === 'string' ? file.title : null),
      mimetype: typeof file.mimetype === 'string' ? file.mimetype : null,
      size: Number.isFinite(file.size) ? file.size : null,
    }));
}

function normalizeReactions(reactions) {
  if (!Array.isArray(reactions)) return [];
  return reactions
    .filter((reaction) => reaction && typeof reaction.name === 'string')
    .map((reaction) => ({
      name: reaction.name,
      users: Array.isArray(reaction.users) ? reaction.users.filter((user) => typeof user === 'string') : [],
      count: Number.isFinite(reaction.count) ? reaction.count : 0,
    }));
}

function contentSha256(message) {
  const canonical = JSON.stringify({
    text: message.text,
    user: message.userId,
    threadTs: message.threadTs,
    files: message.files.map((file) => file.id),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Parse one channel day file's messages. Returns importable messages and
 * counts skipped subtypes; never throws for an individual bad message.
 */
export function parseSlackMessages(rawMessages, { channelName, file } = {}) {
  const messages = [];
  const skipped = {};
  const warnings = [];
  if (!Array.isArray(rawMessages)) {
    warnings.push({ code: 'INVALID_DAY_FILE', file, error: 'Day file is not a JSON array of messages' });
    return { messages, skipped, warnings };
  }
  const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object' || raw.type !== 'message') { skip('non_message'); continue; }
    if (typeof raw.ts !== 'string' || !SLACK_TS.test(raw.ts)) {
      skip('invalid_ts');
      warnings.push({ code: 'INVALID_TS', file, channel: channelName, error: 'Message has no valid Slack ts' });
      continue;
    }
    if (raw.subtype === 'bot_message' || (raw.bot_id && !raw.user) || raw.user === 'USLACKBOT') { skip('bot_message'); continue; }
    if (!IMPORTABLE_SUBTYPES.has(raw.subtype)) { skip(String(raw.subtype)); continue; }
    // Slack adds thread_ts == ts to a root once it gets its first reply. A
    // root is not a reply, so normalise that away before hashing; otherwise a
    // later, overlapping export would look like a changed source.
    const threadTs = typeof raw.thread_ts === 'string' && SLACK_TS.test(raw.thread_ts) && raw.thread_ts !== raw.ts
      ? raw.thread_ts : null;
    const message = {
      ts: raw.ts,
      threadTs,
      isReply: Boolean(threadTs),
      userId: typeof raw.user === 'string' ? raw.user : null,
      text: typeof raw.text === 'string' ? raw.text : '',
      subtype: raw.subtype ?? null,
      editedTs: typeof raw.edited?.ts === 'string' && SLACK_TS.test(raw.edited.ts) ? raw.edited.ts : null,
      reactions: normalizeReactions(raw.reactions),
      files: normalizeFiles(raw.files),
      userProfileName: displayName({ profile: raw.user_profile }),
    };
    message.contentSha256 = contentSha256(message);
    messages.push(message);
  }
  return { messages, skipped, warnings };
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

/**
 * Read an extracted Slack workspace export directory: channels.json,
 * users.json, optional groups.json (private channels, Business+ exports) and
 * `<channel>/<YYYY-MM-DD>.json` day files.
 */
export async function readSlackExport(inputDir) {
  const resolvedInput = path.resolve(inputDir);
  const inputStat = await fs.stat(resolvedInput).catch(() => null);
  if (!inputStat) throw new SlackExportError('MISSING_INPUT', `Slack export not found: ${resolvedInput}`);
  if (inputStat.isFile() && resolvedInput.toLowerCase().endsWith('.zip')) {
    throw new SlackExportError('ZIP_NOT_SUPPORTED', 'Extract the Slack export ZIP to a new directory and pass that directory');
  }
  if (!inputStat.isDirectory()) throw new SlackExportError('NOT_A_DIRECTORY', `Input is not a directory: ${resolvedInput}`);
  const root = await fs.realpath(resolvedInput);

  // channelFindings are classified later: blocking errors when the channel
  // is mapped for import, warnings when it is not.
  const findings = { errors: [], warnings: [], channelFindings: [], unsupportedFiles: [], unsupportedConversations: [], unknownDirectories: [] };
  const [rawUsers, rawChannels, rawGroups, rawDms, rawMpims] = await Promise.all([
    readExportJson(root, 'users.json', { required: true }),
    readExportJson(root, 'channels.json', { required: true }),
    readExportJson(root, 'groups.json'),
    readExportJson(root, 'dms.json'),
    readExportJson(root, 'mpims.json'),
  ]);

  const users = new Map();
  for (const user of Array.isArray(rawUsers) ? rawUsers : []) {
    if (!user || typeof user.id !== 'string') continue;
    users.set(user.id, {
      id: user.id,
      name: displayName(user) || user.id,
      email: typeof user.profile?.email === 'string' ? user.profile.email.trim().toLowerCase() : null,
      isBot: Boolean(user.is_bot) || user.id === 'USLACKBOT',
    });
  }

  for (const [label, list] of [['dms.json', rawDms], ['mpims.json', rawMpims]]) {
    if (Array.isArray(list) && list.length) {
      findings.unsupportedConversations.push({ file: label, count: list.length, reason: 'Direct and group messages are not imported into project chat' });
    }
  }

  const channelDefinitions = [
    ...(Array.isArray(rawChannels) ? rawChannels.map((channel) => ({ channel, isPrivate: false })) : []),
    ...(Array.isArray(rawGroups) ? rawGroups.map((channel) => ({ channel, isPrivate: true })) : []),
  ];
  const channels = [];
  const channelNames = new Set();
  const channelIds = new Set();
  const channelFinding = (code, id, name, error) => findings.channelFindings.push({
    code, channelId: typeof id === 'string' ? sanitizeDisplayText(id, 80) : null, channel: sanitizeDisplayText(name, 80), error,
  });
  for (const { channel, isPrivate } of channelDefinitions) {
    const id = channel?.id;
    const name = channel?.name;
    if (typeof id !== 'string' || !CHANNEL_ID.test(id)) {
      channelFinding('INVALID_CHANNEL', null, name, 'Channel has no valid Slack id');
      continue;
    }
    if (typeof name !== 'string' || !CHANNEL_NAME.test(name) || name === '.' || name === '..') {
      channelFinding('UNSAFE_CHANNEL_NAME', id, name, 'Channel name is not a safe export directory name');
      continue;
    }
    if (channelIds.has(id)) {
      findings.warnings.push({ code: 'DUPLICATE_CHANNEL', channelId: id, error: 'Channel is listed more than once; the first entry is used' });
      continue;
    }
    if (channelNames.has(name)) {
      channelFinding('DUPLICATE_CHANNEL_NAME', id, name, 'Another channel in this export has the same directory name');
      continue;
    }
    const { target, stat } = await lstatInside(root, name);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
      channelFinding('UNSAFE_PATH', id, name, 'Channel export entry must be a real directory');
      continue;
    }
    channelIds.add(id);
    channelNames.add(name);
    const entry = { id, name, isPrivate, isArchived: Boolean(channel.is_archived), messages: [], skipped: {}, dayFiles: 0 };
    channels.push(entry);
    if (!stat) continue;
    const byTs = new Map();
    const dayEntries = (await fs.readdir(target, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const dayEntry of dayEntries) {
      const relative = `${name}/${dayEntry.name}`;
      if (!dayEntry.isFile() || !DAY_FILE.test(dayEntry.name)) {
        findings.unsupportedFiles.push(relative);
        continue;
      }
      entry.dayFiles++;
      const parsed = parseSlackMessages(await readExportJson(root, relative), { channelName: name, file: relative });
      mergeCounts(entry.skipped, parsed.skipped);
      findings.warnings.push(...parsed.warnings);
      for (const message of parsed.messages) {
        if (byTs.has(message.ts)) {
          findings.warnings.push({ code: 'DUPLICATE_TS', channel: name, ts: message.ts, error: 'The same message appears more than once in the export' });
          continue;
        }
        byTs.set(message.ts, message);
      }
    }
    entry.messages = [...byTs.values()].sort((left, right) => compareTs(left.ts, right.ts));
  }

  const topLevel = (await fs.readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const item of topLevel) {
    if (item.isDirectory() && !item.isSymbolicLink()) {
      if (!channelNames.has(item.name)) findings.unknownDirectories.push(item.name);
    } else if (!KNOWN_TOP_LEVEL_FILES.has(item.name)) {
      findings.unsupportedFiles.push(item.name);
    }
  }

  return { root, label: path.basename(root), users, channels, findings };
}

/** Accepts `{ "channels": { "<name or id>": "<projectId>" } }` or the bare map. */
export function parseSlackChannelMapping(json) {
  const source = json && typeof json === 'object' && json.channels && typeof json.channels === 'object' ? json.channels : json;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new SlackExportError('INVALID_MAPPING', 'Channel mapping must be a JSON object of channel name or id to project id');
  }
  const mapping = new Map();
  for (const [key, projectId] of Object.entries(source)) {
    if (typeof projectId !== 'string' || !projectId.trim()) {
      throw new SlackExportError('INVALID_MAPPING', `Channel mapping for ${key} must be a project id string`);
    }
    mapping.set(key.replace(/^#/, ''), projectId.trim());
  }
  return mapping;
}

/** Pure channel → project resolution; ids win over names. */
export function buildSlackImportPlan(exportData, mapping) {
  const usedKeys = new Set();
  const mapped = [];
  const unmapped = [];
  for (const channel of exportData.channels) {
    const key = mapping.has(channel.id) ? channel.id : (mapping.has(channel.name) ? channel.name : null);
    if (!key) {
      unmapped.push({ id: channel.id, name: channel.name, messages: channel.messages.length });
      continue;
    }
    usedKeys.add(key);
    mapped.push({ channel, projectId: mapping.get(key) });
  }
  const unusedMappings = [...mapping.keys()].filter((key) => !usedKeys.has(key));
  return { mapped, unmapped, unusedMappings };
}

/** Render Slack mrkdwn entity markup into readable plain text. */
export function renderSlackText(text, { users = new Map(), channelsById = new Map() } = {}) {
  return String(text ?? '')
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => `@${label || users.get(id)?.name || id}`)
    .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id, label) => `#${label || channelsById.get(id)?.name || id}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_, label) => label || '@group')
    .replace(/<!date\^[^|>]*\|([^>]*)>/g, '$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function slackEmoji(name) {
  const base = name.split('::')[0];
  return EMOJI[base] ?? `:${base}:`;
}

async function findInChunks(values, query) {
  const results = [];
  for (let index = 0; index < values.length; index += QUERY_CHUNK) {
    const chunk = values.slice(index, index + QUERY_CHUNK);
    if (chunk.length) results.push(...await query(chunk));
  }
  return results;
}

function emptyReport({ organizationId, exportData, apply }) {
  return {
    format: 'ashbi-slack-export-import-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: apply ? 'live' : 'dry-run',
    organization: { id: organizationId },
    input: { label: exportData.label, channels: exportData.channels.length, users: exportData.users.size },
    totals: {
      planned: 0, created: 0, unchanged: 0, alreadyPresent: 0, alreadyPresentElsewhere: 0, deletedInHub: 0,
      conflicts: 0, skipped: 0, threadReplies: 0, reactionsImported: 0,
    },
    reactionsDropped: { unmappedUser: 0, emojiTooLong: 0 },
    channels: [],
    selectedChannel: null,
    notSelectedChannels: [],
    unmappedChannels: [],
    unusedMappings: [],
    users: { mapped: 0, unmapped: [] },
    skippedSubtypes: {},
    unsupported: {
      assets: [],
      files: exportData.findings.unsupportedFiles,
      conversations: exportData.findings.unsupportedConversations,
      directories: exportData.findings.unknownDirectories,
    },
    warnings: [...exportData.findings.warnings],
    errors: [...exportData.findings.errors],
    run: null,
    complete: false,
  };
}

function metadataChannelId(metadata) {
  if (typeof metadata !== 'string') return null;
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed?.channelId === 'string' ? parsed.channelId : null;
  } catch {
    return null;
  }
}

async function insertInChunks(rows, insert) {
  for (let index = 0; index < rows.length; index += QUERY_CHUNK) {
    await insert(rows.slice(index, index + QUERY_CHUNK));
  }
}

async function importChannel(db, context, { channel, projectId }) {
  const { organizationId, report, apply, run, users, userIdBySlackId, channelsById, authorsSeen } = context;
  const summary = {
    id: channel.id, name: channel.name, isPrivate: channel.isPrivate, projectId,
    messages: channel.messages.length, planned: 0, created: 0, threadReplies: 0,
    unchanged: 0, alreadyPresent: 0, alreadyPresentElsewhere: 0, deletedInHub: 0, conflicts: 0, skipped: 0,
  };
  report.channels.push(summary);
  mergeCounts(report.skippedSubtypes, channel.skipped);
  const sourceKeyOf = (message) => slackSourceKey(channel.id, message.ts);
  const conflict = (code, message, error) => {
    summary.conflicts++; report.totals.conflicts++;
    report.errors.push({ code, sourceKey: sourceKeyOf(message), error });
  };

  // Everything this channel may point at: its own messages and the thread
  // roots its replies reference (which may sit in an earlier export).
  const tsList = [...new Set(channel.messages.flatMap((message) => [message.ts, message.threadTs].filter(Boolean)))];
  const records = await findInChunks(tsList.map((ts) => slackSourceKey(channel.id, ts)), (sourceKeys) => db.slackImportRecord.findMany({
    where: { organizationId, sourceKey: { in: sourceKeys } },
  }));
  const recordByTs = new Map(records.map((record) => [record.messageTs, record]));
  const destinations = await findInChunks(records.map((record) => record.chatMessageId).filter(Boolean), (ids) => db.chatMessage.findMany({
    where: { id: { in: ids } }, select: { id: true, projectId: true },
  }));
  const destinationById = new Map(destinations.map((message) => [message.id, message]));

  // Slack messages from THIS channel already in the Hub anywhere in the
  // organization (live integration deliveries or other imports). A ts is only
  // unique per channel, so the stored channel id must match as well.
  const existing = (await findInChunks(tsList, (externalMessageIds) => db.chatMessage.findMany({
    where: { externalSource: SLACK_EXTERNAL_SOURCE, externalMessageId: { in: externalMessageIds }, project: { organizationId } },
    select: { id: true, projectId: true, externalMessageId: true, metadata: true },
  }))).filter((message) => metadataChannelId(message.metadata) === channel.id);
  const presentByTs = new Map();
  for (const message of existing) {
    const current = presentByTs.get(message.externalMessageId);
    if (!current || (current.projectId !== projectId && message.projectId === projectId)) presentByTs.set(message.externalMessageId, message);
  }

  const chatIdByTs = new Map();
  for (const record of records) {
    const destination = destinationById.get(record.chatMessageId);
    if (destination && destination.projectId === projectId) chatIdByTs.set(record.messageTs, destination.id);
  }
  for (const [ts, message] of presentByTs) {
    if (!chatIdByTs.has(ts) && message.projectId === projectId) chatIdByTs.set(ts, message.id);
  }

  const messageRows = [];
  const reactionRows = [];
  const recordRows = [];
  for (const message of channel.messages) {
    const record = recordByTs.get(message.ts);
    if (record) {
      if (record.projectId !== projectId) {
        conflict('PROJECT_MAPPING_CHANGED', message, 'This message was previously imported into a different project');
        continue;
      }
      const destination = record.chatMessageId ? destinationById.get(record.chatMessageId) : null;
      if (!destination) {
        // Someone deleted the imported message in the Hub. Respect that:
        // never re-import it, and do not block the rest of the export.
        summary.deletedInHub++; report.totals.deletedInHub++;
        report.warnings.push({ code: 'DELETED_IN_HUB', sourceKey: sourceKeyOf(message), error: 'The imported chat message was deleted in the Hub and is not re-imported' });
        continue;
      }
      if (record.contentSha256 !== message.contentSha256) {
        conflict('SOURCE_CHANGED', message, 'Source message changed since its prior controlled import');
        continue;
      }
      summary.unchanged++; report.totals.unchanged++;
      continue;
    }
    const present = presentByTs.get(message.ts);
    if (present && present.projectId === projectId) {
      summary.alreadyPresent++; report.totals.alreadyPresent++;
      report.warnings.push({ code: 'ALREADY_PRESENT', sourceKey: sourceKeyOf(message), error: 'The live Slack integration already delivered this message' });
      continue;
    }
    if (present) {
      summary.alreadyPresentElsewhere++; report.totals.alreadyPresentElsewhere++;
      report.warnings.push({ code: 'ALREADY_PRESENT_OTHER_PROJECT', sourceKey: sourceKeyOf(message), projectId: present.projectId, error: 'This message is already in another project of this organization and is not imported again' });
      continue;
    }

    const content = renderSlackText(message.text, { users, channelsById })
      || (message.files.length ? `[Slack file not imported: ${message.files.map((file) => file.name || file.id || 'file').join(', ')}]` : '');
    if (!content) {
      summary.skipped++; report.totals.skipped++;
      report.warnings.push({ code: 'EMPTY_MESSAGE', sourceKey: sourceKeyOf(message), error: 'Message has no text or file reference' });
      continue;
    }
    for (const file of message.files) {
      report.unsupported.assets.push({ sourceKey: sourceKeyOf(message), fileId: file.id, name: sanitizeDisplayText(file.name), mimetype: file.mimetype });
    }

    // Ids are generated up front (as embedding.service does) so parents,
    // reactions and records can be written with batched createMany calls.
    const id = crypto.randomUUID();
    let parentId = null;
    if (message.isReply) {
      parentId = chatIdByTs.get(message.threadTs) ?? null;
      if (!parentId) {
        report.warnings.push({ code: 'THREAD_PARENT_MISSING', sourceKey: sourceKeyOf(message), error: 'Thread root is not in this export; the reply is imported at top level' });
      }
    }
    chatIdByTs.set(message.ts, id);
    if (message.userId) authorsSeen.add(message.userId);
    const authorId = message.userId ? (userIdBySlackId.get(message.userId) ?? null) : null;
    const authorName = users.get(message.userId)?.name || message.userProfileName || 'Slack user';
    summary.threadReplies += message.isReply ? 1 : 0;
    report.totals.threadReplies += message.isReply ? 1 : 0;

    const seen = new Set();
    for (const reaction of message.reactions) {
      const emoji = slackEmoji(reaction.name);
      if (emoji.length > MAX_CHAT_EMOJI_LENGTH) {
        report.reactionsDropped.emojiTooLong += Math.max(reaction.users.length, reaction.count);
        continue;
      }
      for (const slackUserId of reaction.users) {
        const userId = userIdBySlackId.get(slackUserId);
        if (!userId) { report.reactionsDropped.unmappedUser++; continue; }
        const key = `${userId}:${emoji}`;
        if (seen.has(key)) continue;
        seen.add(key);
        reactionRows.push({ messageId: id, userId, emoji });
      }
    }

    if (!apply) {
      summary.planned++; report.totals.planned++;
      continue;
    }
    messageRows.push({
      id,
      projectId,
      content,
      type: 'TEXT',
      authorId,
      parentId,
      externalSource: SLACK_EXTERNAL_SOURCE,
      externalAuthorName: authorName,
      externalMessageId: message.ts,
      externalThreadId: message.threadTs ?? message.ts,
      isEdited: Boolean(message.editedTs),
      editedAt: message.editedTs ? tsToDate(message.editedTs) : null,
      createdAt: tsToDate(message.ts) ?? new Date(),
      metadata: JSON.stringify({
        source: SLACK_EXTERNAL_SOURCE,
        importSource: SLACK_IMPORT_SOURCE,
        importRunId: run.id,
        channelId: channel.id,
        externalUserId: message.userId,
        subtype: message.subtype,
        slackFiles: message.files,
        slackReactions: message.reactions.map((reaction) => ({ name: reaction.name, count: reaction.count })),
      }),
    });
    recordRows.push({
      id: crypto.randomUUID(), organizationId, projectId, runId: run.id, chatMessageId: id,
      sourceKey: sourceKeyOf(message), channelId: channel.id,
      messageTs: message.ts, threadTs: message.threadTs, contentSha256: message.contentSha256, outcome: 'IMPORTED',
    });
    summary.created++; report.totals.created++;
  }

  if (!apply) return;
  // Messages are in ts order, so a thread root is always inserted in the
  // same or an earlier batch than its replies.
  await insertInChunks(messageRows, (rows) => db.chatMessage.createMany({ data: rows }));
  await insertInChunks(reactionRows, (rows) => db.chatReaction.createMany({ data: rows }));
  await insertInChunks(recordRows, (rows) => db.slackImportRecord.createMany({ data: rows }));
  report.totals.reactionsImported += reactionRows.length;
}

function countsSummary(report) {
  return {
    totals: report.totals,
    reactionsDropped: report.reactionsDropped,
    channels: report.channels.map(({ id, projectId, created, unchanged, alreadyPresent, alreadyPresentElsewhere, deletedInHub, conflicts, skipped }) => ({
      id, projectId, created, unchanged, alreadyPresent, alreadyPresentElsewhere, deletedInHub, conflicts, skipped,
    })),
    selectedChannel: report.selectedChannel,
    unmappedChannels: report.unmappedChannels.length,
    unmappedUsers: report.users.unmapped.length,
    unsupportedAssets: report.unsupported.assets.length,
  };
}

/**
 * Plan (apply=false) or apply (apply=true) a parsed Slack export for one
 * organization. `db` should be a tenant-scoped Prisma client (runTenantJob);
 * every query also names `organizationId` explicitly. `channel` (a name or
 * id) limits the run to one mapped channel.
 */
export async function runSlackExportImport(db, { organizationId, exportData, mapping, apply = false, channel: onlyChannel = null }) {
  if (!organizationId) throw new SlackExportError('MISSING_ORGANIZATION', 'organizationId is required');
  const report = emptyReport({ organizationId, exportData, apply });
  const plan = buildSlackImportPlan(exportData, mapping);
  report.unmappedChannels = plan.unmapped;
  report.unusedMappings = plan.unusedMappings;

  const selects = (id, name) => !onlyChannel || onlyChannel === id || onlyChannel === name;
  let mapped = plan.mapped;
  if (onlyChannel) {
    mapped = plan.mapped.filter(({ channel }) => selects(channel.id, channel.name));
    report.selectedChannel = onlyChannel;
    report.notSelectedChannels = plan.mapped.filter((entry) => !mapped.includes(entry)).map(({ channel }) => channel.name);
    if (!mapped.length) {
      report.errors.push({ code: 'CHANNEL_NOT_SELECTABLE', channel: sanitizeDisplayText(onlyChannel, 80), error: 'The selected channel is not in the export or not in the mapping file' });
    }
  }

  // Unsafe or invalid channel entries block only when this run would import
  // them; for any other channel they are reported and skipped.
  for (const finding of exportData.findings.channelFindings) {
    const isMapped = [finding.channelId, finding.channel].some((key) => key && mapping.has(key) && selects(finding.channelId, finding.channel));
    (isMapped ? report.errors : report.warnings).push(finding);
  }

  const projectIds = [...new Set(mapped.map((entry) => entry.projectId))];
  const projects = projectIds.length
    ? await db.project.findMany({ where: { id: { in: projectIds }, organizationId }, select: { id: true, name: true } })
    : [];
  const knownProjects = new Set(projects.map((project) => project.id));
  const importable = [];
  for (const entry of mapped) {
    if (knownProjects.has(entry.projectId)) importable.push(entry);
    else report.errors.push({ code: 'UNKNOWN_PROJECT', channelId: entry.channel.id, projectId: entry.projectId, error: 'Mapped project was not found in this organization' });
  }

  // The live Slack integration and the import must agree on where a channel's
  // messages live, or the same conversation would be split across projects.
  const liveMappings = importable.length
    ? await db.slackChannelMapping.findMany({
      where: { organizationId, channelId: { in: importable.map(({ channel }) => channel.id) } },
      select: { channelId: true, projectId: true },
    })
    : [];
  for (const liveMapping of liveMappings) {
    const entry = importable.find(({ channel }) => channel.id === liveMapping.channelId);
    if (entry && entry.projectId !== liveMapping.projectId) {
      report.errors.push({
        code: 'LIVE_MAPPING_CONFLICT', channelId: liveMapping.channelId, projectId: entry.projectId, liveProjectId: liveMapping.projectId,
        error: 'The live Slack integration maps this channel to a different project; align the mapping file with it',
      });
    }
  }

  const orgUsers = await db.user.findMany({ where: { organizationId, isActive: true }, select: { id: true, email: true } });
  const ashbiUserByEmail = new Map(orgUsers.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user.id]));
  const userIdBySlackId = new Map();
  for (const user of exportData.users.values()) {
    const match = user.email && !user.isBot ? ashbiUserByEmail.get(user.email) : null;
    if (match) userIdBySlackId.set(user.id, match);
  }

  const context = {
    organizationId, report, apply, run: null, users: exportData.users, userIdBySlackId,
    channelsById: new Map(exportData.channels.map((channel) => [channel.id, channel])),
    authorsSeen: new Set(),
  };
  const finishUsers = () => {
    for (const slackUserId of [...context.authorsSeen].sort()) {
      if (userIdBySlackId.has(slackUserId)) report.users.mapped++;
      else report.users.unmapped.push({ id: slackUserId, name: exportData.users.get(slackUserId)?.name ?? null });
    }
  };

  if (!apply) {
    for (const entry of importable) await importChannel(db, context, entry);
    finishUsers();
    report.complete = report.errors.length === 0;
    return report;
  }

  if (report.errors.length) throw new SlackImportBlockedError(report);
  await db.$transaction(async (transaction) => {
    context.run = await transaction.importRun.create({
      data: { organizationId, source: SLACK_IMPORT_SOURCE, status: 'APPLIED', sourceLabel: exportData.label },
    });
    for (const entry of importable) await importChannel(transaction, context, entry);
    finishUsers();
    if (report.errors.length) throw new SlackImportBlockedError(report);
    await transaction.importRun.update({
      where: { id: context.run.id },
      data: { createdCount: report.totals.created, summary: countsSummary(report) },
    });
  }, TRANSACTION_OPTIONS);
  report.run = { id: context.run.id };
  report.complete = true;
  await recordAuditEvent(db, {
    organizationId, actorType: 'SYSTEM', action: 'migration_import.applied', entityId: context.run.id,
    metadata: {
      source: SLACK_IMPORT_SOURCE, created: report.totals.created, unchanged: report.totals.unchanged,
      alreadyPresent: report.totals.alreadyPresent, channels: report.channels.length,
    },
  });
  return report;
}

/**
 * Remove exactly the chat messages (and their reactions) a live run created,
 * then its reconciliation records. Refuses when any message outside the run
 * replies to one of the run's messages (a native Ashbi reply or a later
 * import run), so rollback never orphans or deletes other work.
 */
export async function rollbackSlackImportRun(db, { organizationId, runId }) {
  if (!organizationId || !runId) throw new SlackExportError('MISSING_ARGUMENT', 'organizationId and runId are required');
  const result = await db.$transaction(async (transaction) => {
    const run = await transaction.importRun.findFirst({ where: { id: runId, organizationId, source: SLACK_IMPORT_SOURCE } });
    if (!run) throw new SlackExportError('RUN_NOT_FOUND', 'Import run was not found in this organization');
    if (run.status === 'ROLLED_BACK') throw new SlackExportError('ALREADY_ROLLED_BACK', 'Import run was already rolled back');
    const records = await transaction.slackImportRecord.findMany({ where: { organizationId, runId }, select: { chatMessageId: true } });
    const messageIds = records.map((record) => record.chatMessageId).filter(Boolean);
    const runMessageIds = new Set(messageIds);
    const foreignReplies = (await findInChunks(messageIds, (ids) => transaction.chatMessage.findMany({
      where: { parentId: { in: ids } }, select: { id: true },
    }))).filter((reply) => !runMessageIds.has(reply.id));
    if (foreignReplies.length) {
      throw new SlackExportError('ROLLBACK_BLOCKED', `${foreignReplies.length} message(s) outside this run reply to its messages; roll back later runs or move those replies first`);
    }
    let deleted = 0;
    // Replies first, then roots: chat_messages.parentId has no cascade.
    for (const parentFilter of [{ not: null }, null]) {
      for (let index = 0; index < messageIds.length; index += QUERY_CHUNK) {
        const outcome = await transaction.chatMessage.deleteMany({
          where: { id: { in: messageIds.slice(index, index + QUERY_CHUNK) }, parentId: parentFilter },
        });
        deleted += outcome.count;
      }
    }
    const removedRecords = await transaction.slackImportRecord.deleteMany({ where: { organizationId, runId } });
    await transaction.importRun.update({ where: { id: runId }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
    return { messages: deleted, records: removedRecords.count };
  }, TRANSACTION_OPTIONS);
  await recordAuditEvent(db, {
    organizationId, actorType: 'SYSTEM', action: 'migration_import.rolled_back', entityId: runId,
    metadata: { source: SLACK_IMPORT_SOURCE, deletedMessages: result.messages, deletedRecords: result.records },
  });
  return {
    format: 'ashbi-slack-export-import-report', version: 1, generatedAt: new Date().toISOString(),
    mode: 'rollback', organization: { id: organizationId }, run: { id: runId }, deleted: result, complete: true,
  };
}
