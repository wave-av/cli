import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // Create an SRT contribution stream (low-latency ingest)
  const stream = await wave.pipeline.create({
    title: "SRT Contribution Feed",
    protocol: "srt",
    description: "Low-latency SRT ingest for remote contribution",
  });

  console.log(`SRT stream created: ${stream.id}`);
  console.log(`SRT ingest URL: ${stream.ingest_url}`);
  console.log(`Use this URL in your SRT encoder (OBS, vMix, etc.)`);

  // Start accepting connections
  const started = await wave.pipeline.start(stream.id);
  console.log(`Status: ${started.status}`);

  // Monitor health
  const health = await wave.pipeline.getHealth(stream.id);
  console.log(`Bitrate: ${health.bitrate_kbps}kbps`);
  console.log(`Latency: ${health.latency_ms}ms`);
}

main().catch(console.error);
