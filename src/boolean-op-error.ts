/**
 * Thrown by `booleanOp` when it can't give a trustworthy result: a contour of
 * the result doesn't close, or two curves can't be intersected (they stay
 * within the tolerance of each other along a stretch without being recognised
 * as the same curve).
 */
export class BooleanOpError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BooleanOpError';
	}
}
