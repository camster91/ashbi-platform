/**
 * Lead Intelligence Agent for ashbi-platform
 * Scrapes new CpG/DTC brand launches from multiple sources
 * and auto-adds them to the outreach queue
 * 
 * Sources: Product Hunt, Kickstarter, Shopify, Domain Registrations
 */

import prisma from '../config/db.js';

const CPG_KEYWORDS = [
  'supplement', 'skincare', 'beauty', 'food', 'beverage', 'drink',
  'nutrition', 'wellness', 'cosmetics', 'personal care', 'protein',
  'vitamin', 'organic', 'natural', 'cpg', ' DTC ', 'direct to consumer'
];

const CATEGORIES = {
  producthunt: ['food-and-drink', 'health', 'beauty', 'products'],
  kickstarter: ['product design', 'technology', 'food', 'fashion']
};

/**
 * Scrape Product Hunt for trending products in CPG/DTC categories
 * Filters for DTC brands (has storefront link, Shopify/WooCommerce detection)
 * 
 * @param {string} category - Product Hunt category slug
 * @returns {Promise<Array>} Array of discovered leads
 */
async function scrapeProductHunt(category = 'food-and-drink') {
  const leads = [];
  
  try {
    // Product Hunt API endpoint for trending products
    const categoryParam = CATEGORIES.producthunt.includes(category) ? category : 'food-and-drink';
    const url = `https://api.producthunt.com/v1/posts?category=${categoryParam}&sort=top&days=7`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.PRODUCT_HUNT_API_KEY || ''}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn(`Product Hunt API error: ${response.status}`);
      // Fallback: scrape the webpage if API unavailable
      return await scrapeProductHuntFallback();
    }

    const data = await response.json();
    
    for (const post of data.posts || []) {
      // Look for storefront links indicating DTC brands
      const storefrontUrl = post.product_url || post.website;
      
      if (!storefrontUrl) continue;

      // Check if it's a DTC brand (Shopify/WooCommerce storefront)
      const isDTC = await detectDTCPlatform(storefrontUrl);
      
      if (isDTC) {
        leads.push({
          source: 'producthunt',
          name: post.name,
          domain: extractDomain(storefrontUrl),
          description: post.tagline,
          launchedAt: post.created_at,
          category: category,
          url: storefrontUrl,
          votes: post.votes_count,
          storefront: storefrontUrl
        });
      }
    }
  } catch (err) {
    console.error('Product Hunt scrape error:', err.message);
  }

  return leads;
}

/**
 * Fallback scraping for Product Hunt using webpage fetch
 * Uses the public Product Hunt page
 */
async function scrapeProductHuntFallback() {
  const leads = [];
  
  try {
    const url = 'https://www.producthunt.com/categories/food-and-drink';
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      }
    });

    if (!response.ok) return leads;

    const html = await response.text();
    
    // Extract product data from page HTML (simplified parsing)
    const productMatches = html.matchAll(/"name":"([^"]+)","slug":"([^"]+)"/g);
    
    for (const match of productMatches) {
      const name = match[1];
      const slug = match[2];
      
      if (name && slug) {
        const productUrl = `https://www.producthunt.com/posts/${slug}`;
        const isDTC = await detectDTCPlatform(productUrl);
        
        if (isDTC) {
          leads.push({
            source: 'producthunt',
            name,
            domain: extractDomain(productUrl),
            launchedAt: new Date().toISOString(),
            category: 'food-and-drink',
            url: productUrl
          });
        }
      }
    }
  } catch (err) {
    console.error('Product Hunt fallback error:', err.message);
  }

  return leads;
}

/**
 * Scrape Kickstarter for live projects in CPG-related categories
 * Filters for product hardware/goods (not film/art)
 * 
 * @param {string} category - Kickstarter category
 * @returns {Promise<Array>} Array of discovered leads
 */
async function scrapeKickstarter(category = 'product design') {
  const leads = [];
  
  try {
    // Kickstarter API endpoint for category search
    const categoryParam = CATEGORIES.kickstarter.includes(category) ? category : 'product design';
    const url = `https://api.kickstarter.com/v1/projects/search.json?category=${encodeURIComponent(categoryParam)}&state=live&per_page=30`;
    
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Kickstarter API error: ${response.status}`);
      return await scrapeKickstarterFallback(category);
    }

    const data = await response.json();
    
    for (const project of data.projects || []) {
      // Filter out film/art categories - only product/goods
      const kickstarterCategory = project.category?.name || '';
      const excludedCategories = ['film', 'art', 'music', 'photography', 'games', 'publishing'];
      
      if (excludedCategories.some(cat => kickstarterCategory.toLowerCase().includes(cat))) {
        continue;
      }

      // Look for product-based projects (hardware, physical goods)
      const hasStorefront = project.urls?.web?.rewards || project.website;
      
      if (hasStorefront) {
        const website = project.website || extractDomain(project.urls?.web?.project || '');
        
        leads.push({
          source: 'kickstarter',
          name: project.name,
          domain: extractDomain(website),
          description: project.blurb,
          launchedAt: project.launched_at,
          category: kickstarterCategory,
          url: project.urls?.web?.project || website,
          pledge: project.pledged,
          goal: project.goal
        });
      }
    }
  } catch (err) {
    console.error('Kickstarter scrape error:', err.message);
  }

  return leads;
}

/**
 * Fallback scraping for Kickstarter
 */
async function scrapeKickstarterFallback(category) {
  const leads = [];
  
  try {
    const categoryMap = {
      'product design': 'product-design',
      'technology': 'technology',
      'food': 'food',
      'fashion': 'fashion'
    };
    
    const catSlug = categoryMap[category] || 'product-design';
    const url = `https://www.kickstarter.com/discover/category/${catSlug}?ref=section-home&sort=newest`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      }
    });

    if (!response.ok) return leads;

    const html = await response.text();
    
    // Parse project data from page HTML
    const projectMatches = html.matchAll(/data-name="([^"]+)".*?data-slug="([^"]+)"/gs);
    
    for (const match of projectMatches) {
      const name = match[1];
      const slug = match[2];
      
      if (name && slug) {
        leads.push({
          source: 'kickstarter',
          name,
          domain: `kickstarter.com/projects/${slug}`,
          launchedAt: new Date().toISOString(),
          category: category
        });
      }
    }
  } catch (err) {
    console.error('Kickstarter fallback error:', err.message);
  }

  return leads;
}

/**
 * Search for newly launched Shopify stores
 * Uses search queries to find new stores
 * 
 * @param {string} query - Search query for Shopify stores
 * @returns {Promise<Array>} Array of discovered leads
 */
async function scrapeShopifyNewStores(query = 'new supplement brand') {
  const leads = [];
  
  try {
    // Use Google search-like approach via SerpAPI or similar
    // Fallback to direct Shopify store discovery
    
    // Search for new Shopify-powered stores via search
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' shopify')}&num=20`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      }
    });

    if (!response.ok) {
      // Alternative: use Shopify Exchange or store directory
      return await scrapeShopifyExchange(query);
    }

    const html = await response.text();
    
    // Extract domain URLs from search results
    const urlMatches = html.matchAll(/href="(https:\/\/[^"]*\.myshopify\.com[^"]*)"/g);
    const seenDomains = new Set();
    
    for (const match of urlMatches) {
      const url = match[1].split('?')[0].split('#')[0];
      const domain = extractDomain(url);
      
      if (domain && !seenDomains.has(domain)) {
        seenDomains.add(domain);
        
        leads.push({
          source: 'shopify',
          name: guessBrandNameFromDomain(domain),
          domain: domain,
          description: query,
          discoveredAt: new Date().toISOString(),
          platform: 'shopify',
          url: url
        });
      }
    }
  } catch (err) {
    console.error('Shopify scrape error:', err.message);
  }

  return leads;
}

/**
 * Fallback: Search Shopify Exchange for new stores
 */
async function scrapeShopifyExchange(query) {
  const leads = [];
  
  try {
    // Shopify Exchange is a marketplace for buying/selling stores
    const searchUrl = `https://empower.shopify.com/c/buy-businesses?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      }
    });

    if (!response.ok) return leads;

    // Parse response for store listings
    const html = await response.text();
    const storeMatches = html.matchAll(/data-store-name="([^"]+)"/g);
    
    for (const match of storeMatches) {
      const storeName = match[1];
      
      if (storeName) {
        leads.push({
          source: 'shopify',
          name: storeName,
          domain: `${storeName.toLowerCase().replace(/\s+/g, '')}.myshopify.com`,
          discoveredAt: new Date().toISOString(),
          platform: 'shopify'
        });
      }
    }
  } catch (err) {
    console.error('Shopify Exchange scrape error:', err.message);
  }

  return leads;
}

/**
 * Check newly registered domains for CPG keywords
 * Uses passive DNS data or domain registration searches
 * 
 * @param {Array<string>} keywords - Keywords to search for
 * @returns {Promise<Array>} Array of discovered leads
 */
async function scrapeDomainRegs(keywords = ['supplement', 'skincare', 'food', 'beverage']) {
  const leads = [];
  
  try {
    // Method 1: Use WhoisXML API for newly registered domains
    if (process.env.WHOISXML_API_KEY) {
      return await scrapeDomainRegsWhoisXML(keywords);
    }
    
    // Method 2: Use BuiltWith API to detect Shopify/WooCommerce on new domains
    if (process.env.BUILTWITH_API_KEY) {
      return await scrapeDomainRegsBuiltWith(keywords);
    }

    // Method 3: Fallback - search for domains containing CPG keywords via CommonCrawl
    return await scrapeDomainRegsCommonCrawl(keywords);
  } catch (err) {
    console.error('Domain regs scrape error:', err.message);
    return leads;
  }
}

/**
 * Scrape domain registrations using WhoisXML API
 */
async function scrapeDomainRegsWhoisXML(keywords) {
  const leads = [];
  
  try {
    for (const keyword of keywords) {
      const url = `https:///whoisxmlapi.com/whoisserver/DNSTrace?type=NEW&keyword=${encodeURIComponent(keyword)}&count=20&apiKey=${process.env.WHOISXML_API_KEY}`;
      
      const response = await fetch(url);
      
      if (!response.ok) continue;

      const data = await response.json();
      
      for (const domain of data.domains || []) {
        const isCPG = keywords.some(kw => 
          domain.toLowerCase().includes(kw.toLowerCase())
        );
        
        if (isCPG) {
          // Check if it's a Shopify/WooCommerce store
          const techStack = await detectDTCPlatform(`https://${domain}`);
          
          if (techStack) {
            leads.push({
              source: 'domain_registration',
              name: guessBrandNameFromDomain(domain),
              domain: domain,
              discoveredAt: domain.create_date,
              platform: techStack,
              keyword: keyword
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('WhoisXML scrape error:', err.message);
  }

  return leads;
}

/**
 * Scrape domain registrations using BuiltWith API
 */
async function scrapeDomainRegsBuiltWith(keywords) {
  const leads = [];
  
  try {
    // BuiltWith has a "Recent Sites" API that shows newly built sites
    const url = `https://api.builtwith.com/v14/api.json?keywords=${encodeURIComponent(keywords.join(','))}&live=y&timeout=10000`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.BUILTWITH_API_KEY}`
      }
    });

    if (!response.ok) return leads;

    const data = await response.json();
    
    for (const result of data.Results || []) {
      const domain = result.Domain;
      const technologies = result.Technologies || [];
      
      // Check for DTC platforms
      const hasShopify = technologies.some(t => t.Name === 'Shopify');
      const hasWooCommerce = technologies.some(t => t.Name === 'WooCommerce');
      
      if (hasShopify || hasWooCommerce) {
        const detectedKeywords = keywords.filter(kw => 
          domain.toLowerCase().includes(kw.toLowerCase())
        );

        leads.push({
          source: 'domain_registration',
          name: guessBrandNameFromDomain(domain),
          domain: domain,
          discoveredAt: new Date().toISOString(),
          platform: hasShopify ? 'Shopify' : 'WooCommerce',
          keyword: detectedKeywords[0] || keywords[0],
          technologies: technologies.slice(0, 5).map(t => t.Name)
        });
      }
    }
  } catch (err) {
    console.error('BuiltWith scrape error:', err.message);
  }

  return leads;
}

/**
 * Search CommonCrawl for newly discovered CPG domains
 */
async function scrapeDomainRegsCommonCrawl(keywords) {
  const leads = [];
  
  try {
    // Use CommonCrawl's API to search for new domains
    const indexUrl = 'https://index.commoncrawl.org/collinfo.json';
    const response = await fetch(indexUrl);
    
    if (!response.ok) return leads;

    const indexes = await response.json();
    
    // Search recent indexes for CPG keywords
    for (const idx of indexes.slice(0, 3)) {
      for (const keyword of keywords) {
        try {
          const searchUrl = `https://${idx.cdx-api}/cdx/search?q=*${keyword}*&filter=status:200&output=json&limit=50`;
          
          const searchResponse = await fetch(searchUrl);
          
          if (!searchResponse.ok) continue;

          const results = await searchResponse.json();
          
          for (const result of results) {
            const url = result.url || '';
            const domain = extractDomain(url);
            
            if (domain && !leads.some(l => l.domain === domain)) {
              // Check if it looks like a CPG brand
              const isLikelyCPG = CPG_KEYWORDS.some(kw => 
                domain.toLowerCase().includes(kw.toLowerCase())
              );

              if (isLikelyCPG) {
                const techStack = await detectDTCPlatform(`https://${domain}`);
                
                if (techStack) {
                  leads.push({
                    source: 'domain_registration',
                    name: guessBrandNameFromDomain(domain),
                    domain: domain,
                    discoveredAt: result.timestamp,
                    platform: techStack,
                    keyword: keyword
                  });
                }
              }
            }
          }
        } catch (e) {
          // Continue to next index/keyword
          console.warn(`CommonCrawl search error for ${keyword}: ${e.message}`);
        }
      }
    }
  } catch (err) {
    console.error('CommonCrawl scrape error:', err.message);
  }

  return leads;
}

/**
 * Enrich a lead with additional data: company info, social accounts, contact email
 * 
 * @param {string} domain - Domain to enrich
 * @returns {Promise<object>} Enriched lead data
 */
async function enrichLead(domain) {
  const enriched = {
    domain,
    companyName: guessBrandNameFromDomain(domain),
    industry: 'CPG/DTC',
    socialAccounts: {},
    estimatedLaunchDate: null,
    contactEmail: null,
    technologies: [],
    description: null
  };

  try {
    // Try to get company info from the website
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      },
      timeout: 10000
    });

    if (response.ok) {
      const html = await response.text();
      
      // Extract meta information
      enriched.companyName = extractMetaContent(html, 'og:title') || enriched.companyName;
      enriched.description = extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description');
      
      // Try to detect contact email from website
      enriched.contactEmail = extractContactEmail(html) || extractContactEmailFromPage(url);
      
      // Detect technologies used
      enriched.technologies = detectTechnologies(html);
      
      // Look for social media links
      enriched.socialAccounts = extractSocialLinks(html, url);
      
      // Estimate launch date from copyright / build info
      enriched.estimatedLaunchDate = extractLaunchDate(html);
    }

    // Use BuiltWith for technology detection if available
    if (process.env.BUILTWITH_API_KEY && enriched.technologies.length === 0) {
      try {
        const bwUrl = `https://api.builtwith.com/v14/api.json?domain=${encodeURIComponent(domain)}&live=y`;
        const bwResponse = await fetch(bwUrl, {
          headers: { 'Authorization': `Bearer ${process.env.BUILTWITH_API_KEY}` }
        });
        
        if (bwResponse.ok) {
          const bwData = await bwResponse.json();
          const result = bwData.Results?.[0];
          if (result) {
            enriched.technologies = result.Technologies?.map(t => t.Name) || [];
          }
        }
      } catch (e) {
        // BuiltWith lookup failed, continue with other data
      }
    }
  } catch (err) {
    console.error(`Enrich lead error for ${domain}:`, err.message);
  }

  return enriched;
}

/**
 * Add a lead to the outreach queue as a ColdEmailProspect
 * 
 * @param {object} lead - Lead data to add
 * @returns {Promise<object>} Created prospect record
 */
async function addToOutreachQueue(lead) {
  try {
    // Check if this domain is already in the prospect database
    const existing = await prisma.coldEmailProspect.findFirst({
      where: {
        OR: [
          { company: lead.domain },
          { company: lead.name }
        ]
      }
    });

    if (existing) {
      // Update existing prospect with new intelligence
      return await prisma.coldEmailProspect.update({
        where: { id: existing.id },
        data: {
          // NOTE: source field may not exist in schema - using raw update if needed
          // If schema has source field, include it; otherwise use metadata field
          company: lead.domain,
          industry: lead.industry || 'CPG/DTC',
          painPoint: lead.description || null,
          status: 'NEW',
          // Additional metadata stored in existing fields
          updatedAt: new Date()
        }
      });
    }

    // Create new prospect
    // NOTE: If ColdEmailProspect schema doesn't have a 'source' field,
    // we store it in the painPoint or a custom metadata approach
    const prospectData = {
      name: lead.name || guessBrandNameFromDomain(lead.domain),
      email: lead.contactEmail || `hello@${lead.domain}`,
      company: lead.domain,
      industry: lead.industry || 'CPG/DTC',
      painPoint: lead.description || `Source: ${lead.source || 'lead_intelligence'}`,
      status: 'NEW'
    };

    // Try to include source field if it exists in the schema
    // This is a graceful fallback - the field may or may not exist
    try {
      const result = await prisma.coldEmailProspect.create({
        data: prospectData
      });
      return result;
    } catch (schemaError) {
      // If source field is missing, create without it
      if (schemaError.message?.includes('source')) {
        return await prisma.coldEmailProspect.create({
          data: prospectData
        });
      }
      throw schemaError;
    }
  } catch (err) {
    console.error('Add to outreach queue error:', err.message);
    throw err;
  }
}

/**
 * Run daily intelligence scan across all sources
 * Orchestrates all scrapers, deduplicates, and creates prospects
 * 
 * @returns {Promise<object>} Results of the intelligence run
 */
async function runDailyIntelligence() {
  const results = {
    startedAt: new Date().toISOString(),
    sources: {},
    totalDiscovered: 0,
    totalAdded: 0,
    errors: []
  };

  console.log('[LeadIntelligence] Starting daily intelligence scan...');

  try {
    // 1. Scrape Product Hunt
    console.log('[LeadIntelligence] Scraping Product Hunt...');
    try {
      const phLeads = await scrapeProductHunt('food-and-drink');
      results.sources.producthunt = phLeads;
      console.log(`[LeadIntelligence] Product Hunt: ${phLeads.length} leads found`);
      
      // Also scrape other categories
      for (const cat of ['health', 'beauty']) {
        const additionalLeads = await scrapeProductHunt(cat);
        results.sources.producthunt = [
          ...(results.sources.producthunt || []),
          ...additionalLeads
        ];
      }
    } catch (e) {
      console.error('[LeadIntelligence] Product Hunt error:', e.message);
      results.errors.push({ source: 'producthunt', error: e.message });
    }

    // 2. Scrape Kickstarter
    console.log('[LeadIntelligence] Scraping Kickstarter...');
    try {
      const ksLeads = await scrapeKickstarter('product design');
      results.sources.kickstarter = ksLeads;
      console.log(`[LeadIntelligence] Kickstarter: ${ksLeads.length} leads found`);
    } catch (e) {
      console.error('[LeadIntelligence] Kickstarter error:', e.message);
      results.errors.push({ source: 'kickstarter', error: e.message });
    }

    // 3. Scrape Shopify stores
    console.log('[LeadIntelligence] Scraping Shopify stores...');
    try {
      const shopifyQueries = [
        'new supplement brand shopify',
        'organic skincare shopify',
        'natural food brand shopify'
      ];
      
      const shopifyLeads = [];
      for (const query of shopifyQueries) {
        const leads = await scrapeShopifyNewStores(query);
        shopifyLeads.push(...leads);
      }
      
      results.sources.shopify = shopifyLeads;
      console.log(`[LeadIntelligence] Shopify: ${shopifyLeads.length} leads found`);
    } catch (e) {
      console.error('[LeadIntelligence] Shopify error:', e.message);
      results.errors.push({ source: 'shopify', error: e.message });
    }

    // 4. Scrape domain registrations
    console.log('[LeadIntelligence] Scraping domain registrations...');
    try {
      const domainLeads = await scrapeDomainRegs(CPG_KEYWORDS);
      results.sources.domain_registration = domainLeads;
      console.log(`[LeadIntelligence] Domain registrations: ${domainLeads.length} leads found`);
    } catch (e) {
      console.error('[LeadIntelligence] Domain registrations error:', e.message);
      results.errors.push({ source: 'domain_registration', error: e.message });
    }

    // Combine all leads and deduplicate
    const allLeads = [
      ...(results.sources.producthunt || []),
      ...(results.sources.kickstarter || []),
      ...(results.sources.shopify || []),
      ...(results.sources.domain_registration || [])
    ];

    // Deduplicate by domain
    const seenDomains = new Set();
    const uniqueLeads = allLeads.filter(lead => {
      const domain = lead.domain?.toLowerCase();
      if (!domain || seenDomains.has(domain)) return false;
      seenDomains.add(domain);
      return true;
    });

    results.totalDiscovered = uniqueLeads.length;
    console.log(`[LeadIntelligence] Total unique leads after dedup: ${uniqueLeads.length}`);

    // Check existing prospects to avoid duplicates
    const existingProspects = await prisma.coldEmailProspect.findMany({
      where: {
        company: { not: null }
      },
      select: { company: true }
    });
    
    const existingDomains = new Set(
      existingProspects.map(p => p.company?.toLowerCase()).filter(Boolean)
    );
    
    const newLeads = uniqueLeads.filter(lead => 
      !existingDomains.has(lead.domain?.toLowerCase())
    );

    console.log(`[LeadIntelligence] New leads to process: ${newLeads.length}`);

    // Enrich and add to outreach queue
    for (const lead of newLeads) {
      try {
        console.log(`[LeadIntelligence] Processing: ${lead.domain}`);
        
        // Enrich lead data
        const enriched = await enrichLead(lead.domain);
        
        // Add to outreach queue
        const prospect = await addToOutreachQueue({
          ...lead,
          ...enriched
        });
        
        results.totalAdded++;
        console.log(`[LeadIntelligence] Added: ${lead.domain} → prospect ${prospect.id}`);
      } catch (e) {
        console.error(`[LeadIntelligence] Error adding ${lead.domain}:`, e.message);
        results.errors.push({ domain: lead.domain, error: e.message });
      }
    }

    results.completedAt = new Date().toISOString();
    results.duration = `${new Date(results.completedAt) - new Date(results.startedAt)}ms`;

    console.log(`[LeadIntelligence] Daily scan complete. Discovered: ${results.totalDiscovered}, Added: ${results.totalAdded}`);

    return results;
  } catch (err) {
    console.error('[LeadIntelligence] Daily scan failed:', err);
    results.errors.push({ source: 'orchestrator', error: err.message });
    results.completedAt = new Date().toISOString();
    return results;
  }
}

// ==================== Helper Functions ====================

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  if (!url) return null;
  
  try {
    // Handle full URLs
    if (url.startsWith('http')) {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    }
    
    // Handle bare domains
    if (url.includes('.')) {
      return url.replace(/^www\./, '').split('/')[0];
    }
  } catch (e) {
    // Invalid URL
  }
  
  return null;
}

/**
 * Detect if a URL is a DTC platform (Shopify/WooCommerce)
 */
async function detectDTCPlatform(url) {
  if (!url) return null;
  
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      },
      timeout: 10000
    });

    if (!response.ok) return null;

    const html = await response.text();
    
    // Check for Shopify indicators
    if (html.includes('myshopify.com') || 
        html.includes('cdn.shopify.com') ||
        html.includes('Shopify') ||
        response.headers.get('x-shopify-stage') ||
        response.headers.get('x-shopify-shop-id')) {
      return 'Shopify';
    }

    // Check for WooCommerce indicators
    if (html.includes('wp-content/plugins/woocommerce') ||
        html.includes('woocommerce') ||
        html.includes('wc-api')) {
      return 'WooCommerce';
    }

    // Check for BigCommerce
    if (html.includes('bigcommerce') || html.includes('bc-store')) {
      return 'BigCommerce';
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Guess brand name from domain
 */
function guessBrandNameFromDomain(domain) {
  if (!domain) return '';
  
  const name = domain
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|co|io|shop|store)$/i, '')
    .replace(/[-_]/g, ' ')
    .split('.')[0];
  
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Extract meta content from HTML
 */
function extractMetaContent(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i')
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return decodeHTMLEntities(match[1]);
    }
  }

  return null;
}

/**
 * Decode HTML entities
 */
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };

  return text.replace(/&[^;]+;/g, match => entities[match] || match);
}

/**
 * Extract contact email from HTML
 */
function extractContactEmail(html) {
  // Look for email addresses in mailto links
  const mailtoMatches = html.matchAll(/href=["']mailto:([^"']+)["']/gi);
  for (const match of mailtoMatches) {
    if (match[1]) return match[1].split('?')[0].split('#')[0];
  }

  // Look for email patterns in text
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = html.match(emailPattern);
  
  if (emails && emails.length > 0) {
    // Filter out noreply, privacy, etc.
    const validEmails = emails.filter(e => 
      !e.toLowerCase().includes('noreply') &&
      !e.toLowerCase().includes('privacy') &&
      !e.toLowerCase().includes('abuse')
    );
    return validEmails[0] || emails[0];
  }

  return null;
}

/**
 * Async version for extracting contact email from specific page
 */
async function extractContactEmailFromPage(url) {
  try {
    const contactUrl = url.replace(/\/$/, '') + '/contact';
    const response = await fetch(contactUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadIntelligence/1.0)'
      },
      timeout: 8000
    });

    if (response.ok) {
      const html = await response.text();
      return extractContactEmail(html);
    }
  } catch (e) {
    // Contact page not accessible
  }
  return null;
}

/**
 * Detect technologies from HTML
 */
function detectTechnologies(html) {
  const technologies = [];

  const techPatterns = {
    'Shopify': /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i,
    'WooCommerce': /wp-content\/plugins\/woocommerce|woocommerce/i,
    'BigCommerce': /bigcommerce\.com|bc-store/i,
    'WordPress': /wp-content\/|wp-includes\/|wordpress/i,
    'Stripe': /stripe\.com|js\.stripe\.com/i,
    'Mailchimp': /mailchimp\.com|list-manage\.com/i,
    'Google Analytics': /google-analytics\.com|gtag|ga\(/i,
    'Facebook Pixel': /connect\.facebook\.net.*fbevents|fbq/i,
    'Klaviyo': /klaviyo\.com/i,
    'Hotjar': /hotjar\.com/i
  };

  for (const [tech, pattern] of Object.entries(techPatterns)) {
    if (pattern.test(html)) {
      technologies.push(tech);
    }
  }

  return technologies;
}

/**
 * Extract social media links from HTML
 */
function extractSocialLinks(html, baseUrl) {
  const socials = {
    twitter: null,
    instagram: null,
    facebook: null,
    linkedin: null
  };

  const socialPatterns = {
    twitter: /twitter\.com\/([a-zA-Z0-9_]+)/i,
    instagram: /instagram\.com\/([a-zA-Z0-9_]+)/i,
    facebook: /facebook\.com\/([a-zA-Z0-9_.-]+)/i,
    linkedin: /linkedin\.com\/in\/([a-zA-Z0-9_.-]+)/i
  };

  for (const [platform, pattern] of Object.entries(socialPatterns)) {
    const match = html.match(pattern);
    if (match && match[1]) {
      socials[platform] = match[0];
    }
  }

  return socials;
}

/**
 * Extract estimated launch date from HTML
 */
function extractLaunchDate(html) {
  // Look for copyright years
  const copyrightMatch = html.match(/©\s*(\d{4})/i);
  if (copyrightMatch && copyrightMatch[1]) {
    return `${copyrightMatch[1]}-01-01`;
  }

  // Look for "Founded" or "Established" mentions
  const foundedMatch = html.match(/(?:founded|established|started|created)\s*(?:in\s+)?(\d{4})/i);
  if (foundedMatch && foundedMatch[1]) {
    return `${foundedMatch[1]}-01-01`;
  }

  return null;
}

export {
  scrapeProductHunt,
  scrapeKickstarter,
  scrapeShopifyNewStores,
  scrapeDomainRegs,
  enrichLead,
  addToOutreachQueue,
  runDailyIntelligence,
  // Export helpers for testing
  extractDomain,
  detectDTCPlatform,
  guessBrandNameFromDomain
};