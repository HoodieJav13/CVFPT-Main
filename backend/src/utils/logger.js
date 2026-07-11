function safeCode(value) {
  const text = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : undefined;
}

function safeStatus(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 400 && number <= 599 ? number : undefined;
}

function logError(context, error) {
  const metadata = {
    name: safeCode(error?.name),
    code: safeCode(error?.code),
    status: safeStatus(error?.status || error?.statusCode),
  };
  const safeMetadata = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
  console.error(String(context || 'application error'), safeMetadata);
}

module.exports = { logError };
