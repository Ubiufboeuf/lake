export function normalize (value: string): string {
  return value
    .toLowerCase()
    .replace(/ñ/g, '\uE000')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uE000/g, 'ñ')
    .trim()
    .replace(/\s+/g, ' ')
}
