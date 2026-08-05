import { Wave } from "@wave-av/sdk";

const wave = new Wave({
  apiKey: process.env.WAVE_API_KEY!,
});

async function main() {
  // Create a podcast episode recording
  const stream = await wave.pipeline.create({
    title: "Podcast Episode Recording",
    protocol: "webrtc",
    description: "Audio-focused recording session",
  });

  console.log(`Recording session created: ${stream.id}`);

  // Start recording
  await wave.pipeline.start(stream.id);
  const recording = await wave.pipeline.startRecording(stream.id);
  console.log(`Recording started: ${recording.id}`);

  // After recording, generate transcription
  console.log("Generating transcription...");
  const transcription = await wave.transcribe.create({
    recording_id: recording.id,
    language: "en",
    model: "enhanced",
  });

  console.log(`Transcription: ${transcription.id} (${transcription.status})`);
}

main().catch(console.error);
