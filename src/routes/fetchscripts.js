import { generateToken, verifyToken } from '../utils/jwt.js';
import { getCorsHeaders } from '../utils/cors.js';
import { validateJSONBody } from '../utils/security-validation.js';

export async function fetchscript(url, request, env, origin) {
	try {
		if (request.method === 'POST' && url.pathname === '/scripts') {
			try {
				const { siteId, scripts } = await validateJSONBody(request);
				if (!siteId || !scripts) {
					return new Response(JSON.stringify({ error: 'Missing siteId or scripts' }), {
						status: 400,
						headers: getCorsHeaders(origin),
					});
				}

				await env.SCRIPTS_KV_FRAMER.put(siteId, JSON.stringify(scripts));

				return new Response(JSON.stringify({ message: 'Saved', siteId }), {
					status: 200,
					headers: getCorsHeaders(origin),
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: 500,
					headers: getCorsHeaders(origin),
				});
			}
		}
		if (request.method === 'GET' && url.pathname === '/api/fetch-scripts') {
			const siteUrl = url.searchParams.get('url');
			if (!siteUrl) {
				return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
					status: 400,
					headers: getCorsHeaders(origin),
				});
			}
			try {
				// Fetch target site
				const response = await fetch(siteUrl);
				if (!response.ok) {
					throw new Error(`${response.status} ${response.statusText}`);
				}
				const html = await response.text();
				// Extract head HTML
				const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
				const headHTML = headMatch ? headMatch[0] : '';
				// Extract and process <script> elements
				const scriptObjs = extractScriptsFromHead(headHTML);
				const analyticsPatterns = ['google-analytics.com', 'gtag.js', 'hotjar.com'];

				// Patterns to filter out (Framer-specific scripts)
				const framerFilterPatterns = [
					'ga.jspm.io/npm:es-module-shims',
					'framer.com/edit/init.mjs',
					'__framer_force_showing_editorbar_since',
					'data-framer-importmap',
					'data-framer-es-module-shims',
				];

				const allScripts = scriptObjs
					.filter(({ attrs, content }) => {
						const attrMap = new Map(attrs);
						const src = attrMap.get('src') || '';
						const rawData = src + content;
						// Filter out scripts with data-site-id attribute
						if (attrMap.has('data-site-id')) {
							return false;
						}
						if (attrMap.has('data-framer-importmap')) {
							return false;
						}
						// Filter out Framer-specific scripts
						return !framerFilterPatterns.some((pattern) => rawData.includes(pattern));
					})
					.map(({ attrs, content }) => {
						const attrMap = new Map(attrs);
						const attrsSerialized = serializeAttributes(attrs);
						const scriptTag = content.trim()
							? `<script ${attrsSerialized}>${content.trim()}</script>`
							: `<script ${attrsSerialized}></script>`;
						let category = ['essential'];
						const src = attrMap.get('src') || '';
						const rawData = src + content;
						// Pattern-based categorization
						if (analyticsPatterns.some((pattern) => rawData.includes(pattern))) {
							category.push('analytics');
						}
						// Parse `data-category` multi-values
						const dataCategory = attrMap.get('data-category') || '';
						if (dataCategory) {
							const categoriesFromAttr = dataCategory
								.split(',')
								.map((c) => c.trim())
								.filter((c) => c.length > 0);
							category = [...category, ...categoriesFromAttr.map((c) => c.toLowerCase())];
						}
						// Remove duplicates
						category = [...new Set(category)];
						return {
							script: scriptTag,
							isChanged: category.length > 0,
							isDismiss: false,
							isSaved: false,
							isEditing: false,
							category,
						};
					});
				return new Response(
					JSON.stringify({
						scripts: allScripts,
						totalScripts: allScripts.length,
						totalAnalyticsScripts: allScripts.filter((s) => s.category.includes('analytics')).length,
					}),
					{ headers: getCorsHeaders(origin) }
				);
			} catch (error) {
				return new Response(JSON.stringify({ error: 'Failed to fetch site', details: error.message }), {
					status: 500,
					headers: getCorsHeaders(origin),
				});
			}
		}
		// if (request.method === "POST" && url.pathname === "/banner/save") {
		//   try {

		//     const { siteId, bannerData } = await validateJSONBody(request);
		//     if (!siteId || !bannerData) {
		//       return new Response("Missing siteId or bannerData", {
		//         status: 400,
		//         headers: getCorsHeaders(origin),
		//       });
		//     }

		//     // Save banner data in bannerKv_FRAMER
		//     await env.bannerKv_FRAMER.put(siteId, JSON.stringify(bannerData));

		//     // Fetch existing auth_store data for siteId
		//     const authStoreValue = await env.AUTH_STORE_FRAMER.get(siteId);
		//     let authData = authStoreValue ? JSON.parse(authStoreValue) : {};

		//     // Update authData with bannerData and set isPublished
		//     if(!authData.isPublished){
		//     authData.isPublished = true;

		//     // Save updated authData back to auth_store KV
		//     await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData));
		//     }
		//     return new Response(JSON.stringify({ success: true, siteId }), {
		//       status: 201,
		//       headers: {
		//         "Content-Type": "application/json",
		//         ...getCorsHeaders(origin),
		//       },
		//     });
		//   } catch (err) {
		//     console.error("Error saving banner:", err);
		//     return new Response("Internal server error", {
		//       status: 500,
		//       headers: getCorsHeaders(origin),
		//     });
		//   }
		// }
		// Inside your handler for POST /banner/save
		if (request.method === 'POST' && url.pathname === '/banner/save') {
			try {
        console.log("Reached banner save endpoint");
				const { siteId, bannerData } = await validateJSONBody(request);
				if (!siteId || !bannerData) {
					return new Response('Missing siteId or bannerData', { status: 400, headers: getCorsHeaders(origin) });
				} // Save banner data

				await env.bannerKv_FRAMER.put(siteId, JSON.stringify(bannerData)); // Fetch & parse auth data for this site

				const authStoreValue = await env.AUTH_STORE_FRAMER.get(siteId);
				let authData = authStoreValue ? JSON.parse(authStoreValue) : {}; // Set isPublished if first time


				
				if (!authData.isPublished) {
    console.log("Setting isPublished to true for siteId:", siteId);
    authData.isPublished = true;
    await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData)); // <-- persist here
}

				if (!authData.paid) {
          console.log("User not marked as paid, checking active site status.");
					const productionUrl = authData.userData?.productionUrl;
					if (productionUrl) {
            console.log("Production URL found:", productionUrl);
						const activeDataRaw = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(productionUrl);
						const activeData = activeDataRaw ? JSON.parse(activeDataRaw) : null;
console.log("Active site data:", activeData);
						if (activeData && activeData.active === true && activeData.status === 'complete') {
							authData.paid = true; // Save updated authData
console.log("User marked as paid, saving auth data.");
							await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData)); // Prepare welcome email payload



try {
  const payload = {
	sender: {
	  name: "ConsentBit Team",
	  email: "web@email.consentbit.com"
	},
	to: [
	  {
		email: authData.userData?.email || "",
		name: authData.userData?.name || ""
	  }
	],
	subject: "Welcome to ConsentBit 🎉",

	// ⭐ Plain text version for better deliverability
	textContent: `
Hi ${authData.userData?.name || 'there'},

Great news! We noticed you’ve successfully installed ConsentBit on your live domain!

Your site is now compliant and has a reliable consent management solution in place.

Here’s how to make the most of your setup:

Customize your banner: Adjust styling, text, and preferences to match your brand.

Track consent analytics: Monitor opt-ins and user preferences for insights.

Stay compliant: GDPR, CCPA, and other privacy standards are now covered.

Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!

Best regards,
The ConsentBit Team
	`,

	// ⭐ HTML version (your existing template)
	htmlContent: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Welcome to ConsentBit!</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #222; background: #f9f9f9; margin: 0; padding: 0;">
    
                <h3 style="color: #222; margin-top: 0;">Hi <span style="color: #222;">${authData.userData?.name || 'there'}</span>,</h3>
                <p> Great news ! we noticed you've successfully installed <b>ConsentBit</b> on your live domain!</p>
                    <p>Your site is compliant and have a reliable consent management solution.</p>
                <p> Here's how to make the most of your setup:</p>
                   <p> <b> Customize Your Banner</b> – Adjust styling, text, and preferences to match your brand.</p>
                   <p><b> Track Consent Analytics </b>– Monitor opt-ins and user preferences for insights.</p>
                   <p><b>Stay Compliant</b> – GDPR, CCPA, and other privacy standards are now covered.</p>
                  
               
             
   <p>Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!
  </p>
  <p>
    Best regards,<br>
    <strong>The Consentbit Team</strong><br>    
  </p>
  </body>
</html>
`,

	// Not used by Brevo, but if you need to send them in webhook logs:
   
  };

  // ⭐ Call Brevo API
  const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
	method: "POST",
	headers: {
	  "Content-Type": "application/json",
	  "api-key": env.BREVO_API_KEY // Make sure this is in your Cloudflare Vars
	},
	body: JSON.stringify(payload)
  });

  const result = await brevoResponse.json();
  console.log("Brevo email sent:", result);

} catch (err) {
  console.error("Failed to send email:", err);
}









// 							try {
// 								const body = authData;
// 								const payload = {
// 									recipientEmail: body.userData?.email || '',
// 									recipientName: body.userData?.name || '',
// 									subject: 'Welcome to ConsentBit 🎉',
// 									html: `
// <!DOCTYPE html>
// <html>
//   <head>
//     <meta charset="UTF-8">
//     <title>Welcome to ConsentBit!</title>
//   </head>
//   <body style="font-family: Arial, sans-serif; color: #222; background: #f9f9f9; margin: 0; padding: 0;">
    
//                 <h3 style="color: #222; margin-top: 0;">Hi <span style="color: #222;">${body.userData?.name || 'there'}</span>,</h3>
//                 <p> Great news ! we noticed you've successfully installed <b>ConsentBit</b> on your live domain!</p>
//                     <p>Your site is compliant and have a reliable consent management solution.</p>
//                 <p> Here's how to make the most of your setup:</p>
//                    <p> <b> Customize Your Banner</b> – Adjust styling, text, and preferences to match your brand.</p>
//                    <p><b> Track Consent Analytics </b>– Monitor opt-ins and user preferences for insights.</p>
//                    <p><b>Stay Compliant</b> – GDPR, CCPA, and other privacy standards are now covered.</p>
                  
               
             
//    <p>Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!
//   </p>
//   <p>
//     Best regards,<br>
//     <strong>The Consentbit Team</strong><br>    
//   </p>
//   </body>
// </html>
// `,
// 									userData: body,
// 									clickup: 'none',
// 								}; // Send welcome email webhook

// 								const makeWebhookUrl = 'https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p';
// 								const response = await fetch(makeWebhookUrl, {
// 									method: 'POST',
// 									headers: {
// 										'Content-Type': 'application/json',
//                      "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291" 
// 									},
// 									body: JSON.stringify(payload),
// 								});

// 								const result = await response.text();
// 								console.log('Email sent:', result);
// 							} catch (err) {
// 								console.error('Failed to send welcome email:', err);
// 							}
						}
					}
				} else {
					// If paid already true, just save authData if updated (like isPublished)
					console.log()
					await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData));
				}

				return new Response(JSON.stringify({ success: true, siteId }), {
					status: 201,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			} catch (err) {
				console.error('Error saving banner:', err);
				return new Response('Internal server error', { status: 500, headers: getCorsHeaders(origin) });
			}
		}

if (request.method === 'POST' && url.pathname === '/banner/save-2') {
			try {
        console.log("Reached banner save endpoint");
				const { siteId, bannerData } = await validateJSONBody(request);
				if (!siteId || !bannerData) {
					return new Response('Missing siteId or bannerData', { status: 400, headers: getCorsHeaders(origin) });
				} // Save banner data

				await env.bannerKv_FRAMER.put(siteId, JSON.stringify(bannerData)); // Fetch & parse auth data for this site

				const authStoreValue = await env.AUTH_STORE_FRAMER.get(siteId);
				let authData = authStoreValue ? JSON.parse(authStoreValue) : {}; // Set isPublished if first time
const latestProduction = bannerData.latestProduction || null;
const latestStaging = bannerData.latestStaging || null;

// Compare & Update
let updated = false;

// Check Production URL
if (latestProduction && authData.userData.productionUrl !== latestProduction) {
  console.log("Updating productionUrl", authData.userData.productionUrl, "->", latestProduction);
  authData.userData.productionUrl = latestProduction;
  updated = true;
}

// Check Staging URL
if (latestStaging && authData.userData.stagingUrl !== latestStaging) {
  console.log("Updating stagingUrl", authData.userData.stagingUrl, "->", latestStaging);
  authData.userData.stagingUrl = latestStaging;
  updated = true;
}

// Save only if changed
if (updated) {
  console.log("Saving updated URLs to AUTH_STORE_FRAMER for siteId:", siteId);
  await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData));
} else {
  console.log("No URL changes detected for siteId:", siteId);
}


				if (!authData.isPublished) {
    console.log("Setting isPublished to true for siteId:", siteId);
    authData.isPublished = true;
    await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData)); // <-- persist here
}

				if (!authData.paid) {
          console.log("User not marked as paid, checking active site status.");
					const productionUrl = authData.userData?.productionUrl;
					if (productionUrl) {
            console.log("Production URL found:", productionUrl);
						const activeDataRaw = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(productionUrl);
						const activeData = activeDataRaw ? JSON.parse(activeDataRaw) : null;
console.log("Active site data:", activeData);
						if (activeData && activeData.active === true && activeData.status === 'complete') {
							authData.paid = true; // Save updated authData
console.log("User marked as paid, saving auth data.");
							await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData)); // Prepare welcome email payload



try {
  const payload = {
	sender: {
	  name: "ConsentBit Team",
	  email: "web@email.consentbit.com"
	},
	to: [
	  {
		email: authData.userData?.email || "",
		name: authData.userData?.name || ""
	  }
	],
	subject: "Welcome to ConsentBit 🎉",

	// ⭐ Plain text version for better deliverability
	textContent: `
Hi ${authData.userData?.name || 'there'},

Great news! We noticed you’ve successfully installed ConsentBit on your live domain!

Your site is now compliant and has a reliable consent management solution in place.

Here’s how to make the most of your setup:

Customize your banner: Adjust styling, text, and preferences to match your brand.

Track consent analytics: Monitor opt-ins and user preferences for insights.

Stay compliant: GDPR, CCPA, and other privacy standards are now covered.

Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!

Best regards,
The ConsentBit Team
	`,

	// ⭐ HTML version (your existing template)
	htmlContent: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Welcome to ConsentBit!</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #222; background: #f9f9f9; margin: 0; padding: 0;">
    
                <h3 style="color: #222; margin-top: 0;">Hi <span style="color: #222;">${authData.userData?.name || 'there'}</span>,</h3>
                <p> Great news ! we noticed you've successfully installed <b>ConsentBit</b> on your live domain!</p>
                    <p>Your site is compliant and have a reliable consent management solution.</p>
                <p> Here's how to make the most of your setup:</p>
                   <p> <b> Customize Your Banner</b> – Adjust styling, text, and preferences to match your brand.</p>
                   <p><b> Track Consent Analytics </b>– Monitor opt-ins and user preferences for insights.</p>
                   <p><b>Stay Compliant</b> – GDPR, CCPA, and other privacy standards are now covered.</p>
                  
               
             
   <p>Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!
  </p>
  <p>
    Best regards,<br>
    <strong>The Consentbit Team</strong><br>    
  </p>
  </body>
</html>
`,

	// Not used by Brevo, but if you need to send them in webhook logs:
   
  };

  // ⭐ Call Brevo API
  const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
	method: "POST",
	headers: {
	  "Content-Type": "application/json",
	  "api-key": env.BREVO_API_KEY // Make sure this is in your Cloudflare Vars
	},
	body: JSON.stringify(payload)
  });

  const result = await brevoResponse.json();
  console.log("Brevo email sent:", result);

} catch (err) {
  console.error("Failed to send email:", err);
}









// 							try {
// 								const body = authData;
// 								const payload = {
// 									recipientEmail: body.userData?.email || '',
// 									recipientName: body.userData?.name || '',
// 									subject: 'Welcome to ConsentBit 🎉',
// 									html: `
// <!DOCTYPE html>
// <html>
//   <head>
//     <meta charset="UTF-8">
//     <title>Welcome to ConsentBit!</title>
//   </head>
//   <body style="font-family: Arial, sans-serif; color: #222; background: #f9f9f9; margin: 0; padding: 0;">
    
//                 <h3 style="color: #222; margin-top: 0;">Hi <span style="color: #222;">${body.userData?.name || 'there'}</span>,</h3>
//                 <p> Great news ! we noticed you've successfully installed <b>ConsentBit</b> on your live domain!</p>
//                     <p>Your site is compliant and have a reliable consent management solution.</p>
//                 <p> Here's how to make the most of your setup:</p>
//                    <p> <b> Customize Your Banner</b> – Adjust styling, text, and preferences to match your brand.</p>
//                    <p><b> Track Consent Analytics </b>– Monitor opt-ins and user preferences for insights.</p>
//                    <p><b>Stay Compliant</b> – GDPR, CCPA, and other privacy standards are now covered.</p>
                  
               
             
//    <p>Thank you for trusting ConsentBit to keep your website compliant and user-friendly. We look forward to supporting your journey!
//   </p>
//   <p>
//     Best regards,<br>
//     <strong>The Consentbit Team</strong><br>    
//   </p>
//   </body>
// </html>
// `,
// 									userData: body,
// 									clickup: 'none',
// 								}; // Send welcome email webhook

// 								const makeWebhookUrl = 'https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p';
// 								const response = await fetch(makeWebhookUrl, {
// 									method: 'POST',
// 									headers: {
// 										'Content-Type': 'application/json',
//                      "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291" 
// 									},
// 									body: JSON.stringify(payload),
// 								});

// 								const result = await response.text();
// 								console.log('Email sent:', result);
// 							} catch (err) {
// 								console.error('Failed to send welcome email:', err);
// 							}
						}
					}
				} else {
					// If paid already true, just save authData if updated (like isPublished)
					console.log()
					await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData));
				}

				return new Response(JSON.stringify({ success: true, siteId }), {
					status: 201,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			} catch (err) {
				console.error('Error saving banner:', err);
				return new Response('Internal server error', { status: 500, headers: getCorsHeaders(origin) });
			}
		}


if (request.method === "GET" && url.pathname === "/site/paid-status") {
  try {
    const origin = request.headers.get("Origin") || "*";
    const productionUrl = url.searchParams.get("productionUrl");
    if (!productionUrl) {
      return new Response("Missing productionUrl query parameter", {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
      });
    }

    // Get active site data from KV
    const activeDataRaw = await env.ACTIVE_SITES_CONSENTBIT_FRAMER.get(productionUrl);
    const activeData = activeDataRaw ? JSON.parse(activeDataRaw) : null;

    const paidStatus = activeData && activeData.active === true && activeData.status === "complete";

    return new Response(JSON.stringify({ productionUrl, paid: paidStatus }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }
    });
  } catch (err) {
    const origin = request.headers.get("Origin") || "*";
    console.error("Error checking paid status:", err);
    return new Response("Internal server error", {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }
    });
  }
}



		if (request.method === 'GET' && url.pathname.startsWith('/banner/get/')) {
			const siteId = url.pathname.split('/banner/get/')[1];
			if (!siteId) {
				return new Response('Missing siteId', {
					status: 400,
					headers: getCorsHeaders(origin),
				});
			}
			const data = await env.bannerKv_FRAMER.get(siteId);
			if (!data) {
				return new Response('Not found', {
					status: 404,
					headers: getCorsHeaders(origin),
				});
			}
			return new Response(data, {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					...getCorsHeaders(origin),
				},
			});
		}

		return null;
	} catch (err) {
		return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
			status: 500,
			headers: getCorsHeaders(origin),
		});
	}
}
function parseAttributes(attrString) {
	const attrs = [];
	const regex = /([\w-]+)(?:="([^"]*)")?/g;
	let match;
	while ((match = regex.exec(attrString)) !== null) {
		attrs.push([match[1], match[2] || '']);
	}
	return attrs;
}
function serializeAttributes(attrs) {
	return attrs.map(([name, value]) => `${name}="${value}"`).join(' ');
}
function extractScriptsFromHead(headHTML) {
	const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>|<script([^>]*)\/>/gi;
	const scripts = [];
	let match;
	while ((match = scriptRegex.exec(headHTML)) !== null) {
		const attrsString = match[1] || match[3] || '';
		const content = match[2] || '';
		const attrs = parseAttributes(attrsString);
		scripts.push({ attrs, content });
	}
	return scripts;
}
