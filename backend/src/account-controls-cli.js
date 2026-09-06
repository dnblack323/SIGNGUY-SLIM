import { openDatabase } from "./db.js";
import { isProductionRuntime, validateProductionConfig } from "./config.js";
import { SlimService } from "./services.js";

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
    if (!allowed.has(key)) throw new Error("account_control_option_unknown");
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

function numericOption(value) {
  if (value === undefined || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("account_control_option_invalid");
  return parsed;
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) throw new Error("account_control_command_required");
  if (command !== "create-bootstrap-invitation") throw new Error("account_control_command_unknown");

  const args = parseArgs(rest, ["email", "expires-in-hours"]);
  if (isProductionRuntime()) {
    validateProductionConfig({
      requireExistingDatabaseDirectory: true,
      requireExistingAttachmentRoot: true,
      requireExistingBackupRoot: true,
    });
  }

  const db = openDatabase();
  try {
    const service = new SlimService(db);
    printResult(service.createBootstrapSignupInvitation({
      email: args.email,
      expires_in_hours: numericOption(args["expires-in-hours"]),
    }));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || "account_control_command_failed"}\n`);
  process.exitCode = 1;
});
