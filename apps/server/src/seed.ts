import { statuses, tasks, workspaces } from "./db/schema";
import { newId, now } from "./util";
import type { Db } from "./db";

export const DEFAULT_STATUSES: Array<{ name: string; color: string }> = [
  { name: "Backlog", color: "#6b7280" },
  { name: "In Progress", color: "#3b82f6" },
  { name: "Done", color: "#22c55e" },
];

/** Insert the three default statuses for a workspace; returns them in position order. */
export function seedDefaultStatuses(db: Db, workspaceId: string) {
  const t = now();
  return DEFAULT_STATUSES.map((s, i) => {
    const row = { id: newId(), workspaceId, name: s.name, color: s.color, position: i, createdAt: t };
    db.insert(statuses).values(row).run();
    return row;
  });
}

const WELCOME_BODY = `Welcome to **Temujira** — self-hosted project management for humans and agents.

A few things to try:

- Create tasks with the **New task** button, or from the CLI: \`tmj task create --workspace START --title "My first task"\`
- Edit statuses for this workspace under **Settings → Statuses** (create your own, recolor, reorder)
- Create an **API key** under Settings → API keys and let an agent loose with \`TEMUJIRA_API_KEY\`
- Markdown works everywhere: **bold**, \`code\`, lists, [links](https://example.com)
`;

/** Seed the "Getting started" workspace with a welcome task. Used by first-run setup. */
export function seedGettingStarted(db: Db, adminUserId: string): void {
  const t = now();
  const wsId = newId();
  db.insert(workspaces)
    .values({ id: wsId, name: "Getting started", key: "START", nextTaskNumber: 2, createdAt: t, updatedAt: t })
    .run();
  const seeded = seedDefaultStatuses(db, wsId);
  db.insert(tasks)
    .values({
      id: newId(),
      workspaceId: wsId,
      number: 1,
      title: "Welcome to Temujira 👋",
      description: WELCOME_BODY,
      statusId: seeded[0]!.id,
      assigneeId: adminUserId,
      createdBy: adminUserId,
      createdAt: t,
      updatedAt: t,
    })
    .run();
}
