import React from "react";
import { Link } from "react-router-dom";

export class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Route failed to render", error, info);
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong loading this page.</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Try again, or return to your dashboard and reopen the page from there.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Try again
            </button>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            >
              Go to my dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
