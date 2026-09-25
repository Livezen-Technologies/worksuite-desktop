/** "Samali is typing…", "Samali and Chamudi are typing…", "Samali, Chamudi and 2 others are typing…". */
export function typingLine(names: string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? '' : 's'} are typing…`;
}
