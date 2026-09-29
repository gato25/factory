/**
 * Where one ticket's specification and plan live on its branch: its own folder, so a
 * ticket on a repository an earlier ticket was merged into writes a new
 * specification instead of finding the old one and passing it off as done.
 * `{{ticket.docs}}` in an agent's instructions and a step's paths.
 */
export function ticketDocsDir(reference: string): string {
  return `docs/tickets/${reference.replace(/^#/, '')}`;
}
