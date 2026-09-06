import { existsSync } from "node:fs";
import { openDatabase } from "./db.js";
import { isProductionRuntime, validateProductionConfig } from "./config.js";
import { assertNoIncompleteServerRestore } from "./serverBackup.js";
import { SlimService } from "./services.js";

function parseArgs(argv, allowedOptions = []) {
  const allowed = new Set(allowedOptions);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error("account_control_positional_args_unexpected");
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
  if (!["create-bootstrap-invitation", "revoke-bootstrap-invitations", "create-operator-password-reset"].includes(command)) throw new Error("account_control_command_unknown");

  const args = parseArgs(rest, ["email", "expires-in-hours", "tenant-slug"]);
  let dbPath;
  if (isProductionRuntime()) {
    const config = validateProductionConfig({
      requireExistingDatabaseDirectory: true,
      requireExistingAttachmentRoot: true,
      requireExistingBackupRoot: true,
    });
    if (!existsSync(config.dbPath)) throw new Error("production_database_file_missing");
    assertNoIncompleteServerRestore(config.dbPath);
    dbPath = config.dbPath;
  }

  const db = openDatabase(dbPath);
  try {
    const service = new SlimService(db);
    if (command === "create-bootstrap-invitation") {
      printResult(service.createBootstrapSignupInvitation({
        email: args.email,
        expires_in_hours: numericOption(args["expires-in-hours"]),
      }));
    } else if (command === "revoke-bootstrap-invitations") {
      printResult(service.revokeBootstrapSignupInvitations());
    } else {
      if (!args.email || args.email === true || !args["tenant-slug"] || args["tenant-slug"] === true) throw new Error("account_control_option_required");
      const user = db
        .prepare(
          `SELECT u.*
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id
           WHERE lower(u.email) = lower(?)
             AND t.slug = ?
             AND u.active = 1`,
        )
        .get(String(args.email).trim(), String(args["tenant-slug"]).trim());
      if (!user) throw new Error("operator_password_reset_user_not_found");
      printResult(await service.createPasswordResetTokenForUser(user, {
        requested_email: user.email,
        created_by: null,
        send_email: false,
      }));
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message || "account_control_command_failed"}\n`);
  process.exitCode = 1;
});
