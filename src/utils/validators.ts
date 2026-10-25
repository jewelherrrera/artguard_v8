const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function validateEmailField(value: string): string | undefined {
  if (!value.trim()) return 'Email is required.';
  if (!isValidEmail(value)) return 'Enter a valid email address.';
  return undefined;
}

export function validateRequired(value: string, label: string): string | undefined {
  if (!value.trim()) return `${label} is required.`;
  return undefined;
}

export interface PasswordRequirement {
  id: 'length' | 'uppercase' | 'lowercase' | 'number' | 'special';
  label: string;
  satisfied: boolean;
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface PasswordAssessment {
  requirements: PasswordRequirement[];
  strength: PasswordStrength;
  isValid: boolean;
}

const COMMON_PASSWORD_PARTS = [
  'password',
  'qwerty',
  'letmein',
  'welcome',
  'iloveyou',
  'admin',
  'monkey',
  'dragon',
  'sunshine',
  'football',
  'baseball',
  'abc123',
  '123456',
];
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function hasPredictablePattern(value: string): boolean {
  const normalized = value.toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');

  if (COMMON_PASSWORD_PARTS.some((part) => compact.includes(part))) return true;
  if (/(.)\1{3,}/i.test(normalized) || /([a-z0-9]{1,4})\1{2,}/.test(compact)) return true;

  return SEQUENCES.some((sequence) => {
    const reversed = [...sequence].reverse().join('');
    for (let index = 0; index <= compact.length - 4; index += 1) {
      const candidate = compact.slice(index, index + 4);
      if (sequence.includes(candidate) || reversed.includes(candidate)) return true;
    }
    return false;
  });
}

export function assessPassword(value: string): PasswordAssessment {
  const requirements: PasswordRequirement[] = [
    { id: 'length', label: 'At least 8 characters', satisfied: value.length >= 8 },
    { id: 'uppercase', label: 'One uppercase letter', satisfied: /[A-Z]/.test(value) },
    { id: 'lowercase', label: 'One lowercase letter', satisfied: /[a-z]/.test(value) },
    { id: 'number', label: 'One number', satisfied: /[0-9]/.test(value) },
    { id: 'special', label: 'One special character', satisfied: /[^A-Za-z0-9\s]/.test(value) },
  ];
  const predictable = hasPredictablePattern(value);
  const meetsRequirements = requirements.every((requirement) => requirement.satisfied);
  const uniqueCharacters = new Set(value).size;
  const strength: PasswordStrength = !meetsRequirements || predictable
    ? 'weak'
    : value.length >= 12 && uniqueCharacters >= 8 && uniqueCharacters / value.length >= 0.6
      ? 'strong'
      : 'medium';

  return {
    requirements,
    strength,
    isValid: meetsRequirements && !predictable,
  };
}

export function validatePasswordField(value: string): string | undefined {
  if (!value) return 'Password is required.';
  const assessment = assessPassword(value);
  const missingRequirements = assessment.requirements.filter((requirement) => !requirement.satisfied);
  if (missingRequirements.length) {
    return `Password needs ${missingRequirements.map((requirement) => requirement.label.toLowerCase()).join(', ')}.`;
  }
  if (!assessment.isValid) {
    return 'Avoid common passwords, repeated characters, or predictable sequences.';
  }
  return undefined;
}

export function validateConfirmPassword(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Please confirm your password.';
  if (password !== confirm) return 'Passwords do not match.';
  return undefined;
}
