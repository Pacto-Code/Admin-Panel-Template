import { vitestPreset } from "./index.js";

/** Shared Vitest config for `modules/<id>`: each module's `test` script points here and runs from its own folder. */
export default vitestPreset(process.cwd());
