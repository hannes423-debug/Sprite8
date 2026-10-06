import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorController, PointerInfo } from '../../editor/controller';

function info(e: ReactPointerEvent<HTMLCanvasElement>): PointerInfo {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    id: e.pointerId,
    x: e.clientX - r.left,
    y: e.clientY - r.top,
    button: e.button,
    pointerType: e.pointerType,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
  };
}

/** The editing canvas: forwards input to the controller and redraws on change. */
export function EditorStage({ ctl }: { ctl: EditorController }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => ctl.setStageSize(el.clientWidth, el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ctl]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const bw = Math.round(ctl.stage.w * dpr);
      const bh = Math.round(ctl.stage.h * dpr);
      if (c.width !== bw) c.width = bw;
      if (c.height !== bh) c.height = bh;
      const ctx = c.getContext('2d');
      if (ctx) ctl.render(ctx, dpr);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsubscribe = ctl.subscribe(schedule);
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ctl]);

  // Non-passive wheel listener so zooming does not scroll the page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      ctl.wheel(e.deltaY, e.clientX - r.left, e.clientY - r.top, e.ctrlKey);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ctl]);

  return (
    <canvas
      ref={ref}
      className="editor-canvas"
      data-testid="editor-canvas"
      style={{ cursor: ctl.cursor() }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        ctl.pointerDown(info(e));
      }}
      onPointerMove={(e) => ctl.pointerMove(info(e))}
      onPointerUp={(e) => ctl.pointerUp(info(e))}
      onPointerCancel={(e) => ctl.pointerCancel(info(e))}
      onPointerLeave={() => ctl.pointerLeave()}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
