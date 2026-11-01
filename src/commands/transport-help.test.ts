import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "../cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `--help` snapshot for the go-live transport command groups this lane adds. Covers the exact
 * shape the lane's `liveProof` checks: `wave srt --help` lists 'inputs create'.
 */
describe("wave <transport> --help", () => {
  it("`wave srt --help` lists `inputs create` — the lane's liveProof invocation", () => {
    const program = createProgram();
    const srt = program.commands.find((c) => c.name() === "srt");
    expect(srt, "`srt` must be a registered top-level command").toBeDefined();
    const help = srt!.helpInformation();
    expect(help).toContain("inputs");

    const inputs = srt!.commands.find((c) => c.name() === "inputs");
    expect(inputs, "`srt inputs` must be a registered subcommand").toBeDefined();
    const inputsHelp = inputs!.helpInformation();
    expect(inputsHelp).toContain("create");
    expect(inputsHelp).toContain("list");
    expect(inputsHelp).toContain("get");
    expect(inputsHelp).toContain("delete");
  });

  it("`wave moq --help` lists `token publish|subscribe`", () => {
    const program = createProgram();
    const moq = program.commands.find((c) => c.name() === "moq");
    expect(moq).toBeDefined();
    const token = moq!.commands.find((c) => c.name() === "token");
    expect(token).toBeDefined();
    const tokenHelp = token!.helpInformation();
    expect(tokenHelp).toContain("publish");
    expect(tokenHelp).toContain("subscribe");
  });

  it("`wave whip --help` lists `publish` with --file/--url options", () => {
    const program = createProgram();
    const whip = program.commands.find((c) => c.name() === "whip");
    expect(whip).toBeDefined();
    const publish = whip!.commands.find((c) => c.name() === "publish");
    expect(publish).toBeDefined();
    const help = publish!.helpInformation();
    expect(help).toContain("--file");
    expect(help).toContain("--url");
  });

  it("`wave whep --help` lists `subscribe` with a --id option", () => {
    const program = createProgram();
    const whep = program.commands.find((c) => c.name() === "whep");
    expect(whep).toBeDefined();
    const subscribe = whep!.commands.find((c) => c.name() === "subscribe");
    expect(subscribe).toBeDefined();
    expect(subscribe!.helpInformation()).toContain("--id");
  });

  it("`wave crest --help` lists `sessions`", () => {
    const program = createProgram();
    const crest = program.commands.find((c) => c.name() === "crest");
    expect(crest).toBeDefined();
    expect(crest!.commands.some((c) => c.name() === "sessions")).toBe(true);
  });

  it("`wave dante --help` lists `observe`", () => {
    const program = createProgram();
    const dante = program.commands.find((c) => c.name() === "dante");
    expect(dante).toBeDefined();
    expect(dante!.commands.some((c) => c.name() === "observe")).toBe(true);
  });

  it("`wave listen --help` still exists and now also lists `sessions`", () => {
    const program = createProgram();
    const listen = program.commands.find((c) => c.name() === "listen");
    expect(listen).toBeDefined();
    expect(listen!.commands.some((c) => c.name() === "sessions")).toBe(true);
  });

  it("`wave stream --help` and `wave phone --help` are labeled [PREVIEW]", () => {
    const program = createProgram();
    for (const name of ["stream", "phone"]) {
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd, `\`${name}\` must still be registered`).toBeDefined();
      expect(cmd!.description()).toMatch(/PREVIEW/);
    }
  });

  it("every new top-level transport command is declared in capabilities.json (CAP-001 coverage)", () => {
    const capabilities = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "capabilities.json"), "utf-8"),
    ) as { exposes: { cli: Array<{ binary: string; subcommands: string[] }> } };
    const declared = capabilities.exposes.cli.find((c) => c.binary === "wave")?.subcommands ?? [];

    for (const name of ["srt", "moq", "whip", "whep", "crest", "dante"]) {
      expect(declared, `capabilities.json must list "${name}"`).toContain(name);
    }
  });
});
