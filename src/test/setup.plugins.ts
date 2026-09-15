// Setup for the plain-node `plugins` project. It shares the console guard with
// the app project but none of the RN environment: no RNTL matchers, no MSW
// server, so `src/test/setup.ts` cannot be reused here.
import { installConsoleGuard } from './console';

installConsoleGuard();
