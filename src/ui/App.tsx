import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { useAppState } from '../app/store';
import { clearCurrentProject } from '../core/storage';
import { AnalysisPanel } from './components/AnalysisPanel';
import { BusyIndicator, Dialogs, Toasts } from './components/Dialogs';
import { DirectionGrid } from './components/DirectionGrid';
import { GeneratePanel } from './components/GeneratePanel';
import { FlowStrip, Header } from './components/Header';
import { SheetPanel } from './components/SheetPanel';
import { SourcePanel } from './components/SourcePanel';
import { useGlobalShortcuts } from './useGlobalShortcuts';

const Editor = lazy(() => import('./editor/Editor'));

export function App() {
  useGlobalShortcuts();
  const editorOpen = useAppState((s) => s.ui.editorOpen);
  return (
    <div className="app">
      <Header />
      <FlowStrip />
      <main className="pipeline">
        <div className="column">
          <SourcePanel />
          <AnalysisPanel />
        </div>
        <div className="column">
          <GeneratePanel />
          <DirectionGrid />
        </div>
        <div className="column sheet-col">
          <SheetPanel />
        </div>
      </main>
      {editorOpen ? (
        <Suspense fallback={<div className="busy-overlay"><span className="spinner" /> Opening editor…</div>}>
          <Editor />
        </Suspense>
      ) : null}
      <Dialogs />
      <Toasts />
      <BusyIndicator />
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sprite8 crashed:', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen card" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">{this.state.error.message}</p>
        <p className="small faint">Your work is autosaved in this browser. Reloading usually helps. If the problem persists, reset the project.</p>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              void clearCurrentProject().finally(() => location.reload());
            }}
          >
            Reset project
          </button>
        </div>
      </div>
    );
  }
}
