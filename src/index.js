import { withSecureApi, secureOPTIONS } from './utils/security-middleware.js';
import { getCorsHeaders } from "./utils/cors.js";
import { handleAuth } from "./routes/auth.js";
import { handleVisitor } from "./routes/visitor.js";
import { handleLocation } from "./routes/location.js";
import { handleConsent } from "./routes/consent.js";
import { fetchscript } from "./routes/fetchscripts.js";
import { handleStripeWebhook} from './routes/stripeWebhook.js';

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

    return securedApiHandler(request, env,ctx);
  },
};