import { Component, type ReactNode } from 'react';

/** Resets the error state when the user clicks again — recovery, not a dead end. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : 'Something went wrong.' };
  }

  override componentDidCatch(): void {
    // Browser console logging is disabled by policy; the UI itself shows recovery.
  }

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div role="alert" className="card">
        <h2>The view hit a problem</h2>
        <p className="muted">{this.state.message}</p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            this.setState({ message: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
