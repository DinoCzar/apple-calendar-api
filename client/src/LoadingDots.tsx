interface LoadingDotsProps {
  children: string;
}

export default function LoadingDots({ children }: LoadingDotsProps) {
  return (
    <span className="loading-dots-text">
      {children}
      <span className="loading-dots" aria-hidden="true">
        <span className="loading-dot">.</span>
        <span className="loading-dot">.</span>
        <span className="loading-dot">.</span>
      </span>
    </span>
  );
}
