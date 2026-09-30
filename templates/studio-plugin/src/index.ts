import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // Register a custom Studio plugin
  const plugin = await wave.studio.registerPlugin({
    name: "My Custom Plugin",
    description: "A custom production plugin for WAVE Studio",
    version: "1.0.0",
    capabilities: ["overlay", "transition"],
  });

  console.log(`Plugin registered: ${plugin.id}`);

  // Listen for Studio events
  const connection = await wave.studio.connect(plugin.id);

  connection.on("scene.switch", (scene) => {
    console.log(`Scene switched to: ${scene.name}`);
  });

  connection.on("source.added", (source) => {
    console.log(`New source added: ${source.name} (${source.type})`);
  });

  console.log("Studio plugin connected and listening for events...");
}

main().catch(console.error);
