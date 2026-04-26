/**
 * Netlify Serverless Function: Configuration Endpoint
 * GET /api/config
 * Returns public (non-secret) env vars needed by the frontend.
 */

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, s-maxage=3600',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Netlify exposes the site URL via process.env.URL in production
  const apiBase = process.env.URL || process.env.API_BASE || '';

  const config = {
    SUPABASE_URL:        process.env.SUPABASE_URL       || '',
    SUPABASE_ANON_KEY:   process.env.SUPABASE_ANON_KEY  || '',
    RAZORPAY_KEY_ID:     process.env.RAZORPAY_KEY_ID    || '',
    RECAPTCHA_SITE_KEY:  process.env.RECAPTCHA_SITE_KEY || '',
    API_BASE:            apiBase,
    version:             '1.0.0',
    environment:         process.env.NODE_ENV || 'production',
    timestamp:           new Date().toISOString(),
  };

  return { statusCode: 200, headers, body: JSON.stringify(config) };
};
