const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

/**
 * Netlify Serverless Function: Verify OTP and Create Session
 * POST /api/verify-otp
 * Body: { email, otp, orderId }
 * Returns: { success, customerId, customerName, email, sessionToken, expiresIn }
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function generateSessionToken(email, customerId) {
  if (!process.env.SESSION_SECRET) {
    return Buffer.from(`${email}:${customerId}:${Date.now()}`).toString('base64');
  }
  const timestamp = Date.now();
  const payload = `${email}|${customerId}|${timestamp}`;
  const hash = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
  return `${payload}|${hash}`;
}

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

  const { email, otp, orderId } = body;

  if (!email || !otp) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email or OTP' }) };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email format' }) };
  }

  if (!/^\d{6}$/.test(otp)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid OTP format' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporarily unavailable' }) };
  }

  try {
    // 1. Look up OTP
    const { data: otpData, error: otpError } = await Promise.race([
      supabase
        .from('otp_codes')
        .select('*')
        .eq('email', email)
        .eq('code', otp)
        .gt('expires_at', new Date().toISOString())
        .is('used_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 10000)),
    ]);

    if (otpError || !otpData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid or expired OTP. Please request a new one.' }),
      };
    }

    // 2. Mark OTP as used
    try {
      await Promise.race([
        supabase.from('otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otpData.id),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Update timeout')), 5000)),
      ]);
    } catch (updateErr) {
      console.warn('Failed to mark OTP as used:', updateErr.message);
    }

    // 3. Look up customer by email
    let customerId = `CUST_${email.split('@')[0].replace(/\W/g, '').slice(0, 12)}_${Date.now().toString(36)}`;
    let customerName = 'Customer';

    try {
      const { data: custRows } = await Promise.race([
        supabase.from('customers').select('id, name').eq('email', email).limit(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
      ]);
      if (custRows && custRows.length > 0) {
        customerId = custRows[0].id;
        customerName = custRows[0].name || 'Customer';
      }
    } catch (e) {
      console.log('Customer lookup skipped:', e.message.slice(0, 60));
    }

    // 4. Generate session token
    const sessionToken = generateSessionToken(email, customerId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customerId,
        customerName,
        email,
        sessionToken,
        expiresIn: 86400 * 30, // 30 days
      }),
    };
  } catch (err) {
    console.error('verify-otp error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message || 'Failed to verify OTP' }),
    };
  }
};
