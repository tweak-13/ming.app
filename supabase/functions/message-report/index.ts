import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return reply({ error: 'Not authenticated' }, 401);
    const url = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return reply({ error: 'Report service is not configured' }, 503);
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return reply({ error: 'Not authenticated' }, 401);
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload.message_id !== 'string' || typeof payload.reason !== 'string') return reply({ error: 'A message and report reason are required.' }, 400);
    const { data, error } = await userClient.rpc('submit_message_user_report', {
      p_message_id: payload.message_id, p_reason: payload.reason,
      p_details: typeof payload.details === 'string' ? payload.details.slice(0, 1000) : null
    });
    if (error) return reply({ error: error.message || 'Could not submit report.' }, 400);
    const result = Array.isArray(data) ? data[0] : data;
    let suspensionApplied = false;
    if (result?.review_case_created && result?.target_user_id) {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: banError } = await admin.auth.admin.updateUserById(result.target_user_id, { ban_duration: '168h' });
      if (!banError) {
        const { error: caseError } = await admin.from('account_moderation_cases').update({ suspension_applied: true }).eq('target_user_id', result.target_user_id);
        suspensionApplied = !caseError;
        if (caseError) console.error('Could not mark moderation suspension as applied:', caseError.message);
      } else console.error('Could not apply moderation suspension:', banError.message);
    }
    return reply({ success: true, report_count: result?.report_count ?? 0, review_started: !!result?.review_case_created, suspension_applied: suspensionApplied });
  } catch (error) {
    console.error('Message report failed:', error);
    return reply({ error: 'Unexpected report error.' }, 500);
  }
});
