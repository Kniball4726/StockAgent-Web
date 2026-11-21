import type {
  ConfirmIngestionRequest,
  FileUploadCategory,
  IngestionOperation,
  StoredFileDto,
} from "@stockagent/shared";
import type { BaseHttpClient } from "./http-client";
import type {
  ConfirmIngestionResultDto,
  UploadAndSimulateResponse,
} from "./types";

export class FilesIngestionApi {
  constructor(private readonly http: BaseHttpClient) {}

  listStoredFiles(
    category = "",
    limit = 50
  ): Promise<{ ok: boolean; files: StoredFileDto[] }> {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    params.set("limit", String(limit));
    return this.http.request(`/api/v1/files?${params.toString()}`, {
      method: "GET",
    });
  }

  deleteStoredFile(id: string): Promise<{ ok: boolean }> {
    return this.http.request(`/api/v1/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  downloadStoredFile(id: string): Promise<Blob> {
    return this.http.downloadBlob(
      `/api/v1/files/${encodeURIComponent(id)}/content?download=true`,
      "No se pudo descargar el archivo"
    );
  }

  uploadAndSimulate(params: {
    category: FileUploadCategory;
    files: File[];
    operation?: IngestionOperation;
    failOnUnmatched?: boolean;
  }): Promise<UploadAndSimulateResponse> {
    const formData = new FormData();
    formData.set("category", params.category);
    if (params.operation) {
      formData.set("operation", params.operation);
    }
    if (params.failOnUnmatched !== undefined) {
      formData.set("failOnUnmatched", String(params.failOnUnmatched));
    }
    for (const file of params.files) {
      formData.append("file", file, file.name);
    }
    return this.http.request("/api/v1/parsers/upload-and-simulate", {
      method: "POST",
      body: formData,
    });
  }

  confirmIngestion(
    payload: Omit<
      ConfirmIngestionRequest,
      "failOnUnmatched" | "sobrescribirStock"
    > & {
      failOnUnmatched?: boolean;
      sobrescribirStock?: boolean;
    },
    idempotencyKey?: string
  ): Promise<{ ok: boolean; result: ConfirmIngestionResultDto }> {
    return this.http.request("/api/v1/ingestion/confirm", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      body: JSON.stringify(payload),
    });
  }
}
