const https = require('https');

exports.handler = async function(event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Diagnostic: report what the Gateway is injecting
  const apiKey   = process.env.ANTHROPIC_API_KEY;
  const baseUrl  = process.env.ANTHROPIC_BASE_URL;
  const gwKey    = process.env.NETLIFY_AI_GATEWAY_KEY;
  const gwUrl    = process.env.NETLIFY_AI_GATEWAY_BASE_URL;

  // If GET request, return diagnostic info so we can see what's injected
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        hasAnthropicKey: !!apiKey,
        hasAnthropicBaseUrl: !!baseUrl,
        anthropicBaseUrl: baseUrl || 'not set',
        hasGatewayKey: !!gwKey,
        hasGatewayUrl: !!gwUrl,
        gatewayUrl: gwUrl || 'not set',
        nodeVersion: process.version
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  if (!apiKey) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'ANTHROPIC_API_KEY not injected by AI Gateway',
        hasGatewayKey: !!gwKey,
        hasGatewayUrl: !!gwUrl,
        tip: 'AI Gateway may not be active for this function'
      })
    };
  }

  try {
    const requestBody = JSON.parse(event.body || '{}');
    const url = new URL('/v1/messages', baseUrl || 'https://api.anthropic.com');

    const responseData = await new Promise((resolve, reject) => {
      const payload = JSON.stringify(requestBody);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timed out after 25s')); });
      req.write(payload);
      req.end();
    });

    return {
      statusCode: responseData.status,
      headers: corsHeaders,
      body: responseData.body
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
