import { generateToken, verifyToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";
import { validateJSONBody } from "../utils/security-validation.js";

export async function handleAuth(url, request, env, origin) {
  try {
    if (!env.JWT_SECRET) {
      return new Response(
        JSON.stringify({ error: "JWT_SECRET not set" }),
        { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
      );
    }

    const AUTH_JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET);

    // --- Google Login ---
    if (url.pathname === "/auth/google") {
      const authHeader = request.headers.get("Authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        try {
          const token = authHeader.split(" ")[1];
          const user = await verifyToken(token, AUTH_JWT_SECRET);
          if (user) {
            return new Response(
              JSON.stringify({ loggedIn: true, user }),
              { status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
            );
          }
        } catch (err) {
          // invalid token, proceed to login
        }
      }

      const redirectUri = `${env.SERVER_URL}/auth/google/callback`;
      const googleUrl =
        `https://accounts.google.com/o/oauth2/v2/auth` +
        `?client_id=${env.GOOGLE_CLIENT_ID}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=code` +
        `&scope=profile%20email` +
        `&prompt=consent%20select_account`;

      return Response.redirect(googleUrl, 302);
    }

    // --- Google Callback ---
    if (url.pathname === "/auth/google/callback") {
      const code = url.searchParams.get("code");
      const siteUrl = url.searchParams.get("siteUrl") || null;
      const siteId = url.searchParams.get("siteId") || null;

      if (!code) {
        return new Response(JSON.stringify({ error: "No code received" }), { status: 400 });
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${env.SERVER_URL}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        return new Response(
          JSON.stringify({ error: "Failed to get access_token", details: tokenData }),
          { status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
        );
      }

      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const user = await userRes.json();

      // --- KV Store ---
      // if (!env.AUTH_STORE) {
      //   return new Response(
      //     JSON.stringify({ error: "AUTH_STORE KV binding missing" }),
      //     { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
      //   );
      // }

      // const kvKey = `user_${siteId || user.id}`;
      // await env.AUTH_STORE.put(
      //   kvKey,
      //   JSON.stringify({
      //     id: user.id,
      //     name: user.name,
      //     displayName: user.name,
      //     email: user.email,
      //     picture: user.picture,
      //     role: "user",
      //     siteId: siteId || user.id,
      //     siteUrl: siteUrl || null,
      //   })
      // );

      // --- JWT Token ---
      const jwtToken = await generateToken(user, AUTH_JWT_SECRET);
      const userStr = encodeURIComponent(JSON.stringify(user));

      const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Auth Complete</title></head>
        <body>
          <script>
            (function() {
              const token = "${jwtToken}";
              const user = JSON.parse(decodeURIComponent("${userStr}"));
              if (window.opener) {
                window.opener.postMessage({ type: "auth-success", token, user }, "*");
                window.close();
              }
            })();
          </script>
        </body>
      </html>
      `;

      return new Response(html, {
        headers: { "Content-Type": "text/html", ...getCorsHeaders(origin) },
      });
    }

    // --- Verify JWT ---
    if (url.pathname === "/auth/me") {
      const authHeader = request.headers.get("Authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          status: 401,
          headers: getCorsHeaders(origin),
        });
      }
const siteId = url.searchParams.get("siteId");
const kvData = await env.AUTH_STORE_FRAMER.get(siteId);
      const token = authHeader.split(" ")[1];
      const user = await verifyToken(token, AUTH_JWT_SECRET);
    const data= kvData ? JSON.parse(kvData) : null;
const published= data.isPublished ? data.isPublished : false;
      return new Response(
        JSON.stringify(user ? { loggedIn: true,kvData:kvData,user: user, isPublished:published,siteId:siteId } : { loggedIn: false }),
        { status: user ? 200 : 401, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
      );
    }

    // --- Get / Save user KV ---
    if (url.pathname.startsWith("/auth/user/")) {
      if (!env.AUTH_STORE_FRAMER) {
        return new Response(
          JSON.stringify({ error: "AUTH_STORE KV binding missing" }),
          { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
        );
      }

      const siteIdParam = url.pathname.split("/")[3];

      if (request.method === "GET") {
        const userData = await env.AUTH_STORE_FRAMER.get(`${siteIdParam}`, { type: "json" });
        return new Response(JSON.stringify(userData || { error: "Not found" }), {
          headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) },
        });
      }

     if (request.method === "POST") {
  const body = await validateJSONBody(request);
console.log("Received body:", body);
  // Get the existing data (if any)
  const existingData = await env.AUTH_STORE_FRAMER.get(siteIdParam, "json");

 if (!existingData) {
  try {
    const payload = {
      recipientEmail: body.userData.email || "",
      recipientName: body.userData.name || "",
      subject: "Welcome to ConsentBit 🎉",
      html: `
      <h1>Thank You for Signing Up with ConsentBit!</h1>
      <p>Thank you for choosing the <b>ConsentBit paid plan</b>!</p>
      <ul>
        <li><a href="https://www.consentbit.com/help-document">Quick Start Guide</a></li>
        <li><a href="https://vimeo.com/1090979483/99f46cddbf">Video Walkthrough</a></li>
        <li><a href="https://www.consentbit.com/blog">Blogs & Newsletter</a></li>
      </ul>
      <p>Support: <a href="mailto:web@consentbit.com">web@consentbit.com</a></p>
      <p>- The ConsentBit Team</p>
    `,
    userData: body
    };

    // Call Make webhook
    const makeWebhookUrl = "https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p"; // <-- add your webhook URL here

    const response = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291" 
      },
      body: JSON.stringify(payload)
    });

    const result = await response.text();
    // optional: log result for debugging
    console.log("Email sent:", result);
  } catch (err) {
    // silently handle error
    console.error("Failed to send email:", err);
  }
}
  // Merge old and new data
  const updatedData = existingData
    ? { ...existingData, ...body } // merge existing + new
    : body; // if no previous data, just use the new one

  // Save merged data back to KV
  await env.AUTH_STORE_FRAMER.put(siteIdParam, JSON.stringify(updatedData));

  // Respond with merged data
  return new Response(
    JSON.stringify({
      success: true,
      siteId: siteIdParam,
      saved: updatedData,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(origin),
      },
    }
  );
}
    }

    return null;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }
}
