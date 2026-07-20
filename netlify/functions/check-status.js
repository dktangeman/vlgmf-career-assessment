// netlify/functions/check-status.js
//
// Fast, synchronous function the browser polls every ~2.5s to check on
// a background analysis job. Reads the job's current state from Netlify
// Blobs (written by analyze-background.js) and returns it as JSON.

const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  connectLambda(event);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const jobId = (event.queryStringParameters || {}).id;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'error', error: 'Missing job id' }),
    };
  }

  const store = getStore({ name: 'vlgmf-jobs' });

  try {
    const job = await store.get(jobId, { type: 'json' });
    if (!job) {
      // Job hasn't been written yet (rare race right after kickoff) — treat as pending
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: 'pending' }),
      };
    }
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(job),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'pending' }),
    };
  }
};
