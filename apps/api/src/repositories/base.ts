import {
  assertValidTenantId,
  withTenantTransaction,
  type Database,
  type DbTransaction,
} from "../db/client.js";

export interface TenantScope {
  db: Database;
  tenantId: string;
  tx?: DbTransaction | undefined;
}

export async function runInTenantTx<T>(
  scope: TenantScope,
  fn: (tx: DbTransaction, tenantId: string) => Promise<T>
): Promise<T> {
  const validTenantId = assertValidTenantId(scope.tenantId);
  if (scope.tx) {
    return fn(scope.tx, validTenantId);
  }
  return withTenantTransaction(scope.db, validTenantId, fn);
}

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AuthenticationError extends DomainError {
  constructor(message: string, code = "AUTH_INVALID", statusCode = 401) {
    super(code, message, statusCode);
  }
}

export class AccountLockedError extends DomainError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message: string) {
    super("AUTH_ACCOUNT_LOCKED", message, 423);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string, code = "FORBIDDEN") {
    super(code, message, 403);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, code = "NOT_FOUND") {
    super(code, message, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code = "CONFLICT") {
    super(code, message, 409);
  }
}
