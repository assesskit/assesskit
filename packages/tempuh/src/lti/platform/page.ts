import { escapeHtml, pagePolicy } from "../html.js";
import type { HttpResponse } from "../http.js";

// The form submits itself; requestSubmit runs the form's validation and its submit event, which submit() does not.
const SCRIPT = `document.getElementById("form").requestSubmit();`;

/** What the page posts and to whom. */
export interface AutoPost {
  /** The tool's redirect URI, to which the page posts the form. */
  readonly redirectUri: string;
  /** The signed `id_token`. */
  readonly idToken: string;
  /** The `state` of the tool's authentication request, returned unchanged. */
  readonly state: string;
  /** The origin of the player page, the only one that may frame the page. */
  readonly playerOrigin: string;
}

/**
 * Builds the page that posts the `id_token` to the tool (Security Framework §5.1.1.3, `response_mode=form_post`). The page
 * has a policy that allows its one script by hash, forms only to the origin of the redirect URI and framing only by the
 * player (D-M1); every value in it is HTML-encoded; and the answer is not cached and sends no referrer.
 */
export async function autoPostPage(post: AutoPost): Promise<HttpResponse> {
  const { redirectUri, idToken, state, playerOrigin } = post;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LTI launch</title>
</head>
<body>
<form id="form" method="post" action="${escapeHtml(redirectUri)}">
<input type="hidden" name="id_token" value="${escapeHtml(idToken)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<noscript><button type="submit">Continue</button></noscript>
</form>
<script>${SCRIPT}</script>
</body>
</html>
`;
  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": await pagePolicy(SCRIPT, new URL(redirectUri).origin, playerOrigin),
    },
    body: html,
  };
}
