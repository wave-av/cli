import express from "express";
import rateLimit from "express-rate-limit";
import { Wave } from "@wave/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

const app = express();

// WAVE sends JSON payloads for webhook events
app.use(express.json());

// Rate limit the webhook route.
//
// Signature verification is a cryptographic operation, so an unauthenticated caller can burn
// your CPU just by POSTing garbage bodies at this endpoint — the 401 costs you an HMAC every
// time. Limiting BEFORE the handler keeps that cheap.
//
// Tune `max` to your real event volume: it must sit comfortably above WAVE's burst rate
// (including delivery retries) or you will drop legitimate events. If you deploy behind a
// platform that already rate-limits at the edge (Cloudflare, API Gateway, Vercel, an ingress
// controller), prefer that and remove this middleware rather than limiting twice.
const webhookLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 300, // per IP, per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

// Verify webhook signatures to ensure requests are from WAVE
app.post("/webhooks/wave", webhookLimiter, async (req, res) => {
  const signature = req.headers["wave-signature"] as string | undefined;
  const secret = process.env.WAVE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    res.status(401).json({ error: "Missing signature or secret" });
    return;
  }

  const isValid = wave.webhooks.verify(req.body, signature, secret);
  if (!isValid) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.body;
  console.log(`Received event: ${event.type}`);

  switch (event.type) {
    case "stream.started":
      console.log(`Stream ${event.data.stream_id} started`);
      break;
    case "stream.ended":
      console.log(`Stream ${event.data.stream_id} ended`);
      break;
    case "recording.ready":
      console.log(`Recording ready: ${event.data.recording_url}`);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
