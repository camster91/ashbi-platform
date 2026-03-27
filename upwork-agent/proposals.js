// FREELANCER mode — scrape our submitted proposals

export async function scrapeProposals(page) {
  await page.goto('https://www.upwork.com/ab/proposals/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const proposals = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr[class*="proposal"], div[class*="proposal-item"], .proposals-table tbody tr, div[data-test="proposal"]');
    if (rows.length === 0) {
      // Fallback: broader selectors
      const items = document.querySelectorAll('section.air3-card-section, div[class*="ProposalItem"], .up-card-section');
      return Array.from(items).slice(0, 30).map(el => {
        const titleEl = el.querySelector('a[class*="title"], h4 a, a');
        const statusEl = el.querySelector('span[class*="status"], span[class*="badge"], .text-muted');
        const dateEl = el.querySelector('span[class*="date"], time, small');
        return {
          title: titleEl?.textContent?.trim() || '',
          jobUrl: titleEl?.href || '',
          status: statusEl?.textContent?.trim()?.toLowerCase() || 'submitted',
          submittedDate: dateEl?.textContent?.trim() || '',
        };
      });
    }
    return Array.from(rows).slice(0, 30).map(el => {
      const titleEl = el.querySelector('a');
      const statusEl = el.querySelector('span[class*="status"], td:nth-child(2)');
      const dateEl = el.querySelector('time, td:nth-child(3)');
      return {
        title: titleEl?.textContent?.trim() || '',
        jobUrl: titleEl?.href || '',
        status: statusEl?.textContent?.trim()?.toLowerCase() || 'submitted',
        submittedDate: dateEl?.textContent?.trim() || '',
      };
    });
  });

  return proposals.filter(p => p.title);
}
