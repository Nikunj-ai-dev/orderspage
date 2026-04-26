const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Serverless Function: Send OTP via Email (Brevo)
 * POST /api/send-otp
 * Body: { email, orderId, recaptchaToken }
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { email, orderId, recaptchaToken } = body;

  if (!email || !orderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email or orderId' }) };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporarily unavailable' }) };
  }

  try {
    // 1. Verify reCAPTCHA (if configured)
    if (process.env.RECAPTCHA_SECRET_KEY && recaptchaToken) {
      try {
        const captchaRes = await axios.post(
          'https://www.google.com/recaptcha/api/siteverify',
          null,
          { params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: recaptchaToken }, timeout: 5000 }
        );
        if (!captchaRes.data.success) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'reCAPTCHA verification failed' }) };
        }
        if (captchaRes.data.score !== undefined && captchaRes.data.score < 0.5) {
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'Suspicious activity detected' }) };
        }
      } catch (captchaErr) {
        console.error('reCAPTCHA error:', captchaErr.message);
        // Non-fatal: allow through if reCAPTCHA service is down
      }
    }

    // 2. Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60000);

    // 3. Store OTP in Supabase
    const { error: insertError } = await Promise.race([
      supabase.from('otp_codes').insert({
        email,
        order_id: orderId,
        code: otp,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 10000)),
    ]);

    if (insertError) {
      console.error('OTP insert error:', insertError.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to generate OTP' }) };
    }

    // 4. Send email via Brevo
    if (!process.env.BREVO_API_KEY) {
      console.warn('Brevo API key not configured — OTP stored but email not sent');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'OTP generated (email delivery not configured)' }),
      };
    }

    if (!process.env.BREVO_SENDER_EMAIL) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email service misconfigured' }) };
    }

    const senderName = process.env.BREVO_SENDER_NAME || 'Breakfastclub Orders';

    const brevoRes = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        to: [{ email, name: 'Customer' }],
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: senderName },
        subject: 'Your OTP for Order Verification — Breakfastclub',
        htmlContent: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OTP</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.07);overflow:hidden;max-width:580px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%);padding:32px 40px;text-align:center;">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Breakfastclub</span>
          <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px;">Order Verification</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;text-align:center;">Your Verification Code</h2>
          <p style="margin:0 0 28px;color:#64748b;font-size:14px;text-align:center;">Enter this code to access your order details. It expires in 5 minutes.</p>
          <div style="background:#f0f9ff;border:2px dashed #bae6fd;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
            <span style="font-size:44px;font-weight:800;letter-spacing:12px;color:#1d4ed8;font-variant-numeric:tabular-nums;">${otp}</span>
          </div>
          <div style="background:#fef2f2;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
            <p style="margin:0;font-size:13px;color:#b91c1c;font-weight:600;">🔒 Never share this code with anyone. Breakfastclub will never ask for it.</p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">If you didn't request this, please ignore this email.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} Breakfastclub. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
        textContent: `Your Breakfastclub Order Verification Code: ${otp}\n\nThis code expires in 5 minutes.\n\nNever share this code with anyone.`,
        replyTo: { email: process.env.BREVO_SENDER_EMAIL, name: senderName },
      },
      {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        timeout: 8000,
      }
    );

    if (!brevoRes.data?.messageId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email delivery failed' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'OTP sent to your email', messageId: brevoRes.data.messageId }),
    };

  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.error('send-otp error:', msg);

    if (status === 400) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
    if (status === 401) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Email service authentication failed' }) };
    if (err.code === 'ECONNABORTED' || msg.includes('timeout')) {
      return { statusCode: 504, headers, body: JSON.stringify({ error: 'Request timeout. Please try again.' }) };
    }

    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Failed to send OTP' }) };
  }
};
