// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

const DEFAULT_REQUEST_DEADLINE_MS = 15_000;

export async function fetchWithDeadline(
  fetchImplementation: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  deadlineMs = DEFAULT_REQUEST_DEADLINE_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deadlineMs);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
