/**
 * Cold Call Agent for ashbi-platform
 * For local Toronto leads (HVAC, electrician, locksmith, etc.)
 * - Lookup phone numbers via Google Places API
 * - Save leads with phone to ColdEmailProspect
 * - Generate AI call scripts
 * - Schedule call blocks in Google Calendar via Maton
 * - Run daily call block batching
 */

import prisma from '../config/db.js';
import aiClient from '../ai/client.js';

const MATON_API_KEY = process.env.MATON_API_KEY;
const MATON_CALENDAR_BASE = 'https://api.maton.ai/google-calendar/calendar/v1/users/me';

// Google Places API key (for phone lookup)
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

/**
 * Business type pain points for local service businesses
 */
const LOCAL_SERVICE_PAINS = {
  hvac: [
    'high utility bills due to outdated systems',
    'frequent breakdowns disrupting customer comfort',
    'no online booking — losing leads to competitors',
    'outdated website that doesn\'t convert mobile visitors',
    'no Google Business optimization — missing local search traffic'
  ],
  electrician: [
    'no online quote system — relying on phone tag',
    'outdated website with no trust signals',
    'missing from Google Maps for local searches',
    'no online booking for emergency calls',
    'poor mobile experience loses calls from job sites'
  ],
  locksmith: [
    'no instant online quote — losing emergency callers',
    'website doesn\'t load fast enough for urgent needs',
    'not appearing in Google Maps "locksmith near me" results',
    'no online booking for standard appointments',
    'outdated site erodes trust for emergency services'
  ],
  plumber: [
    'no online scheduling — losing leads after hours',
    'can\'t capture emergency callers via mobile',
    'missing local SEO for "plumber Toronto" searches',
    'no digital estimate system — quoting takes too long',
    'website not optimized for conversion'
  ],
  general: [
    'no mobile-friendly website — losing leads to competitors',
    'not showing up in local Google search results',
    'missing online booking capability',
    'outdated website hurts credibility',
    'no Google Business optimization'
  ]
};

/**
 * Detect business type from name or keywords
 * @param {string} businessName
 * @returns {string} business type key
 */
function detectBusinessType(businessName) {
  const name = businessName.toLowerCase();
  if (name.includes('hvac') || name.includes('heating') || name.includes('cooling') || name.includes('air condition')) return 'hvac';
  if (name.includes('electric') || name.includes('electrical')) return 'electrician';
  if (name.includes('plumb') || name.includes('plumbing')) return 'plumber';
  if (name.includes('locksmith') || name.includes('lock')) return 'locksmith';
  return 'general';
}

/**
 * Lookup phone number for a business using Google Places API
 * Falls back to web scraping if API unavailable
 *
 * @param {string} businessName - Name of the business
 * @param {string} city - City (default: Toronto)
 * @returns {Promise<object|null>} { phone, address, gmb_url, name }
 */
export async function lookupPhone(businessName, city = 'Toronto') {
  try {
    // Try Google Places API first
    if (GOOGLE_PLACES_API_KEY) {
      const result = await lookupPhoneGooglePlaces(businessName, city);
      if (result && result.phone) return result;
    }

    // Fallback: scrape Google Business listing
    const scraped = await scrapeGoogleBusiness(businessName, city);
    return scraped;
  } catch (err) {
    console.error('[ColdCall] lookupPhone error:', err.message);
    return null;
  }
}

/**
 * Google Places API lookup
 */
async function lookupPhoneGooglePlaces(businessName, city) {
  try {
    const query = encodeURIComponent(`${businessName} ${city}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_PLACES_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[ColdCall] Google Places API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      const placeId = place.place_id;

      // Get detailed info including phone
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,formatted_address,website,url&key=${GOOGLE_PLACES_API_KEY}`;

      const detailsResponse = await fetch(detailsUrl);
      if (!detailsResponse.ok) return null;

      const details = await detailsResponse.json();
      const result = details.result || {};

      return {
        name: result.name || businessName,
        phone: result.formatted_phone_number || null,
        address: result.formatted_address || place.formatted_address || null,
        gmb_url: result.url || `https://www.google.com/maps/place/?q=place_id:${placeId}`,
        website: result.website || null,
        placeId
      };
    }

    return null;
  } catch (err) {
    console.warn('[ColdCall] Google Places API lookup failed:', err.message);
    return null;
  }
}

/**
 * Fallback: scrape Google Business page for phone number
 */
async function scrapeGoogleBusiness(businessName, city) {
  try {
    const query = encodeURIComponent(`${businessName} ${city} site:google.com/maps`);
    const searchUrl = `https://www.google.com/search?q=${query}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ColdCallAgent/1.0)'
      }
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Try to extract place ID from search results
    const placeIdMatch = html.match(/data-place-id="([^"]+)"/) || html.match(/place\/([a-zA-Z0-9_-]+)/);
    const nameMatch = html.match(/class="label-Lw a[""][^>]*>([^<]+)<\/span>/);

    if (placeIdMatch) {
      // Try to find phone number patterns in the HTML
      const phonePatterns = [
        /\+1\s*\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4}/g,
        /\+1[0-9]{3}[0-9]{3}[0-9]{4}/g,
        /\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4}/g
      ];

      let phone = null;
      for (const pattern of phonePatterns) {
        const match = html.match(pattern);
        if (match) {
          phone = match[0];
          break;
        }
      }

      return {
        name: nameMatch ? nameMatch[1] : businessName,
        phone,
        address: null,
        gmb_url: placeIdMatch[1] ? `https://www.google.com/maps/place/${placeIdMatch[1]}` : null,
        scraped: true
      };
    }

    return null;
  } catch (err) {
    console.warn('[ColdCall] Google Business scrape failed:', err.message);
    return null;
  }
}

/**
 * Add a lead with phone number to ColdEmailProspect
 * Phone and address stored in painPoint as JSON
 *
 * @param {object} leadData - { name, email, company, phone, address, gmb_url, notes, businessType }
 * @returns {Promise<object>} Created prospect
 */
export async function addLeadWithPhone(leadData) {
  const { name, email, company, phone, address, gmb_url, notes, businessType } = leadData;

  // Store phone/address in painPoint as JSON
  const phoneData = {
    phone: phone || null,
    address: address || null,
    gmb_url: gmb_url || null,
    businessType: businessType || detectBusinessType(company || name),
    addedAt: new Date().toISOString(),
    source: 'cold_call_lookup'
  };

  const painPointJson = JSON.stringify(phoneData);

  const prospect = await prisma.coldEmailProspect.create({
    data: {
      name: name || company || 'Unknown',
      email: email || '',
      company: company || '',
      industry: businessType || detectBusinessType(company || name),
      painPoint: painPointJson,
      status: 'NEW'
    }
  });

  return prospect;
}

/**
 * Generate a cold call script using AI
 * Tailored to business type, website findings, and local service pain points
 *
 * @param {object} leadData - Lead data with name, company, phone, website, painPoints
 * @returns {Promise<string>} Generated call script
 */
export async function generateCallScript(leadData) {
  const { name, company, phone, website, painPoints, businessType } = leadData;

  const bizType = businessType || detectBusinessType(company || name);
  const pains = LOCAL_SERVICE_PAINS[bizType] || LOCAL_SERVICE_PAINS.general;

  const systemPrompt = `You are a cold call script generator for a web agency targeting local Toronto service businesses (HVAC, electricians, locksmiths, plumbers, etc.).

Write a natural, conversational cold call script that:
1. Opens with a brief, specific observation about their business (not generic)
2. Identifies a specific pain point relevant to their industry
3. Positions our agency as the solution with a soft ask
4. Ends with a clear next step (brief call or website review)

Keep the script under 200 words. Sound like a real person, not a salesperson. 
Include placeholder [NAME] for their contact name.
Do NOT use all caps or aggressive tones.`;

  const prompt = `Generate a cold call script for ${company || 'a local service business'}.

Business type: ${bizType}
Contact name: ${name || 'the owner'}
Phone: ${phone || 'unknown'}
Website found: ${website || 'not yet checked'}
Their specific pain points: ${(painPoints || pains).slice(0, 3).join(', ')}

Include:
- Opening line (specific, not generic)
- Pain point hook relevant to ${bizType}
- How we help (website/online presence for local service businesses)
- Soft close asking for a 10-minute call

Return ONLY the script text, no formatting or explanations.`;

  try {
    const result = await aiClient.chatJSON({
      system: systemPrompt,
      prompt,
      temperature: 0.7
    });

    // aiClient.chatJSON returns { content: string } or similar
    return typeof result === 'string' ? result : result.content || result.text || JSON.stringify(result);
  } catch (err) {
    console.error('[ColdCall] generateCallScript AI error:', err.message);
    // Return template-based script as fallback
    return generateTemplateScript(name, company, bizType, pains);
  }
}

/**
 * Fallback template-based call script generator
 */
function generateTemplateScript(name, company, businessType, pains) {
  const firstName = (name || '').split(' ')[0] || 'there';
  const companyName = company || 'your business';
  const topPain = pains[0] || LOCAL_SERVICE_PAINS.general[0];

  const scripts = {
    hvac: `Hi ${firstName}, I'm calling about ${companyName}.

I noticed your website and wanted to mention something I see frequently with HVAC companies — ${topPain}.

Most of our HVAC clients in Toronto tell us their biggest challenge is capturing emergency calls after hours when their phone goes to voicemail.

We help home service businesses get more phone calls through a better website and Google presence. Would you be open to a quick 10-minute call this week to see if this could work for ${companyName}?`,
    electrician: `Hi ${firstName}, I'm calling about ${companyName}.

I was looking at your site and noticed something that many electricians in Toronto struggle with — ${topPain}.

We work with electrical contractors to help them capture more calls from both emergency and scheduled work. The biggest win for most is showing up better in local Google searches when someone searches "electrician near me."

Would you have 10 minutes this week for a quick call to see if this could help grow ${companyName}'s business?`,
    locksmith: `Hi ${firstName}, calling about ${companyName}.

I saw your Google listing and wanted to mention — most locksmiths we talk to tell us ${topPain}.

For emergency services like yours, getting more phone calls is everything. We help locksmiths in Toronto show up better on Google Maps and get more calls from people who need you right now.

Got 10 minutes this week for a quick chat about how this could work for ${companyName}?`,
    general: `Hi ${firstName}, I'm calling about ${companyName}.

I wanted to reach out because we help local service businesses in Toronto get more customers through their website. Many businesses like ${companyName} struggle with ${topPain}.

Would you be open to a quick 10-minute call this week to explore if this could work for your business?`
  };

  return scripts[businessType] || scripts.general;
}

/**
 * Schedule a call block in Google Calendar via Maton
 * Creates a 15-minute event with 10-minute reminder
 *
 * @param {string} leadId - ColdEmailProspect ID
 * @param {string|Date} dateTime - ISO date string for when to schedule
 * @returns {Promise<object>} Calendar event result
 */
export async function scheduleCallBlock(leadId, dateTime) {
  const prospect = await prisma.coldEmailProspect.findUnique({
    where: { id: leadId }
  });

  if (!prospect) {
    throw new Error(`Lead not found: ${leadId}`);
  }

  // Parse phone data from painPoint
  let phoneData = {};
  try {
    if (prospect.painPoint) {
      phoneData = JSON.parse(prospect.painPoint);
    }
  } catch (e) {
    // painPoint might not be JSON
  }

  const businessName = prospect.company || prospect.name || 'Unknown Business';
  const phone = phoneData.phone || '';

  // Generate call script for the event description
  const callScript = await generateCallScript({
    name: prospect.name,
    company: businessName,
    phone,
    businessType: prospect.industry
  });

  // Format the datetime for Google Calendar
  const startTime = new Date(dateTime);
  const endTime = new Date(startTime.getTime() + 15 * 60 * 1000); // 15 minutes

  const startIso = startTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const endIso = endTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const eventPayload = {
    summary: `CALL: ${businessName}`,
    description: `Cold call script:\n\n${callScript}\n\n---\nPhone: ${phone}\nLead ID: ${prospect.id}\nCompany: ${businessName}`,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 10 }
      ]
    }
  };

  try {
    const response = await fetch(`${MATON_CALENDAR_BASE}/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MATON_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Maton Calendar API error: ${response.status} ${errorText}`);
    }

    const event = await response.json();

    // Update the prospect status to indicate scheduled
    await prisma.coldEmailProspect.update({
      where: { id: leadId },
      data: {
        painPoint: JSON.stringify({
          ...phoneData,
          callScheduledAt: dateTime,
          calendarEventId: event.id || event.eventId,
          callScript
        })
      }
    });

    return {
      success: true,
      eventId: event.id || event.eventId,
      scheduledAt: dateTime,
      leadId,
      businessName,
      script: callScript
    };
  } catch (err) {
    console.error('[ColdCall] scheduleCallBlock error:', err.message);
    throw err;
  }
}

/**
 * Run daily call blocks - find leads with phone numbers that haven't been called
 * Groups by area code / neighborhood for efficiency
 *
 * @returns {Promise<object>} Summary of scheduled calls
 */
export async function runDailyCallBlocks() {
  try {
    // Find all leads with phone numbers that haven't been scheduled
    const leads = await prisma.coldEmailProspect.findMany({
      where: {
        status: 'NEW',
        painPoint: {
          not: null
        }
      },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        industry: true,
        painPoint: true,
        createdAt: true
      }
    });

    // Filter leads that have phone data and haven't been called
    const callableLeads = [];

    for (const lead of leads) {
      if (!lead.painPoint) continue;

      let phoneData = {};
      try {
        phoneData = JSON.parse(lead.painPoint);
      } catch (e) {
        continue;
      }

      if (!phoneData.phone) continue;
      if (phoneData.callScheduledAt) continue; // Already scheduled

      callableLeads.push({
        id: lead.id,
        name: lead.name,
        company: lead.company,
        phone: phoneData.phone,
        address: phoneData.address,
        gmb_url: phoneData.gmb_url,
        businessType: lead.industry || detectBusinessType(lead.company || lead.name)
      });
    }

    // Group by area code for batching efficiency
    const areaCodeGroups = {};

    for (const lead of callableLeads) {
      const phone = lead.phone.replace(/\D/g, '');
      let areaCode = '416'; // Default Toronto

      if (phone.length === 11 && phone.startsWith('1')) {
        areaCode = phone.substring(1, 4);
      } else if (phone.length === 10) {
        areaCode = phone.substring(0, 3);
      }

      if (!areaCodeGroups[areaCode]) {
        areaCodeGroups[areaCode] = [];
      }
      areaCodeGroups[areaCode].push(lead);
    }

    // For now, just return the grouped leads without auto-scheduling
    // Scheduling is done via the scheduleCallBlock function
    return {
      totalLeadsWithPhone: callableLeads.length,
      groupedByAreaCode: Object.keys(areaCodeGroups).length,
      areaCodes: Object.keys(areaCodeGroups),
      leadsByAreaCode: areaCodeGroups,
      generatedAt: new Date().toISOString(),
      message: 'Found callable leads grouped by area code. Use scheduleCallBlock to schedule individual calls.'
    };
  } catch (err) {
    console.error('[ColdCall] runDailyCallBlocks error:', err.message);
    throw err;
  }
}

/**
 * Get upcoming scheduled calls
 * @returns {Promise<Array>} List of scheduled calls
 */
export async function getScheduledCalls() {
  try {
    // Query leads that have callScheduledAt in painPoint
    const leads = await prisma.coldEmailProspect.findMany({
      where: {
        painPoint: {
          contains: 'callScheduledAt'
        }
      },
      select: {
        id: true,
        name: true,
        company: true,
        industry: true,
        painPoint: true
      }
    });

    const scheduled = [];

    for (const lead of leads) {
      try {
        const phoneData = JSON.parse(lead.painPoint);
        if (phoneData.callScheduledAt) {
          scheduled.push({
            leadId: lead.id,
            name: lead.name,
            company: lead.company,
            businessType: lead.industry,
            phone: phoneData.phone,
            scheduledAt: phoneData.callScheduledAt,
            calendarEventId: phoneData.calendarEventId,
            callScript: phoneData.callScript
          });
        }
      } catch (e) {
        // Skip leads with invalid painPoint JSON
      }
    }

    // Sort by scheduled time
    scheduled.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

    return scheduled;
  } catch (err) {
    console.error('[ColdCall] getScheduledCalls error:', err.message);
    return [];
  }
}

export default {
  lookupPhone,
  addLeadWithPhone,
  generateCallScript,
  scheduleCallBlock,
  runDailyCallBlocks,
  getScheduledCalls
};