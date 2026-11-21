import type {
  CreateApiKeyRequest,
  CreateUserRequest,
  LoginRequest,
  LoginResponse,
  UpdateUserRequest,
  UserRole,
  UsuarioResponse,
} from "@stockagent/shared";
import type { BaseHttpClient } from "./http-client";
import type {
  SafeUserRow,
  SystemEstadoResponse,
  TenantApiKeyRow,
} from "./types";

export class AuthSystemApi {
  constructor(private readonly http: BaseHttpClient) {}

  ping(): Promise<{ status: string; timestamp: string }> {
    return this.http.request(
      "/api/v1/sistema/ping",
      { method: "GET" },
      { skipAuthRedirect: true }
    );
  }

  getSystemStatus(): Promise<SystemEstadoResponse> {
    return this.http.request(
      "/api/v1/sistema/estado",
      { method: "GET" },
      { skipAuthRedirect: true }
    );
  }

  login(payload: LoginRequest): Promise<LoginResponse> {
    return this.http.request(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      { skipAuthRedirect: true }
    );
  }

  getMe(): Promise<UsuarioResponse> {
    return this.http.request("/api/v1/auth/me", { method: "GET" });
  }

  logout(): Promise<{ ok: boolean; message: string }> {
    return this.http.request(
      "/api/v1/auth/logout",
      { method: "POST" },
      { skipAuthRedirect: true }
    );
  }

  changePassword(
    current_password: string,
    new_password: string
  ): Promise<{ ok: boolean; message: string }> {
    return this.http.request("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    });
  }

  listUsers(): Promise<{ ok: boolean; users: SafeUserRow[] }> {
    return this.http.request("/api/v1/auth/users", { method: "GET" });
  }

  createUser(
    payload: CreateUserRequest
  ): Promise<{ ok: boolean; user: SafeUserRow }> {
    return this.http.request("/api/v1/auth/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateUser(
    id: number,
    payload: UpdateUserRequest
  ): Promise<{ ok: boolean; user: SafeUserRow }> {
    return this.http.request(`/api/v1/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  listApiKeys(): Promise<{ ok: boolean; api_keys: TenantApiKeyRow[] }> {
    return this.http.request("/api/v1/auth/api-keys", { method: "GET" });
  }

  createApiKey(
    payload: CreateApiKeyRequest
  ): Promise<{ ok: boolean; api_key: string; key_hash: string; role: UserRole }> {
    return this.http.request("/api/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  revokeApiKey(keyHash: string): Promise<{ ok: boolean; message: string }> {
    return this.http.request(
      `/api/v1/auth/api-keys/${encodeURIComponent(keyHash)}`,
      { method: "DELETE" }
    );
  }
}
