// Email clients need literal colors. Keep these backend-local values in sync
// with the app tokens; email-appearance.test.js checks that parity. No runtime
// import may cross the independent frontend/backend deployment roots.
module.exports = Object.freeze({
  teal: '#5EC4D4',       // --primary
  ink: '#181511',        // --primary-foreground
  paper: '#ECE7DF',      // --foreground (light email reading surface)
  graphite: '#201C18',   // --card
  border: '#3B3630',     // --border (also muted text on the light surface)
  muted: '#A49F98',      // --muted-foreground (dark surface only)
  logoBacking: '#FFFFFF', // Preserve the original square PNG's white backing.
});
