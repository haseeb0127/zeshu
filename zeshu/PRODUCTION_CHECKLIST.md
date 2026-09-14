# Zeshu production checklist

## Environment variables

| Variable | Classification | Required | Scope |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser-safe | yes | web + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser-safe | yes | web + server |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only secret | yes | web server/API only |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | browser-safe public key | yes for checkout UI | web client |
| `RAZORPAY_KEY_ID` | server/provider-specific | yes for payment APIs | web server/API only |
| `RAZORPAY_KEY_SECRET` | server-only secret | yes for payment APIs | web server/API only |
| `PLAN_API_USER_ID` | provider-specific secret/config | required for utility providers | web server/API only |
| `PLAN_API_PASSWORD` | provider-specific secret | required for utility providers | web server/API only |
| `PLAN_API_TOKEN_ID` | provider-specific secret | required for UPI provider | web server/API only |
| `A1TOPUP_USERNAME` | provider-specific | optional/currently unused | server only |
| `A1TOPUP_PASSWORD` | provider-specific secret | optional/currently unused | server only |
| `EXPO_PUBLIC_SUPABASE_URL` | mobile browser-safe | yes for Expo apps | rider + mobile bundles |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile browser-safe public key | yes for Expo apps | rider + mobile bundles |

Never place service-role keys, Razorpay secrets, provider passwords, OTPs, or access tokens in browser/mobile variables.

## Deployment steps

1. Set production environment variables in the hosting provider without committing values.
2. Run the web production build and deploy the generated application.
3. Deploy the reviewed Supabase migrations and verify RLS/RPC grants in Supabase.
4. Verify the production domain uses HTTPS and has no localhost dependency.
5. Confirm Razorpay production keys and any required webhook configuration.
6. Smoke-test customer OTP and customer checkout using a legitimate account/payment flow.
7. Smoke-test vendor lifecycle, rider assignment, and rider delivery lifecycle with real role accounts.
8. Verify provider APIs and their configured credentials in the deployment environment.
9. Review operational logs for safe diagnostics only; no tokens, OTPs, secrets, or full identifiers.
10. Confirm utility API rate limiting is active and understood before launch.

## Rate-limiting caveat

Utility API limiting is currently a conservative per-user, per-route in-memory/per-process fallback. It is **not globally distributed** across serverless instances. Before higher traffic, replace it with shared infrastructure such as Redis/Upstash.

## Current verification boundary

This checklist documents deployment requirements. It does not claim that production deployment, Supabase migration execution, domain configuration, webhook configuration, or real payment testing has been performed.
