import { createHash } from 'node:crypto';

export type CloudinaryResource = 'image' | 'video' | 'raw';

export function resourceTypeFor(contentType: string): CloudinaryResource {
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'raw';
  return 'image';
}

export function encodeStorageKey(resourceType: CloudinaryResource, publicId: string) {
  return `cld:${resourceType}:${publicId}`;
}

export function decodeStorageKey(key: string) {
  const match = /^cld:(image|video|raw):(.+)$/.exec(key);
  if (!match) return null;
  return {
    resourceType: match[1] as CloudinaryResource,
    publicId: match[2],
  };
}

/** Cloudinary SHA-1 signature: sorted param=value pairs + api_secret. */
export function signCloudinaryParams(
  params: Record<string, string | number | undefined>,
  apiSecret: string,
) {
  const toSign = Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== '';
    })
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

export async function uploadToCloudinary(input: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  folder: string;
  publicId: string;
}) {
  const resourceType = resourceTypeFor(input.contentType);
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    folder: input.folder,
    public_id: input.publicId,
    timestamp,
  };
  const signature = signCloudinaryParams(params, input.apiSecret);
  const body = new FormData();
  body.set(
    'file',
    new Blob([new Uint8Array(input.buffer)], { type: input.contentType }),
    input.filename,
  );
  body.set('api_key', input.apiKey);
  body.set('timestamp', String(timestamp));
  body.set('signature', signature);
  body.set('folder', input.folder);
  body.set('public_id', input.publicId);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${input.cloudName}/${resourceType}/upload`,
    { method: 'POST', body },
  );
  const json = (await response.json()) as {
    secure_url?: string;
    public_id?: string;
    resource_type?: string;
    error?: { message?: string };
  };
  if (!response.ok || !json.secure_url || !json.public_id) {
    throw new Error(json.error?.message || 'Cloudinary upload failed');
  }
  return {
    url: json.secure_url,
    key: encodeStorageKey(resourceType, json.public_id),
    publicId: json.public_id,
    resourceType,
  };
}

export async function destroyOnCloudinary(input: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  publicId: string;
  resourceType: CloudinaryResource;
}) {
  const timestamp = Math.round(Date.now() / 1000);
  const params = { public_id: input.publicId, timestamp };
  const signature = signCloudinaryParams(params, input.apiSecret);
  const body = new URLSearchParams({
    public_id: input.publicId,
    api_key: input.apiKey,
    timestamp: String(timestamp),
    signature,
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${input.cloudName}/${input.resourceType}/destroy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(json.error?.message || 'Cloudinary delete failed');
  }
}
