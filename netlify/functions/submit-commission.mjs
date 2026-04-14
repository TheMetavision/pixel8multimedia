import { createClient } from '@sanity/client';
import { Resend } from 'resend';

const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: process.env.SANITY_DATASET || 'production',
  token: process.env.SANITY_WRITE_TOKEN,
  apiVersion: '2026-04-14',
  useCdn: false,
});

const resend = new Resend(process.env.RESEND_API_KEY);

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await req.json();

    if (!data.customerName || !data.customerEmail || !data.serviceType || !data.brief) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const doc = await sanity.create({
      _type: 'commission',
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone || '',
      serviceType: data.serviceType,
      status: 'received',
      brief: data.brief,
      preferredStyle: data.preferredStyle || '',
      preferredFormat: data.preferredFormat || '',
      turnaround: data.turnaround || 'standard',
      budgetRange: data.budgetRange || '',
    });

    // Notify team
    const teamEmail = process.env.TEAM_EMAIL || process.env.EMAIL_FROM || 'hello@pixel8multimedia.co.uk';
    const serviceLabels = {
      'photo-restoration': 'Photo Restoration',
      'stills-to-reels': 'Stills to Reels',
      'bespoke': 'Bespoke Commission',
    };

    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Pixel8 Multimedia <hello@pixel8multimedia.co.uk>',
        to: [teamEmail],
        subject: `NEW COMMISSION — ${serviceLabels[data.serviceType] || data.serviceType} — ${data.customerName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
            <div style="background: #00BCD4; padding: 16px; text-align: center;">
              <h1 style="color: #000; margin: 0; font-size: 22px;">NEW COMMISSION REQUEST</h1>
            </div>
            <div style="padding: 24px;">
              <h2 style="margin: 0 0 4px;">${data.customerName}</h2>
              <p style="color: #666; margin: 0 0 4px;">${data.customerEmail}${data.customerPhone ? ' · ' + data.customerPhone : ''}</p>
              <p style="margin: 16px 0 4px;"><strong>Service:</strong> ${serviceLabels[data.serviceType] || data.serviceType}</p>
              ${data.preferredStyle ? `<p style="margin: 4px 0;"><strong>Style:</strong> ${data.preferredStyle}</p>` : ''}
              ${data.preferredFormat ? `<p style="margin: 4px 0;"><strong>Format:</strong> ${data.preferredFormat}</p>` : ''}
              ${data.turnaround ? `<p style="margin: 4px 0;"><strong>Turnaround:</strong> ${data.turnaround}</p>` : ''}
              ${data.budgetRange ? `<p style="margin: 4px 0;"><strong>Budget:</strong> ${data.budgetRange}</p>` : ''}
              <div style="margin-top: 16px; padding: 16px; background: #f5f5f5; border-radius: 4px;">
                <strong>Brief:</strong><br/>${data.brief}
              </div>
              <div style="margin-top: 20px; padding: 16px; background: #E8F8FF; border-left: 4px solid #00BCD4; border-radius: 4px;">
                <strong>Next steps:</strong><br/>
                1. Review in <a href="https://pixel8multimedia.sanity.studio" style="color: #E91E7B;">Sanity Studio</a><br/>
                2. Send quote to customer within 24hrs<br/>
                3. Update commission status as you progress
              </div>
            </div>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('Failed to send commission notification:', emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Commission received! We'll review your request and get back to you within 24 hours.",
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Commission submission error:', error);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again or email us directly.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const config = {
  path: '/api/submit-commission',
};
