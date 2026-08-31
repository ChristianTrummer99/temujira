import { ulid } from "ulidx";

export const now = () => Date.now();
export const newId = () => ulid();

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const TASK_KEY_RE = /^([A-Z][A-Z0-9]{1,5})-([0-9]+)$/;
export const WORKSPACE_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;
