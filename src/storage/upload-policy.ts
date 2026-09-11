export type UploadKind =
  | 'avatar'
  | 'cover'
  | 'portfolio-image'
  | 'portfolio-video'
  | 'deliverable';

export const UPLOAD_POLICY: Record<
  UploadKind,
  { maxBytes: number; types: readonly string[] }
> = {
  avatar: {
    maxBytes: 5_000_000,
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
  cover: {
    maxBytes: 8_000_000,
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
  'portfolio-image': {
    maxBytes: 20_000_000,
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
  'portfolio-video': {
    maxBytes: 100_000_000,
    types: ['video/mp4', 'video/quicktime'],
  },
  deliverable: {
    maxBytes: 100_000_000,
    types: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'application/pdf',
    ],
  },
};

export function hasValidSignature(buffer: Buffer, contentType: string) {
  if (contentType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (contentType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (contentType === 'video/mp4' || contentType === 'video/quicktime') {
    return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (contentType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

export function validateUploadMetadata(input: {
  size: number;
  contentType: string;
  kind: UploadKind;
}) {
  const policy = UPLOAD_POLICY[input.kind];
  if (!policy.types.includes(input.contentType)) {
    throw new Error(`Unsupported file type for ${input.kind}`);
  }
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > policy.maxBytes) {
    throw new Error(
      `${input.kind} must be smaller than ${Math.round(policy.maxBytes / 1_000_000)} MB`,
    );
  }
}

export function validateUpload(input: {
  buffer: Buffer;
  contentType: string;
  kind: UploadKind;
}) {
  validateUploadMetadata({
    size: input.buffer.length,
    contentType: input.contentType,
    kind: input.kind,
  });
  if (!hasValidSignature(input.buffer, input.contentType)) {
    throw new Error('File contents do not match the selected file type');
  }
}

export function contentTypeForKey(key: string) {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}
