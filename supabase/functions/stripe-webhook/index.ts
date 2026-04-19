// supabase/functions/stripe-webhook/index.ts
import Stripe from "stripe";
import { createClient, type PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (
  !STRIPE_SECRET_KEY ||
  !STRIPE_WEBHOOK_SECRET ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error("Missing required env vars for stripe-webhook");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Match your Stripe SDK typings (same fix as Next.js)
  apiVersion: "2025-02-24.acacia",
});

type AnySupabaseClient = SupabaseClient<any, "public", any>;

const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type WalletRow = {
  user_id: string;
  balance_tokens: number;
  lifetime_granted_tokens: number;
  lifetime_spent_tokens: number;
  monthly_granted_tokens: number;
  monthly_spent_tokens: number;
  current_period_start: string | null;
  current_period_end: string | null;
  updated_at: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getUserIdFromMetadata(obj: {
  metadata?: Record<string, string> | null;
}): string | null {
  const v = obj?.metadata?.user_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function unixToIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

function getMonthPeriodBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isWalletPeriodExpired(wallet: WalletRow, now = new Date()) {
  const periodEnd = wallet.current_period_end;
  if (!periodEnd) return true;
  const periodEndMs = Date.parse(periodEnd);
  if (!Number.isFinite(periodEndMs)) return true;
  return periodEndMs <= now.getTime();
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

async function getTopupByPriceId(priceId: string | null) {
  if (!priceId) return null;

  const { data, error } = await supabase
    .from("token_topups")
    .select("tokens, is_active")
    .eq("stripe_price_id", priceId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data ?? null; // { tokens, is_active }
}

/**
 * Resolve the Supabase user_id for a paid invoice.
 *
 * Primary (most reliable): match by stripe_customer_id in public.subscriptions
 * Fallback: subscription.metadata.user_id (if present)
 */
async function resolveUserIdForInvoice(
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id ?? null;

  if (customerId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (error) throw error;
    if (data?.user_id) return data.user_id as string;
  }

  // Fallback to subscription metadata (nice to have, not required)
  return getUserIdFromMetadata(subscription);
}

function isDuplicateInsert(err: unknown): boolean {
  const msg =
    (err as PostgrestError | undefined)?.message?.toLowerCase?.() ?? "";
  return msg.includes("duplicate") || msg.includes("unique");
}

async function getExistingWallet(userId: string): Promise<WalletRow | null> {
  const { data, error } = await supabase
    .from("user_token_wallets")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as WalletRow | null) ?? null;
}

async function rollWalletPeriodIfExpired(userId: string, wallet: WalletRow): Promise<WalletRow> {
  if (!isWalletPeriodExpired(wallet)) return wallet;
  const { startIso, endIso } = getMonthPeriodBounds();
  const { data, error } = await supabase
    .from("user_token_wallets")
    .update({
      current_period_start: startIso,
      current_period_end: endIso,
      monthly_granted_tokens: 0,
      monthly_spent_tokens: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("updated_at", wallet.updated_at)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) return data as WalletRow;
  const raced = await getExistingWallet(userId);
  if (raced) return raced;
  throw new Error("Token wallet changed during period rollover.");
}

async function ensureWallet(userId: string): Promise<WalletRow> {
  const existing = await getExistingWallet(userId);
  if (existing) return rollWalletPeriodIfExpired(userId, existing);

  const { startIso, endIso } = getMonthPeriodBounds();
  const { data, error } = await supabase
    .from("user_token_wallets")
    .insert({
      user_id: userId,
      balance_tokens: 0,
      lifetime_granted_tokens: 0,
      lifetime_spent_tokens: 0,
      monthly_granted_tokens: 0,
      monthly_spent_tokens: 0,
      current_period_start: startIso,
      current_period_end: endIso,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (isDuplicateInsert(error)) {
      const raced = await getExistingWallet(userId);
      if (raced) return rollWalletPeriodIfExpired(userId, raced);
    }
    throw error ?? new Error("Failed to create token wallet.");
  }

  return data as WalletRow;
}

async function hasGrantLedgerEntry(args: {
  userId: string;
  actionType: "topup" | "subscription";
  referenceId: string;
}) {
  const { data, error } = await supabase
    .from("token_ledger")
    .select("id")
    .eq("user_id", args.userId)
    .eq("event_type", "grant")
    .eq("action_type", args.actionType)
    .contains("metadata", { reference_id: args.referenceId })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function grantTokensCanonical(args: {
  userId: string;
  grantAmount: number;
  actionType: "topup" | "subscription";
  referenceId: string;
  modelVersion?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isFinite(args.grantAmount) || Math.trunc(args.grantAmount) <= 0) {
    throw new Error("grantAmount must be > 0.");
  }
  const grantAmount = Math.trunc(args.grantAmount);

  const existingGrant = await hasGrantLedgerEntry({
    userId: args.userId,
    actionType: args.actionType,
    referenceId: args.referenceId,
  });
  if (existingGrant) {
    return { skipped: true as const };
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const walletBefore = await ensureWallet(args.userId);
    const { data: walletUpdated, error: walletErr } = await supabase
      .from("user_token_wallets")
      .update({
        balance_tokens: walletBefore.balance_tokens + grantAmount,
        lifetime_granted_tokens: walletBefore.lifetime_granted_tokens + grantAmount,
        monthly_granted_tokens: walletBefore.monthly_granted_tokens + grantAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", args.userId)
      .eq("updated_at", walletBefore.updated_at)
      .select("*")
      .maybeSingle();

    if (walletErr) throw walletErr;
    if (!walletUpdated) continue;

    const walletAfter = walletUpdated as WalletRow;
    const metadata = {
      ...(args.metadata ?? {}),
      reference_id: args.referenceId,
    };
    const { error: ledgerErr } = await supabase.from("token_ledger").insert({
      user_id: args.userId,
      event_type: "grant",
      action_type: args.actionType,
      model_version: args.modelVersion ?? null,
      tokens_delta: grantAmount,
      balance_after: walletAfter.balance_tokens,
      metadata,
    });

    if (!ledgerErr) return { skipped: false as const };
    if (isDuplicateInsert(ledgerErr)) return { skipped: true as const };

    const { error: rollbackErr } = await supabase
      .from("user_token_wallets")
      .update({
        balance_tokens: walletBefore.balance_tokens,
        lifetime_granted_tokens: walletBefore.lifetime_granted_tokens,
        monthly_granted_tokens: walletBefore.monthly_granted_tokens,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", args.userId)
      .eq("updated_at", walletAfter.updated_at);
    if (rollbackErr) {
      throw new Error(
        `Token grant ledger insert failed and rollback failed: ${ledgerErr.message}; rollback: ${rollbackErr.message}`,
      );
    }
    throw ledgerErr;
  }

  throw new Error("Token wallet changed repeatedly while granting tokens.");
}

function safeErr(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { err };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Stripe signature verification requires RAW body
  const bodyText = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return json(400, { error: "Missing stripe-signature header" });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      bodyText,
      sig,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("❌ Stripe signature verification failed:", {
      requestId,
      ...safeErr(err),
    });
    return json(400, { error: "Invalid signature" });
  }

  console.log("✅ EVENT", {
    requestId,
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
  });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = getUserIdFromMetadata(session);
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        console.log("🛒 CHECKOUT.SESSION.COMPLETED", {
          requestId,
          eventId: event.id,
          sessionId: session.id,
          userId,
          customerId,
          subscriptionId,
          mode: session.mode,
        });

        if (!userId) {
          console.warn(
            "⚠️ checkout.session.completed missing metadata.user_id",
            { requestId, sessionId: session.id },
          );
          break;
        }

        /**
         * ✅ TOP-UP FLOW (mode = payment)
         * We grant tokens immediately on successful one-time payment.
         */
        if (session.mode === "payment") {
          // Retrieve expanded session so we can read the Stripe price id
          const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ["line_items.data.price"],
          });

          const line = fullSession.line_items?.data?.[0];
          const priceId =
            typeof line?.price === "string"
              ? line.price
              : (line?.price as Stripe.Price | undefined)?.id ?? null;

          console.log("🔁 TOPUP SESSION", {
            requestId,
            sessionId: session.id,
            userId,
            priceId,
          });

          if (!priceId) {
            console.error("❌ topup: missing priceId on checkout session line item", {
              requestId,
              sessionId: session.id,
            });
            break;
          }

          const topup = await getTopupByPriceId(priceId);

          console.log("🧩 TOPUP LOOKUP", { requestId, priceId, topup });

          if (!topup) {
            console.error("❌ topup: unknown/inactive priceId", {
              requestId,
              priceId,
              sessionId: session.id,
            });
            break;
          }

          const grantResult = await grantTokensCanonical({
            userId,
            grantAmount: topup.tokens,
            actionType: "topup",
            referenceId: session.id,
            modelVersion: null,
            metadata: {
              source: "stripe_checkout_session_completed",
              stripe_event_id: event.id,
              stripe_session_id: session.id,
              stripe_price_id: priceId,
              note: `Stripe top-up (${topup.tokens} tokens)`,
            },
          });

          console.log("✅ TOPUP GRANTED", {
            requestId,
            userId,
            tokens: topup.tokens,
            sessionId: session.id,
            skipped: grantResult.skipped,
          });

          // No subscription upsert required for topups
          break;
        }

        /**
         * ✅ SUBSCRIPTION FLOW (mode = subscription)
         * Keep existing behavior.
         */
        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: "incomplete",
        });

        if (error) {
          console.error(
            "❌ DB upsert subscriptions (checkout.session.completed) failed",
            { requestId, error },
          );
          throw error;
        }

        console.log("✅ DB upsert subscriptions (checkout.session.completed) OK", {
          requestId,
          userId,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        const userId = getUserIdFromMetadata(sub);
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        console.log("📦 SUBSCRIPTION.EVENT", {
          requestId,
          eventType: event.type,
          subId: sub.id,
          userId,
          customerId,
          status: sub.status,
          priceId,
          currentPeriodEnd: sub.current_period_end,
        });

        if (!userId) {
          console.warn(`⚠️ ${event.type} missing subscription.metadata.user_id`, {
            requestId,
            subId: sub.id,
          });
          break;
        }

        const plan = await getPlanByPriceId(priceId);
        console.log("🧩 PLAN LOOKUP (subscription)", { requestId, priceId, plan });

        const { error } = await supabase.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          status: sub.status ?? "inactive",
          plan_id: plan?.id ?? null,
          current_period_end: unixToIso(sub.current_period_end),
        });

        if (error) {
          console.error("❌ DB upsert subscriptions (subscription event) failed", {
            requestId,
            error,
          });
          throw error;
        }

        console.log("✅ DB upsert subscriptions (subscription event) OK", {
          requestId,
          userId,
        });
        break;
      }

      /**
       * GUARDRAIL (VERY IMPORTANT):
       * Do NOT rely on `invoice.subscription` being present in invoice events.
       * Stripe can deliver `invoice.paid` with `subscriptionId: null` depending on invoice context.
       *
       * ✅ Always resolve the subscription via `stripe_customer_id` -> public.subscriptions,
       * and fall back to the stored `stripe_subscription_id`.
       *
       * This makes token grants + status updates robust to webhook retries and payload shape differences.
       */
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;

        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;

        let subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        console.log("🧾 INVOICE.EVENT", {
          requestId,
          eventType: event.type,
          invoiceId: invoice.id,
          customerId,
          subscriptionId,
        });

        if (!customerId) {
          console.warn("⚠️ invoice event missing customer id; skipping", {
            requestId,
            invoiceId: invoice.id,
          });
          break;
        }

        // ✅ 1) Find the user + stored subscription by customerId
        const { data: row, error: lookupErr } = await supabase
          .from("subscriptions")
          .select("user_id, stripe_subscription_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (lookupErr) throw lookupErr;

        if (!row?.user_id) {
          console.warn("⚠️ invoice event: no subscriptions row for customer; skipping", {
            requestId,
            customerId,
            invoiceId: invoice.id,
          });
          break;
        }

        // ✅ If Stripe didn't include subscription on invoice, fall back to DB
        if (!subscriptionId) subscriptionId = row.stripe_subscription_id ?? null;

        if (!subscriptionId) {
          console.warn("⚠️ invoice event: missing subscriptionId (Stripe + DB); skipping", {
            requestId,
            customerId,
            invoiceId: invoice.id,
          });
          break;
        }

        // ✅ 2) Retrieve the subscription from Stripe so we can get price + period end + status
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items?.data?.[0]?.price?.id ?? null;

        console.log("📦 SUB RETRIEVED (invoice)", {
          requestId,
          subId: sub.id,
          status: sub.status,
          priceId,
          currentPeriodEnd: sub.current_period_end,
        });

        if (!priceId) {
          console.warn("⚠️ invoice event: missing priceId on subscription; skipping", {
            requestId,
            subscriptionId,
            invoiceId: invoice.id,
          });
          break;
        }

        // ✅ 3) Map priceId -> plan + monthly_tokens
        const plan = await getPlanByPriceId(priceId);
        if (!plan) {
          console.warn("⚠️ invoice event: no plan for priceId; skipping", {
            requestId,
            priceId,
            invoiceId: invoice.id,
          });
          break;
        }

        console.log("🧩 PLAN LOOKUP (invoice)", { requestId, priceId, plan });

        const grantResult = await grantTokensCanonical({
          userId: row.user_id,
          grantAmount: plan.monthly_tokens,
          actionType: "subscription",
          referenceId: invoice.id,
          modelVersion: null,
          metadata: {
            source: "stripe_invoice_paid",
            stripe_event_id: event.id,
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: sub.id,
            stripe_price_id: priceId,
            plan_id: plan.id,
            note: `Monthly tokens for plan ${plan.id}`,
          },
        });

        // ✅ 5) Update subscription state
        const { error: upsertErr } = await supabase.from("subscriptions").upsert({
          user_id: row.user_id,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          status: sub.status ?? "active",
          plan_id: plan.id,
          current_period_end: unixToIso(sub.current_period_end),
        });

        if (upsertErr) throw upsertErr;

        console.log("✅ invoice processed", {
          requestId,
          invoiceId: invoice.id,
          customerId,
          subscriptionId: sub.id,
          userId: row.user_id,
          planId: plan.id,
          skipped: grantResult.skipped,
        });

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id ?? null;

        console.log("💥 INVOICE.PAYMENT_FAILED", {
          requestId,
          invoiceId: invoice.id,
          subscriptionId,
        });

        if (!subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);

        // Prefer resolving by customer_id (same reason as paid invoices)
        const userId = await resolveUserIdForInvoice(invoice, sub);

        console.log("🧭 USER RESOLUTION (failed)", {
          requestId,
          resolvedUserId: userId,
        });

        if (!userId) break;

        const { error } = await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("user_id", userId);

        if (error) {
          console.error("❌ subscriptions update (past_due) failed", {
            requestId,
            error,
          });
          throw error;
        }

        console.log("✅ subscriptions update past_due OK", { requestId, userId });
        break;
      }

      default:
        console.log("ℹ️ EVENT IGNORED", { requestId, type: event.type });
        break;
    }

    return json(200, { received: true, requestId });
  } catch (err) {
    console.error("❌ stripe-webhook handler error:", { requestId, ...safeErr(err) });
    return json(500, { error: "Webhook handler failed", requestId });
  }
});
