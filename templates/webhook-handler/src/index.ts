import express from "express";
import { Wave } from "@wave/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

const app = express();

// WAVE sends JSON payloads for webhook events
app.use(express.json());

// Verify webhook signatures to ensure requests are from WAVE
app.post("/webhooks/wave", async (req, res) => {
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
