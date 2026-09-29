import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareUploadFile } from '../../lib/upload';

export const MAX_MESSAGE_ATTACHMENTS = 10;

let localCounter = 0;
const nextLocalId = () => `draft-${Date.now().toString(36)}-${(localCounter += 1)}`;

/**
 * The files of a chat message that is still being written (docs/chat-media.md).
 * Each file uploads as soon as it is added (a pending chat upload); the
 * message send lists the ready ids and the server claims them atomically.
 *
 * @param {{
 *   upload: (file: File, options: { onProgress: (fraction: number) => void, signal: AbortSignal }) => Promise<{ id: string }>,
 *   discard?: (attachmentId: string) => Promise<unknown>,
 *   max?: number,
 * }} options
 */
export function useAttachmentDraft({ upload, discard, max = MAX_MESSAGE_ATTACHMENTS }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controllers = useRef(new Map());
  // The discard function in effect when each upload started: the composer's
  // project can change (portal project switch) while a file is pending, and
  // the file must be discarded from the project it was uploaded to.
  const discarders = useRef(new Map());
  const uploadRef = useRef(upload);
  const discardRef = useRef(discard);
  uploadRef.current = upload;
  discardRef.current = discard;

  const patch = useCallback((localId, changes) => {
    setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...changes } : item)));
  }, []);

  const discardUpload = useCallback((localId, attachmentId) => {
    const discardFn = discarders.current.get(localId) ?? discardRef.current;
    discarders.current.delete(localId);
    if (attachmentId) discardFn?.(attachmentId)?.catch?.(() => {});
  }, []);

  const start = useCallback((item) => {
    const controller = new AbortController();
    controllers.current.set(item.localId, controller);
    discarders.current.set(item.localId, discardRef.current);
    patch(item.localId, { status: 'uploading', progress: 0, error: '' });
    uploadRef.current(item.file, {
      signal: controller.signal,
      onProgress: (fraction) => patch(item.localId, { progress: fraction }),
    }).then((uploaded) => {
      controllers.current.delete(item.localId);
      // Removed while uploading: the server copy is not wanted.
      if (!itemsRef.current.some((current) => current.localId === item.localId)) {
        discardUpload(item.localId, uploaded?.id);
        return;
      }
      patch(item.localId, { status: 'ready', progress: 1, id: uploaded.id });
    }, (error) => {
      controllers.current.delete(item.localId);
      if (error?.name === 'AbortError') return;
      patch(item.localId, { status: 'error', error: error?.message || 'Upload failed.' });
    });
  }, [patch, discardUpload]);

  const addFiles = useCallback((fileList, { fallbackBase } = {}) => {
    const files = Array.from(fileList || []);
    if (!files.length) return [];
    const room = max - itemsRef.current.length;
    const problems = [];
    const added = [];
    for (const raw of files) {
      if (added.length >= room) {
        problems.push(`A message can carry up to ${max} files.`);
        break;
      }
      const { file, error } = prepareUploadFile(raw, { fallbackBase });
      if (error) { problems.push(error); continue; }
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'file';
      added.push({
        localId: nextLocalId(),
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        kind,
        previewUrl: (kind === 'image' || kind === 'video') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
        status: 'uploading',
        progress: 0,
        id: null,
        error: '',
      });
    }
    setNotice(problems.join(' '));
    if (added.length) {
      itemsRef.current = [...itemsRef.current, ...added];
      setItems(itemsRef.current);
      added.forEach(start);
    }
    return added;
  }, [max, start]);

  const release = (item) => {
    controllers.current.get(item.localId)?.abort();
    controllers.current.delete(item.localId);
    if (item.previewUrl) URL.revokeObjectURL?.(item.previewUrl);
  };

  const remove = useCallback((localId) => {
    const item = itemsRef.current.find((current) => current.localId === localId);
    if (!item) return;
    release(item);
    itemsRef.current = itemsRef.current.filter((current) => current.localId !== localId);
    setItems(itemsRef.current);
    discardUpload(item.localId, item.id);
  }, [discardUpload]);

  const retry = useCallback((localId) => {
    const item = itemsRef.current.find((current) => current.localId === localId);
    if (item && item.status === 'error') start(item);
  }, [start]);

  /** Replace one file (for example with its marked-up copy). */
  const replace = useCallback((localId, file) => {
    remove(localId);
    return addFiles([file]);
  }, [addFiles, remove]);

  /**
   * After a successful send: the server owns the sent files now. With the
   * sent ids, only those leave the tray, so a file added while the send was
   * in flight stays; without ids, the whole tray is cleared.
   * @param {string[]} [sentIds]
   */
  const clear = useCallback((sentIds) => {
    const sent = Array.isArray(sentIds) ? new Set(sentIds) : null;
    const leaving = sent ? itemsRef.current.filter((item) => item.id && sent.has(item.id)) : itemsRef.current;
    leaving.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL?.(item.previewUrl);
      discarders.current.delete(item.localId);
    });
    itemsRef.current = sent ? itemsRef.current.filter((item) => !leaving.includes(item)) : [];
    setItems(itemsRef.current);
    setNotice('');
  }, []);

  /** Abandon the draft (project switch, unmount): unsent uploads are discarded. */
  const reset = useCallback(() => {
    const current = itemsRef.current;
    current.forEach((item) => {
      release(item);
      discardUpload(item.localId, item.id);
    });
    itemsRef.current = [];
    setItems([]);
    setNotice('');
  }, [discardUpload]);

  useEffect(() => () => reset(), [reset]);

  return useMemo(() => {
    const readyIds = items.filter((item) => item.status === 'ready').map((item) => item.id);
    return {
      items,
      notice,
      readyIds,
      uploading: items.some((item) => item.status === 'uploading'),
      hasErrors: items.some((item) => item.status === 'error'),
      canAddMore: items.length < max,
      max,
      addFiles,
      remove,
      retry,
      replace,
      clear,
      reset,
      setNotice,
    };
  }, [items, notice, max, addFiles, remove, retry, replace, clear, reset]);
}
