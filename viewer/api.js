export function createApiClient({ apiBase, apiKey }) {
  function normalizedApiBase() {
    return apiBase().replace(/\/+$/, '');
  }

  return {
    async request(path) {
      const response = await fetch(`${normalizedApiBase()}${path}`, {
        headers: {
          'x-api-key': apiKey()
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }

      return response.json();
    }
  };
}
