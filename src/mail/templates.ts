export type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[char] ?? char,
  );
}

function shell(bodyHtml: string, ctaLabel: string, href: string) {
  return `<p>${bodyHtml}</p><p><a href="${escapeHtml(href)}">${escapeHtml(ctaLabel)}</a></p><p style="color:#667085;font-size:13px">If the button does not work, paste this URL into your browser:<br>${escapeHtml(href)}</p>`;
}

export function verifyEmailMessage(href: string): MailPayload {
  return {
    to: '',
    subject: 'Verify your Woosh email',
    html: shell(
      'Confirm this address to finish creating your Woosh account. The link expires in 24 hours.',
      'Verify email',
      href,
    ),
    text: `Confirm this address to finish creating your Woosh account.\n\n${href}\n\nThe link expires in 24 hours.`,
  };
}

export function resetPasswordMessage(href: string): MailPayload {
  return {
    to: '',
    subject: 'Reset your Woosh password',
    html: shell(
      'Use this one-hour link to choose a new password. If you did not ask for it, you can ignore this email.',
      'Choose a new password',
      href,
    ),
    text: `Use this one-hour link to choose a new password.\n\n${href}\n\nIf you did not ask for it, ignore this email.`,
  };
}

export function teamInviteMessage(input: {
  orgName: string;
  role: string;
  href: string;
}): MailPayload {
  const org = escapeHtml(input.orgName);
  const role = escapeHtml(input.role);
  return {
    to: '',
    subject: `Join ${input.orgName} on Woosh`,
    html: shell(
      `You were invited to <strong>${org}</strong> as ${role}. Create an account or sign in with this email to accept.`,
      'Accept invite',
      input.href,
    ),
    text: `You were invited to ${input.orgName} as ${input.role}.\n\n${input.href}`,
  };
}

export function teammateAddedMessage(input: {
  orgName: string;
  href: string;
}): MailPayload {
  const org = escapeHtml(input.orgName);
  return {
    to: '',
    subject: `You've been added to ${input.orgName} on Woosh`,
    html: shell(
      `Your existing Woosh account now has access to <strong>${org}</strong>.`,
      'Open workspace',
      input.href,
    ),
    text: `Your existing Woosh account now has access to ${input.orgName}.\n\n${input.href}`,
  };
}

export function claimInviteMessage(input: {
  brandName: string;
  handle: string;
  href: string;
  note?: string | null;
}): MailPayload {
  const brand = escapeHtml(input.brandName);
  const handle = escapeHtml(input.handle);
  const note = input.note?.trim()
    ? `<blockquote>${escapeHtml(input.note.trim())}</blockquote>`
    : '';
  const noteText = input.note?.trim() ? `\n\n${input.note.trim()}` : '';
  return {
    to: '',
    subject: `${input.brandName} invited you to claim @${input.handle} on Woosh`,
    html: shell(
      `<strong>${brand}</strong> invited you to claim <strong>@${handle}</strong> on Woosh.${note}`,
      'Claim profile',
      input.href,
    ),
    text: `${input.brandName} invited you to claim @${input.handle} on Woosh.${noteText}\n\n${input.href}`,
  };
}

export function inAppNotificationMessage(input: {
  title: string;
  body: string;
  href: string;
}): MailPayload {
  return {
    to: '',
    subject: input.title,
    html: shell(escapeHtml(input.body), 'Open in Woosh', input.href),
    text: `${input.body}\n\n${input.href}`,
  };
}

export function weeklyDigestMessage(input: {
  name: string | null;
  href: string;
  items: Array<{ title: string; body: string }>;
}): MailPayload {
  const greeting = escapeHtml(input.name || 'there');
  const list = input.items
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.body)}</li>`,
    )
    .join('');
  const text = input.items
    .map((item) => `${item.title}: ${item.body}`)
    .join('\n');
  return {
    to: '',
    subject: 'Your weekly Woosh update',
    html: `<p>Hi ${greeting},</p><p>Here is what moved on Woosh this week:</p><ul>${list}</ul><p><a href="${escapeHtml(input.href)}">Open notifications</a></p>`,
    text: `Hi ${input.name || 'there'},\n\nHere is what moved on Woosh this week:\n\n${text}\n\n${input.href}`,
  };
}
