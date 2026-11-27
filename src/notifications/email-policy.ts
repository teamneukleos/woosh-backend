/**
 * Which in-app notification types also send an email. Everything else stays in-app only
 * (and still appears in the weekly digest). Keep this list to events that need the
 * recipient to act or that they would not want to miss; never routine activity.
 */
export const EMAIL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  // Creator: briefs and selection
  'brief.invited',
  'brief.invitation.expiring',
  'brief.invitation.expired',
  'application.shortlisted',
  'application.accepted',
  'application.declined',
  'brand.interest',
  'creator.approved',
  'creator.rejected',
  // Creator: work
  'deliverable.revision',
  'deliverable.approved',
  'deliverable.due_soon',
  'deliverable.overdue',
  // Brand
  'application.received',
  'invitation.declined',
  'deliverable.submitted',
  'prospect.claimed',
  'brief.approved',
  'brief.rejected',
  'wallet.funded',
  // Both sides
  'offer.countered',
  'offer.agreed',
  'message.received',
  // Payments
  'payment.release.scheduled',
  'payment.account.required',
  'payment.paid',
  'payment.failed',
  'payment.reversed',
  'payment.dispute.opened',
  'payment.dispute.resolved',
]);

export function emailsByDefault(type: string) {
  return EMAIL_NOTIFICATION_TYPES.has(type);
}

/** Button label for the email; defaults to a generic one. */
export function emailCtaLabel(type: string) {
  if (type === 'message.received') return 'Read message';
  if (type.startsWith('payment.') || type === 'wallet.funded')
    return 'View payments';
  if (type.startsWith('deliverable.')) return 'Open campaign';
  if (type === 'application.received' || type === 'invitation.declined')
    return 'Review brief';
  if (type.startsWith('offer.')) return 'View offer';
  return 'Open in Woosh';
}
