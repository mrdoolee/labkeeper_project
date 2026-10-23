/** Same rule as the server (8+ chars). Returns a message, or null when fine. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  if (password !== confirm) return '비밀번호 확인이 일치하지 않습니다.'
  return null
}
