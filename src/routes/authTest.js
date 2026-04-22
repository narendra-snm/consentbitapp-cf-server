import { generateToken, verifyToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";
import { validateJSONBody } from "../utils/security-validation.js";
function extractSiteName(url) {
  if (!url) return "Not Published";
  try {
    // Ensure the URL has a valid format
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url; // auto-add https:// if missing
    }

    const hostname = new URL(url).hostname.replace(/^www\./, ""); // remove www.
    const parts = hostname.split(".");

    // handle domains like google.co.in → google
    if (parts.length >= 3) {
      return parts[parts.length - 3];
    }

    // handle simple domains like pintude.com → pintude
    return parts[0];
  } catch (e) {
    console.error("Invalid URL:", url);
    return null;
  }
}

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
if (url.pathname === "/auth/google/callback/v2") {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // this is the readKey
  const siteUrl = url.searchParams.get("siteUrl") || null;
  const siteId = url.searchParams.get("siteId") || null;

  if (!code) {
    return new Response(
      JSON.stringify({ error: "No code received" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  if (!state) {
    return new Response(
      JSON.stringify({ error: "Missing state/readKey" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const pending = await env.AUTH_PENDING.get(state, "json");
  if (!pending) {
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>Auth Failed</title></head>
        <body>
          <h3>Login session expired</h3>
          <p>Please close this window and try again.</p>
        </body>
      </html>
      `,
      {
        status: 400,
        headers: {
          "Content-Type": "text/html",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.SERVER_URL}/auth/google/callback/v2`,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return new Response(
      JSON.stringify({
        error: "Failed to get access_token",
        details: tokenData,
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  const googleUser = await userRes.json();

  const user = {
    id: googleUser.id,
    name: googleUser.name,
    email: googleUser.email,
    picture: googleUser.picture,
    productionUrl: pending.siteUrl || siteUrl || "",
    stagingUrl: pending.stagingUrl || "",
    siteId: pending.siteId || siteId || null,
  };

  const jwtToken = await generateToken(user, AUTH_JWT_SECRET);

  await env.AUTH_PENDING.put(
    `tokens_${state}`,
    JSON.stringify({
      token: jwtToken,
      user,
    }),
    { expirationTtl: 300 }
  );

  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>Auth Complete</title>
      <meta charset="utf-8" />
    </head>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
      <h3>Authorization complete</h3>
      <p>You can close this window now.</p>
      <script>
        setTimeout(() => {
          try { window.close(); } catch (e) {}
        }, 500);
      </script>
    </body>
  </html>
  `;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html",
      ...getCorsHeaders(origin),
    },
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
    sender: {
      name: "ConsentBit Team",
      email: "web@email.consentbit.com"
    },
    to: [
      {
        email: body.userData.email || "",
        name: body.userData.name || ""
      }
    ],
    subject: "Welcome to ConsentBit 🎉",

    // ⭐ Plain text version for better deliverability
    textContent: `
Hi ${body.userData.name || "there"},

Thank you for installing the ConsentBit app on your Framer website!
We're excited to have you onboard and ready to help you ensure privacy compliance with ease.

👉 View ConsentBit on the Framer App Store:
https://www.framer.com/marketplace/plugins/consentbit/preview/

Need assistance? We're here for you:

• Email us anytime: web@consentbit.com
• Book a quick support call: https://calendly.com/jibin-seattlenewmedia/30min
• Contact form: https://www.consentbit.com/contact

We're thrilled to support you in building trust with your users and achieving global privacy compliance.
If you have questions, feedback, or feature suggestions, don't hesitate to reach out — we're only a message away.

Thanks again,
The ConsentBit Team
    `,

    // ⭐ HTML version (your existing template)
    htmlContent: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0;">
  
  <h3 style="color: #222; margin-top: 0;">
    Hi <span style="color: #222;">${body.userData?.name || 'there'}</span>,
  </h3>

  <p>
    Thank you for installing the <strong>ConsentBit</strong> app on your Framer website! 
    We're excited to have you onboard and ready to help you ensure privacy compliance with ease.
  </p>

  <p>
    <a href="https://www.framer.com/marketplace/plugins/consentbit/preview/" target="_blank" style="color:#0066cc; text-decoration:none;">👉 You can download / view <strong>ConsentBit</strong> on the 
    
      Framer App Store
    </a>
  </p>

  <p><strong>Need assistance? We're here for you:</strong></p>

  <ul style="padding-left: 18px;">
    <li>
      Email us anytime at 
      <a href="mailto:web@consentbit.com" target="_blank">web@consentbit.com</a>
    </li>
    <li>
      Book a 
      <a href="https://calendly.com/jibin-seattlenewmedia/30min" target="_blank">quick support call</a>
    </li>
    <li>
      Fill out our 
      <a href="https://www.consentbit.com/contact" target="_blank">contact form</a> 
      and we'll get back to you shortly
    </li>
  </ul>  

  <p>
    We're thrilled to support you in building trust with your users and achieving global privacy compliance.
    If you have questions, feedback, or feature suggestions, don't hesitate to reach out — we're only a message away.
  </p>

  <p>
    Thanks again,<br>
    <strong>The ConsentBit Team</strong>
  </p>

</body>
</html>
`,

    // Not used by Brevo, but if you need to send them in webhook logs:
    userData: body,
    name: extractSiteName(
      body?.userData?.productionUrl ||
      body?.userData?.stagingUrl ||
      ""
    ),
    clickup: "staging"
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



  try {
    const payload = {
      recipientEmail: body.userData.email || "",
      recipientName: body.userData.name || "",
      
    userData: body,
    name: extractSiteName(body?.userData?.productionUrl || body?.userData?.stagingUrl || ""),
    clickup:"staging"
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


if(!updatedData.paid){
    const siteUrl =
  body?.userData?.productionUrl ||
  body?.userData?.stagingUrl ||
  "";


// 🔍 Check Pending KV by URL
const pendingData = siteUrl
  ? await env.Pending_Active_site.get(siteUrl, "json")
  : null;

if (pendingData) {
  // 🧪 Send simple test email (test server)
  // try {
  //   await fetch("https://api.brevo.com/v3/smtp/email", {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       "api-key": env.BREVO_API_KEY
  //     },
  //     body: JSON.stringify({
  //       sender: {
  //         name: "ConsentBit Test",
  //         email: "web@email.consentbit.com"
  //       },
  //       to: [{ email: body.userData.email }],
  //       subject: "ConsentBit Activated",
  //       textContent: "Hi"
  //     })
  //   });
  // } catch (e) {
  //   console.error("Test email failed", e);
  // }

  // ✅ Move to Active (Framer) KB
  const PaidState = {
    ...updatedData,
    paid: true,
    activatedAt: new Date().toISOString()
  };

  await env.AUTH_STORE_FRAMER.put(
    siteIdParam,
    JSON.stringify(PaidState)
  );

  // 🧹 Remove from Pending KV
   const customerId = pendingData.customerId;

  if (customerId) {
    // 1) Get subscription data from PENDING_SUBSCRIPTION_CONSENTBIT
    const pendingSubRaw = await env.PENDING_SUBSCRIPTION_CONSENTBIT.get(
      customerId,
      "json"
    );

    if (pendingSubRaw) {
      // 2) Store it into SUBSCRIPTION_CONSENTBIT_FRAMER
      await env.SUBSCRIPTION_CONSENTBIT_FRAMER.put(
        customerId,
        JSON.stringify(pendingSubRaw)
      );

      // 3) Delete from PENDING_SUBSCRIPTION_CONSENTBIT
      // await env.PENDING_SUBSCRIPTION_CONSENTBIT.delete(customerId);
    }
  }

await env.ACTIVE_SITES_CONSENTBIT_FRAMER.put(
  siteUrl,
  JSON.stringify({
    ...pendingData,
    
  })
);

//  await env.Pending_Active_site.delete(siteUrl);
  return new Response(
    JSON.stringify({
      success: true,
      siteId: siteIdParam,
      activatedFromPending: true,
      saved: updatedData
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


  // Save merged data back to KV
  await env.AUTH_STORE_FRAMER.put(siteIdParam, JSON.stringify(updatedData));



  
  // Respond with merged data
  return new Response(
    JSON.stringify({
      success: true,
      siteId: siteIdParam,
      activatedFromPending: false,
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

// ✅ NEW: Step 1 - Plugin calls this to get Google URL + readKey
if (url.pathname === "/auth/authorize" && request.method === "POST") {
  if (!env.AUTH_PENDING) {
    return new Response(
      JSON.stringify({ error: "AUTH_PENDING KV binding missing" }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }

  const body = await validateJSONBody(request);
  const readKey = crypto.randomUUID();

  await env.AUTH_PENDING.put(
    readKey,
    JSON.stringify({
      siteId: body.siteId || null,
      siteUrl: body.siteUrl || null,
      stagingUrl: body.stagingUrl || null,
    }),
    { expirationTtl: 300 }
  );

  const redirectUri = `${env.SERVER_URL}/auth/google/callback/v2`;
  const googleUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=profile%20email` +
    `&prompt=consent%20select_account` +
    `&state=${encodeURIComponent(readKey)}`;

  return new Response(
    JSON.stringify({ url: googleUrl, readKey }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(origin),
      },
    }
  );
}

// ✅ NEW: Step 3 - Google redirects here
if (url.pathname === "/auth/redirect") {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!state || !code) {
    return new Response(
      `<html><body><h3>Missing code or state</h3></body></html>`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/html",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const pending = await env.AUTH_PENDING.get(state, "json");
  if (!pending) {
    return new Response(
      `<html><body><h3>Session expired</h3></body></html>`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/html",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.SERVER_URL}/auth/redirect`,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error("Google token failed:", tokenData);
    return new Response(
      `<html><body><h3>Token exchange failed</h3></body></html>`,
      {
        status: 400,
        headers: {
          "Content-Type": "text/html",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const googleUser = await userRes.json();

  const user = {
    id: googleUser.id,
    name: googleUser.name,
    email: googleUser.email,
    picture: googleUser.picture,
  };

  const jwtToken = await generateToken(user, AUTH_JWT_SECRET);

  await env.AUTH_PENDING.put(
    `tokens_${state}`,
    JSON.stringify({
      token: jwtToken,
      user: {
        ...user,
        productionUrl: pending.siteUrl || "",
        stagingUrl: pending.stagingUrl || "",
      },
    }),
    { expirationTtl: 300 }
  );

  return new Response(
    `
    <!DOCTYPE html>
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <h3>Success!</h3>
        <p>Closing in 1 second...</p>
        <script>setTimeout(() => window.close(), 1000);</script>
      </body>
    </html>
    `,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        ...getCorsHeaders(origin),
      },
    }
  );
}

// ✅ NEW: Step 4 - Plugin polls this until tokens ready
if (url.pathname === "/auth/poll" && request.method === "POST") {
  const readKey = url.searchParams.get("readKey");

  if (!readKey) {
    return new Response(
      JSON.stringify({ error: "Missing readKey" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders(origin),
        },
      }
    );
  }

  const tokensData = await env.AUTH_PENDING.get(`tokens_${readKey}`, "json");

  if (!tokensData) {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(origin),
    });
  }

  await env.AUTH_PENDING.delete(readKey);
  await env.AUTH_PENDING.delete(`tokens_${readKey}`);

  return new Response(
    JSON.stringify(tokensData),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...getCorsHeaders(origin),
      },
    }
  );
}


    return null;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(origin) } }
    );
  }
}
