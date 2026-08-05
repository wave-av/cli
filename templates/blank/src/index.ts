import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  const streams = await wave.pipeline.list();
  console.log(`Found ${streams.data.length} streams`);

  for (const stream of streams.data) {
    console.log(`- ${stream.title} (${stream.status})`);
  }
}

main().catch(console.error);
