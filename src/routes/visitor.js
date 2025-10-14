import { generateToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";
import { SignJWT, jwtVerify } from "jose";
import { validateJSONBody } from "../utils/security-validation.js";
export async function handleVisitor(url, request, env, origin) {
 if (request.method === "POST" && url.pathname === "/api/visitor-token") {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  let body;
  try {
    body = await validateJSONBody(request);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body format" }), {
      status: 400,
      headers: { ...jwtVerifycorsHeaders, "Content-Type": "application/json" },
    });
  }

  const { visitorId, siteName } = body;
  if (!visitorId || !siteName) {
    return new Response(JSON.stringify({ error: "Missing visitorId or siteName" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Basic checks (extend with UUID validation as needed)
  if (typeof siteName !== "string" || siteName.length < 3 || siteName.length > 100) {
    return new Response(JSON.stringify({ error: "Invalid siteName format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const siteKV = await env.AUTH_STORE_FRAMER.get(siteName);
  if (!siteKV) {
    return new Response(JSON.stringify({ error: "Site not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // JWT generation (with jose package, using simple secret for demo)
  let token;
  try {
    const secret = `visitor-token-secret-${siteName}`;
    token = await new SignJWT({ visitorId, siteName, timestamp: Date.now() })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode(secret));
  } catch {
    return new Response(JSON.stringify({ error: "JWT generation error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // try {
  //   const tokenKey = `visitor-token:${siteName}:${visitorId}`;
  //   await env.SITE_KV.put(tokenKey, token, { expirationTtl: 86400 });
  // } catch {
  //   return new Response(JSON.stringify({ error: "Error storing token" }), {
  //     status: 500,
  //     headers: { ...getCorsHeaders, "Content-Type": "application/json" },
  //   });
  // }

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

 
}
