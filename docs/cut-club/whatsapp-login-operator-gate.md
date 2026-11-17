# CUT CLUB — WhatsApp identity delivery adapter (#308)

Owner prefers the verification message to be sent over WhatsApp and previously deferred real delivery while building CUT CLUB. **This Draft adds the transport integration candidate, not a production login endpoint or actual sends.**

## Source
- `src/lib/cut-club/whatsappOtpProvider.ts` implements the existing `OtpDeliveryProvider` interface from `otpDomain`.
- Uses Casher's existing tenant-aware messaging API `runWithMessagingTenant` → `sendMessage`. Existing messaging finds the active channel owned by the trusted Tenant UUID; no fallback to another tenant/channel.
- Requires both `CUT_CLUB_WHATSAPP_OTP_DELIVERY_ENABLED=true` **and** explicit `operatorApproved=true`. Default OFF.
- Rejects tenant mismatch, malformed E.164 phone, OTP code or challenge ID; never logs code, phone, challenge or message. The only outbound metadata is a non-personal source tag.
- A send is marked successful only on explicit messaging provider success. No channel/failed send/exception → failed; domain flow marks challenge delivery_failed and cannot create a verified session.
- Synthetic mocked tenant/channel/send tests only. No actual WhatsApp phone, external send, database queries, customer balance changes, or HTTP routes called in these tests.

## Mandatory end-to-end implementation before sign-in is enabled
1. Confirm actual Production DB schema and deploy durable OTP challenge, counter and session store (current SQL proposal is intentionally staging-only, not applied). Verify HMAC secret and rotation.
2. Operator must approve connected WhatsApp sender/channel, message costs, delivery receipts, opt-in/legal basis and retention of OTP message content. External WhatsApp services **may retain the message**, even though this adapter never logs it.
3. Trusted public branch+tenant resolution, trusted proxy client IP digest and E.164 normalization; no browser tenant ID or client ID as authority. Tenant channel must match the verified business scope.
4. New server-only API request + verify + logout with committed single-use OTP, exact original phone and unique tenant-owned customer binding; an unverified phone cannot open a Wallet. Proper cooldown/rate limits and generic responses needed.
5. Secure host-only HttpOnly SameSite cookie on website BFF; session stored as digest only, expires/revocable; no token in JS/URL. Website customer /club must be populated only from session-owned Casher APIs. No public GETs using clientId.
6. Staging test two tenants/two phones, duplicate/shared phone, send failure, replay, expired/revoked session and no PII/code logs, and real device cross-browser acceptance; review policies for return visits.
7. Atomic financial validation, refunds/voucher reconciliation, full cashier acceptance and coordinated VPS build/rollback, explicit exact-head owner go/no-go.

**No merge/deploy or live send.** The adapter is a future provider; consumer service is still OFF until provider, customer binding and database session are proven.
