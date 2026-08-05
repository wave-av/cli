import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // List your streams
  const streams = await wave.pipeline.list({ limit: 10 });
  console.log(`Found ${streams.data.length} streams\n`);

  for (const stream of streams.data) {
    console.log(`  ${stream.id} - ${stream.title} (${stream.status})`);
  }

  // Get organization usage
  const usage = await wave.billing.getUsage();
  console.log(`\nCurrent usage:`);
  console.log(`  Streams: ${usage.streams_count}`);
  console.log(`  Storage: ${usage.storage_gb}GB`);
  console.log(`  Bandwidth: ${usage.bandwidth_gb}GB`);
}

main().catch(console.error);
