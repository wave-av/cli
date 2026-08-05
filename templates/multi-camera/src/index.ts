import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // Create a multi-camera production session
  const production = await wave.studio.create({
    title: "Multi-Camera Production",
    description: "Multi-source production demo",
  });

  console.log(`Production created: ${production.id}`);

  // Add camera sources
  const cam1 = await wave.studio.addSource(production.id, {
    type: "camera",
    label: "Camera 1 - Wide",
    url: "rtmp://localhost/live/cam1",
  });

  const cam2 = await wave.studio.addSource(production.id, {
    type: "camera",
    label: "Camera 2 - Close-up",
    url: "rtmp://localhost/live/cam2",
  });

  console.log(`Sources added: ${cam1.id}, ${cam2.id}`);

  // Create scenes
  const fullscreen = await wave.studio.createScene(production.id, {
    name: "Fullscreen",
    layout: "single",
  });

  const sideBySide = await wave.studio.createScene(production.id, {
    name: "Side by Side",
    layout: "split",
  });

  console.log(`Scenes created: ${fullscreen.id}, ${sideBySide.id}`);

  // Start production
  await wave.studio.start(production.id);
  console.log("Production started!");
}

main().catch(console.error);
