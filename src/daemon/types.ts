/** Daemon module — platform-native service management for MyOS. */

/** Daemon backend identifier. */
export type DaemonBackend = "launchd" | "systemd" | "pid";

/** Lifecycle commands supported by all backends. */
export interface DaemonManager {
  readonly backend: DaemonBackend;
  /** Install and start the service. */
  install(): Promise<void>;
  /** Uninstall the service (stop + remove files). */
  uninstall(): Promise<void>;
  /** Start the installed service. */
  start(): Promise<void>;
  /** Stop the installed service. */
  stop(): Promise<void>;
  /** Restart the installed service. */
  restart(): Promise<void>;
  /** Print current status. */
  status(): Promise<void>;
  /** Whether the service is installed. */
  isInstalled(): Promise<boolean>;
  /** Whether the service is currently running. */
  isRunning(): Promise<boolean>;
}

/** Configuration for daemon installation. */
export interface DaemonConfig {
  /** Label / service name (e.g. "ai.myos.gateway"). */
  label: string;
  /** Human-readable description. */
  description: string;
  /** Program arguments — first element is the executable. */
  programArguments: string[];
  /** Working directory for the service. */
  workingDirectory?: string;
  /** Environment variables to pass to the service. */
  environment?: Record<string, string>;
  /** Path to stdout log file. */
  logPath: string;
  /** Path to PID file (used by pid backend). */
  pidPath: string;
}
