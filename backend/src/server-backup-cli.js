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

function parseArgs(argv, allowedOptions = []) {
  const allowed = new Set(allowedOptions);
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }
    const raw = value.slice(2);
    const equalsIndex = raw.indexOf("=");
    const key = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    if (!allowed.has(key)) throw new Error("server_backup_option_unknown");
    if (equalsIndex !== -1) {
      args[key] = raw.slice(equalsIndex + 1);
      continue;
    }
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

function productionValidationOptions() {
  return {
    production: true,
    requireExistingDatabaseDirectory: true,
    requireExistingAttachmentRoot: true,
    requireExistingBackupRoot: true,
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) throw new Error("server_backup_command_required");
  const optionsByCommand = {
    "validate-production-config": [],
    "backup-database": [],
    "backup-attachments": [],
    "backup-server": [],
    "restore-database": ["input", "target-db", "confirm"],
    "restore-attachments": ["input", "target-attachments", "confirm"],
    "restore-server": ["input", "target-db", "target-attachments", "confirm"],
    "migrate-production": ["no-backup", "initialize"],
  };
  if (!Object.hasOwn(optionsByCommand, command)) throw new Error("server_backup_command_unknown");
  const args = parseArgs(rest, optionsByCommand[command]);

  if (command === "validate-production-config") {
    printResult(validateProductionConfig(productionValidationOptions(command)));
    return;
  }
  if (productionValidationRequired(command)) validateProductionConfig(productionValidationOptions(command));

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
    printResult(migrateProductionDatabase({ createBackup: args["no-backup"] !== true, initialize: args.initialize === true }));
    return;
  }

  throw new Error("server_backup_command_unknown");
}

main().catch((error) => {
  process.stderr.write(`${error.message || "server_backup_failed"}\n`);
  process.exitCode = 1;
});
