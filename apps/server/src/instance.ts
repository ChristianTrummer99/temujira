import { eq } from "drizzle-orm";
import { DEFAULT_INSTANCE_NAME, type InstanceSettings, type UpdateInstanceInput } from "@temujira/shared";
import type { Db } from "./db";
import { instanceSettings } from "./db/schema";

export type InstanceLogo = { id: string; mimeType: string };

function settingsRow(db: Db) {
  return db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).get();
}

export function getInstanceSettings(db: Db): InstanceSettings {
  const row = settingsRow(db);
  return { display_name: row?.displayName ?? DEFAULT_INSTANCE_NAME, logo_id: row?.logoId ?? null };
}

export function getInstanceLogo(db: Db): InstanceLogo | null {
  const row = settingsRow(db);
  return row?.logoId && row.logoMimeType ? { id: row.logoId, mimeType: row.logoMimeType } : null;
}

export function saveInstanceSettings(db: Db, settings: UpdateInstanceInput): InstanceSettings {
  db.insert(instanceSettings).values({ id: 1, displayName: settings.display_name })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { displayName: settings.display_name } }).run();
  return getInstanceSettings(db);
}

/** Set or clear the logo. Returns the id of the replaced logo, so the caller can delete its bytes. */
export function saveInstanceLogo(db: Db, logo: InstanceLogo | null): string | null {
  const previous = settingsRow(db)?.logoId ?? null;
  const values = { logoId: logo?.id ?? null, logoMimeType: logo?.mimeType ?? null };
  db.insert(instanceSettings).values({ id: 1, displayName: getInstanceSettings(db).display_name, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values }).run();
  return previous;
}
