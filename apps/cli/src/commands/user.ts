import { Option, type Command } from "commander";
import type { User } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, kv, table, ts } from "../output";
import { promptHidden } from "../prompt";
import { nonNegativeInt } from "../util";

export const COMMAND_ROUTES = {
  "user list": ["users.list"],
  "user search": ["users.search"],
  "user create": ["users.create", "apiKeys.create"],
  "user get": ["users.get"],
  "user update": ["users.update"],
  "user deactivate": ["users.deactivate"],
} as const satisfies Record<string, readonly RouteId[]>;

function userKv(user: User): string {
  return kv([
    ["id", user.id],
    ["email", user.email],
    ["name", user.name],
    ["role", user.role],
    ["agent", user.is_agent ? "yes" : "no"],
    ["deactivated", user.deactivated_at ? ts(user.deactivated_at) : "no"],
    ["created", ts(user.created_at)],
    ["updated", ts(user.updated_at)],
  ]);
}

interface UserCreateOpts {
  email: string;
  name: string;
  role?: "admin" | "member";
  agent?: boolean;
  password?: string;
  withKey?: boolean;
}

interface UserUpdateOpts {
  name?: string;
  role?: "admin" | "member";
  password?: string | boolean;
  reactivate?: boolean;
}

export function registerUser(program: Command): void {
  const user = program.command("user").description("Manage user accounts (mostly admin)");

  user
    .command("list")
    .description("List users")
    .option("--deactivated", "include deactivated users (admin only)")
    .action(async (opts: { deactivated?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listUsers(opts.deactivated ? { include_deactivated: true } : {});
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["ID", "EMAIL", "NAME", "ROLE", "AGENT", "DEACTIVATED"],
            res.items.map((u) => [
              u.id,
              u.email,
              u.name,
              u.role,
              u.is_agent ? "yes" : "",
              ts(u.deactivated_at),
            ]),
          ),
        quiet: () => res.items.map((u) => u.id).join("\n"),
      });
    });

  user
    .command("search")
    .description("Search active users by name or email (mention/assignee autocomplete)")
    .argument("<query>", "substring of a name or email")
    .option("--limit <n>", "max results (max 50, default 10)", nonNegativeInt("--limit"))
    .action(async (query: string, opts: { limit?: number }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.searchUsers({
        q: query,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      });
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["ID", "EMAIL", "NAME", "ROLE", "AGENT"],
            res.items.map((u) => [u.id, u.email, u.name, u.role, u.is_agent ? "yes" : ""]),
          ),
        quiet: () => res.items.map((u) => u.id).join("\n"),
      });
    });

  user
    .command("create")
    .description("Create a human (--password required) or agent (--agent, API-key-only) account")
    .requiredOption("--email <email>", "email address")
    .requiredOption("--name <name>", "display name")
    .addOption(new Option("--role <role>", "account role").choices(["admin", "member"]))
    .option("--agent", "create an agent account (no password; API keys only)")
    .option("--password <password>", "password (required for human accounts)")
    .option("--with-key", 'also mint an API key named "provisioned" and print its token once')
    .action(async (opts: UserCreateOpts, cmd: Command) => {
      if (opts.agent && opts.password !== undefined) {
        throw new CliError("agent accounts cannot have a password (drop --password)", EXIT_CODES.usage);
      }
      if (!opts.agent && opts.password === undefined) {
        throw new CliError(
          "--password is required for human accounts (or pass --agent for an agent account)",
          EXIT_CODES.usage,
        );
      }
      const ctx = getCtx(cmd);
      const { user: created } = await ctx.client.createUser({
        email: opts.email,
        name: opts.name,
        ...(opts.role ? { role: opts.role } : {}),
        is_agent: opts.agent ?? false,
        ...(opts.password !== undefined ? { password: opts.password } : {}),
      });
      const key = opts.withKey
        ? await ctx.client.createApiKey({ name: "provisioned", user_id: created.id })
        : undefined;
      emit(ctx.mode, {
        json: key ? { user: created, apiKey: key.apiKey, token: key.token } : { user: created },
        human: () => {
          const lines = [`created user ${created.email} (${created.id})`, userKv(created)];
          if (key) {
            lines.push(
              "",
              `API key "provisioned" (${key.apiKey.id}):`,
              "",
              `  ${key.token}`,
              "",
              "this token is shown only once — store it now",
            );
          }
          return lines.join("\n");
        },
        quiet: () => created.id,
      });
    });

  user
    .command("get")
    .description("Show one user")
    .argument("<id>", "user id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { user: found } = await ctx.client.getUser(id);
      emit(ctx.mode, {
        json: { user: found },
        human: () => userKv(found),
        quiet: () => found.id,
      });
    });

  user
    .command("update")
    .description("Update name/role, reset the password, or reactivate (admin)")
    .argument("<id>", "user id")
    .option("--name <name>", "new display name")
    .addOption(new Option("--role <role>", "new role").choices(["admin", "member"]))
    .option("--password [password]", "set a new password (no value: prompt with hidden echo)")
    .option("--reactivate", "reactivate a deactivated user")
    .action(async (id: string, opts: UserUpdateOpts, cmd: Command) => {
      const ctx = getCtx(cmd);
      let password: string | undefined;
      if (opts.password === true) password = await promptHidden("New password: ");
      else if (typeof opts.password === "string") password = opts.password;
      const body: {
        name?: string;
        role?: "admin" | "member";
        password?: string;
        reactivate?: boolean;
      } = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.role !== undefined) body.role = opts.role;
      if (password !== undefined) body.password = password;
      if (opts.reactivate) body.reactivate = true;
      if (Object.keys(body).length === 0) {
        throw new CliError(
          "nothing to update — pass --name, --role, --password, or --reactivate",
          EXIT_CODES.usage,
        );
      }
      const { user: updated } = await ctx.client.updateUser(id, body);
      emit(ctx.mode, {
        json: { user: updated },
        human: () => userKv(updated),
        quiet: () => updated.id,
      });
    });

  user
    .command("deactivate")
    .description("Deactivate a user (soft: login and API keys refused, history kept)")
    .argument("<id>", "user id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { user: deactivated } = await ctx.client.deactivateUser(id);
      emit(ctx.mode, {
        json: { user: deactivated },
        human: () => `deactivated ${deactivated.email} (${deactivated.id})`,
        quiet: () => deactivated.id,
      });
    });
}
