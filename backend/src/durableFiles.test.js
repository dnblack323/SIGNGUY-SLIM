import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableCopyFile, durableEnsureDirectory, durablePublishFile } from "./durableFiles.js";

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("durable file publication", () => {
  it("creates nested directory ancestors before attachment publication", () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-dir-"));
    const nested = join(root, "tenant", "order", "attachments");

    durableEnsureDirectory(nested, { mode: 0o700 });

    expect(existsSync(nested)).toBe(true);
  });

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

  it("syncs the destination directory after removing a failed publication temp file", async () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-publish-cleanup-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "signguy-slim-durable-source-"));
    const source = join(sourceRoot, "upload.tmp");
    const destination = join(root, "tenant", "proof.txt");
    const destinationParent = join(root, "tenant");
    writeFileSync(source, "proof-bytes", { flag: "wx" });
    mkdirSync(destinationParent);
    let removedTemp = false;
    let syncedDirectoryAfterRemoval = false;

    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        openSync: (path, flags) => {
          if (removedTemp && path === destinationParent) syncedDirectoryAfterRemoval = true;
          return actual.openSync(path, flags);
        },
        renameSync: () => {
          const error = new Error("rename failed");
          error.code = "EPERM";
          throw error;
        },
        rmSync: (path, options) => {
          if (String(path).includes(".proof.txt.") && String(path).endsWith(".tmp")) removedTemp = true;
          return actual.rmSync(path, options);
        },
      };
    });
    const { durablePublishFile: mockedDurablePublishFile } = await import("./durableFiles.js");

    expect(() => mockedDurablePublishFile(source, destination, { mode: 0o600 })).toThrow("rename failed");
    expect(removedTemp).toBe(true);
    expect(syncedDirectoryAfterRemoval).toBe(true);
  });

  it("removes a newly copied destination when post-copy durability fails", () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-copy-"));
    const source = join(root, "source.txt");
    const destination = join(root, "destination.txt");
    writeFileSync(source, "proof-bytes", { flag: "wx" });

    expect(() => durableCopyFile(source, destination, { mode: -1 })).toThrow();

    expect(existsSync(destination)).toBe(false);
  });

  it("removes a newly created destination when copy fails partway", async () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-copy-partial-"));
    const source = join(root, "source.txt");
    const destination = join(root, "destination.txt");
    writeFileSync(source, "proof-bytes", { flag: "wx" });

    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        copyFileSync: (_source, target) => {
          actual.writeFileSync(target, "partial-bytes");
          const error = new Error("volume full");
          error.code = "ENOSPC";
          throw error;
        },
      };
    });
    const { durableCopyFile: mockedDurableCopyFile } = await import("./durableFiles.js");

    expect(() => mockedDurableCopyFile(source, destination)).toThrow("volume full");
    expect(existsSync(destination)).toBe(false);
  });

  it("propagates regular file synchronization failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "signguy-slim-durable-sync-"));
    const file = join(root, "proof.txt");
    writeFileSync(file, "proof", { flag: "wx" });

    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        fsyncSync: () => {
          const error = new Error("fsync unsupported for regular file");
          error.code = "EINVAL";
          throw error;
        },
      };
    });
    const { syncFilePath: mockedSyncFilePath } = await import("./durableFiles.js");

    expect(() => mockedSyncFilePath(file)).toThrow("fsync unsupported for regular file");
  });
});
