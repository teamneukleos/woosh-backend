import {
  decodeStorageKey,
  encodeStorageKey,
  resourceTypeFor,
  signCloudinaryParams,
} from './cloudinary';

describe('cloudinary helpers', () => {
  it('signs sorted params with the API secret', () => {
    expect(
      signCloudinaryParams(
        { timestamp: 1315060510, public_id: 'sample_image' },
        'abcd',
      ),
    ).toBe('b4ad47fb4e25c7bf5f92a20089f9db59bc302313');
  });

  it('picks resource type from content type', () => {
    expect(resourceTypeFor('image/jpeg')).toBe('image');
    expect(resourceTypeFor('video/mp4')).toBe('video');
    expect(resourceTypeFor('application/pdf')).toBe('raw');
  });

  it('round-trips a stored Cloudinary key', () => {
    const key = encodeStorageKey('image', 'woosh/creators/abc/avatar');
    expect(key).toBe('cld:image:woosh/creators/abc/avatar');
    expect(decodeStorageKey(key)).toEqual({
      resourceType: 'image',
      publicId: 'woosh/creators/abc/avatar',
    });
  });

  it('ignores local storage keys', () => {
    expect(decodeStorageKey('creators/abc/avatar/file.jpg')).toBeNull();
  });
});
