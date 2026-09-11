// Phase 2 placeholder. DVR/camera health (ONVIF) was explicitly not built in
// the first pass — no vendor/model was named, and guessing a proprietary
// vendor API blind would be unverifiable work. This file exists so adding a
// real ONVIF driver later is a one-file change to infra-rca-server.ts's
// dispatch table, not a restructuring.
import type { DiagnosticCategory, DiagnosticResult, TargetCredentials } from './types';

export async function diagnoseOnvif(
  target: TargetCredentials,
  category: DiagnosticCategory
): Promise<DiagnosticResult> {
  throw new Error(
    `ONVIF/camera driver not yet implemented — needs a named vendor/model (e.g. Hikvision, Dahua, Axis) to build against. Target '${target.name}', category '${category}' cannot be diagnosed yet.`
  );
}
