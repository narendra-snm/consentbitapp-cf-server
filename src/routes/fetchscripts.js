import { generateToken, verifyToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";
import { validateJSONBody } from "../utils/security-validation.js";

export async function fetchscript(url, request, env, origin) {
  try {
    if (request.method === "POST" && url.pathname === "/scripts") {
      try {
        const { siteId, scripts } = await validateJSONBody(request);
        if (!siteId || !scripts) {
          return new Response(
            JSON.stringify({ error: "Missing siteId or scripts" }),
            {
              status: 400,
              headers: getCorsHeaders(origin),
            }
          );
        }

        await env.SCRIPTS_KV_FRAMER.put(siteId, JSON.stringify(scripts));

        return new Response(
          JSON.stringify({ message: "Saved", siteId }),
          {
            status: 200,
            headers: getCorsHeaders(origin),
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message }),
          {
            status: 500,
            headers: getCorsHeaders(origin),
          }
        );
      }
    }
if (request.method === "GET" && url.pathname === "/api/fetch-scripts") {
      const siteUrl = url.searchParams.get("url");
      if (!siteUrl) {
        return new Response(
          JSON.stringify({ error: "Missing 'url' parameter" }),
          {
            status: 400,
            headers:getCorsHeaders(origin),
          }
        );
      }
      try {
        const response = await fetch(siteUrl);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const html = await response.text();
        const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        const headHTML = headMatch ? headMatch[0] : "";
        const analyticsPatterns = [
          "google-analytics.com",
          "gtag.js",
          "hotjar.com",
        ];
        const scriptObjs = extractScriptsFromHead(headHTML);
        const allScripts = scriptObjs.map(({ attrs, content }) => {
          const attrMap = new Map(attrs);
          const attrsSerialized = serializeAttributes(attrs);
          const scriptTag = content.trim()
            ? `<script ${attrsSerialized}>${content.trim()}</script>`
            : `<script ${attrsSerialized}></script>`;
          let category = [];
          const src = attrMap.get("src") || "";
          const rawData = src + content;
          if (analyticsPatterns.some((pattern) => rawData.includes(pattern))) {
            category.push("analytics");
          }
          const dataCategory = attrMap.get("data-category") || "";
          if (dataCategory) {
            const categoriesFromAttr = dataCategory
              .split(",")
              .map(c => c.trim())
              .filter(c => c.length > 0);
            category = [...category, ...categoriesFromAttr];
          }
          return {
            script: scriptTag,
            isChanged: false,
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
            totalAnalyticsScripts: allScripts.filter((s) =>
              s.category.includes("analytics")
            ).length,
          }),
          { headers: getCorsHeaders(origin) }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch site", details: error.message }),
          {
            status: 500,
            headers: getCorsHeaders(origin),
          }
        );
      }
    }
if (request.method === "POST" && url.pathname === "/banner/save") {
  try {
  

    const { siteId, bannerData } = await validateJSONBody(request);
    if (!siteId || !bannerData) {
      return new Response("Missing siteId or bannerData", {
        status: 400,
        headers: getCorsHeaders(origin),
      });
    }

    // Save banner data in bannerKv_FRAMER
    await env.bannerKv_FRAMER.put(siteId, JSON.stringify(bannerData));

    // Fetch existing auth_store data for siteId
    const authStoreValue = await env.AUTH_STORE_FRAMER.get(siteId);
    let authData = authStoreValue ? JSON.parse(authStoreValue) : {};

    // Update authData with bannerData and set isPublished
    if(!authData.isPublished){
    authData.isPublished = true;

    // Save updated authData back to auth_store KV
    await env.AUTH_STORE_FRAMER.put(siteId, JSON.stringify(authData));
    }
    return new Response(JSON.stringify({ success: true, siteId }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(origin),
      },
    });
  } catch (err) {
    console.error("Error saving banner:", err);
    return new Response("Internal server error", {
      status: 500,
      headers: getCorsHeaders(origin),
    });
  }
}


  if (request.method === "GET" && url.pathname.startsWith("/banner/get/")) {
      const siteId = url.pathname.split("/banner/get/")[1];
      if (!siteId) {
        return new Response("Missing siteId", {
          status: 400,
          headers: getCorsHeaders(origin),
        });
      }
      const data = await env.bannerKv_FRAMER.get(siteId);
      if (!data) {
        return new Response("Not found", {
          status: 404,
          headers: getCorsHeaders(origin),
        });
      }
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      });
    }

    return null;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      {
        status: 500,
        headers: getCorsHeaders(origin),
      }
    );
  }
}
function parseAttributes(attrString) {
  const attrs = [];
  const regex = /([\w-]+)(?:="([^"]*)")?/g;
  let match;
  while ((match = regex.exec(attrString)) !== null) {
    attrs.push([match[1], match[2] || ""]);
  }
  return attrs;
}
function serializeAttributes(attrs) {
  return attrs.map(([name, value]) => `${name}="${value}"`).join(" ");
}
function extractScriptsFromHead(headHTML) {
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>|<script([^>]*)\/>/gi;
  const scripts = [];
  let match;
  while ((match = scriptRegex.exec(headHTML)) !== null) {
    const attrsString = match[1] || match[3] || "";
    const content = match[2] || "";
    const attrs = parseAttributes(attrsString);
    scripts.push({ attrs, content });
  }
  return scripts;
}

