import type { ActiveTask, ActiveTaskResponse } from "../types/index.js";

interface TrackedTask extends ActiveTask {
  interruptFn: () => Promise<void>;
}

const tasks = new Map<string, TrackedTask>();

export function registerTask(
  task: ActiveTask,
  interruptFn: () => Promise<void>
): void {
  tasks.set(task.id, { ...task, interruptFn });
}

export function unregisterTask(id: string): void {
  tasks.delete(id);
}

export function listTasks(): ActiveTaskResponse[] {
  const now = Date.now();
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    model: t.model,
    prompt_preview: t.promptPreview,
    api_key_name: t.apiKeyName,
    started_at: t.startedAt,
    elapsed_seconds: Math.round((now - new Date(t.startedAt).getTime()) / 1000),
    is_streaming: t.isStreaming,
  }));
}

export async function cancelTask(id: string): Promise<boolean> {
  const task = tasks.get(id);
  if (!task) return false;
  try {
    await task.interruptFn();
  } catch {
    // Task may have already finished
  }
  tasks.delete(id);
  return true;
}

export function getTaskCount(): number {
  return tasks.size;
}
