// netlify/functions/analyze-background.js
//
// Background Function (note the "-background" suffix in the filename,
// which is what tells Netlify to run this as a Background Function).
// Background Functions can run for up to 15 minutes, instead of the
// ~26 second hard ceiling on regular synchronous Netlify Functions.
//
// Flow:
//   1. Browser POSTs { jobId, model, max_tokens, system, messages } here.
//   2. This function immediately returns 202 (browser doesn't wait for it).
//   3. In the background, it calls Anthropic and writes the result
//      (or an error) into Netlify Blobs, keyed by jobId.
//   4. The browser polls check-status.js until it sees "done" or "error".

const https = require('https');
const { connectLambda, getStore } = require('@netlify/blobs');

function callAnthropic(apiKey, baseUrl, requestBody) {
  return new Promise((resolve, reject) => {
    const url = new URL('/v1/messages', baseUrl);
    const payload = JSON.stringify(requestBody);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    // Background Functions can run up to 15 minutes; 110s is generous
    // headroom for a single Claude report-generation call.
    req.setTimeout(110000, () => {
      req.destroy();
      reject(new Error('Timeout after 110s'));
    });
    req.write(payload);
    req.end();
  });
}

exports.handler = async function (event) {
  connectLambda(event);
  const store = getStore({ name: 'vlgmf-jobs', consistency: 'strong' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    // Can't even report this to the client since we've already returned 202
    // by the time this would matter — nothing to do but exit.
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, body: 'Missing jobId' };
  }

  // Mark the job as pending right away so polling doesn't 404.
  await store.setJSON(jobId, { status: 'pending' });

  const apiKey =
    process.env.NETLIFY_AI_GATEWAY_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_KEY_PLAIN;
  const baseUrl =
    process.env.NETLIFY_AI_GATEWAY_BASE_URL ||
    process.env.ANTHROPIC_BASE_URL ||
    'https://api.anthropic.com';

  if (!apiKey) {
    await store.setJSON(jobId, {
      status: 'error',
      error: 'Server misconfiguration: no API key found in Netlify environment variables.',
    });
    return { statusCode: 200, body: 'no key' };
  }

  try {
    const requestBody = {
      model: body.model,
      max_tokens: body.max_tokens,
      system: body.system,
      messages: body.messages,
    };
    const result = await callAnthropic(apiKey, baseUrl, requestBody);
    await store.setJSON(jobId, { status: 'done', rawText: result.body });
  } catch (err) {
    await store.setJSON(jobId, {
      status: 'error',
      error: err.message || 'Unknown error calling Anthropic API',
    });
  }

  // Background Functions' return value isn't sent anywhere meaningful —
  // the browser already got its 202 from Netlify the moment this was invoked.
  return { statusCode: 200, body: 'ok' };
};
