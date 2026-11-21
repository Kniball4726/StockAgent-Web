import { Camera, Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createBrowserBarcodeDetector,
  isCameraBarcodeScannerSupported,
} from "../lib/barcode-scanner";

interface CameraScannerModalProps {
  open: boolean;
  title: string;
  onDetected: (rawCode: string) => void;
  onClose: () => void;
}

export function CameraScannerModal({
  open,
  title,
  onDetected,
  onClose,
}: CameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState("");
  const supported = isCameraBarcodeScannerSupported();

  useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setManualValue("");
      return;
    }

    if (!supported) {
      setErrorMsg(
        "El escáner de cámara nativo requiere HTTPS y un navegador compatible con BarcodeDetector. Podés usar lector USB HID o ingresar el código manualmente."
      );
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId = 0;

    async function start() {
      try {
        const detector = await createBrowserBarcodeDetector();
        if (!detector || cancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const scanLoop = async () => {
          if (cancelled) return;
          try {
            if (video.readyState >= 2) {
              const matches = await detector.detect(video);
              const first = matches.find(
                (m) => typeof m.rawValue === "string" && m.rawValue.trim().length > 0
              );
              if (first?.rawValue) {
                onDetected(first.rawValue);
                return;
              }
            }
          } catch {
            // Reintentar en siguiente frame
          }
          rafId = window.requestAnimationFrame(() => {
            void scanLoop();
          });
        };

        rafId = window.requestAnimationFrame(() => {
          void scanLoop();
        });
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? `No se pudo abrir la cámara: ${err.message}`
              : "No se pudo acceder a la cámara del dispositivo."
          );
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [open, supported, onDetected]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-sky-400" />
            <h3 className="text-base font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Cerrar escáner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg ? (
          <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
            {errorMsg}
          </div>
        ) : (
          <div className="relative mb-4 overflow-hidden rounded-xl border border-slate-700 bg-black aspect-video">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
            <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-sky-400/70" />
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualValue.trim()) {
              onDetected(manualValue.trim());
            }
          }}
          className="space-y-2"
        >
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Keyboard className="h-3.5 w-3.5 text-slate-400" />
            Ingreso manual o pistola USB HID
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Ej: 101, 7791234567890 o NP-001"
              autoFocus
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
            >
              Aplicar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
