# Zeshu business launch checklist

This checklist records launch dependencies; it is not legal or regulatory approval.

- Confirm legal entity/trading name, registered and correspondence address, and applicable GST/tax registrations.
- Complete payment-gateway merchant KYC, settlement, refund, chargeback, and webhook review.
- Confirm grocery supplier/vendor agreements, service area, delivery commitments, customer support ownership, and incident escalation.
- Complete food-safety/packaging requirements where applicable. Keep pharmacy fulfillment and medicine payment disabled until licensed partners and compliance review are complete.
- Keep mobile recharge discovery separate from fulfillment; rotate PlanAPI credentials before any production provider activation.
- Review privacy, terms, cancellation/refund, delivery, Zeshu Cash, grievance, and jurisdiction copy with the business owner.
- Validate production RLS, RPC grants, backups, monitoring, alerting, and secret rotation.

## GOOGLE MAPS COST CONTROL

- Browser/device GPS does not require a Google API request.
- Google Routes is limited to approximately one request per active order per minute by the bounded server cache.
- Do not reverse-geocode the same saved location repeatedly.
- Use Google Maps navigation URLs instead of a Navigation SDK initially.
- Set Google Cloud quotas and budget alerts.
- Restrict browser and server API keys independently.
- Review monthly usage before increasing quotas.
- Never call Google for every rider GPS event.
- The first cache is bounded in-memory and is cleared when a serverless instance restarts.

## LOCATION PRIVACY

- Request customer GPS only after an explicit action and retain it only for a saved address or required order destination snapshot.
- Do not continuously track customers.
- Share rider coordinates only for the assigned active delivery and stop operational tracking after delivery or cancellation.
- Keep legacy addresses and orders without coordinates valid; never backfill guessed coordinates.
