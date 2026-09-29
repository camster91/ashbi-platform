import { useState } from 'react';
import { Download, FileText, ShieldAlert } from 'lucide-react';
import Modal from '../Modal';
import { attachmentKind, formatBytes } from '../../lib/upload';
import { cn } from '../../lib/utils';

/**
 * Files inside a chat message (docs/chat-media.md): images as thumbnails that
 * open a lightbox, recorded video and audio in native players, anything else
 * as a file card. Accepts the staff shape ({ originalName, url, quarantined })
 * and the client-portal shape ({ name, url }).
 *
 * @param {{ attachments?: any[], resolveUrl?: (url: string) => string, tone?: 'default' | 'inverse', className?: string }} props
 */
export default function MessageAttachments({ attachments, resolveUrl = (url) => url, tone = 'default', className }) {
  const [open, setOpen] = useState(null);
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  const files = attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name ?? attachment.originalName ?? 'Attachment',
    mimeType: attachment.mimeType,
    size: attachment.size,
    quarantined: Boolean(attachment.quarantined),
    url: attachment.url ? resolveUrl(attachment.url) : '',
    kind: attachmentKind(attachment.mimeType),
  }));
  const images = files.filter((file) => file.kind === 'image' && !file.quarantined && file.url);
  const others = files.filter((file) => !images.includes(file));
  const cardClass = tone === 'inverse'
    ? 'border-white/30 bg-white/10 text-inherit'
    : 'border-border bg-background text-foreground';

  return (
    <div className={cn('mt-2 space-y-2', className)} data-testid="message-attachments">
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Images">
          {images.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => setOpen(file)}
                aria-label={`Open image ${file.name}`}
                className="block overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img src={file.url} alt={file.name} loading="lazy" decoding="async" className="h-28 w-40 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.map((file) => {
        if (file.quarantined || !file.url) {
          return (
            <p key={file.id} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-xs', cardClass)}>
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="shrink-0 opacity-80">withheld for security review</span>
            </p>
          );
        }
        if (file.kind === 'video') {
          return (
            <figure key={file.id} className="max-w-md">
              <video controls preload="metadata" playsInline src={file.url} aria-label={`Video: ${file.name}`} className="max-h-72 w-full rounded-md bg-black" />
              <figcaption className="mt-1 flex items-center justify-between gap-2 text-xs opacity-80">
                <span className="min-w-0 truncate">{file.name}</span>
                <a href={file.url} download={file.name} className="inline-flex min-h-11 items-center gap-1 underline" aria-label={`Download ${file.name}`}>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                </a>
              </figcaption>
            </figure>
          );
        }
        if (file.kind === 'audio') {
          return (
            <figure key={file.id} className="max-w-md">
              <audio controls preload="metadata" src={file.url} aria-label={`Audio: ${file.name}`} className="w-full" />
              <figcaption className="mt-1 truncate text-xs opacity-80">{file.name}</figcaption>
            </figure>
          );
        }
        return (
          <a
            key={file.id}
            href={file.url}
            download={file.name}
            className={cn('flex min-h-11 max-w-md items-center gap-3 rounded-md border px-3 py-2 text-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', cardClass)}
            aria-label={`Download ${file.name}${file.size ? `, ${formatBytes(file.size)}` : ''}`}
          >
            <FileText className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            {file.size ? <span className="shrink-0 text-xs opacity-80">{formatBytes(file.size)}</span> : null}
            <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
        );
      })}
      <Modal isOpen={Boolean(open)} onClose={() => setOpen(null)} title={open?.name} size="full">
        {open && (
          <div className="space-y-3">
            <img src={open.url} alt={open.name} className="mx-auto max-h-[75vh] w-auto max-w-full rounded-md object-contain" />
            <p className="text-right">
              <a href={open.url} download={open.name} className="inline-flex min-h-11 items-center gap-1 text-sm underline">
                <Download className="h-4 w-4" aria-hidden="true" /> Download {open.name}
              </a>
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
