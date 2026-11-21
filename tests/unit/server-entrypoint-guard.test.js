import { describe, it, expect, vi } from 'vitest';
import { pathToFileURL } from 'url';

// Spy http.createServer: jika guard entry point gagal, import ke src/server.js
// akan ikut memanggil startServer() dan merebut port (EADDRINUSE di produksi).
vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createServer: vi.fn(actual.createServer)
  };
});

const http = await import('http');
const { isDirectRun } = await import('../../src/server.js');

describe('src/server.js — entry point guard', () => {
  it('isDirectRun true hanya untuk entry point server', () => {
    const serverUrl = pathToFileURL('/app/src/server.js').href;
    expect(isDirectRun(serverUrl, '/app/src/server.js')).toBe(true);
    expect(isDirectRun(serverUrl, '/app/node_modules/vitest/vitest.mjs')).toBe(false);
  });

  it('isDirectRun false saat proses tidak punya entry point', () => {
    expect(isDirectRun('file:///app/src/server.js', undefined)).toBe(false);
  });

  it('import src/server.js tidak membuat HTTP server', () => {
    expect(http.createServer).not.toHaveBeenCalled();
  });
});
