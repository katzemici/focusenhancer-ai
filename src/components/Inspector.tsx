"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brush,
  ChevronDown,
  Download,
  Eraser,
  FlipHorizontal2,
  Flame,
  Hand,
  Loader2,
  Plus,
  Redo2,
  ScanFace,
  Sparkles,
  SquareDashed,
  Trash2,
  Undo2,
  Wand2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { DEFAULT_PARAMS, EXTREME_MAX, NORMAL_MAX, type EnhanceParams } from "@/engine/types";
import { sliderFromTarget, targetFromSlider, type CompressMode } from "@/lib/compress";
import { clearMask, detect, enhance, exportImage, invertMask, paramsChanged, redo, refreshEstimate, setExtreme, undo } from "@/lib/controller";
import { formatBytes } from "@/lib/image";
import { useEditor, type EditorState, type ExportFormat, type Tool } from "@/store/editor";
import { Button } from "./ui/Button";
import { Tip } from "./ui/Hint";
import { Segmented } from "./ui/Segmented";
import { Slider } from "./ui/Slider";
import { Switch } from "./ui/Switch";

function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line/70 last:border-b-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="focus-ring flex items-center gap-1.5 rounded" aria-expanded={open}>
          <ChevronDown size={12} className={clsx("text-ink-faint transition-transform", !open && "-rotate-90")} />
          <span className="label">{title}</span>
        </button>
        {right}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function useParam<K extends keyof EnhanceParams>(key: K) {
  const value = useEditor((s) => s.params[key]);
  const setParams = useEditor((s) => s.setParams);
  const set = (v: EnhanceParams[K]) => {
    setParams({ [key]: v } as Partial<EnhanceParams>);
    paramsChanged();
  };
  return [value, set] as const;
}

export function Inspector() {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="glass scroll-thin pointer-events-auto flex max-h-full w-[320px] flex-col overflow-y-auto rounded-2xl"
      data-testid="inspector"
    >
      <SelectionSection />
      <EnhanceSection />
      <AnalysisSection />
      <ExportSection />
    </motion.aside>
  );
}

function SelectionSection() {
  const tool = useEditor((s) => s.tool);
  const maskOp = useEditor((s) => s.maskOp);
  const brushSize = useEditor((s) => s.brushSize);
  const showMask = useEditor((s) => s.showMask);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const maskEmpty = useEditor((s) => s.maskEmpty);
  const status = useEditor((s) => s.status);
  const file = useEditor((s) => s.file);
  const set = useEditor((s) => s.set);
  const maxBrush = file ? Math.max(64, Math.round(Math.min(file.width, file.height) / 2)) : 500;
  const detecting = status === "detecting";

  return (
    <Section
      title="Subject selection"
      right={
        <div className="flex items-center gap-0.5">
          <Tip content="Undo (Ctrl+Z)">
            <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo" className="h-7 w-7">
              <Undo2 size={14} />
            </Button>
          </Tip>
          <Tip content="Redo (Ctrl+Shift+Z)">
            <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo" className="h-7 w-7">
              <Redo2 size={14} />
            </Button>
          </Tip>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Tip content="Finds the most salient region that is also soft or out of focus.">
          <Button variant="secondary" size="sm" onClick={() => void detect("soft-focus")} disabled={detecting} data-testid="detect-soft">
            <Wand2 size={14} className="text-accent-soft" />
            Soft focus
          </Button>
        </Tip>
        <Tip content="Finds the most salient subject regardless of sharpness.">
          <Button variant="secondary" size="sm" onClick={() => void detect("subject")} disabled={detecting} data-testid="detect-subject">
            <ScanFace size={14} className="text-accent-soft" />
            Subject
          </Button>
        </Tip>
      </div>

      <Segmented<Tool>
        ariaLabel="Selection tool"
        stretch
        size="sm"
        value={tool}
        onChange={(v) => set({ tool: v })}
        options={[
          { value: "brush", label: "Brush", icon: <Brush size={13} />, tip: "Paint the mask (B). Hold Alt to erase." },
          { value: "box", label: "Box", icon: <SquareDashed size={13} />, tip: "Drag a bounding box (M)" },
          { value: "pan", label: "Pan", icon: <Hand size={13} />, tip: "Pan (H). Hold Space with any tool." },
        ]}
      />

      <div className="flex items-center gap-2">
        <Segmented<"add" | "subtract">
          ariaLabel="Mask operation"
          size="sm"
          stretch
          className="flex-1"
          value={maskOp}
          onChange={(v) => set({ maskOp: v })}
          options={[
            { value: "add", label: "Add", icon: <Plus size={13} />, tip: "Add to mask (X toggles)" },
            { value: "subtract", label: "Erase", icon: <Eraser size={13} />, tip: "Remove from mask (X toggles)" },
          ]}
        />
        <Tip content="Invert mask">
          <Button variant="secondary" size="icon" onClick={invertMask} aria-label="Invert mask">
            <FlipHorizontal2 size={14} />
          </Button>
        </Tip>
        <Tip content="Clear mask">
          <Button variant="secondary" size="icon" onClick={clearMask} disabled={maskEmpty} aria-label="Clear mask" data-testid="clear-mask">
            <Trash2 size={14} />
          </Button>
        </Tip>
      </div>

      <Slider
        label="Brush size"
        value={brushSize}
        min={4}
        max={maxBrush}
        onChange={(v) => set({ brushSize: Math.round(v) })}
        format={(v) => `${Math.round(v)} px`}
        hint="Diameter in image pixels. [ and ] adjust it."
        disabled={tool !== "brush"}
      />
      <Switch label="Show mask overlay" checked={showMask} onChange={(v) => set({ showMask: v })} testId="show-mask" />
      {maskEmpty && <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-ink-faint">No region selected. Paint, draw a box, or auto-detect.</p>}
    </Section>
  );
}

function EnhanceSection() {
  const [deblur, setDeblur] = useParam("deblur");
  const [fidelity, setFidelity] = useParam("fidelity");
  const [clarity, setClarity] = useParam("clarity");
  const [feather, setFeather] = useParam("feather");
  const [psf, setPsf] = useParam("psf");
  const [blurSigma, setBlurSigma] = useParam("blurSigma");
  const extreme = useEditor((s) => s.params.extreme);
  const max = extreme ? EXTREME_MAX : NORMAL_MAX;
  const overdrive = extreme && (deblur > 100 || clarity > 100);
  const autoPreview = useEditor((s) => s.autoPreview);
  const resultStale = useEditor((s) => s.resultStale);
  const maskEmpty = useEditor((s) => s.maskEmpty);
  const status = useEditor((s) => s.status);
  const stats = useEditor((s) => s.stats);
  const set = useEditor((s) => s.set);
  const setParams = useEditor((s) => s.setParams);
  const [advanced, setAdvanced] = useState(false);

  return (
    <Section title="Enhancement">
      <div
        className={clsx(
          "rounded-xl border px-3 py-2.5 transition-colors",
          extreme ? "border-amber-500/40 bg-amber-500/[0.07]" : "border-line bg-base/40",
        )}
      >
        <Switch label="Absurdly high enhancement" checked={extreme} onChange={setExtreme} testId="extreme-toggle" />
        <AnimatePresence initial={false}>
          {extreme && (
            <motion.p
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-1.5 overflow-hidden pt-2 text-[11.5px] leading-snug text-amber-200/90"
            >
              <Flame size={13} className="mt-px shrink-0 text-amber-400" />
              Sliders go to {EXTREME_MAX}%. Above 100% the blur is over-corrected and the halo and natural-look safeguards are relaxed. Expect crunchy, artificial results.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <Slider
        label="Deblur intensity"
        value={deblur}
        max={max}
        onChange={setDeblur}
        defaultValue={DEFAULT_PARAMS.deblur}
        hint="Fraction of the estimated blur (point-spread function) that is inverted. Higher is sharper but amplifies noise."
        testId="slider-deblur"
        tone={extreme && deblur > 100 ? "hot" : "normal"}
      />
      <Slider
        label="Natural fidelity"
        value={fidelity}
        onChange={setFidelity}
        defaultValue={DEFAULT_PARAMS.fidelity}
        hint="Keeps the photo's own grain and texture and clamps output to the original tonal range, which prevents halos and invented detail."
        testId="slider-fidelity"
      />
      <Slider
        label="Clarity & edges"
        value={clarity}
        max={max}
        onChange={setClarity}
        defaultValue={DEFAULT_PARAMS.clarity}
        hint="Noise-gated micro-contrast inside the mask only."
        testId="slider-clarity"
        tone={extreme && clarity > 100 ? "hot" : "normal"}
      />
      {overdrive && <p className="text-[11px] text-amber-300/80" data-testid="overdrive">Overdrive active</p>}

      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        className="focus-ring flex w-full items-center justify-between rounded text-[12px] text-ink-muted hover:text-ink"
        aria-expanded={advanced}
      >
        Advanced
        <ChevronDown size={13} className={clsx("transition-transform", advanced && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {advanced && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-4 overflow-hidden">
            <div>
              <div className="mb-2 text-[13px] font-medium text-ink">Blur model</div>
              <Segmented
                ariaLabel="PSF model"
                size="sm"
                stretch
                value={psf}
                onChange={(v) => setPsf(v)}
                options={[
                  { value: "gaussian", label: "Soft (Gaussian)", tip: "General softness: missed focus, light diffusion. Most stable." },
                  { value: "disk", label: "Lens (Disk)", tip: "Optical defocus with a round aperture. Stronger, can ring more." },
                ]}
              />
            </div>
            <div>
              <Switch
                label="Auto blur radius"
                checked={blurSigma === null}
                onChange={(auto) => setBlurSigma(auto ? null : Math.round((stats?.sigma ?? 2) * 10) / 10)}
              />
              {blurSigma !== null && (
                <div className="mt-3">
                  <Slider label="Blur radius" value={blurSigma} min={0.3} max={12} step={0.1} onChange={(v) => setBlurSigma(v)} format={(v) => `${v.toFixed(1)} px`} />
                </div>
              )}
            </div>
            <Slider
              label="Edge feather"
              value={feather}
              min={0}
              max={64}
              onChange={(v) => setFeather(Math.round(v))}
              defaultValue={DEFAULT_PARAMS.feather}
              format={(v) => `${Math.round(v)} px`}
              hint="Width of the blend transition. The edge is refined with a guided filter so it follows the subject's outline."
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1">
          <Switch label="Live preview" checked={autoPreview} onChange={(v) => set({ autoPreview: v })} testId="auto-preview" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => void enhance()}
          disabled={maskEmpty || status === "enhancing"}
          data-testid="enhance-btn"
        >
          <Sparkles size={14} />
          {resultStale || !autoPreview ? "Apply enhancement" : "Re-run"}
        </Button>
        <Tip content="Reset sliders">
          <Button
            variant="secondary"
            size="icon"
            className="h-9 w-9"
            aria-label="Reset sliders"
            onClick={() => {
              setParams({ ...DEFAULT_PARAMS, extreme });
              paramsChanged();
            }}
          >
            <Undo2 size={14} />
          </Button>
        </Tip>
      </div>
    </Section>
  );
}

function AnalysisSection() {
  const stats = useEditor((s) => s.stats);
  if (!stats) return null;
  const total = Object.values(stats.timings).reduce((a, b) => a + b, 0);
  const conf = stats.sigmaConfidence;
  const confLabel = stats.sigmaSource === "manual" ? "manual" : conf > 0.6 ? "high" : conf > 0.25 ? "medium" : "low";
  return (
    <Section title="Analysis" defaultOpen={true}>
      <dl className="grid grid-cols-2 gap-2 text-[12px]" data-testid="analysis">
        <Stat label="Blur radius" value={`${stats.sigma.toFixed(2)} px`} sub={confLabel} />
        <Stat label="Noise level" value={`${(stats.noise * 255).toFixed(1)}`} sub="σ, 8-bit" />
        <Stat label="Region" value={`${stats.roi.width}×${stats.roi.height}`} sub="processed" />
        <Stat label="Time" value={`${total} ms`} sub="in worker" />
      </dl>
    </Section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-line bg-base/50 px-2.5 py-2">
      <dt className="text-[10.5px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-[13px] tabular-nums text-ink">{value}</dd>
      <dd className="text-[10.5px] text-ink-faint">{sub}</dd>
    </div>
  );
}

const EDGE_OPTIONS = [
  { value: "full", label: "Full" },
  { value: "3840", label: "4K" },
  { value: "2048", label: "2K" },
  { value: "1280", label: "1280" },
] as const;

function ExportSection() {
  const format = useEditor((s) => s.exportFormat);
  const quality = useEditor((s) => s.exportQuality);
  const mode = useEditor((s) => s.compressMode);
  const targetBytes = useEditor((s) => s.targetBytes);
  const maxEdge = useEditor((s) => s.maxEdge);
  const estimate = useEditor((s) => s.estimate);
  const estimating = useEditor((s) => s.estimating);
  const file = useEditor((s) => s.file);
  const set = useEditor((s) => s.set);
  const update = (patch: Partial<EditorState>) => {
    set(patch);
    refreshEstimate();
  };
  const lossy = format !== "png";
  const saving = estimate && file ? 1 - estimate.bytes / file.size : null;
  const pixelExact = format === "png" && maxEdge === null;

  return (
    <Section title="Export & compress">
      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">Format</div>
        <Segmented<ExportFormat>
          ariaLabel="Export format"
          size="sm"
          stretch
          value={format}
          onChange={(v) => update({ exportFormat: v })}
          options={[
            { value: "png", label: "PNG", tip: "Lossless, largest files" },
            { value: "jpeg", label: "JPEG", tip: "Lossy, universal" },
            { value: "webp", label: "WebP", tip: "Lossy, usually 25–35% smaller than JPEG" },
          ]}
        />
      </div>

      <div>
        <div className="mb-2 text-[13px] font-medium text-ink">Resize (longest edge)</div>
        <Segmented
          ariaLabel="Output size"
          size="sm"
          stretch
          value={maxEdge === null ? "full" : String(maxEdge)}
          onChange={(v) => update({ maxEdge: v === "full" ? null : Number(v) })}
          options={EDGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>

      {lossy && (
        <>
          <Segmented<CompressMode>
            ariaLabel="Compression mode"
            size="sm"
            stretch
            value={mode}
            onChange={(v) => update({ compressMode: v })}
            options={[
              { value: "quality", label: "By quality", tip: "Pick an encoder quality" },
              { value: "target", label: "Target size", tip: "Finds the best quality that fits a file size" },
            ]}
          />
          {mode === "quality" ? (
            <Slider
              label="Quality"
              value={quality}
              min={10}
              max={100}
              onChange={(v) => set({ exportQuality: Math.round(v) })}
              onCommit={() => refreshEstimate(0)}
              format={(v) => `${Math.round(v)}`}
              testId="slider-quality"
            />
          ) : (
            <Slider
              label="Max file size"
              value={sliderFromTarget(targetBytes)}
              onChange={(v) => set({ targetBytes: targetFromSlider(v) })}
              onCommit={() => refreshEstimate(0)}
              format={() => formatBytes(targetBytes)}
              hint="Searches quality 30–95 for the largest file under this size."
              testId="slider-target"
            />
          )}
        </>
      )}

      <div className="rounded-lg border border-line bg-base/50 px-3 py-2.5" data-testid="estimate">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-ink-faint">Output</span>
          {estimating && <Loader2 size={12} className="animate-spin text-ink-faint" />}
        </div>
        {estimate ? (
          <>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-[15px] tabular-nums text-ink" data-testid="estimate-size">
                {formatBytes(estimate.bytes)}
              </span>
              {saving !== null && (
                <span className={clsx("font-mono text-[11.5px] tabular-nums", saving > 0 ? "text-emerald-400" : "text-ink-faint")}>
                  {saving > 0 ? `−${Math.round(saving * 100)}%` : `+${Math.round(-saving * 100)}%`} vs original
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
              {estimate.width}×{estimate.height}
              {estimate.quality !== null && ` · q${Math.round(estimate.quality * 100)}`}
              {!estimate.metTarget && <span className="text-amber-300"> · target not reachable</span>}
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-[12px] text-ink-faint">{estimating ? "Encoding…" : "—"}</div>
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        {pixelExact
          ? "Lossless at full resolution: outside the mask, pixels are identical to the original."
          : "Compression and resizing apply to the whole image, including areas outside the mask."}
      </p>
      <Button variant="primary" className="w-full" onClick={() => void exportImage()} disabled={!file} data-testid="export-panel-btn">
        <Download size={14} />
        Export image
      </Button>
    </Section>
  );
}
