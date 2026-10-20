import { Plus, Trash2 } from 'lucide-react';
import { Card, Field, Input, Textarea } from '../ui';
import { formatMoney } from '../../lib/format';
import { lineTotal } from '../../lib/money-totals';
import { cn } from '../../lib/utils';

// The draft proposal's edit form (title, line items, discount and the note
// the client reads). ProposalDetail owns the state and the save.

const cellInput = 'min-h-11 text-sm';

export default function ProposalEditor({
  title, onTitleChange,
  lineItems, onLineChange, onAddLine, onRemoveLine,
  discount, onDiscountChange,
  notes, onNotesChange,
  totals,
}) {
  return (
    <Card as="section" padding="none" className="rounded-lg p-5" aria-labelledby="proposal-edit-heading">
      <h2 id="proposal-edit-heading" className="text-lg font-semibold tracking-tight text-foreground">Edit proposal</h2>
      <div className="mt-4 space-y-5">
        <Field label="Title">
          <Input id="proposal-title" type="text" value={title} onChange={(e) => onTitleChange(e.target.value)} className={cellInput} required />
        </Field>

        <fieldset>
          <legend className="text-eyebrow text-muted-foreground">Line items</legend>
          <ul className="mt-2 space-y-3">
            {lineItems.map((item, idx) => (
              <li key={item.id || idx} className="grid grid-cols-2 gap-2 border-b border-border/30 pb-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem_2.75rem] sm:items-center sm:border-0 sm:pb-0">
                <Input
                  aria-label={`Line ${idx + 1} description`}
                  type="text"
                  value={item.description}
                  onChange={(e) => onLineChange(idx, 'description', e.target.value)}
                  placeholder="Description"
                  className={cn(cellInput, 'col-span-2 sm:col-span-1')}
                />
                <Input
                  aria-label={`Line ${idx + 1} quantity`}
                  type="number"
                  min="0"
                  step="0.5"
                  value={item.quantity}
                  onChange={(e) => onLineChange(idx, 'quantity', e.target.value)}
                  className={cn(cellInput, 'figure text-right')}
                />
                <Input
                  aria-label={`Line ${idx + 1} unit price`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => onLineChange(idx, 'unitPrice', e.target.value)}
                  className={cn(cellInput, 'figure text-right')}
                />
                <p className="figure flex min-h-11 items-center text-sm font-medium sm:justify-end">
                  {/* An empty quantity saves as 1 (ProposalDetail handleSave). */}
                  {formatMoney(lineTotal(parseFloat(item.quantity) || 1, item.unitPrice))}
                </p>
                <button
                  type="button"
                  onClick={() => onRemoveLine(idx)}
                  aria-label={`Remove line ${idx + 1}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center justify-self-end rounded-md text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onAddLine}
            className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add line item
          </button>
        </fieldset>

        <dl className="space-y-2 border-t border-border/60 pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="figure">{formatMoney(totals.subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt><label htmlFor="proposal-discount" className="text-muted-foreground">Discount</label></dt>
            <dd>
              <Input
                id="proposal-discount"
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => onDiscountChange(e.target.value)}
                className={cn(cellInput, 'figure w-32 text-right')}
              />
            </dd>
          </div>
          {totals.taxRate > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{totals.taxLabel}</dt>
              <dd className="figure">{formatMoney(totals.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-border/60 pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="figure">{formatMoney(totals.total)}</dd>
          </div>
        </dl>

        <Field label="Note to the client" hint="Shown on the proposal page as the overview.">
          <Textarea id="proposal-notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={5} />
        </Field>
      </div>
    </Card>
  );
}
