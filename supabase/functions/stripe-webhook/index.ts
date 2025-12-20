// supabase/functions/stripe-webhook/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe";
import { createClient } from "npm:@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required env vars for stripe-webhook");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Safely parse metadata.user_id from Stripe objects */
function getUserIdFromMetadata(obj: { metadata?: Record<string, string> | null }): string | null {
  const v = obj?.metadata?.user_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Convert Stripe unix seconds to ISO string */
function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Stripe signature verification requires RAW body
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
      /**
       * 1) Checkout completion
       * - Link Stripe customer/subscription IDs to the Supabase user via session.metadata.user_id
       * - Do NOT grant monthly tokens here (we grant on invoice.paid to avoid doubles)
       */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = getUserIdFromMetadata(session);
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        if (!userId) {
          console.warn("checkout.session.completed missing metadata.user_id");
          break;
        }

        // Upsert minimal subscription linkage (status will be refined by subscription/invoice events)
        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: "incomplete", // temporary; will become active on invoice.paid
        });

        if (error) throw error;
        break;
      }

      /**
       * 2) Subscription lifecycle sync
       * - Keep subscriptions table up to date with status/plan/current_period_end
       * - user_id comes from subscription.metadata.user_id (must be set when subscription created)
       */
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

        // Map stripe price -> plan_id (optional but recommended)
        let planId: string | null = null;
        if (priceId) {
          const { data: plan, error: planErr } = await supabase
            .from("plans")
            .select("id")
            .eq("stripe_price_id", priceId)
            .maybeSingle();
          if (planErr) throw planErr;
          planId = plan?.id ?? null;
        }

        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          status: sub.status ?? "inactive",
          plan_id: planId,
          current_period_end: unixToIso(sub.current_period_end),
        });

        if (error) throw error;
        break;
      }

      /**
       * 3) Money succeeded: invoice paid
       * - This is the canonical trigger to GRANT monthly tokens
       * - Idempotent via token_ledger unique index (user_id, kind, external_id)
       */
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        if (!subscriptionId) {
          // Non-subscription invoice; ignore for now (unless you later do top-ups via invoices)
          break;
        }

        // Retrieve subscription to get metadata.user_id + price id
        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        const userId = getUserIdFromMetadata(sub);
        if (!userId) {
          console.warn("invoice.paid: subscription missing metadata.user_id");
          break;
        }

        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        // Determine plan + monthly_tokens from your plans table
        if (!priceId) {
          console.warn("invoice.paid: missing price id on subscription items");
          break;
        }

        const { data: plan, error: planErr } = await supabase
          .from("plans")
          .select("id, monthly_tokens")
          .eq("stripe_price_id", priceId)
          .maybeSingle();

        if (planErr) throw planErr;
        if (!plan) {
          console.warn("invoice.paid: no plan found for price:", priceId);
          break;
        }

        // 1) Grant tokens (idempotent)
        const { error: ledgerErr } = await supabase.from("token_ledger").insert({
          user_id: userId,
          delta: plan.monthly_tokens,
          kind: "monthly_grant",
          external_id: invoice.id, // idempotency key
          reason: `Monthly tokens for plan ${plan.id}`,
        });

        // If duplicate insert (Stripe retry), we ignore.
        if (ledgerErr && !String(ledgerErr.message).toLowerCase().includes("duplicate")) {
          throw ledgerErr;
        }

        // 2) Upsert subscription status + plan + period end
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

      /**
       * 4) Payment failed: mark past_due
       * - No token grants
       */
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
        // Ignore everything else for now
        break;
    }

    return json(200, { received: true });
  } catch (err) {
    console.error("❌ stripe-webhook handler error:", err);
    return json(500, { error: "Webhook handler failed" });
  }
});
