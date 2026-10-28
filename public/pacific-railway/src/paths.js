// Resolve runtime resources from this module, including nested deployments.
const runtimeRoot = new URL('../', import.meta.url);
export const resourceUrl = path => new URL(path.replace(/^\/+/, ''), runtimeRoot).href;
