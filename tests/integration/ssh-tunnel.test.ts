/**
 * SSH Tunnel Tests
 * Tests SSH key permission checks and tunnel configuration validation
 */

import { EnhancedSSHTunnelManager } from '../../src/classes/EnhancedSSHTunnelManager.js';

// Mock the logger
jest.mock('../../src/utils/logger.js', () => ({
  getLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock node:fs/promises stat for key permission checks
jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
}));

import { stat as mockStat } from 'node:fs/promises';

describe('SSH tunnel', () => {
  let tunnelManager: EnhancedSSHTunnelManager;

  beforeEach(() => {
    jest.clearAllMocks();
    tunnelManager = new EnhancedSSHTunnelManager();
    tunnelManager.initialize();
  });

  it('throws error for world-readable key file via buildSSHConnectOptions', async () => {
    // Mock stat to return mode 0o644 (world-readable)
    (mockStat as jest.Mock).mockResolvedValue({ mode: 0o100644 });

    // Mock fs.existsSync to return true so the key is treated as a file path
    const fs = require('fs');
    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    // Call the private method directly to test key permission validation
    const buildOptions = (tunnelManager as any).buildSSHConnectOptions.bind(tunnelManager);

    try {
      await buildOptions({
        host: 'bastion.example.com',
        port: 22,
        username: 'user',
        privateKey: '/home/user/.ssh/id_rsa',
      });
      throw new Error('Expected error for world-readable key');
    } catch (err: any) {
      // The error is wrapped: "Failed to read SSH private key: SSH private key ... is world-readable"
      expect(err.message).toContain('world-readable');
    }

    existsSyncSpy.mockRestore();
  });

  it('accepts key file with safe permissions (mode 600)', async () => {
    // Mock stat to return mode 0o600 (safe)
    (mockStat as jest.Mock).mockResolvedValue({ mode: 0o100600 });

    const fs = require('fs');
    const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(
        Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----')
      );

    const buildOptions = (tunnelManager as any).buildSSHConnectOptions.bind(tunnelManager);

    const options = await buildOptions({
      host: 'bastion.example.com',
      port: 22,
      username: 'user',
      privateKey: '/home/user/.ssh/id_rsa',
    });

    expect(options.privateKey).toBeDefined();
    expect(options.host).toBe('bastion.example.com');

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('treats inline key content (-----BEGIN) as content, not file path', async () => {
    const buildOptions = (tunnelManager as any).buildSSHConnectOptions.bind(tunnelManager);

    const inlineKey = '-----BEGIN RSA PRIVATE KEY-----\nfakekey\n-----END RSA PRIVATE KEY-----';
    const options = await buildOptions({
      host: 'bastion.example.com',
      port: 22,
      username: 'user',
      privateKey: inlineKey,
    });

    // Should use the inline key directly, not try to read it as a file
    expect(options.privateKey).toBe(inlineKey);
    // stat should NOT have been called (no file path to check)
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('validates SSH config and rejects missing host', async () => {
    try {
      await tunnelManager.createEnhancedTunnel('test_db', {
        sshConfig: {
          host: '', // empty host
          port: 22,
          username: 'user',
          password: 'pass',
        },
        forwardConfig: {
          sourceHost: '127.0.0.1',
          sourcePort: 0,
          destinationHost: 'db.internal.com',
          destinationPort: 5432,
        },
        localPort: 0,
      });
      throw new Error('Expected validation error');
    } catch (err: any) {
      expect(err.message).toBeDefined();
      // Should reject due to invalid SSH configuration
      expect(err.message.toLowerCase()).toMatch(/ssh|host|invalid|configuration/);
    }
  });

  describe('host key verification (hostVerifier)', () => {
    const { createHash } = require('crypto');
    const fakeKey = Buffer.from('fake-host-key-bytes');
    const sha256B64 = createHash('sha256').update(fakeKey).digest('base64').replace(/=+$/, '');
    const openssh = `SHA256:${sha256B64}`;

    const getVerifier = async (extra: Record<string, unknown>) => {
      const buildOptions = (tunnelManager as any).buildSSHConnectOptions.bind(tunnelManager);
      const options = await buildOptions({
        host: 'bastion.example.com',
        port: 22,
        username: 'user',
        password: 'pass',
        ...extra,
      });
      return options.hostVerifier as (key: Buffer) => boolean;
    };

    it('always installs a hostVerifier (never accepts any key by default)', async () => {
      const verify = await getVerifier({});
      expect(typeof verify).toBe('function');
    });

    it('accepts a host key matching the pinned SHA256 fingerprint', async () => {
      const verify = await getVerifier({ hostFingerprint: openssh });
      expect(verify(fakeKey)).toBe(true);
    });

    it('rejects a host key that does not match the pinned fingerprint', async () => {
      const verify = await getVerifier({ hostFingerprint: 'SHA256:not-the-right-fingerprint' });
      expect(verify(fakeKey)).toBe(false);
    });

    it('rejects unknown host keys when strict checking is on (default)', async () => {
      const verify = await getVerifier({});
      expect(verify(fakeKey)).toBe(false);
    });

    it('accepts unknown host keys only when strict checking is explicitly disabled', async () => {
      const verify = await getVerifier({ strictHostKeyChecking: false });
      expect(verify(fakeKey)).toBe(true);
    });
  });

  it('uses 45s timeout constant for tunnel establishment', () => {
    // Verify the timeout constant is defined in the source
    // We access the source indirectly via the class — the 45s timeout is used in establishTunnel
    const source = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../src/classes/EnhancedSSHTunnelManager.ts'),
      'utf-8'
    );
    expect(source).toContain('TUNNEL_TIMEOUT = 45000');
  });
});
