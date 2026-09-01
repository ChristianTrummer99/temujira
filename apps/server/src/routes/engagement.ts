import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { activityEvents, inboxItems, taskAssociations, users } from "../db/schema";
import { newId, now } from "../util";
import type { UserRow } from "../serialize";

/**
 * @-mention token regex. Supports @DisplayName (letters/spaces/numbers/._-) up to a
 * natural word boundary. The client resolves these to user ids before posting; this
 * parser is used for defense-in-depth + rendering inline badges.
 */
const MENTION_TOKEN_RE = /(?<![\w-])@([A-Za-z0-9_.' -]{1,64})/g;

/** Raw @-mentions found in body text (display-name style tokens). */
export function findMentionTokens(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    const name = m[1]!.trim();
    if (name) out.push(name);
  }
  return out;
}

/** Resolve a set of @-mention tokens to user rows (case-insensitive exact name match; active only). */
export function resolveMentions(db: Db, tokens: string[]): UserRow[] {
  if (tokens.length === 0) return [];
  const wanted = new Set(tokens.map((t) => t.toLowerCase()));
  const rows = db.select().from(users).all();
  return rows.filter((u) => u.deactivatedAt === null && wanted.has(u.name.toLowerCase()));
}

/** Make sure each user is associated with a task (idempotent). */
export function associate(db: Db, taskId: string, userIds: string[], t = now()): void {
  db.transaction((tx) => {
    for (const userId of userIds) {
      tx.insert(taskAssociations)
        .values({ taskId, userId, associatedAt: t })
        .onConflictDoNothing()
        .run();
    }
  });
}

/** Record an activity event in a workspace's action feed. */
export function recordActivity(
  db: Db,
  opts: {
    workspaceId: string;
    taskId?: string | null;
    actorId: string;
    action: string;
    metadata?: Record<string, unknown>;
  },
): void {
  db.insert(activityEvents)
    .values({
      id: newId(),
      workspaceId: opts.workspaceId,
      taskId: opts.taskId ?? null,
      actorId: opts.actorId,
      action: opts.action,
      metadata: JSON.stringify(opts.metadata ?? {}),
      createdAt: now(),
    })
    .run();
}

/** Push inbox items of a given kind for a set of target users. */
export function pushInbox(
  db: Db,
  opts: {
    userIds: string[];
    workspaceId: string;
    taskId: string;
    actorId: string;
    kind: "mention" | "reply";
    sourceCommentId: string;
    parentCommentId: string | null;
  },
): void {
  if (opts.userIds.length === 0) return;
  const t = now();
  db.transaction((tx) => {
    for (const userId of opts.userIds) {
      // Don't self-notify the actor.
      if (userId === opts.actorId) continue;
      // Dedupe: one inbox row per (user, kind, source comment).
      const existing = tx
        .select()
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.userId, userId),
            eq(inboxItems.kind, opts.kind),
            eq(inboxItems.sourceCommentId, opts.sourceCommentId),
          ),
        )
        .get();
      if (existing) continue;
      tx.insert(inboxItems)
        .values({
          id: newId(),
          userId,
          workspaceId: opts.workspaceId,
          taskId: opts.taskId,
          actorId: opts.actorId,
          kind: opts.kind,
          sourceCommentId: opts.sourceCommentId,
          parentCommentId: opts.parentCommentId,
          readAt: null,
          createdAt: t,
        })
        .run();
    }
  });
}


