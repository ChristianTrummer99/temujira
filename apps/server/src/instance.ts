import { eq } from "drizzle-orm";
import { DEFAULT_INSTANCE_NAME, type InstanceSettings } from "@temujira/shared";
import type { Db } from "./db";
import { instanceSettings } from "./db/schema";

export function getInstanceSettings(db: Db): InstanceSettings {
  const row = db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).get();
  return { display_name: row?.displayName ?? DEFAULT_INSTANCE_NAME };
}

export function saveInstanceSettings(db: Db, settings: InstanceSettings): InstanceSettings {
  db.insert(instanceSettings).values({ id: 1, displayName: settings.display_name })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { displayName: settings.display_name } }).run();
  return getInstanceSettings(db);
}
