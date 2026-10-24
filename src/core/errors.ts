// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 AlbiDR

export type PlaylistTidyErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "REQUEST_REJECTED"
  | "OWNER_MISMATCH"
  | "RATE_LIMITED"
  | "TRANSIENT_READ_FAILED"
  | "AMBIGUOUS_WRITE"
  | "CONCURRENT_EDIT"
  | "RETRY_EXHAUSTED"
  | "DEADLINE_EXCEEDED"
  | "INTEGRITY_FAILED";

export class PlaylistTidyError extends Error {
  public constructor(
    public readonly code: PlaylistTidyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlaylistTidyError";
  }
}

