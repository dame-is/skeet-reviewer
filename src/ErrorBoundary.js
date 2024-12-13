// ErrorBoundary.jsx

import React from 'react';
import './ErrorBoundary.css'; // Ensure this file exists with the styles provided below

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state to display fallback UI on next render
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can log the error to an error reporting service here
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render any custom fallback UI
      return (
        <div className="error-fallback">
          <h2>Oops! Something went wrong.</h2>
          <p>We encountered an error while loading this post.</p>
          <button onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;
