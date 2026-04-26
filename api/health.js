/**
 * Netlify Serverless Function: Health Check
 * GET /api/health
 */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      status: 'ok',
      service: 'Breakfastclub Orders API',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: process.uptime(),
    }),
  };
};
