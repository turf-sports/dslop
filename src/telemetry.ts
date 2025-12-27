import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import https from "node:https";

const CONFIG_DIR = path.join(os.homedir(), ".config", "dslop");
const CONFIG_FILE = path.join(CONFIG_DIR, "telemetry.json");

// Configurable endpoint - set your own analytics endpoint here
const TELEMETRY_ENDPOINT = process.env.DSLOP_TELEMETRY_ENDPOINT || "https://telemetry.example.com/v1/events";

interface TelemetryConfig {
  anonymousId: string;
  firstRunShown: boolean;
  createdAt: string;
}

interface TelemetryEvent {
  event: string;
  anonymousId: string;
  timestamp: string;
  properties: Record<string, unknown>;
  context: {
    cli_version: string;
    node_version: string;
    os: string;
    os_version: string;
    arch: string;
  };
}

let cachedConfig: TelemetryConfig | null = null;
let telemetryDisabled: boolean | null = null;

/**
 * Check if telemetry is disabled via environment variables
 * Respects: DSLOP_TELEMETRY=false, DO_NOT_TRACK=1, CI=true
 */
export function isTelemetryDisabled(): boolean {
  if (telemetryDisabled !== null) return telemetryDisabled;

  const dslopTelemetry = process.env.DSLOP_TELEMETRY?.toLowerCase();
  const doNotTrack = process.env.DO_NOT_TRACK;
  const isCI = process.env.CI;

  telemetryDisabled =
    dslopTelemetry === "false" ||
    dslopTelemetry === "0" ||
    doNotTrack === "1" ||
    isCI === "true";

  return telemetryDisabled;
}

/**
 * Load or create telemetry config with anonymous ID
 */
async function loadConfig(): Promise<TelemetryConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    cachedConfig = JSON.parse(data) as TelemetryConfig;
    return cachedConfig;
  } catch {
    // First run - create new config
    cachedConfig = {
      anonymousId: randomUUID(),
      firstRunShown: false,
      createdAt: new Date().toISOString(),
    };

    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
    } catch {
      // Ignore write errors - telemetry will still work with in-memory ID
    }

    return cachedConfig;
  }
}

/**
 * Mark first run notice as shown
 */
async function markFirstRunShown(): Promise<void> {
  if (!cachedConfig) return;

  cachedConfig.firstRunShown = true;

  try {
    await writeFile(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), "utf-8");
  } catch {
    // Ignore write errors
  }
}

/**
 * Show first run notice about telemetry (only once)
 */
export async function showFirstRunNotice(): Promise<void> {
  if (isTelemetryDisabled()) return;

  const config = await loadConfig();
  if (config.firstRunShown) return;

  console.log(
    "\x1b[2m" + // dim
      "dslop collects anonymous usage metrics to improve the tool.\n" +
      "No personal data is collected. Disable with DSLOP_TELEMETRY=false\n" +
      "\x1b[0m" // reset
  );

  await markFirstRunShown();
}

/**
 * Build context object with system info
 */
function buildContext(version: string): TelemetryEvent["context"] {
  return {
    cli_version: version,
    node_version: process.version,
    os: process.platform,
    os_version: os.release(),
    arch: process.arch,
  };
}

/**
 * Send telemetry event (fire and forget, non-blocking)
 */
function sendEvent(event: TelemetryEvent): void {
  try {
    const url = new URL(TELEMETRY_ENDPOINT);
    const data = JSON.stringify(event);

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 3000, // 3 second timeout
      },
      () => {
        // Response received - ignore it
      }
    );

    req.on("error", () => {
      // Silently ignore errors - telemetry should never break the CLI
    });

    req.write(data);
    req.end();
  } catch {
    // Silently ignore errors
  }
}

/**
 * Track CLI started event
 */
export async function trackCliStarted(version: string): Promise<void> {
  if (isTelemetryDisabled()) return;

  const config = await loadConfig();

  const event: TelemetryEvent = {
    event: "cli_started",
    anonymousId: config.anonymousId,
    timestamp: new Date().toISOString(),
    properties: {
      first_run: !config.firstRunShown,
    },
    context: buildContext(version),
  };

  sendEvent(event);
}

/**
 * Track command completion
 */
export async function trackCommandCompleted(
  version: string,
  properties: {
    success: boolean;
    duration_ms: number;
    mode: "full" | "changes";
    file_count?: number;
    duplicate_count?: number;
    error?: string;
    flags?: {
      cross_package?: boolean;
      json_output?: boolean;
      no_cache?: boolean;
    };
  }
): Promise<void> {
  if (isTelemetryDisabled()) return;

  const config = await loadConfig();

  const event: TelemetryEvent = {
    event: "command_completed",
    anonymousId: config.anonymousId,
    timestamp: new Date().toISOString(),
    properties,
    context: buildContext(version),
  };

  sendEvent(event);
}

/**
 * Disable telemetry programmatically (useful for testing)
 */
export function disableTelemetry(): void {
  telemetryDisabled = true;
}
