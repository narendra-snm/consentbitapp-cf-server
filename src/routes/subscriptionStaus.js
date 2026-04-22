// export async function onRequestGet( request, env ) {
//   const corsHeaders = {
//     'Access-Control-Allow-Origin': '*',
//     'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
//     'Access-Control-Allow-Headers': 'Content-Type, Authorization',
//   };

//   // Handle CORS preflight request
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   // Parse URL from request
//   const url = new URL(request.url);
//   console.log("Received request for subscription status:", url.toString());

//   // Get siteDomain query parameter
//   const siteDomainRaw = url.searchParams.get('siteDomain');
//   if (!siteDomainRaw) {
//     return new Response(
//       JSON.stringify({ error: 'Missing siteDomain query parameter' }),
//       { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
//     );
//   }

//   // Normalize domain by removing any leading www.
//   const normalizedDomain = siteDomainRaw.replace(/^www\./, '');
//   const possibleKeys = [
//     `https://${normalizedDomain}`,
//     `https://www.${normalizedDomain}`,
//     `http://${normalizedDomain}`,
//     `http://www.${normalizedDomain}`,
//     `www.${normalizedDomain}`,
//     normalizedDomain,
//   ];

//   // Attempt to fetch site status from KV with various key options
//   let siteStatusJson = null;
//   for (const key of possibleKeys) {
//     try {
//       const data = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(key);
//       if (data) {
//         siteStatusJson = data;
//         break;
//       }
//     } catch (err) {
//       console.error(`Error accessing KV for key=${key}:`, err);
//       return new Response(
//         JSON.stringify({ error: 'KV access error' }),
//         { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
//       );
//     }
//   }

//   // Prepare response based on KV lookup result
//   let result;
//   if (siteStatusJson) {
//     const siteStatus = JSON.parse(siteStatusJson);
//     if (siteStatus.active === true) {
//       result = {
//         siteDomain: siteDomainRaw,
//         canPublishToCustomDomain: true,
//         status: siteStatus.status || 'complete',
//       };
//     }else if (siteStatus.active === false && siteStatus.cancelAtPeriodEnd === false) {
      
//  result = {
//         siteDomain: siteDomainRaw,
//         canPublishToCustomDomain: true,
//         status: siteStatus.status || 'complete',
//       };


//       }
//     else {
//       result = {
//         siteDomain: siteDomainRaw,
//         canPublishToCustomDomain: false,
//         status: siteStatus.status || 'subscription_inactive',
//       };
//     }
//   } else {
//     result = {
//       siteDomain: siteDomainRaw,
//       canPublishToCustomDomain: false,
//     };
//   }

//   return new Response(JSON.stringify(result), {
//     status: 200,
//     headers: { 'Content-Type': 'application/json', ...corsHeaders },
//   });
// }
export async function onRequestGet(request, env) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle CORS preflight request
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Parse URL from request
  const url = new URL(request.url);
  console.log("Received request for subscription status:", url.toString());

  // Get siteId query parameter
  const siteId = url.searchParams.get('siteId');
  console.log("siteId parameter:", siteId);
  if (!siteId) {
    return new Response(
      JSON.stringify({ error: 'Missing siteId query parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // Fetch site data from AUTH_STORE_FRAMER KV
  let siteDataJson = null;
  try {
    siteDataJson = await env.AUTH_STORE_FRAMER.get(siteId, { type: 'json' });
  } catch (err) {
    console.error(`Error accessing AUTH_STORE_FRAMER for siteId=${siteId}:`, err);
    return new Response(
      JSON.stringify({ error: 'KV access error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
console.log("Fetched site data for siteId:", siteDataJson);
  // Check if site data exists and has productionUrl
  if (!siteDataJson || !siteDataJson.userData.productionUrl) {
    return new Response(
      JSON.stringify({ error: 'Site not found or no production URL' }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const productionUrl = siteDataJson.userData.productionUrl;
  console.log("Found production URL for siteId:", productionUrl);

  // Normalize domain from productionUrl
  const siteUrl = new URL(productionUrl);
  const normalizedDomain = siteUrl.hostname.replace(/^www\./, '');
  const siteDomainRaw = siteUrl.hostname; // Keep original hostname for response
  
  const possibleKeys = [
    productionUrl,
    `https://${normalizedDomain}`,
    `https://www.${normalizedDomain}`,
    `http://${normalizedDomain}`,
    `http://www.${normalizedDomain}`,
    `www.${normalizedDomain}`,
    normalizedDomain,
  ];

  // Attempt to fetch site status from ACTIVE_SITES_CONSENTBIT_FRAMER with various key options
  let siteStatusJson = null;
  for (const key of possibleKeys) {
    try {
      const data = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(key);
      if (data) {
        siteStatusJson = data;
        console.log(`Found site status for key: ${key}`);
        break;
      }
    } catch (err) {
      console.error(`Error accessing ACTIVE_SITES_CONSENTBIT_FRAMER for key=${key}:`, err);
      // Continue trying other keys instead of failing immediately
    }
  }

  // Prepare response based on KV lookup result
  let result;
  if (siteStatusJson) {
    const siteStatus = JSON.parse(siteStatusJson);
    if (siteStatus.active === true) {
      result = {
        siteId,
        siteDomain: siteDomainRaw,
        productionUrl,
        canPublishToCustomDomain: true,
        status: siteStatus.status || 'complete',
      };
    } else if (siteStatus.active === false && siteStatus.cancelAtPeriodEnd === false) {
      result = {
        siteId,
        siteDomain: siteDomainRaw,
        productionUrl,
        canPublishToCustomDomain: true,
        status: siteStatus.status || 'complete',
      };
    } else {
      result = {
        siteId,
        siteDomain: siteDomainRaw,
        productionUrl,
        canPublishToCustomDomain: false,
        status: siteStatus.status || 'subscription_inactive',
      };
    }
  } else {
    result = {
      siteId,
      siteDomain: siteDomainRaw,
      productionUrl,
      canPublishToCustomDomain: false,
    };
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// export async function onRequestGet(request, env) {
//   const corsHeaders = {
//     'Access-Control-Allow-Origin': '*',
//     'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
//     'Access-Control-Allow-Headers': 'Content-Type, Authorization',
//   };

//   // Handle CORS preflight request
//   if (request.method === 'OPTIONS') {
//     return new Response(null, { status: 204, headers: corsHeaders });
//   }

//   // Parse URL from request
//   const url = new URL(request.url);
//   console.log("Received request for subscription status:", url.toString());

//   // Get siteId and customDomain query parameters
//   const siteId = url.searchParams.get('siteId');
//   const customDomain = url.searchParams.get('customDomain');
  
//   console.log("siteId parameter:", siteId, "customDomain:", customDomain);
  
//   if (!siteId) {
//     return new Response(
//       JSON.stringify({ error: 'Missing siteId query parameter' }),
//       { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
//     );
//   }

//   // Fetch site data from AUTH_STORE_FRAMER KV
//   let siteDataJson = null;
//   try {
//     siteDataJson = await env.AUTH_STORE_FRAMER.get(siteId, { type: 'json' });
//   } catch (err) {
//     console.error(`Error accessing AUTH_STORE_FRAMER for siteId=${siteId}:`, err);
//     return new Response(
//       JSON.stringify({ error: 'KV access error' }),
//       { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
//     );
//   }
  
//   console.log("Fetched site data for siteId:", siteDataJson);
  
//   // Check if site data exists and has userData
//   if (!siteDataJson || !siteDataJson.userData) {
//     return new Response(
//       JSON.stringify({ error: 'Site not found or no user data' }),
//       { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
//     );
//   }

//   const stagingUrl = siteDataJson.userData.stagingUrl;
//   const productionUrl = siteDataJson.userData.productionUrl;
//   console.log("stagingUrl:", stagingUrl, "productionUrl:", productionUrl);

//   let finalProductionUrl = productionUrl;
//   let siteDomainRaw = new URL(productionUrl).hostname;

//   // Custom domain logic - UPDATE AUTH_STORE_FRAMER if needed
//   if (customDomain) {
//     console.log("Processing custom domain:", customDomain);
    
//     const stagingHost = new URL(stagingUrl).hostname;
//     const productionHost = new URL(productionUrl).hostname;
//     const customHost = new URL(customDomain).hostname;
    
//     // Condition 1: stagingUrl === productionUrl (Framer default) OR customDomain different from both
//     if (stagingUrl === productionUrl || 
//         (customHost !== stagingHost && customHost !== productionHost)) {
      
//       console.log("Checking if custom domain exists in ACTIVE_SITES");
      
//       // Check if custom domain exists in ACTIVE_SITES_CONSENTBIT_FRAMER
//       const normalizedCustomDomain = customHost.replace(/^www\./, '');
//       const customDomainKeys = [
//         customDomain,
//         `https://${normalizedCustomDomain}`,
//         `https://www.${normalizedCustomDomain}`,
//         normalizedCustomDomain,
//       ];

//       let customDomainStatus = null;
//       for (const key of customDomainKeys) {
//         try {
//           const data = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(key);
//           if (data) {
//             customDomainStatus = data;
//             console.log(`Found custom domain status for key: ${key}`);
//             break;
//           }
//         } catch (err) {
//           console.error(`Error checking custom domain key=${key}:`, err);
//         }
//       }

//       if (customDomainStatus) {
//         // Custom domain exists and is active - UPDATE AUTH_STORE_FRAMER and use it
//         finalProductionUrl = customDomain;
//         siteDomainRaw = customHost;
        
//         // Update AUTH_STORE_FRAMER with new productionUrl
//         siteDataJson.userData.productionUrl = customDomain;
//         try {
//           await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(siteDataJson));
//           console.log("Updated AUTH_STORE_FRAMER with custom domain");

//             return new Response(JSON.stringify({
//         siteId,
//         siteDomain: siteDomainRaw,
//         productionUrl: finalProductionUrl,
//         stagingUrl,
//         customDomain,
//         canPublishToCustomDomain: true
//     }), {
//         status: 200,
//         headers: { 'Content-Type': 'application/json', ...corsHeaders }
//     });
//         } catch (updateErr) {
//           console.error("Failed to update AUTH_STORE_FRAMER:", updateErr);
//         }
//       }
//     }
//   }

//   // Now check ACTIVE_SITES with finalProductionUrl
//   const siteUrl = new URL(finalProductionUrl);
//   const normalizedDomain = siteUrl.hostname.replace(/^www\./, '');
  
//   const possibleKeys = [
//     finalProductionUrl,
//     `https://${normalizedDomain}`,
//     `https://www.${normalizedDomain}`,
//     `http://${normalizedDomain}`,
//     `http://www.${normalizedDomain}`,
//     `www.${normalizedDomain}`,
//     normalizedDomain,
//   ];

//   // Fetch site status from ACTIVE_SITES_CONSENTBIT_FRAMER
//   let siteStatusJson = null;
//   for (const key of possibleKeys) {
//     try {
//       const data = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(key);
//       if (data) {
//         siteStatusJson = data;
//         console.log(`Found site status for key: ${key}`);
//         break;
//       }
//     } catch (err) {
//       console.error(`Error accessing ACTIVE_SITES_CONSENTBIT_FRAMER for key=${key}:`, err);
//     }
//   }

//   // Prepare response
//   let result;
//   if (siteStatusJson) {
//     const siteStatus = JSON.parse(siteStatusJson);
//     if (siteStatus.active === true || 
//         (siteStatus.active === false && siteStatus.cancelAtPeriodEnd === false)) {
//       result = {
//         siteId,
//         siteDomain: siteDomainRaw,
//         productionUrl: finalProductionUrl,
//         stagingUrl,
//         customDomain: customDomain || null,
//         canPublishToCustomDomain: true,
//         status: siteStatus.status || 'complete',
//       };
//     } else {
//       result = {
//         siteId,
//         siteDomain: siteDomainRaw,
//         productionUrl: finalProductionUrl,
//         stagingUrl,
//         customDomain: customDomain || null,
//         canPublishToCustomDomain: false,
//         status: siteStatus.status || 'subscription_inactive',
//       };
//     }
//   } else {
//     result = {
//       siteId,
//       siteDomain: siteDomainRaw,
//       productionUrl: finalProductionUrl,
//       stagingUrl,
//       customDomain: customDomain || null,
//       canPublishToCustomDomain: false,
//     };
//   }

//   return new Response(JSON.stringify(result), {
//     status: 200,
//     headers: { 'Content-Type': 'application/json', ...corsHeaders },
//   });
// }
