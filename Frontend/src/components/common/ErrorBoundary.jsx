import React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "../ui/button"

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center p-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-vermilion-50 text-vermilion-600 ring-1 ring-inset ring-vermilion-200">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="text-body font-semibold text-ink">Something went wrong displaying this view</h3>
          <p className="mt-1 max-w-md text-small text-ink-3">
            {this.state.error?.message || "An unexpected error occurred while rendering the data."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={this.handleReset}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
