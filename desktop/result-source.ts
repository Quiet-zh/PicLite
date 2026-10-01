export function nextReencodeSource(
  sourceOverride: string | undefined,
  outputPath: string | undefined,
  existingSource: string | undefined,
) {
  return sourceOverride ? (outputPath || sourceOverride) : existingSource;
}
