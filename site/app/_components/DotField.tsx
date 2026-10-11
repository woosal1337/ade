"use client";

import { useEffect, useRef } from "react";

const STEP = 8;
const FRAME_MS = 1000 / 24;

export function DotField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let visible = true;

    const resize = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number): void => {
      context.clearRect(0, 0, width, height);
      const t = time / 1000;
      for (let y = STEP / 2; y < height; y += STEP) {
        for (let x = STEP / 2; x < width; x += STEP) {
          const u = x / width;
          const v = y / height;
          const center = 0.58 + v * 0.3 + Math.sin(t * 0.3 + v * 2) * 0.05;
          const band = Math.exp(-((u - center) ** 2) / 0.012);
          const wave = 0.5 + 0.5 * Math.sin(u * 22 - t * 1.6 + v * 9);
          const fade = Math.min(1, 0.25 + v * 1.2);
          const glow = band * (0.35 + 0.65 * wave);
          if (glow > 0.3) {
            const alpha = Math.min(1, (0.35 + glow * 0.7) * fade);
            const white = glow > 0.85 && wave > 0.92;
            context.fillStyle = white
              ? `rgba(235, 255, 245, ${alpha})`
              : `rgba(124, 240, 176, ${alpha})`;
            context.fillRect(x - 1, y - 1, 3, 2);
          } else {
            context.fillStyle = `rgba(150, 150, 150, ${(0.08 + wave * 0.16) * fade})`;
            context.fillRect(x - 1, y - 1, 2, 2);
          }
        }
      }
    };

    const loop = (time: number): void => {
      frame = window.requestAnimationFrame(loop);
      if (!visible || time - last < FRAME_MS) {
        return;
      }
      last = time;
      draw(time);
    };

    resize();
    draw(4000);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    if (!reduce) {
      frame = window.requestAnimationFrame(loop);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, []);

  return (
    <div aria-hidden="true" className={`h-full w-full ${className}`}>
      <canvas ref={ref} className="block h-full w-full" />
    </div>
  );
}
