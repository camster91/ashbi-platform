# UI primitives

Reference for the shared React primitives used by the Ashbi Hub SPA (`web/`).
Everything here is taken from the component source. When you change a
primitive's props, variants or accessibility behaviour, update this file in the
same change.

`web/src/tests/ui-primitives-docs.test.js` keeps this file honest. It checks
that:

- every PascalCase export of a primitive source file has a `###` heading here
  that names it in backticks;
- every value listed on a `**Variants:**`, `**Sizes:**`, `**Colors:**`,
  `**Padding:**` or `**Icons:**` line is a key in that section's `Source:` file;
- every `.cp-*` class in `web/src/pages/client-portal/portal.css` appears in the
  [Portal convergence](#portal-convergence) table.

Primitive sources:

- `web/src/components/ui/*.jsx`, re-exported from
  `web/src/components/ui/index.js`, so you can
  `import { Button, Card } from '../components/ui'`.
- `web/src/components/Modal.jsx` and `web/src/components/ConfirmDialog.jsx`,
  imported directly because they are not re-exported from the `ui` barrel.

## Design tokens

The primitives are styled with Tailwind utilities that resolve to the CSS
variables in `web/src/index.css`. `web/tailwind.config.js` maps them to Tailwind
colours as `hsl(var(--token))`. Light values live in `:root` and dark values in
`.dark`.

| Tailwind colour | CSS variable(s) | Used by |
|---|---|---|
| `primary` / `primary-foreground` | `--primary`, `--primary-foreground` | Button, Badge, StatCard, LoadingState spinner |
| `secondary` / `secondary-foreground` | `--secondary`, `--secondary-foreground` | Button |
| `destructive` / `destructive-foreground` | `--destructive`, `--destructive-foreground` | Button, Badge, StatCard, Alert (`error`) |
| `success`, `warning`, `info` (+ `-foreground`) | `--success`, `--warning`, `--info` (+ `-foreground`) | Button, Badge, StatCard |
| `muted` / `muted-foreground` | `--muted`, `--muted-foreground` | nearly all primitives |
| `card` / `card-foreground` | `--card`, `--card-foreground` | Card, Modal, skeleton cards |
| `background`, `foreground` | `--background`, `--foreground` | Input, Button (`outline`/`ghost`), Alert |
| `border` | `--border` | Input, Card, Modal, StatCard, skeletons |
| `ring` | `--ring` | Input and Alert dismiss focus ring |
| `rounded-lg` / `-md` / `-sm` | `--radius` | Button, Input, Modal, Skeleton |
| `font-display` / `font-heading` | Tailwind `fontFamily` (Instrument Serif / DM Sans) | CardTitle / EmptyState, StatCard |

Custom utilities defined in `web/src/index.css`: `animate-fade-in` (Alert,
SlowMessage, page skeletons), `hover-lift` (interactive Card), `glass-card`
(Card `glass`), `skeleton-shimmer` (Skeleton) and `stagger-children`
(AnimatedList).

Known token gaps:

- Alert's `warning`, `success` and `info` variants use raw Tailwind palette
  colours (`amber-*`, `green-*`, `blue-*`) with explicit `dark:` overrides
  instead of the `--warning`, `--success` and `--info` tokens.
- `glass-card` hardcodes the brand indigo `#2e2958` for dark mode.

Shared accessibility conventions:

- Interactive targets are at least 44px tall (`min-h-11`, or `h-12`/`h-14`).
- Animations carry `motion-reduce:animate-none` / `motion-reduce:transition-none`.
- Decorative icons get `aria-hidden="true"`.
- Pending states become "Slow" after `SLOW_THRESHOLD_MS` (8000 ms, from
  `web/src/hooks/useSlowState.js`). They explain the delay inside a polite live
  region; see `docs/workflow-state-matrix.md`.

---

## Actions

### `Button`

Source: `web/src/components/ui/Button.jsx`

A `forwardRef` `<button>` with variants, sizes, icons, a loading state and a
built-in slow-state notice.

**Variants:** `primary`, `secondary`, `outline`, `ghost`, `danger`, `destructive`, `success`, `warning`

**Sizes:** `xs`, `sm`, `md`, `lg`, `xl`

`danger` and `destructive` are aliases. An unknown variant falls back to
`primary`, and an unknown size falls back to `md`. `ConfirmDialog` relies on
this when it passes `variant="default"`.

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `variant` | see Variants | `'primary'` | |
| `size` | see Sizes | `'md'` | `xs`/`sm`/`md` are `min-h-11` (44px); `lg` is `h-12`, `xl` is `h-14` |
| `leftIcon`, `rightIcon` | node | none | Wrapped in `aria-hidden` spans, hidden while loading |
| `isLoading` / `loading` | boolean | `false` | Either name works. Shows a spinner, disables the button and sets `aria-busy` |
| `isDisabled` / `disabled` | boolean | `false` | Either name works |
| `slowAfterMs` | number or `false` | `SLOW_THRESHOLD_MS` (8000) | Pass `false`/`0` to turn off the slow notice |
| `slowKind` | `'read'` or `'write'` | `'write'` | Picks the slow-state guidance text |
| `slowGuidance` | string | none | Overrides the guidance text |
| `slowMessage` | boolean | `false` | Also shows the slow copy visibly after the button |
| `aria-describedby` | string | none | Merged with the slow-region id |
| `className`, `ref`, `...props` | | | Passed through to `<button>` |

Accessibility:

- Focus shows through `focus-visible:ring-4` with the variant's ring colour. The
  button is a native `<button>`, so Enter and Space work.
- While loading, the button is `disabled` and has `aria-busy="true"`. The
  spinner is `aria-hidden`.
- The fragment shape is identical whether or not the button is loading, so
  toggling `loading` never remounts the button or moves focus.
- While loading, a `role="status"` `aria-live="polite"` region is mounted and
  linked through `aria-describedby`. After the threshold it announces
  `SLOW_MESSAGE` plus the guidance text. By default the region is visually
  hidden and portalled to `<body>`. With `slowMessage` it renders inline.
- No default `type` is set, so inside a `<form>` the button submits. Pass
  `type="button"` for buttons that should not submit.

```jsx
import { Button } from '../components/ui';
import { Plus } from 'lucide-react';

<Button variant="outline" size="sm" leftIcon={<Plus />} type="button" onClick={add}>
  Add item
</Button>
<Button type="submit" loading={saving}>Save</Button>
```

---

## Forms

### `Input`

Source: `web/src/components/ui/Input.jsx`

A `forwardRef` `<input>` with token styling. It has no variants or sizes.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `type` | string | `'text'` | |
| `className`, `ref`, `...props` | | | Passed through to `<input>` |

Accessibility:

- Input does not render a label. Pair it with a `<label htmlFor>` or pass
  `aria-label`.
- Focus shows `focus:ring-2 focus:ring-ring` with a 1px offset. `disabled`
  lowers the opacity and uses a `not-allowed` cursor.
- Pass `aria-invalid` and `aria-describedby` yourself for errors. They are
  forwarded unchanged.

Tokens: `border`, `background`, `muted-foreground` (placeholder), `ring`.

```jsx
<label htmlFor="client-name" className="text-sm font-medium">Name</label>
<Input id="client-name" value={name} onChange={(e) => setName(e.target.value)} />
```

---

## Containers

### `Card`

Source: `web/src/components/ui/Card.jsx`

A `forwardRef` `<div>` surface.

**Variants:** `default`, `elevated`, `outlined`, `ghost`, `glass`

**Padding:** `none`, `xs`, `sm`, `md`, `lg`, `xl`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `variant` | see Variants | `'default'` | `glass` uses the `glass-card` utility |
| `padding` | see Padding | `'md'` (`p-5`) | |
| `isInteractive` | boolean | `false` | Adds `cursor-pointer hover-lift` only |
| `className`, `ref`, `...props` | | | Passed through to `<div>` |

Accessibility:

- Card is a plain `<div>`. `isInteractive` is visual only: it adds no role,
  `tabIndex` or key handling.
- For a clickable card, put a real `<button>` or `<a>` inside it, or pass
  `role`, `tabIndex={0}` and an `onKeyDown` yourself.

Tokens: `card`, `card-foreground`, `border`, `foreground`.

```jsx
<Card variant="elevated" padding="lg">
  <CardHeader>
    <CardTitle>Revenue</CardTitle>
    <CardDescription>Last 30 days</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter><Button size="sm">View</Button></CardFooter>
</Card>
```

### `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`

Source: `web/src/components/ui/Card.jsx`

`forwardRef` layout parts that accept `className` and `...props`:

- `CardHeader`: a `<div>` with `flex flex-col space-y-2 mb-4`.
- `CardTitle`: an `<h3>` with `font-display font-bold text-xl`. It is always an
  `h3`, so check that this fits the page's heading outline.
- `CardDescription`: a `<p>` with `text-sm text-muted-foreground`.
- `CardContent`: an unstyled `<div>`.
- `CardFooter`: a `<div>` with a top `border-border` divider and
  `justify-between`.

### `StatCard`

Source: `web/src/components/ui/StatCard.jsx`

A `forwardRef` KPI tile.

**Variants:** `default`, `primary`, `success`, `warning`, `danger`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `label` | node | none | Rendered in a `<p>` |
| `value` | node | none | Rendered large in a `<p>` |
| `icon` | component (for example a lucide icon) | none | Rendered at `w-6 h-6` |
| `trend` | `'up'`, `'down'` or any other value | none | Picks `TrendingUp`, `TrendingDown` or `Minus` |
| `trendValue` | node | none | Followed by the fixed text "vs last period" |
| `variant` | see Variants | `'default'` | |
| `className`, `ref`, `...props` | | | Passed through to the root `<div>` |

Accessibility:

- StatCard is not interactive: it has no role or focus handling.
- The icon and trend glyph are not marked `aria-hidden`. Read order is label,
  value, then trend.
- The hover lift (`hover:-translate-y-1`) has no `motion-reduce` guard.

Tokens: `card`, `border`, `muted`, `primary`, `success`, `warning`, `destructive`.

```jsx
<StatCard label="Open invoices" value={12} icon={Receipt} variant="warning" trend="up" trendValue="+3" />
```

### `Modal`

Source: `web/src/components/Modal.jsx`

A modal dialog rendered in place (not portalled) as a `fixed inset-0 z-50`
overlay.

**Sizes:** `sm`, `md`, `lg`, `xl`, `full`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `isOpen` | boolean | none | Renders nothing when false |
| `onClose` | function | none | Called on Escape, a backdrop click and the close button |
| `title` | node | none | Rendered as an `<h2>` and used as the accessible name |
| `size` | see Sizes | `'md'` | `max-w-md` / `-lg` / `-2xl` / `-4xl` / `90vw` |
| `showCloseButton` | boolean | `true` | |
| `ariaLabel` | string | `'Dialog'` | Only used when there is no `title` |
| `children` | node | none | Placed in the padded body |

Accessibility:

- The dialog has `role="dialog"` and `aria-modal="true"`. It is named by the
  title through `aria-labelledby`, or by `aria-label` when there is no title.
- On open, focus moves to the first focusable element, or to the dialog itself
  (`tabIndex={-1}`). Tab and Shift+Tab wrap inside the dialog.
- Escape calls `onClose`, read through a ref so inline handlers do not re-run
  the focus effect.
- Body scroll is locked while the dialog is open. On close, focus goes back to
  the element that was focused before it opened.
- The close button is labelled "Close modal". The backdrop is `aria-hidden`.

Tokens: `card`, `card-foreground`, `border`, `muted`, `muted-foreground`, `foreground`.

```jsx
import Modal, { ModalFooter } from '../components/Modal';

<Modal isOpen={open} onClose={() => setOpen(false)} title="Create note" size="lg">
  <Input aria-label="Title" />
  <ModalFooter>
    <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
    <Button type="submit">Save</Button>
  </ModalFooter>
</Modal>
```

### `ModalFooter`

Source: `web/src/components/Modal.jsx`

A right-aligned action row with a top border. Its negative margins pull it to
the modal body's edges. Props: `children` and `className`.

### `ConfirmDialog`

Source: `web/src/components/ConfirmDialog.jsx`

A confirmation built on `Modal` (`size="sm"`), `ModalFooter` and `Button`.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `isOpen` | boolean | none | |
| `title`, `description` | node | none | |
| `confirmLabel` / `cancelLabel` | string | `'Confirm'` / `'Cancel'` | |
| `onConfirm`, `onCancel` | function | none | `onCancel` is also called on Escape and on a backdrop click |
| `pending` | boolean | `false` | Blocks closing, hides the close button and puts the confirm button in its loading state |
| `error` | node | none | Rendered with `role="alert"` |
| `destructive` | boolean | `true` | Confirm button uses `destructive`, or falls back to `primary` when false |
| `children` | node | none | Extra content under the description |

Accessibility: inherits Modal's focus trap and focus restore. While `pending`,
Escape, the backdrop and Cancel do nothing, so a write in flight cannot be
abandoned half-way.

```jsx
<ConfirmDialog isOpen={confirming} title="Delete client?" description="This cannot be undone."
  confirmLabel="Delete" pending={deleting} error={deleteError}
  onConfirm={remove} onCancel={() => setConfirming(false)} />
```

---

## Feedback

### `Badge`

Source: `web/src/components/ui/Badge.jsx`

A `forwardRef` `<span>` pill. Its look comes from `color` × `variant`.

**Variants:** `default`, `outline`, `subtle`, `solid`

**Colors:** `default`, `primary`, `success`, `warning`, `danger`, `info`

**Sizes:** `xs`, `sm`, `md`, `lg`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `variant` | see Variants | `'default'` | `outline` adds `border-2` |
| `color` | see Colors | `'default'` | `danger` maps to the `destructive` token |
| `size` | see Sizes | `'sm'` | |
| `dot` | boolean | `false` | Adds a leading colour dot (`aria-hidden`) |
| `className`, `ref`, `...props` | | | Passed through to `<span>` |

Accessibility:

- Badge is static text with no role. Colour must not be the only signal: the
  text itself has to state the status.
- The colour prop is named `color`, which is also an HTML attribute. It is
  consumed by the component and not forwarded to the DOM.

```jsx
<Badge color="success" variant="subtle" dot>Paid</Badge>
```

### `Alert`

Source: `web/src/components/ui/Alert.jsx`

A `forwardRef` inline message with an icon, an optional title, an action and a
dismiss button.

**Variants:** `error`, `warning`, `success`, `info`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `variant` | see Variants | `'info'` | An unknown value falls back to `info` |
| `title` | node | none | Bold first line |
| `children` | node | none | Body text |
| `action` | node | none | Rendered below the body |
| `onDismiss` | function | none | Shows a dismiss button when set |
| `role` | string | derived | Overrides the default role |
| `className`, `ref`, `...props` | | | Passed through to the root `<div>` |

Accessibility:

- `error` and `warning` get `role="alert"` and `aria-live="assertive"`.
- `success` and `info` get `role="status"` and `aria-live="polite"`.
- The dismiss button is `type="button"`, labelled "Dismiss", at least 44×44px,
  with a `focus-visible:ring-2 ring-ring` focus ring.
- The icon is `aria-hidden`, and the entrance animation respects
  `motion-reduce`.

Tokens: `destructive` for `error`, raw `amber` / `green` / `blue` for the
others (see Known token gaps), plus `foreground`, `muted-foreground` and `ring`.

```jsx
<Alert variant="error" title="Could not save" onDismiss={clearError}
  action={<Button size="sm" variant="outline" type="button" onClick={retry}>Retry</Button>}>
  Check your connection and try again.
</Alert>
```

### `EmptyState`

Source: `web/src/components/ui/EmptyState.jsx`

A centred empty-collection message with an icon or illustration and optional
actions.

**Icons:** `inbox`, `projects`, `search`, `mail`, `document`, `team`, `notifications`, `success`, `invoice`, `expense`, `tasks`

| Prop | Type | Default | Notes |
|---|---|---|---|
| `icon` | see Icons | `'inbox'` | An unknown value falls back to `Inbox` |
| `title` | string | `'No items found'` | Rendered as an `<h3>` |
| `description` | string | `'There are no items to display at the moment.'` | |
| `actionLabel` | string | none | Renders a primary `Button` that calls `onAction` |
| `onAction` | function | none | |
| `actionHref` | string | none | Accepted but currently unused |
| `secondaryAction` | node | none | Rendered next to the primary action |
| `illustration` | node | none | Replaces the icon tile |
| `className` | string | none | |

Accessibility: the heading is always an `h3`. The icon tile is not marked
`aria-hidden`, but lucide icons render without accessible text. The action is a
real `Button`.

```jsx
<EmptyState icon="search" title="No matches" description="Try a different filter."
  actionLabel="Clear filters" onAction={clear} />
```

### `EmptyInbox`, `EmptyProjects`, `EmptySearch`, `EmptyNotifications`, `EmptyTeam`, `EmptyClients`, `EmptyInvoices`, `EmptyProposals`, `EmptyExpenses`, `EmptyTasks`

Source: `web/src/components/ui/EmptyState.jsx`

Presets of `EmptyState` with fixed copy. Each takes one callback for its action:

- `EmptyInbox`: `onBrowseProjects`.
- `EmptyProjects`: `onCreateProject`.
- `EmptySearch`: `query` and `onClear`. The description quotes `query`.
- `EmptyNotifications`: no action.
- `EmptyTeam`: `onInvite`.
- `EmptyClients`: `onAddClient`.
- `EmptyInvoices`: `onCreateInvoice`.
- `EmptyProposals`: `onCreateProposal`.
- `EmptyExpenses`: `onAddExpense`.
- `EmptyTasks`: `onCreateTask`.

---

## Loading and slow states

### `LoadingState`

Source: `web/src/components/ui/LoadingState.jsx`

A named spinner status. It adds slow-state copy after the threshold.

**Sizes:** `sm`, `md`, `lg`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `label` | string | `'Loading…'` | Visible text and `aria-label` |
| `size` | see Sizes | `'md'` | Spinner size |
| `compact` | boolean | `false` | Drops the `min-h-[12rem]` |
| `slowAfterMs` | number or `false` | `SLOW_THRESHOLD_MS` | |
| `slowKind` | `'read'` or `'write'` | `'read'` | |
| `slowGuidance` | string | none | |
| `as` | element type | `'div'` | |
| `className`, `spinnerClassName`, `...props` | | | |

Accessibility:

- The root is `role="status"` `aria-live="polite"` with `aria-label={label}`.
- The slow copy is added inside the same live region, so there are no nested
  live regions. The root gets `data-slow` once the threshold passes.
- The spinner is `aria-hidden` and respects `motion-reduce`.

Tokens: `muted`, `muted-foreground`, `primary`.

```jsx
if (isLoading) return <LoadingState label="Loading invoices…" />;
```

### `SlowNotice`, `SlowMessage`, `SlowLoadingStatus`

Source: `web/src/components/ui/SlowNotice.jsx`

The file also exports these constants:

- `SLOW_MESSAGE`: the main slow-state sentence.
- `SLOW_GUIDANCE`: guidance text keyed by `read` and `write`.
- `SLOW_WRITE_INLINE`: a preset for the client portal's own palette.

Components:

- `SlowMessage({ kind = 'read', guidance, className, style })`: slow-state copy
  only, with no live-region semantics. Use it inside an existing polite region.
- `SlowNotice({ active, thresholdMs = SLOW_THRESHOLD_MS, kind = 'read', guidance, className, messageClassName, style })`:
  - Renders nothing while `active` is false.
  - While `active`, mounts an empty, visually hidden `role="status"`
    `aria-live="polite"` `<p>`, then fills it after the threshold. This makes
    the announcement reliable.
- `SlowLoadingStatus({ label, className, style })`:
  - A spinner-free polite status for surfaces with their own styling, such as
    the client portal.
  - The slow copy inherits the surrounding text colour.

`SlowNotice` is re-exported from `components/ui` as the default, and
`SlowMessage` as a named export. Import `SlowLoadingStatus` from the file
directly.

```jsx
<SlowNotice active={uploading} kind="write" />
```

### `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonStatCard`, `SkeletonAvatar`, `SkeletonThreadRow`, `SkeletonPageHeader`

Source: `web/src/components/ui/Skeleton.jsx`

Placeholder blocks.

**Sizes:** `xs`, `sm`, `md`, `lg`, `xl`

- `Skeleton({ className, 'aria-hidden' = true, ...props })`: a pulsing
  `bg-muted skeleton-shimmer` block, `aria-hidden` by default.
- `SkeletonText({ lines = 1 })`: stacked lines. The last line is shortened when
  there is more than one.
- `SkeletonAvatar({ size = 'md' })`: a round block. The Sizes above apply here.
- `SkeletonCard`, `SkeletonStatCard`, `SkeletonThreadRow`, `SkeletonPageHeader`:
  fixed compositions that accept `className` and `...props`.

Accessibility:

- Skeletons are hidden from assistive tech. The container using them must
  provide the `role="status"` / `aria-busy` semantics, as the page skeletons
  below do.
- The pulse respects `motion-reduce`.

Tokens: `muted`, `border`, `card`.

### `TablePageSkeleton`, `KanbanPageSkeleton`, `ListPageSkeleton`, `AnimatedList`

Source: `web/src/components/ui/PageSkeleton.jsx`

Full-page loading layouts:

- `TablePageSkeleton({ rows = 6, showStats = false, label = 'Loading content' })`
- `KanbanPageSkeleton({ columns = 4, cardsPerColumn = 3, label = 'Loading projects' })`
- `ListPageSkeleton({ rows = 5, label = 'Loading list' })`

All three accept `className`.

Accessibility:

- Each root is `role="status"` `aria-live="polite"` `aria-label={label}` with
  `aria-busy="true"`.
- After the slow threshold, `aria-busy` is removed and `SlowMessage` is shown,
  because some screen readers suppress announcements while a region is busy.

`AnimatedList({ children, className })` wraps loaded items in the
`stagger-children` utility, which respects reduced motion.

```jsx
if (isLoading) return <TablePageSkeleton rows={8} showStats label="Loading invoices" />;
```

---

## Portal convergence

The client portal (`web/src/pages/ClientPortal.jsx`,
`web/src/pages/client-portal/*`) has its own stylesheet,
`web/src/pages/client-portal/portal.css`. It hardcodes hex values that mirror
the brand tokens: `#2e2958` for `--primary` / `--foreground`, `#918c9f` for
`--border`, `#6b667f` for `--muted-foreground` and `#faf9f2` for
`--background`. The table below shows which primitive or token each `.cp-*`
class should converge to. It is a plan only: the portal has not been
refactored.

| `.cp-*` class | Converge to |
|---|---|
| `.cp-btn-primary` | `Button variant="primary"` |
| `.cp-btn-secondary` | `Button variant="outline"` |
| `.cp-btn-danger` | `Button variant="danger"`. The portal version is outlined red, so it may need an outline-danger variant |
| `.cp-btn-ghost` | `Button variant="ghost"` |
| `.cp-link` | `Button variant="ghost"` or a link-style Button variant (none exists yet) |
| `.cp-input` | `Input` |
| `.cp-card` | `Card variant="default"` |
| `.cp-card--interactive` | `Card isInteractive`, plus a real button or link for keyboard access |
| `.cp-card-title` | `CardTitle` |
| `.cp-stat` | `StatCard` |
| `.cp-stat-label` | `StatCard` `label` |
| `.cp-stat-value` | `StatCard` `value` |
| `.cp-badge` | `Badge variant="subtle"` |
| `.cp-badge--green` | `Badge color="success"` |
| `.cp-badge--lime` | `Badge color="success"`, or a new brand-lime (`--accent`) colour |
| `.cp-badge--orange` | `Badge color="warning"` |
| `.cp-badge--red` | `Badge color="danger"` |
| `.cp-badge--blue` | `Badge color="info"` |
| `.cp-badge--purple` | `Badge color="primary"` |
| `.cp-badge--muted` | `Badge color="default"` |
| `.cp-alert` | `Alert` |
| `.cp-alert--red` | `Alert variant="error"` |
| `.cp-error` | `Alert variant="error"`, or `text-destructive` for inline errors |
| `.cp-error-box` | `Alert variant="error"` inside an `EmptyState`-style centred container |
| `.cp-loading` | `LoadingState`, or `SlowLoadingStatus` while the portal keeps its own palette |
| `.cp-text` | `text-foreground` token |
| `.cp-text-muted` | `text-muted-foreground` token |
| `.cp-page-title` | Page heading utilities (`font-heading text-xl font-bold text-foreground`) |
| `.cp-section-title` | `CardTitle`, or section heading utilities |
| `.cp-grid-2` | Tailwind `grid` utilities (layout, no primitive) |
| `.cp-grid-3` | Tailwind `grid` utilities (layout, no primitive) |
| `.cp-space-y-2` | Tailwind `space-y-2` |
| `.cp-space-y-3` | Tailwind `space-y-3` |
| `.cp-space-y-4` | Tailwind `space-y-4` |
| `.cp-space-y-6` | Tailwind `space-y-6` |
| `.cp-visually-hidden` | Tailwind `sr-only` |
| `.cp-tab` | No shared primitive yet. A future Tabs primitive |
| `.cp-kanban` | No shared primitive yet. Align with `KanbanBoard` / `KanbanPageSkeleton` layout |
| `.cp-kanban-col` | No shared primitive yet (kanban column) |
| `.cp-kanban-col-header` | No shared primitive yet (kanban column) |
| `.cp-kanban-col-body` | No shared primitive yet (kanban column) |
| `.cp-kanban-card` | `Card padding="sm"` |
| `.cp-chat-container` | No shared primitive yet (chat layout) |
| `.cp-chat-messages` | No shared primitive yet (chat layout) |
| `.cp-chat-bubble` | `Card padding="sm"` |
| `.cp-chat-input-bar` | `Input` + `Button` in a `CardFooter`-style row |
| `.cp-upload-zone` | No shared primitive yet. A future dropzone primitive (it is a native `<button>` today) |
| `.cp-login-bg` | Auth layout. Align with the SPA login screen, not a primitive |
| `.cp-login-card` | `Card padding="lg"` |
| `.cp-login-logo` | Auth layout, not a primitive |
| `.cp-login-title` | `CardTitle` |
| `.cp-login-subtitle` | `CardDescription` |
| `.cp-login-form` | Form layout (`flex flex-col gap-3`) |
| `.cp-login-sent` | `Alert variant="success"` |

`.cp-label` is used in the portal JSX (`ClientPortal.jsx`, `ProjectDetail.jsx`)
but `portal.css` does not define it, so those labels get no portal styling. It
should converge to the SPA's form label utilities (`text-sm font-medium`).

The portal's accessibility rules are:

- `:focus-visible` outlines with `3px solid #2e2958`.
- 44px minimum targets.
- `prefers-reduced-motion` resets.

They match the primitives' contract. Keep them when converging.
