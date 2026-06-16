"use client";

import { useEffect, useRef, useState } from "react";

// Unterschriften-Feld (Canvas, Maus + Touch). Liefert das PNG als Data-URL.
export function SignaturePad({ onSubmit, busy }: { onSubmit: (dataUrl: string, name: string) => void; busy?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent) {
    const c = canvasRef.current!;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }
  function up() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  return (
    <div className="grid gap-3" data-testid="signature-pad">
      <input className="field" placeholder="Name des Unterzeichners" value={name} onChange={(e) => setName(e.target.value)} data-testid="sig-name" />
      <div className="rounded-2xl border-2 border-dashed border-ink-300 bg-white">
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          className="h-[200px] w-full touch-none rounded-2xl"
          data-testid="sig-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={clear} className="btn-ghost flex-1">Löschen</button>
        <button
          type="button"
          disabled={!hasInk || busy}
          onClick={() => onSubmit(canvasRef.current!.toDataURL("image/png"), name)}
          data-testid="sig-submit"
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {busy ? "Speichern …" : "Unterschrift bestätigen"}
        </button>
      </div>
    </div>
  );
}
