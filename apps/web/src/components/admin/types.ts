export type AdminSubTab = "users" | "mercadolibre" | "apikeys" | "audit" | "saas";

export interface AdminBanner {
  type: "ok" | "err";
  text: string;
}
