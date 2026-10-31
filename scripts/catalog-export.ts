import { catalog } from '../agent/catalog.js';

// The release builder compares this validated export with the committed JSON.
// Stdout is exclusively the catalog; do not add banners or diagnostic objects.
process.stdout.write(JSON.stringify(catalog) + '\n');
