import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // Create a WebRTC stream
  const stream = await wave.pipeline.create({
    title: "WebRTC Demo Stream",
    protocol: "webrtc",
    description: "Created with WAVE CLI",
  });

  console.log(`Stream created: ${stream.id}`);
  console.log(`Ingest URL: ${stream.ingest_url}`);
  console.log(`Playback URL: ${stream.playback_url}`);

  // Start the stream
  const started = await wave.pipeline.start(stream.id);
  console.log(`Stream status: ${started.status}`);

  // Wait for it to go live
  const live = await wave.pipeline.waitForLive(stream.id, {
    timeout: 60000,
    pollInterval: 2000,
  });
  console.log(`Stream is live! Viewers: ${live.viewer_count}`);
}

main().catch(console.error);
