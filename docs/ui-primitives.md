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
| `accent` / `accent-foreground` | `--accent`, `--accent-foreground` | Badge (`accent`) |
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
  The per-primitive behaviour is in [Motion](#motion).
- Decorative icons get `aria-hidden="true"`.
- Pending states become "Slow" after `SLOW_THRESHOLD_MS` (8000 ms, from
  `web/src/hooks/useSlowState.js`). They explain the delay inside a polite live
  region; see `docs/workflow-state-matrix.md`.

<a id="motion"></a>**Motion**

Two layers honour `prefers-reduced-motion: reduce`. Per-component
`motion-reduce:` classes stop a primitive's own animation. A global rule in
`web/src/index.css` backs them up: it disables every animation, cuts
transitions to 0.01 ms, shows `animate-fade-in` / `animate-slide-up` /
`animate-scale-in` and `stagger-children` content in its final state, and
removes hover transforms (`hover-lift`, `hover:-translate-*`, `hover:scale-*`,
`group-hover:scale-*`). What each primitive does:

| Primitive | Default motion | Under reduced motion |
|---|---|---|
| `Button` | Colour transition (200 ms). The `loading` spinner spins. | `motion-reduce:transition-none`; the spinner has `motion-reduce:animate-none` and stays visible, static. |
| `Input` | None (focus ring appears without a transition). | Unchanged. |
| `Card` | `hover-lift` lift and shadow, `transition-all` 300 ms, when interactive. | The global rule removes the lift; the shadow change is instant. |
| `CardHeader` … `CardFooter` | None. | Unchanged. |
| `StatCard` | `hover:-translate-y-1` lift, `transition-all` 200 ms. | The global rule removes the lift; changes are instant. |
| `Modal` | None in practice: the backdrop carries `transition-opacity`, but no opacity changes, so the backdrop and dialog appear immediately. | Unchanged (`motion-reduce:transition-none` is already set). |
| `ModalFooter`, `ConfirmDialog` | None of their own (ConfirmDialog inherits `Modal`). | As `Modal`. |
| `Badge` | None. | Unchanged. |
| `Alert` | Fades in (`animate-fade-in`); colour transition on the dismiss button. | `motion-reduce:animate-none`; shown fully, no fade. |
| `EmptyState` and its presets | None. | Unchanged. |
| `LoadingState` | Spinner spins. | `motion-reduce:animate-none`; a static spinner and the text label stay. |
| `SlowNotice`, `SlowMessage`, `SlowLoadingStatus` | Fade in when the slow threshold passes. | `motion-reduce:animate-none`; shown fully. The live-region announcement is unchanged. |
| `Skeleton` family | Pulse (`animate-pulse`). | `motion-reduce:animate-none`; static placeholder blocks. |
| `TablePageSkeleton`, `KanbanPageSkeleton`, `ListPageSkeleton`, `AnimatedList` | Fade in; `AnimatedList` staggers its children. | `motion-reduce:animate-none`; the global rule shows staggered children at once. |

No primitive conveys state only through motion: a spinner always has a text
label or an `aria-busy` container, and a fade never hides content once it
has ended.

---

## Actions

### `Button`

Source: `web/src/components/ui/Button.jsx`

A `forwardRef` `<button>` with variants, sizes, icons, a loading state and a
built-in slow-state notice.

**Variants:** `primary`, `secondary`, `outline`, `ghost`, `danger`, `destructive`, `success`, `warning`, `danger-outline`, `link`

**Sizes:** `xs`, `sm`, `md`, `lg`, `xl`

`danger` and `destructive` are aliases. `danger-outline` is a
lower-emphasis destructive trigger (red text and border on a transparent
fill), for example a row's delete icon that opens a `ConfirmDialog` whose
confirm button is the solid `danger`. An unknown variant falls back to
`primary`, and an unknown size falls back to `md`. `link` is a text-only
action (primary text, underline on hover) that drops the horizontal padding
but keeps the size's 44px minimum height.

The file also exports `buttonStyles({ variant, size, className })`, which
returns the same class list. Use it to style a real `<a href>` as a Button
(for example the portal's "Pay Now" and "Review and sign" links) instead of
nesting a `<button>` inside a link.

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

The file also exports `inputStyles(className)`, the same class list, for
`<select>` and `<textarea>` fields that should match Input.

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
| `as` | element type | `'div'` | Renders another element, such as `'article'`, `'section'` or `'button'`, so the surface keeps native semantics |
| `className`, `ref`, `...props` | | | Passed through to the root element |

Accessibility:

- Card is a plain `<div>` unless `as` says otherwise. `isInteractive` is
  visual only: it adds no role, `tabIndex` or key handling.
- For a clickable card, render it as a real control
  (`<Card as="button" type="button" isInteractive>`), put a real `<button>`
  or `<a>` inside it, or pass `role`, `tabIndex={0}` and an `onKeyDown`
  yourself.

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
- The hover lift (`hover:-translate-y-1`) has no per-component `motion-reduce`
  class; the global reduced-motion rule in `web/src/index.css` removes it (see
  [Motion](#motion)).

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
| `destructive` | boolean | `true` | Confirm button uses `destructive`, or `primary` when false |
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

**Colors:** `default`, `primary`, `success`, `warning`, `danger`, `accent`, `info`

**Sizes:** `xs`, `sm`, `md`, `lg`

| Prop | Type / values | Default | Notes |
|---|---|---|---|
| `variant` | see Variants | `'default'` | `outline` adds `border-2` |
| `color` | see Colors | `'default'` | `danger` maps to the `destructive` token. `accent` is brand lime and always uses `accent-foreground` text, because lime is too light for coloured text |
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
| `dismissLabel` | string | `'Dismiss'` | Accessible name of the dismiss button. Name what is dismissed, for example "Dismiss upload error" |
| `live` | boolean | `true` | `false` renders a static banner with no role and no `aria-live`, for content that is already on screen at load and must not be announced |
| `role` | string | derived | Overrides the default role |
| `className`, `ref`, `...props` | | | Passed through to the root `<div>` |

Accessibility:

- `error` and `warning` get `role="alert"` and `aria-live="assertive"`.
- `success` and `info` get `role="status"` and `aria-live="polite"`.
- With `live={false}` there is no role and no live region: use it only for
  static banners that are part of the page on load.
- The dismiss button is `type="button"`, labelled by `dismissLabel`
  ("Dismiss" by default), at least 44×44px,
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
- `SLOW_WRITE_INLINE`: a small inline preset whose copy inherits the
  surrounding text colour (used by the client portal's `SlowNotice`s).

Components:

- `SlowMessage({ kind = 'read', guidance, className, style })`: slow-state copy
  only, with no live-region semantics. Use it inside an existing polite region.
- `SlowNotice({ active, thresholdMs = SLOW_THRESHOLD_MS, kind = 'read', guidance, className, messageClassName, style })`:
  - Renders nothing while `active` is false.
  - While `active`, mounts an empty, visually hidden `role="status"`
    `aria-live="polite"` `<p>`, then fills it after the threshold. This makes
    the announcement reliable.
- `SlowLoadingStatus({ label, className, style })`:
  - A spinner-free polite status for surfaces with their own styling. The
    client portal used it before converging on `LoadingState` (#316); it
    currently has no callers.
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
`web/src/pages/client-portal/*`) used to have its own `.cp-*` component
system with hardcoded hex colours. It now uses the shared primitives above
and design tokens (#316). `web/src/pages/client-portal/portal.css` keeps only
portal-specific layout that has no shared primitive yet.

`web/src/tests/client-portal-primitives-convergence.test.js` guards this. It
fails if a `.cp-*` class outside the kept list appears in portal JSX or CSS,
if a retired class comes back, if portal JSX or `portal.css` uses a colour
literal or inline colour style, or if a native `<button>`/`<input>` appears
where a primitive exists.

#### Light-only surface

`main.jsx` applies the visitor's stored or OS theme to `<html>` before React
renders. The portal is client-facing and light-only, so `usePortalLightTheme`
(in `client-portal/shared.jsx`) removes `.dark` while the portal is mounted
and restores it on unmount. Every portal colour is a token, so this one
switch keeps the whole route, including `ConfirmDialog`, on the light token
set. The other public portal pages (`Portal*.jsx`) still use a hardcoded
light slate palette; see `portal-text-contrast-guard.test.js`.

#### Converged

| Former `.cp-*` class | Now |
|---|---|
| `.cp-btn-primary` | `Button` (`primary`); `buttonStyles()` for the "Pay Now" and "Review and sign" links |
| `.cp-btn-secondary` | `Button variant="outline"` |
| `.cp-btn-danger` | `Button variant="danger-outline"` (document delete trigger; the dialog's confirm is the solid `danger`) |
| `.cp-btn-ghost` | `Button variant="ghost"` (header logout, with on-primary token utilities) |
| `.cp-link` | `Button variant="link"`; `buttonStyles({ variant: 'link' })` for `<a href>` |
| `.cp-input` | `Input`; `inputStyles()` for `<select>` and `<textarea>` (via `portalFieldStyles`) |
| `.cp-label` | Label utilities (`labelClass`: `block text-sm font-medium text-foreground`) |
| `.cp-card` | `Card` (`as="article"` / `as="section"` where the old markup was an article or section) |
| `.cp-card--interactive` | `Card as="button" type="button" isInteractive` |
| `.cp-card-title` | `CardTitle` (sized down to `text-base font-semibold`) |
| `.cp-stat` | `StatCard` |
| `.cp-stat-label` | `StatCard` `label` (retainer figures use `text-xs uppercase` utilities) |
| `.cp-stat-value` | `StatCard` `value`; the old conditional colour is now the `variant` (`warning` / `success`) |
| `.cp-badge` | `Badge variant="subtle"` (`StatusBadge` / `statusBadge` in `shared.jsx`) |
| `.cp-badge--green` | `Badge color="success"` |
| `.cp-badge--lime` | `Badge color="accent"` (new brand-lime colour) |
| `.cp-badge--orange` | `Badge color="warning"` |
| `.cp-badge--red` | `Badge color="danger"` |
| `.cp-badge--blue` | `Badge color="info"` |
| `.cp-badge--purple` | `Badge color="primary"` |
| `.cp-badge--muted` | `Badge color="default"` |
| `.cp-alert` | `Alert` |
| `.cp-alert--red` | `Alert variant="error"`; the on-load overdue banner uses `live={false}` so it keeps no role |
| `.cp-error` | `Alert variant="error"` for page errors that were `role="alert"`; `text-destructive` for inline errors |
| `.cp-error-box` | Centred container utilities with `text-destructive` and a `link` Button |
| `.cp-loading` | `LoadingState` |
| `.cp-text` | `text-foreground` |
| `.cp-text-muted` | `text-muted-foreground` |
| `.cp-page-title` | `pageTitleClass` (`mb-4 text-xl font-bold text-foreground`) |
| `.cp-section-title` | `sectionTitleClass` (`mb-3 text-base font-semibold text-foreground`) |
| `.cp-grid-2` | `grid gap-4 md:grid-cols-2` |
| `.cp-grid-3` | `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` |
| `.cp-space-y-2` | `space-y-2` |
| `.cp-space-y-3` | `space-y-3` |
| `.cp-space-y-4` | `space-y-4` |
| `.cp-space-y-6` | `space-y-6` |
| `.cp-visually-hidden` | `sr-only` |
| `.cp-kanban-card` | `Card padding="sm"` |
| `.cp-chat-bubble` | `Card padding="none"` with `px-4 py-3` |
| `.cp-chat-input-bar` | `Input` + `Button` in a token-styled form row |
| `.cp-login-bg` | Auth layout utilities (`min-h-screen bg-primary`, centred) |
| `.cp-login-card` | `Card` |
| `.cp-login-logo` | Layout utilities |
| `.cp-login-title` | Heading utilities on the page `<h1>` (`CardTitle` is an `h3`, so it is not used here) |
| `.cp-login-subtitle` | `CardDescription` |
| `.cp-login-form` | `flex flex-col gap-3` |
| `.cp-login-sent` | Layout utilities (`py-4`). It stays a static message, not an `Alert`, so no live region is added |

#### Kept (portal-specific)

These stay in `portal.css`, written with tokens only, because no shared
primitive covers them yet. Remove each one when its primitive lands.

| `.cp-*` class | Why it stays |
|---|---|
| `.cp-root` | Scopes the portal focus contract: a 3px solid `--ring` outline on every focusable control, stronger than the primitives' `ring-4` at 20% opacity. Aligning `Button`'s own focus ring is follow-up work |
| `.cp-header` | Switches that outline to `--accent` on the indigo header, where the ring colour would be invisible |
| `.cp-tab` | No Tabs primitive. Native `role="tab"` buttons; selected styling follows `aria-selected` |
| `.cp-kanban` | No kanban primitive for read-only client boards (`KanbanBoard` is the staff drag-and-drop board) |
| `.cp-kanban-col` | Kanban column surface |
| `.cp-kanban-col-header` | Kanban column header row |
| `.cp-kanban-col-body` | Kanban column card stack |
| `.cp-chat-container` | No chat-layout primitive: fixed-height message pane + composer |
| `.cp-chat-messages` | Scrolling message pane |
| `.cp-upload-zone` | No dropzone primitive. It is a native `<button>` (`PortalUploadZone`) |

Accessibility kept through the convergence:

- The 3px solid focus outline (`.cp-root`) and 44px targets (`min-h-11` in
  `Button` and portal fields, `min-height: 44px` on `.cp-tab`).
- Buttons whose label changes while busy ("Sending…", "Preparing…") add
  `busyLabelButtonClass` (`disabled:opacity-100`) so the busy label keeps
  full contrast instead of Button's `disabled:opacity-50`.
- Interactive cards use the full `border-border` token (Card's default
  `border-border/60` is below 3:1 on the cream page). Portal stat tiles are
  not interactive, so they override StatCard's hover lift and shadow.
- Portal fields are 16px below the `sm` breakpoint (`portalFieldClass`), so
  iOS Safari does not zoom on focus.
- Reduced motion: `portal.css` has no transforms and stops its transitions;
  the primitives' hover motion (`hover-lift`, StatCard's translate) is reset by
  the global block in `index.css`.
- Contrast: token text colours (`--foreground`, `--muted-foreground`,
  `--destructive`, `--success`, `--warning`, `--info`) are at least as dark as
  the old portal hex values.
