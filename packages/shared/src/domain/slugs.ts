/**
 * Simple ASCII slug helper for language-neutral, URL-safe identifiers.
 *
 * Used for `categories.slug` (auto-generated from the English name when an
 * admin does not supply one). Slugs are technical identifiers (Type D in the
 * bilingual data policy) and are never translated.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
  return slug
}
