import puppeteer from "@cloudflare/puppeteer";
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

 export default async function handleCookieScan(request, env, ctx) {

  if (request.method !== "POST") {
    return new Response("Use POST", { status: 405 });
  }

  let browser;

  try {
    const { url } = await request.json();
    if (!url) {
      return json({ error: "URL required" }, 400);
    }

    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    // Reduce heavy resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    // Safe delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    const cookies = await page.cookies();
    const mainDomain = new URL(url).hostname;

    const thirdPartyCookies = cookies.filter(
      c => !c.domain.includes(mainDomain)
    );

    return json({
      scannedUrl: url,
      totalCookies: cookies.length,
      cookies,
      thirdPartyCookies
    });

  } catch (err) {
    return json({
      error: err.message
    }, 500);

  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}