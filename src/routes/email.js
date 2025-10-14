// Cloudflare Worker-compatible EmailService for Brevo API and Cloudflare KV

// EmailService.js

export class EmailService {
  constructor(env) {
    this.env = env;
    this.brevoApiUrl = 'https://api.brevo.com/v3/smtp/email';
    this.brevoApiKey = env.BREVO_API_KEY || '';
    // No ClickUp (uncomment/add if you add this feature)
    this.clickUpApiKey = '';
    this.clickUpListId = '';
    this.clickUpApiUrl = 'https://api.clickup.com/api/v2';
  }

  // SEND STAGING INSTALLATION EMAIL
  async sendStagingInstallationEmail(data) {
    const emailContent = this.getStagingInstallationEmailContent(data);
    const result = await this.sendEmail({
      to: [{ email: data.recipientEmail, name: data.recipientName }],
      subject: `Welcome to ConsentBit! Your staging site is ready`,
      htmlContent: emailContent.html,
      textContent: emailContent.text,
      tags: ['staging', 'consentbit']
    });
    if (result.success) {
      await this.storeStagingInstallationData(data);
    }
    return result;
  }

  // SEND PAID INSTALLATION EMAIL
  async sendPaidInstallationEmail(data) {
    const emailContent = this.getPaidInstallationEmailContent(data);
    const result = await this.sendEmail({
      to: [{ email: data.recipientEmail, name: data.recipientName }],
      subject: `Welcome to ConsentBit! Your app is ready to go`,
      htmlContent: emailContent.html,
      textContent: emailContent.text,
      tags: ['paid-installation', 'consentbit']
    });
    if (result.success) {
      await this.storePaidInstallationData(data);
    }
    return result;
  }

  // SEND PAYMENT SUCCESS EMAIL
  async sendPaymentSuccessEmail(data) {
    try {
      const emailContent = this.getPaymentSuccessEmailContent();
      const result = await this.sendEmail({
        to: [{ email: data.recipientEmail, name: data.recipientName }],
        subject: `Thank You for Signing Up with ConsentBit!`,
        htmlContent: emailContent.html,
        textContent: emailContent.text,
        tags: ['payment-success', 'consentbit']
      });
      return result;
    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error in sendPaymentSuccessEmail'
      };
    }
  }

  // Baseline email sending method
  async sendEmail(emailData) {
    try {
      if (!this.brevoApiKey || this.brevoApiKey.length < 10)
        throw new Error('Brevo API key is missing or invalid');

      if (!emailData.to || !emailData.to.length)
        throw new Error('No recipients specified');
      for (const recipient of emailData.to) {
        if (!recipient.email || !recipient.email.includes('@'))
          throw new Error(`Invalid email address: ${recipient.email}`);
      }

      const requestBody = {
        sender: {
          name: 'ConsentBit',
          email: 'web@consentbit.com'
        },
        to: emailData.to,
        subject: emailData.subject,
        htmlContent: emailData.htmlContent,
        textContent: emailData.textContent,
        tags: emailData.tags || []
      };

      const response = await fetch(this.brevoApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.brevoApiKey,
          'User-Agent': 'ConsentBit-Server/1.0'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Brevo API error: ${response.status} ${response.statusText} - ${errorData}`);
      }
      const result = await response.json();
      return {
        messageId: result.messageId || 'unknown',
        success: true
      };
    } catch (error) {
      return {
        messageId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // HTML/text generation methods

  getStagingInstallationEmailContent(data) {
    const html = `
      <h3>Hi ${data.recipientName || 'there'},</h3>
      <p>Thank you for installing the <b>ConsentBit</b> app on your Webflow website! We're excited to help you ensure privacy compliance.</p>
      <p>Resources:</p>
      <ul>
        <li><a href="https://www.consentbit.com/help-document">Quick Start Guide</a></li>
        <li><a href="https://vimeo.com/1090979483/99f46cddbf">Video Walkthrough</a></li>
        <li><a href="https://www.consentbit.com/blog">Blog & Newsletter</a></li>
      </ul>
      <p>Support: <a href="mailto:web@consentbit.com">web@consentbit.com</a></p>
      <p>- The ConsentBit Team</p>
    `;
    const text = `Hi ${data.recipientName || 'there'},
Thank you for installing the ConsentBit app on your Webflow website!
Resources:
- Quick Start Guide
- Video Walkthrough
- Blog & Newsletter
Support: web@consentbit.com
- The ConsentBit Team
    `;
    return { html, text };
  }

  getPaidInstallationEmailContent(data) {
    const html = `
      <h3>Hi ${data.recipientName || 'there'},</h3>
      <p>Great news! You installed <b>ConsentBit</b> on your live domain!</p>
      <ul>
        <li>Quick Start Guide</li>
        <li>Video Walkthrough</li>
        <li>Blogs & Newsletter</li>
      </ul>
      <p>Thank you for trusting ConsentBit!</p>
      <p>- The Consentbit Team</p>
    `;
    const text = `Hi ${data.recipientName || 'there'},
Great news! You installed ConsentBit on your live domain!
- Quick Start Guide
- Video Walkthrough
- Blogs & Newsletter
Thank you for trusting ConsentBit!
- The Consentbit Team
    `;
    return { html, text };
  }

  getPaymentSuccessEmailContent() {
    const html = `
      <h1>Thank You for Signing Up with ConsentBit!</h1>
      <p>Thank you for choosing the <b>ConsentBit paid plan</b>!</p>
      <ul>
        <li><a href="https://www.consentbit.com/help-document">Quick Start Guide</a></li>
        <li><a href="https://vimeo.com/1090979483/99f46cddbf">Video Walkthrough</a></li>
        <li><a href="https://www.consentbit.com/blog">Blogs & Newsletter</a></li>
      </ul>
      <p>Support: <a href="mailto:web@consentbit.com">web@consentbit.com</a></p>
      <p>- The ConsentBit Team</p>
    `;
    const text = `Thank You for Signing Up with ConsentBit!
Thank you for choosing the ConsentBit paid plan!
- Quick Start Guide
- Video Walkthrough
- Blogs & Newsletter
Support: web@consentbit.com
- The ConsentBit Team
    `;
    return { html, text };
  }

  // Cloudflare KV storing methods

  async storeStagingInstallationData(data) {
    try {
      if (!this.env.APP_INSTALLATION_DATA) return;
      const installationData = {
        email: data.recipientEmail,
        firstName: data.recipientName,
        siteName: data.siteName || 'Unknown Site',
        siteId: data.siteId || 'unknown',
        customDomain: data.stagingUrl || null,
        installationDate: new Date().toISOString(),
        followupEmailSent: false,
        is2MonthEmailSent: false,
        is6MonthEmailSent: false,
        ifStillStaging: true,
        isInLive: false,
        emailSent: true,
        emailSentDate: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        source: 'cb-server'
      };
      const keyName = `installation:${new Date().toISOString().split('T')[0]}:${data.siteId || 'unknown'}-${Date.now()}`;
      await this.env.APP_INSTALLATION_DATA.put(keyName, JSON.stringify(installationData));
    } catch (error) {}
  }

  async storePaidInstallationData(data) {
    try {
      if (!this.env.APP_INSTALLATION_PAID) return;
      const paidInstallationData = {
        email: data.recipientEmail,
        firstName: data.recipientName,
        siteName: data.siteName || 'Unknown Site',
        siteId: data.siteId || 'unknown',
        customDomain: data.activeDomain || null,
        activeDomain: data.activeDomain || null,
        stagingUrl: data.stagingUrl || null,
        subscriptionDetails: data.subscriptionDetails || {},
        installationDate: new Date().toISOString(),
        paidStatus: 'paid',
        emailSent: true,
        emailSentDate: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        source: 'cb-server'
      };
      const keyName = `paid-installation:${new Date().toISOString().split('T')[0]}:${data.siteId || 'unknown'}-${Date.now()}`;
      await this.env.APP_INSTALLATION_PAID.put(keyName, JSON.stringify(paidInstallationData));
    } catch (error) {}
  }
}

// getEmailService helper
export async function getEmailService(env) {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY environment variable is not configured');
  return new EmailService(env);
}

/*
Usage in Worker entry (es6 module syntax):
export default {
  async fetch(request, env, ctx) {
    // Example usage:
    const emailService = await getEmailService(env);
    // emailService.sendStagingInstallationEmail({ ... })
    // emailService.sendPaidInstallationEmail({ ... })
    // emailService.sendPaymentSuccessEmail({ ... })
    // etc.
    return new Response("OK", { status: 200 });
  }
}
*/

// Be sure to add KV namespace bindings in your wrangler.toml:
// [[kv_namespaces]]
// binding = "APP_INSTALLATION_DATA"
// id = "your-kv-namespace-id1"
// [[kv_namespaces]]
// binding = "APP_INSTALLATION_PAID"
// id = "your-kv-namespace-id2"
// And add BREVO_API_KEY environment variable in your .env or wrangler config.
