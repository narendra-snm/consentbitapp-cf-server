import { withSecureApi, secureOPTIONS } from './utils/security-middleware.js';
import { getCorsHeaders } from "./utils/cors.js";
import { handleAuth } from "./routes/authTest.js";
import { handleVisitor } from "./routes/visitor.js";
import { handleLocation } from "./routes/location.js";
import { handleConsent } from "./routes/consent.js";
import { fetchscript } from "./routes/fetchscripts.js";
import { handleStripeWebhook} from './routes/stripeWebhook.js';
import { handleStripeWebhookWebsite} from './routes/stripeWebhookTest.js';
import { onRequestGet } from './routes/subscriptionStaus.js';

import Stripe from 'stripe';
import handleCookieScan from './utils/handleCookieScan.js';
async function apiHandler(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");

  // --- CORS preflight ---
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(origin) });
  }

  // --- Test KV binding ---
  if (url.pathname === "/sunscription") {
    if (!env.AUTH_STORE) {
      return new Response("❌ AUTH_STORE KV binding missing", { status: 500 });
    }

    await env.AUTH_STORE.put("test_key", "hello world");
    const val = await env.AUTH_STORE.get("test_key");

    return new Response(`✅ KV works: ${val}`);
  }

  // --- Route handling ---
  let response =
    (await handleAuth(url, request, env, origin)) ||
    (await handleVisitor(url, request, env, origin)) ||
    (await handleLocation(url, request, env, origin)) ||
    (await handleConsent(url, request, env, origin)) ||
    (await fetchscript(url, request, env, origin));

 

// if (url.pathname === "/subscription") {
//    response= await handleStripeWebhook(request, env, ctx);
//   }
 if (response) return response;
  return new Response("Not Found", { status: 404, headers: getCorsHeaders(origin) });
}

// Wrap with security
const securedApiHandler = withSecureApi(apiHandler);

export default {
  async fetch(request, env, ctx) {

const url = new URL(request.url);
  let response;
if (url.pathname === "/subscription") {
   response= await handleStripeWebhook(request, env, ctx);
    if (response) return response;
  }

    if (url.pathname === "/scan") {
      response = await handleCookieScan(request, env, ctx);
      if (response) return response;
    }
  if (url.pathname === "/subscription-website") {
   response= await handleStripeWebhookWebsite(request, env, ctx);
    if (response) return response;
  }

if (url.pathname === "/subscription-status") {
   response= await onRequestGet(request, env,url);
    if (response) return response;
  }
if(url.pathname === "/test"){
//   if (request.method !== "POST") {
//       return new Response("Method Not Allowed", { status: 405 })
//     }

//     // 🔴 IMPORTANT: read raw body EXACTLY ONCE
//     const body = await request.text()
//     const signature = request.headers.get("stripe-signature")

//     if (!signature) {
//       return new Response("Missing Stripe signature", { status: 400 })
//     }

//     // ✅ Stripe client for Cloudflare Workers
//     const stripe = new Stripe(env.STRIPE_SECRET_KEY_TEST, {
//       apiVersion: "2024-06-20",
//       httpClient: Stripe.createFetchHttpClient(),
//     })

//     let event
//     try {
//       // ✅ MUST use constructEventAsync in Workers
//       event = await stripe.webhooks.constructEventAsync(
//         body,
//         signature,
//         env.STRIPE_WEBHOOK_SECRET_TEST
//       )
//     } catch (err) {
//       console.error("❌ Signature verification failed:", err.message)
//       return new Response("Invalid signature", { status: 400 })
//     }

//     // ✅ Only care about this event
//     if (event.type === "checkout.session.completed") {
//       const session = event.data.object

//       // ✅ Platform from metadata (recommended)
//       console.log("✅ platform (metadata):", session.custom_fields)

//       // ✅ Platform from Checkout custom field (if used)
//       let platform = null;

// if (Array.isArray(session.custom_fields)) {
//   const platformField = session.custom_fields.find(
//     field => field.key === "platform"
//   );

//   if (platformField?.dropdown?.value) {
//     platform = platformField.dropdown.value;
//   }
// }

// console.log("✅ platform (custom field):", platform);
//     }

//     return new Response("ok", { status: 200 })

 try {
      const url = new URL(request.url);
      const domain = url.searchParams.get("domain");

      if (!domain) {
        return new Response(
          JSON.stringify({ error: "domain query param is required" }),
          { status: 400 }
        );
      }

      // Normalize domain
      const targetUrl = domain.startsWith("http")
        ? domain
        : `https://${domain}`;

      const res = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "platform-detector-bot"
        }
      });

      const html = await res.text();

      // Check ONLY for Framer script
      const isFramer =
        html.includes("events.framer.com/script") ||
        html.includes("data-fid=");

      return new Response(
        JSON.stringify({
          domain,
          platform: isFramer ? "framer" : "not-framer"
        }),
        {
          headers: { "Content-Type": "application/json" }
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Failed to fetch domain",
          details: error.message
        }),
        { status: 500 }
      );
    }


}


    return securedApiHandler(request, env,ctx);
  },
};