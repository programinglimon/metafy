import React from 'react';

// Without a boundary, an uncaught render error makes React unmount the whole
// tree — the user just sees a blank page. This keeps the failure readable and
// one click away from a retry, which is much easier to debug than white space.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crash:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="mark"><span className="dot" />SHEET / METADATA</div>
          <h1>This screen failed to render</h1>
          <p className="sub">
            The rest of the app is fine — retry, or reload if it keeps happening.
          </p>
          <div className="auth-error mono">{String(error?.message || error)}</div>
          <div className="auth-actions">
            <button className="btn btn-primary" type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}