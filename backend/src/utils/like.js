// Escape LIKE/ILIKE wildcards so user-supplied text matches literally.
// `%` and `_` are legal characters in an email local part — an unescaped
// pattern lets one address wildcard-match another's invitation.
function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

module.exports = { escapeLikePattern };
