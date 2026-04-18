import type { Logger as HomebridgeLogger } from "homebridge";
import type { LogLevel, SceneLogEntry } from "./types";

const severity: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogCollector {
  entries: SceneLogEntry[];
  push(entry: SceneLogEntry): void;
}

export class MemoryLogCollector implements LogCollector {
  public readonly entries: SceneLogEntry[] = [];

  push(entry: SceneLogEntry): void {
    this.entries.push(entry);
  }
}

export class StructuredLogger {
  constructor(
    private readonly scope: string,
    private readonly level: LogLevel,
    private readonly homebridgeLog?: HomebridgeLogger,
    private readonly collector?: LogCollector,
  ) {}

  child(scope: string): StructuredLogger {
    return new StructuredLogger(`${this.scope}:${scope}`, this.level, this.homebridgeLog, this.collector);
  }

  debug(message: string): void {
    this.log("debug", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }

  private log(level: LogLevel, message: string): void {
    const entry: SceneLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
    };

    this.collector?.push(entry);

    if (severity[level] < severity[this.level] || !this.homebridgeLog) {
      return;
    }

    if (level === "debug") {
      this.homebridgeLog.debug(`[${this.scope}] ${message}`);
      return;
    }

    if (level === "info") {
      this.homebridgeLog.info(`[${this.scope}] ${message}`);
      return;
    }

    if (level === "warn") {
      this.homebridgeLog.warn(`[${this.scope}] ${message}`);
      return;
    }

    this.homebridgeLog.error(`[${this.scope}] ${message}`);
  }
}
