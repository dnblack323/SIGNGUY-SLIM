import {
  createAttachmentBackup,
  createDatabaseBackup,
  createServerBackup,
  migrateProductionDatabase,
  restoreAttachmentsBackup,
  restoreDatabaseBackup,
  restoreServerBackup,
} from "./serverBackup.js";
import { validateProductionConfig } from "./config.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function productionValidationRequired(command) {
  return command === "validate-production-config" || command === "migrate-production" || process.env.NODE_ENV === "production";
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command) throw new Error("server_backup_command_required");

  if (command === "validate-production-config") {
    printResult(validateProductionConfig({ production: true }));
    return;
  }
  if (productionValidationRequired(command)) validateProductionConfig({ production: true });

  if (command === "backup-database") {
    printResult(createDatabaseBackup());
    return;
  }
  if (command === "backup-attachments") {
    printResult(createAttachmentBackup());
    return;
  }
  if (command === "backup-server") {
    printResult(createServerBackup());
    return;
  }
  if (command === "restore-database") {
    printResult(restoreDatabaseBackup({ inputPath: args.input || args._[0], targetDbPath: args["target-db"], confirmation: args.confirm }));
    return;
  }
  if (command === "restore-attachments") {
    printResult(restoreAttachmentsBackup({ inputPath: args.input || args._[0], targetRoot: args["target-attachments"], confirmation: args.confirm }));
    return;
  }
  if (command === "restore-server") {
    printResult(restoreServerBackup({
      inputPath: args.input || args._[0],
      targetDbPath: args["target-db"],
      targetRoot: args["target-attachments"],
      confirmation: args.confirm,
    }));
    return;
  }
  if (command === "migrate-production") {
    printResult(migrateProductionDatabase({ createBackup: args["no-backup"] !== true }));
    return;
  }

  throw new Error("server_backup_command_unknown");
}

main().catch((error) => {
  process.stderr.write(`${error.message || "server_backup_failed"}\n`);
  process.exitCode = 1;
});
