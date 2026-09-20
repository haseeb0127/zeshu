# Zeshu mobile migration

The repository contains older Flet/Python prototypes (`app.py`, `client.py`, `driver_app.py`, `driver_main.py`). They were useful early experiments but are no longer the production source of truth.

Do not use the legacy clients for customer checkout or payment. They reference obsolete endpoints, duplicate stock/order logic and include an old Twilio-based WhatsApp path.

Current direction:
- Customer Android app: `mobile-android/`
- Customer business logic: `https://zeshu.in`
- Current production backend/auth/orders/payments: `haseeb0127/zeshu-web`
- Rider web app: `https://zeshu.in/rider`
- Native rider background-location app: separate follow-up after customer Android release and Jagtial field testing

This keeps one authoritative checkout/payment implementation while allowing native Android camera/location/deep-link behavior.
