// Shared email theme (#315). Email clients need inline colour literals (no CSS
// variables, no Tailwind), so the HTML templates in this folder reference
// these values as `{{theme.<name>}}` and `renderEmailTheme()` fills them in
// before any user variables are substituted. This file is the single source
// for email colours: change a value here, not in the templates.
//
// The brand values mirror the web design tokens and the `brand` colours in
// web/tailwind.config.js (indigo #2e2958, lime #e6f354, cream #faf9f2).

export const EMAIL_THEME = Object.freeze({
  // Brand
  indigo: '#2e2958', // header band, headings, CTA text
  lime: '#e6f354', // tagline, accent bar, CTA fill
  cream: '#faf9f2', // page background, summary cards
  white: '#ffffff', // body card, header wordmark

  // Neutral text and rules
  textStrong: '#444444', // quoted message body
  text: '#555555', // body copy
  textSoft: '#666665', // secondary rows
  textMuted: '#888888', // labels and footers
  border: '#e8e6dd', // card borders and dividers

  // Status badges
  danger: '#c0392b',
  dangerBg: '#fdecea',
  success: '#27804a',
  successBg: '#e8f8e8',
  infoBg: '#ede9fe',

  // Translucent effects
  limeGlow: 'rgba(230,243,84,0.35)', // CTA shadow
  limeTint: 'rgba(230,243,84,0.15)',
  indigoShadow: 'rgba(46,41,88,0.05)',
  footerText: 'rgba(255,255,255,0.6)', // footer copy on the indigo band
  footerTextSoft: 'rgba(255,255,255,0.4)',
});

const THEME_TOKEN = /\{\{theme\.(\w+)\}\}/g;

/**
 * Replace `{{theme.<name>}}` placeholders with EMAIL_THEME values. An unknown
 * name throws, so a typo in a template fails loudly instead of sending a
 * broken colour.
 */
export function renderEmailTheme(html, theme = EMAIL_THEME) {
  return html.replace(THEME_TOKEN, (match, name) => {
    if (!Object.hasOwn(theme, name)) throw new Error(`Unknown email theme colour: ${name}`);
    return theme[name];
  });
}
