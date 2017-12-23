export const base64url = (buffer: Buffer) => {
  return buffer.toString('base64')
    .replace(/=$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
