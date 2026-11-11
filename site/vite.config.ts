import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	// GitHub Pages serves a project site under /<repo>/; the deploy workflow sets
	// BASE_PATH. Locally the site is served from the root.
	base: process.env.BASE_PATH ?? '/',
	resolve: {
		// The library straight from its source, so the site always matches it.
		// The flatten comparison also uses an internal helper (curveSamples).
		alias: {
			'vector-path-tools/internal/flatten': local('../src/flatten.ts'),
			'vector-path-tools': local('../src/index.ts'),
		},
	},
	build: {
		target: 'esnext', // top-level await
		rollupOptions: {
			input: {
				index: local('index.html'),
				flatten: local('flatten.html'),
				quadratics: local('quadratics.html'),
			},
		},
	},
});
