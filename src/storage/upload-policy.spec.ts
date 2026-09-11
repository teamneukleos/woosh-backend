import { hasValidSignature, validateUpload } from './upload-policy';

describe('upload-policy', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  it('accepts a JPEG signature', () => {
    expect(hasValidSignature(jpeg, 'image/jpeg')).toBe(true);
  });

  it('accepts a PNG signature', () => {
    expect(hasValidSignature(png, 'image/png')).toBe(true);
  });

  it('rejects a JPEG labelled as PNG', () => {
    expect(() =>
      validateUpload({ buffer: jpeg, contentType: 'image/png', kind: 'avatar' }),
    ).toThrow('File contents do not match');
  });

  it('rejects an unsupported type', () => {
    expect(() =>
      validateUpload({
        buffer: Buffer.from('not-an-image'),
        contentType: 'image/gif',
        kind: 'avatar',
      }),
    ).toThrow('Unsupported file type');
  });
});
