// supabase/functions/stripe-webhook/index.ts
import "edge-runtime";
import Stripe from "stripe";
import { createClient, type PostgrestError } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars for stripe-webhook");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Match your Stripe SDK typings (same fix as Next.js)
  apiVersion: "2025-02-24.acacia",
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUserIdFromMetadata(obj: { metadata?: Record<string, string> | null }): string | null {
  const v = obj?.metadata?.user_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

async function getPlanByPriceId(priceId: string | null) {
  if (!priceId) return null;

  const { data, error } = await supabase
    .from("plans")
    .select("id, monthly_tokens")
    .eq("stripe_price_id", priceId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const bodyText = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return json(400, { error: "Missing stripe-signature header" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(bodyText, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Stripe signature verification failed:", err);
    return json(400, { error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = getUserIdFromMetadata(session);
        if (!userId) {
          console.warn("checkout.session.completed missing metadata.user_id");
          break;
        }

        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: "incomplete",
        });

        if (error) throw error;
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const userId = getUserIdFromMetadata(sub);
        if (!userId) {
          console.warn(`${event.type} missing subscription.metadata.user_id`);
          break;
        }

        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        const plan = await getPlanByPriceId(priceId);

        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          status: sub.status ?? "inactive",
          plan_id: plan?.id ?? null,
          current_period_end: unixToIso(sub.current_period_end),
        });

        if (error) throw error;
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        if (!subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        const userId = getUserIdFromMetadata(sub);
        if (!userId) {
          console.warn(`${event.type}: subscription missing metadata.user_id`);
          break;
        }

        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        const plan = await getPlanByPriceId(priceId);
        if (!plan) {
          console.warn(`${event.type}: no plan found for price:`, priceId);
          break;
        }

        const { error: ledgerErr } = await supabase.from("token_ledger").insert({
          user_id: userId,
          delta: plan.monthly_tokens,
          kind: "monthly_grant",
          external_id: invoice.id,
          reason: `Monthly tokens for plan ${plan.id}`,
        });

        // Ignore duplicates caused by webhook retries (idempotency index)
        if (ledgerErr) {
          const msg = (ledgerErr as PostgrestError).message.toLowerCase();
          const isDup = msg.includes("duplicate") || msg.includes("unique");
          if (!isDup) throw ledgerErr;
        }

        const { error: subErr } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          status: sub.status ?? "active",
          plan_id: plan.id,
          current_period_end: unixToIso(sub.current_period_end),
        });

        if (subErr) throw subErr;
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        if (!subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        const userId = getUserIdFromMetadata(sub);
        if (!userId) break;

        const { error } = await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("user_id", userId);

        if (error) throw error;
        break;
      }

      default:
        break;
    }

    return json(200, { received: true });
  } catch (err) {
    console.error("❌ stripe-webhook handler error:", err);
    return json(500, { error: "Webhook handler failed" });
  }
});
