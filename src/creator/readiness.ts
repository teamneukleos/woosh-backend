export function creatorReadiness(profile: {
  avatarUrl: string | null;
  bio: string | null;
  locationCountry: string | null;
  categories: string[];
  languages: string[];
  user: { emailVerified: Date | null };
  socialAccounts: Array<{
    status: string;
    snapshots: Array<{ source: string; followers: number | null }>;
  }>;
  portfolioItems: Array<{ status: string }>;
  ratePackages: Array<{ active: boolean }>;
}) {
  const checks = [
    { id: 'email', label: 'Verify your email', complete: !!profile.user.emailVerified },
    { id: 'avatar', label: 'Add a profile photo', complete: !!profile.avatarUrl },
    {
      id: 'bio',
      label: 'Write a bio of at least 80 characters',
      complete: (profile.bio?.trim().length ?? 0) >= 80,
    },
    { id: 'location', label: 'Add your country', complete: !!profile.locationCountry },
    { id: 'category', label: 'Choose a category', complete: profile.categories.length > 0 },
    { id: 'language', label: 'Choose a language', complete: profile.languages.length > 0 },
    {
      id: 'social',
      label: 'Connect a social account with live metrics',
      complete: profile.socialAccounts.some(
        (account) =>
          account.status === 'ACTIVE' &&
          account.snapshots.some(
            (snapshot) =>
              snapshot.source !== 'manual_unverified' && snapshot.followers != null,
          ),
      ),
    },
    {
      id: 'rates',
      label: 'Add a rate package',
      complete: profile.ratePackages.some((rate) => rate.active),
    },
    {
      id: 'portfolio',
      label: 'Add three approved portfolio samples',
      complete:
        profile.portfolioItems.filter((item) => item.status === 'APPROVED').length >= 3,
    },
  ];

  const completed = checks.filter((check) => check.complete).length;
  return {
    checks,
    complete: completed === checks.length,
    percentage: Math.round((completed / checks.length) * 100),
  };
}
