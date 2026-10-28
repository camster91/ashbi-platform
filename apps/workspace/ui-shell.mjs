import {fontPreload} from './ui-font-assets.generated.mjs';

// Decorative icons never replace the visible navigation names.
const icons={
 overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 clients:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 projects:'M3 7V4h6l2 3h10v13H3z',
 tasks:'M9 6h12 M9 12h12 M9 18h12 M3 6l1 1 2-2 M3 12l1 1 2-2 M3 18l1 1 2-2',
 notes:'M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h8',
 time:'M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 files:'M21 11l-9 9a6 6 0 0 1-8-8l10-10a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3l9-9',
 finance:'M3 21h18 M6 17v-6 M12 17V3 M18 17V7',
 invoices:'M5 3h14v18l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h8 M8 15h4',
 commercial:'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h4',
 reviews:'M21 11v9H3V4h12 M8 11l3 3L21 4',
 contracts:'M14 2H5v20h14V7z M14 2v5h5 M8 16l2-2 2 2 4-4',
 'source-history':'M3 4v5h5 M3 9a9 9 0 1 1 1 9 M12 7v5l3 2'
};
const groups=[
 ['Work',[['overview','Overview'],['projects','Projects'],['tasks','Tasks'],['time','Time']]],
 ['Clients &amp; billing',[['clients','Clients'],['finance','Finance'],['invoices','Invoices'],['commercial','Proposals &amp; contracts'],['reviews','Proposal reviews'],['contracts','Contracts']]],
 ['Documents',[['notes','Documents'],['files','Files']]],
 ['Administration',[['source-history','Source history']]]
];
const navigation=groups.map(([label,links])=>`<div class="nav-group" role="group" aria-label="${label}"><p class="nav-label" aria-hidden="true">${label}</p>${links.map(([route,name])=>`<a href="#${route}"${route==='source-history'?' hidden':''}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${icons[route]}"/></svg><span>${name}</span></a>`).join('')}</div>`).join('');

export const html=`<!doctype html>
<html lang="en-CA">
<head>
 <meta charset="utf-8">
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <meta name="robots" content="noindex,nofollow">
 <meta name="color-scheme" content="light">
 <title>Ashbi workspace</title>
 <link rel="preload" href="${fontPreload}" as="font" type="font/woff2" crossorigin>
 <link rel="stylesheet" href="/app.css">
 <script defer src="/app.js"></script>
</head>
<body>
 <a class="skip" href="#main">Skip to content</a>
 <header class="app-header">
  <a class="brand" href="/">ashbi<span>Workspace</span></a>
  <a class="sign-out" href="/cdn-cgi/access/logout">Sign out</a>
 </header>
 <section id="active-timer" aria-label="Active timer" hidden>
  <div class="row">
   <p id="timer-summary" aria-live="polite" aria-atomic="true">Checking active timer…</p>
   <div class="timer-actions">
    <button type="button" id="stop-active-timer" hidden>Stop active timer</button>
    <button type="button" id="refresh-active-timer" class="secondary">Refresh timer</button>
    <a class="button secondary" href="#time">Open time tracking</a>
   </div>
  </div>
 </section>
 <div class="shell">
  <nav aria-label="Workspace">${navigation}</nav>
  <main id="main" tabindex="-1"><h1>Opening your workspace</h1><p role="status">Checking access…</p></main>
 </div>
 <footer class="app-footer">Ashbi workspace</footer>
</body>
</html>`;
