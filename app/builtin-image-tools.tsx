"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp";
type ResizeOutputFormat = "auto" | "source" | Exclude<OutputFormat, "keep">;
type OptimisationMode = "lossless" | "balanced" | "small" | "manual";
type ResizeMode = "scale" | "width" | "height" | "fit" | "exact";

type NativeImageEntry = {
  name: string;
  type: string;
  path: string;
  originalBytes: number;
  width: number;
  height: number;
  thumbnailType: string;
  thumbnailData: Uint8Array;
};

type QuickSettings = {
  mode: OptimisationMode;
  quality: number;
  scale: number;
  format: OutputFormat;
  stripMetadata: boolean;
  preventLarger: boolean;
  exportMode: "same-folder" | "fixed-folder";
  exportSuffix: string;
  fixedFolder?: string;
  resize?: boolean;
  resizeMode?: "shrink" | "fit" | "exact";
  maxWidth?: number;
  maxHeight?: number;
};

type QuickResult = {
  source: string;
  output?: string;
  originalBytes?: number;
  outputBytes?: number;
  keptOriginal: boolean;
  error?: string;
};

export type BuiltinToolBridge = {
  selectImageEntries: () => Promise<NativeImageEntry[]>;
  selectImageFolderEntries: () => Promise<NativeImageEntry[]>;
  selectFolder: (kind: "input" | "output" | "export") => Promise<string | null>;
  quickCompressPaths: (paths: string[], settings: QuickSettings) => Promise<QuickResult[]>;
};

export type WatcherPatch = {
  outputFolder?: string;
  mode?: OptimisationMode;
  quality?: number;
  scale?: number;
  format?: OutputFormat;
  resize?: boolean;
  resizeMode?: "shrink" | "fit" | "exact";
  maxWidth?: number;
  maxHeight?: number;
  stripMetadata?: boolean;
  preventLarger?: boolean;
};

type ToolItem = NativeImageEntry & {
  id: string;
  previewUrl: string;
  status: "ready" | "working" | "done" | "error";
  result?: QuickResult;
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function modeQuality(mode: OptimisationMode, manualQuality: number) {
  if (mode === "lossless") return 92;
  if (mode === "balanced") return 82;
  if (mode === "small") return 45;
  return manualQuality;
}

function makeToolItems(entries: NativeImageEntry[]): ToolItem[] {
  return entries.map((entry) => {
    const data = entry.thumbnailData?.length ? new Uint8Array(entry.thumbnailData) : new Uint8Array();
    const previewUrl = data.length ? URL.createObjectURL(new Blob([data], { type: entry.thumbnailType || "image/webp" })) : "";
    return { ...entry, id: uid(), previewUrl, status: "ready" };
  });
}

async function runConcurrent<T>(items: T[], worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function ToolQueue({ items, remove, clear, language }: { items: ToolItem[]; remove: (id: string) => void; clear: () => void; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "en" ? en : zh;
  return <aside className="tool-queue">
    <header><div><span>{t("处理队列", "QUEUE")}</span><strong>{items.length ? t(`${items.length} 张图片`, `${items.length} images`) : t("等待导入", "Ready to import")}</strong></div>{items.length > 0 && <button type="button" onClick={clear}>{t("清空", "Clear")}</button>}</header>
    <div className="tool-queue-list">{items.length ? items.map((item) => <article key={item.id} className={item.status}>
      {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="tool-file-placeholder">IMG</span>}
      <div><strong title={item.path}>{item.name}</strong><small>{item.width} × {item.height} · {formatBytes(item.originalBytes)}</small><em>{item.status === "working" ? t("处理中…", "Processing…") : item.status === "done" ? `${formatBytes(item.result?.originalBytes)} → ${formatBytes(item.result?.outputBytes)}` : item.result?.error || t("等待处理", "Ready")}</em></div>
      <button type="button" aria-label={t("移除", "Remove")} onClick={() => remove(item.id)}>×</button>
    </article>) : <div className="tool-queue-empty"><b>＋</b><strong>{t("先加入要处理的图片", "Add images to begin")}</strong><small>{t("支持多选与整个文件夹", "Choose multiple files or a folder")}</small></div>}</div>
  </aside>;
}

type SharedProps = {
  bridge?: BuiltinToolBridge;
  language: "zh" | "en";
  onCreateMonitor: (patch: WatcherPatch) => void;
};

function useToolQueue(bridge: BuiltinToolBridge | undefined, language: "zh" | "en") {
  const [items, setItems] = useState<ToolItem[]>([]);
  const itemsRef = useRef<ToolItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const t = useCallback((zh: string, en: string) => language === "en" ? en : zh, [language]);
  const add = useCallback((entries: NativeImageEntry[]) => {
    const next = makeToolItems(entries);
    setItems((current) => [...current, ...next]);
    setNotice(t(`已加入 ${next.length} 张图片`, `Added ${next.length} images`));
  }, [t]);
  const choose = useCallback(async (folder: boolean) => {
    if (!bridge) { setNotice(t("此插件需要桌面客户端", "This plugin requires the desktop app")); return; }
    try { add(await (folder ? bridge.selectImageFolderEntries() : bridge.selectImageEntries())); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [add, bridge, t]);
  const remove = useCallback((id: string) => setItems((current) => {
    const item = current.find((candidate) => candidate.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    return current.filter((candidate) => candidate.id !== id);
  }), []);
  const clear = useCallback(() => setItems((current) => {
    current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    return [];
  }), []);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => { itemsRef.current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); }); }, []);
  return { items, setItems, busy, setBusy, notice, setNotice, choose, remove, clear, t };
}

export function FormatConverterPlugin({ bridge, language, onCreateMonitor }: SharedProps) {
  const queue = useToolQueue(bridge, language);
  const [format, setFormat] = useState<Exclude<OutputFormat, "keep">>("image/webp");
  const [mode, setMode] = useState<OptimisationMode>("balanced");
  const [quality, setQuality] = useState(82);
  const [suffix, setSuffix] = useState("-converted");
  const [folder, setFolder] = useState("");
  const effectiveQuality = modeQuality(mode, quality);
  const process = async () => {
    if (!bridge || !queue.items.length) return;
    queue.setBusy(true); queue.setNotice(queue.t("正在并行转换…", "Converting in parallel…"));
    let completed = 0;
    await runConcurrent(queue.items, async (item) => {
      queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "working" } : candidate));
      try {
        const [result] = await bridge.quickCompressPaths([item.path], { mode, quality: effectiveQuality, scale: 100, format, stripMetadata: true, preventLarger: false, exportMode: folder ? "fixed-folder" : "same-folder", exportSuffix: suffix, fixedFolder: folder || undefined });
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: result?.error ? "error" : "done", result } : candidate));
      } catch (error) {
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", result: { source: item.path, keptOriginal: false, error: error instanceof Error ? error.message : String(error) } } : candidate));
      }
      completed += 1; queue.setNotice(queue.t(`已处理 ${completed} / ${queue.items.length}`, `Processed ${completed} / ${queue.items.length}`));
    });
    queue.setBusy(false);
  };
  return <section className="builtin-tool-page">
    <header className="tool-hero"><div><span>BUILT-IN PLUGIN / CONVERT</span><h1>{queue.t("格式转换", "Format converter")}</h1><p>{queue.t("批量转成 JPEG、WebP 或 PNG，并可直接套用工作台的压缩方案。", "Convert batches to JPEG, WebP or PNG with the same optimisation modes as the workbench.")}</p></div><b>01</b></header>
    <div className="tool-layout"><ToolQueue items={queue.items} remove={queue.remove} clear={queue.clear} language={language} />
      <div className="tool-console"><div className="tool-import-actions"><button type="button" onClick={() => void queue.choose(false)}>＋ {queue.t("添加图片", "Add images")}</button><button type="button" onClick={() => void queue.choose(true)}>⌑ {queue.t("导入文件夹", "Import folder")}</button></div>
        <div className="tool-fields">
          <label><span>{queue.t("目标格式", "Output format")}</span><select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="image/webp">WebP</option><option value="image/jpeg">JPEG / JFIF</option><option value="image/png">PNG</option></select></label>
          <label><span>{queue.t("压缩方案", "Optimisation mode")}</span><select value={mode} onChange={(event) => setMode(event.target.value as OptimisationMode)}><option value="lossless">{queue.t("无损优先", "High quality")}</option><option value="balanced">{queue.t("智能平衡", "Balanced")}</option><option value="small">{queue.t("更小体积", "Smaller")}</option><option value="manual">{queue.t("手动质量", "Manual quality")}</option></select></label>
          {mode === "manual" && <label><span>{queue.t("编码质量", "Encoding quality")} <b>{quality}%</b></span><input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          <label><span>{queue.t("文件名后缀", "Filename suffix")}</span><input value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
          <label className="tool-folder-field"><span>{queue.t("输出位置", "Output folder")}</span><button type="button" onClick={async () => setFolder(await bridge?.selectFolder("export") || "")}>{folder || queue.t("原图所在文件夹", "Beside each source")}</button>{folder && <button className="tool-clear-folder" type="button" onClick={() => setFolder("")}>×</button>}</label>
        </div>
        <footer className="tool-actions"><small>{queue.notice || queue.t("所有图片仅在本机处理", "All images stay on this device")}</small><div><button type="button" onClick={() => onCreateMonitor({ outputFolder: folder || "@same-folder", mode, quality: effectiveQuality, format, scale: 100, resize: false })}>◎ {queue.t("建立监控任务", "Create watch task")}</button><button className="primary" type="button" disabled={queue.busy || !queue.items.length} onClick={() => void process()}>{queue.busy ? "···" : "→"} {queue.t("开始转换", "Convert")}</button></div></footer>
      </div>
    </div>
  </section>;
}

export function ResizePlugin({ bridge, language, onCreateMonitor }: SharedProps) {
  const queue = useToolQueue(bridge, language);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("scale");
  const [scale, setScale] = useState(200);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [format, setFormat] = useState<ResizeOutputFormat>("source");
  const [mode, setMode] = useState<OptimisationMode>("balanced");
  const [quality, setQuality] = useState(82);
  const [suffix, setSuffix] = useState("-resized");
  const [folder, setFolder] = useState("");
  const effectiveQuality = modeQuality(mode, quality);
  const settingsFor = useCallback((item: ToolItem): QuickSettings => {
    let itemScale = scale;
    let nativeResize = false;
    let nativeResizeMode: "shrink" | "fit" | "exact" = "shrink";
    const maxWidth = width;
    const maxHeight = height;
    if (resizeMode === "width") itemScale = width / Math.max(1, item.width) * 100;
    if (resizeMode === "height") itemScale = height / Math.max(1, item.height) * 100;
    if (resizeMode === "fit" || resizeMode === "exact") { nativeResize = true; nativeResizeMode = resizeMode; itemScale = 100; }
    const nativeFormat: OutputFormat = format === "auto" || format === "source" ? "keep" : format;
    const nativeMode: OptimisationMode = format === "source" ? "manual" : mode;
    return { mode: nativeMode, quality: effectiveQuality, scale: Math.max(0.1, Math.min(800, itemScale)), format: nativeFormat, stripMetadata: true, preventLarger: false, exportMode: folder ? "fixed-folder" : "same-folder", exportSuffix: suffix, fixedFolder: folder || undefined, resize: nativeResize, resizeMode: nativeResizeMode, maxWidth, maxHeight };
  }, [effectiveQuality, folder, format, height, mode, resizeMode, scale, suffix, width]);
  const monitorPatch = useMemo((): WatcherPatch => {
    const nativeFormat: OutputFormat = format === "auto" || format === "source" ? "keep" : format;
    const nativeMode: OptimisationMode = format === "source" ? "manual" : mode;
    if (resizeMode === "fit" || resizeMode === "exact") return { mode: nativeMode, quality: effectiveQuality, scale: 100, format: nativeFormat, resize: true, resizeMode, maxWidth: width, maxHeight: height };
    if (resizeMode === "width") return { mode: nativeMode, quality: effectiveQuality, scale: 800, format: nativeFormat, resize: true, resizeMode: "shrink", maxWidth: width, maxHeight: 4_294_967_295 };
    if (resizeMode === "height") return { mode: nativeMode, quality: effectiveQuality, scale: 800, format: nativeFormat, resize: true, resizeMode: "shrink", maxWidth: 4_294_967_295, maxHeight: height };
    return { mode: nativeMode, quality: effectiveQuality, scale, format: nativeFormat, resize: false, resizeMode: "shrink", maxWidth: width, maxHeight: height };
  }, [effectiveQuality, format, height, mode, resizeMode, scale, width]);
  const process = async () => {
    if (!bridge || !queue.items.length) return;
    queue.setBusy(true); queue.setNotice(queue.t("正在并行调整尺寸…", "Resizing in parallel…"));
    let completed = 0;
    await runConcurrent(queue.items, async (item) => {
      queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "working" } : candidate));
      try {
        const [result] = await bridge.quickCompressPaths([item.path], settingsFor(item));
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: result?.error ? "error" : "done", result } : candidate));
      } catch (error) {
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", result: { source: item.path, keptOriginal: false, error: error instanceof Error ? error.message : String(error) } } : candidate));
      }
      completed += 1; queue.setNotice(queue.t(`已处理 ${completed} / ${queue.items.length}`, `Processed ${completed} / ${queue.items.length}`));
    });
    queue.setBusy(false);
  };
  return <section className="builtin-tool-page">
    <header className="tool-hero"><div><span>BUILT-IN PLUGIN / RESIZE</span><h1>{queue.t("尺寸调整与扩图", "Resize & enlarge")}</h1><p>{queue.t("使用 SIMD 加速的 Lanczos3 缩放，可等比缩小、放大、适应边界或指定精确尺寸。", "SIMD-accelerated Lanczos3 resizing for proportional scaling, bounding boxes and exact dimensions.")}</p></div><b>02</b></header>
    <div className="tool-layout"><ToolQueue items={queue.items} remove={queue.remove} clear={queue.clear} language={language} />
      <div className="tool-console"><div className="tool-import-actions"><button type="button" onClick={() => void queue.choose(false)}>＋ {queue.t("添加图片", "Add images")}</button><button type="button" onClick={() => void queue.choose(true)}>⌑ {queue.t("导入文件夹", "Import folder")}</button></div>
        <div className="tool-fields">
          <label><span>{queue.t("尺寸方式", "Resize method")}</span><select value={resizeMode} onChange={(event) => setResizeMode(event.target.value as ResizeMode)}><option value="scale">{queue.t("等比百分比", "Percentage")}</option><option value="width">{queue.t("指定宽度，自动算高度", "Set width, auto height")}</option><option value="height">{queue.t("指定高度，自动算宽度", "Set height, auto width")}</option><option value="fit">{queue.t("适应宽高边界", "Fit inside box")}</option><option value="exact">{queue.t("精确宽高（可变形）", "Exact size (may distort)")}</option></select></label>
          {resizeMode === "scale" ? <label><span>{queue.t("缩放比例", "Scale")} <b>{scale}%</b></span><input type="range" min="10" max="400" step="5" value={scale} onChange={(event) => setScale(Number(event.target.value))} /><input type="number" min="1" max="800" value={scale} onChange={(event) => setScale(Math.max(1, Math.min(800, Number(event.target.value) || 1)))} /></label> : <div className="tool-size-fields"><label><span>{queue.t("宽度", "Width")}</span><input type="number" min="1" value={width} disabled={resizeMode === "height"} onChange={(event) => setWidth(Math.max(1, Number(event.target.value) || 1))} /></label><b>×</b><label><span>{queue.t("高度", "Height")}</span><input type="number" min="1" value={height} disabled={resizeMode === "width"} onChange={(event) => setHeight(Math.max(1, Number(event.target.value) || 1))} /></label><em>px</em></div>}
          <label><span>{queue.t("输出格式", "Output format")}</span><select value={format} onChange={(event) => setFormat(event.target.value as ResizeOutputFormat)}><option value="source">{queue.t("保持原格式", "Keep source format")}</option><option value="auto">{queue.t("智能择优格式", "Choose smallest format")}</option><option value="image/webp">WebP</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option></select></label>
          <label><span>{queue.t("压缩方案", "Optimisation mode")}</span><select value={mode} onChange={(event) => setMode(event.target.value as OptimisationMode)}><option value="lossless">{queue.t("无损优先", "High quality")}</option><option value="balanced">{queue.t("智能平衡", "Balanced")}</option><option value="small">{queue.t("更小体积", "Smaller")}</option><option value="manual">{queue.t("手动质量", "Manual quality")}</option></select></label>
          {mode === "manual" && <label><span>{queue.t("编码质量", "Encoding quality")} <b>{quality}%</b></span><input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          <label><span>{queue.t("文件名后缀", "Filename suffix")}</span><input value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
          <label className="tool-folder-field"><span>{queue.t("输出位置", "Output folder")}</span><button type="button" onClick={async () => setFolder(await bridge?.selectFolder("export") || "")}>{folder || queue.t("原图所在文件夹", "Beside each source")}</button>{folder && <button className="tool-clear-folder" type="button" onClick={() => setFolder("")}>×</button>}</label>
        </div>
        <footer className="tool-actions"><small>{queue.notice || queue.t("放大不会凭空增加细节，适合版面尺寸和素材适配", "Enlarging changes pixel dimensions; it cannot invent missing detail")}</small><div><button type="button" onClick={() => onCreateMonitor({ ...monitorPatch, outputFolder: folder || "@same-folder" })}>◎ {queue.t("建立监控任务", "Create watch task")}</button><button className="primary" type="button" disabled={queue.busy || !queue.items.length} onClick={() => void process()}>{queue.busy ? "···" : "→"} {queue.t("开始处理", "Process")}</button></div></footer>
      </div>
    </div>
  </section>;
}
