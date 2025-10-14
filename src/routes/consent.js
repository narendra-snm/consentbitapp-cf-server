import { getCorsHeaders } from "../utils/cors.js";
import jsPDF from 'jspdf';
import { validateJSONBody } from "../utils/security-validation.js";

export async function handleConsent(url, request, env, origin) {
  try {
    // --- POST /consent → store visitor consent ---
 const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Handle OPTIONS preflight
if (request.method === "OPTIONS" && url.pathname === "/consent") {
  return new Response(null, { status: 204, headers: corsHeaders });
}

if (url.pathname === "/consent" && request.method === "POST") {
  if (!env.CONSENT_STORE_FRAMER) {
    return new Response(JSON.stringify({ error: "CONSENT_STORE missing" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  let body;
  try {
   body = await validateJSONBody(request);

  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const {
    clientId,
    siteId,
    visitorId,
    preferences,
    policyVersion,
    timestamp,
    country = "IN",
    bannerType = preferences?.bannerType || "GDPR",
    expiresAtTimestamp,
    expirationDurationDays,
    metadata = {},
  } = body;

  if (!siteId || !visitorId || !preferences) {
    return new Response(
      JSON.stringify({ error: "siteId, visitorId, and preferences are required" }),
      { status: 400, headers: corsHeaders }
    );
  }

  // ✅ Extract IP address
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown";

  const key = `consent:${siteId}`;

  // Fetch existing consent array from KV
  let existingDataStr = await env.CONSENT_STORE_FRAMER.get(key);
   let existingScriptDataStr = await env.SCRIPTS_KV_FRAMER.get(siteId);
  let existingData = existingDataStr ? JSON.parse(existingDataStr) : [];
let existingScriptData = existingScriptDataStr ? JSON.parse(existingScriptDataStr) : existingScriptData
  // Check if visitorId already exists and update
  const visitorIndex = existingData.findIndex((v) => v.visitorId === visitorId);
const expectedCookie=await generateExpectedCookies(existingScriptData, preferences);
  const visitorData = {
    clientId,
    visitorId,
    preferences,
    policyVersion,
    timestamp,
    country,
    bannerType,
    expiresAtTimestamp,
    expirationDurationDays,
    expectedCookies: expectedCookie,
    // ✅ Merge IP into metadata
    metadata: {
      ...metadata,
      ip,
      userAgent: request.headers.get("user-agent") || "unknown",
    },
  };

  if (visitorIndex >= 0) {
    // Update existing visitor consent data
    existingData[visitorIndex] = { ...existingData[visitorIndex], ...visitorData };
  } else {
    // Add new visitor consent data
    existingData.push(visitorData);
  }

  // Save back updated array to KV
  await env.CONSENT_STORE_FRAMER.put(key, JSON.stringify(existingData));

  return new Response(
    JSON.stringify({ success: true, key, visitorId }),
    { status: 200, headers: corsHeaders }
  );
}




    // --- GET /consent/:visitorId → retrieve visitor consent ---
if (url.pathname.startsWith("/consent/")) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  if (request.method === "GET") {
    if (!env.CONSENT_STORE_FRAMER) {
      return new Response(JSON.stringify({ error: "CONSENT_STORE missing" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const visitorId = url.pathname.split("/").pop();
    const data = await env.CONSENT_STORE_FRAMER.get(`consent:${visitorId}`, { type: "json" });

    if (!data) {
      return new Response(JSON.stringify({ error: "No consent found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }
}


if (url.pathname === "/consent-report" && request.method === "GET") {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const siteId = url.searchParams.get("siteId");
  const monthParam = url.searchParams.get("month"); // 1-12 or month name
  const yearParam = url.searchParams.get("year"); // e.g., 2025

  if (!siteId || !monthParam || !yearParam) {
    return new Response(
      JSON.stringify({ error: "Missing siteId, month, or year query parameters" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Convert monthParam to number 1-12
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  let month;
  if (isNaN(monthParam)) {
    month = monthNames.indexOf(monthParam.toLowerCase()) + 1;
  } else {
    month = parseInt(monthParam, 10);
  }
  const year = parseInt(yearParam, 10);

  if (!month || month < 1 || month > 12 || isNaN(year)) {
    return new Response(
      JSON.stringify({ error: "Invalid month or year" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch consent data array from KV
  const key = `consent:${siteId}`;
  const dataStr = await env.CONSENT_STORE_FRAMER.get(key);
  const data = dataStr ? JSON.parse(dataStr) : [];

  // Filter by month, year in the visitor's timestamp field
  const filtered = data.filter((visitor) => {
    if (!visitor.timestamp) return false;
    const ts = new Date(visitor.timestamp);
    return ts.getMonth() + 1 === month && ts.getFullYear() === year;
  });

  // Convert to CSV string
  // Columns: Visitor ID,Status,Country,Consent Preferences,Metadata,Last Updated
  const headers = [
    "Visitor ID",
    "Status",
    "Country",
    "Consent Preferences",
    "Metadata",
    "Last Updated",
    "PDF Link"
  ];

  // Simple helper to convert preferences object to string summary (customize as needed)
  function preferencesToString(prefs) {
    if (!prefs) return "";
    return Object.entries(prefs)
      .map(([key, val]) => {
        if (typeof val === "boolean") {
          return `${key} ${val ? "Yes" : "No"}`;
        }
        return `${key}: ${val}`;
      })
      .join("; ");
  }

  // Convert each visitor to CSV row string
  const rows = filtered.map((visitor) => {
    const visitorId = visitor.visitorId || "";
    const status = visitor.preferences?.action || "Unknown"; // or customize based on your schema
    const country = visitor.country || "";
    const consentPrefs = preferencesToString(visitor.preferences);
    const metadata = visitor.metadata
      ? JSON.stringify(visitor.metadata).replace(/"/g, '""') // escape quotes
      : "";
    const lastUpdated = visitor.timestamp || "";
const pdfUrl = `https://framer-consentbit.web-8fb.workers.dev/visitor-report/${siteId}/${visitorId}?format=pdf`; // replace 'report-id' if dynamic
const downloadLine =`=HYPERLINK("${pdfUrl}", "Download PDF")`;
// CSV escape function for values containing comma or quotes or newlines
    const csvEscape = (val) => {
      if (val == null) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [
      visitorId,
      status,
      country,
      consentPrefs,
      metadata,
      lastUpdated,
downloadLine
    ].map(csvEscape).join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${siteId}_${month}_${year}_consent_report.csv"`,
    },
  });
}



if (url.pathname.startsWith("/visitor-report/") && request.method === "GET") {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const [, , siteName, visitorId] = url.pathname.split("/");
  const format = url.searchParams.get("format") || "json";

  if (!siteName || !visitorId) {
    return new Response(
      JSON.stringify({ error: "Missing siteName or visitorId in path" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 1. Fetch entire consent array for the site from KV
  const consentDataStr = await env.CONSENT_STORE_FRAMER.get(`consent:${siteName}`);
  const consentArray = consentDataStr ? JSON.parse(consentDataStr) : [];

  // 2. Filter all entries for this visitor
  const visitorEntries = consentArray.filter(e => e.visitorId === visitorId);

  if (visitorEntries.length === 0) {
    return new Response(
      JSON.stringify({ error: "Consent data for visitorId not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 3. Build VisitorReport object
  const visitorReport = buildVisitorReportFromEntries(visitorEntries, visitorId, visitorEntries[0].clientId);

  // 4. Use expectedCookies from last consent entry
  let expectedCookie = [];
  if (visitorEntries.length > 0) {
    expectedCookie = visitorEntries[visitorEntries.length - 1].expectedCookies || [];
  }

  // 5. Fetch ScriptKV and other cookie categories safely from KV
  let scriptsKV = [];
  if (env.SCRIPTS_KV_FRAMER) {
    const scriptsKVStr = await env.SCRIPTS_KV_FRAMER.get(siteName);
    if (scriptsKVStr) {
      try {
        scriptsKV = JSON.parse(scriptsKVStr);
      } catch {
        scriptsKV = [];
      }
    }
  }

  // 6. Return PDF or JSON
  if (format === "pdf") {
    const pdfBuffer = await generateVisitorPDFReport(visitorReport, expectedCookie, scriptsKV);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="visitor-report-${visitorId}-${siteName}.pdf"`,
      },
    });
  } else {
    // Return JSON data of latest visitor consent entry as fallback
    const latestEntry = visitorEntries[visitorEntries.length - 1];
    return new Response(
      JSON.stringify(latestEntry),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}



    return null; // Not handled
  } catch (err) {
    console.error("❌ handleConsent error:", err);
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500 });
  }
}
async function generateExpectedCookies(scripts, preferences) {
  const expectedCookies = [];

  // Load cookie dataset
  const cookieDataset = await import('../utils/cookies_dataset.json');

  scripts.forEach(script => {
    const scriptText = (script.src || script.content || '').toLowerCase();
    let cookieNames = [];

    // Determine cookies based on script content and data category
    const category = script.dataCategory
      ? script.dataCategory.split(',')[0].trim().toLowerCase()
      : 'essential';

    if (
      scriptText.includes('google-analytics') ||
      scriptText.includes('gtag') ||
      scriptText.includes('ga(')
    ) {
      cookieNames = ['_ga', '_gid', '_gat', '_ga_*', '_gac_*'];
    } else if (
      scriptText.includes('facebook') ||
      scriptText.includes('fbq') ||
      scriptText.includes('pixel')
    ) {
      cookieNames = ['_fbp', 'fr', 'datr', 'sb'];
    } else if (
      scriptText.includes('hotjar') ||
      scriptText.includes('hj')
    ) {
      cookieNames = ['_hjSessionUser_*', '_hjIncludedInSessionSample', '_hjAbsoluteSessionInProgress'];
    } else if (
      scriptText.includes('hubspot') ||
      scriptText.includes('hs')
    ) {
      cookieNames = ['__hssrc', '__hssc', '__hstc'];
    } else if (
      scriptText.includes('wordpress') ||
      scriptText.includes('wp-')
    ) {
      cookieNames = ['wordpress_logged_in_*', 'wp-settings-*'];
    } else if (
      scriptText.includes('php') ||
      scriptText.includes('session')
    ) {
      cookieNames = ['PHPSESSID'];
    } else if (category === 'analytics') {
      cookieNames = ['analytics_id', 'tracking_id', 'visitor_id'];
    } else if (category === 'marketing') {
      cookieNames = ['ad_id', 'campaign_id', 'marketing_id'];
    } else if (category === 'personalization') {
      cookieNames = ['preferences', 'user_prefs', 'customization'];
    } else if (category === 'functional') {
      cookieNames = ['functionality', 'features', 'settings'];
    } else {
      // Default cookie based on data category
      cookieNames = [`${category}_cookie`];
    }

    // Check if this script category is allowed based on preferences
    let shouldSet = true;
    if (script.dataCategory) {
      const categories = script.dataCategory.split(',').map(cat => cat.trim().toLowerCase());
      const hasEssential = categories.some(cat => ['essential', 'necessary'].includes(cat));

      if (!hasEssential) {
        shouldSet = categories.some(cat => {
          if (cat === 'analytics') return preferences.Analytics;
          if (cat === 'marketing') return preferences.Marketing;
          if (cat === 'personalization') return preferences.Personalization;
          if (cat === 'functional') return preferences.Personalization; // Functional uses personalization preference
          return false;
        });
      }
    }

    if (shouldSet) {
      cookieNames.forEach(cookieName => {
        const cookieInfo = cookieDataset.default.find(cookie =>
          cookie.name === cookieName ||
          cookie.cookie_name === cookieName ||
          (cookieName.includes('*') && cookie.name?.startsWith(cookieName.replace('*', '')))
        );

        if (cookieInfo) {
          expectedCookies.push({
            name: cookieInfo.name || cookieInfo.cookie_name || cookieName,
            duration: cookieInfo.duration,
            description: cookieInfo.description,
            toolname: cookieInfo.toolname,
            dataCategory: script.dataCategory
          });
        } else {
          // Fallback for unknown cookies
          expectedCookies.push({
            name: cookieName,
            duration: 'session',
            description: `Cookie from ${script.dataCategory || 'unknown'} script`,
            toolname: script.dataCategory || 'Unknown',
            dataCategory: script.dataCategory
          });
        }
      });
    }
  });

  // Always add essential cookies
  expectedCookies.push({
    name: 'session_id',
    duration: 'session',
    description: 'Essential session cookie for website functionality',
    toolname: 'Essential',
    dataCategory: 'essential'
  });

  return expectedCookies;
}
async function generateVisitorPDFReport(report, expectedCookies, scriptsKV) {
  const doc = new jsPDF();
  doc.setFont('helvetica');

  // First page - Proof of consent (unchanged)
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');

  // Center the title
  const title = 'Proof of consent';
  const titleWidth = doc.getTextWidth(title);
  const pageWidth = doc.internal.pageSize.width;
  const titleX = (pageWidth - titleWidth) / 2;
  doc.text(title, titleX, 30);

  // Get the latest consent entry for the proof page
  const latestEntry = report.entries[report.entries.length - 1];

  // Format consent date
  const consentDate = new Date(latestEntry.timestamp);
  const formattedDate = consentDate.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  });

  // Determine consent status - prioritize action field over preferences
  let consentStatus = 'Rejected'; // Default to rejected

  if (latestEntry.action) {
    // Use action field if available
    consentStatus = latestEntry.action === 'acceptance' ? 'Accepted' : 'Rejected';
  } else {
    // Fallback to preferences-based logic
    const nonNecessaryPreferences = Object.assign({}, latestEntry.preferences);
    delete nonNecessaryPreferences.necessary; // Remove necessary from consideration

    const hasAcceptedNonNecessary = Object.values(nonNecessaryPreferences).some(function(value) {
      return value === true;
    });
    consentStatus = hasAcceptedNonNecessary ? 'Accepted' : 'Rejected';
  }

  // Use visitor ID as consent ID
  const consentId = report.visitorId;

  // Anonymize IP address (show only first 3 octets)
  const ipParts = latestEntry.metadata.ip.split('.');
  const anonymizedIP = ipParts.length === 4 ? ipParts[0] + '.' + ipParts[1] + '.' + ipParts[2] + '.0' : latestEntry.metadata.ip;

  // Proof of consent details
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');

  let yPosition = 50;
  const lineHeight = 12;

  doc.text('Consented domain', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(report.siteName, 20, yPosition + 8);
  yPosition += lineHeight + 8;

  doc.setFont('helvetica', 'normal');
  doc.text('Consent date', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(formattedDate, 20, yPosition + 8);
  yPosition += lineHeight + 8;

  doc.setFont('helvetica', 'normal');
  doc.text('Consent ID', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(consentId, 20, yPosition + 8);
  yPosition += lineHeight + 8;

  doc.setFont('helvetica', 'normal');
  doc.text('Country', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(latestEntry.country, 20, yPosition + 8);
  yPosition += lineHeight + 8;

  doc.setFont('helvetica', 'normal');
  doc.text('Anonymized IP address', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(anonymizedIP, 20, yPosition + 8);
  yPosition += lineHeight + 8;

  doc.setFont('helvetica', 'normal');
  doc.text('Consent status', 20, yPosition);
  doc.setFont('helvetica', 'bold');
  doc.text(consentStatus, 20, yPosition + 8);

  // Add page number
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Page 1', 180, 280);

  // --- NEW LOGIC STARTS HERE ---
  // 1. Build set of all categories from SCRIPTS_KV and normalize them
  const allCategoriesSet = new Set();

  function normalizeCategory(cat) {
    const normalized = cat.trim().toLowerCase();
    if (normalized === 'essential' || normalized === 'necessary') {
      return 'Essential';
    } else if (normalized === 'analytics') {
      return 'Analytics';
    } else if (normalized === 'marketing') {
      return 'Marketing';
    } else if (normalized === 'personalization') {
      return 'Personalization';
    } else if (normalized === 'functional') {
      return 'Functional';
    } else if (normalized === 'uncategorized') {
      return 'Uncategorized';
    } else {
      // For custom categories, capitalize first letter
      return cat.trim().charAt(0).toUpperCase() + cat.trim().slice(1).toLowerCase();
    }
  }

  scriptsKV.forEach(function(script) {
    if (script.dataCategory) {
      script.dataCategory.split(',').forEach(function(cat) {
        allCategoriesSet.add(normalizeCategory(cat));
      });
    } else {
      allCategoriesSet.add('Uncategorized');
    }
  });

  (expectedCookies || []).forEach(function(cookie) {
    if (cookie.dataCategory) {
      cookie.dataCategory.split(',').forEach(function(cat) {
        allCategoriesSet.add(normalizeCategory(cat));
      });
    } else {
      allCategoriesSet.add('Uncategorized');
    }
  });

  const allCategories = Array.from(allCategoriesSet);

  // 2. Group cookies by category from expectedCookies with normalized category names
  const cookiesByCategory = {};
  (expectedCookies || []).forEach(function(cookie) {
    if (cookie.dataCategory) {
      cookie.dataCategory.split(',').forEach(function(cat) {
        const normalizedCat = normalizeCategory(cat);
        if (!cookiesByCategory[normalizedCat]) cookiesByCategory[normalizedCat] = [];
        cookiesByCategory[normalizedCat].push(cookie);
      });
    } else {
      if (!cookiesByCategory['Uncategorized']) cookiesByCategory['Uncategorized'] = [];
      cookiesByCategory['Uncategorized'].push(cookie);
    }
  });

  // 3. Check if consent was rejected - if so, don't show any cookie details
  if (consentStatus === 'Rejected') {
    // No additional details are displayed for rejected consent.
  } else {
    // 4. For accepted consent, show category details
    const acceptedCategories = [];
    const rejectedCategories = [];

    allCategories.forEach(function(category) {
      if (category === 'Essential') {
        acceptedCategories.push(category);
      } else {
        let isAccepted = false;

        function checkPreference(prefKey) {
          const preferences = latestEntry.preferences || {};
          return preferences[prefKey.toLowerCase()] === true ||
                 preferences[prefKey] === true ||
                 preferences[prefKey.charAt(0).toUpperCase() + prefKey.slice(1).toLowerCase()] === true;
        }

        if (category === 'Analytics' && checkPreference('analytics')) {
          isAccepted = true;
        } else if (category === 'Marketing' && checkPreference('marketing')) {
          isAccepted = true;
        } else if (category === 'Personalization' && checkPreference('personalization')) {
          isAccepted = true;
        } else if (category === 'Functional' && checkPreference('personalization')) {
          isAccepted = true; // Functional uses personalization preference
        } else if (category === 'Uncategorized') {
          isAccepted = true; // Uncategorized defaults to accepted
        }

        if (isAccepted) {
          acceptedCategories.push(category);
        } else {
          rejectedCategories.push(category);
        }
      }
    });

    let yPos = 20;

    // 5. Render Rejected Categories (category names only, no cookie details)
    if (rejectedCategories.length > 0) {
      doc.addPage();
      yPos = 20;
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Rejected Categories', 20, yPos);
      yPos += 12;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');

      const marginLeft = 32; // Indent the category names

      rejectedCategories.forEach(function(category) {
        if (yPos + 20 > 280) {
          doc.addPage();
          yPos = 20;
        }
        doc.text('• ' + category, marginLeft, yPos);
        yPos += 8;
      });
      yPos += 8;
    }

    // 6. Render Accepted Categories with cookie details
    if (acceptedCategories.length > 0) {
      if (yPos === 20) {
        doc.addPage();
      }
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Accepted Categories', 20, yPos);
      yPos += 12;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');

      const marginLeft = 20;
      const colCookie = marginLeft;
      const colDuration = 80;
      const colDescription = 130;
      const colEnd = 190;
      const headerRowHeight = 12;
      const pageHeight = 280;
      const bottomMargin = 20;

      acceptedCategories.forEach(function(category) {
        if (yPos + 50 > pageHeight) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFont('helvetica', 'bold');
        doc.text(category, marginLeft, yPos);
        yPos += 8;

        const cookies = cookiesByCategory[category] || [];
        if (cookies.length > 0) {
          // Table header
          doc.setLineWidth(0.2);
          doc.line(colCookie, yPos, colEnd, yPos);
          doc.line(colCookie, yPos, colCookie, yPos + headerRowHeight);
          doc.line(colDuration, yPos, colDuration, yPos + headerRowHeight);
          doc.line(colDescription, yPos, colDescription, yPos + headerRowHeight);
          doc.line(colEnd, yPos, colEnd, yPos + headerRowHeight);
          doc.line(colCookie, yPos + headerRowHeight, colEnd, yPos + headerRowHeight);

          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text('Cookie Name', colCookie + 2, yPos + 7);
          doc.text('Duration', colDuration + 2, yPos + 7);
          doc.text('Description', colDescription + 2, yPos + 7);
          yPos += headerRowHeight;
          doc.setFont('helvetica', 'normal');

          cookies.forEach(function(cookie) {
            const descLines = doc.splitTextToSize(cookie.description, colEnd - colDescription - 4);
            const rowHeight = Math.max(15, descLines.length * 5);

            if (yPos + rowHeight + bottomMargin > pageHeight) {
              doc.addPage();
              yPos = 20;

              // Redraw table header
              doc.setLineWidth(0.2);
              doc.line(colCookie, yPos, colEnd, yPos);
              doc.line(colCookie, yPos, colCookie, yPos + headerRowHeight);
              doc.line(colDuration, yPos, colDuration, yPos + headerRowHeight);
              doc.line(colDescription, yPos, colDescription, yPos + headerRowHeight);
              doc.line(colEnd, yPos, colEnd, yPos + headerRowHeight);
              doc.line(colCookie, yPos + headerRowHeight, colEnd, yPos + headerRowHeight);

              doc.setFontSize(10);
              doc.setFont('helvetica', 'bold');
              doc.text('Cookie Name', colCookie + 2, yPos + 7);
              doc.text('Duration', colDuration + 2, yPos + 7);
              doc.text('Description', colDescription + 2, yPos + 7);
              yPos += headerRowHeight;
              doc.setFont('helvetica', 'normal');
            }

            doc.line(colCookie, yPos, colEnd, yPos);
            doc.line(colCookie, yPos, colCookie, yPos + rowHeight);
            doc.line(colDuration, yPos, colDuration, yPos + rowHeight);
            doc.line(colDescription, yPos, colDescription, yPos + rowHeight);
            doc.line(colEnd, yPos, colEnd, yPos + rowHeight);
            doc.line(colCookie, yPos + rowHeight, colEnd, yPos + rowHeight);

            doc.text(cookie.name, colCookie + 2, yPos + 5);
            doc.text(cookie.duration, colDuration + 2, yPos + 5);
            doc.text(descLines, colDescription + 2, yPos + 5);
            yPos += rowHeight;
          });
          yPos += 5;
        }
      });
      yPos += 8;
    }
  }

  // Add page numbers to all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(10);
    doc.text('Page ' + i + ' of ' + totalPages, 180, 280);
  }

  // Convert to Buffer
const pdfBytes = doc.output('arraybuffer');
return new Uint8Array(pdfBytes);
}

function buildVisitorReportFromEntries(entries, visitorId, siteName) {
  // Sort entries by timestamp ascending or descending as you prefer:
  const sortedEntries = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Map each consent entry into VisitorReportEntry expected by your PDF function:
  const reportEntries = sortedEntries.map((consent, index) => ({
    entryNumber: index + 1,
    timestamp: consent.timestamp,
    metadata: {
      userAgent: consent.metadata?.userAgent || 'Unknown',
      language: consent.metadata?.language || 'Unknown',
      platform: consent.metadata?.platform || 'Unknown',
      timezone: consent.metadata?.timezone || 'Unknown',
      ip: consent.metadata?.ip || 'Unknown',
    },
    preferences: consent.preferences || {},
    cookies: (consent.expectedCookies || []).map(cookie => ({
      category: cookie.dataCategory || 'Uncategorized',
      name: cookie.name,
      duration: cookie.duration,
      description: cookie.description,
    })),
    bannerType: consent.bannerType || 'Unknown',
    country: consent.country || consent.metadata?.country || 'Unknown',
    action: consent.preferences?.action || consent.action || undefined,
  }));

  // Prepare the consent summary (optional: customize as needed)
  const summary = {
    totalEntries: reportEntries.length,
    dateRange: reportEntries.length > 0
      ? `${new Date(reportEntries[0].timestamp).toISOString().slice(0,10)} to ${new Date(reportEntries[reportEntries.length-1].timestamp).toISOString().slice(0,10)}`
      : '',
    consentStats: {
      totalAccepted: reportEntries.filter(e => e.action === 'acceptance').length,
      totalRejected: reportEntries.filter(e => e.action === 'rejection').length,
      marketingAccepted: reportEntries.filter(e => e.preferences.marketing).length,
      analyticsAccepted: reportEntries.filter(e => e.preferences.analytics).length,
      personalizationAccepted: reportEntries.filter(e => e.preferences.personalization).length,
    }
  };

  // Return VisitorReport structure as expected
  return {
    reportTitle: `Consent Report for Visitor ${visitorId}`,
    generatedOn: new Date().toISOString(),
    siteName: siteName,
    visitorId: visitorId,
    entries: reportEntries,
    summary,
  };
}
