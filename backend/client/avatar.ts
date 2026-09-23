/**
 * Thin browser helper for the local Hunyuan avatar sidecar.
 * This is independent of the Node BFF client in ./index.ts.
 */

export const LOCAL_AVATAR_API = "http://localhost:8001";

export type LocalAvatarHealth = {
  status: "ok" | "error" | string;
  backend?: string;
  device?: string;
  modelLoaded?: boolean;
  gpu?: string | null;
  kind?: string | null;
  fallbackReason?: string | null;
};

export type LocalAvatarJob = {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  message: string;
  modelUrl: string | null;
  backend: string;
  error: string | null;
};

export async function fetchAvatarHealth(timeoutMs = 2500): Promise<LocalAvatarHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LOCAL_AVATAR_API}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { status: "error" };
    return (await response.json()) as LocalAvatarHealth;
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function createAvatarJob(file: File, userId = "demo-user-1") {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("userId", userId);

  const response = await fetch(`${LOCAL_AVATAR_API}/api/avatar/jobs`, {
    method: "POST",
    body,
  });

  const data = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    status?: string;
    detail?: string;
  };

  if (!response.ok || !data.jobId) {
    throw new Error(typeof data.detail === "string" ? data.detail : "Failed to create avatar job");
  }

  return { jobId: data.jobId, status: data.status || "queued" };
}

export async function getAvatarJob(jobId: string): Promise<LocalAvatarJob> {
  const response = await fetch(`${LOCAL_AVATAR_API}/api/avatar/jobs/${jobId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch avatar job");
  }

  return (await response.json()) as LocalAvatarJob;
}
