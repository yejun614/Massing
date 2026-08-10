/**
 * Where the project lives.
 *
 * Several places link out — the toolbar's GitHub button, the feedback prompt,
 * the desktop download — and a repository that moves would otherwise leave one
 * of them pointing at nothing. One constant, derived once.
 */

/** owner/name. The API wants this form and the web URLs are built from it. */
const REPO = 'yejun614/Massing';

export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const RELEASES_URL = `${REPO_URL}/releases`;

/**
 * The newest release, as JSON.
 *
 * `/latest` is the published, non-prerelease one, which is exactly right here:
 * the workflow creates every release as a draft and a person publishes it, so
 * this can never offer a build that was still being checked.
 */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
