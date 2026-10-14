import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '@/core/settings';
import { webdavBrowseUrl } from './webdav';

const cfg = (p: Partial<ProviderConfig>): ProviderConfig => ({ id: 'x', kind: 'webdav', name: 'NAS', enabled: true, sync: true, ...p });

describe('webdavBrowseUrl', () => {
  it('defaults to the server root of the sync folder', () => expect(webdavBrowseUrl(cfg({ url: 'http://192.168.1.50:5005/Documents/Tone' }))).toBe('http://192.168.1.50:5005'));
  it('uses an explicit browse address', () => expect(webdavBrowseUrl(cfg({ url: 'http://nas:5005/a/Tone', browseUrl: 'http://nas:5005/webdav' }))).toBe('http://nas:5005/webdav'));
  it('ignores a blank browse address', () => expect(webdavBrowseUrl(cfg({ url: 'https://nas.tail1234.ts.net/x', browseUrl: '  ' }))).toBe('https://nas.tail1234.ts.net'));
});
