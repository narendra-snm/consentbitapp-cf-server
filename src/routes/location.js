import { verifyToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";

export async function handleLocation(url, request, env, origin) {
 if (url.pathname === "/location") {
  const VISITOR_JWT_SECRET = new TextEncoder().encode(env.VISITOR_JWT_SECRET);

  const authHeader = request.headers.get("Authorization") || "";
  let visitor = null;

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    visitor = await verifyToken(token, VISITOR_JWT_SECRET);
  }

  const cf = request.cf || {};
  const country = cf.country || "UNKNOWN"; // ensure country is defined here
  const siteName = url.searchParams.get("siteName") || "unknown";

  const bannerType = country === "US" ? "CCPA" : "gdpr";

  const locationData = {
    country,
    continent: cf.continent || "UNKNOWN",
    state: cf.region || null,
    bannerType,
    siteName,
  };

  return new Response(JSON.stringify(locationData), {
    headers: { "Content-Type": "application/json", ...getCorsHeaders("*") },
  });
}

  return null;
}
