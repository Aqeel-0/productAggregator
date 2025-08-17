/*
	Analyze normalized datasets to find model base names that have:
	- a no-suffix variant (no trailing 4G/5G)
	- a 5G-suffix variant (ends with 5G)
	- a 4G-suffix variant (ends with 4G)

	The script reports:
	- Cross-file matches (combined across all sources)
	- Per-file matches (within each individual source)

	Outputs a human-readable summary to stdout and saves a JSON report to
	`parsed_data/dual_suffix_variants_report.json`.
*/

const fs = require('fs');
const path = require('path');

function safeReadJSON(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf8');
		const parsed = JSON.parse(data);
		if (!Array.isArray(parsed)) return [];
		return parsed;
	} catch (_) {
		return [];
	}
}

function collapseSpaces(input) {
	return String(input || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeBrand(brand) {
	if (!brand) return null;
	const b = collapseSpaces(brand).toLowerCase();
	// Light-weight standardization for common variants
	const map = {
		'one plus': 'oneplus'
	};
	return map[b] || b;
}

function extractBaseAndSuffix(modelName) {
	if (!modelName || typeof modelName !== 'string') return { base: null, suffix: null };
	let name = collapseSpaces(modelName);
	const lower = name.toLowerCase();
	if (/\s5g$/i.test(name)) {
		return { base: collapseSpaces(name.replace(/\s*5g$/i, '')), suffix: '5G' };
	}
	if (/\s4g$/i.test(name)) {
		return { base: collapseSpaces(name.replace(/\s*4g$/i, '')), suffix: '4G' };
	}
	return { base: name, suffix: 'NO_SUFFIX' };
}

function buildGroups(records, scopeLabel) {
	// Key by brand|base to avoid cross-brand collisions
	const groups = new Map();
	for (const rec of records) {
		const brand = normalizeBrand(rec?.product_identifiers?.brand);
		const modelName = collapseSpaces(rec?.product_identifiers?.model_name || '');
		if (!brand || !modelName) continue;
		const { base, suffix } = extractBaseAndSuffix(modelName);
		if (!base || !suffix) continue;
		const key = `${brand}|${base.toLowerCase()}`;
		if (!groups.has(key)) {
			groups.set(key, {
				brand,
				base,
				variants: { NO_SUFFIX: [], '5G': [], '4G': [] },
				sources: new Set(),
				keys: new Set([key])
			});
		}
		const bucket = groups.get(key);
		bucket.sources.add(scopeLabel);
		if (!bucket.variants[suffix]) bucket.variants[suffix] = [];
		bucket.variants[suffix].push({
			source: scopeLabel,
			brand: rec?.product_identifiers?.brand || null,
			model_name: rec?.product_identifiers?.model_name || null,
			original_title: rec?.product_identifiers?.original_title || rec?.title || null
		});
	}
	return groups;
}

function filterComplete(groups) {
	const results = [];
	for (const g of groups.values()) {
		if (g.variants.NO_SUFFIX.length > 0 && g.variants['5G'].length > 0 && g.variants['4G'].length > 0) {
			results.push(g);
		}
	}
	return results;
}

function printSummary(title, matches) {
	console.log(`\n=== ${title} ===`);
	console.log(`Total base names with all three variants: ${matches.length}`);
	for (const m of matches) {
		const srcs = Array.from(m.sources).join(', ');
		console.log(`- Brand: ${m.brand} | Base: "${m.base}" | no/5G/4G counts: ` +
			`${m.variants.NO_SUFFIX.length}/${m.variants['5G'].length}/${m.variants['4G'].length} | sources: ${srcs}`);
	}
}

function saveReport(filePath, report) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

function main() {
	const root = path.resolve(__dirname, '..');
	const files = [
		{ label: 'amazon', path: path.join(root, 'parsed_data', 'amazon_normalized_data.json') },
		{ label: 'croma', path: path.join(root, 'parsed_data', 'croma_normalized_data.json') },
		{ label: 'flipkart', path: path.join(root, 'parsed_data', 'flipkart_normalized_data.json') },
		{ label: 'reliance', path: path.join(root, 'parsed_data', 'reliance_normalized_data.json') }
	];

	// Load records per file and build per-file groups
	const perFileGroups = new Map();
	const allRecords = [];
	for (const f of files) {
		const data = safeReadJSON(f.path);
		if (!data.length) continue;
		const groups = buildGroups(data, f.label);
		perFileGroups.set(f.label, groups);
		for (const rec of data) {
			allRecords.push(rec);
		}
	}

	// Per-file matches
	const perFileMatches = {};
	for (const [label, groups] of perFileGroups.entries()) {
		perFileMatches[label] = filterComplete(groups).map(g => ({
			brand: g.brand,
			base: g.base,
			counts: {
				no_suffix: g.variants.NO_SUFFIX.length,
				five_g: g.variants['5G'].length,
				four_g: g.variants['4G'].length
			}
		}));
	}

	// Cross-file (global) matches
	const globalGroups = buildGroups(allRecords, 'all');
	const globalMatches = filterComplete(globalGroups);

	// Print
	printSummary('Cross-file (combined) matches', globalMatches);
	for (const label of Object.keys(perFileMatches)) {
		printSummary(`Within-file matches: ${label}`, perFileMatches[label].map(m => ({
			brand: m.brand,
			base: m.base,
			variants: {
				NO_SUFFIX: new Array(m.counts.no_suffix),
				'5G': new Array(m.counts.five_g),
				'4G': new Array(m.counts.four_g)
			},
			sources: new Set([label])
		})));
	}

	// Save report
	const report = {
		generated_at_utc: new Date().toISOString(),
		cross_file: globalMatches.map(g => ({
			brand: g.brand,
			base: g.base,
			sources: Array.from(g.sources),
			counts: {
				no_suffix: g.variants.NO_SUFFIX.length,
				five_g: g.variants['5G'].length,
				four_g: g.variants['4G'].length
			},
			samples: {
				no_suffix: g.variants.NO_SUFFIX.slice(0, 3),
				five_g: g.variants['5G'].slice(0, 3),
				four_g: g.variants['4G'].slice(0, 3)
			}
		})),
		per_file: perFileMatches
	};
	const outPath = path.join(root, 'parsed_data', 'dual_suffix_variants_report.json');
	saveReport(outPath, report);
	console.log(`\nSaved JSON report to: ${outPath}`);
}

if (require.main === module) {
	main();
}


