// Netlify Function using Netlify AI Gateway
// Uses NETLIFY_AI_GATEWAY_KEY and NETLIFY_AI_GATEWAY_BASE_URL
// which are ALWAYS injected by Netlify into supported runtimes

const https = require('https');

exports.handler = async function(event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Diagnostic GET - shows all injected vars
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasAnthropicBaseUrl: !!process.env.ANTHROPIC_BASE_URL,
        hasGatewayKey: !!process.env.NETLIFY_AI_GATEWAY_KEY,
        hasGatewayBaseUrl: !!process.env.NETLIFY_AI_GATEWAY_BASE_URL,
        gatewayBaseUrl: process.env.NETLIFY_AI_GATEWAY_BASE_URL || 'not set',
        node: process.version
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  // Use Gateway credentials (always injected) with fallback to ANTHROPIC_API_KEY
  const apiKey  = process.env.NETLIFY_AI_GATEWAY_KEY || process.env.ANTHROPIC_API_KEY;
  const baseUrl = process.env.NETLIFY_AI_GATEWAY_BASE_URL || 
                  process.env.ANTHROPIC_BASE_URL || 
                  'https://api.anthropic.com';

  if (!apiKey) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'No credentials available from AI Gateway or environment' })
    };
  }

  try {
    const requestBody = JSON.parse(event.body || '{}');
    const url = new URL('/v1/messages', baseUrl);
    const payload = JSON.stringify(requestBody);

    const responseData = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + (url.search || ''),
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
      req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout after 25s')); });
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
