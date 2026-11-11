// A tiny syntax highlighter for the code samples (ts/js, sh):
// comments, strings, numbers and keywords. Enough to make samples readable
// without a dependency.
const KEYWORDS: Record<string, string[]> = {
	ts: [
		'import',
		'from',
		'export',
		'const',
		'let',
		'await',
		'async',
		'new',
		'return',
		'function',
		'if',
		'else',
		'for',
		'of',
		'true',
		'false',
		'null',
		'type',
		'interface',
	],
	sh: ['npm', 'cd'],
};

function escape(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code: string, lang: string): string {
	const words = KEYWORDS[lang] ?? [];
	const comment = lang === 'sh' ? '#[^\\n]*' : '\\/\\/[^\\n]*';
	const token = new RegExp(
		`(${comment})|('(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*"|\`[^\`]*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:${words.join('|') || '\\b'})\\b)`,
		'g',
	);
	let out = '';
	let last = 0;
	for (const m of code.matchAll(token)) {
		out += escape(code.slice(last, m.index));
		const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : 'kw';
		out += `<span class="tok-${cls}">${escape(m[0])}</span>`;
		last = m.index! + m[0].length;
	}
	return out + escape(code.slice(last));
}

export function highlightAll(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
		const lang = /language-(\w+)/.exec(el.className)![1];
		el.innerHTML = highlight(el.textContent ?? '', lang);
	}
}
