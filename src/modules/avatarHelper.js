/**
 * Generate 1-2 uppercase initials from a user's display name.
 * e.g. "Alex Rivera" -> "AR", "Shyam" -> "SH", "John" -> "JO"
 */
export function getInitials(name) {
  if (!name) return '??';
  const clean = name.trim();
  if (!clean) return '??';

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generate a consistent, vibrant gradient background based on the user's name hash.
 */
export function getAvatarGradient(name) {
  if (!name) return 'linear-gradient(135deg, #6366f1, #8b5cf6)';

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const gradients = [
    'linear-gradient(135deg, #6366f1, #8b5cf6)',
    'linear-gradient(135deg, #ec4899, #f43f5e)',
    'linear-gradient(135deg, #10b981, #06b6d4)',
    'linear-gradient(135deg, #f59e0b, #ef4444)',
    'linear-gradient(135deg, #8b5cf6, #3b82f6)',
    'linear-gradient(135deg, #0ea5e9, #6366f1)',
    'linear-gradient(135deg, #14b8a6, #3b82f6)',
    'linear-gradient(135deg, #d946ef, #8b5cf6)'
  ];

  return gradients[Math.abs(hash) % gradients.length];
}
