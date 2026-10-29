import {fontCss} from './ui-font-assets.generated.mjs';

// Shared presentation primitives. Workflow modules own behavior, not styling.
export const css=fontCss+`
.project-header { margin-bottom: 1.5rem; }
.project-header > .row { justify-content: flex-start; gap: 8px; }
.project-header h1 { margin-top: .75rem; overflow-wrap: anywhere; }
.project-tabs { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.5rem; border-bottom: 1px solid var(--color-border); padding-bottom: .5rem; }
.project-tabs a { display: inline-flex; align-items: center; min-height: 44px; padding: .5rem .75rem; border-radius: var(--radius-control, 8px); color: var(--color-muted); text-decoration: none; font-weight: 600; }
.project-tabs a:hover { background: var(--color-surface-soft); }
.project-tabs a[aria-current] { background: var(--color-brand); color: white; }
:root {
 --font-ui: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
 --color-canvas: #f8f8f6;
 --color-surface: #ffffff;
 --color-surface-soft: #f4f6f8;
 --color-text: #2b2e52;
 --color-muted: #586475;
 --color-border: #e5e9ee;
 --color-control-border: #a7b0ba;
 --color-brand: #42467d;
 --color-brand-soft: #eeedf6;
 --color-action: #e6f254;
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
 --text-body: .875rem;
 --text-section: 1rem;
 --text-title: clamp(1.5rem, 2vw, 1.75rem);
 --radius-control: .5rem;
 --radius-panel: .625rem;
 --shadow-dialog: 0 24px 80px #2b2e5226;
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

/* Workspace shell: navigation is a stable rail, content owns scrolling. */
.workspace-app { --sidebar-width: 224px; }
.app-header { height: 64px; margin-left: var(--sidebar-width); display: flex; align-items: center; gap: 20px; padding: 0 32px; background: white; border-bottom: 1px solid var(--color-border); }
.workspace-breadcrumb { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: 12px; color: var(--color-muted); }
.workspace-breadcrumb strong { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-header svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.6; fill: none; stroke-linecap: round; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--color-text); font-size: 28px; font-weight: 800; letter-spacing: -1.6px; line-height: 1.2; text-decoration: none; }
.brand img { display: block; width: 100px; height: auto; object-fit: contain; }
.auth-card .brand img { width: 116px; }
.brand span { font-size: 9px; color: var(--color-muted); letter-spacing: 1.5px; font-weight: 650; }
.workspace-brand { display: flex; align-items: center; justify-content: space-between; height: 64px; margin: -16px -12px 4px; padding: 0 24px; border-bottom: 1px solid var(--color-border); }
.workspace-brand .brand { padding: 0; }
.workspace-switcher { display: flex; gap: 10px; align-items: center; padding: 12px 8px 20px; }
.workspace-switcher strong { display: block; font-size: 12px; }.workspace-switcher small { display: block; font-size: 11px; }
.sign-out { flex-shrink: 0; font-size: 11px; text-decoration: none; font-weight: 600; }
.app-header #workspace-signout { color: var(--color-muted); background: transparent; border: 0; font-size: 11px; padding: 8px; }
.shell { min-height: calc(100dvh - 64px); margin-left: var(--sidebar-width); }
#workspace-navigation { position: fixed; inset: 0 auto 0 0; width: var(--sidebar-width); background: #fbfcfd; border-right: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 20px; padding: 16px 12px; overflow-y: auto; z-index: 20; }
.nav-group { display: grid; gap: 3px; }
.nav-label { margin: 0 0 5px; padding-inline: 12px; color: var(--color-muted); font-size: 11px; font-weight: 650; letter-spacing: 1px; text-transform: uppercase; }
#workspace-navigation a:not(.brand) { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 8px 12px; border: 1px solid transparent; border-radius: 6px; color: #566170; text-decoration: none; font-size: 12px; font-weight: 500; line-height: 1.4; }
#workspace-navigation a svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
#workspace-navigation a:hover { background: #f0f3f5; }
#workspace-navigation a[aria-current=page] { background: #eeedf6; color: #353963; font-weight: 650; }
.sidebar-note { margin-top: auto; display: flex; align-items: center; gap: 7px; padding: 16px 12px 0; color: var(--color-muted); font-size: 11px; border-top: 1px solid var(--color-border); }
.workspace-content { min-width: 0; }
main { min-width: 0; width: 100%; max-width: 1600px; margin-inline: auto; padding: 32px; }
#active-timer { padding: 6px 32px; border-bottom: 1px solid var(--color-border); background: #f2f1f7; }
#timer-summary { font-size: 11px; margin: 3px 0; }
.timer-actions { display: flex; flex-wrap: wrap; gap: 6px; }.timer-actions :is(button,.button) { min-height: 30px; font-size: 11px; padding: 4px 8px; }
#navigation-toggle, #navigation-close { display: none; }
#navigation-backdrop { position: fixed; inset: 0; border: 0; border-radius: 0; background: #18262d66; z-index: 19; width: 100%; max-width: none; }
#workspace-search { display: flex; gap: 8px; margin-left: auto; min-height: 36px; border: 1px solid var(--color-border); border-radius: 7px; padding: 6px 10px; color: var(--color-muted); font-size: 11px; background: #f9fafb; }
#workspace-search kbd { font: inherit; font-size: 11px; padding: 1px 4px; border: 1px solid var(--color-border); border-radius: 3px; margin-left: 28px; background: white; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }.page-heading h1 { margin: 0; }.page-heading p { font-size: 12px; color: var(--color-muted); margin: 6px 0 0; }
.page-heading-actions { display: flex; align-items: center; gap: 8px; }
.view-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--color-border); margin: 24px 0; }
.view-tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 10px 0; background: transparent; color: var(--color-muted); font-size: 12px; }
.view-tabs button[aria-pressed=true] { color: var(--color-brand); border-bottom-color: var(--color-brand); background: transparent; }
.view-tabs button:hover:not(:disabled) { background: transparent; color: var(--color-brand); }
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
/* The daily workspace is one focused feed, with compact filters and rows. */
.priority-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.priority-action { min-height: 34px; border-radius: 6px; padding: 6px 12px; background: white; border-color: var(--color-border); }
.priority-action strong { font-size: 11px; font-weight: 500; }
.overview-feed { padding: 0; overflow: hidden; }
.overview-feed > h2 { padding: 20px 20px 0; font-size: 14px; }
.overview-feed > .task-toolbar { display: flex; flex-wrap: wrap; gap: 10px; padding: 0 20px 16px; margin-bottom: 0; border-bottom: 1px solid var(--color-border); }
.overview-feed > .task-toolbar label { flex: 1; min-width: 130px; font-size: 11px; color: var(--color-muted); }
.overview-feed > .task-toolbar select { font-size: 11px; min-height: 36px; padding: 7px 9px; }
.overview-feed > div:not(.task-toolbar) > p, .overview-feed > p { margin-inline: 20px; }
.overview-feed > .row { padding: 12px 20px; border-top: 1px solid var(--color-border); }
.overview-feed > .row button { min-height: 34px; font-size: 11px; padding: 6px 10px; }
.overview-record { display: grid; grid-template-columns: minmax(0,1.6fr) minmax(0,1fr) 120px; align-items: center; gap: 20px; padding: 16px 20px; }
.overview-record:hover { background: #fafbfc; }
.overview-record-identity, .overview-record-details { min-width: 0; }
.overview-record-identity > a { font-size: 12px; font-weight: 650; color: var(--color-text); text-decoration: none; }
.overview-record-identity > a:hover { color: var(--color-brand); text-decoration: underline; }
.overview-record-identity p { font-size: 12px; color: var(--color-muted); margin: 5px 0 0; }
.overview-record-details p { font-size: 11px; color: var(--color-muted); margin: 3px 0; }
.overview-record-context { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.overview-record-context a { font-size: 11px; min-height: 34px; display: inline-flex; align-items: center; }
.overview-record-context .help { font-size: 11px; text-align: right; }
@media(max-width:1000px) { .overview-record { grid-template-columns: minmax(0,1fr) minmax(0,.7fr); }.overview-record-context { grid-column: 1/-1; flex-direction: row; align-items: center; justify-content: space-between; } }
@media(max-width:480px) { .overview-record { grid-template-columns: 1fr; gap: 8px; }.overview-record-context { grid-column: auto; }.overview-feed > .task-toolbar label { min-width: calc(50% - 10px); }.overview-feed > .task-toolbar select { font-size: 16px; }.view-tabs { gap: 16px; }.view-tabs button { font-size: 11px; } }

/* List rows share columns; boards, dialogs and project overviews keep their layout. */
.compact-record { padding-block: var(--space-4); }
.record-identity, .record-status, .record-details { min-width: 0; }
.record-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.record-details { color: var(--color-muted); }
@media (min-width: 1100px) {
  .compact-record { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,.8fr) minmax(0,1fr) minmax(0,1.8fr); gap: var(--space-4); align-items: center; }
  .compact-projects, .compact-clients { grid-template-columns: minmax(0,1.6fr) minmax(0,1fr) minmax(0,2fr); }
  .compact-record .record-status { align-items: flex-start; flex-direction: column; margin: 0; }
  .compact-record .record-actions { margin: 0; justify-content: flex-end; }
  .compact-record .record-actions > :is(button,a) { font-size: var(--text-xs); }
  .compact-record .record-identity p, .compact-record .record-details p { margin-block: var(--space-1); }
}
 .search-dialog { width: min(48rem,calc(100vw - 2rem)); }
.search-results { border-top: 1px solid var(--color-border); padding-block: var(--space-3); }
.search-results > a { display: flex; align-items: center; min-height: 44px; padding: var(--space-2); overflow-wrap: anywhere; }
#workspace-search { margin-left: auto; }
@media(max-width:480px) { #workspace-search { padding-inline: var(--space-2); font-size: var(--text-xs); } }
.notice { border-left: 3px solid var(--color-brand); border-radius: 0 var(--radius-control) var(--radius-control) 0; padding: var(--space-3) var(--space-4); background: var(--color-brand-soft); font-size: var(--text-label); }
.error { color: var(--color-error); font-weight: 600; padding: var(--space-3) var(--space-4); background: var(--color-error-surface); border-radius: var(--radius-control); }
.stats { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); margin-bottom: var(--space-4); }
.stat { padding: var(--space-5); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-panel); min-width: 0; }
.stat strong { display: block; color: var(--color-brand); font-size: 2rem; letter-spacing: -.04em; font-variant-numeric: tabular-nums; line-height: 1.25; margin-bottom: var(--space-2); overflow-wrap: anywhere; }
.stat > span { color: var(--color-muted); font-size: var(--text-label); }
.badge { display: inline-flex; align-items: center; border: 1px solid var(--color-border); border-radius: 999px; padding: .2rem .6rem; background: var(--color-surface-soft); color: var(--color-text); font-size: var(--text-xs); font-weight: 600; line-height: 1.5; }

/* Collection surfaces keep metadata scannable and secondary actions contextual. */
.collection-toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.collection-toolbar label { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--color-muted); }.collection-toolbar select { min-height: 36px; font-size: 12px; width: 190px; }
.compact-record { padding: 14px 0; }.compact-record strong, .record-identity > a { font-size: 13px; font-weight: 600; color: var(--color-text); text-decoration: none; }.record-identity > a:hover { color: var(--color-brand); text-decoration: underline; }
.compact-record .record-identity p, .compact-record .record-details p { font-size: 11px; }.compact-record .record-actions > :is(button,a) { min-height: 34px; padding: 6px 10px; font-size: 11px; }
.compact-record .record-status { flex-direction: row; align-items: center; }.badge { font-size: 11px; font-weight: 500; border-radius: 5px; border-color: transparent; }
.badge[data-status=active],.badge[data-status=done],.badge[data-status=complete] { color: #246141; background: #edf6ef; }.badge[data-status=doing] { color: #285d94; background: #ecf2fb; }.badge[data-status=waiting],.badge[data-status=review] { color: #865617; background: #fbf3e3; }
.record-menu { position: relative; font-size: 11px; }.record-menu summary { list-style: none; display: flex; align-items: center; min-height: 34px; padding: 6px 10px; cursor: pointer; color: var(--color-muted); border-radius: 6px; }.record-menu summary::after { content: '⌄'; margin-left: 6px; }.record-menu summary::-webkit-details-marker { display: none; }.record-menu[open] summary { background: var(--color-surface-soft); }
.record-menu > div { position: absolute; top: 100%; right: 0; z-index: 5; width: 190px; padding: 6px; border: 1px solid var(--color-border); border-radius: 8px; background: white; box-shadow: 0 6px 24px #2b2e521a; display: grid; gap: 4px; }.record-menu > div > :is(button,a) { min-height: 40px; justify-content: flex-start; font-size: 12px; padding: 8px; border: 0; margin: 0; text-align: left; text-decoration: none; }
.view-tabs button.secondary { background: transparent; border-color: transparent; color: var(--color-muted); }.view-tabs button.secondary[aria-pressed=true] { border-bottom-color: var(--color-brand); color: var(--color-brand); }.view-tabs button.secondary:hover { background: transparent; }
@media(max-width:767px) { .collection-toolbar { flex-wrap: wrap; }.collection-toolbar label { width: 100%; justify-content: space-between; }.collection-toolbar select { font-size: 16px; }.record-menu summary,.compact-record .record-actions > button { min-height: 44px; }.record-menu > div { right: 0; }.compact-record .record-actions { justify-content: flex-end; } }

/* Fields and actions: use these primitives in every workflow. */
form { display: grid; gap: var(--space-4); max-width: 36rem; min-width: 0; }
label { display: grid; gap: var(--space-2); min-width: 0; font-size: var(--text-sm); font-weight: 600; }
input, select, textarea, button { font: inherit; }
input, select, textarea { min-width: 0; min-height: 44px; width: 100%; max-width: 100%; padding: .65rem .75rem; border: 1px solid var(--color-control-border); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-text); font-size: var(--text-label); font-weight: 400; line-height: 1.5; }
input::placeholder, textarea::placeholder { color: var(--color-muted); opacity: 1; }
textarea { min-height: 9rem; resize: vertical; }
label.check { display: flex; align-items: flex-start; gap: var(--space-3); font-size: var(--text-label); font-weight: 400; }
input[type=checkbox] { flex-shrink: 0; width: 1.125rem; height: 1.125rem; min-height: 0; margin-top: .125rem; padding: 0; accent-color: var(--color-brand); }
button, .button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 44px; max-width: 100%; padding: .65rem 1rem; border: 1px solid var(--color-brand); border-radius: var(--radius-control); background: var(--color-action); color: var(--color-text); font-size: var(--text-sm); font-weight: 650; line-height: 1.5; text-align: center; text-decoration: none; cursor: pointer; transition: background-color 120ms ease,border-color 120ms ease; }
button:hover:not(:disabled), .button:hover { background: var(--color-action-hover); text-decoration: none; }
:is(button,.button).secondary { background: var(--color-surface); color: var(--color-brand); border-color: var(--color-control-border); }
:is(button,.button).secondary:hover:not(:disabled) { background: var(--color-brand-soft); border-color: var(--color-brand); }
button[aria-pressed=true] { background: var(--color-brand); color: var(--color-surface); border-color: var(--color-brand); }
button[aria-pressed=true]:hover:not(:disabled) { background: var(--color-brand); }
button:disabled { opacity: .55; cursor: not-allowed; }
form > button { justify-self: start; }
:where(section,article,main) > button + button { margin-inline-start: var(--space-2); }
:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
.skip { position: fixed; left: var(--space-4); top: -6rem; z-index: 40; padding: var(--space-3) var(--space-4); background: var(--color-surface); color: var(--color-brand); border-radius: var(--radius-control); font-weight: 650; }
.skip:focus { top: var(--space-3); }

/* Invoice fields share space on desktop while keeping one reading order on phones. */
@media(min-width:900px) {
 [data-invoice-form] { max-width: 60rem; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: start; }
 [data-invoice-form] > :not(label), [data-invoice-form] > label:has([name=title]) { grid-column: 1 / -1; }
}

/* Dialogs retain native focus containment and modal semantics. */
dialog { width: min(40rem,calc(100vw - 2rem)); max-width: calc(100vw - 2rem); max-height: calc(100dvh - 2rem); margin: auto; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-panel); box-shadow: var(--shadow-dialog); background: var(--color-surface); color: var(--color-text); overflow: auto; overflow-wrap: anywhere; }
dialog::backdrop { background: #2b2e5266; }
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
.saved-task-views { margin-block: var(--space-4); padding-block: var(--space-4); border-block: 1px solid var(--color-border); }
.saved-task-controls { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
.saved-task-controls label { flex: 1 1 220px; min-width: 0; }
.saved-task-controls button { flex: 0 1 auto; }
.task-views button.secondary[aria-pressed=true], .task-views button.secondary[aria-pressed=true]:hover:not(:disabled) { transition: none; background: var(--color-brand); color: var(--color-surface); border-color: var(--color-brand); }
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
 .app-header { margin-left: 0; padding: 0 16px; gap: 10px; height: 58px; }
 .workspace-breadcrumb > span, #workspace-search kbd { display: none; }
 .workspace-breadcrumb { flex: 1; font-size: 12px; }
 #workspace-search { margin-left: 0; padding: 8px; min-width: 40px; height: 40px; }
 #workspace-search span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
 .shell { margin-left: 0; }.workspace-app { --sidebar-width: 264px; }
 #workspace-navigation { visibility: hidden; transform: translateX(-100%); transition: transform 160ms ease; }
 body.navigation-open { overflow: hidden; }
 body.navigation-open #workspace-navigation { visibility: visible; transform: translateX(0); }
 #workspace-navigation a:not(.brand) { min-height: 44px; font-size: 14px; }
 #navigation-toggle, #navigation-close { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 40px; padding: 8px; border: 0; background: transparent; color: var(--color-text); }
 #navigation-close { font-size: 24px; }
 main { padding: 24px 16px; }.page-heading { align-items: flex-start; flex-wrap: wrap; }
 .panel { padding: 16px; }#active-timer { padding: 6px 16px; }
 input, select, textarea { font-size: 16px; }.view-tabs { gap: 20px; overflow-x: auto; }.view-tabs button { white-space: nowrap; flex-shrink: 0; }
}
@media(prefers-reduced-motion:reduce) {
 *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
@media(forced-colors:active) {
 nav a[aria-current=page], button[aria-pressed=true] { border-color: Highlight; }
 button, .button, .badge { border-color: ButtonText; }
 :focus-visible { outline-color: Highlight; }
}
/* Authentication shares the workspace typography, controls and focus treatment. */
.auth-page { display: grid; min-height: 100dvh; place-items: center; padding: 24px; }
.auth-card { width: min(100%, 440px); background: var(--surface, #fff); border: 1px solid #d8d6e2; border-radius: 16px; padding: 32px; }
.auth-card .brand { display: inline-block; margin-bottom: 24px; }
.auth-card h1 { margin: 0 0 12px; }
.auth-card form { display: grid; gap: 12px; margin: 20px 0; }
.auth-card input { width: 100%; min-width: 0; }
.auth-password { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
.auth-password input { flex: 1; width: 0; }
.auth-password button { flex: 0 0 auto; min-width: 64px; min-height: 44px; margin: 0; }
.auth-card #auth-message { overflow-wrap: anywhere; margin-block: 16px; }
.auth-card [role=alert] { color: #a02222; }
.auth-codes { white-space: pre-wrap; overflow-wrap: anywhere; font-family: monospace; }
@media(max-width:480px) { .auth-page { padding: 16px; } .auth-card { padding: 24px; } }
`;
