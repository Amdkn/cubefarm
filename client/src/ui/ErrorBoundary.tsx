import { Component, type ErrorInfo, type ReactNode } from 'react';
import { setMode } from '../pocket/mode';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Cubefarm render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="start">
          <div className="start-card" style={{ maxWidth: '640px' }}>
            <div className="start-logo">⚠️</div>
            <h1>Aspace 3D Fallback Mode</h1>
            <p className="start-tag">
              An issue occurred during WebGL / Three.js initialization:
            </p>
            <div
              style={{
                background: '#1f1d2b',
                color: '#ef476f',
                padding: '12px',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '13px',
                textAlign: 'left',
                margin: '16px 0',
                maxHeight: '180px',
                overflow: 'auto',
              }}
            >
              {this.state.error?.message || String(this.state.error)}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                className="btn btn-big"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                🔄 Reload Office
              </button>
              <button
                className="btn btn-big"
                style={{ background: '#3a86ff' }}
                onClick={() => {
                  setMode('pocket');
                  this.setState({ hasError: false, error: null });
                }}
              >
                📱 Switch to 2D Pocket Mode
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
