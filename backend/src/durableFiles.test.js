import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durablePublishFile } from "./durableFiles.js";

describe("durable file publication", () => {
  it("publishes through the destination directory and removes the staged source", () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-file-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "signguy-slim-durable-source-"));
    const source = join(sourceRoot, "upload.tmp");
    const destination = join(root, "tenant", "proof.txt");
    const destinationParent = join(root, "tenant");
    writeFileSync(source, "proof-bytes", { flag: "wx" });
    mkdirSync(destinationParent);

    durablePublishFile(source, destination, { mode: 0o600 });

    expect(readFileSync(destination, "utf8")).toBe("proof-bytes");
    expect(existsSync(source)).toBe(false);
    expect(readdirSync(destinationParent).filter((entry) => entry.includes(".proof.txt.") && entry.endsWith(".tmp"))).toEqual([]);
  });
});
