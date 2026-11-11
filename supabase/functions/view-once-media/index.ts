// Supabase Edge Function: view-once-media
// Claims the message for either participant, streams it once, then removes the
// stored original. No signed URL is ever created or returned.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-View-Once-Claimed, X-View-Once-At'
};

function jsonError(message: string, status: number, claimed = false) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      'Pragma': 'no-cache',
      ...(claimed ? { 'X-View-Once-Claimed': 'true' } : {})
    }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  let claimed = false;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Not authenticated', 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return jsonError('View-once media service is not configured', 503);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonError('Not authenticated', 401);

    const body = await req.json().catch(() => null);
    if (!body?.message_id || typeof body.message_id !== 'string') {
      return jsonError('message_id is required', 400);
    }

    // Atomic compare-and-set: either participant can win exactly once.
    const { data: rows, error: claimError } = await userClient.rpc(
      'ming_claim_view_once_media',
      { p_message_id: body.message_id }
    );
    if (claimError || !rows?.length || !rows[0]?.object_path) {
      return jsonError(claimError?.message || 'This media has already been opened or is unavailable', 410);
    }
    claimed = true;

    const item = rows[0];
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: file, error: downloadError } = await admin.storage
      .from(item.bucket_id)
      .download(item.object_path);

    if (downloadError || !file) {
      return jsonError('The one-time media was claimed but could not be loaded. It remains opened.', 503, true);
    }

    // The response body is already in memory. Delete the stored source so
    // neither participant can retrieve it later, even after the message row
    // is removed. The private consumed-object ledger also blocks Storage reads.
    const { error: removeError } = await admin.storage
      .from(item.bucket_id)
      .remove([item.object_path]);
    if (removeError) {
      console.warn('Tweaklr view-once source cleanup failed:', removeError.message);
    }

    const headers = new Headers({
      ...corsHeaders,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Content-Type-Options': 'nosniff',
      'X-View-Once-Claimed': 'true',
      'X-View-Once-At': rows[0].claimed_at || new Date().toISOString()
    });

    return new Response(file.stream(), { status: 200, headers });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Unexpected view-once error',
      500,
      claimed
    );
  }
});
