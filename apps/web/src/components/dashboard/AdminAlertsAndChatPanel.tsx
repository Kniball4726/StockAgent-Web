import { Bell, CheckCheck, MessageSquare, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import type {
  AdminNotificationRow,
  ChatMessageRow,
} from "../../lib/api-client";
import { formatDateTime } from "../../lib/rbac";

interface AdminAlertsAndChatPanelProps {
  isAdmin: boolean;
  notifications: AdminNotificationRow[];
  chatMessages: ChatMessageRow[];
  onMarkNotificationsRead: () => Promise<void>;
  onSendChatMessage: (message: string) => Promise<void>;
}

export function AdminAlertsAndChatPanel({
  isAdmin,
  notifications,
  chatMessages,
  onMarkNotificationsRead,
  onSendChatMessage,
}: AdminAlertsAndChatPanelProps) {
  const [chatDraft, setChatDraft] = useState("");
  const unreadNotifs = notifications.filter((n) => !n.isRead).length;

  async function handleSendChat(e: FormEvent) {
    e.preventDefault();
    const clean = chatDraft.trim();
    if (!clean) return;
    await onSendChatMessage(clean);
    setChatDraft("");
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">
                Alertas Admin ({unreadNotifs})
              </h3>
            </div>
            {unreadNotifs > 0 && (
              <button
                type="button"
                onClick={() => void onMarkNotificationsRead()}
                className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar leídas
              </button>
            )}
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {notifications.slice(0, 6).map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border p-2.5 text-xs ${
                  n.isRead
                    ? "border-slate-800 bg-slate-950/50 text-slate-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                }`}
              >
                <p className="font-semibold">{n.title}</p>
                <p className="mt-0.5 opacity-90">{n.message}</p>
                <p className="mt-1 text-[10px] opacity-70">
                  {n.operatorUsername} · {formatDateTime(n.createdAt)}
                </p>
              </div>
            ))}
            {notifications.length === 0 && (
              <p className="text-xs text-slate-500">
                Sin notificaciones registradas.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-white">Chat del Depósito</h3>
        </div>
        <div className="mb-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {chatMessages.slice(-15).map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-800/80 bg-slate-950/70 p-2.5 text-xs"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-sky-300">{m.emisor}</span>
                <span>{formatDateTime(m.createdAt)}</span>
              </div>
              <p className="mt-1 text-slate-200">{m.mensaje}</p>
            </div>
          ))}
          {chatMessages.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-500">
              Aún no hay mensajes internos.
            </p>
          )}
        </div>
        <form onSubmit={handleSendChat} className="flex gap-2">
          <input
            type="text"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder="Mensaje para el equipo..."
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-xl bg-sky-500 px-3 py-2 text-slate-950 hover:bg-sky-400"
            aria-label="Enviar mensaje"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </section>
    </div>
  );
}
