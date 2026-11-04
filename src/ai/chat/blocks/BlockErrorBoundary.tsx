import React from "react";
import { BlockFallback } from "./BlockFallback";

interface BlockErrorBoundaryProps {
	blockType: string;
	raw: string;
	children: React.ReactNode;
}

interface BlockErrorBoundaryState {
	error: Error | null;
}

// The caller keys this on the segment (message id plus segment index). Without
// that key a boundary that once caught an error stays failed forever, so a later
// valid block in the same position would wrongly render as a failure too.
//
// It only catches synchronous render errors. Asynchronous failures (for example
// Mermaid's render() rejecting) never reach it and are caught inside the block,
// which surfaces them through the same BlockFallback.
export class BlockErrorBoundary extends React.Component<
	BlockErrorBoundaryProps,
	BlockErrorBoundaryState
> {
	state: BlockErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error(`[block:${this.props.blockType}] render error`, error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<BlockFallback
					type={this.props.blockType}
					detail={this.state.error.message}
					raw={this.props.raw}
				/>
			);
		}
		return this.props.children;
	}
}
