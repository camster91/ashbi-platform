// BASIC/CLIENT mode — Cameron hires freelancers

export async function scrapeHiring(page) {
  const result = { jobPosts: [], applicants: [], activeContracts: [] };

  // 1. Scrape open job postings
  try {
    await page.goto('https://www.upwork.com/nx/hire/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    result.jobPosts = await page.evaluate(() => {
      const cards = document.querySelectorAll('div[class*="job-post"], section[class*="card"], .air3-card-section, div[data-test="job-posting"]');
      return Array.from(cards).slice(0, 20).map(el => {
        const titleEl = el.querySelector('a[class*="title"], h3, h4, a');
        const applicantEl = el.querySelector('span[class*="applicant"], span[class*="proposals"], .text-muted');
        const dateEl = el.querySelector('time, span[class*="date"], small');
        const statusEl = el.querySelector('span[class*="status"], span[class*="badge"]');
        return {
          title: titleEl?.textContent?.trim() || '',
          url: titleEl?.href || '',
          applicantCount: applicantEl?.textContent?.trim() || '0',
          postedDate: dateEl?.textContent?.trim() || '',
          status: statusEl?.textContent?.trim() || 'open',
        };
      });
    });
  } catch (e) {
    console.error('Error scraping job posts:', e.message);
  }

  // 2. Try to get applicants for each job post
  for (const job of result.jobPosts.slice(0, 5)) {
    if (!job.url) continue;
    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      // Look for applicants tab or list
      const applicantTab = await page.$('a[href*="applicant"], button:has-text("Applicants"), [data-test="applicants-tab"]');
      if (applicantTab) await applicantTab.click();
      await page.waitForTimeout(1500);

      const apps = await page.evaluate(() => {
        const items = document.querySelectorAll('div[class*="applicant"], div[class*="freelancer-card"], section[class*="proposal"]');
        return Array.from(items).slice(0, 10).map(el => {
          const nameEl = el.querySelector('a[class*="name"], h4, span[class*="name"]');
          const rateEl = el.querySelector('span[class*="rate"], span[class*="price"]');
          const snippetEl = el.querySelector('p[class*="cover"], div[class*="letter"], .text-body');
          return {
            name: nameEl?.textContent?.trim() || '',
            rate: rateEl?.textContent?.trim() || '',
            proposalSnippet: snippetEl?.textContent?.trim()?.slice(0, 200) || '',
          };
        });
      });

      apps.forEach(a => {
        a.jobTitle = job.title;
        result.applicants.push(a);
      });
    } catch (e) {
      console.error(`Error scraping applicants for ${job.title}:`, e.message);
    }
  }

  // 3. Scrape active contracts
  try {
    await page.goto('https://www.upwork.com/ab/contracts/active', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    result.activeContracts = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr[class*="contract"], div[class*="contract-item"], .air3-card-section');
      return Array.from(rows).slice(0, 20).map(el => {
        const nameEl = el.querySelector('a[class*="name"], span[class*="freelancer"], h4');
        const jobEl = el.querySelector('a[class*="title"], span[class*="job"]');
        const hoursEl = el.querySelector('span[class*="hours"], td:nth-child(3)');
        const activityEl = el.querySelector('time, span[class*="activity"], small');
        return {
          freelancerName: nameEl?.textContent?.trim() || '',
          jobTitle: jobEl?.textContent?.trim() || '',
          hoursLogged: hoursEl?.textContent?.trim() || '0',
          lastActivity: activityEl?.textContent?.trim() || '',
        };
      });
    });
  } catch (e) {
    console.error('Error scraping active contracts:', e.message);
  }

  return result;
}
