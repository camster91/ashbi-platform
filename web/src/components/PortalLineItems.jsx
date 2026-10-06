// The line-item table on the public estimate, proposal and invoice pages.
// On a phone the Qty and Rate columns fold into a "2 × $750.00" line under
// the description, so the Amount column always fits at 375px.

/**
 * @param {{
 *   items: Array<{ description?: string, quantity?: number, rate?: number, amount?: number }>,
 *   formatAmount: (value: number) => string,
 *   label: string,
 * }} props
 */
export default function PortalLineItems({ items, formatAmount, label }) {
  const rows = Array.isArray(items) ? items : [];
  return (
    <div className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th scope="col" className="px-4 sm:px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Qty</th>
            <th scope="col" className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Rate</th>
            <th scope="col" className="px-4 sm:px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/25">
          {rows.map((item, i) => {
            const quantity = Number(item.quantity) || 0;
            const rate = Number(item.rate) || 0;
            const amount = Number(item.amount) || 0;
            return (
              <tr key={i} className="hover:bg-muted/50">
                <td className="px-4 sm:px-6 py-4 text-sm text-foreground break-words">
                  {item.description}
                  <span className="sm:hidden block mt-0.5 text-xs text-muted-foreground">
                    {quantity} × {formatAmount(rate)}
                  </span>
                </td>
                <td className="hidden sm:table-cell px-6 py-4 text-sm text-muted-foreground text-right">{quantity}</td>
                <td className="hidden sm:table-cell px-6 py-4 text-sm text-muted-foreground text-right whitespace-nowrap">{formatAmount(rate)}</td>
                <td className="px-4 sm:px-6 py-4 text-sm font-medium text-foreground text-right whitespace-nowrap align-top">{formatAmount(amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
