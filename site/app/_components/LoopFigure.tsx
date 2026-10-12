"use client";

import { useEffect, useRef, useState } from "react";
import { LOOP_STEPS } from "../content";
import { GLYPHS } from "../glyphs";
import {
  buildLoopScene,
  drawLoop,
  LOOP_STAGE_MS,
  LOOP_STILL_MS,
  type LoopScene,
  loopTiming,
} from "../loop-scene";

const DIGITS = ["0", "1", "2", "3", "4", "5"].map((digit) => GLYPHS[digit] ?? []);
const FRAME_MS = 1000 / 45;

export function LoopFigure() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [readoutTop, setReadoutTop] = useState<number | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scene: LoopScene | undefined;
    let time = 0;
    let last = performance.now();
    let lastDraw = 0;
    let frame = 0;
    let visible = false;
    let shown = -1;

    const render = (): void => {
      if (scene === undefined) {
        return;
      }
      const at = reduce ? LOOP_STILL_MS : time;
      const stage = drawLoop(context, scene, at, reduce);
      if (stage !== shown) {
        shown = stage;
        setActive(stage);
      }
      const progress = reduce ? 1 : loopTiming(at).since / LOOP_STAGE_MS;
      barRefs.current.forEach((bar, index) => {
        if (bar !== null) {
          bar.style.transform = `scaleX(${index === stage ? progress.toFixed(3) : "0"})`;
        }
      });
    };

    const resize = (): void => {
      const size = canvas.clientWidth;
      if (size === 0) {
        return;
      }
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      scene = buildLoopScene({ size, digits: DIGITS });
      setReadoutTop(scene.offset + (scene.numberBottom + 2) * scene.pitch);
      render();
    };

    const loop = (now: number): void => {
      frame = window.requestAnimationFrame(loop);
      const delta = Math.min(now - last, 100);
      last = now;
      if (!visible) {
        return;
      }
      time += delta;
      if (now - lastDraw < FRAME_MS) {
        return;
      }
      lastDraw = now;
      render();
    };

    resize();
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
    const viewObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    viewObserver.observe(canvas);
    if (!reduce) {
      frame = window.requestAnimationFrame(loop);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      viewObserver.disconnect();
    };
  }, []);

  const step = LOOP_STEPS[active] ?? LOOP_STEPS[0];
  return (
    <div className="space-y-5">
      <div className="relative mx-auto w-full max-w-[460px]">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Animation of the ade loop: a light moves from capture to share, import, plan, and apply, then back to capture."
          className="block aspect-square w-full"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 text-center font-mono text-[11px] leading-5"
          style={{ top: readoutTop ?? "60%" }}
        >
          <span className="block text-fg">{step?.name}</span>
          <span className="hidden text-muted sm:block">
            <span className="text-accent">$</span> {step?.command}
          </span>
        </div>
      </div>
      <ol className="grid grid-cols-5 border-t border-l border-line">
        {LOOP_STEPS.map((item, index) => (
          <li key={item.id} className="border-r border-b border-line">
            <a
              href={`#${item.id}`}
              className="relative block whitespace-nowrap px-2 py-2.5 text-center font-mono text-[11px] transition-colors hover:bg-raised sm:text-left"
            >
              <span aria-hidden="true" className="absolute inset-x-0 -top-px h-[2px]">
                <span
                  ref={(node) => {
                    barRefs.current[index] = node;
                  }}
                  className="block h-full origin-left bg-accent"
                  style={{ transform: "scaleX(0)" }}
                />
              </span>
              <span className={index === active ? "text-accent" : "text-faint"}>{item.n}</span>
              <span
                className={`sr-only sm:not-sr-only ${index === active ? "text-fg" : "text-muted"}`}
              >
                {" "}
                {item.name}
              </span>
            </a>
          </li>
        ))}
      </ol>
      <p className="min-h-10 font-mono text-[12px] leading-5 text-muted">
        <span className="text-faint">{step?.command}</span>{" "}
        <span aria-hidden="true" className="text-faint">
          ›
        </span>{" "}
        {step?.output}
      </p>
    </div>
  );
}
