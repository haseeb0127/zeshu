# Zeshu Android

This is the current Zeshu customer Android shell.

## Architecture

The Android app intentionally uses the live `https://zeshu.in` application as the source of truth. This avoids maintaining a second cart, checkout, Razorpay, rewards, support, Jagtial service-area, and digital-services implementation.

The native shell adds:
- camera permission for the Zeshu QR scanner
- coarse/fine location permission for delivery location
- image picker support for QR uploads
- Android deep links for `zeshu.in`
- external app handling for Maps, UPI, mail, telephone and other non-Zeshu links
- secure HTTPS-only WebView settings
- Android 16 / API 36 targeting for Google Play submission

## What this replaces

The old Flet files in the repository are legacy prototypes and must not be used for production checkout. They point at obsolete endpoints and duplicate payment/order logic.

## Build a test APK

Requirements:
- Android Studio / Android SDK 36
- JDK 17
- Gradle 9.6

From this directory:

```
gradle :app:assembleDebug
```

The GitHub workflow also builds a debug APK automatically and uploads it as an artifact.

## Release / Play Store

Do not commit a keystore or signing password.

For Play:
1. Create or enroll in Google Play App Signing.
2. Configure release signing through secure local/CI secrets.
3. Build an Android App Bundle:
   `gradle :app:bundleRelease`
4. Upload the signed AAB to an Internal Testing track first.
5. Test login, location, camera/QR upload, Razorpay TEST checkout open/cancel, account/support, Jagtial delivery gating and India-wide digital-service navigation.
6. Only promote after those tests pass.

Application ID: `in.zeshu.app`
Start URL: `https://zeshu.in/`

## Deep-link verification

The manifest requests Android App Link verification. Before production Play release, add `https://zeshu.in/.well-known/assetlinks.json` using the SHA-256 fingerprint supplied by Google Play App Signing. Do not put private signing material in the repository.
