import {fontCss} from './ui-font-assets.generated.mjs';

// Shared presentation primitives. Workflow modules own behavior, not styling.
export const css=fontCss+`
.project-header { margin-bottom: 1.5rem; }
.project-header h1 { margin-top: .75rem; overflow-wrap: anywhere; }
.project-tabs { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: .5rem; }
.project-tabs a { display: inline-flex; align-items: center; min-height: 44px; padding: .5rem .75rem; border-radius: var(--radius-control, 8px); color: var(--color-muted); text-decoration: none; font-weight: 600; }
.project-tabs a:hover { background: var(--color-surface-soft); }
.project-tabs a[aria-current] { background: var(--color-brand); color: white; }
:root {
 --font-ui: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
 --color-canvas: #faf9f5;
 --color-surface: #ffffff;
 --color-surface-soft: #f3f2ed;
 --color-text: #292840;
 --color-muted: #626272;
 --color-border: #dedee5;
 --color-control-border: #898996;
 --color-brand: #2e2958;
 --color-brand-soft: #eeedf6;
 --color-action: #e6f354;
 --color-action-hover: #dce94b;
 --color-focus: #5145b5;
 --color-error: #a22630;
 --color-error-surface: #fff1f1;
 --space-1: .25rem;
 --space-2: .5rem;
 --space-3: .75rem;
 --space-4: 1rem;
 --space-5: 1.5rem;
 --space-6: 2rem;
 --space-7: 3rem;
 --text-xs: .75rem;
 --text-sm: .8125rem;
 --text-label: .875rem;
 --text-body: 1rem;
 --text-section: 1.125rem;
 --text-title: clamp(1.75rem, 2.5vw, 2rem);
 --radius-control: .5rem;
 --radius-panel: .875rem;
 --shadow-dialog: 0 24px 80px #29284026;
 font-family: var(--font-ui);
 font-size: 16px;
 font-synthesis: style;
 color: var(--color-text);
 background: var(--color-canvas);
 line-height: 1.55;
 color-scheme: light;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; }
a { color: var(--color-brand); text-underline-offset: .2em; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }
svg { flex-shrink: 0; }
h1, h2, h3 { font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
h1 { font-size: var(--text-title); letter-spacing: -.04em; margin: 0 0 var(--space-4); }
h2 { font-size: var(--text-section); letter-spacing: -.02em; margin: var(--space-5) 0 var(--space-4); }
h3 { font-size: var(--text-body); margin: var(--space-4) 0 var(--space-2); }
p { margin: var(--space-3) 0; overflow-wrap: anywhere; }
.muted, small, .help { color: var(--color-muted); }
.help, small { font-size: var(--text-sm); line-height: 1.65; }
strong { font-weight: 650; }

/* Shell and navigation */
.app-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: 1.125rem var(--space-6); background: var(--color-surface); border-bottom: 1px solid var(--color-border); }
.brand { display: inline-flex; align-items: center; gap: var(--space-5); color: var(--color-brand); font-size: 1.875rem; font-weight: 800; letter-spacing: -.075em; line-height: 1.2; text-decoration: none; }
.brand:hover { text-decoration: none; }
.brand span { color: var(--color-muted); border-left: 1px solid var(--color-border); padding-left: var(--space-5); font-size: var(--text-label); font-weight: 500; letter-spacing: 0; }
.sign-out { font-size: var(--text-label); font-weight: 600; padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); }
.sign-out:hover { background: var(--color-brand-soft); }
#active-timer { padding: var(--space-2) var(--space-6); background: var(--color-surface); border-bottom: 1px solid var(--color-border); overflow-wrap: anywhere; }
#timer-summary { font-size: var(--text-sm); color: var(--color-muted); font-variant-numeric: tabular-nums; margin: var(--space-2) 0; }
.timer-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.timer-actions :is(button,.button) { min-height: 36px; padding: .4rem .75rem; font-size: var(--text-xs); }
.shell { display: grid; grid-template-columns: 14.5rem minmax(0,1fr); min-height: calc(100dvh - 8rem); }
nav { display: flex; flex-direction: column; gap: var(--space-5); padding: var(--space-5) var(--space-4); border-right: 1px solid var(--color-border); min-width: 0; }
.nav-group { display: grid; align-content: start; gap: var(--space-1); }
.nav-label { margin: 0 0 var(--space-2); padding-inline: var(--space-3); color: var(--color-muted); font-size: .6875rem; font-weight: 650; letter-spacing: .09em; text-transform: uppercase; }
nav a { display: flex; align-items: center; gap: .65rem; min-height: 44px; padding: .65rem var(--space-3); border: 1px solid transparent; border-radius: var(--radius-control); color: var(--color-text); text-decoration: none; font-size: var(--text-sm); font-weight: 500; line-height: 1.4; }
nav a svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
nav a:hover { background: var(--color-brand-soft); text-decoration: none; }
nav a[aria-current=page] { color: var(--color-surface); background: var(--color-brand); font-weight: 650; }
nav a[aria-current=page] svg { color: var(--color-action); }
main { min-width: 0; width: 100%; max-width: 88rem; padding: var(--space-7) clamp(1.5rem,3vw,3rem); }
.app-footer { padding: var(--space-4) var(--space-6); border-top: 1px solid var(--color-border); color: var(--color-muted); font-size: var(--text-xs); }

/* Panels, records, feedback and metrics */
.panel { min-width: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-panel); padding: var(--space-5); margin: var(--space-5) 0; }
.panel > h2:first-child { margin-top: 0; }
.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); min-width: 0; }
.item { border-bottom: 1px solid var(--color-border); padding: var(--space-5) 0; overflow-wrap: anywhere; min-width: 0; }
.item:last-child { border-bottom: 0; }
.item p { white-space: pre-wrap; margin: var(--space-2) 0; font-size: var(--text-label); }
.item > a:first-child { font-weight: 650; font-size: var(--text-body); }
.record-actions, .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
.record-actions { margin-top: var(--space-4); }
.form-actions { margin-top: var(--space-2); }
.record-actions > a:not(.button) { display: inline-flex; align-items: center; min-height: 44px; max-width: 100%; padding: .5rem .25rem; font-size: var(--text-sm); font-weight: 600; }
.notice { border-left: 3px solid var(--color-brand); border-radius: 0 var(--radius-control) var(--radius-control) 0; padding: var(--space-3) var(--space-4); background: var(--color-brand-soft); font-size: var(--text-label); }
.error { color: var(--color-error); font-weight: 600; padding: var(--space-3) var(--space-4); background: var(--color-error-surface); border-radius: var(--radius-control); }
.stats { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.stat { padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-panel); min-width: 0; }
.stat strong { display: block; color: var(--color-brand); font-size: 2rem; letter-spacing: -.04em; font-variant-numeric: tabular-nums; line-height: 1.25; margin-bottom: var(--space-2); overflow-wrap: anywhere; }
.stat > span { color: var(--color-muted); font-size: var(--text-label); }
.badge { display: inline-flex; align-items: center; border: 1px solid var(--color-border); border-radius: 999px; padding: .2rem .6rem; background: var(--color-surface-soft); color: var(--color-text); font-size: var(--text-xs); font-weight: 600; line-height: 1.5; }

/* Fields and actions: use these primitives in every workflow. */
form { display: grid; gap: var(--space-4); max-width: 36rem; min-width: 0; }
label { display: grid; gap: var(--space-2); min-width: 0; font-size: var(--text-sm); font-weight: 600; }
input, select, textarea, button { font: inherit; }
input, select, textarea { min-width: 0; min-height: 44px; width: 100%; max-width: 100%; padding: .65rem .75rem; border: 1px solid var(--color-control-border); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-text); font-size: var(--text-label); font-weight: 400; line-height: 1.5; }
input::placeholder, textarea::placeholder { color: var(--color-muted); opacity: 1; }
textarea { min-height: 9rem; resize: vertical; }
label.check { display: flex; align-items: flex-start; gap: var(--space-3); font-size: var(--text-label); font-weight: 400; }
input[type=checkbox] { flex-shrink: 0; width: 1.125rem; height: 1.125rem; min-height: 0; margin-top: .125rem; padding: 0; accent-color: var(--color-brand); }
button, .button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 44px; max-width: 100%; padding: .65rem 1rem; border: 1px solid var(--color-brand); border-radius: var(--radius-control); background: var(--color-action); color: var(--color-brand); font-size: var(--text-sm); font-weight: 650; line-height: 1.5; text-align: center; text-decoration: none; cursor: pointer; transition: background-color 120ms ease,border-color 120ms ease; }
button:hover:not(:disabled), .button:hover { background: var(--color-action-hover); text-decoration: none; }
:is(button,.button).secondary { background: var(--color-surface); color: var(--color-brand); border-color: var(--color-control-border); }
:is(button,.button).secondary:hover:not(:disabled) { background: var(--color-brand-soft); border-color: var(--color-brand); }
button[aria-pressed=true] { background: var(--color-brand); color: var(--color-surface); border-color: var(--color-brand); }
button[aria-pressed=true]:hover:not(:disabled) { background: var(--color-brand); }
button:disabled { opacity: .55; cursor: not-allowed; }
form > button { justify-self: start; }
:where(section,article,main) > button + button { margin-inline-start: var(--space-2); }
:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.skip { position: fixed; left: var(--space-4); top: -6rem; z-index: 10; padding: var(--space-3) var(--space-4); background: var(--color-surface); color: var(--color-brand); border-radius: var(--radius-control); font-weight: 650; }
.skip:focus { top: var(--space-3); }

/* Dialogs retain native focus containment and modal semantics. */
dialog { width: min(40rem,calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); margin: auto; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-panel); box-shadow: var(--shadow-dialog); background: var(--color-surface); color: var(--color-text); overflow: auto; overflow-wrap: anywhere; }
dialog::backdrop { background: #29284066; }
dialog h2:first-child { margin-top: 0; font-size: 1.375rem; }
dialog form { max-width: none; }
dialog > .panel { margin: 0 0 var(--space-5); padding: 0; border: 0; border-radius: 0; }
dialog > .panel:last-child { margin-bottom: 0; }
.history-dialog h2, .comment-dialog h2 { margin: 0 0 var(--space-3); }
.history-dialog h3 { margin: var(--space-2) 0; }
.history-dialog p { margin: var(--space-2) 0; }
.history-dialog form { gap: var(--space-3); }
.version-list, .comment-thread { max-height: 25vh; overflow: auto; border-block: 1px solid var(--color-border); padding-block: var(--space-2); margin-block: var(--space-4); overflow-wrap: anywhere; }
.version-list { max-height: 20vh; }
.version-content { max-height: 15vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-dialog p { margin: var(--space-3) 0; }
:is(.source-history,.contracts,.reviews,.commercial,.billing,.finance) { min-width: 0; overflow-wrap: anywhere; }
.source-history pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; font: inherit; }
.source-history :is(section,article) { min-width: 0; }
.source-history summary { cursor: pointer; padding-block: var(--space-2); }
.commercial-text { white-space: pre-wrap; }

/* Workspace views */
.task-views { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.task-toolbar { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-4); margin: var(--space-4) 0 var(--space-5); }
.task-board { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-4); }
.task-column { min-width: 0; border: 1px solid var(--color-border); border-radius: var(--radius-control); padding: var(--space-4); background: var(--color-canvas); }
.task-column h2 { font-size: var(--text-label); margin: 0 0 var(--space-4); }
.task-column .item { display: grid; gap: var(--space-2); }
.task-column .item button { width: 100%; text-align: left; }
.task-column .record-actions { display: grid; align-items: stretch; }
@media(max-width:1100px) {
 .task-board { grid-template-columns: 1fr; }
 .stat { padding: var(--space-4); }
}
@media(max-width:900px) {
 .task-toolbar { grid-template-columns: 1fr; }
 .stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@media(max-width:767px) {
 .app-header { padding: var(--space-4); }
 .brand { font-size: 1.75rem; }
 .brand span { display: none; }
 #active-timer { padding: var(--space-2) var(--space-4); }
 .shell { display: block; }
 nav { flex-direction: row; gap: var(--space-1); max-width: 100%; overflow-x: auto; padding: var(--space-2); border-right: 0; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
 .nav-group { display: contents; }
 .nav-label { display: none; }
 nav a { flex-shrink: 0; white-space: nowrap; padding: .6rem .75rem; }
 nav a svg { width: 16px; height: 16px; }
 main { padding: var(--space-5) var(--space-4); }
 .panel { padding: var(--space-4); }
 .app-footer { padding: var(--space-4); }
 input, select, textarea { font-size: 1rem; }
}
@media(prefers-reduced-motion:reduce) {
 *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
@media(forced-colors:active) {
 nav a[aria-current=page], button[aria-pressed=true] { border-color: Highlight; }
 button, .button, .badge { border-color: ButtonText; }
 :focus-visible { outline-color: Highlight; }
}
`;
