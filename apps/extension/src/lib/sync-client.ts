import { STORAGE_KEYS, type Application } from "@jobpilot/shared";
import { db } from "../db";

export interface SyncSettings {
  enabled: boolean;
  baseUrl: string;
  lastSyncAt?: string;
}

export interface AuthSession {
  user: { id: string; email: string };
  accessToken: string;
  refreshToken: string;
}

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  baseUrl: "http://localhost:4000",
};

export async function getSyncSettings(): Promise<SyncSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncSettings);
  const value = stored[STORAGE_KEYS.syncSettings] as Partial<SyncSettings> | undefined;
  return { ...DEFAULT_SYNC_SETTINGS, ...value, baseUrl: value?.baseUrl ?? DEFAULT_SYNC_SETTINGS.baseUrl };
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.syncSettings]: settings });
}

export async function getAccessToken(): Promise<string | null> {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.syncAccessToken);
  const token = stored[STORAGE_KEYS.syncAccessToken];
  return typeof token === "string" ? token : null;
}

async function saveSession(session: AuthSession): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.syncAccessToken]: session.accessToken });
  await chrome.storage.local.set({ [STORAGE_KEYS.syncRefreshToken]: session.refreshToken, [STORAGE_KEYS.syncUser]: session.user.email });
}

export async function loginOrRegister(
  mode: "login" | "register",
  email: string,
  password: string,
): Promise<AuthSession> {
  const settings = await getSyncSettings();
  const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/api/v1/auth/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as { data?: AuthSession; error?: { message?: string } } | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Authentication failed (${response.status})`);
  await saveSession(body.data);
  return body.data;
}

async function refreshAccessToken(): Promise<string> {
  const settings = await getSyncSettings();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.syncRefreshToken);
  const refreshToken = stored[STORAGE_KEYS.syncRefreshToken];
  if (typeof refreshToken !== "string") throw new Error("Cloud sync login required.");
  const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const body = (await response.json().catch(() => null)) as { data?: AuthSession; error?: { message?: string } } | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Session expired. Login again.");
  await saveSession(body.data);
  return body.data.accessToken;
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getAccessToken();
  if (!token) token = await refreshAccessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  let response = await fetch(`${(await getSyncSettings()).baseUrl.replace(/\/+$/, "")}${path}`, { ...init, headers });
  if (response.status === 401) {
    token = await refreshAccessToken();
    headers.set("authorization", `Bearer ${token}`);
    response = await fetch(`${(await getSyncSettings()).baseUrl.replace(/\/+$/, "")}${path}`, { ...init, headers });
  }
  return response;
}

export async function logoutSync(): Promise<void> {
  try {
    await authorizedFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    await chrome.storage.session.remove(STORAGE_KEYS.syncAccessToken);
    await chrome.storage.local.remove([STORAGE_KEYS.syncRefreshToken, STORAGE_KEYS.syncUser]);
  }
}

export async function pushQueuedChanges(): Promise<{ applied: number; conflicts: number }> {
  const queue = await db.syncQueue.orderBy("updatedAt").toArray();
  if (!queue.length) return { applied: 0, conflicts: 0 };
  const response = await authorizedFetch("/api/v1/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      changes: queue
        .map((item) => ({
          entity: item.entity,
          entityId: item.entityId,
          op: item.op,
          baseVersion: item.baseVersion,
          record: item.record,
        })),
    }),
  });
  const body = (await response.json()) as { data?: { results?: Array<{ entityId: string; status: string; remote?: unknown }> }; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Sync push failed.");
  let applied = 0;
  let conflicts = 0;
  for (const result of body.data?.results ?? []) {
    const item = queue.find((candidate) => candidate.entityId === result.entityId);
    if (result.status === "applied" && item) {
      await db.syncQueue.delete(item.id);
      if (item.entity === "application") {
        await db.applications.update(item.entityId, { syncStatus: "synced" });
      } else if (item.entity === "profile") {
        await db.profile.update(item.entityId, { syncStatus: "synced" });
      } else if (item.entity === "resumeVersion") {
        await db.resumeVersions.update(item.entityId, { syncStatus: "synced" });
      }
      applied += 1;
    } else if (result.status === "conflict" && item) {
      if (item.entity === "application") await db.applications.update(item.entityId, { syncStatus: "conflict" });
      if (item.entity === "profile") await db.profile.update(item.entityId, { syncStatus: "conflict" });
      if (item.entity === "resumeVersion") await db.resumeVersions.update(item.entityId, { syncStatus: "conflict" });
      await db.conflicts.put({ id: `${item.entity}:${item.entityId}`, entity: item.entity, entityId: item.entityId, local: item.record, remote: result.remote, createdAt: new Date().toISOString() });
      conflicts += 1;
    }
  }
  return { applied, conflicts };
}

export async function pullRemoteChanges(): Promise<{ count: number }> {
  const settings = await getSyncSettings();
  const since = settings.lastSyncAt ? `?since=${encodeURIComponent(settings.lastSyncAt)}` : "";
  const response = await authorizedFetch(`/api/v1/sync/pull${since}`);
  const body = (await response.json()) as { data?: { records?: Array<Record<string, unknown>>; serverTime?: string }; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Sync pull failed.");
  let count = 0;
  for (const entry of body.data?.records ?? []) {
    const remote = (entry as { entity?: string; record?: Record<string, unknown> }).record ?? entry;
    const entity = (entry as { entity?: string }).entity ?? "application";
    const id = String(remote._id ?? "");
    if (!id) continue;

    if (entity === "profile") {
      await db.profile.put({ ...(remote as unknown as Parameters<typeof db.profile.put>[0]), id, userId: "local-user", syncStatus: "synced" });
      count += 1;
      continue;
    }
    if (entity === "resumeVersion") {
      await db.resumeVersions.put({ ...(remote as unknown as Parameters<typeof db.resumeVersions.put>[0]), id, userId: "local-user", syncStatus: "synced" });
      count += 1;
      continue;
    }
    const local = await db.applications.get(id);
    const remoteVersion = Number(remote.version ?? 1);
    if (local && local.version > remoteVersion && local.syncStatus === "pending") {
      await db.conflicts.put({ id: `${entity}:${id}`, entity, entityId: id, local, remote, createdAt: new Date().toISOString() });
      continue;
    }
    await db.applications.put({
      ...(remote as unknown as typeof local),
      id,
      userId: "local-user",
      updatedAt: new Date(String(remote.updatedAt)).toISOString(),
      createdAt: new Date(String(remote.createdAt)).toISOString(),
      syncStatus: "synced",
    } as Application);
    count += 1;
  }
  await saveSyncSettings({ ...settings, lastSyncAt: body.data?.serverTime ?? new Date().toISOString() });
  return { count };
}

export async function syncNow(): Promise<{ pushed: number; pulled: number; conflicts: number }> {
  const pushed = await pushQueuedChanges();
  const pulled = await pullRemoteChanges();
  return { pushed: pushed.applied, pulled: pulled.count, conflicts: pushed.conflicts };
}
