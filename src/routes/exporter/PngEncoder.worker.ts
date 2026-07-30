type EncodePngRequest = {
	requestId: number;
	bitmap: ImageBitmap;
};

type EncodePngResponse =
	| {
			requestId: number;
			blob: Blob;
			durationMs: number;
	  }
	| {
			requestId: number;
			error: string;
	  };

const workerScope = self as unknown as {
	onmessage: ((event: MessageEvent<EncodePngRequest>) => void) | null;
	postMessage(message: EncodePngResponse): void;
};

let canvas: OffscreenCanvas | null = null;

/**
 * Encode une ImageBitmap en PNG hors du thread principal de la WebView.
 * @param {MessageEvent<EncodePngRequest>} event Requête contenant les pixels à encoder.
 * @returns {Promise<void>}
 */
workerScope.onmessage = async (event: MessageEvent<EncodePngRequest>): Promise<void> => {
	const { requestId, bitmap } = event.data;
	const startedAt = performance.now();
	let bitmapClosed = false;

	try {
		if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
			canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		}

		const context = canvas.getContext('2d');
		if (!context) throw new Error('ANDROID_PNG_WORKER_CONTEXT_UNAVAILABLE');
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(bitmap, 0, 0);
		bitmap.close();
		bitmapClosed = true;

		const blob = await canvas.convertToBlob({ type: 'image/png' });
		workerScope.postMessage({
			requestId,
			blob,
			durationMs: performance.now() - startedAt
		});
	} catch (error) {
		if (!bitmapClosed) bitmap.close();
		workerScope.postMessage({
			requestId,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
