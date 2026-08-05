export type SessionResponseAction = "accept" | "redirect-login" | "show-error";

export function sessionResponseAction(status: number): SessionResponseAction {
  if (status === 401) return "redirect-login";
  if (status >= 200 && status < 300) return "accept";
  return "show-error";
}

export function replacePreviewObjectUrl(
  currentUrl: string | null,
  nextUrl: string | null,
  revoke: (url: string) => void,
): string | null {
  if (currentUrl && currentUrl !== nextUrl) revoke(currentUrl);
  return nextUrl;
}
