// Supabase Edge Function: view-once-media
// Deploy with: supabase functions deploy view-once-media
// Requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return Response.json({ error: 'Not authenticated' }, { status: 401, headers: corsHeaders });
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers: corsHeaders });

    const body = await req.json();
    if (!body?.message_id) return Response.json({ error: 'message_id is required' }, { status: 400, headers: corsHeaders });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: claimed, error: claimError } = await admin.rpc('ming_claim_view_once_media', { p_message_id: body.message_id });
    if (claimError || !claimed?.length || !claimed[0].object_path) {
      return Response.json({ error: claimError?.message || 'Media has already been opened or is unavailable' }, { status: 410, headers: corsHeaders });
    }

    const item = claimed[0];
    const { data: signed, error: signError } = await admin.storage.from(item.bucket_id).createSignedUrl(item.object_path, 30);
    if (signError || !signed?.signedUrl) {
      return Response.json({ error: 'Could not prepare one-time media' }, { status: 410, headers: corsHeaders });
    }
    return Response.json(
      { signed_url: signed.signedUrl, viewed_at: item.claimed_at, media_kind: item.media_kind },
      { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json({ error: error?.message || 'Unexpected error' }, { status: 500, headers: corsHeaders });
  }
});
