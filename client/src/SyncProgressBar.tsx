interface SyncProgressBarProps {
  active: boolean;
  /** 0–100 for determinate progress; omit for indeterminate animation */
  progress?: number | null;
}

export default function SyncProgressBar({ active, progress }: SyncProgressBarProps) {
  if (!active) return null;

  const determinate = progress != null;
  const clampedProgress = determinate
    ? Math.min(100, Math.max(0, progress))
    : undefined;

  return (
    <div
      className="sync-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedProgress}
      aria-valuetext={determinate ? `${clampedProgress}%` : 'Syncing'}
      aria-busy="true"
    >
      <div
        className={`sync-progress-bar-fill${
          determinate
            ? ' sync-progress-bar-fill-determinate'
            : ' sync-progress-bar-fill-indeterminate'
        }`}
        style={determinate ? { width: `${clampedProgress}%` } : undefined}
      />
    </div>
  );
}
