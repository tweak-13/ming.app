import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@ming.app";

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

const admin = createClient(supabaseUrl, serviceRoleKey);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const recipientId = String(body.recipientId || "");
    const callId = String(body.callId || "");
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(recipientId) || !uuidPattern.test(callId) || recipientId === user.id) {
      return new Response(JSON.stringify({ error: "Invalid call invitation" }), {
        status: 400,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const now = new Date();
    const { data: invite, error: inviteError } = await admin
      .from("ming_call_invites")
      .select("call_id, caller_id, recipient_id, kind, status, expires_at, push_sent_at")
      .eq("call_id", callId)
      .eq("caller_id", user.id)
      .eq("recipient_id", recipientId)
      .maybeSingle();

    if (inviteError || !invite || invite.status !== "pending" || Date.parse(invite.expires_at) <= now.getTime()) {
      return new Response(JSON.stringify({ error: "Call invitation is unavailable or expired" }), {
        status: 410,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }
    if (invite.push_sent_at) {
      return new Response(JSON.stringify({ ok: true, sent: 0, duplicate: true }), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const { count: recentCalls, error: rateError } = await admin
      .from("ming_call_invites")
      .select("id", { count: "exact", head: true })
      .eq("caller_id", user.id)
      .gte("created_at", new Date(now.getTime() - 60_000).toISOString());
    if (rateError) throw rateError;
    if ((recentCalls || 0) > 5) {
      return new Response(JSON.stringify({ error: "Too many call attempts. Please wait a moment." }), {
        status: 429,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const { data: connection } = await admin
      .from("connections")
      .select("id")
      .eq("status", "accepted")
      .or(
        "and(requester_id.eq." + user.id + ",recipient_id.eq." + recipientId + ")," +
        "and(requester_id.eq." + recipientId + ",recipient_id.eq." + user.id + ")"
      )
      .maybeSingle();

    if (!connection) {
      return new Response(JSON.stringify({ error: "Users are not connected" }), {
        status: 403,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    // Atomic one-push claim prevents duplicate notifications if a client
    // retries the same request or invokes the function repeatedly.
    const { data: claimed, error: claimError } = await admin
      .from("ming_call_invites")
      .update({ push_sent_at: now.toISOString() })
      .eq("call_id", callId)
      .eq("caller_id", user.id)
      .eq("recipient_id", recipientId)
      .eq("status", "pending")
      .is("push_sent_at", null)
      .gt("expires_at", now.toISOString())
      .select("call_id")
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claimed) {
      return new Response(JSON.stringify({ ok: true, sent: 0, duplicate: true }), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
      });
    }

    const { data: callerProfile } = await admin
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .maybeSingle();
    const callerName = String(callerProfile?.display_name || callerProfile?.username || "Someone").slice(0, 80);
    const kind = invite.kind === "video" ? "video" : "voice";

    const { data: subscriptions, error: subError } = await admin
      .from("ming_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", recipientId);

    if (subError) throw subError;

    const payload = JSON.stringify({
      type: "ming-call",
      callId,
      kind,
      callerName
    });

    const results = await Promise.all((subscriptions || []).map(async sub => {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload, { TTL: 90 });
        return { ok: true };
      } catch (error) {
        const status = error?.statusCode;
        if (status === 404 || status === 410) {
          await admin.from("ming_push_subscriptions").delete().eq("id", sub.id);
        }
        return { ok: false, status };
      }
    }));

    return new Response(JSON.stringify({
      ok: true,
      sent: results.filter(r => r.ok).length,
      subscriptions: results.length
    }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("send-call-push failed", error);
    return new Response(JSON.stringify({ error: "Push delivery failed" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
  }
});
