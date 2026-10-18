import { useEffect, useRef } from "react";

/**
 * The glowing wallpaper behind the glass panels: the current scan, drawn tiny
 * and blurred by CSS so its colors bleed through every frosted surface.
 */
export function Backdrop({ image }: { image: CanvasImageSource | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [image]);

  return (
    <div className="backdrop" aria-hidden="true">
      <canvas ref={canvasRef} width={64} height={40} className={image ? "on" : ""} />
    </div>
  );
}
